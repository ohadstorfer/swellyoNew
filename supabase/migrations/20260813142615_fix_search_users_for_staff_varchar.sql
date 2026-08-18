-- Fix: staff search always returned "Nobody found".
--
-- APPLIED to prod 2026-08-13 (schema_migrations version 20260813142615).
--
-- 20260807000400 declared `returns table(user_id uuid, name text,
-- profile_image_url text)` but selects straight out of `public.surfers`, where
-- both columns are `varchar` (255 and 2048). Postgres will not widen a varchar
-- into a text OUT column on RETURN QUERY — it raises
--
--   42804: structure of query does not match function result type
--   DETAIL: Returned type character varying(255) does not match expected type
--           text in column 2
--
-- so EVERY call failed, for every query, from the day it shipped. It looked
-- like an empty result because TripStaffSheet's search `.catch()` sets the
-- result list to [], which renders the same "Nobody found" state as a genuine
-- zero-row answer. Nothing else about the function changes here: same guard,
-- same two-character floor, same exclusions, same ordering, same limit.
--
-- The casts go in the SELECT rather than on the signature. Changing the
-- signature would mean dropping the function (return type is part of it), and
-- `text` is what the client already expects.

create or replace function public.search_users_for_staff(
  p_trip_id uuid,
  p_query   text
)
returns table(user_id uuid, name text, profile_image_url text)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not exists (
    select 1 from public.group_trips
    where id = p_trip_id and host_id = auth.uid() and hosting_style = 'C'
  ) then
    raise exception 'Only the operator of this trip can search for crew'
      using errcode = '42501';
  end if;

  -- Two characters minimum. A one-character query returns a slice of the whole
  -- user table, which is the enumeration this guard exists to prevent.
  if length(v_q) < 2 then
    return;
  end if;

  return query
  select s.user_id, s.name::text, s.profile_image_url::text
    from public.surfers s
   where s.name ilike '%' || v_q || '%'
     and s.user_id <> auth.uid()
     -- Already crew on this trip.
     and not exists (
       select 1 from public.organized_trip_staff st
        where st.trip_id = p_trip_id and st.user_id = s.user_id
          and st.revoked_at is null
     )
     -- Already a traveler: staff and travelers are exclusive (I3), so offering
     -- them would only produce a trigger error at insert time.
     and not exists (
       select 1 from public.group_trip_participants p
        where p.trip_id = p_trip_id and p.user_id = s.user_id
     )
     -- Already has an invite waiting.
     and not exists (
       select 1 from public.organized_trip_staff_invites i
        where i.trip_id = p_trip_id and i.invited_user_id = s.user_id
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     )
     -- Blocks, both directions.
     and not exists (
       select 1 from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = s.user_id)
           or (b.blocker_id = s.user_id and b.blocked_id = auth.uid())
     )
   order by
     -- Prefix matches first: typing "mar" should surface Marta before Omar.
     case when s.name ilike v_q || '%' then 0 else 1 end,
     s.name
   limit 20;
end $$;

-- CREATE OR REPLACE re-grants EXECUTE to PUBLIC. Re-apply the lockdown, or
-- anon regains a user-search endpoint.
revoke execute on function public.search_users_for_staff(uuid, text) from public, anon;
grant  execute on function public.search_users_for_staff(uuid, text) to authenticated;
