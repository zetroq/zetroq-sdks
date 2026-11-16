# ZetroQ Official Client SDKs

Official client libraries and SDKs for embedding ZetroQ conversational AI and customer chat into Web, React Native, and Flutter applications.

Repository: [https://github.com/zetroq/zetroq-sdks.git](https://github.com/zetroq/zetroq-sdks.git)

---

## SDK Packages in this Repository

| Directory | Package Name | Registry | Platform |
|---|---|---|---|
| [`/js`](./js) | [`@zetroq/chat`](https://www.npmjs.com/package/@zetroq/chat) | npm | Vanilla JavaScript, TypeScript, React, Next.js |
| [`/react-native`](./react-native) | [`@zetroq/chat-react-native`](https://www.npmjs.com/package/@zetroq/chat-react-native) | npm | React Native, Expo (iOS & Android) |
| [`/flutter`](./flutter) | [`zetroq_chat`](https://pub.dev/packages/zetroq_chat) | pub.dev | Flutter (iOS & Android) |

---

## 1. Web & React SDK (`@zetroq/chat`)

Install via npm:
```bash
npm install @zetroq/chat
```

Usage:
```ts
import ZetroqChat from '@zetroq/chat';

ZetroqChat.init({
  botToken: 'YOUR_WIDGET_TOKEN',
  host: 'https://api.zetroq.com',
  theme: 'auto'
});

ZetroqChat.open();
```

React Hook:
```tsx
import { useZetroqChat } from '@zetroq/chat/react';

export function ChatButton() {
  const chat = useZetroqChat({ botToken: 'YOUR_WIDGET_TOKEN', host: 'https://api.zetroq.com' });
  return <button onClick={() => chat.toggle()}>Chat with Us</button>;
}
```

---

## 2. React Native & Expo SDK (`@zetroq/chat-react-native`)

Install via npm:
```bash
npm install @zetroq/chat-react-native
```

Usage:
```tsx
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ZetroqChatProvider, ChatScreen } from '@zetroq/chat-react-native';

export function SupportScreen() {
  return (
    <ZetroqChatProvider botToken="YOUR_WIDGET_TOKEN" storage={AsyncStorage} appDomain="app.example.com">
      <ChatScreen pickAttachment={myPicker} />
    </ZetroqChatProvider>
  );
}
```

---

## 3. Flutter SDK (`zetroq_chat`)

Add to `pubspec.yaml`:
```yaml
dependencies:
  zetroq_chat: ^0.1.0
```

Usage:
```dart
import 'package:flutter/material.dart';
import 'package:zetroq_chat/zetroq_chat.dart';

final chat = ZetroqChat(botToken: 'YOUR_WIDGET_TOKEN', appDomain: 'app.example.com');

void openChat(BuildContext context) {
  Navigator.of(context).push(
    MaterialPageRoute(builder: (context) => Scaffold(body: ZetroqChatScreen(chat: chat))),
  );
}
```

---

## Secure User Identity (Verification)

To securely associate conversations with existing logged-in users and prevent impersonation, generate an HMAC-SHA256 signature on your backend server using your bot's identity secret:

```javascript
// Server-side (Node.js example)
const crypto = require('crypto');

const payload = Buffer.from(JSON.stringify({
  user_id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour expiration
})).toString('base64url');

const signature = crypto
  .createHmac('sha256', process.env.ZETROQ_BOT_IDENTITY_SECRET)
  .update(payload)
  .digest('hex');

const identityToken = `${payload}.${signature}`;
```

Pass the `identityToken` into `identify(token)` across any of the SDKs. Once the chat is open the SDKs verify it at
once with `POST /identify`; only a verified token links the person (unsigned name / email / phone are hints only).

## Public chat API used by the SDKs

All SDKs use `{API}/api/v1/public/bots/{widgetToken}/…`: `start`, `message` (with `clientMessageId`), `history`,
`upload`, `identify`, `stream` (SSE) and `push-tokens`. There is no hosted chat page. Full reference:
`planning/v2/chat-omni/public-chat-api.md` in the main repo.

---

## Push Notifications (FCM & APNs)

Agent replies, and bot replies sent while the visitor has had no chat open for `CHAT_PUSH_AWAY_MINUTES` (default 5),
are delivered by push notification:
1. ZetroQ owner: set `CHAT_PUSH_ENABLED`, `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_PATH` on the server (Firebase project with the iOS and Android apps, APNs key uploaded).
2. In your mobile app, obtain the device push token and register it:
   - React Native: `ZetroqChat.registerPushToken(fcmToken)`
   - Flutter: `ZetroqChat.registerPushToken(fcmToken)`
3. Handle notification tap events to automatically navigate directly into the active conversation thread.

---

## Publishing & Release Instructions

### 1. JavaScript & React SDK
```bash
cd js
npm run build
npm publish --access public
```

### 2. React Native SDK
```bash
cd react-native
npm run build
npm publish --access public
```

### 3. Flutter SDK
```bash
cd flutter
dart pub publish --dry-run
dart pub publish
```

---

## License

MIT © [ZetroQ](https://zetroq.com)
