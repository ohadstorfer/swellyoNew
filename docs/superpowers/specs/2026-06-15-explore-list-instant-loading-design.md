# Explore List — Instant, Scale-Ready Loading (Design)

- **Date:** 2026-06-15
- **Author:** Ohad
- **Status:** v2 — hardened by 4 parallel verification agents (security, schema/cache, runtime, UX/edge). Pending user review.
- **Sub-project:** 1 of 2. (#2 = Trip Detail screen internals.)
- **Builds on / supersedes:** the shipped "Approach A". The `explore_feed` RPC replaces A's trips/meta split.

> **v2 changelog (from review):** keyset cursor is `(created_at, id)` not `created_at`; RPC gets a `visibility` future-proof clause + explicit DDL (REVOKE/GRANT/search_path); the infinite-query cache-shape change **silently breaks 2 consumers** we must fix (`seedFromListCache`, `AppContent` prefetch); pagination trigger is **index-based on a horizontal snap deck**, not `onEndReached`; page-append must **not** reset deck scroll; added error state, pull-to-refresh, focus-refetch tuning, `onPressIn`, AbortSignal threading, reduced-motion gating; one open product decision (Popular vs Operators overlap).

---

## Problem & reality

Make Explore feel instant: cards fast, trip-open instant, more trips progressive, filter switches free. Today (post-A) the list runs 2 sequential queries (avatars pop in late) and opening a trip cold runs the full detail fetch (~7 RT) with nothing pre-warmed. **6 active trips today; designing for growth.** At 6 trips raw speed is fine — the value is (a) no avatar pop-in, (b) instant trip-open via prefetch, (c) a data layer + prefetch machinery that scales without a rewrite.

## Goals / Non-Goals

**Goals:** 1 RTT list (trips+host+count, no pop-in); instant trip-open (warm the critical detail query); progressive list that scales; instant filters; correct under the SECDEF/RLS model; resilient (error/offline/refresh).

**Non-Goals (sub-project 2):** Trip Detail *screen* internals (progressive sections, caching updates/gear, host-only flows). **Also out:** member-avatar faces on cards; server-side filtering (until >50 trips); stored blurhash.

---

## §2 The `explore_feed` RPC (server)

**Security model (verified):** `group_trips` and `surfers` both have RLS `USING (true)` for authenticated — i.e. **no row is hidden by RLS today**; the only Explore gate is the client's `WHERE status='active'`. So the SECDEF RPC does **not** bypass any existing filter (no regression), and host name/avatar are already public (no new leak). `participant_count` is trigger-maintained (`trg_sync_participant_count`) → read the column, never `COUNT`.

**DDL (must be literal in the CREATE):**
```sql
CREATE OR REPLACE FUNCTION public.explore_feed(
  p_limit int default 10,
  p_cursor timestamptz default null,
  p_cursor_id uuid default null
)
RETURNS TABLE (... EXPLORE_TRIP_SELECT cols ..., destination jsonb, host_name text, host_avatar text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp      -- pin explicitly (fn starts proconfig=null)
AS $$
  SELECT gt.id, gt.host_id, gt.status, gt.hosting_style, gt.title, gt.hero_image_url,
         gt.start_date, gt.end_date, gt.dates_set_in_stone, gt.date_months,
         gt.cost_per_person, gt.budget_min, gt.budget_max,
         gt.max_participants, gt.participant_count, gt.created_at,
         (SELECT jsonb_build_object('name',d.name,'short_label',d.short_label,'country',d.country,
                 'admin_level_1',d.admin_level_1,'lat',d.lat,'lng',d.lng)
            FROM group_trip_destinations d WHERE d.trip_id = gt.id) AS destination,
         s.name AS host_name, s.profile_image_url AS host_avatar
  FROM group_trips gt
  LEFT JOIN surfers s ON s.user_id = gt.host_id
  WHERE gt.status = 'active'
    AND (gt.visibility IS NULL OR gt.visibility = 'public')   -- future-proof: private/friends never leak
    AND (
      p_cursor IS NULL
      OR gt.created_at < p_cursor
      OR (gt.created_at = p_cursor AND gt.id < p_cursor_id)    -- (created_at,id) keyset tiebreak
    )
  ORDER BY gt.created_at DESC, gt.id DESC
  LIMIT LEAST(GREATEST(p_limit,1), 50);
$$;

REVOKE EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explore_feed(int, timestamptz, uuid) TO authenticated;
```
- **Index:** `CREATE INDEX ... ON group_trips (status, created_at DESC, id DESC)` (covers filter+sort+tiebreak).
- Destination FK is the child side: `group_trip_destinations.trip_id → group_trips(id)` (1:1, `unique(trip_id)`). Returned `destination` jsonb matches `pickDestination`'s 6 fields.
- Applied **manually** via SQL editor. **Post-deploy test:** anon `rpc/explore_feed` → **403**; authenticated → 200.

## §3 Client — list (supersedes A's split)

- `useExploreTrips` → **`useInfiniteQuery`** keyed `tripsKeys.explore`. `queryFn: ({pageParam, signal}) => exploreFeed(limit, pageParam?.created_at ?? null, pageParam?.id ?? null, signal)`. `initialPageParam: null`. `getNextPageParam: last => (last.length === limit && last.length > 0) ? { created_at: last.at(-1).created_at, id: last.at(-1).id } : undefined` (the `length>0` guard avoids `.at(-1)` throwing). `maxPages: 10`.
- **Public hook shape unchanged:** still returns `{ trips: GroupTrip[], meta, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage, refetch }`, where `trips = data?.pages.flat() ?? []` — so `ExploreTripsView`/`applyExploreFilters` need no change to consume `trips`. **Remove the separate meta query** (`tripsKeys.exploreMeta`): host+count come per-row; map `host_name/host_avatar/participant_count` into the existing `TripCardMeta` shape the card already reads.
- Keep prefetch-on-main-app-entry, blur-up.

**CACHE-SHAPE BREAKAGE — mandatory fixes (the cache at `tripsKeys.explore` becomes `InfiniteData<GroupTrip[]>`; reads typed `GroupTrip[]` silently return `undefined`, not a crash):**
1. **`useTripDetail.ts` `seedFromListCache`** (~51): read `getQueryData<InfiniteData<GroupTrip[]>>(tripsKeys.explore)`, then `const trips = data?.pages.flat() ?? []`. *Without this, the "instant seeded header" promise breaks silently.* (This is the same seed we fixed in A — it breaks again under infinite.)
2. **`AppContent.tsx` prefetch-on-main-app-entry**: switch `prefetchQuery` → **`prefetchInfiniteQuery`** (`initialPageParam: null`); delete the `exploreMeta` follow-on (meta is gone); if it still reads the cache, flatten `.pages`.
3. **`exploreKeys.test.ts`**: `setQueryData(tripsKeys.explore, …)` must use the `InfiniteData` shape (`{pages:[[]],pageParams:[null]}`).
4. **Invalidations** (`useTripsListRealtime:37`, `useTripRealtime:50`, `TripsScreen:1213`, `TripDetailScreen:736`): prefix-based → **safe, no change**.
5. Confirm no orphan `exploreMeta` references remain.

## §4 Viewport prefetch machinery (P2)

- **Pagination trigger (snap deck, NOT `onEndReached`):** in the deck's existing `onMomentumScrollEnd`, compute `idx = round(offsetX / DECK_ITEM_W)`; if `idx >= trips.length - 2` and `hasNextPage && !isFetchingNextPage` → `fetchNextPage()`. Show a **skeleton card slot at the end** while `isFetchingNextPage` (a bottom "footer" is vertical-list thinking and is invisible on a horizontal deck).
- **Detail prefetch:** per deck, a **stable-ref** `onViewableItemsChanged` + `viewabilityConfig` (`itemVisiblePercentThreshold: 50`, `minimumViewTime: 150`; inline config **crashes RN**). **Two decks → two ref pairs.** On viewable: for visible + next 2 (scroll direction), `queryClient.prefetchQuery({ queryKey: tripsKeys.detail(id), queryFn: ({signal}) => fetchTripCore(id, userId, signal) })` and `CachedImage.prefetch(hero)`.
- **Shared `fetchTripCore(tripId, userId, signal)`** extracted from `useTripCore`'s queryFn (DRY) — and it **must thread `signal` into all 3 sub-fetches** (`getTripById`, `getTripParticipants`, `getMyJoinRequest`) via supabase-js `.abortSignal(signal)` (confirmed supported in `@supabase/postgrest-js` 2.80; chain after `.rpc()/.from()`). `userId` is required so prefetch and the hook produce the **same** queryFn body/shape (else the cache is stale on open).
- **Scheduling:** dispatch viewport prefetch via `InteractionManager.runAfterInteractions` to keep enqueue off the active scroll frames. **Caveat:** in RN 0.81 `runAfterInteractions` does **not** wait for momentum scroll → it's best-effort; for far-ahead (4+) warm-up fire from `onMomentumScrollEnd` instead. `onPressIn` prefetch (added to the card, see below) is **exempt** — it must be immediate.
- **`onPressIn` safety net:** `ExploreTripCard` currently has only `onPress` — **add `onPressIn` → prefetch `tripsKeys.detail(id)`** (fires ~80–120ms before nav, covers a 4G RTT on cache-miss).
- Warm **only the critical `detail` query** (trip+participants+myRequest). Updates/gear/host-only stay lazy (sub-project 2). Cost: visible+2 × ~3 RT, debounced + cancellable.
- **`staleTime` alignment (already satisfied):** global `staleTime 5min / gcTime 30min`; detail hooks inherit → prefetch aligns → no refetch-on-mount. Don't override.

## §5 Filters, images, perceived-perf

- **Filters:** client-side `useMemo` (instant). Server-side + `keepPreviousData` documented as the **>50-trips** trigger. **Filter-empty:** keep the section heading rendered (don't let it disappear) to avoid layout shift; show "No trips match" under the heading.
- **Two decks (D1 = keep current behavior):** both decks derive from the same `trips`; **Popular includes ALL active trips** — operator (`hosting_style 'C'`) trips intentionally appear in **both** "Popular" and "Trip Operators". No exclusion filter (current behavior, kept). A single `useInfiniteQuery` / single cursor feeds both decks (filtered in-memory).
- **Page-append must NOT reset scroll:** `TripDeck`'s `useEffect([trips])` (resets `scrollX`+scrollToOffset 0) was for full replacements (filter/invalidation). Appending a page changes `trips` → it would **snap the deck back to card 0 mid-swipe**. Distinguish *append* (length grew, prefix unchanged) from *replace* and only reset on replace (e.g. reset on filter/length-shrink, not on append).
- **expo-image:** `recyclingKey={item.id}` on the hero (prevents recycled-cell flashing the prior photo; no conflict with the deck transforms); hero prefetch via the viewability callback; `memory-disk`. `CachedImage.prefetch` already dedups by URL.
- **Skeletons:** `ExploreDeckSkeleton` only while page 1 loads; blur-up heroes.
- **Reduced-motion:** gate the hero blur-up `transition` on reduced motion (use Reanimated's synchronous `useReducedMotion`, not the async `AccessibilityInfo` 1-frame window); consider disabling neighbour scale/rotate transforms under reduced motion.
- **Warm-cache FadeIn:** `ExploreTripsView` is wrapped in `FadeInView` (280ms) that replays on every tab switch even when data is already warm → skip/instant the fade when `!isLoading` on a warm cache.
- **a11y:** add an `accessibilityLabel` to the card composing title/location/dates/spots.

## §6 Resilience & edge cases

- **Error state:** `useExploreTrips` must expose `isError`; `ExploreTripsView` must branch on it (today a failed cold load falls through to the "No trips yet" **empty** state — looks like an empty feed, not an error). Show an error + **Retry** (`refetch`). Covers offline/airplane (`retry:2` then fail).
- **Pull-to-refresh:** add a `RefreshControl` to Explore's ScrollView → `refetch()` (Explore has none today; My Trips does).
- **Focus-refetch storm:** with `maxPages` loaded, an `invalidateQueries` on focus refetches **all** pages sequentially. Set `refetchOnMount/refetchOnWindowFocus: false` on the explore infinite query and rely on **realtime** for freshness (the realtime channel already invalidates on real changes).
- **Cancelled trip while prefetched:** `useTripCore`'s queryFn returns `{ trip: null as any }` for a missing/cancelled trip — prefetch makes this reachable (warm good data → trip cancelled → refetch returns null → screen reads `trip.title` on `null`). **Fix the `null as any`** to a typed-null/error the detail screen renders gracefully (small cross-cutting fix; detail-screen polish lands in sub-project 2).
- Empty feed (only after page 1 resolves); single page < limit (no spurious fetch, zero-items guard); host w/o avatar (icon fallback); fast scroll (minimumViewTime + AbortSignal); logged-out/session-restoring (RPC needs `authenticated` — gate prefetch on valid session); `participant_count` ≤5min stale (realtime corrects).

## §7 Scalability
RPC + `(status, created_at DESC, id DESC)` index + keyset → O(limit)/page at any table size. `maxPages` caps memory; viewport-gating caps concurrent warms; filters → server-side at >50.

## §8 Runtime / performance
Viewability callbacks are event-driven (not per-frame) — cheap. The real bottleneck is the deck's JS-thread `scrollX.setValue` on `onScroll` (existing); keep prefetch off the scroll frames (InteractionManager, best-effort). **Independent follow-up (out of scope):** migrate the deck scroll to `Animated.event({useNativeDriver:true})` or Reanimated `useAnimatedScrollHandler` (already imported) to fully decouple the animation from the JS thread. AbortSignal frees sockets on scroll-past.

## §9 Loading time / UX
Cold page-1: skeleton → cards (1 RTT, host+count present, no pop-in) → hero blur-up→sharp. Warm: no skeleton, no FadeIn. Tap: instant if prefetched; else `onPressIn` covers the RTT; worst case seeded header instant + participants fill in. Filter switch: instant. Snap-deck "load more" triggers at `length-2`, shows an end skeleton card.

---

## Testing
- RPC: returns cols + host fields + destination shape; respects `limit`; keyset paginates w/o dup/skip incl. equal-`created_at` tiebreak; visibility clause; anon 403 / authenticated 200.
- Client: infinite hook flattens pages → `trips: GroupTrip[]`; card meta maps from RPC row; `seedFromListCache` reads `data.pages`; AppContent uses `prefetchInfiniteQuery`.
- Pure helpers: cursor derivation (+ zero-items guard); snap-deck "near end" index calc; viewable→prefetch-index set (visible+2, clamped, deduped); append-vs-replace detection.
- staleTime alignment (prefetch key === detail key, no override).

## Rollout / risk
RPC additive; the client swap (split→infinite RPC) is the riskier change — same `tripsKeys.explore` key, realtime/seed/AppContent adapted, manual migration verified read-only before client ships. Group trips are dev-only on prod → low blast radius.

---

## Decisions (resolved)
- **D1:** Popular includes ALL active trips — operator trips appear in both decks (current behavior kept). No exclusion filter.
- **D2:** Resilience (error + retry state, pull-to-refresh, focus-refetch tuning) **included** in this sub-project.
- **D3:** Minimal `null`-guard for the cancelled-trip case in `useTripCore` **included now**; full detail-screen polish → sub-project 2.

## Out of scope → sub-project 2
Trip Detail screen internals: progressive section rendering, caching updates/gear, host-only flows, optimistic mutations, full cancelled-trip UX.
