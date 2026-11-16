# zetroq_chat

```sh
flutter pub add zetroq_chat
```
```dart
final chat = ZetroqChat(botToken: 'YOUR_WIDGET_TOKEN', appDomain: 'app.example.com');
await chat.identify(tokenFromYourServer); // optional, logged-in users (POST /identify once open)
ZetroqChatScreen(chat: chat, onPickFile: pickFileReturningZetroqFile); // uploaded via POST /upload
```
- Idempotent sends (`clientMessageId`); the offline queue is persisted with `shared_preferences` and resent with
  the same id after a restart, so nothing is stored twice.
- Live replies over SSE (`GET /stream`); while the stream is down it polls `GET /history?after=<newest id>` every 5 s.
- Attachments: `chat.sendAttachment(ZetroqFile(name:, bytes: | path:))` uploads and sends the link; `onAttach`
  (your own picker + upload returning a link) still works.
- Tests: `flutter test`.
- Push: `chat.registerPushToken(await FirebaseMessaging.instance.getToken())`; on tap
  `ZetroqPush.parse(message.data)` then `chat.open(push.conversationId)`.

Example app: `example/`. Identity token and push owner steps: `../README.md`.
