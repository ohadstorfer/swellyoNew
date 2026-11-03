-- Undo 20261026000000_host_row_not_onboarding.sql: restore the trigger as it
-- was live before 26 Oct 2026.
--
-- The backfill is NOT undone: putting the 5 host rows back to 'onboarding'
-- would bring back "Start onboarding" on the operator's own trip. If you
-- really need it, these were the rows (trip id → host user id):
--   46cd0d80-ca28-472b-8c2c-bfadf7e17edb → 58d118be-ca84-452c-8fce-b3c4771427b2
--   6765ef22-f1c2-443f-8b6a-8547664d908d → 1b14b97d-0bcf-4355-a4a2-484fb449fdbb
--   ba66c157-6245-4815-8768-0f8b7c98a961 → b8597836-81f6-43ee-a424-001d85864b74
--   24d7d7fd-25fb-4494-8cac-bc05268d0e32 → b8597836-81f6-43ee-a424-001d85864b74
--   d06317e9-fa2e-43a6-bca7-fb5fc4ae80f6 → deae948d-33b3-4131-a4e9-9a6a3fd6e531

create or replace function public.enforce_participant_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_style text;
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
    select t.hosting_style into v_style
      from public.group_trips t where t.id = new.trip_id;
    new.status := case when v_style = 'C' then 'onboarding' else 'active' end;
    return new;
  end if;

  new.status := old.status;            -- silently does not move
  return new;
end $function$;

revoke all on function public.enforce_participant_status() from public, anon, authenticated;
grant execute on function public.enforce_participant_status() to service_role;
