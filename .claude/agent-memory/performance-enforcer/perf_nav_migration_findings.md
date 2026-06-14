---
name: perf-nav-migration-findings
description: Root cause analysis of UI freeze ("stuff literally not moving") introduced by nav-migration commits in June 2026. Ranked findings with file:line pointers. Updated June 14 2026 with infinite-loop triage (phone hot, 7s taps).
metadata:
  type: project
---

# Nav-migration Performance Root Causes (June 10-11 2026)

**Why:** UI became severely janky / frozen after the nav-migration batch landed. This is the triage result.

## #1 — HIGHEST CONFIDENCE: mainNavValue object recreated every AppContent render

`src/components/AppContent.tsx` line ~1719:
```
const mainNavValue: MainNavContextValue = { … };
```
This is a plain object literal built inside the render function — NOT wrapped in `useMemo`. It contains ~12 sub-objects and ~20 callbacks. Every time any state in AppContent changes (auth state, tab changes, overlay flags, pendingConversation, scroll events, etc.) a NEW context value object is created. Every consumer of `useMainNav()` re-renders — that means `FloatingTabBar`, `LineupTabScreen`, `TripsTabScreen`, `ProfileTabScreen`, and every card screen wrapper (`ChatCardScreen`, `SwellyChatCardScreen`, etc.) in `RootNavigator.tsx` all re-render on every AppContent state change.

Fix: wrap `mainNavValue` in `useMemo` with stable deps.

## #2 — HIGH CONFIDENCE: detachInactiveScreens={false} + freezeOnBlur={false} = all 3 tabs always alive

