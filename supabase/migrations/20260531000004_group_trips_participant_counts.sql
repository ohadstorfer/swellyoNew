-- Add participant capacity columns to group_trips:
--   max_participants  — host-set cap on total people (incl. host). Nullable = no cap.
--   participant_count — LIVE count of joined people (incl. host). Maintained by a
--                       trigger on group_trip_participants; never written by the client.
--
-- participant_count lets Explore/detail cards show "3/8 joined" without a join.

alter table public.group_trips
  add column if not exists max_participants integer,
  add column if not exists participant_count integer not null default 1;

comment on column public.group_trips.max_participants is
  'Host-set cap on total participants incl. host. NULL = no cap.';
comment on column public.group_trips.participant_count is
  'Live count of joined participants incl. host. Trigger-maintained — do not write from the client.';

-- ============================================================================
-- Backfill the live count from existing rows in group_trip_participants.
-- ============================================================================
update public.group_trips t
set participant_count = coalesce(c.cnt, 0)
from (
  select trip_id, count(*)::int as cnt
  from public.group_trip_participants
  group by trip_id
) c
where c.trip_id = t.id;

-- Trips with no participant rows at all fall back to 1 (the host).
update public.group_trips
set participant_count = 1
where participant_count = 0;

-- ============================================================================
-- Trigger: recompute participant_count for the affected trip on any change to
-- group_trip_participants (insert / delete / trip_id move).
-- ============================================================================
create or replace function public.sync_group_trip_participant_count()
returns trigger
language plpgsql
security definer
as $$
declare
  affected uuid;
begin
  -- Recount the row's trip (covers INSERT/UPDATE via NEW).
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') then
    affected := new.trip_id;
    update public.group_trips t
    set participant_count = (
      select count(*) from public.group_trip_participants p where p.trip_id = affected
    )
    where t.id = affected;
  end if;

  -- Recount the old trip too (covers DELETE, and trip_id moves on UPDATE).
  if (tg_op = 'DELETE' or tg_op = 'UPDATE') then
    affected := old.trip_id;
    if affected is not null then
      update public.group_trips t
      set participant_count = (
        select count(*) from public.group_trip_participants p where p.trip_id = affected
      )
      where t.id = affected;
    end if;
  end if;

  return null; -- AFTER trigger, return value ignored.
end;
$$;

drop trigger if exists trg_sync_participant_count on public.group_trip_participants;
create trigger trg_sync_participant_count
after insert or update or delete on public.group_trip_participants
for each row execute function public.sync_group_trip_participant_count();
