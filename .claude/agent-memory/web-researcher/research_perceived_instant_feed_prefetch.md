---
name: perceived-instant-feed-prefetch
description: TanStack Query v5 prefetch toolkit, feed prefetch depth, RN FlatList/viewability patterns, filter switching, latency numbers, and anti-patterns for a card-deck Explore feed
metadata:
  type: reference
---

## Topic
Perceived-instant card-feed (Explore deck) with TanStack Query v5 + Supabase + Expo RN. Covers: prefetch API, depth, FlatList integration, filter switching, latency/cost, anti-patterns.

## 1. TanStack Query v5 Prefetch Toolkit

### prefetchQuery vs ensureQueryData vs fetchQuery
| Method | Returns | Throws | Stale respects |
|---|---|---|---|
| `prefetchQuery` | `Promise<void>` | Never | Yes |
| `fetchQuery` | `Promise<TData>` | Yes | Yes |
| `ensureQueryData` | `Promise<TData>` | Yes | Bypasses (returns any cached) |

- **prefetchQuery**: fire-and-forget. Silently swallows errors. Correct for background warming. Never return its value.
- **fetchQuery**: use when you NEED the data in the calling code (e.g. route loader). Throws — must try/catch.
- **ensureQueryData(revalidateIfStale:true)**: returns stale cache immediately AND kicks off a background refetch. Best when you want instant return + background refresh. The `revalidateIfStale` flag is the v5 mechanism that replaced "always-return-cache" behavior.

Source: TanStack QueryClient reference + official prefetch guide (https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)

### useInfiniteQuery for "first page fast, load more"
- `initialPageParam` is **required** in v5 (breaking change from v4).
- `getNextPageParam(lastPage, allPages)` → return cursor or undefined/null to signal end.
- `fetchNextPage()` is safe to call even if in-flight — v5 de-dupes.
- Guard: always check `!isFetchingNextPage && hasNextPage` before calling fetchNextPage.
- `maxPages: N` limits how many pages stay in memory (use 5–10 for infinite feeds to cap memory).
- Prefetch next page proactively: call `queryClient.prefetchInfiniteQuery(...)` before user reaches end. Trigger at `onEndReachedThreshold: 0.5` (50% from bottom) to give a full RTT headroom.

Source: https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries

### placeholderData: keepPreviousData for filter switches
- In v5 `keepPreviousData` is **removed** as a prop — replace with `placeholderData: keepPreviousData` (imported from '@tanstack/react-query').
- While new data loads, the old data is shown. `isPlaceholderData: true` flag distinguishes it.
- This is the correct anti-flicker solution for filter/segment switching.

Source: TanStack Discussion #6460 + v5 migration guide (https://tanstack.com/query/v5/docs/react/guides/migrating-to-v5)

### staleTime / gcTime Tuning
Recommended values for this feed pattern:
```ts
// Global defaults
staleTime: 1000 * 60 * 5,   // 5 min — feed list doesn't change per-second
gcTime: 1000 * 60 * 30,     // 30 min — keep detail cache alive even after user backs out

// Per-query overrides
// Trip list: staleTime 5 min (trips don't change mid-session)
// Trip detail: staleTime 5 min — user just prefetched it, it must not re-fetch on navigation
// Filter variants: staleTime 5 min (same), gcTime 10 min
```
Key rule: **gcTime must be >= staleTime** or the cache entry will be GC'd while still "fresh", defeating the prefetch.

Canonical TanStack advice: set staleTime > 0 globally or every prefetch is wasted on next mount.

