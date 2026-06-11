-- Gear realtime for TripDetailScreen (useTripRealtime.ts) — second half of
-- group_trips_realtime_publication.sql.
--
-- group_trip_gear_claims has no trip_id, so a per-trip realtime filter can't
-- match its events. Denormalize trip_id onto claims (autofilled by trigger),
-- then publish all three gear tables.

-- 1. Column + backfill from the parent gear item.
alter table public.group_trip_gear_claims
  add column trip_id uuid references public.group_trips(id) on delete cascade;

update public.group_trip_gear_claims c
set trip_id = i.trip_id
from public.group_trip_gear_items i
where i.id = c.item_id
  and c.trip_id is null;

-- 2. Autofill on insert so no client/edge-fn write path has to send trip_id.
--    SECURITY INVOKER: the inserting user can already read gear_items (the
--    claims INSERT policy itself joins it). search_path pinned per convention.
create or replace function public.set_gear_claim_trip_id()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
begin
  if new.trip_id is null then
    select i.trip_id into new.trip_id
    from public.group_trip_gear_items i
    where i.id = new.item_id;
  end if;
  return new;
end;
$$;

create trigger trg_gear_claims_set_trip_id
before insert on public.group_trip_gear_claims
for each row execute function public.set_gear_claim_trip_id();

-- 3. Backfill done + trigger in place → enforce.
alter table public.group_trip_gear_claims
  alter column trip_id set not null;

create index if not exists idx_gear_claims_trip_id
  on public.group_trip_gear_claims (trip_id);

-- 4. Publish the gear tables. REPLICA IDENTITY FULL so DELETE events
--    (unclaim, host removes an item) still carry trip_id and match the
--    per-trip filter — default replica identity is PK-only.
alter publication supabase_realtime add table public.group_trip_gear_claims;
alter publication supabase_realtime add table public.group_trip_gear_items;
alter publication supabase_realtime add table public.group_trip_gear_requests;

alter table public.group_trip_gear_claims replica identity full;
alter table public.group_trip_gear_items replica identity full;
alter table public.group_trip_gear_requests replica identity full;
