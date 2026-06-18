# Messaging — Top 3 Fixes (crash isolation, read-receipt load, long-thread memory)

**Date:** 2026-06-17
**Author:** Ohad (with Claude)
**Status:** Design — pending review
**Branch:** `ohad`

---

## 1. Context & problem statement

A deep multi-agent review of the messaging system (`messaging-review.html`) surfaced three high-severity issues, each confirmed against the code. This spec attacks all three. Industry research (WhatsApp, Messenger, Signal, Slack, Telegram, Stream Chat, Bluesky) was used to ground every solution — see §3.

### Problem #1 — A single bad message crashes the whole app
The only error boundary, `PostHogErrorBoundary` (`src/components/PostHogErrorBoundary.tsx:23-35`), re-throws every non-PostHog error. So a render throw anywhere in messaging (corrupt cached message, missing field, bad media URL) tears the whole app down to a blank screen. Sentry reports it, but the user sees a full crash.

### Problem #2 — Every incoming message triggers a burst of DB work
While a chat is open, each incoming realtime message calls `markAsRead` (`DirectMessageScreen.tsx:665-669`, `DirectGroupChat.tsx:664`). The provider's `markAsRead` (`MessagingProvider.tsx:988-1001`) runs `messagingService.markAsRead` (SELECT latest id + UPDATE `last_read_at` + broadcast — `messagingService.ts:1494-1549`) **then** `getUnreadCount` (SELECT + COUNT — `messagingService.ts:2884-2907`). That is ~5 DB ops per incoming message **per active viewer** — the biggest load multiplier in the system. No debounce.

### Problem #3 — Long conversations grow memory unbounded
The in-memory `messages` array is never trimmed: `loadOlderMessages` prepends (`DirectMessageScreen.tsx:1351`), realtime appends (`:657`), nothing slices. The disk cache caps at 100 (`chatHistoryCache.ts:24`) but the live render array does not. FlatList is over-configured (`initialNumToRender=50`, `maxToRenderPerBatch=50`, `windowSize=21` — `:3931-3933`), no `getItemLayout`. Reply-jump pages through history up to 5× to find a target (`:2700-2710`), and all of it stays in memory for the session. Same pattern in `DirectGroupChat.tsx`.

---

## 2. Goals / non-goals

**Goals**
- A render error in a chat screen or a single message bubble never white-screens the app.
- Cut per-incoming-message DB work from ~5 ops to ~1 cheap broadcast + a batched durable write — **without** delaying the sender's "Seen" indicator.
- Bound in-memory message growth so long, heavily-scrolled threads stay smooth and memory-stable.

