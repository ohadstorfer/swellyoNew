import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReplyToSnapshot } from './messagingService';

// Persistent outbox for outgoing text messages. Each entry is keyed by a
// client-generated UUID (`client_id`) so retries are idempotent via the DB's
// partial unique index on (sender_id, client_id). Entries survive app restarts,
// and are flushed opportunistically on app foreground and Realtime reconnect.

const STORAGE_KEY = '@swellyo:messageOutbox';

export interface OutboxEntry {
  clientId: string;
  conversationId: string;
  senderId: string;
  body: string;
  type: 'text';
  createdAt: number;
  attemptCount: number;
  lastError?: string;
  lastAttemptAt?: number;
  replyTo?: ReplyToSnapshot | null;
}

export type OutboxSendFn = (entry: OutboxEntry) => Promise<void>;

class MessageOutbox {
  private cache: Map<string, OutboxEntry> | null = null;
  private writeLock: Promise<unknown> = Promise.resolve();
  private flushInFlight = false;

  private async load(): Promise<Map<string, OutboxEntry>> {
    if (this.cache) return this.cache;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.cache = new Map();
        return this.cache;
      }
      const obj = JSON.parse(raw) as Record<string, OutboxEntry>;
      this.cache = new Map(Object.entries(obj));
    } catch (err) {
      console.warn('[messageOutbox] load failed, starting empty:', err);
      this.cache = new Map();
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    const obj: Record<string, OutboxEntry> = {};
    for (const [k, v] of this.cache) obj[k] = v;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (err) {
      console.error('[messageOutbox] persist failed:', err);
    }
  }

  // Serialize mutations — AsyncStorage writes are async and we don't want a
  // concurrent flush + enqueue to race on the same key.
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeLock.then(fn, fn);
    this.writeLock = next.catch(() => undefined);
    return next;
  }

  async enqueue(entry: Omit<OutboxEntry, 'attemptCount' | 'createdAt'>): Promise<void> {
    return this.withLock(async () => {
      const map = await this.load();
      if (map.has(entry.clientId)) return;
      map.set(entry.clientId, {
        ...entry,
        createdAt: Date.now(),
        attemptCount: 0,
      });
      await this.persist();
    });
  }

  async markSent(clientId: string): Promise<void> {
    return this.withLock(async () => {
      const map = await this.load();
      if (!map.delete(clientId)) return;
      await this.persist();
    });
  }

  async markFailed(clientId: string, error: unknown): Promise<void> {
    return this.withLock(async () => {
      const map = await this.load();
      const entry = map.get(clientId);
      if (!entry) return;
      entry.attemptCount += 1;
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.lastAttemptAt = Date.now();
      await this.persist();
    });
  }

  async remove(clientId: string): Promise<void> {
    return this.markSent(clientId);
  }

  async getAll(): Promise<OutboxEntry[]> {
    const map = await this.load();
    return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  async getByConversation(conversationId: string): Promise<OutboxEntry[]> {
    const all = await this.getAll();
    return all.filter((e) => e.conversationId === conversationId);
  }

  async flushAll(send: OutboxSendFn): Promise<void> {
    if (this.flushInFlight) return;
    this.flushInFlight = true;
    try {
      const entries = await this.getAll();
      for (const entry of entries) {
        try {
          await send(entry);
          await this.markSent(entry.clientId);
        } catch (err) {
          await this.markFailed(entry.clientId, err);
          // Continue with the next entry — one failure shouldn't block the queue.
        }
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  async flushOne(
    clientId: string,
    send: OutboxSendFn
  ): Promise<{ ok: true } | { ok: false; error: unknown; reason: 'send_failed' | 'no_entry' }> {
    const map = await this.load();
    const entry = map.get(clientId);
    if (!entry) {
      return { ok: false, error: new Error('Outbox entry not found'), reason: 'no_entry' };
    }
    try {
      await send(entry);
      await this.markSent(clientId);
      return { ok: true };
    } catch (err) {
      await this.markFailed(clientId, err);
      return { ok: false, error: err, reason: 'send_failed' };
    }
  }

  // Clear everything (e.g. on logout).
  async clear(): Promise<void> {
    return this.withLock(async () => {
      this.cache = new Map();
      await AsyncStorage.removeItem(STORAGE_KEY);
    });
  }
}

export const messageOutbox = new MessageOutbox();
