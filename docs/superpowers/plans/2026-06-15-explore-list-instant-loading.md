# Explore List — Instant, Scale-Ready Loading: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Explore list's 2-query fetch with one `explore_feed` RPC consumed via `useInfiniteQuery`, and add viewport-gated detail prefetch + resilience so the deck loads and opens instantly and scales.

**Architecture:** A thin SECURITY DEFINER `explore_feed` RPC (keyset pagination) feeds an infinite query (public `{trips, meta, ...}` shape unchanged). Each horizontal snap deck prefetches the critical detail query for visible+ahead cards (cancellable, off the scroll frames) and triggers `fetchNextPage` by index. Resilience: error/retry, pull-to-refresh, realtime-only freshness.

**Tech Stack:** React Native 0.81, Expo 54, React 19, @tanstack/react-query v5, expo-image v3, @supabase/supabase-js 2.80, Postgres/Supabase, Jest + jest-expo.

**Spec:** `docs/superpowers/specs/2026-06-15-explore-list-instant-loading-design.md`

> **Commits:** Ohad commits manually. Commit steps are included per the skill but will be deferred — leave changes staged.
> **Pre-existing tsc errors** in `TripsScreen.tsx` (~247, ~453: RN `Image` + `pointerEvents` TS2769) and `AppContent.tsx` (~1972: OnboardingMatch) are unrelated — ignore them; only fix/avoid NEW errors.

---

## File map

- `supabase/migrations/20260615120000_explore_feed_rpc.sql` — **new** (reference copy; applied manually).
- `src/services/trips/groupTripsService.ts` — add `exploreFeed()` client fn + `ExploreFeedRow`; thread optional `signal` into `getTripById`/`getTripParticipants`/`getMyJoinRequest`.
- `src/hooks/trips/useTripQueries.ts` — `useExploreTrips` → infinite query; remove `exploreMeta`.
- `src/hooks/trips/useTripDetail.ts` — extract `fetchTripCore(tripId,userId,signal)`; null-guard; `seedFromListCache` flatten pages; `TripCoreData.trip` nullable.
- `src/components/AppContent.tsx` — prefetch via `prefetchInfiniteQuery`; drop meta follow-on.
- `src/screens/trips/TripsScreen.tsx` — deck pagination trigger + end skeleton, two viewability refs, append-vs-replace reset, `onPressIn`/a11y/recyclingKey/reduced-motion on card, error/retry + pull-to-refresh + warm FadeIn skip in `ExploreTripsView`.
- `src/screens/trips/exploreDeckPagination.ts` — **new** pure helpers (near-end, append-vs-replace, getNextPageParam) + tests.
- Tests under the existing `__tests__` dirs.

---

### Task 1: `explore_feed` RPC migration (manual apply)

**Files:** Create `supabase/migrations/20260615120000_explore_feed_rpc.sql`

- [ ] **Step 1: Write the migration file (reference copy)**

```sql
-- explore_feed: one-round-trip Explore list (trips + host name/avatar + count),
-- keyset paginated. SECURITY DEFINER but reads only public data (group_trips RLS
-- is USING(true); surfers RLS is USING(true); host name/avatar already public).
-- The visibility clause future-proofs against private/friends trips going live.

CREATE OR REPLACE FUNCTION public.explore_feed(
  p_limit int DEFAULT 10,
  p_cursor timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, host_id uuid, status text, hosting_style text, title text, hero_image_url text,
  start_date date, end_date date, dates_set_in_stone boolean, date_months text[],
  cost_per_person numeric, budget_min numeric, budget_max numeric,
  max_participants int, participant_count int, created_at timestamptz,
  destination jsonb, host_name text, host_avatar text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT gt.id, gt.host_id, gt.status, gt.hosting_style, gt.title, gt.hero_image_url,
         gt.start_date, gt.end_date, gt.dates_set_in_stone, gt.date_months,
         gt.cost_per_person, gt.budget_min, gt.budget_max,
         gt.max_participants, gt.participant_count, gt.created_at,
         (SELECT jsonb_build_object('name', d.name, 'short_label', d.short_label,
                   'country', d.country, 'admin_level_1', d.admin_level_1,
                   'lat', d.lat, 'lng', d.lng)
            FROM public.group_trip_destinations d WHERE d.trip_id = gt.id) AS destination,
         s.name AS host_name, s.profile_image_url AS host_avatar
  FROM public.group_trips gt
  LEFT JOIN public.surfers s ON s.user_id = gt.host_id
  WHERE gt.status = 'active'
    AND (gt.visibility IS NULL OR gt.visibility = 'public')
    AND (
      p_cursor IS NULL
      OR gt.created_at < p_cursor
      OR (gt.created_at = p_cursor AND gt.id < p_cursor_id)
    )
  ORDER BY gt.created_at DESC, gt.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS group_trips_status_created_id_idx
  ON public.group_trips (status, created_at DESC, id DESC);
```

