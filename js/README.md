# @zetroq/chat

JavaScript and React SDK for the ZetroQ Chatbot platform. Loads the ZetroQ chat widget into any web application and provides a lightweight programmatic API.

## Installation

```bash
npm install @zetroq/chat
# or
pnpm add @zetroq/chat
# or
yarn add @zetroq/chat
```

## Quick Start (Vanilla JS / TypeScript)

```ts
import ZetroqChat from '@zetroq/chat';

// Initialize the chat widget
ZetroqChat.init({
  botToken: '<YOUR_WIDGET_TOKEN>',
  host: 'https://api.zetroq.com',
  theme: 'auto', // 'light' | 'dark' | 'auto'
  identityToken: '<OPTIONAL_SIGNED_IDENTITY_TOKEN>',
});

// Event listeners
ZetroqChat.on('ready', () => console.log('ZetroQ Chat is ready'));
ZetroqChat.on('open', () => console.log('Chat opened'));
ZetroqChat.on('close', () => console.log('Chat closed'));

// Controls
ZetroqChat.open();
ZetroqChat.close();
ZetroqChat.toggle();

// Context passing (cart, subscription tier, page data)
ZetroqChat.setContext({
  plan: 'pro',
  accountTier: 'enterprise',
  cartTotal: 1499,
});

// Identify user dynamically (after login)
ZetroqChat.identify(signedIdentityToken);

// Destroy widget (e.g. on user logout)
ZetroqChat.shutdown();
```

## React Hook

```tsx
import React from 'react';
import { useZetroqChat } from '@zetroq/chat/react';

export function ChatButton() {
  const chat = useZetroqChat({
    botToken: 'YOUR_WIDGET_TOKEN',
    host: 'https://api.zetroq.com',
  });

  return (
    <button onClick={() => chat.toggle()} className="chat-btn">
      Need help? Chat with us
    </button>
  );
}
```

## Identity Verification

To prevent impersonation, sign an HMAC identity token on your backend using your bot's secret key:

```js
const crypto = require('crypto');
const payload = Buffer.from(JSON.stringify({
  user_id: user.id,
  name: user.name,
  email: user.email,
  exp: Math.floor(Date.now() / 1000) + 3600
})).toString('base64url');

const signature = crypto.createHmac('sha256', process.env.ZETROQ_BOT_SECRET)
  .update(payload)
  .digest('hex');

const identityToken = `${payload}.${signature}`;
```

Pass this `identityToken` to `ZetroqChat.init()` or `ZetroqChat.identify()`.

## License

MIT © ZetroQ
