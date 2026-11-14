import type { KeyValueStorage } from './types';

export interface QueuedSend {
  clientMessageId: string;
  conversationId: string;
  content: string;
  attempts: number;
}

/**
 * Offline queue. Each send keeps its clientMessageId across retries, and the
 * server dedupes on (conversation, clientMessageId), so a resend after a lost
 * response never stores the message twice.
 */
export class OfflineQueue {
  private items: QueuedSend[] = [];
  private loaded = false;

  constructor(private readonly storage: KeyValueStorage | undefined, private readonly key: string) {}

  async load(): Promise<QueuedSend[]> {
    if (!this.loaded && this.storage) {
      try {
        const raw = await this.storage.getItem(this.key);
        this.items = raw ? (JSON.parse(raw) as QueuedSend[]) : [];
      } catch {
        this.items = [];
      }
    }
    this.loaded = true;
    return [...this.items];
  }

  async push(item: QueuedSend): Promise<void> {
    await this.load();
    if (!this.items.some((i) => i.clientMessageId === item.clientMessageId)) this.items.push(item);
    await this.persist();
  }

  async remove(clientMessageId: string): Promise<void> {
    this.items = this.items.filter((i) => i.clientMessageId !== clientMessageId);
    await this.persist();
  }

  async bump(clientMessageId: string): Promise<void> {
    this.items = this.items.map((i) => (i.clientMessageId === clientMessageId ? { ...i, attempts: i.attempts + 1 } : i));
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (this.storage) await this.storage.setItem(this.key, JSON.stringify(this.items));
  }
}

export function makeClientMessageId(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}
