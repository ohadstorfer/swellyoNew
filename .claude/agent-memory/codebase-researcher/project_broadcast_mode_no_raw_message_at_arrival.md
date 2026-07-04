---
name: project-broadcast-mode-no-raw-message-at-arrival
description: In live 'broadcast' realtime mode (default), MessagingProvider's arrival path for non-open conversations has NO raw Message object — only a touch intent + re-fetch; the raw-message onNewMessage callback block is dead code
metadata:
  type: project
---

Researched 2026-07-04 for the in-app-banner-overlay spec (docs/superpowers/specs/2026-07-04-in-app-banner-overlay-design.md).

**Finding:** `getRealtimeMode()` (`src/services/messaging/realtimeMode.ts`) defaults to `'broadcast'` now (env var is only an escape hatch back to `'legacy'`/`'shadow'`). This contradicts an older memory that said default was legacy — the code has since flipped; trust `realtimeMode.ts` over old memory.

In `'broadcast'` mode (the live default), the arrival path for a conversation that ISN'T the currently-open one is:
1. `subscribeToUserInbox` (messagingService.ts:2196) delivers only `InboxIntent = { kind: 'touch', conversationId, messageId? }` — NO sender_id, NO body, NO message type.
2. `MessagingProvider.tsx` `handleInboxChange` (~line 761-775) debounce-collects conversationIds (~line 952-977) and calls `messagingService.getConversationsUpdatedSince(0, ids)`, then `dispatch({ type: 'SYNC_FROM_SERVER', payload: { conversations: updated } })`. `updated` conversations ARE fully enriched (last_message + other_user/members with name+avatar already resolved) — just arrives async, one fetch round-trip after the touch signal, not raw-payload-instant.

The big `callbacks.onNewMessage` handler inside the `messagingService.subscribeToConversations(callbacks)` effect (MessagingProvider.tsx ~line 1014-1241, huge enrichment block) is **DEAD CODE in current architecture** — `subscribeToConversations`'s `conversations_list` channel (messagingService.ts:2988) only listens to `conversations` table UPDATE now (its messages INSERT/UPDATE/DELETE bindings were deliberately removed per an in-file comment, since unfiltered RLS eval on `messages` destabilized the socket). Confirmed via grep: `normalizedCallbacks.onNewMessage` / `onMessageUpdated` / `onMessageDeleted` are never invoked anywhere in messagingService.ts. Only `onConversationUpdated` and `onReconnect` from that callbacks object are still live.

The raw-Message batch path (`subscribeToConversationListUpdatesBatch`, messagingService.ts:2651, wired at MessagingProvider.tsx:895-944 with `onNewMessage` at line 918 getting a full `Message` with sender_id/type/body/image_video_audio_metadata) only runs when `getRealtimeMode() !== 'broadcast'` (gated at MessagingProvider.tsx:900) — i.e. it's LIVE only in legacy/shadow, dead in the default broadcast mode.

**Why this matters:** Any future work assuming "MessagingProvider already has the raw incoming message at arrival, ready for a synchronous side-effect" (e.g. an in-app banner hook, an unread-preview builder keyed off message.type) is WRONG for the default/live mode. In broadcast mode the only synchronous signal is a bare conversationId touch; real content requires awaiting the SYNC_FROM_SERVER fetch, and "is this actually a NEW message vs. some other conversation-row change" must be inferred by diffing the previous last_message.id (via `conversationsRef.current`) against the newly-fetched one inside/after `handleInboxChange`.

**How to apply:** When implementing anything hooked to "a new message arrived" in MessagingProvider (banners, sound, badge logic), hook it into `handleInboxChange`'s post-fetch/dispatch point (comparing old vs new last_message per conversation), not into the `onNewMessage` callback block passed to `subscribeToConversations` — that block is unreachable in production. Related: [[project_messaging_broadcast_migration]].
