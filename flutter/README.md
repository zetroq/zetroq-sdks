# zetroq_chat

```sh
flutter pub add zetroq_chat
```
```dart
final chat = ZetroqChat(botToken: 'YOUR_WIDGET_TOKEN', appDomain: 'app.example.com');
await chat.identify(tokenFromYourServer); // optional, logged-in users
ZetroqChatScreen(chat: chat, onAttach: pickAndUploadReturningLink);
```
- Idempotent sends (`clientMessageId`), offline queue resend, quick replies, polling for live replies.
- Push: `chat.registerPushToken(await FirebaseMessaging.instance.getToken())`; on tap
  `ZetroqPush.parse(message.data)` then `chat.open(push.conversationId)`.

Example app: `example/`. Identity token and push owner steps: `../README.md`.