- [ ] **Step 2: Apply manually + verify (Ohad runs in the Supabase SQL editor)**

Apply the SQL in the Supabase SQL editor (never `supabase db push`). Then verify:
```sql
-- shape + ordering
SELECT id, title, host_name, host_avatar, participant_count, destination
FROM public.explore_feed(10, NULL, NULL);
-- keyset second page (use the last row's created_at + id from above)
SELECT id, created_at FROM public.explore_feed(10, '<created_at>', '<id>');
```
Expected: active trips only, newest first, host fields populated, `destination` a JSON object (or null).

- [ ] **Step 3: Verify the security gate**

Anon call must 403:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/rpc/explore_feed" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{}'
```
Expected: `401` or `403` (NOT 200).

- [ ] **Step 4: Commit (deferred)**

```bash
git add supabase/migrations/20260615120000_explore_feed_rpc.sql
git commit -m "feat(trips): explore_feed RPC (keyset, thin, secured) — reference copy"
```

---

### Task 2: Client `exploreFeed()` service fn + signal-aware detail fetchers

**Files:** Modify `src/services/trips/groupTripsService.ts`

- [ ] **Step 1: Add `exploreFeed` + `ExploreFeedRow` (near `listExploreTrips`, ~487)**

```ts
/** A normalized explore trip row PLUS the host fields the RPC joins in. */
export type ExploreFeedRow = GroupTrip & { host_name: string | null; host_avatar: string | null };

/**
 * Explore list via the explore_feed RPC: trips + host name/avatar + count in ONE
 * round-trip, keyset-paginated. `signal` cancels the request when react-query
 * aborts (scroll-past / unmount).
 */
export async function exploreFeed(
  limit = 10,
  cursorCreatedAt: string | null = null,
  cursorId: string | null = null,
  signal?: AbortSignal,
): Promise<ExploreFeedRow[]> {
  let q = supabase.rpc('explore_feed', {
    p_limit: limit, p_cursor: cursorCreatedAt, p_cursor_id: cursorId,
  });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) { console.error('[groupTripsService] exploreFeed error:', error); throw error; }
  // normalizeTrip spreads the row + maps `destination`; host_name/host_avatar pass through.
  return (data || []).map((row: any) => normalizeTrip(row) as ExploreFeedRow);
}
```

- [ ] **Step 2: Thread optional `signal` into the 3 detail fetchers**

`getTripById` (~1362):
```ts
export async function getTripById(tripId: string, signal?: AbortSignal): Promise<GroupTrip | null> {
  let q = supabase.from('group_trips').select(`*, ${TRIP_DEST_EMBED}`).eq('id', tripId);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q.single();
  if (error) {
    if ((error as any).code === 'PGRST116') return null;
    console.error('[groupTripsService] getTripById error:', error);
    return null;
  }
  return data ? normalizeTrip(data) : null;
}
```

`getTripParticipants` (~1382) — add `signal?: AbortSignal` param; apply `.abortSignal(signal)` to BOTH internal queries (the `group_trip_participants` select and the `surfers` select) when present:
```ts
export async function getTripParticipants(tripId: string, signal?: AbortSignal): Promise<EnrichedParticipant[]> {
  let pq = supabase.from('group_trip_participants')
    .select('role, joined_at, user_id, committed, commitment_status, commitment_items, commitment_note, personal_gear_by_host, personal_gear_by_me')
    .eq('trip_id', tripId).order('joined_at', { ascending: true });
  if (signal) pq = pq.abortSignal(signal);
  const { data: rows, error } = await pq;
  // ... unchanged ...
  // for the surfers query:
  let sq = supabase.from('surfers').select(PARTICIPANT_PROFILE_FIELDS).in('user_id', userIds);
  if (signal) sq = sq.abortSignal(signal);
  const { data: surfers } = await sq;
  // ... rest unchanged ...
}
```

`getMyJoinRequest` (~1491) — add `signal?: AbortSignal` and apply `.abortSignal(signal)` to its query the same way.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "groupTripsService" || echo "clean"`
Expected: clean.

