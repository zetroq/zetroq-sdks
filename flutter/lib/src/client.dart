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

  final String id;
  final String role;
  final String content;
  final String? clientMessageId;
  String status;

  bool get mine => role == 'user';

  factory ZetroqMessage.fromJson(Map<String, dynamic> j) => ZetroqMessage(
        id: '${j['id'] ?? j['message_id'] ?? ''}',
        role: '${j['role'] ?? 'assistant'}',
        content: '${j['content'] ?? ''}',
        clientMessageId: (j['clientMessageId'] ?? j['client_message_id']) as String?,
      );
}

class ZetroqApiException implements Exception {
  ZetroqApiException(this.message, this.status);
  final String message;
  final int status;
  @override
  String toString() => 'ZetroqApiException($status): $message';
}

/// Thin client for the ZetroQ public chat API (`/public/bots/{token}/...`).
class ZetroqClient {
  ZetroqClient({required this.botToken, String? apiBase, this.appDomain, http.Client? httpClient})
      : base = (apiBase ?? 'https://api.zetroq.com/api/v1').replaceAll(RegExp(r'/+$'), ''),
        _http = httpClient ?? http.Client();

  final String botToken;
  final String base;
  final String? appDomain;
  final http.Client _http;

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$base/public/bots/${Uri.encodeComponent(botToken)}$path').replace(queryParameters: query);

  Map<String, String> headers([String? visitorId]) => {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        if (visitorId != null && visitorId.isNotEmpty) 'X-Visitor-Id': visitorId,
        if (appDomain != null) 'X-Embed-Domain': appDomain!,
      };

  Future<Map<String, dynamic>> _call(String method, String path, Map<String, dynamic> body, [String? visitorId]) async {
    final req = http.Request(method, _uri(path))
      ..headers.addAll(headers(visitorId))
      ..body = jsonEncode(body);
    final res = await http.Response.fromStream(await _http.send(req));
    final json = res.body.isEmpty ? <String, dynamic>{} : (jsonDecode(res.body) as Map<String, dynamic>);
    if (res.statusCode >= 400) throw ZetroqApiException('${json['message'] ?? 'HTTP ${res.statusCode}'}', res.statusCode);
    return (json['data'] ?? json) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> start({String? visitorId, String? conversationId, String? identityToken}) => _call(
        'POST',
        '/start',
        {'visitorId': visitorId, 'conversationId': conversationId, 'identityToken': identityToken},
        visitorId,
      );

  Future<Map<String, dynamic>> send({
    required String visitorId,
    required String conversationId,
    required String content,
    required String clientMessageId,
  }) =>
      _call('POST', '/message', {
        'visitorId': visitorId,
        'conversationId': conversationId,
        'content': content,
        'clientMessageId': clientMessageId,
      }, visitorId);

  Future<void> registerPushToken(String token, String platform, {String? conversationId}) =>
      _call('POST', '/push-tokens', {'token': token, 'platform': platform, 'conversationId': conversationId});

  Future<void> unregisterPushToken(String token) => _call('DELETE', '/push-tokens', {'token': token});

  static String newClientMessageId() {
    final r = Random.secure();
    String hex(int n) => List.generate(n, (_) => r.nextInt(16).toRadixString(16)).join();
    return '${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}';
  }
}
