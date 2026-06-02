-- Fix: the host's "gear for everyone" edits were not fanning out to OTHER
-- participants' personal_gear_by_host rows — only the host's own row updated.
--
-- Root cause: sync_participant_group_gear() ran with the INVOKING host's
-- privileges (it was not SECURITY DEFINER). Its UPDATE over all trip
-- participants was silently narrowed by the RLS policy
--   "group_trip_participants user updates self"  (USING auth.uid() = user_id)
-- so only the host's own row was updated. Members' personal_gear_by_host stayed
-- empty, and the FE checkbox toggle (which maps over that array) was a no-op, so
-- members could never check host-suggested items.
--
-- Fix: run the function as SECURITY DEFINER so it executes as the function owner
-- and bypasses RLS, updating every participant row. search_path stays pinned to
-- public (required hygiene for SECURITY DEFINER — see the signup-trigger lesson).
--
-- The init trigger (init_participant_group_gear) is left as-is: it only mutates
-- the NEW row being inserted, so invoker rights are fine there.

create or replace function public.sync_participant_group_gear()
returns trigger
language plpgsql
security definer
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

-- One-time backfill: repair member rows that are already stale (trips edited
-- before this fix). Mirrors the trigger body but runs for every existing trip.
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
       from unnest(gt.group_gear) with ordinality as t(name, ord)
   ), '[]'::jsonb)
  from public.group_trips gt
 where gt.id = p.trip_id
   and array_length(gt.group_gear, 1) > 0;
