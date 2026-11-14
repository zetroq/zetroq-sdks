/// ZetroQ push payload: { type: zetroq_chat_message, conversation_id, message_id, bot_id }.
class ZetroqPush {
  ZetroqPush(this.conversationId, this.messageId, this.botId);
  final String conversationId;
  final String messageId;
  final String botId;

  /// Returns null for notifications that are not ZetroQ chat messages.
  static ZetroqPush? parse(Map<String, dynamic>? data) {
    if (data == null || data['type'] != 'zetroq_chat_message' || data['conversation_id'] is! String) {
      return null;
    }
    return ZetroqPush(data['conversation_id'] as String, '${data['message_id'] ?? ''}', '${data['bot_id'] ?? ''}');
  }
}
