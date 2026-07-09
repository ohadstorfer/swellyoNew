---
name: project-text-message-vanishes-on-slow-send
description: Root cause of the bug where a text message disappears from the open DM/group thread while sending on a bad connection but stays visible in the conversations-list preview
metadata:
  type: project
---

Researched 2026-07-08 (Ohad). Bug report: on bad/slow connection, a sent text message vanishes from the open chat thread until it fully sends, but stays visible as the conversations-list "last message" the whole time.

**Root cause (both `src/screens/DirectMessageScreen.tsx` and `src/screens/DirectGroupChat.tsx`, code is duplicated near-verbatim between the two):**

1. `sendMessage()` builds an optimistic `Message` (client-generated `clientId` as `id`/`client_id`, no `upload_state` set for text — that field is only ever set for image/video/audio/file sends) and does two independent things:
   - `setMessages((prev) => [...prev, optimisticMessage])` — local component state, drives the thread's FlatList (`invertedMessages = dedupeMessages(messages).reverse()`).
   - `messagingDispatch({ type: 'NEW_MESSAGE', payload: { conversationId, message: optimisticMessage } })` — global `MessagingProvider` state via `conversationReducer.ts` (`case 'NEW_MESSAGE'`, ~line 79-124), which sets `conversation.last_message = message` and bumps it to the top of the list. This is what the conversations list reads for its preview — completely separate state tree from the thread's local `messages`.
   - The optimistic message is **not** persisted to `chatHistoryCache` at this point (cache writes only happen later, on confirmed send/realtime delivery).

2. Meanwhile the big screen-level `useEffect` that subscribes to realtime and calls `loadMessages()` on mount has `reconnectAttempt` in its dependency array (DirectMessageScreen.tsx:1108, DirectGroupChat.tsx:1079). Its `onSubscriptionStatus` callback bumps `reconnectAttempt` on `CHANNEL_ERROR` (DirectMessageScreen.tsx ~844-848, DirectGroupChat.tsx ~813). A bad/slow connection is exactly the condition that trips `CHANNEL_ERROR` on the per-conversation realtime channel.

3. Bumping `reconnectAttempt` re-runs the whole effect, which calls `loadMessages()` again (DirectMessageScreen.tsx:770). `loadMessages()`'s **memory-cache-hit branch** (by far the common case, since the cache is already warm from the initial mount) does a blind, non-merging `setMessages(cachedMessages)` (DirectMessageScreen.tsx:1586, DirectGroupChat.tsx:1404) — no preservation of any local-only/optimistic rows. Contrast with the "both caches miss → server fetch" branch (DirectMessageScreen.tsx:1719-1735), which explicitly merges local-only messages back in with a comment explaining exactly this hazard — that merge logic was never applied to the cache-hit branches.

4. Since the optimistic message only ever lived in React state (never cached), the blind replace wipes it from the thread's `messages` array — it disappears from the FlatList. The `MessagingProvider`/`conversationReducer` state is untouched by this local reset, so the conversations-list preview keeps showing it. This is the exact contradiction reported.

5. Once `messagingService.sendMessage()` finally resolves, the success handler (DirectMessageScreen.tsx:2080-2101) tries `optimisticIdx = prev.findIndex(m => m.id === clientId || m.client_id === clientId)` — but the row is already gone from `prev` (wiped in step 4), so it falls into the `[...prev, sentMessage]` branch and the message reappears as if newly arrived. This matches "reappears once it successfully sends."

**Also relevant:** text messages have no 'sending'/'pending' visual state at all — `upload_state` is only set to `'uploading'` for media sends (image/video/audio/file). The `'Sending…'` spinner and `'Tap to retry'` UI (DirectMessageScreen.tsx ~4701-4716) exist and are wired to `upload_state`, but text's optimistic message never sets `upload_state: 'uploading'`, so text bubbles look like a normal sent message the whole time they're in flight, and only ever show a "failed" state via `upload_state: 'failed'` in the `sendMessage()` catch block (line 2119-2123) if the send throws — a slow-but-eventually-successful send never reaches that catch block.

**How to apply:** Any fix needs to address at minimum: (a) don't let `loadMessages()`'s cache-hit paths blindly discard local-only messages — merge like the server-fetch branch already does, and/or (b) don't let a realtime `CHANNEL_ERROR`/`reconnectAttempt` bump re-trigger a full `loadMessages()` while a send is in flight, and/or (c) give text messages the same `upload_state: 'uploading'` treatment media already has so a slow send is visibly pending instead of looking fully-sent-then-vanishing.
