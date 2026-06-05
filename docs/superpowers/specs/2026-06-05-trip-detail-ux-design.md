# Trip Detail — UX improvements (caching, skeleton, transition, mutations)

Date: 2026-06-05
Branch: ohad
Status: approved for implementation (iteration 2)
Builds on: `2026-06-04-trips-data-caching-design.md` (tabs iteration 1, shipped)

## Problem

Opening a trip is a hard cut (`if (selectedTripId) return <TripDetailScreen/>`),
fires 4–7 Supabase queries on every mount, shows a centered `ActivityIndicator`
(not a skeleton), has no caching (every open reloads), and runs ~20 mutations
with hand-rolled local optimistic `setState` (no automatic rollback, occasional
forced reloads after edits).

## Goal

Make Trip Detail feel instant and polished, following best practices:
- Opening a trip the user just saw in a list renders **fully populated instantly**.
- Reopening a previously viewed trip is instant + silently revalidated.
- Content-shaped skeleton instead of a spinner on true first load.
- Smooth slide transition in/out (matches the tab pager polish).
- Mutations migrated to react-query `useMutation` with proper optimistic
  updates + rollback + invalidation.

## Scope (this iteration)

A. Instant open (react-query cache + `placeholderData` from list cache)
B. Skeleton instead of spinner
C. Open/close slide transition
D. Full migration of all Trip Detail mutations to `useMutation`

## A + B — Data layer

New file `src/hooks/trips/useTripDetail.ts`. Granularity mirrors the existing
`refreshGear` / `refreshGearRequests` split so invalidation stays surgical:

| Query key | Source (existing service fns) | Notes |
| --- | --- | --- |
| `['trips','detail', id]` | `getTripById` + `getTripParticipants` + derive `myRequest` | core |
| `['trips','detail-updates', id]` | `listAdminUpdates` | |
| `['trips','detail-gear', id]` | `listGearItems` | |
| `['trips','detail-requests', id]` | `listPendingRequests` + `listDeclinedRequests` | `enabled: isHost` |
| `['trips','detail-gear-requests', id]` | `listGearRequests` | `enabled: isHost` |

**Instant open (A):** the core query uses `placeholderData` that reads the
already-cached `GroupTrip` from the list caches (`['trips','explore']` →
`data.trips`, `['trips','my', userId]` → flatten buckets) and the matching
`TripCardMeta`. The header (cover, title, dates, host, member count/avatars)
renders immediately from this seed; participants/gear/updates load with
skeletons and revalidate. `staleTime` inherits the global 5 min, so reopening a
viewed trip is instant + background revalidate.

**Skeleton (B):** `TripDetailSkeleton` (hero block + section placeholders) in
`src/components/skeletons`, shown only when there is no data AND no placeholder.
Replaces the `ActivityIndicator` at `TripDetailScreen.tsx` loading branch.
"Trip not found" error branch is preserved (shown when query errors / returns
null).

## D — Mutations → `useMutation` (full migration)

New file `src/hooks/trips/useTripMutations.ts` exposing one `useMutation` per
write. Standard optimistic pattern for every mutation:

```
onMutate(vars)  → await cancelQueries(key); snapshot = getQueryData(key);
                  setQueryData(key, optimisticNext); return { snapshot }
onError(_,_,ctx)→ setQueryData(key, ctx.snapshot)   // rollback
onSettled()     → invalidateQueries(key)            // reconcile with server
```

Mutation inventory (service fn → optimistic target query key(s)):

