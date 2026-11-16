import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

/// One chat message in the SDK shape.
class ZetroqMessage {
  ZetroqMessage({
    required this.id,
    required this.role,
    required this.content,
    this.clientMessageId,
    this.status = 'sent',
  });

  String id;
  final String role;
  final String content;
  final String? clientMessageId;
  String status;

  bool get mine => role == 'user';

  /// True for a local bubble that has no server id yet.
  bool get local => clientMessageId != null && id == clientMessageId;

  factory ZetroqMessage.fromJson(Map<String, dynamic> j) => ZetroqMessage(
        id: '${j['id'] ?? j['message_id'] ?? ''}',
        role: '${j['role'] ?? 'assistant'}',
        content: '${j['content'] ?? ''}',
        clientMessageId: (j['clientMessageId'] ?? j['client_message_id']) as String?,
      );
}

/// One page of GET /history.
class ZetroqHistoryPage {
  ZetroqHistoryPage(this.messages, {this.hasMore = false, this.cursor});
  final List<ZetroqMessage> messages;
  final bool hasMore;
  final String? cursor;
}

/// Result of POST /identify.
class ZetroqIdentity {
  ZetroqIdentity({required this.status, required this.linked, this.conversationId});
  final String status;
  final bool linked;
  final String? conversationId;
}

/// An uploaded attachment (POST /upload).
class ZetroqAttachment {
  ZetroqAttachment({required this.url, required this.name, required this.mimeType, required this.size});
  final String url;
  final String name;
  final String mimeType;
  final int size;
}

/// A file to upload: either [bytes] or a local [path] (not on Flutter web).
class ZetroqFile {
  ZetroqFile({required this.name, this.bytes, this.path, this.mimeType});
  final String name;
  final List<int>? bytes;
  final String? path;
  final String? mimeType;
}

class ZetroqApiException implements Exception {
  ZetroqApiException(this.message, this.status, [this.errors = const {}]);
  final String message;
  final int status;
  final Map<String, dynamic> errors;
  @override
  String toString() => 'ZetroqApiException($status): $message';
}

/// Parses complete `data: {...}` SSE frames out of a growing buffer.
/// Returns the events and the unfinished remainder.
(List<Map<String, dynamic>>, String) parseSse(String buffer) {
  final frames = buffer.replaceAll('\r\n', '\n').split('\n\n');
  final rest = frames.removeLast();
  final events = <Map<String, dynamic>>[];
  for (final frame in frames) {
    final data = frame
        .split('\n')
        .where((l) => l.startsWith('data:'))
        .map((l) => l.substring(5).trim())
        .join('\n');
    if (data.isEmpty) continue;
    try {
      final decoded = jsonDecode(data);
      if (decoded is Map<String, dynamic>) events.add(decoded);
    } catch (_) {/* keep-alive / non-JSON frame */}
  }
  return (events, rest);
}

/// Thin client for the ZetroQ public chat API (`/public/bots/{token}/...`,
/// see planning/v2/chat-omni/public-chat-api.md).
class ZetroqClient {
  ZetroqClient({required this.botToken, String? apiBase, this.appDomain, http.Client? httpClient})
      : base = (apiBase ?? 'https://api.zetroq.com/api/v1').replaceAll(RegExp(r'/+$'), ''),
        _http = httpClient ?? http.Client();

  final String botToken;
  final String base;
  final String? appDomain;
  final http.Client _http;

  Uri _uri(String path, [Map<String, String>? query]) => Uri.parse('$base/public/bots/${Uri.encodeComponent(botToken)}$path')
      .replace(queryParameters: query == null || query.isEmpty ? null : query);

  Map<String, String> headers([String? visitorId, bool json = true]) => {
        'Accept': 'application/json',
        if (json) 'Content-Type': 'application/json',
        if (visitorId != null && visitorId.isNotEmpty) 'X-Visitor-Id': visitorId,
        if (appDomain != null) 'X-Embed-Domain': appDomain!,
      };

  Future<Map<String, dynamic>> _call(String method, String path, Map<String, dynamic>? body,
      {String? visitorId, Map<String, String>? query, Map<String, String> extra = const {}}) async {
    final req = http.Request(method, _uri(path, query))..headers.addAll({...headers(visitorId, body != null), ...extra});
    if (body != null) req.body = jsonEncode(body..removeWhere((_, v) => v == null));
    return _decode(await http.Response.fromStream(await _http.send(req)));
  }

  Map<String, dynamic> _decode(http.Response res) {
    Map<String, dynamic> json = {};
    try {
      final decoded = res.body.isEmpty ? null : jsonDecode(res.body);
      if (decoded is Map<String, dynamic>) json = decoded;
    } catch (_) {/* non-JSON error page */}
    if (res.statusCode >= 400) {
      throw ZetroqApiException('${json['message'] ?? 'HTTP ${res.statusCode}'}', res.statusCode,
          (json['errors'] as Map<String, dynamic>?) ?? const {});
    }
    final data = json['data'];
    return data is Map<String, dynamic> ? data : json;
  }

