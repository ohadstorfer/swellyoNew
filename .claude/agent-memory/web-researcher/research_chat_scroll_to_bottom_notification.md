---
name: chat-scroll-to-bottom-notification
description: How major chat apps + RN chat libraries pin to newest message on chat open (incl. push-notification-open case) — inverted list pattern, initial-render race conditions, realtime-arrival scroll
metadata:
  type: reference
---

## Summary
Native chat apps (WhatsApp/Telegram/Signal/iMessage) all use a "flipped list" architecture: the scrollable container's Y-axis is inverted (UITableView `transform: scaleY(-1)` on iOS, RecyclerView reverseLayout on Android). RN's FlatList `inverted` prop is the direct equivalent. This makes "always start pinned to newest" close to free — index 0 in inverted data IS the visual bottom, so mounting with data already sorted newest-first lands there with no scroll call needed, as long as `contentContainerStyle` doesn't force it to grow away from that anchor.

Swellyo's `DirectMessageScreen.tsx` (line ~4627) already implements this correctly: `inverted` FlatList, `data={invertedMessages}` (newest-first via `.reverse()`), `contentContainerStyle={{flexGrow:1, justifyContent:'flex-end'}}`, and `maintainVisibleContentPosition={{minIndexForVisible:1}}` for iOS scroll anchoring during prepend/trim.

## The Notification-Open Case — Already Handled Correctly
Line ~910-934: `isNearBottomRef` defaults to `true` (declared `useRef(true)` at line 416) and is only set `false` by the onScroll handler once the user actually scrolls up. This means:
- Fresh mount (notification tap → cold or warm open) → ref is `true` by default → any realtime INSERT that lands after mount but before the user scrolls triggers `scrollToBottom()`.
- The dedupe-by-id logic (line 890) means if the pushed message was ALSO included in the initial history fetch (the normal case — it's just the newest row), the realtime INSERT is a no-op merge, not a duplicate append.
- This matches the flag-based approach GetStream's `stream-chat-react-native` MessageList uses internally (an `autoscrollToRecent` threshold + explicit suppression flag) — confirmed by reading their MessageList.tsx source directly.

## Known Race Conditions (from RN docs + community, confirmed relevant to your setup)
1. **`initialScrollIndex` + variable-height rows**: RN docs and multiple sources warn `initialScrollIndex` needs `getItemLayout` to be reliable, which requires fixed-height rows — chat bubbles are variable height, so `initialScrollIndex` is the WRONG tool here (matches existing note in `research_chat_long_list_memory.md`: "Only useful when ALL items have the same height... will give wrong offsets"). Not used in Swellyo's code — correct.
2. **`onContentSizeChange` + `scrollToEnd` race**: the classic non-inverted pattern (`onContentSizeChange={() => flatListRef.scrollToEnd()}`) fires before layout is committed on the first paint in some RN versions, causing a visible jump-after-render. Not needed at all with `inverted` + `justifyContent:'flex-end'` since there's no "scroll to end" step — the content is already anchored there structurally. This is the core reason inverted > normal-list-with-manual-scroll for the "always start at newest" requirement.
3. **Beyond-initial-render-limit scrolling** (relevant only for deep-link-to-specific-message, e.g. reply-jump, not the newest-message case): if target index hasn't been rendered yet (past `initialNumToRender`), `scrollToIndex` silently fails or throws. Fix pattern: `onScrollToIndexFailed` retry with a short delay (Swellyo already does this at line 3671-3679) OR per-item `onLayout` + event emitter to detect when the target row exists. Source: https://ikevin127.medium.com/react-native-auto-scrolling-to-inverted-flatlist-items-beyond-the-initial-render-limit-bff8f085444b
4. **Keyboard opening shifting viewport**: not a factor for the initial-landing case since the composer isn't focused on chat open; only matters once the user taps the input — Swellyo's `useChatKeyboardScroll` hook (line 560) already handles that separately with `inverted: true` passed in.

## What NOT to do (anti-patterns seen in the wild)
- `react-native-gifted-chat`'s inverted + `scrollToBottom` has multiple long-standing open GitHub issues: scrolling to the wrong end after `prepend()`, `scrollToBottom` button not working, auto-scroll not resuming after the user scrolls up then a new message arrives. Root cause pattern across these issues: they don't gate auto-scroll behind an "is user at bottom" ref/flag — Swellyo's `isNearBottomRef` gate avoids this class of bug entirely. Sources: https://github.com/FaridSafi/react-native-gifted-chat/issues/1474, /1486, /1240
- Don't use `onContentSizeChange` + manual `scrollToEnd()` for a supposedly-inverted list — redundant and reintroduces the exact jank inverted was meant to avoid.

## Verdict for Swellyo
No code change needed for the "notification tap → land at newest message" requirement — the architecture (inverted FlatList + default-true isNearBottomRef + dedupe-by-id realtime merge) already satisfies all 4 requirements in the original ask. If a bug is actually being observed, the likely real culprits are NOT the scroll pattern but: (a) initial history fetch not actually including the newest row (pagination/ordering bug), (b) `isNearBottomRef` getting set `false` by a stray onScroll event fired during mount/layout before user interaction, or (c) the realtime channel subscription not being established before navigation completes (channel-subscribe race, separate from scroll logic — check `useFocusEffect` timing per [[realtime_focus_gating]] pattern in main memory).

## Sources
- https://reactnative.dev/docs/flatlist (official inverted/initialScrollIndex/getItemLayout docs)
- https://ikevin127.medium.com/react-native-auto-scrolling-to-inverted-flatlist-items-beyond-the-initial-render-limit-bff8f085444b
- https://github.com/GetStream/stream-chat-react-native/blob/develop/package/src/components/MessageList/MessageList.tsx
- https://github.com/FaridSafi/react-native-gifted-chat/issues/1474, /1486, /1240, /975, /998
- https://www.swiftwithvincent.com/blog/building-the-inverted-scroll-of-a-messaging-app (native iOS flipped-tableview pattern, confirms `inverted` prop is the RN equivalent)
- Related: [[chat-long-list-memory]] (FlatList tuning already applied in this file)
