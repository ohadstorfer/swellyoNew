import type { Message } from './messagingService';

/** Max messages kept in a screen's in-memory array (chronological, oldest→newest). */
export const MAX_IN_MEMORY_MESSAGES = 250;

/**
 * Bound an in-memory chat array. `dropFrom: 'head'` keeps the newest `max`
 * (used when at the bottom receiving new messages); `'tail'` keeps the oldest
 * `max` (used when scrolling UP / prepending older — the newest end is far
 * off-screen). Returns the same reference when no trim is needed.
 */
export function capMessages(messages: Message[], max: number, dropFrom: 'head' | 'tail'): Message[] {
  if (messages.length <= max) return messages;
  return dropFrom === 'head' ? messages.slice(messages.length - max) : messages.slice(0, max);
}
