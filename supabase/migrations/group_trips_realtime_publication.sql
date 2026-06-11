-- Live updates for group trip screens (useTripRealtime.ts on TripDetailScreen).
--
-- group_trip_join_requests is already in the publication (the join-decision
-- overlay in AppContent listens to it) — these are the missing tables.
-- Without this, the client subscriptions are silent no-ops: trips,
-- participants, admin updates and commitments never push events.
--
-- Realtime respects RLS: subscribers only receive rows their SELECT policies
-- allow (all four tables are readable by `authenticated`).

alter publication supabase_realtime add table public.group_trips;
alter publication supabase_realtime add table public.group_trip_participants;
alter publication supabase_realtime add table public.group_trip_admin_updates;
alter publication supabase_realtime add table public.group_trip_commitment_requests;

-- DELETE events only carry the replica-identity columns. With the default
-- (primary key only), a deleted participant or admin-update row has no
-- trip_id, so it never matches the per-trip `trip_id=eq.<id>` filter and the
-- other members' screens miss leaves/removals. These tables are small, so
-- FULL is cheap.
alter table public.group_trip_participants replica identity full;
alter table public.group_trip_admin_updates replica identity full;
