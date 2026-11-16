import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZetroqApiError, ZetroqClient, parseSse } from '../src/client';
import { OfflineQueue } from '../src/queue';
import { ChatSession } from '../src/session';
import type { KeyValueStorage } from '../src/types';

const API = 'https://api.example.test/api/v1';
const BOT = 'tok-rn';
const CONV = '0192c3f4-0000-7000-8000-0000000000aa';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(...answers: Array<Response | Error | (() => Response)>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof body === 'string' ? JSON.parse(body) : body,
    });
    const next = answers.shift();
    if (!next) throw new Error('unexpected fetch ' + String(input));
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

const started = (history: unknown[] = []): Response =>
  json(200, { success: true, data: { conversationId: CONV, visitorId: 'v-1', history, identity: { status: 'unsigned' }, bot: { appearance: { primaryColor: '#123456' } } } });

const replied = (id: string, content: string, extra: Record<string, unknown> = {}): Response =>
  json(200, { success: true, data: { message: { id, role: 'bot', content }, userMessage: { id: `u-${id}`, role: 'user', content: 'x' }, quickReplies: [], ...extra } });

describe('ZetroqClient (React Native)', () => {
  it('start() posts visitor, conversation and identity token', async () => {
    const { fn, calls } = mockFetch(started([{ id: 'm-1', role: 'bot', content: 'Hi' }]));
    const client = new ZetroqClient({ botToken: BOT, apiBase: API, fetchImpl: fn, appDomain: 'app.example.com' });

    const res = await client.start({ visitorId: 'v-1', identityToken: 'signed.token' });

    expect(calls[0].url).toBe(`${API}/public/bots/${BOT}/start`);
    expect(calls[0].body).toMatchObject({ visitorId: 'v-1', identityToken: 'signed.token' });
    expect(calls[0].headers['X-Embed-Domain']).toBe('app.example.com');
    expect(res.conversationId).toBe(CONV);
    expect(res.messages.map((m) => m.content)).toEqual(['Hi']);
  });

  it('history() is GET /history with an after cursor and the token in a header; 404 = empty', async () => {
    const { fn, calls } = mockFetch(
      json(200, { success: true, data: { messages: [{ id: 'm-3', role: 'agent', content: 'Hello from Asha' }], hasMore: false, cursor: 'm-3' } }),
      json(404, { success: false, message: 'Conversation not found' }),
    );
    const client = new ZetroqClient({ botToken: BOT, apiBase: API, fetchImpl: fn });

    const page = await client.history('v-1', CONV, { after: 'm-2', identityToken: 'signed.token' });
    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe('GET');
    expect(url.pathname).toBe(`/api/v1/public/bots/${BOT}/history`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ conversationId: CONV, visitorId: 'v-1', after: 'm-2' });
    expect(calls[0].headers['X-Identity-Token']).toBe('signed.token');
    expect(page.messages[0].content).toBe('Hello from Asha');
    expect(page.cursor).toBe('m-3');

    expect(await client.history('v-1', CONV)).toEqual({ messages: [], hasMore: false, cursor: null });
  });

  it('identify() posts to /identify', async () => {
    const { fn, calls } = mockFetch(json(200, { success: true, data: { status: 'verified', linked: true, conversationId: CONV, knownFields: ['email'] } }));
    const client = new ZetroqClient({ botToken: BOT, apiBase: API, fetchImpl: fn });

    const res = await client.identify({ visitorId: 'v-1', conversationId: CONV, identityToken: 'signed.token' });

    expect(calls[0].url).toBe(`${API}/public/bots/${BOT}/identify`);
    expect(calls[0].body).toEqual({ visitorId: 'v-1', conversationId: CONV, identityToken: 'signed.token' });
    expect(res).toEqual({ status: 'verified', linked: true, conversationId: CONV, knownFields: ['email'] });
  });

  it('upload() posts multipart without a JSON content type; 422 carries the errors', async () => {
    const { fn, calls } = mockFetch(
      json(201, { success: true, data: { url: 'https://api.example.test/api/v1/public/chat-attachments/o/x.png', name: 'x.png', mimeType: 'image/png', size: 3 } }),
      json(422, { success: false, message: 'The file field must not be greater than 10240 kilobytes.', errors: { file: ['too big'] } }),
    );
    const client = new ZetroqClient({ botToken: BOT, apiBase: API, fetchImpl: fn });

    const res = await client.upload({ visitorId: 'v-1', conversationId: CONV, file: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), name: 'x.png' });
    const form = calls[0].body as FormData;
    expect(calls[0].url).toBe(`${API}/public/bots/${BOT}/upload`);
    expect(form.get('visitorId')).toBe('v-1');
    expect(form.get('conversationId')).toBe(CONV);
    expect((form.get('file') as File).name).toBe('x.png');
    expect(calls[0].headers['Content-Type']).toBeUndefined();
    expect(res.url).toContain('/chat-attachments/');

    const err = await client.upload({ visitorId: 'v-1', file: new Blob(['x']), name: 'big.pdf' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZetroqApiError);
    expect((err as ZetroqApiError).status).toBe(422);
    expect((err as ZetroqApiError).errors.file).toEqual(['too big']);
  });

  it('streamUrl() carries the visitor id; parseSse() splits frames', () => {
    const client = new ZetroqClient({ botToken: BOT, apiBase: API, fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(client.streamUrl(CONV, 'v-1')).toBe(`${API}/public/bots/${BOT}/stream?conversationId=${CONV}&visitorId=v-1`);
    const { events, rest } = parseSse('data: {"type":"connected"}\n\ndata: {"type":"message","content":"hi"}\n\ndata: {"part');
    expect(events).toEqual([{ type: 'connected' }, { type: 'message', content: 'hi' }]);
    expect(rest).toBe('data: {"part');
  });
});

describe('OfflineQueue', () => {
  it('persists and never queues the same clientMessageId twice', async () => {
    const storage = memoryStorage();
    const q = new OfflineQueue(storage, 'k');
    await q.push({ clientMessageId: 'a', conversationId: CONV, content: 'hi', attempts: 0 });
    await q.push({ clientMessageId: 'a', conversationId: CONV, content: 'hi', attempts: 0 });
    expect(await new OfflineQueue(storage, 'k').load()).toHaveLength(1);
  });
});

describe('ChatSession', () => {
  afterEach(() => vi.useRealTimers());

  it('send() uses a clientMessageId, resends the SAME id after a network error, and never duplicates', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const { fn, calls } = mockFetch(started(), new TypeError('Network request failed'), replied('b-1', 'Got it', { duplicate: true }));
    const session = new ChatSession({ botToken: BOT, apiBase: API, fetchImpl: fn, storage });
    await session.start();

    await session.send('Where is my order?');
    const first = calls[1].body as Record<string, string>;
    expect(first.clientMessageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.getState().messages.slice(-1)[0]?.status).toBe('queued');
    expect(storage.data.get(`zetroq:${BOT}:queue`)).toContain(first.clientMessageId);

    await session.flush();
    expect((calls[2].body as Record<string, string>).clientMessageId).toBe(first.clientMessageId);
    const contents = session.getState().messages.map((m) => m.content);
    expect(contents).toEqual(['Where is my order?', 'Got it']);
    expect(JSON.parse(storage.data.get(`zetroq:${BOT}:queue`) ?? '[]')).toEqual([]);
    session.disconnect();
  });

  it('poll() reads GET /history?after=<newest> instead of re-calling /start', async () => {
    vi.useFakeTimers();
    const { fn, calls } = mockFetch(
      started([{ id: 'm-1', role: 'bot', content: 'Hi' }]),
      json(200, { success: true, data: { messages: [{ id: 'm-1', role: 'bot', content: 'Hi' }, { id: 'm-2', role: 'agent', content: 'Asha here' }], hasMore: false, cursor: 'm-2' } }),
    );
    const session = new ChatSession({ botToken: BOT, apiBase: API, fetchImpl: fn });
    await session.start();

    await session.poll();

    expect(new URL(calls[1].url).searchParams.get('after')).toBe('m-1');
    expect(calls.filter((c) => c.url.endsWith('/start'))).toHaveLength(1);
    expect(session.getState().messages.map((m) => m.content)).toEqual(['Hi', 'Asha here']);
    session.disconnect();
  });

  it('identify() after start verifies via /identify (no restart); upload goes to /upload unless a callback is given', async () => {
    vi.useFakeTimers();
    const { fn, calls } = mockFetch(
      started(),
      json(200, { success: true, data: { status: 'verified', linked: true, conversationId: CONV, knownFields: [] } }),
      json(201, { success: true, data: { url: 'https://api.example.test/a/b.pdf', name: 'quote.pdf', mimeType: 'application/pdf', size: 4 } }),
      replied('b-2', 'Thanks for the file'),
    );
    const session = new ChatSession({ botToken: BOT, apiBase: API, fetchImpl: fn });
    await session.start();

    const res = await session.identify('signed.token');
    expect(res?.status).toBe('verified');
    expect(calls[1].url.endsWith('/identify')).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/start'))).toHaveLength(1);

    await session.sendAttachment({ uri: 'file:///tmp/quote.pdf', name: 'quote.pdf', mimeType: 'application/pdf' });
    expect(calls[2].url.endsWith('/upload')).toBe(true);
    expect((calls[3].body as Record<string, string>)).toMatchObject({ content: 'quote.pdf: https://api.example.test/a/b.pdf', identityToken: 'signed.token' });
    session.disconnect();

    const uploadAttachment = vi.fn(async () => 'https://cdn.example.com/own.png');
    const own = mockFetch(started(), replied('b-3', 'ok'));
    const withCallback = new ChatSession({ botToken: BOT, apiBase: API, fetchImpl: own.fn, uploadAttachment });
    await withCallback.start();
    await withCallback.sendAttachment({ uri: 'file:///own.png', name: 'own.png', mimeType: 'image/png' });
    expect(uploadAttachment).toHaveBeenCalledOnce();
    expect(own.calls.some((c) => c.url.endsWith('/upload'))).toBe(false);
    withCallback.disconnect();
  });
});
