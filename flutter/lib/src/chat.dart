import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'client.dart';

/// Key-value persistence for the visitor id, conversation id and the offline
/// queue. [SharedPreferencesStore] is the default; tests can pass [MemoryStore].
abstract class ZetroqStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

class SharedPreferencesStore implements ZetroqStore {
  Future<SharedPreferences>? _prefs;
  Future<SharedPreferences> get _p => _prefs ??= SharedPreferences.getInstance();

  @override
  Future<String?> read(String key) async => (await _p).getString(key);

  @override
  Future<void> write(String key, String value) async {
    await (await _p).setString(key, value);
  }
}

class MemoryStore implements ZetroqStore {
  final Map<String, String> data = {};
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

class _Queued {
  _Queued(this.clientMessageId, this.conversationId, this.content);
  final String clientMessageId;
  final String conversationId;
  final String content;

  Map<String, String> toJson() => {'clientMessageId': clientMessageId, 'conversationId': conversationId, 'content': content};

  static _Queued? fromJson(Object? j) {
    if (j is! Map) return null;
    final cid = j['clientMessageId'], conv = j['conversationId'], content = j['content'];
    if (cid is! String || conv is! String || content is! String) return null;
    return _Queued(cid, conv, content);
  }
}

/// Chat session: start / resume, idempotent send with clientMessageId, an
/// offline queue persisted in shared_preferences (resent with the SAME id after
/// a restart), live replies over SSE (GET /stream) with GET /history polling
/// every 5 s whenever the stream is down.
class ZetroqChat extends ChangeNotifier {
  ZetroqChat({
    required String botToken,
    String? apiBase,
    String? appDomain,
    ZetroqClient? client,
    ZetroqStore? store,
    this.useStream = true,
    this.pollInterval = const Duration(seconds: 5),
  })  : client = client ?? ZetroqClient(botToken: botToken, apiBase: apiBase, appDomain: appDomain),
        _store = store ?? SharedPreferencesStore(),
        _key = 'zetroq:$botToken';

  final ZetroqClient client;
  final bool useStream;
  final Duration pollInterval;
  final ZetroqStore _store;
  final String _key;
  final List<ZetroqMessage> messages = [];
  final List<_Queued> _queue = [];
  List<String> quickReplies = [];
  String? conversationId;
  String visitorId = '';
  String? error;
  bool ready = false;
  String? _identityToken;
  Map<String, dynamic> settings = {};
  Timer? _poll;
  StreamSubscription<Map<String, dynamic>>? _sse;
  bool _queueLoaded = false;
  bool _disposed = false;

  /// True while the SSE stream is connected (polling is off).
  bool get streaming => _sse != null;

  /// Messages waiting to be (re)sent.
  int get pending => _queue.length;

  /// Signed identity token from your server (see README). Before [start] it is
  /// sent on /start; once open it is verified at once with POST /identify.
  Future<ZetroqIdentity?> identify(String token, {String? name, String? email, String? phone}) async {
    _identityToken = token;
    if (!ready) return null;
    return client.identify(
      visitorId: visitorId,
      conversationId: conversationId,
      identityToken: token,
      name: name,
      email: email,
      phone: phone,
    );
  }

  Future<void> start({String? conversationId}) async {
    try {
      await _loadQueue();
      if (visitorId.isEmpty) visitorId = await _store.read('$_key:visitor') ?? ZetroqClient.newClientMessageId();
      final saved = conversationId ?? this.conversationId ?? await _store.read('$_key:conversation');
      final data = await client.start(visitorId: visitorId, conversationId: saved, identityToken: _identityToken);
      this.conversationId = '${data['conversationId'] ?? data['conversation_id'] ?? ''}';
      visitorId = '${data['visitorId'] ?? data['visitor_id'] ?? visitorId}';
      await _store.write('$_key:visitor', visitorId);
      await _store.write('$_key:conversation', this.conversationId!);
      settings = (data['settings'] as Map<String, dynamic>?) ?? (data['bot'] as Map<String, dynamic>?) ?? {};
      _merge((data['history'] as List?) ?? (data['messages'] as List?) ?? const []);
      ready = true;
      error = null;
      _notify();
      _connect();
      await flush();
    } catch (e) {
      error = 'Could not start chat';
      _notify();
    }
  }

  /// Opens a conversation, e.g. from a push tap (see [ZetroqPush.parse]).
  Future<void> open(String id) {
    _disconnect();
    messages.clear();
    return start(conversationId: id);
  }

  Future<void> send(String text) async {
    final value = text.trim();
    final id = conversationId;
    if (value.isEmpty || id == null) return;
    final cid = ZetroqClient.newClientMessageId();
    messages.add(ZetroqMessage(id: cid, clientMessageId: cid, role: 'user', content: value, status: 'sending'));
    quickReplies = [];
    _queue.add(_Queued(cid, id, value));
    await _saveQueue();
    _notify();
    await flush();
  }

