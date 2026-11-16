import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import React, { useEffect } from 'react';
import { SafeAreaView } from 'react-native';
import { ChatScreen, ZetroqChatProvider, handleNotificationTap, useZetroqChat } from '@zetroq/chat-react-native';

const BOT_TOKEN = 'YOUR_WIDGET_TOKEN'; // Bot -> Install in the ZetroQ panel

function Chat() {
  const { registerPushToken, open, state } = useZetroqChat();

  useEffect(() => {
    if (!state.conversationId) return;
    Notifications.requestPermissionsAsync()
      .then(() => Notifications.getDevicePushTokenAsync()) // FCM token on Android, APNs via FCM on iOS
      .then((t) => registerPushToken(String(t.data)))
      .catch(() => undefined);
  }, [state.conversationId]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      void handleNotificationTap(r.notification.request.content.data as Record<string, unknown>, open);
    });
    return () => sub.remove();
  }, [open]);

  // Picked files are uploaded to ZetroQ (POST /upload); pass uploadAttachment to use your own storage.
  return (
    <ChatScreen
      pickAttachment={async () => {
        const r = await DocumentPicker.getDocumentAsync();
        const f = r.assets?.[0];
        return f ? { uri: f.uri, name: f.name, mimeType: f.mimeType ?? 'application/octet-stream' } : null;
      }}
    />
  );
}

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ZetroqChatProvider botToken={BOT_TOKEN} storage={AsyncStorage} appDomain="app.example.com">
        <Chat />
      </ZetroqChatProvider>
    </SafeAreaView>
  );
}
