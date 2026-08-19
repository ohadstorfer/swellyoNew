---
name: group-trips-host-model-and-surftrip-precedent
description: SUPERSEDED for the host-count claim (see update below) — group_trips DID ship multi-host later on 2026-07-08; surftrip_groups host/admin/member RLS+UI model remains an accurate template for other roles
metadata:
  type: project
---

**UPDATE (verified 2026-08-18, tracing `trg_notify_trip_cancelled`'s host-exclusion
logic):** the "single owner only" claim below is now WRONG. Later the same day,
`supabase/migrations/20260708000000_group_trip_multiple_hosts.sql` shipped
multi-host — NOT by adding an `'admin'` role as this memory's "How to apply"
guessed, but by allowing MULTIPLE `group_trip_participants` rows with
`role = 'host'`. `group_trips.host_id` still exists but is now only the
"primary host" (display + notification target, kept in sync by a trigger,
still exactly one per trip); real permission is
`is_trip_host(trip_id)` = `EXISTS (... role = 'host' ...)`, checked via RLS.
Practical consequence: any trigger/query written before 2026-07-08 that
excludes/targets only `host_id` (e.g. `trg_notify_trip_cancelled`,
`20260609000050_notification_new_event_triggers.sql:25`) silently misses
co-hosts — a real, unfixed gap, not just a historical note. The 6-file
duplicated `isHost` boolean claim below was NOT verified in the 2026-08-18
pass and may also be stale.

Researched 2026-07-08 for planning a multi-admin feature on `group_trips`.

**group_trips today = single owner only.** `group_trips.host_id` (not `created_by`) is
the sole authority column. `group_trip_participants.role` exists but only allows
`'host'|'member'` (check constraint, migration `20260414000000_create_group_trips.sql`).
Every screen re-derives the same boolean client-side:
`const isHost = !!trip && !!currentUserId && trip.host_id === currentUserId;`
independently in TripDetailScreen.tsx, TripMembersScreen.tsx, YourGearScreen.tsx,
PackingAndGearScreen.tsx, TripUpdatesScreen.tsx, and `useTripDetail.ts` (as `userIsHost`).
No shared hook — 6 copies of the same line, all would need updating together.
Real enforcement of "host-only" writes is 100% Postgres RLS (`auth.uid() = host_id`
or `EXISTS (... group_trips t WHERE t.host_id = auth.uid())`), not app-layer checks —
the client `isHost` boolean only gates UI visibility.

**surftrip_groups already solved this exact problem** (it's a *different* table family —
`surftrip_groups`/`surftrip_group_members`/`surftrip_join_requests`, a group-chat-only
feature backing `conversations`, unrelated table-wise to `group_trips` but conceptually
the multi-admin template to copy). `surftrip_group_members.role` is
`'host'|'admin'|'member'`. Pattern to reuse:
- RLS: host-only ops check `auth.uid() = host_id`; host-or-admin ops additionally
  `OR EXISTS (SELECT 1 FROM surftrip_group_members m WHERE m.role IN ('host','admin') ...)`
  — see `supabase/migrations/20260507000000_surftrip_groups_admin_can_update.sql`.
- Security-definer RPCs re-check role server-side even though RLS also applies
  (`list_addable_dm_partners`, `add_surftrip_members_from_dms` in
  `20260508010000_surftrip_admin_add_members.sql` — both raise an exception if
  `v_caller_role not in ('host','admin')`).
- Client UI: `SurftripDetailScreen.tsx` derives `myRole` from the members row,
  `isHost`/`isAdmin`/`canManage = isHost || isAdmin`. `ParticipantMenuSheet.tsx`
  (`src/components/surftrips/ParticipantMenuSheet.tsx:34-42`) encodes the exact
  promote/demote/remove permission matrix: only host can promote member→admin or
  demote admin→member; host can remove anyone but another host; admin can remove
  members only (not other admins/host).

**Gap**: the shared "group gear"/"gear requests"/"admin updates" tables
(`group_trip_gear_items`, `group_trip_gear_requests`, `group_trip_admin_updates`)
have NO creation migration in the repo — they were applied by hand directly to prod
(consistent with [[project_migrations_applied_manually]]). Their RLS text isn't
grep-able from the filesystem; must read live via Supabase MCP before changing
host-gating on those tables.

**How to apply**: if building multi-admin for group_trips, the fastest path is to
widen `group_trip_participants.role` check constraint to add `'admin'`, then mirror
the surftrip_groups RLS pattern (host OR admin via EXISTS subquery) onto
`group_trips`, `group_trip_join_requests`, `group_trip_commitment_requests`, and the
three gear/admin-update tables — plus collapse the 6 duplicated `isHost` derivations
into one shared hook that returns a role, not a boolean.
