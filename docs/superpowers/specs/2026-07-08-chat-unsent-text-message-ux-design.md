# Unsent-message UX in 1:1 & group chats — design

**Date:** 2026-07-08
**Branch:** ohad
**Status:** Approved, ready for implementation plan
**Scope:** OTA-able. No native change, no DB migration, no edge-function change, no new asset.

## Problem

On a bad/slow connection, a text message sent in a 1:1 (`DirectMessageScreen`) or group
(`DirectGroupChat`) chat **disappears from the open thread** until it finishes sending. It
remains visible on the conversations-list screen as the conversation's last-message preview,
which makes the disappearance look like a bug (the two views disagree).

Secondary issue: a 1:1 text bubble shows the grey **double-tick immediately on send**, before the
server has confirmed it — the tick is dishonest about delivery.

## Root cause of the disappearance (investigated, confirmed)

The optimistic bubble is added correctly on send, into two separate state trees:

1. The thread's local React `messages` state (drives the in-chat `FlatList`).
2. `MessagingProvider`'s reducer via `NEW_MESSAGE` → sets `conversation.last_message`
   (drives the conversation-list preview).

A bad connection trips a realtime `CHANNEL_ERROR` on the per-conversation channel. The handler
bumps `reconnectAttempt` (`DirectMessageScreen.tsx:844`), which is in the subscribe effect's
dependency array (`:1108`), so the effect re-runs and calls `loadMessages()` again.

`loadMessages()`'s **cache-hit branches** do a blind replace:
- memory-cache hit: `setMessages(cachedMessages)` — `DirectMessageScreen.tsx:1586`, `DirectGroupChat.tsx:1404`
- AsyncStorage-cache hit: `setMessages(asyncCachedMessages)` — `DirectMessageScreen.tsx:1675`, `DirectGroupChat.tsx:1493`

The optimistic message was never written to `chatHistoryCache` (cache writes happen only on
send-success or realtime delivery), so the blind replace wipes it from the thread. The
`MessagingProvider` reducer is a separate tree and is untouched, so the list preview survives —
producing the reported contradiction.

The **server-fetch branch** (`DirectMessageScreen.tsx:1731`) already guards against exactly this
with a merge-preserve of local-only rows and a comment describing the hazard. That guard was
never applied to the two cache-hit branches.

## Design decisions (agreed)

- **No retry button / red "!" for normal text.** A text that fails to send is not a user problem
  to resolve — the persistent outbox will resend it silently on reconnect. Its bubble simply reads
  as "not sent yet."
- **1:1 delivery ticks (revised, no new asset):**
  - Not confirmed by the server yet (still on the temporary client id, *including* a
    failed-and-auto-retrying text) → **no tick**.
  - Server-confirmed (in DB) → **double-tick grey** (unchanged).
  - Read by the other user → **double-tick coloured** (unchanged, already works).
  - This is done by *hiding* the existing double-tick until confirmed — no single-tick, no new art.