`src/navigation/RootNavigator.tsx` lines ~389-396 (HomeTabs):
```js
detachInactiveScreens={false}
freezeOnBlur: false,
```
All three tab roots (Lineup, Trips, Profile) remain fully mounted and rendering at all times. Any re-render storm (see #1) hits all three. This is intentional for scroll-state preservation but makes #1 catastrophically worse.

## #3 — HIGH CONFIDENCE: 8 BlurView layers rendered on every frame in TripsBottomNav

`src/components/trips/TripsBottomNav.tsx` lines ~31-40 and ~284-298:
The `BLUR_BANDS` array has 8 `BlurView` components stacked on every render of the persistent floating bar. BlurView is GPU-expensive on iOS. These 8 blurs are inside an `Reanimated.View` with an `frostStyle` animated transform — the frost zone animates on every scroll event (collapse/expand). On a ProMotion device that's 120 calls/second times 8 BlurViews being re-composited. The bar lives above ALL screens and is never detached.

## #4 — HIGH CONFIDENCE: scrollEventThrottle={1} on TripDeck FlatList

`src/screens/trips/TripsScreen.tsx` line ~618 (commit f4532c2):
The Explore carousel fires a JS scroll event every single frame (120/s on ProMotion, 60/s on standard). Each event calls `scrollX.setValue(x)` (a JS-thread Animated.Value update), which drives 5 interpolations per card and `Math.abs` comparison + parent callback check. With 2 TripDeck carousels visible (Popular + Trip Operators) this is 2x 120 JS-thread events per second, each touching the React tree.

## #5 — MEDIUM CONFIDENCE: renderItem inline closure in MyTripsView FlatList

`src/screens/trips/TripsScreen.tsx` lines ~953-969:
```js
renderItem={({ item, index }) => {
  const card = (<TripCard … onPress={() => onOpenTrip(item.trip.id)} />);
  …
}}
```
The `renderItem` is an inline arrow function (new reference every render). `TripCard` and `ExploreTripCard` are NOT wrapped in `React.memo`. Every MyTripsView re-render (triggered by #1) re-renders all visible trip cards.

## #6 — MEDIUM CONFIDENCE: FloatingTabBar subscribes to nav state + calls useMainNav on every render

`src/navigation/RootNavigator.tsx` lines ~310-375 (`FloatingTabBar`):
`FloatingTabBar` calls `useMainNav()` pulling the entire context (see #1), AND it's the `tabBar` prop rendered by react-navigation which re-renders on every navigation state change. Combined: any nav event + any AppContent state change both cause FloatingTabBar to re-render.

## #7 — LOW CONFIDENCE: Two TripDeck instances with Animated.Value scroll tracking

When both "Popular" and "Trip Operators" sections have trips, two `TripDeck` components mount, each with its own `Animated.Value` and 5 interpolations per card. With N trips per carousel, 10N Animated nodes are live. Not catastrophic alone, but adds to the rendering budget.

**How to apply:** Fix #1 (useMemo on mainNavValue) first — it's the multiplier for all other re-renders. Then address #3 (reduce BlurView layers) and #4 (raise scrollEventThrottle back to 16).

---

# INFINITE LOOP TRIAGE — June 14 2026 (phone hot, 7s taps, continuous CPU)

Two changes landed together (commit ce76c7f by Ohad, June 10):
- Trips Broadcast topics via DB trigger
- Messaging fetch parallelization
- MessagingProvider now defaults to 'broadcast' realtimeMode

## CONFIRMED LOOP: `conversations` in MessagingProvider list-batch useEffect dep array

`src/context/MessagingProvider.tsx` lines 1255–1304

```ts
useEffect(() => {
  if (getRealtimeMode() === 'broadcast') return;   // <-- GATED OFF in current mode
  ...
  const key = [...ids].sort().join(',');
  if (key === listBatchKeyRef.current) return;     // <-- dedup guard
  ...
}, [conversations, user, isMessageProcessed, markMessageProcessed]);
```

In `broadcast` mode (the new default since ce76c7f) this effect returns immediately — it is NOT the active loop.

## PRIMARY SUSPECT: `handleInboxChange` useCallback dep → inbox broadcast effect

`src/context/MessagingProvider.tsx` lines 1115–1136 (handleInboxChange) and 1312–1337 (inbox effect).

`handleInboxChange` has an empty dep array `[]` — it is stable. The inbox broadcast effect depends on it and runs once. This is NOT a loop.

However: `handleInboxChange` calls `messagingService.getUnreadCount(conv.id)` in parallel for every updated conversation. If this triggers a state dispatch that causes a re-render that causes getConversationsUpdatedSince to re-fire, watch for a broadcast echo pattern.

## PRIMARY SUSPECT CONFIRMED: `conversations` dep on the AppState cache-flush effect

`src/context/MessagingProvider.tsx` lines 1169–1184:
```ts
useEffect(() => {
  const subscription = AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      if (conversations.length > 0) {
        saveCachedConversationList(conversations).catch(() => {});
      }
    }
  });
  return () => subscription.remove();
}, [conversations]);  // <-- re-registers AppState listener on EVERY conversations change
```

Every time `conversations` state changes (any new message, any unread update), this effect tears down and recreates the AppState listener. Each cycle removes the old listener and adds a new one. On a busy chat session with many messages, this fires many times per second. While not a true infinite loop, it contributes to JS thread load by repeatedly calling AppState.addEventListener/remove.

## THE ACTUAL INFINITE LOOP — broadcast echo via handleInboxChange

The real danger pattern in broadcast mode:

1. DB trigger fires broadcast → `subscribeToUserInbox` receives event
2. `handleInboxChange(conversationIds)` is called
3. Calls `getConversationsUpdatedSince(0, conversationIds)` — fetches from DB
4. Dispatches `SYNC_FROM_SERVER` → `conversations` state changes → new render
5. Calls `getUnreadCount` for each conversation → each call hits Supabase
6. Dispatches `SET_UNREAD_COUNTS` → `conversations` state changes → new render
7. Steps 4 and 6 each produce new `conversations` array identities

On its own this is not a loop (handleInboxChange only fires on broadcast event). BUT:

The `conversations` dep on the **list-batch effect** (line 1304) is gated off in broadcast mode, so that dedup guard doesn't apply.

The **debounced preload effect** (lines 1191–1232) fires on every `conversations` change with a 500ms debounce — relatively harmless.

The **cache-write effect** (lines 1146–1166) fires on every `conversations` change with a 2s debounce — relatively harmless.

## MOST LIKELY ACTUAL CAUSE: presence `notifyForWatchedUser` calling DB on every presence sync

`src/services/presence/userPresenceService.ts` lines 337–349:
```ts
private notifyForWatchedUser(userId: string): void {
  this.computeWatchedStatus(userId).then(isOnline => {
    const prev = this.lastNotifiedStatus.get(userId);
    if (prev === isOnline) return; // dedupe
    ...callbacks...
  })
}
```

`computeWatchedStatus` falls back to `getUserStatusFromDatabase` (a Supabase query) whenever the watch channel is not yet SUBSCRIBED. If channels are flapping (CHANNEL_ERROR → scheduleWatchRecovery → ensureWatchChannel → subscribe), every sync/join/leave event fires a DB query. With many conversations open and the new per-user topics, this can cascade.

The key question: are watch channels stable? If the private broadcast channels introduced in ce76c7f are causing websocket stress (too many channels), the presence watch channels will also start flapping, turning every presence sync into a DB query avalanche.

## VERDICT (ordered by confidence)

1. **Re-subscription storm from `conversations` dep (broadcast mode, lines 1255–1304)** — GATED OFF in broadcast mode, NOT the cause.
2. **AppState listener churn from `conversations` dep (lines 1169–1184)** — real but mild.
3. **Broadcast channel count explosion** — commit ce76c7f adds: 1 per-user inbox channel + 1 trips-list channel + 1 per-open-trip channel. If many trip detail screens were opened (nav migration = they stay mounted), channel count grows without bound, stressing the websocket → CHANNEL_ERROR on presence channels → DB query storm.
4. **The actual killer**: nav migration's `detachInactiveScreens=false` means every TripDetailScreen that was ever opened stays mounted → each calls `useTripRealtime(tripId)` → each holds a private broadcast channel open → websocket saturation → all channels start flapping → presence recovery loops fire → JS thread pegged.
