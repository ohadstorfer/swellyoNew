-- dev_reset_my_onboarding — wipe the CALLER'S OWN onboarding evidence on one
-- trip, so the traveler-onboarding flow can be walked again from the start.
--
-- This exists because there is no separate dev database: migrations are applied
-- by hand to the one production project, so a tool that only makes sense in
-- development still has to live there. It is therefore built to be boring even
-- if someone finds it and calls it.
--
-- FOUR GUARDS, none of them decoration:
--
--  1. HOST ONLY. The caller must be the operator of record (`group_trips.host_id`)
--     of the trip they are resetting. A real traveler cannot call this at all,
--     which is what keeps it out of reach of the people it could confuse.
--  2. OWN ROWS ONLY. Every delete is scoped to auth.uid(). There is no path
--     here to touching another traveler's waiver, medical form or documents,
--     not even for the host of the trip.
--  3. NEVER LIVE MONEY. Payment events are deleted ONLY where
--     `is_livemode = false`. Real money is an audit trail, and this function
--     must not be the reason one goes missing. A live row makes the call fail
--     rather than silently doing less than it says.
--  4. OPERATOR TRIPS ONLY. hosting_style 'C'. Peer trips have no onboarding.
--
-- It does NOT touch `group_trip_participants.status`. The demo is run by the
-- trip's own host, whose row is role='host'/'active'; flipping that to
-- 'onboarding' would drop them out of participant_count and the member list.
-- Clearing the evidence is enough for the flow to replay.
--
-- Storage files are NOT removed here — the client removes them first and then
-- calls this, which is the same order operator_reject_document uses (files
-- first, row second, so a failure never leaves a row pointing at nothing).

create or replace function public.dev_reset_my_onboarding(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_host   uuid;
  v_style  text;
  v_live   integer;
  v_docs   integer;
  v_acks   integer;
  v_med    integer;
  v_pays   integer;
begin
  select host_id, hosting_style into v_host, v_style
    from public.group_trips where id = p_trip_id;

  if v_host is null then
    raise exception 'No such trip' using errcode = 'no_data_found';
  end if;

  -- Guard 1: host of record only.
  if v_host is distinct from auth.uid() then
    raise exception 'Only the operator of this trip can reset their own onboarding'
      using errcode = 'insufficient_privilege';
  end if;

  -- Guard 4: operator trips only.
  if v_style is distinct from 'C' then
    raise exception 'Onboarding only exists on operator trips'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Guard 3: refuse outright if there is any real money on this row set.
  -- Failing loudly beats deleting the test rows and leaving the live ones,
  -- which would look like a successful reset and behave like a broken one.
  select count(*) into v_live
    from public.organized_trip_payment_events
   where trip_id = p_trip_id and user_id = auth.uid() and is_livemode;

  if v_live > 0 then
    raise exception 'Refusing to reset: % live payment(s) on this trip. Real money is not a demo fixture.', v_live
      using errcode = 'insufficient_privilege';
  end if;

  with d as (
    delete from public.organized_trip_travelers_documents
     where trip_id = p_trip_id and user_id = auth.uid() returning 1)
  select count(*) into v_docs from d;

  with a as (
    delete from public.group_trip_acknowledgements
     where trip_id = p_trip_id and user_id = auth.uid() returning 1)
  select count(*) into v_acks from a;

  with m as (
    delete from public.organized_trip_medical_forms
     where trip_id = p_trip_id and user_id = auth.uid() returning 1)
  select count(*) into v_med from m;

  with p as (
    delete from public.organized_trip_payment_events
     where trip_id = p_trip_id and user_id = auth.uid()
       and is_livemode = false returning 1)
  select count(*) into v_pays from p;

  return jsonb_build_object(
    'documents', v_docs, 'acknowledgements', v_acks,
    'medical', v_med, 'payments', v_pays);
end;
$$;

revoke execute on function public.dev_reset_my_onboarding(uuid) from public, anon;
grant  execute on function public.dev_reset_my_onboarding(uuid) to authenticated;

comment on function public.dev_reset_my_onboarding(uuid) is
  'DEV TOOL. Clears the calling operator''s OWN onboarding evidence on their OWN '
  'operator trip so the flow can be replayed. Host-of-record only; never deletes '
  'livemode payment events (raises instead). Does not touch participant status.';
