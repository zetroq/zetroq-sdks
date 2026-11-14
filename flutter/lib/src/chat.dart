import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

import 'client.dart';

class _Queued {
  _Queued(this.clientMessageId, this.conversationId, this.content);
  final String clientMessageId;
  final String conversationId;
  final String content;
}

/// Chat session: start / resume, idempotent send with clientMessageId, an
/// offline queue that resends with the same id, and polling for new replies.
/// (Live SSE is used by the web widget; the Flutter SDK polls every 5 s while open.)
class ZetroqChat extends ChangeNotifier {
  ZetroqChat({required String botToken, String? apiBase, String? appDomain, ZetroqClient? client})
      : client = client ?? ZetroqClient(botToken: botToken, apiBase: apiBase, appDomain: appDomain);

  final ZetroqClient client;
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

  /// Signed identity token from your server (see README).
  Future<void> identify(String token) async {
    _identityToken = token;
    if (ready) await start(conversationId: conversationId);
  }

  Future<void> start({String? conversationId}) async {
    try {
      final data = await client.start(
        visitorId: visitorId.isEmpty ? null : visitorId,
        conversationId: conversationId ?? this.conversationId,
        identityToken: _identityToken,
      );
      this.conversationId = '${data['conversationId'] ?? data['conversation_id'] ?? ''}';
      visitorId = '${data['visitorId'] ?? data['visitor_id'] ?? visitorId}';
      settings = (data['settings'] as Map<String, dynamic>?) ?? {};
      _merge((data['messages'] as List?) ?? const []);
      ready = true;
      error = null;
      notifyListeners();
      _poll ??= Timer.periodic(const Duration(seconds: 5), (_) => _refresh());
      await flush();
    } catch (e) {
      error = 'Could not start chat';
      notifyListeners();
    }
  }

  /// Opens a conversation, e.g. from a push tap (see [ZetroqPush.parse]).
  Future<void> open(String id) {
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
    notifyListeners();
    await flush();
  }

  /// Resends queued messages; the server dedupes on clientMessageId.
  Future<void> flush() async {
    while (_queue.isNotEmpty) {
      final item = _queue.first;
      try {
        final data = await client.send(
          visitorId: visitorId,
          conversationId: item.conversationId,
          content: item.content,
          clientMessageId: item.clientMessageId,
        );
        _queue.removeAt(0);
        _status(item.clientMessageId, 'sent');
        final reply = data['reply'] ?? data['message'];
        if (reply is Map<String, dynamic>) _merge([reply]);
        quickReplies = ((data['quickReplies'] as List?) ?? const []).map((e) => '$e').toList();
        notifyListeners();
      } catch (_) {
        _status(item.clientMessageId, 'queued');
        notifyListeners();
        return;
      }
    }
  }

  Future<void> registerPushToken(String token) {
    final platform = kIsWeb ? 'web' : (Platform.isIOS ? 'ios' : 'android');
    return client.registerPushToken(token, platform, conversationId: conversationId);
  }

  Future<void> _refresh() async {
    final id = conversationId;
    if (id == null) return;
    try {
      final data = await client.start(visitorId: visitorId, conversationId: id, identityToken: _identityToken);
      if (_merge((data['messages'] as List?) ?? const [])) notifyListeners();
      await flush();
    } catch (_) {/* offline */}
  }

  bool _merge(List<dynamic> raw) {
    var changed = false;
    for (final r in raw.whereType<Map<String, dynamic>>()) {
      final m = ZetroqMessage.fromJson(r);
      final dup = messages.any((x) => (m.id.isNotEmpty && x.id == m.id) ||
          (m.clientMessageId != null && x.clientMessageId == m.clientMessageId));
      if (!dup) {
        messages.add(m);
        changed = true;
      }
    }
    return changed;
  }

  void _status(String cid, String status) {
    for (final m in messages) {
      if (m.clientMessageId == cid) m.status = status;
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }
}
