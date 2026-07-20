---
name: project_trip_detail_open_close_lag
description: Root-cause audit of progressive lag / JS-thread stall from repeatedly opening+closing TripDetail cards on 30+ distinct trips
metadata:
  type: project
---

Investigated 2026-07-18: TripDetailScreen's own effects/timers/listeners (scrollY
Animated listener, RAF focus-scroll poller, countdown setInterval in
TripDetailViewRedesigned, NotificationCenter bell's onNotification hub
subscription) are ALL correctly cleaned up on unmount, and `navigation.goBack()`
in RootNavigator.tsx (TripDetailCardScreen) does a real `StackActions` pop, so
TripDetailScreen genuinely unmounts (not just blurs) when the user backs out —
the developer's "popped cards unmount" premise holds.

The actual accumulation is in the shared TanStack QueryClient cache
(`src/lib/queryClient.ts`: staleTime 5min, gcTime 30min, global singleton —
survives unmount by design):

1. Every TripDetail open seeds up to 5 query keys (`tripsKeys.detail/
   detailUpdates/detailGear/detailRequests/detailGearRequests`, see
   `src/hooks/trips/useTripQueries.ts` tripsKeys + `src/hooks/trips/
   useTripDetail.ts`). None are evicted until 30min of inactivity (gcTime),
   so 30 distinct-trip cycles inside 30 min leaves ~90-150 cached queries.
2. `src/screens/trips/TripsScreen.tsx` ALSO prefetches `tripsKeys.detail(id)`
   for every trip that becomes 50%+ viewport-visible while scrolling the
   Explore deck (line ~605-633, `onViewableItemsChanged` -> `prefetchDetail`)
   and on card `onPressIn` (line ~426, ~1111) — so cache growth tracks trips
   *scrolled past*, not just trips actually opened. Much faster growth than
   the cycle count alone suggests.
3. `src/hooks/trips/useTripRealtime.ts`'s useFocusEffect fires 5 unconditional
   `queryClient.invalidateQueries({queryKey})` calls on EVERY single trip
   open (the "focus catch-up" block, lines ~49-55) — not throttled (unlike
   the list-level equivalent in useTripsListRealtime, which IS throttled to
   5 min).
4. CONFIRMED in node_modules (@tanstack/query-core queryClient.js:148-160 +
   queryCache.js:59-69 + utils.js:21-105): `invalidateQueries()` calls
   `queryCache.findAll(filters)` -> `getAll()` (materializes an array of
   EVERY cached query) -> `partialMatchKey` scan, THEN separately calls
   `refetchQueries({type:'active'})` which does ANOTHER full `findAll` scan.
   So each `invalidateQueries()` call is 2 synchronous full-cache-array
   scans on the JS thread, cost proportional to total cache size.
   `src/hooks/trips/useTripDetail.ts`'s `seedFromListCache()` also does a
   raw `queryClient.getQueryCache().getAll()` on every `useTripCore` mount
   to find the 'trips'/'my' seed data — same O(cache-size) cost, called
   once per open.

Net effect: as the cache grows across a 30-cycle session (bigger from
scroll-prefetch than from explicit opens), each subsequent trip open pays a
linearly growing, synchronous JS-thread cost for its 5 invalidateQueries +
1 seed-scan, i.e. sum is roughly O(N^2) in trips touched (opened+scrolled).
This is the most concrete, verified "progressive lag" mechanism found.

Secondary, lower-confidence contributors (network/socket churn, not memory):
- Each full open/close cycle also does 3 private-channel join+leave pairs
  on the shared realtime socket: `trip:{id}` (useTripRealtime), plus
  TripsScreen's `trips-list` + `trips-mine:{uid}` (useTripsListRealtime,
  blur/refocus around the pushed card). `removeChannel` cleanup is
  fire-and-forget (not awaited) in both hooks. Private channels each need a
  fresh authorization round-trip per subscribe. Bounded per cycle (no
  monotonic growth), but adds real-time protocol chatter — 90 extra
  join/leave events across 30 cycles.
- `logEventThrottled('trip_opened', ...)` writes one permanent AsyncStorage
  key per distinct tripId (`analytics_throttle_trip_opened_{tripId}_{uid}`),
  never cleaned — negligible perf impact (one-time disk write per trip),
  but is a permanently-growing AsyncStorage keyspace.

Ruled out (checked, clean): presence watching (TripDetail's participant
avatars don't call `subscribeToUserStatus` — that's only wired in
DirectMessageScreen/DirectGroupChat), MessagingProvider/conversation
prefetch (trip chat is only touched on explicit "Trip Chat" tap), NSE/video
players (TripDetailScreen has no expo-video usage), HomeTabsExtras'
`useNavigationState` selector (single stable subscription, not per-card).

Related: [[project_root_card_stack_growth_and_chat_leak]] (a different,
previously-found leak on the same card-stack architecture, but for chat
cards that are pushed-and-buried rather than popped).
