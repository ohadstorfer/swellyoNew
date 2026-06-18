// Per-conversation trailing debounce for durable read-watermark writes.
// The visible "Seen" is broadcast immediately elsewhere; this only coalesces
// the DB persistence so a burst of incoming messages produces ≤1 write/window.
type Pending = { fn: () => void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, Pending>();

/** Schedule (or reschedule) the latest write for `key`, firing after `delayMs` of quiet. */
export function schedule(key: string, fn: () => void, delayMs = 2000): void {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => { pending.delete(key); fn(); }, delayMs);
  pending.set(key, { fn, timer });
}

/** Run the pending write for `key` immediately (e.g. on screen blur). */
export function flush(key: string): void {
  const existing = pending.get(key);
  if (!existing) return;
  clearTimeout(existing.timer);
  pending.delete(key);
  existing.fn();
}

/** Run every pending write immediately (e.g. on AppState → background). */
export function flushAll(): void {
  for (const [key] of pending) flush(key);
}

/** Test-only: clear state without running anything. */
export function _resetForTests(): void {
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
}