Source: Official defaults guide + tanstackship.com best practices (https://tanstackship.com/blog/tanstack-query-v5-best-practices)

### Prefetch Detail from List Row — Canonical Pattern
**Option A — Inside queryFn (populate on list load):**
```tsx
// In the list queryFn, after fetching list, prefetch each detail
for (const trip of trips) {
  queryClient.prefetchQuery({
    queryKey: ['trip', trip.id],
    queryFn: () => fetchTripDetail(trip.id),
    staleTime: 1000 * 60 * 5,
  })
}
```
This fires N parallel prefetches as soon as the list lands. Fine for 6–10 items. Becomes a storm at 50+ items (see anti-patterns).

**Option B — onPressIn (interaction-triggered, safest):**
```tsx
<TripCard
  onPressIn={() => queryClient.prefetchQuery({
    queryKey: ['trip', item.id],
    staleTime: 1000 * 60 * 5,
    queryFn: () => fetchTripDetail(item.id),
  })}
  onPress={() => navigation.navigate('TripDetail', { id: item.id })}
/>
```
Fires ~80–120ms before onPress resolves. On 4G that's almost the full round-trip — the detail often arrives before the screen transitions.

**Option C — onViewableItemsChanged (visibility-triggered, best for horizontal decks):**
See Section 3 below.

Source: Official TanStack prefetch guide + oneuptime.com RN blog (https://oneuptime.com/blog/post/2026-01-15-react-native-tanstack-query/view)

## 2. Prefetch Depth — How Many Items Ahead

Real-world data from Instagram's infrastructure (medium article cross-referencing internal signals):
- **WiFi, slow scroll**: 8–10 posts ahead
- **Cellular**: 3–4 items ahead
- **Adaptive (default approach)**: 5 items ahead in scroll direction, 1 behind

Mux engineering (TikTok-style video feed, React Native, 2024):
- `MAX_PRELOAD_DISTANCE = 5` (constant), drawDistance = 3 screen heights
- Preload is paused (not playing) to prefetch manifest/segments without audio cost

Reddit behavior:
- Cancels video prefetch downloads if user scrolls too fast (ByteByteGo reference)

**Practical rule of thumb for a horizontal card deck (10 or fewer cards):**
- Small deck (< 20 total items): **prefetch all on list load** — total cost is low (6 trips × 1 RPC = 6 background calls)
- Larger deck (20–50): **prefetch visible + 3 ahead** via onViewableItemsChanged
- Large feed (50+): **prefetch visible + 2 ahead**, adaptive based on network type

The trigger threshold that works: fetch the next page/batch when the user is at 50% of the current viewport from the end (`onEndReachedThreshold: 0.5`).

Source: Instagram prefetch article (https://medium.com/@jaivalsuthar/prefetching-at-scale-why-instagram-works-without-internet-a-deep-dive-into-predictive-caching-b58fc8332c4e), Mux blog (https://www.mux.com/blog/slop-social)

## 3. React Native Specifics

### FlatList onViewableItemsChanged
```tsx
const viewabilityConfig = useRef({
  itemVisiblePercentThreshold: 50,  // card > 50% visible
  minimumViewTime: 150,             // debounce fast scroll (ms)
}).current

const onViewableItemsChanged = useRef(({ viewableItems }) => {
  viewableItems.forEach(({ item, index }) => {
    // Prefetch the focused card
    queryClient.prefetchQuery({ queryKey: ['trip', item.id], ... })
    // Prefetch next N ahead (horizontal deck: next 2-3)
    const upcoming = trips.slice(index + 1, index + 3)
    upcoming.forEach(t => queryClient.prefetchQuery({ queryKey: ['trip', t.id], ... }))
  })
}).current

<FlatList
  onViewableItemsChanged={onViewableItemsChanged}
  viewabilityConfig={viewabilityConfig}
  horizontal
/>
```
CRITICAL: `onViewableItemsChanged` and `viewabilityConfig` must be **stable refs** (useRef or module-level). Defining them inline causes a React Native crash ("Changing onViewableItemsChanged on the fly is not supported").

### minimumViewTime as fast-scroll debounce
Setting `minimumViewTime: 100–200ms` prevents prefetch storms when the user flicks through cards. If the card disappears before 150ms, no prefetch fires.

### InteractionManager.runAfterInteractions
Use for deferring prefetch calls that are NOT needed immediately:
```tsx
InteractionManager.runAfterInteractions(() => {
  // prefetch cards that are 3+ away from viewport
  distantTrips.forEach(t => queryClient.prefetchQuery({ ... }))
})
```
Do NOT use it for the immediately-focused card — that prefetch should fire synchronously on visibility, not after interaction. Use InteractionManager only for low-priority warm-up (cards 4+ away).

### expo-image prefetch
```ts
// Prefetch cover images alongside API data
await Image.prefetch(tripIds.map(id => coverImageUrl(id)), 'memory-disk')
```
- Default cachePolicy for prefetch is `'memory-disk'` — correct for feeds.
- `recyclingKey` prop on FlashList is mandatory — prevents old image flashing before new one loads.
- Known issue #33412: `prefetch()` doesn't accept headers in the simple overload. Use the options overload: `Image.prefetch(urls, { cachePolicy: 'memory-disk', headers: { Authorization: '...' } })`.
- Promise resolves `false` on ANY single failure — don't rely on it for error handling; it's fire-and-forget.

Source: Expo image docs (https://docs.expo.dev/versions/latest/sdk/image/)

## 4. Filter/Segment Switching

**Client-side filtering (correct for small N, e.g. < 50 trips):**
- Load all trips once, filter in JS. Zero RTT on switch.
- Use `useMemo` to derive filtered list from the full cached set.
- `placeholderData: keepPreviousData` is NOT needed — no query key change, no refetch.
- Stale: trips data is fresh from the list query, so re-filtering is instant.

**Server-side filtering (needed when N > 50 or filters are complex/SQL-only):**
- Each filter combination gets its own query key: `['trips', { surfLevel: 'advanced', destination: 'bali' }]`
- Prefetch adjacent filter results: when user is on "beginner" filter, silently prefetch "intermediate".
- `placeholderData: keepPreviousData` is essential here — shows old results while new filter query loads.
- staleTime should match the list query (5 min).

**Decision threshold:**
< 20 items total → client-side, no question. 
20–100 items → client-side unless filter reduces set >80% (then server-side worth the latency).
100+ → server-side always.

Source: Simple-Table blog + dev.to filtering article + TanStack best practices

## 5. Real Latency Numbers

| Network | Median RTT | P90 RTT |
|---|---|---|
| 5G | 29–34ms | ~60ms |
| 4G LTE | 33–63ms | ~100ms |
| 3G | ~100ms | ~300ms |
| WiFi (local) | < 10ms | ~20ms |

Supabase PostgREST overhead: **a few ms** on top of network RTT (per Supabase docs).
Supabase Edge Function latency: cold = ~400ms median, warm = ~125ms median.

**Total estimated RTT for a Supabase PostgREST query on 4G:**
- Best case: 40ms (low-RTT 4G + fast Supabase region)
- Typical: 80–120ms
- Worst case (3G/poor signal): 300–500ms

**Prefetch payoff threshold:** If the action that reveals detail data (tap, scroll-into-view) happens > 100ms after the prefetch fires, prefetch wins on 4G. For 3G users, any prefetch > 200ms before tap pays off heavily.

**onPressIn fires ~80–120ms before onPress** resolves — on 4G that covers most of the RTT. Prefetch on press-in is the minimum viable strategy.

Source: Catchpoint 4G latency blog + Supabase latency docs + Supabase edge function perf blog (https://supabase.com/blog/persistent-storage-for-faster-edge-functions)

## 6. Anti-Patterns / Pitfalls

1. **Prefetch storm on scroll**: firing `prefetchQuery` for every onScroll event without debounce. Fix: use `minimumViewTime` in viewabilityConfig (150–200ms) to gate fires.

2. **Prefetch inside render loop**: calling prefetchQuery directly in a render function (not in a callback or useEffect). This re-fires on every render. Always put prefetch calls in event handlers, useEffect, or stable callbacks.

3. **Wasting prefetch with staleTime: 0**: If the consuming `useQuery` has `staleTime: 0` (the default), the detail screen will immediately re-fetch on mount even if the prefetch just completed. The prefetch is wasted. You **must** set matching staleTime on both the prefetch call AND the useQuery call.

4. **gcTime < staleTime**: cache entry GC'd before the user navigates. Detail screen shows loading spinner despite prefetch. Always gcTime >> staleTime.

5. **Prefetching Edge Functions** (e.g. Swelly AI): cold start is 400ms. Don't prefetch Edge Function responses — too expensive and usually personalized/non-cacheable. Only prefetch PostgREST/RPC results.

6. **Prefetching all 50+ detail items at list load**: fires 50+ concurrent requests. Supabase PostgREST has connection limits. Gate prefetch to viewport + N ahead.

7. **onViewableItemsChanged defined inline**: crashes React Native. Must be a stable ref.

8. **Infinite re-render with prefetchInfiniteQuery**: a known bug in earlier v5 versions where onSuccess triggers another prefetch. Use the `pages` limit parameter and validate `hasNextPage` before each call.

9. **expo-image recyclingKey omitted on FlashList**: previous trip's image briefly shows before the next one loads. Always set recyclingKey={item.id}.

10. **Prefetching data that's immediately stale**: if your trips update frequently (e.g., spots remaining decrements in real-time), staleTime of 5 min may show stale spot counts. Consider lower staleTime or a Supabase Realtime subscription for the specific count field rather than over-prefetching.

Source: TanStack discussions #3866, #6460 + Mux blog + Instagram engineering reference + community patterns

## Swellyo-Specific Synthesis (6-trips-now-but-growing Explore deck)

**Right now (6 trips):** Prefetch ALL detail inside the list queryFn as soon as the list loads. 6 parallel PostgREST RPCs at ~80ms each = ~80ms total (parallel). By the time the user sees the first card and taps, detail is cached. Zero observable loading.

**Growing to 20–50 trips:** Switch to onViewableItemsChanged + prefetch visible + 2 ahead + InteractionManager for 3+ ahead. Keep staleTime: 5 min on both list and detail.

**Filter switching:** Currently few trips → client-side filter on cached list. Don't introduce server-side filter queries until catalog exceeds ~50 trips. When you do, add `placeholderData: keepPreviousData` to the filter query.

**Image prefetch:** Call `Image.prefetch(visibleTrips.map(coverUrl))` as a fire-and-forget after the list query resolves. Use `memory-disk` policy.

**staleTime alignment is the #1 thing to get right:** if detail `useQuery` has staleTime:0 and prefetch has staleTime:5min, the prefetch is wasted every time. Match them.
