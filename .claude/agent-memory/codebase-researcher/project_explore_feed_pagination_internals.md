---
name: project-explore-feed-pagination-internals
description: Exact SQL + client-side cursor/prefetch mechanics for the Explore group-trips feed (explore_feed RPC)
metadata:
  type: project
---

Researched 2026-07-01 for a planned change to Explore sort order (possibly adding
participant-count sorting). Full chain:

**RPC** — `public.explore_feed(p_limit, p_cursor timestamptz, p_cursor_id uuid, p_months, p_budget_min, p_budget_max)`,
current live def in `supabase/migrations/20260616130000_my_trips_feed_rpc.sql` (the
6-arg overload; earlier files `20260615120000_explore_feed_rpc.sql` and
`20260616120000_explore_feed_member_avatars.sql` are superseded drafts — always
read the newest migration only, per [[project_swelly_trip_planning_copy_drift]]-style drift risk, though these are REFERENCE COPIES applied by hand so check live def in Supabase before trusting file order).
- `ORDER BY gt.created_at DESC, gt.id DESC` — the ONLY sort. No participant_count
  anywhere in ORDER BY today.
- Keyset WHERE clause: `p_cursor IS NULL OR gt.created_at < p_cursor OR (gt.created_at = p_cursor AND gt.id < p_cursor_id)`.
  This is a strict "row is more than the cursor tuple" comparison — it hard-requires
  the ORDER BY to exactly match this tuple, in this direction. Adding a sort column
  that isn't also in this WHERE clause breaks keyset correctness (skips/dupes at
  page boundaries) unless the new column is immutable per row (created_at is,
  participant_count is NOT — it's trigger-maintained and changes on join/leave).
- `gt.participant_count` is already a plain column on `group_trips` (added +
  trigger-maintained by `supabase/migrations/20260531000004_group_trips_participant_counts.sql`,
  trigger `trg_sync_participant_count` on `group_trip_participants` ins/upd/del).
  It is SELECTed directly in explore_feed (no join/subquery needed for the count
  itself — only member_avatars needs a join). So sorting by participant_count
  requires no new column, but DOES require adding it to both ORDER BY and the
  keyset WHERE tuple (composite cursor), and it's a mutable value so a trip
  can drift across page boundaries between two fetches (unlike created_at).

**Client cursor plumbing:**
- `src/services/trips/groupTripsService.ts` `exploreFeed()` (~line 559) — thin RPC
  wrapper, params `(limit, cursorCreatedAt, cursorId, signal, filters)`.
- `src/hooks/trips/useTripQueries.ts` `useExploreTrips()` (~line 66) — the ACTUAL
  live pagination logic, via `useInfiniteQuery`. Requests `EXPLORE_PAGE_LIMIT + 1`
  (11) rows — the "limit+1 probe": if 11 rows come back, page 10 (index 9) is the
  cursor and there's a next page; displayed trips are always `.slice(0, 10)`
  (`EXPLORE_PAGE_LIMIT = 10`, line 57). `getNextPageParam` reads
  `last[EXPLORE_PAGE_LIMIT - 1].{created_at,id}` — i.e. cursor = the 10th displayed
  row, not the probe row.
- DEAD CODE WARNING: `src/screens/trips/exploreDeckPagination.ts` has a second,
  UNUSED cursor helper `nextCursorFrom()` implementing a different strategy
  ("page came back exactly `limit` rows = more exist", no +1 probe). Only
  referenced by its own test (`__tests__/exploreDeckPagination.test.ts`). Don't
  confuse it with the live logic above — if asked to change pagination, the file
  to edit is `useTripQueries.ts`, not this one.
- Same file also has `isNearEnd(focusedIndex, length)` (triggers load-more when
  within 2 cards of the end — used by TripsScreen.tsx:732) and `isAppend(prev, next)`
  (index-by-index id comparison to detect "grew by page append" vs "replaced list").
  `isAppend` is IMPORTANT for any reorder-sensitive change: `TripsScreen.tsx:928`
  computes `isAppendingPage = isAppend(rawTripsRef.current, trips)`, and the deck
  only preserves scroll position when `isAppendingPage` is true (effect at line
  610-616 resets `scrollToOffset(0)` otherwise). If a sort key is added that can
  reorder already-loaded rows between fetches (e.g. participant_count changing),
  `isAppend`'s strict prefix-match will flip to false on the next realtime-driven
  refetch, silently snapping the deck back to card 0 mid-browse.

**Prefetch/prewarm mechanics** — `src/screens/trips/TripsScreen.tsx`:
- `onViewableItemsChanged` (~line 594-604): for each viewable card index `i`,
  prefetches detail (`prefetchDetail`, react-query `queryClient.prefetchQuery`,
  gated on `userId` truthy) AND hero image for `trips[i]`, `trips[i+1]`, `trips[i+2]`
  — i.e. current + next 2 = "first 3" warm on initial mount (FlatList fires
  viewability for the initial visible card(s) on layout). This is purely
  ARRAY-INDEX based (`liveTrips[k]`), not cursor-value based — it trusts that
  array order == render order == RPC row order. It has no explicit assumption
  that cursor values are monotonic; it just walks the array. The thing that
  actually requires monotonic/stable ordering across pages is the keyset RPC
  WHERE clause + `isAppend`, not this prefetch loop.
- `neighbourHeroUrls()` (`src/screens/trips/deckPrefetch.ts`) — separate, smaller
  helper: warms hero image URLs for `[focused-1 .. focused+2]` on every
  scroll-snap (`onMomentumScrollEnd`, line 731) and on mount (line 620, focused=0).
  Hero-only, not detail prefetch.
- `prefetchDetail` (TripsScreen.tsx ~577-588) skips entirely if `userId` is falsy,
  to avoid caching a detail with `myRequest=null` that a real open would
  incorrectly reuse.

**Participant-count aggregation elsewhere:** grepped `participant_count`,
`member_count`, `committed_count` repo-wide. `member_count`/`committed_count` only
appear in the unrelated older "surftrips" feature (different tables:
`surftrip_groups` etc., migrations `20260506000000`/`20260507010000`/`20260508000000`),
NOT in `group_trips`/explore_feed. For group_trips, `participant_count` is the
only aggregate and it's already materialized directly on the table — no
join/subquery needed to sort or filter by it at query time.
