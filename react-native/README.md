# @zetroq/chat-react-native

```sh
npm install @zetroq/chat-react-native @react-native-async-storage/async-storage
```
```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ZetroqChatProvider, ChatScreen, useZetroqChat, handleNotificationTap } from '@zetroq/chat-react-native';

<ZetroqChatProvider botToken="YOUR_WIDGET_TOKEN" storage={AsyncStorage} appDomain="app.example.com" identityToken={tokenFromYourServer}>
  <ChatScreen pickAttachment={myPicker} uploadAttachment={myUpload} />
</ZetroqChatProvider>
```
- `botToken`: Bot -> Install in the ZetroQ panel. `appDomain` is sent as `X-Embed-Domain`; add it to the bot's allowed domains if you use an allowlist.
- Sends carry a `clientMessageId`; offline sends wait in a queue (persisted in `storage`) and resend with the same id, so nothing is stored twice.
- Live replies: SSE over XHR, falling back to 5 s polling.
- Theme: colours / font / RTL come from the bot's appearance settings.
- Push: `useZetroqChat().registerPushToken(fcmToken)`; on tap `handleNotificationTap(data, open)`.

Example Expo app: `example/`. Identity token and push owner steps: `../README.md`.
