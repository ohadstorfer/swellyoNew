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

/** How much older than the window an unsent row must be to count as history
 *  (it goes above the window) rather than a fresh send on a slow device clock. */
const OLD_UNSENT_MARGIN_MS = 5 * 60 * 1000;

/** Epoch ms of an ISO timestamp, null if missing or unparseable. Compares
 *  instants, not strings: local rows say "…Z", server rows "…+00:00". */
const timeOf = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};

/** Not on the server yet: a row whose id is still its client_id (a text, or a
 *  contact card, which is born with upload_state 'sent'), or media that is
 *  uploading / failed / never started. A row that already carries its server
 *  id and is marked 'sent' is NOT pending, even if it keeps its local preview. */
const isUnsent = (m: Message): boolean => {
  if (m.client_id && m.id === m.client_id) return true;
  if (m.upload_state === 'sent') return false;
  return !!m.upload_state || !!m._localPreviewUri || !!m._localVideoUri;
};

/**
 * The server's latest window, plus the local messages it does not know about
 * yet — so reloading the window never wipes a message the user just sent.
 *
 * Kept from `local`: rows missing from `serverWindow` (by id or client_id)
 * that are either
 *   - unsent (see isUnsent), or
 *   - a row newer than the newest server row (the reload's query ran before
 *     the insert landed).
 * They go after the server rows (the list is oldest → newest) — except an
 * unsent row that is older than the whole window by more than 5 minutes (a
 * failed upload from deep in history), which goes before it, so it never shows up as the newest message.
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
  const oldest = serverWindow.length ? timeOf(serverWindow[0].created_at) : null;
  const newest = serverWindow.length ? timeOf(serverWindow[serverWindow.length - 1].created_at) : null;

  const before: Message[] = [];
  const after: Message[] = [];
  for (const m of local) {
    if (known.has(m.id) || (m.client_id && known.has(m.client_id))) continue;
    const at = timeOf(m.created_at);
    if (isUnsent(m)) {
      // Older than the whole window by more than any clock skew: a leftover
      // from deep in history, not something just sent.
      if (at !== null && oldest !== null && at < oldest - OLD_UNSENT_MARGIN_MS) before.push(m);
      else after.push(m);
    } else if (
      m.client_id &&
      at !== null &&
      // An unreadable server time must not let every old row through.
      (serverWindow.length === 0 || (newest !== null && at >= newest))
    ) {
      after.push(m);
    }
  }
  if (before.length === 0 && after.length === 0) return serverWindow;
  return [...before, ...serverWindow, ...after];
}
