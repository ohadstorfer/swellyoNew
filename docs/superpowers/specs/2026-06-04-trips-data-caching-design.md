# Trips — data caching & smooth navigation (Tabs)

Date: 2026-06-04
Branch: ohad
Status: approved for implementation (tabs-only scope)

## Problem

The Trips feature re-fetches all data every time the user navigates between the
three pages (My Trips, Explore, Create) and every time they leave and re-enter
Trips. There is no cache, no shared store, and no react-query. Each tab holds
its data in local component state and fetches on mount (Explore = 3 Supabase
queries, My Trips = 4). Switching tabs remounts the other tab's component →
refetch. Leaving and reopening Trips fully unmounts `TripsScreen` → everything
reloads. This makes the UX feel slow and janky.

## Goal

Make navigation between Explore / My Trips / Create feel instant and fluid:
- No full-screen spinner when re-entering a tab that has been loaded before.
- Cached data shown immediately, refreshed silently in the background
  (stale-while-revalidate).
- Scroll position preserved when switching tabs.

## Scope (this iteration)

**Tabs only: Explore + My Trips.** Trip Detail (`TripDetailScreen`) is
explicitly deferred to a second iteration because it has ~20 mutations with
local optimistic updates and migrating it is higher risk. Create has no data
fetching and is unchanged (other than staying conditionally mounted).

## Approach

Adopt **TanStack Query (@tanstack/react-query v5)** as the data-cache layer.
SWR is its default behavior; the cache lives in the `QueryClient` (survives
component unmount), so re-entering a tab returns cached data instantly and only
revalidates in the background when stale.

### New files
- `src/lib/queryClient.ts` — singleton `QueryClient` with RN-safe defaults:
  - `staleTime: 5 min` (critical: default 0 would refetch on every remount)
  - `gcTime: 30 min` (must be ≥ staleTime)
  - `retry: 2`
  - `refetchOnWindowFocus: false` (no-op in RN; explicit for clarity)
  - `refetchOnReconnect: true`
- `src/hooks/trips/useTripQueries.ts` — `useExploreTrips()`, `useMyTrips(userId)`,
  and a `tripsKeys` key factory. Each wraps the existing `groupTripsService`
  functions; **no Supabase query logic changes.**

### Modified files
- `App.tsx`:
  - Wrap the app tree in `<QueryClientProvider client={queryClient}>` (inserted
    inside `PostHogErrorBoundary`, above all three render branches so every
    screen is covered).
  - Add an `AppState` `useEffect` wiring `focusManager` so queries can refresh
    when the app returns from background (native only).
- `src/utils/registerLogoutHandlers.ts`:
  - Register `() => queryClient.clear()` so User B never sees User A's cached
    trips. (In the logout registry, NOT in a component `useEffect`.)
- `src/screens/trips/TripsScreen.tsx`:
  - `ExploreTripsView`: replace `useState`/`useEffect`/`load` with
    `useExploreTrips()`; map `isLoading` → skeleton.
  - `MyTripsView`: replace local fetch with `useMyTrips(userId)`; map
    `isLoading` → skeleton, `isFetching && !isLoading` → `RefreshControl`,
    `refetch()` → pull-to-refresh.
  - Remove `myTripsVersion` state + `key={myTripsVersion}`. Replace the two
    bump sites (`handleCreated`, `handleSavedEdit`) with
    `queryClient.invalidateQueries(['trips','my', userId])` (and `['trips',
    'explore']` on create).
  - Keep Explore + My Trips **lazily mounted then kept mounted** via a
    `visited` set + `display:'none'` toggle, so switching tabs preserves scroll
    and never remounts. Create stays conditionally mounted (no data).

## Query keys

```
['trips','explore']        → listExploreTrips() + getTripCardMeta()
['trips','my', userId]     → listMyTripsByBucket(userId) + getTripCardMeta()
```

## Invalidation (replaces myTripsVersion key-bump)

- Create trip  → invalidate `['trips','my', userId]` + `['trips','explore']`
- Edit trip    → invalidate `['trips','my', userId]`

## Risks & mitigations (from pre-implementation audit)

1. `staleTime` default 0 → would defeat caching. **Set 5 min globally.**
2. NetInfo/`onlineManager` crashes Expo Go (Ohad tests there). **Not used this
   iteration** — zero native modules added.
3. Explore carousel resets scroll when `trips` array reference changes.
   react-query's structural sharing preserves the array reference on a no-op
   refetch, so a silent revalidate won't kick the scroll. Verify on device.
4. `refetchOnWindowFocus` is a no-op in RN. Instant-on-reentry works via
   mount + staleTime (cache survives unmount), not window focus. `focusManager`
   + AppState added for background→foreground refresh.
5. Logout must clear the cache — registered in the logout registry.

## Not in scope / deferred
- Trip Detail caching & mutation migration (iteration 2).
- `onlineManager`/NetInfo offline handling.
- Migrating mutations to `useMutation` (kept imperative + invalidate).

## Verification (manual, on device / Expo Go)
- Enter → leave → re-enter Trips: no full-screen spinner the second time.
- Switch Explore ↔ My Trips: no reload, scroll preserved.
- Create/edit a trip: My Trips updates without a force-remount flash.
- Log out → log in as another user: no stale trips from previous user.
