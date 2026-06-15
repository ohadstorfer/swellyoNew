# Explore Trips — Faster Initial Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Explore deck's cold first-card paint near-instant by decoupling avatar/meta loading from first paint, warming the cache on main-app entry, trimming the query, and adding image blur-up + neighbour prefetch — keeping the existing horizontal deck.

**Architecture:** Approach A (client-only, no schema/RPC). `useExploreTrips` splits into a trips-only query (`['trips','explore']`) that paints the deck, plus a nested meta query (`['trips','explore','meta',…]`) that fills avatars in progressively. The nesting means existing `tripsKeys.explore` invalidations still cover meta. A once-guarded prefetch on main-app entry warms both. `ExploreTripCard` gets a tiny transform-thumbnail blur-up placeholder; the deck prefetches neighbour hero images.

**Tech Stack:** React Native 0.81, Expo 54, React 19, `@tanstack/react-query` v5, `expo-image` v3, Supabase, Jest + jest-expo.

**Spec:** `docs/superpowers/specs/2026-06-15-explore-trips-fetch-speed-design.md`

---

## File map

- `src/services/trips/groupTripsService.ts` — add `EXPLORE_TRIP_SELECT`; trim `listExploreTrips`.
- `src/hooks/trips/useTripQueries.ts` — add `tripsKeys.exploreMeta`; split `useExploreTrips`; drop `ExploreData`.
- `src/screens/trips/TripsScreen.tsx` — consume split hook; blur-up placeholder; neighbour prefetch.
- `src/screens/trips/deckPrefetch.ts` — **new**, pure `neighbourHeroUrls` helper (isolated for testing).
- `src/hooks/trips/useTripDetail.ts` — read explore cache as `GroupTrip[]`.
- `src/components/AppContent.tsx` — once-guarded prefetch on main-app entry.
- Tests (new): `src/services/trips/__tests__/exploreSelect.test.ts`, `src/hooks/trips/__tests__/exploreKeys.test.ts`, `src/screens/trips/__tests__/deckPrefetch.test.ts`.

> **Note on commits:** Ohad reviews/commits manually. Commit steps below are written per the skill; if executing inline, you may stage and let Ohad commit. Confirm before pushing.

---

### Task 1: Trim `listExploreTrips` columns

**Files:**
- Modify: `src/services/trips/groupTripsService.ts` (near `TRIP_DEST_EMBED` at 334-335; `listExploreTrips` at 487-500)
- Test: `src/services/trips/__tests__/exploreSelect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/trips/__tests__/exploreSelect.test.ts
// Mock the supabase client so importing the service doesn't init a real client
// (mirrors src/services/notifications/__tests__/notificationsService.test.ts).
jest.mock('../../../config/supabase', () => ({ supabase: {} }));

import { EXPLORE_TRIP_SELECT } from '../groupTripsService';

describe('EXPLORE_TRIP_SELECT', () => {
  it('includes every field ExploreTripCard reads', () => {
    const required = [
      'id', 'host_id', 'hosting_style', 'title', 'hero_image_url',
      'start_date', 'end_date', 'dates_set_in_stone', 'date_months',
      'cost_per_person', 'budget_min', 'budget_max',
      'max_participants', 'participant_count', 'created_at',
    ];
    for (const f of required) expect(EXPLORE_TRIP_SELECT).toContain(f);
    // destination embed (location label)
    expect(EXPLORE_TRIP_SELECT).toContain('group_trip_destinations');
  });

  it('does not fall back to select-all', () => {
    expect(EXPLORE_TRIP_SELECT).not.toContain('*');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/trips/__tests__/exploreSelect.test.ts`
Expected: FAIL — `EXPLORE_TRIP_SELECT` is not exported.

- [ ] **Step 3: Add the constant and use it**

In `src/services/trips/groupTripsService.ts`, immediately after the
`TRIP_DEST_EMBED` definition (around line 335), add:

