-- Rename `packing_list` → `group_gear` on both group_trips and
-- group_trip_participants, and rename the two sync trigger functions/triggers
-- to match. (Note: this name now overlaps verbally with the shared-gear tables
-- `group_trip_gear_items` / `_gear_claims` / `_gear_requests` — accepted by
-- the team. `group_gear` here = the host's suggested checklist; the gear tables
-- = collective gear with quantities + approval.)
--
-- Also pins search_path=public on both trigger functions (defensive — they
-- weren't broken, but matches the lesson from the signup search_path bug).
--
-- Applied 2026-05-28.

drop trigger if exists trg_init_participant_packing_list on public.group_trip_participants;
drop trigger if exists trg_sync_participant_packing_lists on public.group_trips;

alter table public.group_trips           rename column packing_list to group_gear;
alter table public.group_trip_participants rename column packing_list to group_gear;

drop function if exists public.init_participant_packing_list();
drop function if exists public.sync_participant_packing_lists();

create function public.init_participant_group_gear()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  trip_items text[];
begin
  if new.group_gear is null or new.group_gear = '[]'::jsonb then
    select group_gear into trip_items
      from public.group_trips
     where id = new.trip_id;

    if trip_items is not null and array_length(trip_items, 1) > 0 then
      new.group_gear := (
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
       set group_gear = coalesce((
         select jsonb_agg(
                  jsonb_build_object(
                    'name', t.name,
                    'done', coalesce((
                      select (item->>'done')::boolean
                        from jsonb_array_elements(p.group_gear) as item
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
