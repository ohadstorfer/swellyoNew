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

/**
 * The server's latest window, plus the local messages it does not know about
 * yet — so reloading the window never wipes a message the user just sent.
 *
 * Kept from `local`: rows missing from `serverWindow` (by id or client_id)
 * that are either
 *   - still being sent: a text row whose id is still its client_id, or a
 *     media row with an upload in flight / a local preview, or
 *   - a row newer than the newest server row (the reload's query ran before
 *     the insert landed).
 * They go after the server rows (the list is oldest → newest).
 *
 * Why: sending calls scrollToBottom(), which reloads the window when newer
 * messages were trimmed (scrolled up, opened at the unread divider). A plain
 * setMessages(serverWindow) dropped the bubble — a flicker when the send
 * succeeded, gone from the screen when it failed (21 Oct 2026 test).
 */
export function mergeLatestWindow(local: Message[], serverWindow: Message[]): Message[] {
  const known = new Set<string>();
  for (const m of serverWindow) {
    known.add(m.id);
    if (m.client_id) known.add(m.client_id);
  }
  const newest = serverWindow.length ? serverWindow[serverWindow.length - 1].created_at ?? '' : '';
  const pending = local.filter((m) => {
    if (known.has(m.id) || (m.client_id && known.has(m.client_id))) return false;
    if (m.client_id && m.id === m.client_id) return true;
    if (m.upload_state || m._localPreviewUri || m._localVideoUri) return true;
    return !!m.client_id && !!m.created_at && m.created_at >= newest;
  });
  return pending.length ? [...serverWindow, ...pending] : serverWindow;
}
