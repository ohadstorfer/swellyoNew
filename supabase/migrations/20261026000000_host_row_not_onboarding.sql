-- The trip owner's own participant row is never 'onboarding'.
--
-- Why: enforce_participant_status forced status = 'onboarding' on EVERY
-- user-made INSERT into an operator trip (hosting_style 'C'), including the
-- host row the app inserts when the operator creates the trip
-- (groupTripsService.createGroupTrip). So operators saw "Start onboarding" on
-- their own trip (21 Oct 2026 test), and 5 live trips had their host row stuck
-- in 'onboarding' — outside participant_count, unlike the 7 older ones.
--
-- How: exempt the trip's owner (group_trips.host_id), and backfill those rows.
-- NOT `role = 'host'`: the insert policy lets an approved requester insert a
-- row with any role, so a role check would let a traveler skip onboarding and
-- payment. Owning the trip cannot be faked from the client.
--
-- Side effects of the backfill, checked against prod 26 Oct 2026:
--   - participant_count goes +1 on each of the 5 trips (all far from full).
--   - tg_notify_member_joined skips the host — no notifications.
--   - enforce_traveler_not_staff exempts host_id — no error.
--   - freeze_traveler_price leaves prices alone on UPDATE.
--
-- Body copied from the live function (prod, 26 Oct 2026); only the INSERT
-- branch changes. CREATE OR REPLACE keeps the grants; restated below.
--
-- Undo: supabase/rollbacks/20261026000000_host_row_not_onboarding_rollback.sql

create or replace function public.enforce_participant_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_style text; v_host uuid;
begin
  if auth.uid() is null then
    return new;                        -- service role / trusted server paths
  end if;
  if coalesce(nullif(current_setting('app.membership_activation', true), ''), 'off') = 'on' then
    return new;                        -- activate_trip_membership(), rejoin
  end if;
  if coalesce(nullif(current_setting('app.membership_departure', true), ''), 'off') = 'on' then
    return new;                        -- leave_operator_trip(), operator_remove_traveler()
  end if;

  if tg_op = 'INSERT' then
    select t.hosting_style, t.host_id into v_style, v_host
      from public.group_trips t where t.id = new.trip_id;
    -- The owner runs the trip; they have nothing to onboard into.
    new.status := case
      when v_style = 'C' and new.user_id is distinct from v_host then 'onboarding'
      else 'active'
    end;
    return new;
  end if;

  new.status := old.status;            -- silently does not move
  return new;
end $function$;

revoke all on function public.enforce_participant_status() from public, anon, authenticated;
grant execute on function public.enforce_participant_status() to service_role;

-- Backfill. Runs without a JWT, so enforce_participant_status lets it through.
update public.group_trip_participants p
   set status = 'active'
  from public.group_trips t
 where t.id = p.trip_id
   and t.hosting_style = 'C'
   and p.user_id = t.host_id
   and p.status = 'onboarding';
