-- Rename the two per-participant gear columns on group_trip_participants:
--   personal_gear → personal_gear_by_me      (items the member added themselves)
--   group_gear    → personal_gear_by_host    (member's local copy of the host's
--                                            suggested checklist, with done state)
--
-- The host's master list on group_trips.group_gear is UNCHANGED — it's still the
-- source of truth, and a trigger continues to fan it out into each participant's
-- personal_gear_by_host column.
--
-- We have to drop+recreate the two trigger functions because they reference the
-- old participant column name (group_gear). We also drop+recreate the triggers
-- that bind them.
--
-- Applied 2026-05-28.

drop trigger if exists trg_init_participant_group_gear on public.group_trip_participants;
drop trigger if exists trg_sync_participant_group_gear on public.group_trips;

alter table public.group_trip_participants rename column personal_gear to personal_gear_by_me;
alter table public.group_trip_participants rename column group_gear    to personal_gear_by_host;

drop function if exists public.init_participant_group_gear();
drop function if exists public.sync_participant_group_gear();

create function public.init_participant_group_gear()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  trip_items text[];
begin
  if new.personal_gear_by_host is null or new.personal_gear_by_host = '[]'::jsonb then
    select group_gear into trip_items
      from public.group_trips
     where id = new.trip_id;

    if trip_items is not null and array_length(trip_items, 1) > 0 then
      new.personal_gear_by_host := (
        select coalesce(
          jsonb_agg(jsonb_build_object('name', n, 'done', false) order by ord),
          '[]'::jsonb
        )
        from unnest(trip_items) with ordinality as u(n, ord)
      );
    end if;
  end if;
  return new;
end;
$$;

create function public.sync_participant_group_gear()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.group_gear is distinct from old.group_gear then
    update public.group_trip_participants p
       set personal_gear_by_host = coalesce((
         select jsonb_agg(
                  jsonb_build_object(
                    'name', t.name,
                    'done', coalesce((
                      select (item->>'done')::boolean
                        from jsonb_array_elements(p.personal_gear_by_host) as item
                       where item->>'name' = t.name
                       limit 1
                    ), false)
                  ) order by t.ord
                )
           from unnest(new.group_gear) with ordinality as t(name, ord)
       ), '[]'::jsonb)
     where p.trip_id = new.id;
  end if;
  return new;
end;
$$;

create trigger trg_init_participant_group_gear
  before insert on public.group_trip_participants
  for each row execute function public.init_participant_group_gear();

create trigger trg_sync_participant_group_gear
  after update on public.group_trips
  for each row execute function public.sync_participant_group_gear();
