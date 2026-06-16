---
name: perf-explore-instant-loading-audit
description: Audit of Explore-list instant-loading (useInfiniteQuery + prefetch machinery) shipped June 2026. Key violations and clean items documented.
metadata:
  type: project
---

# Explore Instant-Loading — Performance Audit (2026-06-15)

**Files audited:** useTripQueries.ts, useTripDetail.ts, groupTripsService.ts, TripsScreen.tsx, deckPrefetch.ts, exploreDeckPagination.ts, FadeInView.tsx, useTripsListRealtime.ts, queryClient.ts, AppContent.tsx.

## Violations found

### [IMPORTANT] Double fetchNextPage fire from two TripDecks
Both "Popular" and "Trip Operators" TripDeck receive identical `onEndReachedNearby` closures calling the same `fetchNextPage`. When both decks are visible and the user scrolls near the end of both, two `onMomentumScrollEnd` fires can call `fetchNextPage` before `isFetchingNextPage` becomes true. The `!isFetchingNextPage` guard is race-prone across two simultaneous callers. v5 de-dupes in-flight calls but it's still theoretically a double-fire on the same page.

### [IMPORTANT] onEndReachedNearby closures are inline (new on every render)
`onEndReachedNearby={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}` at lines 964 and 976 creates new function references every render. TripDeck receives these as props — if TripDeck were React.memo'd this would bust the memo every time. TripDeck is NOT memo'd (correct since it's not in a FlatList itself), but the inline closure is still avoidable and wasteful.

### [IMPORTANT] FadeInView uses async AccessibilityInfo (1-frame race for reduce-motion)
FadeInView.tsx line 51: `AccessibilityInfo.isReduceMotionEnabled()` is async. The animation starts on the callback, meaning on the very first frame reduce-motion may not yet be resolved — creates a 1-frame flash of translateY before snapping. Spec calls for Reanimated's synchronous `useReducedMotion()` here. Already used in TripsScreen for `ExploreTripCard`'s `transition` guard, but FadeInView still uses the async path.

### [NIT] operatorTrips computed inline (not memoized)
TripsScreen.tsx line 928: `const operatorTrips = filtered.filter(t => t.hosting_style === 'C')` runs on every render of ExploreTripsView. `filtered` is already memoized, so this is a cheap filter — but creating a new array every render causes TripDeck (the operators deck) to see a new `trips` prop reference every render, triggering its scroll-reset useEffect guard. The `isAppend` guard saves it from actually resetting scroll, but the effect still runs unnecessarily.

### [NIT] MyTripsView renderItem is an inline closure (no useCallback)
TripsScreen.tsx line 1075: `renderItem={({ item, index }) => { ... }}` — new function every render. MyTripsView re-renders when `filter`, `data`, `isLoading` change. At small list sizes this is irrelevant (6 trips), but it's against the best-practice for FlatList renderItem.

### [NIT] useTripsListRealtime fires invalidateSoon on every focus (not just real changes)
useTripsListRealtime.ts line 43: `invalidateSoon()` is called unconditionally on every `useFocusEffect` activation (i.e., every time the user returns to TripsScreen). This invalidates ALL explore pages even when nothing changed. With `refetchOnMount:false` on the explore query, an invalidation marks it stale and triggers a background refetch — so returning to the Trips screen always re-fetches the explore list, even with fresh data. This is partially intentional ("catch up on missed changes") but means the staleTime/refetchOnMount combo doesn't fully prevent refetches on focus return.

## Clean (no issue)

- staleTime/gcTime alignment: global 5min/30min, no per-query override on detail hooks. prefetchQuery inherits global default. Warm tap does NOT refetch detail. ✓
- AbortSignal threading: exploreFeed gets signal from useInfiniteQuery; getTripById, getTripParticipants, getMyJoinRequest all accept and use signal. ✓
- minimumViewTime:150 on viewabilityConfig (stable ref). ✓
- liveRef pattern: O(1) ref update per render, zero cost on scroll frames. ✓
- onViewableItemsChanged: stable ref (no inline crash). ✓
- viewabilityConfig: stable ref (no inline crash). ✓
- getItemLayout present (prevents measure on scroll). ✓
- keyExtractor present. ✓
- recyclingKey={trip.id} on hero image. ✓
- prefetchQuery is fire-and-forget (never awaited in event handlers). ✓
- getNextPageParam: length===limit && length>0 guard prevents .at(-1) throw on empty page. ✓
- maxPages:10 memory cap. ✓
- refetchOnMount:false + refetchOnWindowFocus:false on explore infinite query. ✓
- seedFromListCache reads InfiniteData<GroupTrip[]> correctly (pages.flat()). ✓
- AppContent uses prefetchInfiniteQuery with initialPageParam:null. ✓
- isAppend() guard in TripDeck scroll-reset useEffect prevents deck snapping to 0 on page append. ✓
- InteractionManager.runAfterInteractions wraps viewability prefetch (keeps it off scroll frames). ✓
- onPressIn prefetch is immediate (correctly NOT wrapped in InteractionManager). ✓
- exploreFeed uses EXPLORE_TRIP_SELECT (lean column list, not select('*')). ✓
- Error state: isError + trips.length===0 shows retry, not empty state. ✓
- Pull-to-refresh: RefreshControl present on Explore ScrollView. ✓
- FadeInView on skeleton branch only — warm cache renders plain View, no animation. ✓
- Two-deck pagination calibration at 6 trips: correct for current scale; upgrade to "prefetch all on list load" would be even more aggressive but current visible+2 is fine and scale-ready. ✓
