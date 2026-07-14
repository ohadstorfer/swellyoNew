-- Geo-tiered matching needs to read other users' destination geo rows
-- (lat/lng + geohash buckets) client-side. This data is already effectively
-- public to authenticated users via surfers.destinations_array (matching
-- selects * on surfers), so a read policy here exposes nothing new.
--
-- APPLY MANUALLY in the Supabase SQL editor (never `supabase db push`).

create policy "Authenticated users can view destinations"
  on public.user_destinations
  for select
  to authenticated
  using (true);

-- Restrictive block-list gate, mirroring surfers_block_filter (live def dumped
-- 2026-07-13): a user blocked either direction must not leak destination rows
-- here when they're already hidden from surfers reads.
create policy "user_destinations_block_filter"
  on public.user_destinations
  as restrictive
  for select
  to authenticated
  using (
    not exists (
      select 1
      from user_blocks
      where (user_blocks.blocker_id = user_destinations.user_id
             and user_blocks.blocked_id = (select auth.uid()))
         or (user_blocks.blocker_id = (select auth.uid())
             and user_blocks.blocked_id = user_destinations.user_id)
    )
  );