**Non-goals**
- No DB schema changes, no new tables, no Edge Functions.
- No realtime transport change (broadcast stays the default).
- Not migrating to FlashList (v2's inverted/chat mode has open regressions as of mid-2025 — see §3.3).
- No unrelated refactors of `messagingService.ts`.

**Verification:** on-device by Ohad (no simulator/Maestro, per standing preference). Each phase is `tsc`-clean and self-contained so it can be reviewed and committed independently.

---

## 3. Industry grounding (what the big apps do)

### 3.1 Crash isolation (Problem #1)
Three independent layers (Bluesky `social-app`, `react-error-boundary`, RN best-practice guides):
1. **Validate at the edge** — sanitize message data before it enters state; highest ROI (stops crashes before render).
2. **Screen-level boundary** with `resetKeys` so it auto-recovers on navigation — a single top-level boundary is explicitly insufficient (traps the user).
3. **Per-item boundary** so one corrupt bubble renders a placeholder, not a thread crash.

Standard lib: `react-error-boundary` (bvaughn) — `resetKeys`, `onReset`, `FallbackComponent`, `useErrorBoundary`. Sentry: capture inside `onError`; do **not** also wrap the same subtree in `Sentry.ErrorBoundary` (double-reporting, getsentry/sentry-javascript#1432).
Sources: [react-error-boundary](https://github.com/bvaughn/react-error-boundary), [RN University — Error Boundaries](https://www.reactnative.university/blog/react-native-error-boundaries), [Sentry RN ErrorBoundary](https://docs.sentry.io/platforms/react-native/integrations/error-boundary/), [Bluesky App.native.tsx](https://github.com/bluesky-social/social-app/blob/main/src/App.native.tsx).

### 3.2 Read receipts (Problem #2)
Universal pattern: a **single read watermark** per user per conversation (Telegram `read_inbox_max_id`, Slack `last_read`, Signal `last_read_message_id`, Sendbird channel-level). **Never per-message.** Mark-as-read fires **on open + on blur/leave**, not per incoming message (Sendbird docs explicitly warn against per-scroll/per-message calls → rate limits). The "Seen" the sender sees is a **cheap real-time push decoupled from the durable DB write** — Messenger's Iris keeps separate "sent to app" vs "written to storage" pointers and sheds read receipts before messages under load. Unread count is computed once on open from the watermark and cached in memory; inside an open chat it is definitionally 0.
Sources: [XEP-0333 (coalescing mandate)](https://xmpp.org/extensions/xep-0333.html), [Messenger infra — engineering.fb.com](https://engineering.fb.com/2014/10/09/production-engineering/building-mobile-first-infrastructure-for-messenger/), [IEEE Spectrum — "drop the read receipt, not the message"](https://spectrum.ieee.org/how-facebooks-software-engineers-prepare-messenger-for-new-years-eve), [Sendbird read receipts](https://sendbird.com/developer/tutorials/read-receipts-sendbird-chat), [Slack — Making Slack Faster By Being Lazy](https://slack.engineering/making-slack-faster-by-being-lazy/).

**Our takeaway:** the "Seen" stays instant because it rides the broadcast, which we keep firing immediately. Only the *DB persistence* is deferred. Schema is already correct (`conversation_members.last_read_at` / `last_read_message_id`).

### 3.3 Long threads (Problem #3)
Stream Chat's RN SDK (most mature open-source chat) implements an explicit **`maximumMessageLimit`** — cap the array, prune the tail on prepend, reset scroll trackers. Telegram's "jump to message" passes the target id with `add_offset` to fetch a window **centered on the target** and replaces the in-memory window — it does **not** page through everything in between. RN's official docs: `initialNumToRender` should fill ~one viewport (~10–20, not 50); `removeClippedSubviews` gives **no** memory benefit and is buggy on iOS (#37710, #30473) — skip it. `getItemLayout` is a trap for variable-height bubbles — leave off. FlashList v2 deprecated `inverted` and has open chat regressions (#1844, #1872, #1538) — stay on FlatList. Scroll-anchor-on-prune needs `maintainVisibleContentPosition` (iOS-native; Android via `@stream-io/flat-list-mvcp`).
Sources: [RN FlatList optimization](https://reactnative.dev/docs/optimizing-flatlist-configuration), [Stream MessageList (maximumMessageLimit)](https://github.com/GetStream/stream-chat-react-native/blob/develop/package/src/components/MessageList/MessageList.tsx), [Telegram offsets](https://core.telegram.org/api/offsets), [FlashList v2 chat regression #1844](https://github.com/Shopify/flash-list/issues/1844).

---

## 4. Design

Delivered as **one spec, three sequential phases** (they overlap in `DirectMessageScreen`/`DirectGroupChat`/`MessagingProvider`, so they cannot be parallelized — per the repo's `MessagingProvider` rule). Order: #1 → #2 → #3. Each phase is independently reviewable/committable.

### Phase 1 — Crash isolation *(lowest risk, ship first)*

**New components**
- `src/components/chat/ChatErrorBoundary.tsx` — thin wrapper over `react-error-boundary`'s `ErrorBoundary`. Props: `resetKeys` (e.g. `[conversationId]`), a `FallbackComponent` showing a friendly message + "Go back" and "Try again" (`resetErrorBoundary`) buttons, and `onError` → `Sentry.captureException(error, { extra: errorInfo })`. Uses `ff()` for fonts (per repo rule).
- `src/components/chat/SafeMessageBubble.tsx` — named per-item boundary (must be a named component, not inline JSX). Fallback: a muted "Message unavailable" row. `onError` → Sentry with the offending message id.

**Edge validation**
- A `sanitizeMessage(raw): Message | null` helper (in `src/services/messaging/messageSanitizer.ts`) applied where messages enter state: `chatHistoryCache` load and the realtime ingest path. Drops rows missing required fields (`id`, `conversation_id`, `created_at`, `type`) and logs a Sentry breadcrumb. Keeps the bad row out of the render tree entirely. **Hand-rolled** plain-TS validation (no new dependency) — `react-error-boundary` is the only dep added in Phase 1.

**Wiring**
- Wrap the *returned tree* of `DirectMessageScreen`, `DirectGroupChat`, and `ConversationsScreen` in `ChatErrorBoundary` (at the screen component, not the `Stack.Screen`).
- Wrap each row's output in `renderItem`/`renderMessage` with `SafeMessageBubble`.
- Do **not** touch `PostHogErrorBoundary` or `Sentry.init`; do not add `Sentry.ErrorBoundary` (avoid double-report).

**Acceptance criteria**
- Throwing inside one message bubble (temporary test throw) shows the placeholder; the rest of the thread and the app keep working.
- Throwing at screen render shows the fallback with working "Go back"; navigating away and back resets cleanly (`resetKeys`).
- The error reaches Sentry exactly once.

**Risk:** low. Additive; no behavior change on the happy path.

---

### Phase 2 — Read-receipt load *(keeps "Seen" instant)*

**Behavior change in the incoming-message path** (`DirectMessageScreen.tsx` ~`:665`, `DirectGroupChat.tsx` ~`:664`):
- On an incoming message while the chat is focused, **emit the read-receipt broadcast immediately** using the message id already in the payload — remove the extra `SELECT latest id`. This is what the sender's "Seen" listens to, so it stays instant.
- Set the conversation's unread to **0 locally and immediately** (dispatch `SET_UNREAD_COUNT 0`) — **remove the `getUnreadCount` recount** while the user is the active viewer.
- **Do not** issue the durable `UPDATE last_read_at` per message here.

**Durable watermark write (deferred, invisible):**
- New debounced path: persist `last_read_at` (and `last_read_message_id`) to `conversation_members` at most once per ~2s **and** flush on: screen blur/unmount, and `AppState` → `background`. This is the only durable write; it exists for cold-load, multi-device, and push-badge correctness.
- Implement as a small util (e.g. `messageOutbox`-style ref debounce in the screen, or a `markReadDebounced(conversationId, messageId)` in the provider). Must flush synchronously-enough on background/unmount that it isn't lost (use the `AppState` listener + unmount effect).

**`messagingService` adjustments:**
- Split today's `markAsRead` into: `broadcastReadReceipt(conversationId, messageId)` (cheap, no DB) and `persistReadWatermark(conversationId, messageId)` (the UPDATE). On open and on the debounced flush we call both as needed; per incoming message we call only the broadcast. Keep the existing `conversation_members` UPDATE postgres_changes listener (it's the sender's durable receipt path — do not remove).
- Keep `getUnreadCount` for the **list/inbox** paths (cold load, reconnect) — the change is only that an *open, focused* conversation does not recount per message.

**Read receipts are 1:1-only (groups excluded):**
- Group chats do not display a "Seen" indicator, so the read-receipt **broadcast is gated to direct chats** (`readReceiptsEnabled(isDirect)`). Groups generate zero read-receipt traffic (no member sends, so the listener never fires).
- Groups STILL get the instant local unread-badge clear and the debounced `last_read_at` persist — the inbox unread badge needs it, and that per-member watermark is exactly what a future group "seen by" would read.
- **Forward-compatible:** enabling group read receipts later is a one-line flip (`readReceiptsEnabled` → `true`, or per-group setting). New-messages-only by nature (live broadcast, never retroactive); no schema change (uses `conversation_members.last_read_at`).

**Acceptance criteria**
- Sender sees "Seen" with no added latency vs today (broadcast still immediate) — in 1:1 chats.
- Groups send/receive zero read-receipt broadcasts, yet their inbox unread badge still clears and persists.
- Opening a chat with N unread clears the badge instantly and persists once.
- A burst of M incoming messages in an open chat produces **0** per-message DB writes/counts (only broadcasts) and **≤1** durable `last_read_at` write per ~2s window.
- After force-quit/relaunch and on a second device, the read position is correct (watermark was flushed on background/blur).
- Unread badges on the inbox remain correct.

**Risk:** medium — touches `MessagingProvider` + `messagingService`. Mitigate by keeping the broadcast path byte-for-byte and only moving the DB write off the per-message path. Test multi-device + background flush on-device.

---

### Phase 3 — Long-conversation memory *(full approach)*

**FlatList tuning** (`DirectMessageScreen.tsx:3931-3933`, mirror in `DirectGroupChat.tsx`):
- `initialNumToRender 50 → 20`, `maxToRenderPerBatch 50 → 15`, `windowSize 21 → 7`.
- Leave `getItemLayout` off (variable height). Leave `removeClippedSubviews` off on iOS; optional `Platform.OS === 'android'` only if it measurably helps (no memory benefit expected).

**In-memory cap + prune:**
- Introduce `MAX_IN_MEMORY_MESSAGES = 250`. After any prepend (load older) or append (new message), prune the **off-screen** end so the array never exceeds the cap.
- Add `maintainVisibleContentPosition={{ minIndexForVisible: 1 }}` so pruning/prepending doesn't jump the viewport. iOS uses native support; add `@stream-io/flat-list-mvcp` for Android parity (the only new dep in this phase).
- Prune direction must respect scroll position: never drop items adjacent to the viewport. When scrolled to the bottom, trim oldest; when scrolled up reading history, trim the newest off-screen tail instead. Track via the existing `onScroll` distance-from-top/bottom.

**Reply-jump → fetch-around:**
- Replace the "loop `loadOlderMessages` up to 5×" logic (`:2700-2710`, group `:2637`) with a new `getMessagesAround(conversationId, targetMessageId, span=20)` in `messagingService.ts` (keyset query: `span` before + `span` after the target's `created_at`). On reply tap: if target is already in the window, scroll to it; else replace the window with the fetched slice, then `scrollToIndex`. Add a "Return to latest" affordance (Telegram-style) so the user can get back.
- Guard `scrollToIndex` with `onScrollToIndexFailed` (already present) + the post-layout retry.

**Acceptance criteria**
- Scrolling far up a 1000+ message thread keeps the in-memory array ≤ ~250 and memory flat (verify on-device).
- Scroll position does not jump when older pages load or the tail is pruned.
- Tapping an old quoted reply jumps correctly without loading all intermediate history; "Return to latest" works.
- Initial open and incremental scroll are visibly as smooth or smoother than today.

**Risk:** medium — pruning + scroll anchoring is the main regression surface (scroll jumps). FlatList prop changes alone are near-zero risk and could land first within the phase. Heavy on-device verification.

---

## 5. File-touch summary

| File | #1 | #2 | #3 |
|---|---|---|---|
| `src/components/chat/ChatErrorBoundary.tsx` (new) | ✓ | | |
| `src/components/chat/SafeMessageBubble.tsx` (new) | ✓ | | |
| `src/services/messaging/messageSanitizer.ts` (new) | ✓ | | |
| `DirectMessageScreen.tsx` | ✓ | ✓ | ✓ |
| `DirectGroupChat.tsx` | ✓ | ✓ | ✓ |
| `ConversationsScreen.tsx` | ✓ | | |
| `MessagingProvider.tsx` | | ✓ | |
| `messagingService.ts` | edge-validate ingest | split markAsRead | `getMessagesAround` |
| `chatHistoryCache.ts` | edge-validate load | | |
| deps | `react-error-boundary` | | `@stream-io/flat-list-mvcp` |

No DB schema changes. No Edge Functions. Broadcast stays the default transport.

---

## 6. Rollout

- Sequential phases on `ohad`; Ohad reviews and commits each phase.
- Each phase `tsc`-clean and on-device verified before the next.
- Phase 2 watched specifically for "Seen" latency + multi-device watermark; Phase 3 for scroll-jump regressions.
- If a phase regresses, it's isolated enough to revert without affecting the others.