- [ ] **Step 4: Commit (deferred)**

```bash
git add src/services/trips/groupTripsService.ts
git commit -m "feat(trips): exploreFeed() client fn + abortSignal on detail fetchers"
```

---

### Task 3: Pure pagination helpers + tests

**Files:** Create `src/screens/trips/exploreDeckPagination.ts`, `src/screens/trips/__tests__/exploreDeckPagination.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { nextCursorFrom, isNearEnd, isAppend } from '../exploreDeckPagination';

describe('explore deck pagination helpers', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ created_at: `t${i}`, id: `id${i}` }));

  it('nextCursorFrom returns last row cursor only when the page is full', () => {
    expect(nextCursorFrom(rows(10), 10)).toEqual({ created_at: 't9', id: 'id9' });
    expect(nextCursorFrom(rows(7), 10)).toBeUndefined();   // partial last page → end
    expect(nextCursorFrom([], 10)).toBeUndefined();        // empty guard (no .at(-1) throw)
  });

  it('isNearEnd is true within 2 of the last index', () => {
    expect(isNearEnd(8, 10)).toBe(true);   // idx 8, length 10 → >= 8
    expect(isNearEnd(7, 10)).toBe(false);
    expect(isNearEnd(0, 1)).toBe(true);
  });

  it('isAppend detects a grown list with an unchanged prefix', () => {
    const a = [{ id: 'a' }, { id: 'b' }];
    expect(isAppend(a, [...a, { id: 'c' }])).toBe(true);   // appended
    expect(isAppend(a, [{ id: 'x' }, { id: 'b' }])).toBe(false); // prefix changed (filter/replace)
    expect(isAppend(a, [{ id: 'a' }])).toBe(false);        // shrank
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx jest src/screens/trips/__tests__/exploreDeckPagination.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/screens/trips/exploreDeckPagination.ts
export type ExploreCursor = { created_at: string; id: string };

/** Cursor for the next page: only when the last page came back FULL (else we're at the end). */
export function nextCursorFrom(
  lastPage: { created_at: string; id: string }[],
  limit: number,
): ExploreCursor | undefined {
  if (lastPage.length !== limit || lastPage.length === 0) return undefined;
  const last = lastPage[lastPage.length - 1];
  return { created_at: last.created_at, id: last.id };
}

/** True when the snapped card index is within 2 of the end (load-more trigger for a snap deck). */
export function isNearEnd(focusedIndex: number, length: number): boolean {
  return length > 0 && focusedIndex >= length - 2;
}

/** True when `next` is `prev` with extra items appended (page load), not a replacement (filter/invalidation). */
export function isAppend(prev: { id: string }[], next: { id: string }[]): boolean {
  if (next.length <= prev.length) return false;
  for (let i = 0; i < prev.length; i++) if (prev[i].id !== next[i].id) return false;
  return true;
}
```

- [ ] **Step 4: Run → pass**

Run: `npx jest src/screens/trips/__tests__/exploreDeckPagination.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit (deferred)**

```bash
git add src/screens/trips/exploreDeckPagination.ts src/screens/trips/__tests__/exploreDeckPagination.test.ts
git commit -m "feat(trips): pure explore-deck pagination helpers"
```

---

### Task 4: `useExploreTrips` → infinite query (remove exploreMeta)

**Files:** Modify `src/hooks/trips/useTripQueries.ts`; update `src/hooks/trips/__tests__/exploreKeys.test.ts`

- [ ] **Step 1: Update the exploreKeys test for the new shapes (this is the failing test)**

Replace the body of `src/hooks/trips/__tests__/exploreKeys.test.ts` with:
```ts
import { QueryClient } from '@tanstack/react-query';
import { tripsKeys } from '../useTripQueries';

