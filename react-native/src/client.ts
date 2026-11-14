import type { ChatMessage, Platform, ZetroqConfig } from './types';

const DEFAULT_BASE = 'https://api.zetroq.com/api/v1';

export interface StartResult {
  conversationId: string;
  visitorId: string;
  messages: ChatMessage[];
  settings: Record<string, unknown>;
}

export interface SendResult {
  message?: ChatMessage;
  reply?: ChatMessage;
  quickReplies: string[];
}

type Raw = Record<string, unknown>;

/** Maps a server message (snake or camel case) to the SDK shape. */
export function toMessage(raw: Raw): ChatMessage {
  const role = String(raw.role ?? 'assistant') as ChatMessage['role'];
  return {
    id: String(raw.id ?? raw.message_id ?? ''),
    clientMessageId: (raw.clientMessageId ?? raw.client_message_id ?? undefined) as string | undefined,
    role,
    content: String(raw.content ?? ''),
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
    status: 'sent',
    quickReplies: Array.isArray(raw.quickReplies) ? (raw.quickReplies as unknown[]).map(String) : undefined,
  };
}

/**
 * Thin client for the ZetroQ public chat API (`/public/bots/{token}/...`,
 * widget-token auth). No per-user state beyond the ids it is given.
 */
export class ZetroqClient {
  readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ZetroqConfig) {
    this.base = (config.apiBase ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private url(path: string): string {
    return `${this.base}/public/bots/${encodeURIComponent(this.config.botToken)}${path}`;
  }

  headers(visitorId?: string): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (visitorId) h['X-Visitor-Id'] = visitorId;
    if (this.config.appDomain) h['X-Embed-Domain'] = this.config.appDomain;
    return h;
  }

  private async call<T = Raw>(method: string, path: string, body?: Raw, visitorId?: string): Promise<T> {
    const res = await this.fetchImpl(this.url(path), {
      method,
      headers: this.headers(visitorId),
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Raw;
    if (!res.ok) throw new ZetroqApiError(String(json.message ?? `HTTP ${res.status}`), res.status);
    return (json.data ?? json) as T;
  }

  async start(opts: { visitorId?: string; conversationId?: string; identityToken?: string; forceNew?: boolean }): Promise<StartResult> {
    const data = await this.call<Raw>('POST', '/start', { ...opts }, opts.visitorId);
    const list = (data.messages ?? data.history ?? []) as Raw[];
    return {
      conversationId: String(data.conversationId ?? data.conversation_id ?? ''),
      visitorId: String(data.visitorId ?? data.visitor_id ?? opts.visitorId ?? ''),
      messages: list.map(toMessage),
      settings: (data.settings ?? data.bot ?? {}) as Record<string, unknown>,
    };
  }

  /** History = resuming the same conversation (start is idempotent for an id). */
  async history(visitorId: string, conversationId: string): Promise<ChatMessage[]> {
    return (await this.start({ visitorId, conversationId })).messages;
  }

  async send(opts: { visitorId: string; conversationId: string; content: string; clientMessageId: string }): Promise<SendResult> {
    const data = await this.call<Raw>('POST', '/message', { ...opts }, opts.visitorId);
    const reply = (data.reply ?? data.message ?? null) as Raw | null;
    return {
      reply: reply ? toMessage({ role: 'assistant', ...reply }) : undefined,
      quickReplies: Array.isArray(data.quickReplies) ? (data.quickReplies as unknown[]).map(String) : [],
    };
  }

  registerPushToken(token: string, platform: Platform, conversationId?: string): Promise<Raw> {
    return this.call('POST', '/push-tokens', { token, platform, conversationId });
  }

  unregisterPushToken(token: string): Promise<Raw> {
    return this.call('DELETE', '/push-tokens', { token });
  }

  streamUrl(conversationId: string): string {
    return `${this.url('/stream')}?conversationId=${encodeURIComponent(conversationId)}`;
  }
}

export class ZetroqApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Parses complete `data: {...}` SSE frames out of a growing buffer. */
export function parseSse(buffer: string): { events: Raw[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: Raw[] = [];
  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as Raw);
    } catch {
      /* keep-alive / non-JSON frame */
    }
  }
  return { events, rest };
}
