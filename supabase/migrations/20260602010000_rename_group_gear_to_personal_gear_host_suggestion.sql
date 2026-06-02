-- Rename the host's master gear column on group_trips:
--   group_gear → personal_gear_host_suggestion
--
-- "group_gear" was misleading: this column is the HOST's suggested checklist
-- (text[]), not a shared/group resource. It fans out into each participant's
-- personal_gear_by_host (jsonb) via the sync trigger.
--
-- Two trigger functions read this column by name, so after the rename we
-- `create or replace` their bodies to point at the new name. The triggers
-- themselves stay bound (no drop needed). The sync function keeps SECURITY
-- DEFINER — it must bypass RLS to fan edits out to every participant (see
-- 20260601000000_fix_sync_participant_gear_security_definer.sql).
--
-- Applied 2026-06-02.

alter table public.group_trips rename column group_gear to personal_gear_host_suggestion;

create or replace function public.init_participant_group_gear()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  trip_items text[];
begin
  if new.personal_gear_by_host is null or new.personal_gear_by_host = '[]'::jsonb then
    select personal_gear_host_suggestion into trip_items
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

create or replace function public.sync_participant_group_gear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.personal_gear_host_suggestion is distinct from old.personal_gear_host_suggestion then
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
           from unnest(new.personal_gear_host_suggestion) with ordinality as t(name, ord)
       ), '[]'::jsonb)
     where p.trip_id = new.id;
  end if;
  return new;
end;
$$;
