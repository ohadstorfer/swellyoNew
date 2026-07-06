---
name: notification-coldstart-navigation
description: React Navigation v7 + expo-notifications cold-start deep-link navigation — official linking-prop pattern vs imperative queue, and the exact bug found in Swellyo's own pushRootCard/requestTab code
metadata:
  type: project
---

## Official pattern (reactnavigation.org deep-linking docs)
`NavigationContainer`'s `linking` prop with custom `getInitialURL` + `subscribe` computes the FULL initial nav state (including nested tab + nested stack) BEFORE first render — no post-mount `navigate()` call, so no race with mount order.

```js
const linking = {
  prefixes: ['swellyo://', 'https://app.swellyo.com'],
  async getInitialURL() {
    const url = await Linking.getInitialURL();
    if (url != null) return url;
    const response = await Notifications.getLastNotificationResponseAsync();
    return response?.notification.request.content.data.url; // synthesize a url string from data payload
  },
  subscribe(listener) {
    const linkingSub = Linking.addEventListener('url', ({ url }) => listener(url));
    const pushSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data.url;
      listener(url);
    });
    return () => { linkingSub.remove(); pushSub.remove(); };
  },
};
```
Nested config shape (tabs -> nested stack):
```js
config: {
  screens: {
    HomeTabs: {
      screens: {
        Lineup: { screens: { Chat: 'chat/:conversationId' } },
        Trips: 'trips',
        Profile: 'profile',
      },
    },
  },
}
```
`NavigationContainer` shows `fallback` prop while `getInitialURL` resolves (or use `onReady` if there's a native splash screen already covering it).

**Critical gotcha (docs + Medium confirm):** conditionally rendering different root trees (e.g. auth gate swapping WelcomeScreen <-> RootNavigator) BREAKS this pattern — the linking config can't resolve into a screen that isn't mounted. Recommended real-world fix: keep all stacks (Public/Private/Boot) mounted under ONE stable NavigationContainer, dispatch a `reset`/`replace` between them post-auth instead of swapping the React tree. This directly matches Swellyo's own prior lesson in `boot-remount-freeze` memory (render provider tree once, don't remount).

## Imperative alternative
Queue-based pattern (react-native-firebase discussion #6738 consensus): maintain a list of pending nav actions; `navigate()` calls always succeed by enqueueing if not ready; drain queue in `NavigationContainer`'s `onReady`. `isReady()` alone is NOT reliable for conditional gating in notification handlers — it can return false during exactly the window a killed-app notification tap needs it, and there's no guarantee `onReady` fires again after that window (issue: onReady only fires once per container mount, not on every backgrounding).

## Swellyo-specific bug found (2026-07-06)
Diagnosed the ACTUAL root cause in this codebase, not just the general pattern:
- `pushRootCard()` in `src/navigation/navigationRef.ts` silently `return`s if `!navigationRef.isReady()` — no queue, no retry, drops the push.
- `HomeTabsExtras`'s tab-switch effect in `src/navigation/RootNavigator.tsx` (~line 445) calls `onRequestedTabConsumed()` unconditionally, even when `isReady()` was false and `navigate()` never ran — so the request is marked "consumed" while nothing happened. This is the exact "navigate consumed but tab didn't switch" symptom.
- `src/components/AppContent.tsx` (~line 406-414): DM push notifications use the OLD pattern — `setPendingNotificationConversationId` + `requestTab('lineup')` (nested-stack, ConversationsScreen consumes the pending id) — while trip/group-chat notifications already use the NEWER, race-proof `pushRootCard('ChatCard', {...})` pattern (root-stack card, covers everything regardless of active tab, same as `requestedTripCard` queuing already does successfully for TripDetail deep links). **DM notifications were simply never migrated to the pattern that already fixed this exact bug class for trips.**
- Blocker for migrating DM path directly: `ChatCard` needs `otherUserName`/`otherUserAvatar`, which the push payload doesn't carry (only `conversationId`) — existing call sites resolve this from `MessagingProvider`'s already-loaded conversations list or a Supabase fetch. On cold start that list may not be loaded yet, so the fix needs a `requestedChatCard` state (resolved async, same shape as `requestedTripCard`) rather than pushing synchronously.

## Recommended fix ranking for Swellyo
1. **Best/long-term**: adopt the `linking` prop pattern, but only after (or alongside) the boot-tree-swap fix — don't attempt it while AppContent still conditionally swaps root trees.
2. **Pragmatic/surgical (lowest risk, matches existing validated pattern)**: add `requestedChatCard` state mirroring `requestedTripCard`; resolve other-user info async (Supabase or MessagingProvider cache); consume it inside `HomeTabsExtras` via `pushRootCard('ChatCard', ...)`, same as trips already do. Deletes the `requestTab('lineup')` + nested-ConversationsScreen-pending-id path for notification-originated DM opens.
3. **Belt-and-suspenders**: replace the silent-drop `isReady()` checks in `pushRootCard` and the tab-switch effect with an actual queue that retries on `onReady`/next mount, per the react-native-firebase-recommended pattern.

## Sources
- https://reactnavigation.org/docs/deep-linking/
- https://reactnavigation.org/docs/configuring-links/
- https://reactnavigation.org/docs/navigation-container/
- https://github.com/invertase/react-native-firebase/discussions/6738
- https://github.com/expo/expo/issues/22969
- https://github.com/react-navigation/react-navigation/issues/10380
- https://itsitdude.medium.com/react-native-navigation-flow-deep-linking-b91d3237baf7
- https://github.com/react-navigation/react-navigation/issues/12601
- https://github.com/react-navigation/react-navigation/issues/9725

**Why:** Researched 2026-07-06 for cold-start push notification -> chat screen deep link bug (Swellyo uses native `@bottom-tabs/react-navigation`, root-stack + tabs + nested ConversationsStack).
**How to apply:** See [[research_rnbt_native_bottom_tabs]] for native-tab-bar quirks; see boot-remount-freeze (auto-memory) for why the linking-prop fix needs the tree-swap fix first.
