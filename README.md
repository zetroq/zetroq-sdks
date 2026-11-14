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
import { ZetroqChatView } from '@zetroq/chat-react-native';

export function SupportScreen() {
  return (
    <ZetroqChatView
      botToken="YOUR_WIDGET_TOKEN"
      host="https://api.zetroq.com"
      visitorName="Jane Doe"
      visitorEmail="jane@example.com"
    />
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

void openChat(BuildContext context) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (context) => const ZetroqChatScreen(
        botToken: 'YOUR_WIDGET_TOKEN',
        host: 'https://api.zetroq.com',
      ),
    ),
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

Pass the `identityToken` into `identify(token)` across any of the SDKs.

---

## Push Notifications (FCM & APNs)

When customers are away from the chat screen, live human agent responses can be delivered via push notification:
1. Setup Firebase Cloud Messaging (FCM) credentials in your ZetroQ organization console.
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