```ts
// Columns the Explore deck card (ExploreTripCard) actually reads. Keep in sync
// with that component — verified against formatTripPrice / formatTripDates /
// formatDestination / normalizeTrip. Replaces select('*') so the explore query
// stays lean (and lean to parse) as the trip table grows wider.
export const EXPLORE_TRIP_SELECT = [
  'id', 'host_id', 'hosting_style', 'title', 'hero_image_url',
  'start_date', 'end_date', 'dates_set_in_stone', 'date_months',
  'cost_per_person', 'budget_min', 'budget_max',
  'max_participants', 'participant_count', 'created_at',
  TRIP_DEST_EMBED,
].join(', ');
```

Then change `listExploreTrips` (line 490) from:

```ts
    .select(`*, ${TRIP_DEST_EMBED}`)
```

to:

```ts
    .select(EXPLORE_TRIP_SELECT)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/trips/__tests__/exploreSelect.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/services/trips/groupTripsService.ts src/services/trips/__tests__/exploreSelect.test.ts
git commit -m "perf(trips): trim listExploreTrips to card-needed columns"
```

---

### Task 2: Add nested `exploreMeta` key + split `useExploreTrips`

**Files:**
- Modify: `src/hooks/trips/useTripQueries.ts`
- Test: `src/hooks/trips/__tests__/exploreKeys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/trips/__tests__/exploreKeys.test.ts
import { QueryClient } from '@tanstack/react-query';
import { tripsKeys } from '../useTripQueries';

describe('exploreMeta key nesting', () => {
  it('builds a key nested under explore', () => {
    expect(tripsKeys.exploreMeta(['x', 'y'])).toEqual(['trips', 'explore', 'meta', 'x,y']);
  });

  it('invalidating explore also invalidates the nested meta query', () => {
    const qc = new QueryClient();
    qc.setQueryData(tripsKeys.explore, []);
    qc.setQueryData(tripsKeys.exploreMeta(['x']), new Map());

    qc.invalidateQueries({ queryKey: tripsKeys.explore });

    expect(qc.getQueryState(tripsKeys.explore)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(tripsKeys.exploreMeta(['x']))?.isInvalidated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/hooks/trips/__tests__/exploreKeys.test.ts`
Expected: FAIL — `tripsKeys.exploreMeta` is not a function.

- [ ] **Step 3: Add the key and split the hook**

In `src/hooks/trips/useTripQueries.ts`, add to the `tripsKeys` object (after the
`explore` line, line 25):

```ts
  // Nested UNDER explore so any invalidateQueries({ queryKey: tripsKeys.explore })
  // (realtime, post-edit, etc.) also invalidates the meta query — no extra call
  // sites to keep in sync. Parameterised by trip ids so it auto-refetches when
  // the trip set changes.
  exploreMeta: (ids: string[]) => ['trips', 'explore', 'meta', ids.join(',')] as const,
```

Replace the `ExploreData` type (line 34) and `useExploreTrips` (lines 38-47) with:

```ts
export type MyTripsData = { buckets: MyTripsBuckets; meta: Map<string, TripCardMeta> };

const EMPTY_TRIPS: GroupTrip[] = [];
const EMPTY_META: Map<string, TripCardMeta> = new Map();

/**
 * Explore deck. Split into two queries so the deck paints from the trips query
 * alone (1 round-trip); avatars/host names load via the nested meta query and
 * fill in progressively. `isLoading` gates the skeleton on TRIPS only.
 */
export function useExploreTrips() {
  const tripsQuery = useQuery<GroupTrip[]>({
    queryKey: tripsKeys.explore,
    queryFn: () => listExploreTrips(),
  });
  const trips = tripsQuery.data ?? EMPTY_TRIPS;

  const metaQuery = useQuery<Map<string, TripCardMeta>>({
    queryKey: tripsKeys.exploreMeta(trips.map(t => t.id)),
    enabled: trips.length > 0,
    queryFn: () => getTripCardMeta(trips),
  });

  return {
    trips,
    meta: metaQuery.data ?? EMPTY_META,
    isLoading: tripsQuery.isLoading,
    isMetaLoading: metaQuery.isLoading,
  };
}
```

