-- Add group_trip_join_requests to the supabase_realtime publication so the
-- requester's client can receive UPDATE events when the host approves or
-- declines their request. Without this, postgres_changes subscriptions
-- against this table deliver nothing.
--
-- Mirrors the idempotent guard from realtime_surftrips_and_system_banners.sql.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_trip_join_requests'
  ) then
    raise notice 'Realtime already enabled for group_trip_join_requests';
  else
    alter publication supabase_realtime add table public.group_trip_join_requests;
    raise notice 'Realtime enabled for group_trip_join_requests';
  end if;
end $$;
