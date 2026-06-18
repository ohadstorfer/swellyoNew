import type { Message } from './messagingService';

// Required fields without which a message cannot be rendered safely.
// Using `as const` rather than `Array<keyof Message>` because `type` is
// optional in the interface (type?) but we still require a non-empty value
// at runtime. The cast in the loop keeps TypeScript happy.
const REQUIRED_KEYS = ['id', 'conversation_id', 'created_at', 'type'] as const;

/**
 * Validate a raw message object before it enters component state.
 * Returns the message unchanged when valid, or null when a required field
 * is missing/empty. Keeps malformed rows out of the render tree.
 */
export function sanitizeMessage(raw: any): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  for (const key of REQUIRED_KEYS) {
    const v = (raw as any)[key];
    if (v === undefined || v === null || v === '') return null;
  }
  return raw as Message;
}

/** Sanitize an array, dropping any invalid rows. Never throws. */
export function sanitizeMessages(raw: any): Message[] {
  if (!Array.isArray(raw)) return [];
  const out: Message[] = [];
  for (const r of raw) {
    const m = sanitizeMessage(r);
    if (m) out.push(m);
  }
  return out;
}