  /// Uploads [file] with POST /upload and sends its link as a message.
  Future<void> sendAttachment(ZetroqFile file) async {
    final a = await client.upload(visitorId: visitorId, conversationId: conversationId, file: file);
    await send('${a.name}: ${a.url}');
  }

  /// Resends queued messages; the server dedupes on clientMessageId.
  Future<void> flush() async {
    await _loadQueue();
    while (_queue.isNotEmpty) {
      final item = _queue.first;
      try {
        final data = await client.send(
          visitorId: visitorId,
          conversationId: item.conversationId,
          content: item.content,
          clientMessageId: item.clientMessageId,
          identityToken: _identityToken,
        );
        _queue.removeAt(0);
        await _saveQueue();
        final mine = data['userMessage'];
        _status(item.clientMessageId, 'sent', mine is Map<String, dynamic> ? '${mine['id'] ?? ''}' : null);
        final reply = data['reply'] ?? data['message'];
        if (reply is Map<String, dynamic>) _merge([reply]);
        quickReplies = ((data['quickReplies'] as List?) ?? const []).map((e) => '$e').toList();
        _notify();
      } catch (_) {
        _status(item.clientMessageId, 'queued');
        _notify();
        return;
      }
    }
  }

  Future<void> registerPushToken(String token) {
    final platform = kIsWeb
        ? 'web'
        : (defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android');
    return client.registerPushToken(token, platform, conversationId: conversationId, visitorId: visitorId.isEmpty ? null : visitorId);
  }

  /// One poll: GET /history?after=<newest server id>, then resend the queue.
  Future<void> refresh() async {
    final id = conversationId;
    if (id == null) return;
    try {
      final page = await client.history(
        visitorId: visitorId,
        conversationId: id,
        after: _lastServerId(),
        identityToken: _identityToken,
      );
      if (_merge(page.messages)) _notify();
      await flush();
    } catch (_) {/* offline */}
  }

  // ── live updates ────────────────────────────────────────────────────

  void _connect() {
    final id = conversationId;
    if (id == null || _sse != null || _disposed) return;
    if (!useStream) {
      _startPolling();
      return;
    }
    _sse = client.stream(conversationId: id, visitorId: visitorId).listen(
      (event) {
        _stopPolling();
        final msg = event['message'] ?? (event['type'] == 'message' ? event : null);
        if (msg is Map<String, dynamic> && msg['content'] != null && _merge([msg])) _notify();
      },
      onError: (_) {
        _sse = null;
        _startPolling();
      },
      onDone: () {
        // The server closes the stream after ~55 s: poll meanwhile, reconnect shortly.
        _sse = null;
        _startPolling();
        Timer(const Duration(seconds: 2), () {
          if (!_disposed && conversationId == id) _connect();
        });
      },
      cancelOnError: true,
    );
  }

  void _startPolling() {
    if (_disposed) return;
    _poll ??= Timer.periodic(pollInterval, (_) => refresh());
  }

  void _stopPolling() {
    _poll?.cancel();
    _poll = null;
  }

  void _disconnect() {
    _sse?.cancel();
    _sse = null;
    _stopPolling();
  }

  // ── state helpers ───────────────────────────────────────────────────

  String? _lastServerId() {
    for (final m in messages.reversed) {
      if (m.id.isNotEmpty && !m.local) return m.id;
    }
    return null;
  }

  bool _merge(List<dynamic> raw) {
    var changed = false;
    for (final r in raw) {
      final m = r is ZetroqMessage ? r : (r is Map<String, dynamic> ? ZetroqMessage.fromJson(r) : null);
      if (m == null) continue;
      final dup = messages.any((x) =>
          (m.id.isNotEmpty && x.id == m.id) || (m.clientMessageId != null && x.clientMessageId == m.clientMessageId));
      if (!dup) {
        messages.add(m);
        changed = true;
      }
    }
    return changed;
  }

  void _status(String cid, String status, [String? serverId]) {
    for (final m in messages) {
      if (m.clientMessageId == cid) {
        m.status = status;
        if (serverId != null && serverId.isNotEmpty) m.id = serverId;
      }
    }
  }

  Future<void> _loadQueue() async {
    if (_queueLoaded) return;
    _queueLoaded = true;
    try {
      final raw = await _store.read('$_key:queue');
      final list = raw == null ? const [] : (jsonDecode(raw) as List);
      for (final item in list.map(_Queued.fromJson).whereType<_Queued>()) {
        if (_queue.any((q) => q.clientMessageId == item.clientMessageId)) continue;
        _queue.add(item);
        messages.add(ZetroqMessage(
            id: item.clientMessageId, clientMessageId: item.clientMessageId, role: 'user', content: item.content, status: 'queued'));
      }
    } catch (_) {/* corrupt entry: start empty */}
  }

  Future<void> _saveQueue() => _store.write('$_key:queue', jsonEncode(_queue.map((q) => q.toJson()).toList()));

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _disconnect();
    super.dispose();
  }
}
