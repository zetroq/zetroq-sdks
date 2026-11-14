import { useEffect, useMemo } from 'react';
import { ZetroqChat, type ZetroqInitOptions } from './index.js';

/** React hook: loads the widget once and returns the SDK controls. */
export function useZetroqChat(options: ZetroqInitOptions | null): typeof ZetroqChat {
  const token = options?.botToken;
  const host = options?.host;
  const identityToken = options?.identityToken;

  useEffect(() => {
    if (!options) return;
    ZetroqChat.init(options);
    return () => ZetroqChat.shutdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, host]);

  useEffect(() => {
    if (identityToken) ZetroqChat.identify(identityToken);
  }, [identityToken]);

  return useMemo(() => ZetroqChat, []);
}

export type { ZetroqInitOptions };
