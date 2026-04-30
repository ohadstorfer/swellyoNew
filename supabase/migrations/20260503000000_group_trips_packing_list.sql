-- Packing list (personal items to bring): master list at trip level, edited by
-- the host. Each participant row carries its own jsonb list with {name, done}
-- so each user toggles their own progress without affecting others.

alter table public.group_trips
  add column if not exists packing_list text[] not null default '{}';

alter table public.group_trip_participants
  add column if not exists packing_list jsonb not null default '[]'::jsonb;

-- When a participant is inserted, seed their packing_list from the trip's
-- master list (all items done=false). Runs BEFORE INSERT so we set NEW.
create or replace function public.init_participant_packing_list()
returns trigger
language plpgsql
as $$
declare
  trip_items text[];
begin
  if new.packing_list is null or new.packing_list = '[]'::jsonb then
    select packing_list into trip_items
      from public.group_trips
     where id = new.trip_id;

    if trip_items is not null and array_length(trip_items, 1) > 0 then
      new.packing_list := (
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

drop trigger if exists trg_init_participant_packing_list on public.group_trip_participants;
create trigger trg_init_participant_packing_list
  before insert on public.group_trip_participants
  for each row execute function public.init_participant_packing_list();

-- When the host updates the trip's master list, sync all participant rows:
-- preserve done state for items that still exist, add new items with done=false,
-- drop items removed from the master list.
create or replace function public.sync_participant_packing_lists()
returns trigger
language plpgsql
as $$
begin
  if new.packing_list is distinct from old.packing_list then
    update public.group_trip_participants p
       set packing_list = coalesce((
         select jsonb_agg(
                  jsonb_build_object(
                    'name', t.name,
                    'done', coalesce((
                      select (item->>'done')::boolean
                        from jsonb_array_elements(p.packing_list) as item
                       where item->>'name' = t.name
                       limit 1
                    ), false)
                  ) order by t.ord
                )
           from unnest(new.packing_list) with ordinality as t(name, ord)
       ), '[]'::jsonb)
     where p.trip_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_participant_packing_lists on public.group_trips;
create trigger trg_sync_participant_packing_lists
  after update on public.group_trips
  for each row execute function public.sync_participant_packing_lists();
