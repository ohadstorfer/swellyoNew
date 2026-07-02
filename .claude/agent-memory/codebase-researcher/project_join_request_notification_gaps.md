---
name: project_join_request_notification_gaps
description: Group-trip join-request bug investigation (2026-07-01) — host never saw request in bell or Plan tab, only in a profile lookup after delete+recreate
metadata:
  type: project
---

Investigated why a group-trip join request never reached the host's notification
bell or the Trip Detail Plan-tab pending-requests area, but did eventually show up
in a "pending requests" surface after the requester deleted + recreated the request.

**Client insert** — `requestToJoinTrip()` in `src/services/trips/groupTripsService.ts:1667-1703`
always does DELETE (any prior row for this requester+trip) THEN INSERT (never an
upsert). So a delete+recreate always produces a brand-new row/id and always
re-fires the `join_request_received` DB trigger fresh — no unique-constraint/dedup
path silently no-ops the second attempt.

**DB notify trigger** — `tg_notify_join_request_received` in
`supabase/migrations/20260601010000_notification_center.sql:244-258` inserts one
`notifications` row per trip admin (host, or role='admin' — no co-admins exist
today) on INSERT into `group_trip_join_requests`. Push path: `tg_enqueue_push`
(`20260609000100_notification_push_mapping.sql`) maps `join_request_received` to
priority 0 (urgent, send-now).

**Dev-gate risk (UNRESOLVED — needs live DB verification):** the same migration
file also defines `trg_notifications_only_ohad` (`20260601010000...sql:392-411`,
a BEFORE INSERT trigger that silently drops any `notifications` INSERT whose
`recipient_id` isn't ohad.storfer@gmail.com). Per
`docs/superpowers/HANDOFF-notifications.md` §0 (dated 2026-06-09), this gate was
verified ABSENT from prod (no trigger/function found via pg_trigger/pg_proc) and
Ohad decided not to re-add it. If that's still true, notifications should be
created for any real host. This needs re-checking directly against prod
(pg_trigger for `trg_notifications_only_ohad`) before ruling it out as the cause
of the bell showing nothing — I could not query the live DB in this session (no
Supabase MCP tool available), only read repo files + the handoff doc.

**Bell (client)** — `src/services/notifications/notificationsService.ts` `subscribe()`
(~line 289) uses `postgres_changes` filtered `recipient_id=eq.${userId}` on the
`notifications` table (requires the table in the `supabase_realtime` publication,
done in the same 20260601010000 migration). `NotificationCenter`'s bell badge
subscription (`src/components/notifications/NotificationCenter.tsx:118-125`) is
deliberately NOT focus-gated (comment: focus-gating churned/heated the socket) —
it's a stable per-mount channel, so a live INSERT should bump the badge whenever
the bell is mounted. `unreadCount()` is a plain COUNT query (not react-query
cached) refetched on every `useFocusEffect` regain, so the badge should self-heal
on the next screen focus regardless of timing — UNLESS the `notifications` row
was never created in the first place.

**Plan tab / TripDetailScreen gap (CONFIRMED, load-bearing fact):**
`src/hooks/trips/useTripRealtime.ts:34-84` is `useFocusEffect`-gated (channel only
open while that TripDetailScreen instance has React Navigation focus) and
subscribes to the private Broadcast topic `trip:{tripId}` (fed by
`broadcast_trip_change`, `20260610000001_group_trips_broadcast_trigger.sql`,
still current per `20260617140000_ws2_scope_trips_realtime_per_user_topics.sql`
which left the `trip:{id}` topic unchanged). On INSERT into
`group_trip_join_requests` while focused, it correctly invalidates
`tripsKeys.detailRequests(tripId)` (line 58). **But** the catch-up invalidation
that runs every time the screen REGAINS focus (line 43,
`invalidate([...tripsKeys.detail(tripId)])`) only targets the trip-core key —
it deliberately does NOT invalidate `tripsKeys.detailRequests(tripId)`. So if the
join request is created while the host's TripDetailScreen is NOT focused (the
normal case — hosts aren't staring at their own trip screen when a stranger
requests to join), the pending-requests query goes stale and is never
proactively refreshed on the next visit. It only recovers via: (a) a live
broadcast landing while the screen happens to be focused at that exact moment,
or (b) the global `staleTime: 1000*60*5` (`src/lib/queryClient.ts:23`) elapsing
AND some other refetch trigger firing (AppState foreground via `focusManager`,
wired in `App.tsx:101-106`, or a brand-new mount of the same query key
elsewhere) — react-navigation "screen focus" is NOT itself an AppState
foreground event, so simply switching tabs and back does not trigger this.

**Non-obvious shared-cache fact:** `TripMembersScreen.tsx:111` and
`TripDetailScreen.tsx` (Plan tab) both call the exact same hook/key —
`useTripRequests(tripId, isHost)` → `tripsKeys.detailRequests(tripId)`
(`src/hooks/trips/useTripDetail.ts:123-135`). They are NOT independent data
sources. `TripMembersScreen` is a normal pushed/popped native-stack route (no
`detachInactiveScreens`/keep-alive override), so it fully unmounts on back and
remounts fresh on next visit — and TanStack Query's default `refetchOnMount`
triggers a background refetch for a brand-new observer if the cached data is
past `staleTime`. `TripDetailScreen`, by contrast, is kept mounted in the
persistent card stack (comment in useTripRealtime.ts: "the card stack keeps
every visited screen MOUNTED (instant back)") so its `useTripRequests` observer
never remounts and never gets this free refetch. This fully explains why a
"pending requests" list surface can show the live row while the Plan tab (same
cache key!) still shows stale/empty data — it's a mount-lifecycle artifact, not
a different query.

**The surface that actually showed the request** is most likely
`ProfileScreen.tsx:1082-1097` — a plain `useEffect` (NOT react-query) that calls
`getIncomingJoinRequest(hostId, userId)` (`groupTripsService.ts:1748-1781`) fresh
on every mount, querying `group_trip_join_requests` directly for a pending
request by this specific requester against any of the host's trips. This bypasses
the react-query cache entirely, so it always reflects current DB state regardless
of `staleTime` elsewhere. Reached via: tapping a `join_request_received`
notification (routes to `ProfileCard`, `NotificationCenter.tsx:284-286`), or via
`TripMembersScreen`'s `onReviewRequest` → `ProfileCard` (`RootNavigator.tsx:183-187`).

**Deletion/recreation facts:** no FK links `notifications.entity_id`/`entity_type`
to `group_trip_join_requests` (plain uuid columns, no `references`/cascade), so
deleting a join-request row never deletes a previously-created notification row
(possible orphan). `requestToJoinTrip`'s delete-then-insert means every "Request
to join" click — first time or a retry — goes through a real DELETE (no-op if no
prior row) then a real INSERT with a fresh id, so the notify trigger always fires
on a genuine new row; there's no upsert/dedup path that would skip it.

**Spec cross-check:** `group-trip-notifications-plan.html` row 1.1 ("Someone
requests to join" → Host, Push, "Approve or decline now") matches the actual
`tg_notify_join_request_received` trigger's audience/priority — no discrepancy
between spec and DB trigger design.

Related: [[project_notifications_push_queue_phase1]], [[project_explore_prefetching_order_coupling]] (same focus-gated-broadcast-invalidation pattern family).
