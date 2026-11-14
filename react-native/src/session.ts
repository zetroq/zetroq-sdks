import { ZetroqClient, parseSse, toMessage } from './client';
import { OfflineQueue, makeClientMessageId } from './queue';
import type { ChatMessage, ChatTheme, ZetroqConfig } from './types';

export interface SessionState {
  ready: boolean;
  error: string | null;
  conversationId: string | null;
  messages: ChatMessage[];
  quickReplies: string[];
  theme: ChatTheme;
}

export const DEFAULT_THEME: ChatTheme = {
  primaryColor: '#4f46e5',
  backgroundColor: '#ffffff',
  textColor: '#111827',
  bubbleUser: '#4f46e5',
  bubbleBot: '#f3f4f6',
};

/** Reads colours / font / RTL from the bot's appearance settings. */
export function themeFromSettings(settings: Record<string, unknown>): ChatTheme {
  const appearance = (settings.appearance ?? settings) as Record<string, unknown>;
  const pick = (k: string): string | undefined => (typeof appearance[k] === 'string' ? (appearance[k] as string) : undefined);
  const primary = pick('primaryColor') ?? pick('primary_color') ?? DEFAULT_THEME.primaryColor;
  return {
    primaryColor: primary,
    backgroundColor: pick('backgroundColor') ?? DEFAULT_THEME.backgroundColor,
    textColor: pick('textColor') ?? DEFAULT_THEME.textColor,
    bubbleUser: pick('userBubbleColor') ?? primary,
    bubbleBot: pick('botBubbleColor') ?? DEFAULT_THEME.bubbleBot,
    fontFamily: pick('fontFamily'),
    rtl: appearance.rtl === true || appearance.direction === 'rtl',
  };
}

type Listener = (s: SessionState) => void;

/**
 * One chat session: start / resume, send with an idempotent clientMessageId,
 * live updates over SSE (XHR progress events, which work in React Native)
 * with a polling fallback, and an offline queue flushed on reconnect.
 */
export class ChatSession {
  readonly client: ZetroqClient;
  private state: SessionState = {
    ready: false,
    error: null,
    conversationId: null,
    messages: [],
    quickReplies: [],
    theme: DEFAULT_THEME,
  };
  private listeners = new Set<Listener>();
  private visitorId = '';
  private identityToken?: string;
  private queue: OfflineQueue;
  private xhr: XMLHttpRequest | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: ZetroqConfig) {
    this.client = new ZetroqClient(config);
    this.queue = new OfflineQueue(config.storage, `zetroq:${config.botToken}:queue`);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getState(): SessionState {
    return this.state;
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  /** Signed identity token from YOUR server (see README). */
  async identify(token: string): Promise<void> {
    this.identityToken = token;
    if (this.state.ready) await this.start(this.state.conversationId ?? undefined);
  }

  async start(conversationId?: string): Promise<void> {
    const storage = this.config.storage;
    const key = `zetroq:${this.config.botToken}`;
    try {
      this.visitorId = this.visitorId || (await storage?.getItem(`${key}:visitor`)) || makeClientMessageId();
      const saved = conversationId ?? (await storage?.getItem(`${key}:conversation`)) ?? undefined;
      const res = await this.client.start({ visitorId: this.visitorId, conversationId: saved, identityToken: this.identityToken });
      this.visitorId = res.visitorId || this.visitorId;
      await storage?.setItem(`${key}:visitor`, this.visitorId);
      await storage?.setItem(`${key}:conversation`, res.conversationId);
      this.set({
        ready: true,
        error: null,
        conversationId: res.conversationId,
        messages: res.messages,
        theme: themeFromSettings(res.settings),
      });
      this.connect();
      await this.flush();
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : 'Could not start chat' });
    }
  }

  /** Open a specific conversation (for example from a push notification tap). */
  open(conversationId: string): Promise<void> {
    this.disconnect();
    return this.start(conversationId);
  }

  async send(content: string): Promise<void> {
    const text = content.trim();
    const conversationId = this.state.conversationId;
    if (!text || !conversationId) return;
    const clientMessageId = makeClientMessageId();
    const local: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };
    this.set({ messages: [...this.state.messages, local], quickReplies: [] });
    await this.queue.push({ clientMessageId, conversationId, content: text, attempts: 0 });
    await this.flush();
  }

  /** Resend everything queued; the same clientMessageId makes resends safe. */
  async flush(): Promise<void> {
    for (const item of await this.queue.load()) {
      try {
        const res = await this.client.send({
          visitorId: this.visitorId,
          conversationId: item.conversationId,
          content: item.content,
          clientMessageId: item.clientMessageId,
        });
        await this.queue.remove(item.clientMessageId);
        this.mark(item.clientMessageId, 'sent');
        if (res.reply) this.add(res.reply);
        this.set({ quickReplies: res.quickReplies });
      } catch {
        await this.queue.bump(item.clientMessageId);
        this.mark(item.clientMessageId, 'queued');
        return;
      }
    }
  }

  private mark(clientMessageId: string, status: ChatMessage['status']): void {
    this.set({ messages: this.state.messages.map((m) => (m.clientMessageId === clientMessageId ? { ...m, status } : m)) });
  }

  private add(message: ChatMessage): void {
    if (message.id && this.state.messages.some((m) => m.id === message.id)) return;
    this.set({ messages: [...this.state.messages, message] });
  }

  private connect(): void {
    const conversationId = this.state.conversationId;
    if (!conversationId || this.xhr || this.poll) return;
    if (typeof XMLHttpRequest === 'undefined') {
      this.startPolling();
      return;
    }
    const xhr = new XMLHttpRequest();
    let seen = 0;
    let buffer = '';
    xhr.open('GET', this.client.streamUrl(conversationId));
    Object.entries(this.client.headers(this.visitorId)).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.onprogress = () => {
      buffer += xhr.responseText.slice(seen);
      seen = xhr.responseText.length;
      const { events, rest } = parseSse(buffer);
      buffer = rest;
      for (const ev of events) {
        const msg = (ev.message ?? (ev.type === 'message' ? ev : null)) as Record<string, unknown> | null;
        if (msg && msg.content) this.add(toMessage(msg));
      }
    };
    xhr.onerror = () => {
      this.xhr = null;
      this.startPolling();
    };
    xhr.onload = () => {
      this.xhr = null;
      setTimeout(() => this.connect(), 2000);
    };
    xhr.send();
    this.xhr = xhr;
  }

  private startPolling(): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      const id = this.state.conversationId;
      if (!id) return;
      this.client
        .history(this.visitorId, id)
        .then((list) => {
          list.forEach((m) => this.add(m));
          return this.flush();
        })
        .catch(() => undefined);
    }, 5000);
  }

  disconnect(): void {
    this.xhr?.abort();
    this.xhr = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }
}