| Mutation | Service fn | Optimistic target |
| --- | --- | --- |
| Edit cover/aboutHost/description/dates/accommodation | `updateGroupTrip` | `['trips','detail',id]` (+ invalidate `['trips','my']`, `['trips','explore']`) |
| Cancel trip | `cancelTrip` | `['trips','detail',id]` (+ `['trips','my']`, `['trips','explore']`) |
| Complete trip | `completeTrip` | `['trips','detail',id]` (+ `['trips','my']`) |
| Request to join | `requestToJoinTrip` | `['trips','detail',id]` (myRequest) |
| Withdraw request | `withdrawJoinRequest` | `['trips','detail',id]` |
| Approve request | `approveJoinRequest` | `['trips','detail',id]` + `['trips','detail-requests',id]` (+ `['trips','my']`) |
| Decline request | `declineJoinRequest` | `['trips','detail-requests',id]` |
| Leave trip | `leaveTrip` | `['trips','detail',id]` (+ `['trips','my']`) |
| Remove participant | `removeParticipant` | `['trips','detail',id]` |
| Add/update/delete gear | `addGearItem`/`updateGearItem`/`deleteGearItem` | `['trips','detail-gear',id]` |
| Claim gear | `setMyGearClaim` | `['trips','detail-gear',id]` |
| Approve/decline gear request | `approveGearRequest`/`declineGearRequest` | `['trips','detail-gear',id]` + `['trips','detail-gear-requests',id]` |
| Personal gear list | `setMyPersonalGearList` | `['trips','detail',id]` (participants carry personal gear) |
| Suggested gear list | `setTripGroupGear` | `['trips','detail',id]` |
| Add/update/delete admin update | `addAdminUpdate`/`updateAdminUpdate`/`deleteAdminUpdate` | `['trips','detail-updates',id]` |
| Submit commitment | `submitCommitment` | `['trips','detail',id]` |

The current per-handler local `setState` logic is the reference for each
`onMutate`'s optimistic shape — behavior must match what users see today, just
with automatic rollback and server reconciliation added.

## C — Open/close transition

Wrap `TripDetailScreen` (rendered from `TripsScreen` when `selectedTripId` is
set) with reanimated `entering={SlideInRight}` / `exiting={SlideOutRight}` for a
native-stack-style horizontal push. Gated by `useReducedMotion` (no movement
when the OS requests reduced motion; keep a plain fade or none). Mirrors the tab
pager easing/feel for cohesion.

## Implementation phases (incremental, each testable)

1. **Data layer (A+B):** `useTripDetail` hooks + `placeholderData` seeding +
   `TripDetailSkeleton`. Wire `TripDetailScreen` reads to the hooks (keep
   existing mutation handlers temporarily calling `refetch`/invalidate).
2. **Mutations (D):** migrate to `useTripMutations` group by group
   (trip fields → join requests → gear → admin updates → commitment), verifying
   each group before moving on. Largest / highest-risk phase.
3. **Transition (C):** slide-in/out on open/close.

## Risks & mitigations

- **Mutation migration is the main risk** (~20 handlers, optimistic logic). De-risk
  by migrating in small groups, keeping each group's optimistic shape identical
  to today's local `setState`, and verifying on device between groups. Rollback
  is now automatic (snapshot in `onMutate`), which is safer than today.
- **placeholderData shape mismatch:** the list `GroupTrip` is a subset of the
  detail's data. Seed only the fields the list has (header); never assume
  participants/gear exist in the placeholder. Sections fall back to skeleton.
- **isHost depends on fetched trip:** host-only queries use `enabled: isHost`
  where `isHost` derives from the core query's `trip.host_id` — so they only run
  once the trip resolves (placeholder counts).
- **No new native modules** (reanimated already installed; works in Expo Go).
- **Cache cleared on logout** already handled (iteration 1 registered
  `queryClient.clear()`).

## Verification (manual, device / Expo Go)
- Open a trip from a list: header appears instantly populated (no spinner).
- Reopen a viewed trip: instant, no full reload.
- Edit a field / join / gear / admin update: UI updates optimistically; on a
  forced error it rolls back; data reconciles after.
- Open/close: smooth slide; reduced-motion setting disables movement.

## Not in scope
- Realtime subscriptions on trip detail (future).
- Pagination of participants/updates (not needed at current scale).