(Delete the old `ExploreData` type export — `MyTripsData` stays. `useMyTrips`
is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/hooks/trips/__tests__/exploreKeys.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/trips/useTripQueries.ts src/hooks/trips/__tests__/exploreKeys.test.ts
git commit -m "perf(trips): split explore into trips + nested meta query (progressive)"
```

---

### Task 3: Update consumers of the explore cache shape

The explore cache now stores `GroupTrip[]` (not `{trips, meta}`). Two consumers
read it.

**Files:**
- Modify: `src/screens/trips/TripsScreen.tsx:798-800`
- Modify: `src/hooks/trips/useTripDetail.ts:27, 51-52`

- [ ] **Step 1: Update `ExploreTripsView`**

In `src/screens/trips/TripsScreen.tsx`, replace lines 798-800:

```ts
  const { data, isLoading } = useExploreTrips();
  const trips = data?.trips ?? [];
  const meta = data?.meta ?? EMPTY_META;
```

with:

```ts
  const { trips, meta, isLoading } = useExploreTrips();
```

(`EMPTY_META` at line 783 is now unused by this view but is still referenced by
`MyTripsView` — leave it. If `tsc` reports it unused, it isn't; keep it.)

- [ ] **Step 2: Update `seedFromListCache`**

In `src/hooks/trips/useTripDetail.ts`, change the import on line 27 from:

```ts
import type { ExploreData, MyTripsData } from './useTripQueries';
```

to:

```ts
import type { MyTripsData } from './useTripQueries';
import type { GroupTrip } from '../../services/trips/groupTripsService';
```

Then replace lines 51-52:

```ts
  const exploreData = queryClient.getQueryData<ExploreData>(tripsKeys.explore);
  const exploreTrip = exploreData?.trips.find(t => t.id === tripId);
```

with:

```ts
  const exploreTrips = queryClient.getQueryData<GroupTrip[]>(tripsKeys.explore);
  const exploreTrip = exploreTrips?.find(t => t.id === tripId);
```

(If `GroupTrip` is already imported in this file, don't duplicate the import —
just add it to the existing import list.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors mentioning `useTripDetail.ts`, `TripsScreen.tsx`, or
`ExploreData`.

- [ ] **Step 4: Commit**

```bash
git add src/screens/trips/TripsScreen.tsx src/hooks/trips/useTripDetail.ts
git commit -m "refactor(trips): consume split explore hook + GroupTrip[] cache shape"
```

---

### Task 4: Prefetch Explore on main-app entry (once-guarded)

**Files:**
- Modify: `src/components/AppContent.tsx` (add effect near the existing
  "entering main app" effect at ~1589-1599)

- [ ] **Step 1: Ensure imports**

At the top of `src/components/AppContent.tsx`, make sure these are imported (add
any that are missing — `useRef`/`useEffect` are almost certainly already there):

```ts
import { useQueryClient } from '@tanstack/react-query';
import { tripsKeys } from '../hooks/trips/useTripQueries';
import { listExploreTrips, getTripCardMeta, GroupTrip } from '../services/trips/groupTripsService';
```

- [ ] **Step 2: Get a queryClient handle**

Near the top of the `AppContent` component body (where other hooks/state are
declared), add (skip if a `queryClient` is already in scope):

```ts
  const queryClient = useQueryClient();
```

- [ ] **Step 3: Add the once-guarded prefetch effect**

Immediately after the existing `useEffect` that loads profile data "when
entering main app" (ends ~line 1599), add:

```ts
  // Warm the Explore cache the moment the user reaches the main app, so opening
  // Trips paints instantly instead of waiting on a cold fetch. Fire-and-forget,
  // once per app session. (We prefetch trips first — that's what paints — then
  // the meta so avatars are warm too.) `shouldShowConversations` is the same
  // "in main app" signal used by the effect above.
  const exploreWarmedRef = useRef(false);
  useEffect(() => {
    if (!shouldShowConversations || exploreWarmedRef.current) return;
    exploreWarmedRef.current = true;
    queryClient
      .prefetchQuery({ queryKey: tripsKeys.explore, queryFn: () => listExploreTrips() })
      .then(() => {
        const trips = queryClient.getQueryData<GroupTrip[]>(tripsKeys.explore) ?? [];
        if (trips.length > 0) {
          queryClient.prefetchQuery({
            queryKey: tripsKeys.exploreMeta(trips.map(t => t.id)),
            queryFn: () => getTripCardMeta(trips),
          });
        }
      })
      .catch(() => { /* prefetch is best-effort */ });
  }, [shouldShowConversations, queryClient]);
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors mentioning `AppContent.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppContent.tsx
git commit -m "perf(trips): prefetch explore feed on main-app entry"
```

---

### Task 5: Blur-up placeholder on Explore hero images

**Files:**
- Modify: `src/screens/trips/TripsScreen.tsx` (import; `ExploreTripCard` 359-396)

- [ ] **Step 1: Add the import**

In `src/screens/trips/TripsScreen.tsx`, add near the other service imports:

```ts
import { getStorageThumbUrl } from '../../services/media/imageService';
```

- [ ] **Step 2: Compute the thumb URL in `ExploreTripCard`**

Inside `ExploreTripCard` (after the existing `const price = formatTripPrice(trip);`
around line 371), add:

```ts
  // Tiny (~24px) transform thumbnail used as a blur-up placeholder. Supabase
  // image transforms are enabled (already used in NotificationCenter). For
  // non-Supabase hero URLs getStorageThumbUrl returns the URL unchanged, so we
  // pass no placeholder and fall back to the plain fade.
  const heroThumb = useMemo(() => {
    const t = getStorageThumbUrl(trip.hero_image_url, 24);
    return t && t !== trip.hero_image_url ? t : null;
  }, [trip.hero_image_url]);
```

- [ ] **Step 3: Pass the placeholder to the hero image**

Replace the `CachedImage` block at lines 385-391:

```tsx
        <CachedImage
          source={{ uri: trip.hero_image_url }}
          style={styles.cardImageBg}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
        />
```

with:

```tsx
        <CachedImage
          source={{ uri: trip.hero_image_url }}
          placeholder={heroThumb ? { uri: heroThumb } : undefined}
          placeholderContentFit="cover"
          style={styles.cardImageBg}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
        />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors mentioning `TripsScreen.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/screens/trips/TripsScreen.tsx
git commit -m "feat(trips): blur-up placeholder on explore hero images"
```

---

### Task 6: Neighbour hero prefetch in the deck

**Files:**
- Create: `src/screens/trips/deckPrefetch.ts`
- Test: `src/screens/trips/__tests__/deckPrefetch.test.ts`
- Modify: `src/screens/trips/TripsScreen.tsx` (`TripDeck` 526-642)

- [ ] **Step 1: Write the failing test**

```ts
// src/screens/trips/__tests__/deckPrefetch.test.ts
import { neighbourHeroUrls } from '../deckPrefetch';

describe('neighbourHeroUrls', () => {
  const trips = [
    { hero_image_url: 'a' },
    { hero_image_url: 'b' },
    { hero_image_url: null },
    { hero_image_url: 'd' },
    { hero_image_url: 'e' },
  ];

  it('returns focused-1 .. focused+2 urls, skipping missing, deduped', () => {
    // focused = 1 → indices 0,1,2,3 → a,b,(skip),d
    expect(neighbourHeroUrls(trips, 1)).toEqual(['a', 'b', 'd']);
  });

  it('clamps at the start', () => {
    // focused = 0 → indices -1,0,1,2 → a,b
    expect(neighbourHeroUrls(trips, 0)).toEqual(['a', 'b']);
  });

  it('returns empty for an empty deck', () => {
    expect(neighbourHeroUrls([], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/trips/__tests__/deckPrefetch.test.ts`
Expected: FAIL — cannot find module `../deckPrefetch`.

- [ ] **Step 3: Create the helper**

```ts
// src/screens/trips/deckPrefetch.ts
// Hero URLs to warm around the focused deck card: the focused card, its left
// neighbour, and the next two to the right (the swipe direction). Deduped and
// missing-url-safe. expo-image caches by URL, so prefetching a warm URL no-ops.
export function neighbourHeroUrls(
  trips: { hero_image_url?: string | null }[],
  focused: number,
): string[] {
  const urls: string[] = [];
  for (let i = focused - 1; i <= focused + 2; i++) {
    const u = trips[i]?.hero_image_url;
    if (u) urls.push(u);
  }
  return Array.from(new Set(urls));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/trips/__tests__/deckPrefetch.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Wire it into `TripDeck`**

In `src/screens/trips/TripsScreen.tsx`, add the import near the top:

```ts
import { neighbourHeroUrls } from './deckPrefetch';
```

Inside `TripDeck`, after the existing reset effect (lines 541-544), add a warm
effect:

```ts
  // Warm the first card + right neighbours as soon as the deck mounts/changes.
  useEffect(() => {
    neighbourHeroUrls(trips, 0).forEach(u => { CachedImage.prefetch(u); });
  }, [trips]);
```

Then add an `onMomentumScrollEnd` prop to the `Animated.FlatList` (alongside
`onScroll` at line 626):

```tsx
        onMomentumScrollEnd={e => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / DECK_ITEM_W);
          neighbourHeroUrls(trips, idx).forEach(u => { CachedImage.prefetch(u); });
        }}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors mentioning `TripsScreen.tsx` or `deckPrefetch.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/screens/trips/deckPrefetch.ts src/screens/trips/__tests__/deckPrefetch.test.ts src/screens/trips/TripsScreen.tsx
git commit -m "perf(trips): prefetch neighbour hero images in the explore deck"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full new test suite**

Run: `npx jest src/services/trips/__tests__/exploreSelect.test.ts src/hooks/trips/__tests__/exploreKeys.test.ts src/screens/trips/__tests__/deckPrefetch.test.ts`
Expected: 3 suites pass.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (compare against a pre-change baseline if the repo has
pre-existing errors).

- [ ] **Step 3: Manual smoke (device/sim, dev build)**

1. Cold start (clear app cache / fresh launch) → enter the app → open Trips →
   Explore. **First card appears quickly** (trips-only paint); host avatar/name
   pop in a beat later.
2. Leave Trips and return within a few minutes → **instant** (warm cache, no
   skeleton).
3. The hero shows a **blurry placeholder that crossfades to sharp**.
4. Swipe the deck → the next card's photo is already loaded (no flash of gray).
5. My Trips tab is unchanged.

- [ ] **Step 4: Final commit (if anything was adjusted during verification)**

```bash
git add -A
git commit -m "chore(trips): explore fast-load verification tweaks"
```

---

## Self-review (done while writing)

**Spec coverage:** change 1 (split/progressive) → Tasks 2–3; change 2 (prefetch
on main-app entry) → Task 4; change 3 (trim columns) → Task 1; change 4 (blur-up
+ neighbour prefetch) → Tasks 5–6. Non-goals (RPC, index, pagination, stored
blurhash) intentionally absent. ✓

**Placeholder scan:** no TBD/TODO; every code step has concrete code. ✓

**Type consistency:** `tripsKeys.exploreMeta(ids)` used identically in the hook
(Task 2) and the prefetch (Task 4); explore cache typed `GroupTrip[]` in hook
(Task 2), consumer (Task 3), and prefetch (Task 4); `neighbourHeroUrls` signature
matches between helper, test, and call sites (Task 6). ✓

**Integration risks handled:** `useTripDetail.seedFromListCache` updated for the
new cache shape (Task 3); the 4 existing `tripsKeys.explore` invalidations
(`TripsScreen:1193`, `TripDetailScreen:736`, `useTripRealtime:50`,
`useTripsListRealtime:37`) need **no change** because the meta key is nested under
`['trips','explore']` and is covered by prefix invalidation (verified by the Task
2 test).
