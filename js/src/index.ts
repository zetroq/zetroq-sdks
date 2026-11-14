/**
 * @zetroq/chat — loads the ZetroQ widget (/widget.js) and wraps its global
 * API (window.ZETROQ_WIDGET). Safe to call before the script has loaded:
 * calls are queued and replayed once the widget is ready.
 */

export type ZetroqEvent = 'ready' | 'open' | 'close' | 'message' | 'shutdown';

export interface ZetroqInitOptions {
  /** The bot's widget token (vendor panel → Chatbot → Install). */
  botToken: string;
  /** Backend origin that serves /widget.js, e.g. https://api.zetroq.com */
  host: string;
  /** Optional API base override (defaults to host + /api/v1). */
  apiBase?: string;
  theme?: 'light' | 'dark' | 'auto';
  /** Signed identity token (see public-chat-api.md "identify"). */
  identityToken?: string;
}

interface WidgetGlobal {
  setTheme?: (t: string) => void;
  destroy?: () => void;
  identify?: (t: string | null) => void;
  open?: () => void;
  close?: () => void;
  toggle?: () => void;
  setContext?: (c: Record<string, unknown>) => void;
  identityToken?: string | null;
}

declare global {
  interface Window {
    ZETROQ_WIDGET?: WidgetGlobal;
  }
}

type Listener = (payload?: unknown) => void;

const SCRIPT_ID = 'zetroq-chat-sdk-script';
const listeners = new Map<ZetroqEvent, Set<Listener>>();
let queue: Array<(w: WidgetGlobal) => void> = [];
let ready = false;
let isOpen = false;
let pendingContext: Record<string, unknown> = {};

function emit(event: ZetroqEvent, payload?: unknown): void {
  listeners.get(event)?.forEach((cb) => {
    try {
      cb(payload);
    } catch {
      /* a listener error must not break the widget */
    }
  });
}

function withWidget(fn: (w: WidgetGlobal) => void): void {
  const w = typeof window !== 'undefined' ? window.ZETROQ_WIDGET : undefined;
  if (ready && w) fn(w);
  else queue.push(fn);
}

function drainQueue(w: WidgetGlobal): void {
  const items = queue;
  queue = [];
  items.forEach((fn) => {
    try {
      fn(w);
    } catch {
      /* best-effort */
    }
  });
}

export const ZetroqChat = {
  /**
   * Inject /widget.js with the configured bot and wait for its ready event.
   * Safe to call multiple times with the same botToken (no-op after first).
   */
  init(options: ZetroqInitOptions): void {
    if (typeof window === 'undefined') return;

    if (options.identityToken) {
      this.identify(options.identityToken);
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.botToken === options.botToken) {
        if (ready && window.ZETROQ_WIDGET) drainQueue(window.ZETROQ_WIDGET);
        return;
      }
      this.shutdown();
    }

    const host = options.host.replace(/\/+$/, '');
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `${host}/widget.js`;
    script.dataset.botToken = options.botToken;
    script.dataset.host = host;
    if (options.apiBase) script.dataset.apiBase = options.apiBase;
    if (options.theme) script.dataset.theme = options.theme;
    if (options.identityToken) script.dataset.identityToken = options.identityToken;

    script.onload = () => {
      ready = true;
      const w = window.ZETROQ_WIDGET;
      if (w) {
        if (Object.keys(pendingContext).length > 0) {
          w.setContext?.(pendingContext);
          pendingContext = {};
        }
        drainQueue(w);
      }
      emit('ready');
    };

    script.onerror = () => {
      /* script load failed — listeners may catch shutdown or retry */
    };

    document.head.appendChild(script);
  },

  open(): void {
    isOpen = true;
    withWidget((w) => w.open?.());
    emit('open');
  },

  close(): void {
    isOpen = false;
    withWidget((w) => w.close?.());
    emit('close');
  },

  toggle(): void {
    isOpen = !isOpen;
    withWidget((w) => w.toggle?.());
    emit(isOpen ? 'open' : 'close');
  },

  /**
   * Pass custom contextual payload (e.g. current page, cart value, pricing tier)
   * to the bot to use in flows and prompt context.
   */
  setContext(context: Record<string, unknown>): void {
    pendingContext = { ...pendingContext, ...context };
    withWidget((w) => {
      w.setContext?.(pendingContext);
      pendingContext = {};
    });
  },

  /**
   * Pass a server-signed identity token to link the conversation with a Directory person.
   */
  identify(token: string | null): void {
    withWidget((w) => w.identify?.(token));
  },

  on(event: ZetroqEvent, listener: Listener): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
    return () => listeners.get(event)?.delete(listener);
  },

  shutdown(): void {
    if (typeof window === 'undefined') return;
    withWidget((w) => w.destroy?.());
    const el = document.getElementById(SCRIPT_ID);
    el?.remove();
    ready = false;
    isOpen = false;
    queue = [];
    pendingContext = {};
    emit('shutdown');
  },
};

export default ZetroqChat;
