---
name: project_profile_approve_no_invalidation_gap
description: Root cause of "approve on Profile screen doesn't refresh Members/Requests plan page until full leave+re-enter" — ProfileScreen has TWO independent Approve buttons, only one invalidates react-query
metadata:
  type: project
---

Confirmed 2026-07-06 by reading current code (supersedes/extends [[project_join_request_notification_gaps]], whose
useTripRealtime catch-up-gap claim is now FIXED — see below).

**The "plan page" showing Members + Requests is `TripMembersScreen.tsx`**, reached from
`TripDetailScreen`'s Plan tab via "View all" on the Members section (comment at
`TripDetailScreen.tsx:1604-1605`: "Pending requests + member management now live in the full
Members view"). It reads pending requests via `useTripRequests(tripId, isHost)`
(`TripMembersScreen.tsx:111`, hook defined `src/hooks/trips/useTripDetail.ts:123-135`), key
`tripsKeys.detailRequests(tripId)` = `['trips','detail-requests',id]` (`useTripQueries.ts:51`).
**`TripMembersScreen` has NO `useFocusEffect`, NO realtime subscription of its own** — it relies
entirely on default TanStack Query behavior, and the app's global `staleTime` is 5 minutes
(`src/lib/queryClient.ts:23`, deliberately set to "prevent refetch on every remount"). So
remounting this screen within 5 minutes of the last fetch does NOT trigger a background refetch.

**ProfileScreen.tsx has TWO independent, simultaneously-renderable Approve/Decline UIs for a
join request**, and only one of them touches the query cache:

1. **Header bar** (`JoinRequestActionBar`, rendered whenever `incomingRequest` is truthy —
   `ProfileScreen.tsx:2347-2355`). Driven by a self-contained `useEffect`
   (`ProfileScreen.tsx:1112-1131`) that calls `getIncomingJoinRequest(hostId, userId)`
   (`groupTripsService.ts:1748-1781`) on every mount, independent of how the profile was opened.
   Wired to `handleApproveRequest` (`ProfileScreen.tsx:1133-1146`), which calls
   `approveJoinRequest(requestId)` (`groupTripsService.ts:1903+`) — a plain Supabase `.update()`.
   **Neither `handleApproveRequest` nor `approveJoinRequest` ever calls `invalidateQueries` —
   there is no `queryClient`/`useQueryClient` import anywhere in `ProfileScreen.tsx` or
   `groupTripsService.ts`.** This is the buggy path.

2. **Footer** (`ProfileScreen.tsx:2871-2915`), rendered ONLY when a `reviewRequest` prop is
   passed in. That prop is constructed in `RootNavigator.tsx`'s `ProfileCardScreen`
   (lines 304-332) ONLY when the caller navigated to `ProfileCard` with a `joinRequest: {tripId,
   requestId}` route param. Its `onApprove` (`RootNavigator.tsx:311-321`) correctly does:
   `queryClient.invalidateQueries` on `tripsKeys.detail(tripId)`, `tripsKeys.detailRequests(tripId)`,
   and `['trips','my']`, THEN `navigation.goBack()`. This is the correct path.

**Which entry points produce which param:**
- `TripMembersScreen`'s own "tap a pending request row" flow → `onReviewRequest` →
  `RootNavigator.tsx:183-187` pushes `ProfileCard` WITH `joinRequest` → footer renders, good
  invalidation available (but the header ALSO renders simultaneously since `incomingRequest`
  detection is independent — a host who taps the header instead of scrolling to the footer still
  hits the bad path).
- Tapping a `join_request_received` **bell notification** → `NotificationCenter.tsx:296-299`
  (`handleRowPress`) pushes `ProfileCard` with ONLY `{ userId: n.actor_id }` — **no `joinRequest`
  param**. Comment: "opens the requester's profile, which surfaces its own Approve/Decline action
  bar at the top." On this path the footer never renders — ONLY the zero-invalidation header path
  is available. This is almost certainly the reproduction for "host receives request → opens
  profile → taps approve → back to plan page → stale."
- Bell panel's OWN inline Approve/Decline (`NotificationCenter.tsx:330-349`, `handleDecision`) is
  a THIRD, separate, correct path — calls `invalidateTrip()` (lines 306-316) which invalidates
  `detail`, `detailRequests`, `detailGear`, `detailGearRequests`, `['trips','my']`.

**Why "leave fully and re-enter" fixes it:** `TripDetailScreen.tsx:370` calls
`useTripRealtime(tripId)` (`src/hooks/trips/useTripRealtime.ts`), which — AS OF NOW, already
fixed vs. the older [[project_join_request_notification_gaps]] memory — invalidates
`tripsKeys.detailRequests(tripId)` unconditionally every time TripDetailScreen itself REGAINS
navigation focus (lines 49-55, explicit comment citing this exact join-request bug as the reason
the catch-up list was widened). So: Profile → back lands on TripMembersScreen (no refetch, per
above) → back again lands on TripDetailScreen (focus regained → force-invalidates the SAME shared
key `tripsKeys.detailRequests(tripId)`, refetches immediately since TripDetailScreen holds a
mounted observer on it) → re-entering TripMembersScreen fresh now reads the corrected cache. This
also means the live `broadcast_trip_change` trigger on `group_trip_join_requests` (fed to
`useTripRealtime`'s channel, table case at `useTripRealtime.ts:69-71`) can never help
`TripMembersScreen` directly — that screen never opens the channel, focus-gated or otherwise, and
even if it did, by the time the host is on the Profile screen approving, TripDetailScreen's
channel has already been torn down (its `useFocusEffect` cleanup ran on blur when Profile was
pushed on top).

**Fix candidates (not implemented, just identified):** (a) make `handleApproveRequest`/
`handleDeclineRequest` in ProfileScreen.tsx invalidate `tripsKeys.detail`/`detailRequests`/
`['trips','my']` the same way the footer and bell-inline paths already do — the requestId's
associated tripId isn't currently returned by `getIncomingJoinRequest`/stored on
`incomingRequest`, so check its shape before assuming tripId is available client-side; or
(b) give `TripMembersScreen` its own focus-regain catch-up invalidation of
`tripsKeys.detailRequests(tripId)` (cheap, self-contained, doesn't require fixing every write
path); ideally both.

Related: [[project_join_request_notification_gaps]] (superseded on the useTripRealtime-catchup
claim, still correct on TripMembersScreen/TripDetailScreen sharing one query key and differing
mount lifecycle), [[project_notification_avatars]] (bell action UIs), [[project_bottom_sheet_shell]]
(unrelated, different UI system).