- **Groups keep no ticks** (read state isn't a single boolean across many recipients) — unchanged.
  The disappearance fix still applies to groups.
- **Retry UI stays for media / video / voice / files / contacts** — no change to their behavior.
- **Accepted tradeoff:** with no failed indicator for text, a text that *permanently* cannot send
  (e.g. server rejection) silently sits with no tick while the outbox re-attempts on each flush
  trigger. Deliberate: "not sent yet" is an acceptable resting state given silent auto-resend.

## What already exists (no work required — silent auto-resend)

Silent auto-resend for text is **already built and wired**:

- `messageOutbox` (`src/services/messaging/messageOutbox.ts`) — persistent (AsyncStorage,
  survives app-kill), idempotent via the DB partial unique index on `(sender_id, client_id)`.
- Enqueued on every text send before the network call (`DirectMessageScreen.tsx:2045`,
  `DirectGroupChat.tsx:1863`); `markSent` on success; `markFailed` on error (entry stays enqueued).
- Drained by `MessagingProvider` on mount, on app-foreground (`AppState` → active), and on NetInfo
  connectivity return (`MessagingProvider.tsx:1382-1424`); plus per-screen flush on
  conversation-open (`DirectMessageScreen.tsx:1130`, `DirectGroupChat.tsx:1101`).
- Reconciliation of the optimistic row → server row (temporary `id === client_id` → real server
  `id`) happens in the send-success handler and the realtime INSERT handler.

No changes here. Implementation must **not regress** these paths.

## Changes

### Fix #1 — stop the disappearance (both screens)

Apply the existing server-branch merge-preserve guard to the two **cache-hit** branches in both
screens (4 edit sites): `DirectMessageScreen.tsx:1586` & `:1675`, `DirectGroupChat.tsx:1404` &
`:1493`. Replace each blind `setMessages(<cached>)` with a merge that preserves local-only rows
(present in `prev` for this conversation but absent from the cached list) via
`chatHistoryCache.mergeMessages`, identical to the guard at `DirectMessageScreen.tsx:1731`.
Pagination cursor and catch-up-fetch logic in these branches stay unchanged.

### Fix #2 — no failed/retry UI for text (both screens)

In each screen's text `sendMessage` catch block (`DirectMessageScreen.tsx:2113-2126`,
`DirectGroupChat.tsx:1931-1944`), remove the `setMessages(... upload_state:'failed' ...)`. This
handler is text-only, so no type-branch is needed. Keep `messageOutbox.markFailed(...)`
(bookkeeping; the entry stays enqueued). The optimistic row stays visible and normal-looking; the
"Tap to retry" footer, the long-press "Resend/Reenviar" option, and menu gating all naturally stop
triggering for text. `handleRetryTextMessage` and the footer are left in place (inert for text,
still shared with media paths — do not delete).

### Fix #4 — hide the delivery tick until server-confirmed (1:1 only)

In `DirectMessageScreen.tsx` only (groups already pass `enabled={isDirect}` → no ticks):

1. `getReceiptState` (`:98`): treat a not-yet-confirmed message as `'pending'` — extend the
   existing `upload_state` check to also match a text row still on its temporary id
   (`!!msg.client_id && msg.id === msg.client_id`).
2. `ReadReceipt` (`:106`): return `null` when `state === 'pending'` — render no tick until the
   message is confirmed. `'delivered'` (grey) and `'read'` (coloured) render unchanged.

## Files touched

- `src/screens/DirectMessageScreen.tsx` — Fix #1 (2 sites), Fix #2 (catch), Fix #4 (getReceiptState + ReadReceipt)
- `src/screens/DirectGroupChat.tsx` — Fix #1 (2 sites), Fix #2 (catch)

The two screens carry near-identical duplicated logic; Fix #1 and Fix #2 must be mirrored across
both. Fix #4 is 1:1-only, so it lives only in `DirectMessageScreen.tsx`.

## Non-goals

- No shared refactor to de-duplicate the two screens.
- No single-tick / clock / "Sending…" indicator; no new image asset.
- No ticks in group chats.
- No change to media/video/voice/file/contact send, retry, or upload-first behavior.
- No change to `messageOutbox`, `MessagingProvider` flush wiring, DB, or edge functions.

## Acceptance criteria

1. Sending a text on a bad/slow connection: the bubble appears immediately and **stays visible** in
   the open thread throughout — no disappearance — matching the list preview. (Reproduce by forcing
   a `CHANNEL_ERROR`/reconnect during a slow send.) Applies to 1:1 and group.
2. In 1:1: a text that hasn't been confirmed by the server shows **no tick**; once confirmed it
   shows the **grey double-tick**; once read, the **coloured double-tick**. A text that fails shows
   **no tick** (not a retry button) and resends silently on reconnect, then gets its grey tick.
3. Group chats show **no ticks** (unchanged) but no longer drop the in-flight message.
4. Media / video / voice / file / contact messages still show their existing "Tap to retry" on
   failure — unchanged.
5. `tsc` passes; no regression to the outbox enqueue/markSent/markFailed/flush paths.
6. Fix #1 and Fix #2 behave identically in both `DirectMessageScreen` and `DirectGroupChat`.
