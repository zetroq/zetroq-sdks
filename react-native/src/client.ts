import type { ChatMessage, PickedFile, Platform, ZetroqConfig } from './types';

const DEFAULT_BASE = 'https://api.zetroq.com/api/v1';

export interface StartResult {
  conversationId: string;
  visitorId: string;
  messages: ChatMessage[];
  settings: Record<string, unknown>;
  identityStatus: string | null;
}

export interface SendResult {
  message?: ChatMessage;
  reply?: ChatMessage;
  quickReplies: string[];
  /** The server had already accepted this clientMessageId (a resend). */
  duplicate: boolean;
}

export interface HistoryPage {
  messages: ChatMessage[];
  hasMore: boolean;
  /** Id to pass as `before` (scroll back) or `after` (poll) next time. */
  cursor: string | null;
}

export interface IdentifyResult {
  status: string;
  linked: boolean;
  conversationId: string | null;
  knownFields: string[];
}

export interface UploadedAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
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

function isPickedFile(file: unknown): file is PickedFile {
  return typeof file === 'object' && file !== null && typeof (file as PickedFile).uri === 'string';
}

/**
 * Thin client for the ZetroQ public chat API (`/public/bots/{token}/...`,
 * widget-token auth, planning/v2/chat-omni/public-chat-api.md). No per-user
 * state beyond the ids it is given.
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

  headers(visitorId?: string, json = true): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (json) h['Content-Type'] = 'application/json';
    if (visitorId) h['X-Visitor-Id'] = visitorId;
    if (this.config.appDomain) h['X-Embed-Domain'] = this.config.appDomain;
    return h;
  }

  private async call<T = Raw>(method: string, path: string, body?: Raw | FormData, visitorId?: string, extra: Record<string, string> = {}): Promise<T> {
    const form = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await this.fetchImpl(this.url(path), {
      method,
      headers: { ...this.headers(visitorId, !form), ...extra },
      body: form ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Raw;
    if (!res.ok) {
      throw new ZetroqApiError(String(json.message ?? `HTTP ${res.status}`), res.status, (json.errors ?? {}) as Record<string, string[]>);
    }
    return (json.data ?? json) as T;
  }

  async start(opts: { visitorId?: string; conversationId?: string; identityToken?: string; forceNew?: boolean }): Promise<StartResult> {
    const data = await this.call<Raw>('POST', '/start', { ...opts, consentGiven: true }, opts.visitorId);
    const list = (data.messages ?? data.history ?? []) as Raw[];
    const identity = (data.identity ?? {}) as Raw;
    return {
      conversationId: String(data.conversationId ?? data.conversation_id ?? ''),
      visitorId: String(data.visitorId ?? data.visitor_id ?? opts.visitorId ?? ''),
      messages: list.map(toMessage),
      settings: (data.settings ?? data.bot ?? {}) as Record<string, unknown>,
      identityStatus: typeof identity.status === 'string' ? identity.status : null,
    };
  }

  /**
   * GET /history — the visitor's own conversation only (no /start round trip).
   * `after` = newer than that message (polling), `before` = the page before it.
   * A conversation with no row yet (nothing sent) is an empty page.
   */
  async history(
    visitorId: string,
    conversationId: string,
    opts: { after?: string; before?: string; limit?: number; identityToken?: string } = {},
  ): Promise<HistoryPage> {
    const q = [`conversationId=${encodeURIComponent(conversationId)}`, `visitorId=${encodeURIComponent(visitorId)}`];
    if (opts.after) q.push(`after=${encodeURIComponent(opts.after)}`);
    if (opts.before) q.push(`before=${encodeURIComponent(opts.before)}`);
    if (opts.limit) q.push(`limit=${opts.limit}`);
    try {
      const extra: Record<string, string> = opts.identityToken ? { 'X-Identity-Token': opts.identityToken } : {};
      const data = await this.call<Raw>('GET', `/history?${q.join('&')}`, undefined, visitorId, extra);
      return {
        messages: ((data.messages ?? []) as Raw[]).map(toMessage),
        hasMore: data.hasMore === true,
        cursor: typeof data.cursor === 'string' ? data.cursor : null,
      };
    } catch (e) {
      if (e instanceof ZetroqApiError && e.status === 404) return { messages: [], hasMore: false, cursor: null };
      throw e;
    }
  }

  async send(opts: { visitorId: string; conversationId: string; content: string; clientMessageId: string; identityToken?: string }): Promise<SendResult> {
    const data = await this.call<Raw>('POST', '/message', { ...opts }, opts.visitorId);
    const reply = (data.reply ?? data.message ?? null) as Raw | null;
    const mine = (data.userMessage ?? null) as Raw | null;
    return {
      message: mine ? toMessage({ role: 'user', ...mine }) : undefined,
      reply: reply ? toMessage({ role: 'assistant', ...reply }) : undefined,
      quickReplies: Array.isArray(data.quickReplies) ? (data.quickReplies as unknown[]).map(String) : [],
      duplicate: data.duplicate === true,
    };
  }

  /** POST /identify — verify a signed identity token now; unsigned hints never link anyone. */
  async identify(opts: {
    visitorId: string;
    conversationId?: string;
    identityToken?: string;
    name?: string;
    email?: string;
    phone?: string;
  }): Promise<IdentifyResult> {
    const data = await this.call<Raw>('POST', '/identify', { ...opts }, opts.visitorId);
    return {
      status: String(data.status ?? 'unsigned'),
      linked: data.linked === true,
      conversationId: typeof data.conversationId === 'string' ? data.conversationId : null,
      knownFields: Array.isArray(data.knownFields) ? (data.knownFields as unknown[]).map(String) : [],
    };
  }

  /** POST /upload (multipart). React Native passes `{ uri, name, mimeType }`; web passes a Blob. */
  async upload(opts: { visitorId: string; conversationId?: string; file: PickedFile | Blob; name?: string }): Promise<UploadedAttachment> {
    const form = new FormData();
    const name = opts.name ?? (isPickedFile(opts.file) ? opts.file.name : 'attachment');
    if (isPickedFile(opts.file)) {
      // React Native's FormData reads { uri, name, type } as a file part.
      form.append('file', { uri: opts.file.uri, name, type: opts.file.mimeType } as unknown as Blob);
    } else {
      form.append('file', opts.file, name);
    }
    form.append('visitorId', opts.visitorId);
    if (opts.conversationId) form.append('conversationId', opts.conversationId);
    const data = await this.call<Raw>('POST', '/upload', form, opts.visitorId);
    return {
      url: String(data.url ?? ''),
      name: String(data.name ?? name),
      mimeType: String(data.mimeType ?? ''),
      size: Number(data.size ?? 0),
    };
  }

  /** visitorId is required with a conversationId: the server only binds a token to the caller's own conversation. */
  registerPushToken(token: string, platform: Platform, conversationId?: string, visitorId?: string): Promise<Raw> {
    return this.call('POST', '/push-tokens', { token, platform, conversationId, visitorId }, visitorId);
  }

  unregisterPushToken(token: string): Promise<Raw> {
    return this.call('DELETE', '/push-tokens', { token });
  }

  streamUrl(conversationId: string, visitorId?: string): string {
    const v = visitorId ? `&visitorId=${encodeURIComponent(visitorId)}` : '';
    return `${this.url('/stream')}?conversationId=${encodeURIComponent(conversationId)}${v}`;
  }
}

export class ZetroqApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: Record<string, string[]> = {},
  ) {
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
