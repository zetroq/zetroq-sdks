import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zetroq_chat/zetroq_chat.dart';

const api = 'https://api.example.test/api/v1';
const bot = 'tok-fl';
const conv = '0192c3f4-0000-7000-8000-0000000000ff';

http.Response ok(Map<String, dynamic> data, [int status = 200]) =>
    http.Response(jsonEncode({'success': true, 'data': data}), status, headers: {'content-type': 'application/json'});

Map<String, dynamic> startData([List<Map<String, dynamic>> history = const []]) =>
    {'conversationId': conv, 'visitorId': 'v-1', 'history': history, 'bot': {}};

void main() {
  test('parseSse splits complete frames and keeps the rest', () {
    final (events, rest) = parseSse('data: {"type":"connected"}\n\ndata: {"type":"message","content":"hi"}\n\ndata: {"pa');
    expect(events.map((e) => e['type']), ['connected', 'message']);
    expect(rest, 'data: {"pa');
  });

  test('history is GET /history with after + token header; 404 is an empty page', () async {
    final requests = <http.Request>[];
    var n = 0;
    final client = ZetroqClient(
      botToken: bot,
      apiBase: api,
      httpClient: MockClient((req) async {
        requests.add(req);
        return n++ == 0
            ? ok({'messages': [{'id': 'm-2', 'role': 'agent', 'content': 'Asha here'}], 'hasMore': false, 'cursor': 'm-2'})
            : http.Response(jsonEncode({'success': false, 'message': 'Conversation not found'}), 404);
      }),
    );

    final page = await client.history(visitorId: 'v-1', conversationId: conv, after: 'm-1', identityToken: 'signed.token');
    expect(requests[0].method, 'GET');
    expect(requests[0].url.path, '/api/v1/public/bots/$bot/history');
    expect(requests[0].url.queryParameters, {'conversationId': conv, 'visitorId': 'v-1', 'after': 'm-1'});
    expect(requests[0].headers['X-Identity-Token'], 'signed.token');
    expect(page.messages.single.content, 'Asha here');

    expect((await client.history(visitorId: 'v-1', conversationId: conv)).messages, isEmpty);
  });

  test('identify and upload use their endpoints', () async {
    final seen = <http.BaseRequest>[];
    final client = ZetroqClient(
      botToken: bot,
      apiBase: api,
      httpClient: MockClient((req) async {
        seen.add(req);
        if (req.url.path.endsWith('/identify')) {
          expect(jsonDecode(req.body), {'visitorId': 'v-1', 'conversationId': conv, 'identityToken': 'signed.token'});
          return ok({'status': 'verified', 'linked': true, 'conversationId': conv});
        }
        expect(req.headers['content-type'], startsWith('multipart/form-data'));
        expect(req.body, contains('name="visitorId"'));
        expect(req.body, contains('filename="a.png"'));
        return ok({'url': 'https://api.example.test/api/v1/public/chat-attachments/o/x.png', 'name': 'a.png', 'mimeType': 'image/png', 'size': 3}, 201);
      }),
    );

    final id = await client.identify(visitorId: 'v-1', conversationId: conv, identityToken: 'signed.token');
    expect(id.status, 'verified');
    expect(id.linked, isTrue);

    final a = await client.upload(visitorId: 'v-1', conversationId: conv, file: ZetroqFile(name: 'a.png', bytes: [1, 2, 3]));
    expect(a.url, contains('/chat-attachments/'));
    expect(seen.map((r) => r.url.path.split('/').last), ['identify', 'upload']);
  });

  test('stream() yields SSE events from GET /stream', () async {
    final client = ZetroqClient(
      botToken: bot,
      apiBase: api,
      httpClient: MockClient.streaming((req, _) async {
        expect(req.url.queryParameters, {'conversationId': conv, 'visitorId': 'v-1'});
        expect(req.headers['Accept'], 'text/event-stream');
        return http.StreamedResponse(
          Stream.fromIterable([
            utf8.encode('data: {"type":"connected"}\n\ndata: {"type":"mes'),
            utf8.encode('sage","message":{"id":"m-9","role":"agent","content":"Live"}}\n\n'),
          ]),
          200,
        );
      }),
    );
    final events = await client.stream(conversationId: conv, visitorId: 'v-1').toList();
    expect(events.length, 2);
    expect((events[1]['message'] as Map)['content'], 'Live');
  });

  test('a failed send is persisted and resent after a restart with the SAME clientMessageId', () async {
    final store = MemoryStore();
    final bodies = <Map<String, dynamic>>[];
    var online = false;
    http.Client mock() => MockClient((req) async {
          if (req.url.path.endsWith('/start')) return ok(startData());
          if (req.url.path.endsWith('/history')) return ok({'messages': [], 'hasMore': false});
          bodies.add(jsonDecode(req.body) as Map<String, dynamic>);
          if (!online) throw http.ClientException('offline');
          return ok({
            'message': {'id': 'b-1', 'role': 'bot', 'content': 'Got it'},
            'userMessage': {'id': 'u-1', 'role': 'user', 'content': 'Hello'},
            'duplicate': true,
          });
        });

    final first = ZetroqChat(botToken: bot, client: ZetroqClient(botToken: bot, apiBase: api, httpClient: mock()), store: store, useStream: false);
    await first.start();
    await first.send('Hello');
    expect(first.pending, 1);
    expect(first.messages.last.status, 'queued');
    expect(store.data['zetroq:$bot:queue'], contains('Hello'));
    first.dispose();

    online = true;
    final second = ZetroqChat(botToken: bot, client: ZetroqClient(botToken: bot, apiBase: api, httpClient: mock()), store: store, useStream: false);
    await second.start();
    expect(second.pending, 0);
    expect(bodies.length, 2);
    expect(bodies[1]['clientMessageId'], bodies[0]['clientMessageId']);
    expect(second.messages.map((m) => m.content), ['Hello', 'Got it']);
    expect(jsonDecode(store.data['zetroq:$bot:queue']!), isEmpty);
    second.dispose();
  });

  test('refresh() polls GET /history?after=<newest>, never /start again', () async {
    final paths = <String>[];
    final chat = ZetroqChat(
      botToken: bot,
      store: MemoryStore(),
      useStream: false,
      client: ZetroqClient(
        botToken: bot,
        apiBase: api,
        httpClient: MockClient((req) async {
          paths.add('${req.url.path.split('/').last}?${req.url.query}');
          if (req.url.path.endsWith('/start')) return ok(startData([{'id': 'm-1', 'role': 'bot', 'content': 'Hi'}]));
          return ok({'messages': [{'id': 'm-2', 'role': 'agent', 'content': 'Asha here'}], 'hasMore': false});
        }),
      ),
    );
    await chat.start();
    await chat.refresh();
    expect(paths.where((p) => p.startsWith('start')).length, 1);
    expect(paths.last, contains('after=m-1'));
    expect(chat.messages.map((m) => m.content), ['Hi', 'Asha here']);
    chat.dispose();
  });

  test('SharedPreferencesStore persists through shared_preferences', () async {
    SharedPreferences.setMockInitialValues({});
    final store = SharedPreferencesStore();
    await store.write('k', 'v');
    expect(await SharedPreferencesStore().read('k'), 'v');
  });
}
