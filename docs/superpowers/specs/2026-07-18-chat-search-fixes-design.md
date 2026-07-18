# In-Chat Message Search — Reliability & UX Fixes (Design Spec)

**Date:** 2026-07-18
**Screens:** `DirectMessageScreen.tsx` (DM), `DirectGroupChat.tsx` (group) — the search code is byte-identical in both. Shared header: `src/components/chat/ChatSearchHeader.tsx`.
**Scope:** JS-only, OTA-able. No DB/RPC changes (`search_messages` RPC is sound).

## Background

In-chat search (WhatsApp-style header mode) finds up to 50 hits via the `search_messages` RPC and navigates them with ▲ (older) / ▼ (newer). A review found 6 issues; this spec covers the 6 approved fixes. Numbering matches the review.

## Fix 1 — Reliable off-window jump landing (BREAK)

**Problem:** The message list is an inverted FlatList with `initialNumToRender={20}`, `windowSize={7}`, no `getItemLayout`. Jumping to a hit at inverted index ~40 (after a `getMessagesAround` re-anchor with `span: 40`) targets an unmeasured row → `scrollToIndex` fails. The `onScrollToIndexFailed` handler retries the same `scrollToIndex` 100 ms later **without moving closer**, so it can fail again or land short; the highlight flashes off-screen and the press looks dead.

**Fix:** In `onScrollToIndexFailed` (both screens): immediately `scrollToOffset(info.averageItemLength * info.index, animated: false)` to get near the target so its rows render, then retry the precise `scrollToIndex` after 120 ms with `animated: false`. If the retry fails, the handler re-fires and converges. Keep the existing stale-index guard (`info.index < displayRowsRef.current.length`) on the retry — an out-of-range `scrollToIndex` throws (crash seen on device 2026-07-17).

**Acceptance:** Searching a term whose hits are hundreds of messages back and pressing ▲ repeatedly always lands centered on the highlighted hit. No crash when windows are replaced mid-retry.

## Fix 2 — Android hardware back closes search (BREAK)

**Problem:** No `BackHandler` for in-chat search — back pops the whole chat screen while the search bar is open. (The global `MessageSearchOverlay` already handles this correctly; mirror it.)

**Fix:** In both screens, while `chatSearchActive`, register a `hardwareBackPress` listener that calls `closeChatSearch()` and returns `true`. Remove on cleanup / when search closes.

**Acceptance:** Android back with search open closes the search bar and stays in the chat; a second back leaves the chat. iOS unaffected.

## Fix 3 — Auto-jump only when the top hit changes (UX)

**Problem:** Every 300 ms debounce tick re-runs the search and unconditionally jumps to `hits[0]` — typing "hello" progressively re-scrolls and re-flashes the same bubble several times, sometimes with a network re-anchor each time.

**Fix:** Track the last search-jump target in a ref (`lastSearchJumpRef`), updated by both the auto-jump and manual ▲/▼ navigation. After new results arrive, auto-jump **only if** `hits[0].messageId !== lastSearchJumpRef.current`. Reset the ref to `null` when the query drops below 2 chars and in `closeChatSearch` (a fresh search session always shows its top hit).

**Acceptance:** Typing a query incrementally where the newest match stays the same message scrolls/flashes once, not per keystroke. Changing the query so the top hit differs re-jumps. Navigating to hit 3, then editing the query, jumps back to the new top hit.

## Fix 4 — Dismiss keyboard on ▲/▼ (UX)

**Problem:** Arrows leave the keyboard up, so hits render in the small strip above it.

**Fix:** `Keyboard.dismiss()` at the top of `goToChatSearchHit` (both screens). Typing re-opens it naturally via the input. Matches WhatsApp.

**Acceptance:** First arrow press closes the keyboard; the hit centers in the full list area. Tapping the search input brings the keyboard back.

## Fix 5 — No blocking Alert on failed search jumps (UX)

**Problem:** If a hit's message was deleted after indexing (or the re-anchor fetch fails), `handleReplyPreviewPress` fires a modal `Alert.alert('Message not available', …)` mid-navigation.

**Fix:** Add `silent?: boolean` to `handleReplyPreviewPress` opts. All search-path calls (auto-jump + ▲/▼) pass `silent: true` → failures skip the Alert (the jump just doesn't happen). Reply-preview taps and the global-search target jump keep the Alert (unchanged default).

**Accepted edge:** on a silent failure the counter may point at a hit that wasn't reached — rare (deleted-between-search-and-jump), not worth hit-list surgery.

**Acceptance:** Deleting a matched message on another device, then arrowing onto it, shows no popup; reply-preview taps to unavailable messages still alert.

## Fix 7 — "50+" cap indicator (minor)

**Problem:** Hits are capped at 50 by the RPC; the counter reads "N of 50" as if exactly 50 matches exist.

**Fix:** `ChatSearchHeader` gets a `capped?: boolean` prop; when true the counter renders `N of 50+`. Screens pass `capped={chatSearchHits.length >= 50}` (50 = the `limit` passed to `searchMessages`). No pagination — display only, per decision.

**Acceptance:** A query with >50 matches shows "1 of 50+"; ≤50 matches shows plain "1 of N".

## Out of scope (explicitly deferred)

- **6:** distinct error state for RPC failure (still renders as "0 of 0").
- **7-pagination:** fetching pages beyond 50 via the RPC's `offset`.
- **8:** realtime merges into a re-anchored (trimmed) window — pre-existing, shared with reply-jumps.

## Verification approach

Project convention (no simulator/Maestro; Ohad tests on-device): each task verifies with `npx tsc --noEmit` scoped to the touched files; a final on-device checklist covers the acceptance criteria above. No commits — Ohad reviews and commits manually.
