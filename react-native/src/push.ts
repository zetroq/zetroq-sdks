/**
 * Push helpers. The SDK does not depend on a push library: get the FCM token
 * with @react-native-firebase/messaging (or expo-notifications getDevicePushTokenAsync)
 * and hand it to `registerPushToken`. ZetroQ sends a data payload:
 *   { type: 'zetroq_chat_message', conversation_id, message_id, bot_id }
 */
export interface ZetroqPushData {
  conversationId: string;
  messageId: string;
  botId: string;
}

/** Returns the ZetroQ payload of a notification, or null for other notifications. */
export function parseZetroqPush(data: Record<string, unknown> | undefined | null): ZetroqPushData | null {
  if (!data || data.type !== 'zetroq_chat_message' || typeof data.conversation_id !== 'string') return null;
  return {
    conversationId: data.conversation_id,
    messageId: String(data.message_id ?? ''),
    botId: String(data.bot_id ?? ''),
  };
}

/**
 * Call from your notification-opened handler; opens the conversation when the
 * tap was a ZetroQ message. Returns true when it handled the tap.
 */
export async function handleNotificationTap(
  data: Record<string, unknown> | undefined | null,
  open: (conversationId: string) => Promise<void>,
): Promise<boolean> {
  const push = parseZetroqPush(data);
  if (!push) return false;
  await open(push.conversationId);
  return true;
}
