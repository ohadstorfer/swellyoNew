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