  Future<Map<String, dynamic>> start({String? visitorId, String? conversationId, String? identityToken}) => _call(
        'POST',
        '/start',
        {'visitorId': visitorId, 'conversationId': conversationId, 'identityToken': identityToken, 'consentGiven': true},
        visitorId: visitorId,
      );

  Future<Map<String, dynamic>> send({
    required String visitorId,
    required String conversationId,
    required String content,
    required String clientMessageId,
    String? identityToken,
  }) =>
      _call('POST', '/message', {
        'visitorId': visitorId,
        'conversationId': conversationId,
        'content': content,
        'clientMessageId': clientMessageId,
        'identityToken': identityToken,
      }, visitorId: visitorId);

  /// GET /history — the visitor's own conversation only. [after] = newer than
  /// that message id (polling), [before] = the page before it. A conversation
  /// with no row yet (nothing sent) is an empty page.
  Future<ZetroqHistoryPage> history({
    required String visitorId,
    required String conversationId,
    String? after,
    String? before,
    int? limit,
    String? identityToken,
  }) async {
    try {
      final data = await _call('GET', '/history', null,
          visitorId: visitorId,
          query: {
            'conversationId': conversationId,
            'visitorId': visitorId,
            if (after != null) 'after': after,
            if (before != null) 'before': before,
            if (limit != null) 'limit': '$limit',
          },
          // The token travels in a header: query strings end up in access logs.
          extra: {if (identityToken != null) 'X-Identity-Token': identityToken});
      final list = ((data['messages'] as List?) ?? const []).whereType<Map<String, dynamic>>();
      return ZetroqHistoryPage(list.map(ZetroqMessage.fromJson).toList(),
          hasMore: data['hasMore'] == true, cursor: data['cursor'] as String?);
    } on ZetroqApiException catch (e) {
      if (e.status == 404) return ZetroqHistoryPage(const []);
      rethrow;
    }
  }

  /// POST /identify — verifies a signed identity token now. Unsigned hints never link anyone.
  Future<ZetroqIdentity> identify({
    required String visitorId,
    String? conversationId,
    String? identityToken,
    String? name,
    String? email,
    String? phone,
  }) async {
    final data = await _call('POST', '/identify', {
      'visitorId': visitorId,
      'conversationId': conversationId,
      'identityToken': identityToken,
      'name': name,
      'email': email,
      'phone': phone,
    }, visitorId: visitorId);
    return ZetroqIdentity(
      status: '${data['status'] ?? 'unsigned'}',
      linked: data['linked'] == true,
      conversationId: data['conversationId'] as String?,
    );
  }

  /// POST /upload (multipart). Size / type limits are the bot server's (422 otherwise).
  Future<ZetroqAttachment> upload({required String visitorId, String? conversationId, required ZetroqFile file}) async {
    final req = http.MultipartRequest('POST', _uri('/upload'))
      ..headers.addAll(headers(visitorId, false))
      ..fields['visitorId'] = visitorId;
    if (conversationId != null) req.fields['conversationId'] = conversationId;
    if (file.bytes != null) {
      req.files.add(http.MultipartFile.fromBytes('file', file.bytes!, filename: file.name));
    } else if (file.path != null) {
      req.files.add(await http.MultipartFile.fromPath('file', file.path!, filename: file.name));
    } else {
      throw ArgumentError('ZetroqFile needs bytes or a path');
    }
    final data = _decode(await http.Response.fromStream(await _http.send(req)));
    return ZetroqAttachment(
      url: '${data['url'] ?? ''}',
      name: '${data['name'] ?? file.name}',
      mimeType: '${data['mimeType'] ?? file.mimeType ?? ''}',
      size: (data['size'] as num?)?.toInt() ?? 0,
    );
  }

  /// Opens GET /stream (SSE) and yields each JSON event until the server closes it.
  Stream<Map<String, dynamic>> stream({required String conversationId, required String visitorId}) async* {
    final req = http.Request('GET', _uri('/stream', {'conversationId': conversationId, 'visitorId': visitorId}))
      ..headers.addAll({...headers(visitorId, false), 'Accept': 'text/event-stream'});
    final res = await _http.send(req);
    if (res.statusCode >= 400) throw ZetroqApiException('stream HTTP ${res.statusCode}', res.statusCode);
    var buffer = '';
    await for (final chunk in res.stream.transform(utf8.decoder)) {
      buffer += chunk;
      final (events, rest) = parseSse(buffer);
      buffer = rest;
      for (final e in events) {
        yield e;
      }
    }
  }

  /// [visitorId] is required with a [conversationId]: the server only binds a
  /// token to the caller's own conversation.
  Future<void> registerPushToken(String token, String platform, {String? conversationId, String? visitorId}) => _call(
        'POST',
        '/push-tokens',
        {'token': token, 'platform': platform, 'conversationId': conversationId, 'visitorId': visitorId},
        visitorId: visitorId,
      );

  Future<void> unregisterPushToken(String token) => _call('DELETE', '/push-tokens', {'token': token});

  static String newClientMessageId() {
    final r = Random.secure();
    String hex(int n) => List.generate(n, (_) => r.nextInt(16).toRadixString(16)).join();
    return '${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}';
  }
}