describe('explore keys', () => {
  it('exploreMeta is removed', () => {
    expect((tripsKeys as any).exploreMeta).toBeUndefined();
  });

  it('invalidating explore (prefix) covers the infinite query cache entry', () => {
    const qc = new QueryClient();
    qc.setQueryData(tripsKeys.explore, { pages: [[]], pageParams: [null] });
    qc.invalidateQueries({ queryKey: tripsKeys.explore });
    expect(qc.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx jest src/hooks/trips/__tests__/exploreKeys.test.ts`
Expected: FAIL (`exploreMeta` still defined).

- [ ] **Step 3: Rewrite the hook + remove `exploreMeta`**

In `src/hooks/trips/useTripQueries.ts`:
- Change the import `useQuery` → add `useInfiniteQuery`, and `useMemo` from 'react': top of file `import { useQuery, useInfiniteQuery } from '@tanstack/react-query';` and `import { useMemo } from 'react';`.
- Add `exploreFeed, ExploreFeedRow` to the groupTripsService import.
- **Delete** the `exploreMeta` key from `tripsKeys`.
- Replace the current `useExploreTrips` (and the `EMPTY_TRIPS`/`EMPTY_META` consts if present) with:
```ts
const EXPLORE_PAGE_LIMIT = 10;
const EMPTY_META: Map<string, TripCardMeta> = new Map();

/**
 * Explore deck: one `explore_feed` RPC per page via useInfiniteQuery. Host name/
 * avatar/count come in each row (no separate meta query → no avatar pop-in).
 * Freshness comes from realtime invalidation, so we disable refetch-on-mount/
 * focus (avoids refetching all loaded pages when returning to the screen).
 */
export function useExploreTrips() {
  const q = useInfiniteQuery({
    queryKey: tripsKeys.explore,
    queryFn: ({ pageParam, signal }) =>
      exploreFeed(EXPLORE_PAGE_LIMIT, pageParam?.created_at ?? null, pageParam?.id ?? null, signal),
    initialPageParam: null as { created_at: string; id: string } | null,
    getNextPageParam: (last: ExploreFeedRow[]) =>
      last.length === EXPLORE_PAGE_LIMIT && last.length > 0
        ? { created_at: last[last.length - 1].created_at, id: last[last.length - 1].id }
        : undefined,
    maxPages: 10,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const trips = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);
  const meta = useMemo(() => {
    if (trips.length === 0) return EMPTY_META;
    const m = new Map<string, TripCardMeta>();
    for (const t of trips) {
      m.set(t.id, {
        hostName: t.host_name ?? null,
        hostAvatar: t.host_avatar ?? null,
        memberAvatars: [],
        totalCount: t.participant_count ?? 0,
      });
    }
    return m;
  }, [trips]);

  return {
    trips, meta,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
    isRefetching: q.isRefetching,
    hasNextPage: q.hasNextPage,
    fetchNextPage: q.fetchNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
  };
}
```

- [ ] **Step 4: Run → pass + typecheck**

Run: `npx jest src/hooks/trips/__tests__/exploreKeys.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "useTripQueries" || echo "clean"`
Expected: clean. (Errors in `useTripDetail.ts`/`AppContent.tsx` from the removed `exploreMeta` + cache shape are EXPECTED — fixed in Tasks 5–6.)

- [ ] **Step 5: Commit (deferred)**

```bash
git add src/hooks/trips/useTripQueries.ts src/hooks/trips/__tests__/exploreKeys.test.ts
git commit -m "feat(trips): useExploreTrips → infinite query over explore_feed; drop exploreMeta"
```

---

### Task 5: Cache-shape fix — `seedFromListCache` + `fetchTripCore` + null-guard

**Files:** Modify `src/hooks/trips/useTripDetail.ts`

- [ ] **Step 1: Make `TripCoreData.trip` nullable + null-guard**

Find the `TripCoreData` type (top of file) and change `trip: GroupTrip` → `trip: GroupTrip | null`.

- [ ] **Step 2: Flatten pages in `seedFromListCache` (~51)**

```ts
import type { InfiniteData } from '@tanstack/react-query';
// ...
const infinite = queryClient.getQueryData<InfiniteData<GroupTrip[]>>(tripsKeys.explore);
const exploreTrips = infinite?.pages.flat() ?? [];
const exploreTrip = exploreTrips.find(t => t.id === tripId);
```
(Leave the my-trips branch below it unchanged.)

- [ ] **Step 3: Extract `fetchTripCore` (shared by the hook + the deck prefetch) + use it**

Add (above `useTripCore`):
```ts
/** Critical trip-detail data (trip + participants + my join request), signal-aware.
 *  Shared by useTripCore AND the Explore deck's viewport prefetch so both prime the
 *  exact same query shape under tripsKeys.detail(tripId). */
export async function fetchTripCore(
  tripId: string, currentUserId: string | null, signal?: AbortSignal,
): Promise<TripCoreData> {
  const [tripData, participantsData] = await Promise.all([
    getTripById(tripId, signal),
    getTripParticipants(tripId, signal),
  ]);
  if (!tripData) return { trip: null, participants: [], myRequest: null };
  const userIsHost = !!currentUserId && tripData.host_id === currentUserId;
  const myRequest =
    userIsHost || !currentUserId ? null : await getMyJoinRequest(tripId, currentUserId, signal);
  return { trip: tripData, participants: participantsData, myRequest };
}
```
Then replace `useTripCore`'s `queryFn` body with `queryFn: ({ signal }) => fetchTripCore(tripId, currentUserId, signal),` (keep `placeholderData: () => seedFromListCache(queryClient, tripId)`).

- [ ] **Step 4: Minimal consumer guard for null trip**

In `src/screens/trips/TripDetailScreen.tsx`, find where `coreQuery.data.trip` (or the destructured `trip`) is first used to render, and add a guard right after the loading check: if the core query has resolved (`!coreQuery.isLoading && !coreQuery.isPlaceholderData`) and `trip` is `null`, render a minimal fallback (existing error/empty pattern in the file, or a `Text`: "This trip is no longer available." with a back button). Do not deep-polish — sub-project 2 owns the full UX.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "useTripDetail|TripDetailScreen" || echo "clean"`
Expected: clean (no `InfiniteData`/`trip` errors).

- [ ] **Step 6: Commit (deferred)**

```bash
git add src/hooks/trips/useTripDetail.ts src/screens/trips/TripDetailScreen.tsx
git commit -m "fix(trips): seed from infinite cache; shared fetchTripCore; null-trip guard"
```

---

### Task 6: Cache-shape fix — `AppContent` prefetch

**Files:** Modify `src/components/AppContent.tsx`

- [ ] **Step 1: Replace the explore prefetch effect body**

Find the once-guarded prefetch effect (gated on `shouldShowConversations`, ~1609-1625). Replace its body with a `prefetchInfiniteQuery` and remove the `exploreMeta` follow-on:
```ts
  const exploreWarmedRef = useRef(false);
  useEffect(() => {
    if (!shouldShowConversations || exploreWarmedRef.current) return;
    exploreWarmedRef.current = true;
    queryClient
      .prefetchInfiniteQuery({
        queryKey: tripsKeys.explore,
        queryFn: ({ pageParam, signal }: any) =>
          exploreFeed(10, pageParam?.created_at ?? null, pageParam?.id ?? null, signal),
        initialPageParam: null,
      })
      .catch(() => { /* best-effort */ });
  }, [shouldShowConversations]);
```

- [ ] **Step 2: Fix imports**

Replace the groupTripsService import names used here: remove `getTripCardMeta` (no longer used by this effect; keep only if used elsewhere in the file — grep first), keep/add `exploreFeed`. Remove the now-unused `GroupTrip`/`tripsKeys.exploreMeta` references in this effect.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "AppContent" | grep -v "1972" || echo "clean"`
Expected: clean (ignore the pre-existing 1972 error).

- [ ] **Step 4: Commit (deferred)**

```bash
git add src/components/AppContent.tsx
git commit -m "fix(trips): warm explore via prefetchInfiniteQuery on main-app entry"
```

---

### Task 7: Deck pagination trigger + end skeleton + append-safe reset

**Files:** Modify `src/screens/trips/TripsScreen.tsx`

- [ ] **Step 1: Thread infinite props into `ExploreTripsView` → `TripDeck`**

In `ExploreTripsView`, pull `hasNextPage, fetchNextPage, isFetchingNextPage` from `useExploreTrips()` and pass them to each `<TripDeck>` (Popular and Trip Operators). Add these to `TripDeck`'s prop type:
```ts
  onEndReachedNearby?: () => void;   // call to load the next page
  loadingMore?: boolean;             // show the end skeleton slot
```
Pass `onEndReachedNearby={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}` and `loadingMore={isFetchingNextPage}`.

- [ ] **Step 2: Trigger fetch by index in the deck's `onMomentumScrollEnd`**

In `TripDeck`, import the helpers: `import { isNearEnd, isAppend } from './exploreDeckPagination';`. In the existing `onMomentumScrollEnd` handler (added in Approach A for neighbour image prefetch), after computing `idx`, add:
```ts
        if (isNearEnd(idx, trips.length)) onEndReachedNearby?.();
```

- [ ] **Step 3: End skeleton card slot**

When `loadingMore`, render one extra skeleton slot at the end of the deck. Simplest: append a sentinel to the FlatList data and render a `<View style={styles.deckSlot}><ExploreDeckCardSkeleton/></View>` for it, OR set `ListFooterComponent` to a skeleton card sized `DECK_CARD_W × DECK_CARD_H`. Use the existing skeleton card from `src/components/skeletons/TripSkeletons.tsx` (the `ExploreCardSkeleton` shape) at deck-card size.

- [ ] **Step 4: Append-safe scroll reset**

The existing `useEffect([trips, scrollX])` that resets scroll to 0 must NOT fire on append. Replace it with a ref-tracked version:
```ts
  const prevTripsRef = useRef<typeof trips>([]);
  useEffect(() => {
    const prev = prevTripsRef.current;
    prevTripsRef.current = trips;
    if (isAppend(prev, trips)) return;   // page appended → keep scroll position
    scrollX.setValue(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [trips, scrollX]);
```

- [ ] **Step 5: Typecheck + run the helper tests**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "TripsScreen" | grep -vE "247|453" || echo "clean"`
Run: `npx jest src/screens/trips/__tests__/exploreDeckPagination.test.ts`
Expected: clean + tests pass.

- [ ] **Step 6: Commit (deferred)**

```bash
git add src/screens/trips/TripsScreen.tsx
git commit -m "feat(trips): snap-deck load-more by index + end skeleton + append-safe reset"
```

---

### Task 8: Viewport detail prefetch (two stable refs, off the scroll frames)

**Files:** Modify `src/screens/trips/TripsScreen.tsx`

- [ ] **Step 1: Imports + a prefetch helper**

Add: `import { InteractionManager } from 'react-native';`, `import { useQueryClient } from '@tanstack/react-query';`, `import { fetchTripCore } from '../../hooks/trips/useTripDetail';`, `import { tripsKeys } from '../../hooks/trips/useTripQueries';`. `TripDeck` needs `userId` — thread it from `ExploreTripsView` (which has it via the screen) as a prop.

In `TripDeck`:
```ts
  const queryClient = useQueryClient();
  const prefetchDetail = useCallback((id: string) => {
    InteractionManager.runAfterInteractions(() => {
      queryClient.prefetchQuery({
        queryKey: tripsKeys.detail(id),
        queryFn: ({ signal }) => fetchTripCore(id, userId ?? null, signal),
      });
    });
  }, [queryClient, userId]);
```

- [ ] **Step 2: Stable-ref viewability config + callback (one per TripDeck instance)**

```ts
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 150 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    for (const v of viewableItems) {
      const i = v.index;
      if (i == null) continue;
      for (let k = i; k <= i + 2; k++) {
        const t = trips[k];
        if (t) { prefetchDetail(t.id); CachedImage.prefetch(t.hero_image_url); }
      }
    }
  }).current;
```
Wire both onto the `Animated.FlatList`: `viewabilityConfig={viewabilityConfig}` `onViewableItemsChanged={onViewableItemsChanged}`. Because each `TripDeck` instance creates its own refs, the two decks (Popular + Operators) each get their own — no shared-ref conflict.
> NOTE: `trips` and `prefetchDetail` are captured by the ref closure at first render. Since `trips` changes identity on append, capture them via a ref that the callback reads: add `const liveRef = useRef({ trips, prefetchDetail }); liveRef.current = { trips, prefetchDetail };` and have the callback read `liveRef.current.trips` / `liveRef.current.prefetchDetail` so it always sees the latest without recreating the (mandatorily stable) callback.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "TripsScreen" | grep -vE "247|453" || echo "clean"`
Expected: clean.

- [ ] **Step 4: Commit (deferred)**

```bash
git add src/screens/trips/TripsScreen.tsx
git commit -m "feat(trips): viewport-gated detail prefetch (per-deck stable refs, deferred)"
```

---

### Task 9: Card — onPressIn prefetch, recyclingKey, a11y, reduced-motion

**Files:** Modify `src/screens/trips/TripsScreen.tsx` (`ExploreTripCard`)

- [ ] **Step 1: onPressIn safety net + accessibilityLabel**

`ExploreTripCard` needs `userId` (thread from `TripDeck` → card) and `queryClient`. On the card's `TouchableOpacity` add:
```tsx
        onPressIn={() => queryClient.prefetchQuery({
          queryKey: tripsKeys.detail(trip.id),
          queryFn: ({ signal }) => fetchTripCore(trip.id, userId ?? null, signal),
        })}
        accessibilityRole="button"
        accessibilityLabel={`${headline}${showLocation ? ', ' + location : ''}, ${formatTripDates(trip)}${spotsLeft != null ? `, ${spotsLeft} spots left` : ''}`}
```
(`queryClient` via `useQueryClient()` inside the card; `fetchTripCore`/`tripsKeys` already imported in the file from Task 8.)

- [ ] **Step 2: recyclingKey on the hero**

On the hero `CachedImage` (the one with the `placeholder={heroThumb…}` from Approach A) add `recyclingKey={trip.id}`.

- [ ] **Step 3: Reduced-motion on the blur-up**

Add `import { useReducedMotion } from 'react-native-reanimated';` (already a dependency). In `ExploreTripCard`: `const reduceMotion = useReducedMotion();` and set the hero's `transition={reduceMotion ? 0 : 150}`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "TripsScreen" | grep -vE "247|453" || echo "clean"`
Expected: clean.

- [ ] **Step 5: Commit (deferred)**

```bash
git add src/screens/trips/TripsScreen.tsx
git commit -m "feat(trips): card onPressIn prefetch + recyclingKey + a11y label + reduced-motion"
```

---

### Task 10: Resilience — error/retry, pull-to-refresh, warm-FadeIn skip, filter-empty heading

**Files:** Modify `src/screens/trips/TripsScreen.tsx` (`ExploreTripsView`)

- [ ] **Step 1: Error + retry state**

Pull `isError, refetch, isRefetching` from `useExploreTrips()`. Before the existing empty-state check, add:
```tsx
  if (isError && trips.length === 0) {
    return (
      <FadeInView style={styles.emptyState}>
        <Ionicons name="cloud-offline-outline" size={48} color="#B0B0B0" />
        <Text style={styles.emptyText}>Couldn't load trips. Check your connection.</Text>
        <TouchableOpacity style={styles.emptyCta} onPress={() => refetch()}>
          <Text style={styles.emptyCtaText}>Retry</Text>
        </TouchableOpacity>
      </FadeInView>
    );
  }
```
(Reuse `styles.emptyCta`/`emptyCtaText` from `MyTripsView`'s empty state.)

- [ ] **Step 2: Pull-to-refresh**

Add to the Explore `ScrollView`: `refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}` (`RefreshControl` is already imported in this file for My Trips).

- [ ] **Step 3: Keep the section heading on filter-empty**

In the render, ensure the `Popular` heading renders even when `filtered.length === 0` (move the heading above the `filtered.length === 0 ? … : …` branch so "No trips match these filters" appears UNDER a stable heading — no layout jump).

- [ ] **Step 4: Skip the FadeIn on a warm cache**

`ExploreTripsView` is wrapped in `<FadeInView>` (~855) that replays its 280ms animation on every tab switch even when data is warm. Gate it: render the inner content without `FadeInView` (or pass a `disabled`/`instant` prop if `FadeInView` supports one) when `!isLoading` at first mount. Simplest: only wrap the **skeleton** branch in `FadeInView`; render the loaded deck content without it (the cards' own `expo-image` transitions cover the visual). Verify `FadeInView`'s API in `src/components/FadeInView.tsx` and use its existing `delay`/disabled affordance if present.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "TripsScreen" | grep -vE "247|453" || echo "clean"`
Expected: clean.

- [ ] **Step 6: Commit (deferred)**

```bash
git add src/screens/trips/TripsScreen.tsx
git commit -m "feat(trips): explore error/retry + pull-to-refresh + stable heading + warm FadeIn skip"
```

---

### Task 11: Full verification

**Files:** none

- [ ] **Step 1: Run all new/affected tests**

Run: `npx jest src/screens/trips/__tests__/exploreDeckPagination.test.ts src/hooks/trips/__tests__/exploreKeys.test.ts src/services/trips/__tests__/exploreSelect.test.ts src/screens/trips/__tests__/deckPrefetch.test.ts`
Expected: all pass. (The A-era `exploreSelect`/`deckPrefetch` tests should still pass.)

- [ ] **Step 2: Typecheck whole project (only pre-existing errors remain)**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -vE "TripsScreen.tsx\(247|TripsScreen.tsx\(453|AppContent.tsx\(1972" | grep "error TS" || echo "no new errors"`
Expected: `no new errors`.

- [ ] **Step 3: Manual smoke (device, dev build) — RPC applied first**

1. Cold start → enter app → open Trips → Explore. First cards in ~1 RTT, **host avatar + name present immediately** (no pop-in). Hero blur-up → sharp.
2. Tap a card → **instant** (warm) or near-instant (onPressIn). Header seeds instantly.
3. Swipe to near the end (if >10 trips) → next page appends, **scroll position kept** (no snap to card 0), end skeleton shows while loading.
4. Filter switch → instant; empty filter shows "No trips match" under the heading (no jump).
5. Airplane mode cold load → error + Retry (not "no trips yet").
6. Pull-to-refresh works. Return-from-background does not visibly refetch all pages.
7. My Trips unchanged.

- [ ] **Step 4: Final commit (deferred)**

```bash
git add -A && git commit -m "chore(trips): explore instant-loading verification"
```

---

## Self-review (done while writing)

**Spec coverage:** §2 RPC → Task 1; client fn + signal → Task 2; helpers → Task 3; infinite hook + drop exploreMeta → Task 4; cache fixes (seed, fetchTripCore, null-guard) → Task 5; AppContent prefetchInfiniteQuery → Task 6; snap-deck pagination + end skeleton + append-safe reset → Task 7; viewport prefetch (2 refs, InteractionManager, signal) → Task 8; onPressIn + recyclingKey + a11y + reduced-motion → Task 9; error/retry + pull-to-refresh + warm-FadeIn + filter heading → Task 10; verify → Task 11. D1 (Popular includes all) honored (no exclusion filter added). Out-of-scope (detail screen internals) untouched beyond the minimal null-guard (D3). ✓

**Placeholder scan:** concrete code/SQL in every code step; the one judgement step (Task 5.4 / Task 10.4) points at the exact file + existing pattern to reuse, not a vague "handle it". ✓

**Type consistency:** `exploreFeed(limit, cursorCreatedAt, cursorId, signal)` and `ExploreFeedRow` used identically in Tasks 2/4/6; `fetchTripCore(tripId, userId, signal)` identical in Tasks 5/8/9; cursor `{created_at,id}` shape consistent in Tasks 3/4; `tripsKeys.detail(id)` for prefetch matches the detail hook key; `tripsKeys.exploreMeta` removed in Task 4 and never referenced after. ✓

**Risks flagged for the implementer:** the viewability callback must stay a stable ref but read live `trips` via a ref (Task 8 NOTE); `.abortSignal` must go on every sub-query, not just the wrapper (Task 2); the RPC must be applied + the anon-403 verified BEFORE the client ships (Task 1).
