import * as React from 'react';
import { Platform } from 'react-native';
import { ChatSession, type SessionState } from './session';
import type { PickedFile, ZetroqConfig } from './types';

interface ChatContextValue {
  session: ChatSession;
  state: SessionState;
}

const ChatContext = React.createContext<ChatContextValue | null>(null);

export function ZetroqChatProvider(props: ZetroqConfig & { children?: React.ReactNode; identityToken?: string }): React.ReactElement {
  const { children, identityToken, ...config } = props;
  const sessionRef = React.useRef<ChatSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new ChatSession(config);
  const session = sessionRef.current;
  const [state, setState] = React.useState<SessionState>(session.getState());

  React.useEffect(() => session.subscribe(setState), [session]);
  React.useEffect(() => {
    const run = async (): Promise<void> => {
      if (identityToken) await session.identify(identityToken);
      await session.start();
    };
    void run();
    return () => session.disconnect();
  }, [session, identityToken]);

  return React.createElement(ChatContext.Provider, { value: { session, state } }, children);
}

export function useZetroqChat(): ChatContextValue & {
  send: (text: string) => Promise<void>;
  open: (conversationId: string) => Promise<void>;
  identify: (token: string) => Promise<unknown>;
  sendAttachment: (file: PickedFile) => Promise<void>;
  registerPushToken: (token: string) => Promise<void>;
} {
  const ctx = React.useContext(ChatContext);
  if (!ctx) throw new Error('useZetroqChat must be used inside <ZetroqChatProvider>');
  const { session, state } = ctx;
  return {
    session,
    state,
    send: (text) => session.send(text),
    open: (id) => session.open(id),
    identify: (token) => session.identify(token),
    sendAttachment: (file) => session.sendAttachment(file),
    registerPushToken: async (token) => {
      const os = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
      await session.registerPushToken(token, os);
    },
  };
}
