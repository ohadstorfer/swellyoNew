---
name: chat-long-list-memory
description: How to handle very long chat conversations in React Native — FlatList tuning, FlashList v2 status, sliding-window capping, inverted list pitfalls, and how big apps (Telegram, Stream) handle it
metadata:
  type: reference
---

## Summary
Swellyo's DirectMessageScreen keeps ALL loaded messages in one unbounded array with initialNumToRender=50, maxToRenderPerBatch=50, windowSize=21, no removeClippedSubviews, no getItemLayout. This creates unbounded memory growth for long sessions and slow reply-jumps that force-load many pages.

## How Big Apps Handle It

### Telegram
- API: `offset_id`-based pagination; typical page = 20–100 messages
- Jump-to-message: pass target message ID + `add_offset: -10` to get ±10 around it — does NOT load all messages in between; resets the client's in-memory window to that anchor
- Source: https://core.telegram.org/api/offsets

### Stream Chat (reference SDK — most relevant)
- Keeps a `maximumMessageLimit` cap; when hit, emits "pruning has happened, reset the trackers"
- Uses manual scroll listeners (not onEndReached/onStartReached) — FlatList's timing is too unreliable
- Source: https://github.com/GetStream/stream-chat-react-native/blob/develop/package/src/components/MessageList/MessageList.tsx

### WhatsApp
- Architecture reference: keeps "last 50 messages" per conversation in a Redis list with LTRIM
- Client-side: standard RecyclerView (Android) / UITableView (iOS) — both release off-screen cells by OS default

## FlatList Tuning for Chat (Official + Community Consensus)

**windowSize**: Official default is 21. Community and RN docs both agree: lower it to 5 for memory savings. Risk is blank areas during fast scroll. For chat (slower scrolling pattern than feeds), 5–7 is practical.

**removeClippedSubviews**: CRITICAL WARNING from official RN docs: "does not save significant memory because the views are not deallocated, only detached." On iOS it has known bugs — missing content with transforms or absolute positioning. Default is true on Android, false elsewhere. DO NOT rely on this for memory savings. Has known blank/empty FlatList bugs (#37710, #30473).

**maxToRenderPerBatch**: Default 10. For chat, 10–15 is fine. Higher = fewer blanks but longer JS blocking. The current value of 50 is excessive.

**initialNumToRender**: Default 10. For chat, 15–20 is enough to fill the screen. Current value of 50 is excessive and slows first render.

**getItemLayout**: Only useful when ALL items have the same height. Chat messages are variable height. Do not implement this — it will give wrong offsets and break scrollToIndex.

Source: https://reactnative.dev/docs/optimizing-flatlist-configuration

## FlashList v2 Status for Inverted Chat (2025) — DO NOT USE YET

FlashList v2 deprecated the `inverted` prop. Replacement is `maintainVisibleContentPosition` with `startRenderingFromBottom: true`. This has multiple open regressions:
- Issue #1844: onEndReached doesn't fire when scrolling up (breaks pagination)
- Issue #1872: startRenderingFromBottom not working at all in v2.0.3
- Issue #1698: maintainVisibleContentPosition forces scroll animation with no way to disable
- Issue #1538: keyboard insets applied to wrong side on inverted lists

FlashList v1 (with inverted prop) works fine and is production-stable, but v2's chat migration is broken as of mid-2025. Stick with FlatList or FlashList v1 for inverted chat for now.

Source: https://github.com/Shopify/flash-list/issues/1844, #1872, #1538

## Sliding-Window / Array Capping Pattern

**The right approach for "jump to message":** When user taps a reply that requires jumping far back in history (message not in current window), the correct industry pattern is:
1. Clear the messages array (or replace it)
2. Fetch N messages centered on the target (e.g., -10 to +10 relative to target ID)
3. Re-initialize the FlatList at the target index
This is what Telegram does at the API level.

**Array capping:** Cap at ~200–300 messages in memory. When loadMore prepends messages and the total exceeds cap, slice off the tail. To preserve scroll position when trimming the tail, use `maintainVisibleContentPosition`. The Stream SDK does this and calls it "pruning."

**InvertedFlatList + scrollToIndex on unrendered items:** If target index > what's been rendered, scrollToIndex silently fails. Fix: use onLayout per item + DeviceEventEmitter to know when target is rendered, then scroll. See: https://ikevin127.medium.com/react-native-auto-scrolling-to-inverted-flatlist-items-beyond-the-initial-render-limit-bff8f085444b

## removeClippedSubviews Truth

Many blog posts claim it reduces memory by 60%. The OFFICIAL RN docs say the opposite: "does not save significant memory because views are not deallocated, only detached." It helps main-thread rendering traversal only. It has active bugs on iOS with absolute positioning (relevant to chat bubbles). Skip it or use only on Android.

## Recommended Settings for Swellyo's Chat

Current vs recommended:
- initialNumToRender: 50 → 20
- maxToRenderPerBatch: 50 → 15
- windowSize: 21 → 7
- removeClippedSubviews: currently missing → leave off (iOS bugs + doesn't save memory)
- Add array cap: ~200–300 messages; trim tail when prepending
- Jump-to-message: implement the "clear + re-fetch around anchor" pattern for far jumps
