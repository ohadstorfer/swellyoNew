-- ─────────────────────────────────────────────────────────────────────────────
-- Departed members, phase 2: the two ways to leave, and telling the operator.
--
-- REQUIRES 20260906000300 (phase 1). Applying this first leaves both functions
-- raising a CHECK violation, because 'left' and 'removed' are not yet legal
-- values of `status`.
--
-- Phase 1 taught the database that a participant row can say somebody is gone.
-- This file is the only way to write one. Both functions:
--
--   · verify the caller the way the delete they replace was verified;
--   · lift `app.membership_departure` for exactly one statement, because
--     `enforce_participant_status` pins `status` against every user token —
--     the same shape as `activate_trip_membership` and its own GUC;
--   · return 'peer' without touching anything on a non-operator trip, so the
--     caller falls back to the ordinary delete. Peer trips have no money and
--     no documents, and G-01/G-02 in the test pass exist to keep them that
--     way.
--
-- The chat banner, the group-conversation removal and the join-request cleanup
-- stay in the client, unchanged. They are the same on both trip types and they
-- are allowed to fail without costing anything.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The traveler's own Exit ─────────────────────────────────────────────────

create or replace function public.leave_operator_trip(p_trip_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_style  text;
  v_status text;
begin
  select t.hosting_style into v_style
    from public.group_trips t where t.id = p_trip_id;

  if v_style is null then
    raise exception 'No such trip' using errcode = 'no_data_found';
  end if;

  -- Peer trips keep the old behaviour exactly. The caller deletes.
  if v_style is distinct from 'C' then
    return 'peer';
  end if;

  select p.status into v_status
    from public.group_trip_participants p
   where p.trip_id = p_trip_id and p.user_id = auth.uid();

  if v_status is null then
    raise exception 'Not a participant of this trip'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent: pressing Leave twice is one departure, and the second press
  -- must not overwrite `left_at` with a later time than the one the operator
  -- was told about.
  if v_status in ('left', 'removed') then
    return 'left';
  end if;

  -- The owner cannot leave their own trip. `protect_trip_owner_membership`
  -- refuses the write anyway; this turns a raw trigger error into a sentence.
  if exists (select 1 from public.group_trips
              where id = p_trip_id and host_id = auth.uid()) then
    raise exception 'The organiser of a trip cannot leave it. Cancel it instead.'
      using errcode = '42501';
  end if;

  -- Tell the operator BEFORE the mark: fn_notify_member_left reads the paid
  -- total off the ledger, which survives either way, but it also verifies the
  -- caller is on the trip and that test is cheaper to satisfy than to weaken.
  begin
    perform public.fn_notify_member_left(p_trip_id);
  exception when others then
    -- A lost heads-up must never block somebody leaving.
    raise warning 'leave_operator_trip: notify failed for % (%)', p_trip_id, sqlerrm;
  end;

  perform set_config('app.membership_departure', 'on', true);

  update public.group_trip_participants
     set status      = 'left',
         left_at     = now(),
         left_by     = null,      -- null means "they left themselves"
         left_reason = null
   where trip_id = p_trip_id
     and user_id = auth.uid();

  perform set_config('app.membership_departure', 'off', true);

  return 'left';
end;
$function$;

comment on function public.leave_operator_trip(uuid) is
  'A traveler leaves an operator trip. Marks the row ''left'' and keeps it, so the money, documents and consents stay reachable to the operator. Returns ''peer'' untouched on a non-operator trip — the caller deletes those.';

-- ── The operator removing somebody ──────────────────────────────────────────

create or replace function public.operator_remove_traveler(
  p_trip_id uuid,
  p_user_id uuid,
  p_reason  text default null
)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_style  text;
  v_status text;
  v_owner  uuid;
begin
  select t.hosting_style, t.host_id into v_style, v_owner
    from public.group_trips t where t.id = p_trip_id;

  if v_style is null then
    raise exception 'No such trip' using errcode = 'no_data_found';
  end if;

  if v_style is distinct from 'C' then
    return 'peer';
  end if;

  -- `travelers.remove` is the capability the Remove button is gated on, on
  -- both surfaces. The refund is a separate capability (`money.manage`) and a
  -- separate call — a Manager may remove somebody who paid nothing and is
  -- refused by payments-refund if they try to send money, which is X-05.
  if not public.trip_staff_can(p_trip_id, 'travelers.remove') then
    raise exception 'You do not have permission to remove travelers from this trip'
      using errcode = '42501';
  end if;

  if p_user_id = v_owner then
    raise exception 'The organiser of a trip cannot be removed from it'
      using errcode = '42501';
  end if;

  select p.status into v_status
    from public.group_trip_participants p
   where p.trip_id = p_trip_id and p.user_id = p_user_id;

  if v_status is null then
    raise exception 'That person is not on this trip'
      using errcode = 'no_data_found';
  end if;

  if v_status in ('left', 'removed') then
    return 'removed';
  end if;

  perform set_config('app.membership_departure', 'on', true);

  update public.group_trip_participants
     set status      = 'removed',
         left_at     = now(),
         left_by     = auth.uid(),
         left_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where trip_id = p_trip_id
     and user_id = p_user_id;

  perform set_config('app.membership_departure', 'off', true);

  return 'removed';
end;
$function$;

comment on function public.operator_remove_traveler(uuid, uuid, text) is
  'Staff with travelers.remove take somebody off an operator trip. Marks the row ''removed'' with who and why, and keeps it. Returns ''peer'' untouched on a non-operator trip. The refund is a separate call — this never moves money.';

-- Both are called from the client, so both need the grant explicitly: the
-- 2026-06-10 hardening revoked the default PUBLIC EXECUTE across public, and a
-- new SECURITY DEFINER function without this line 403s.
revoke execute on function public.leave_operator_trip(uuid) from public, anon;
revoke execute on function public.operator_remove_traveler(uuid, uuid, text) from public, anon;
grant execute on function public.leave_operator_trip(uuid) to authenticated;
grant execute on function public.operator_remove_traveler(uuid, uuid, text) to authenticated;

-- ── "Someone left" now says what they paid ──────────────────────────────────
--
-- The old version told the primary host that a member left and nothing else.
-- On an operator trip that is the exact moment money goes quiet: the traveler
-- keeps nothing, the operator is owed a decision, and the only signal was a
-- sad-face push about a free seat. It now carries `paid_usd` and goes to
-- everyone who could actually act on it — the operator of record and any
-- co-operator, i.e. `money.manage` — instead of the primary host alone.
--
-- Peer trips are untouched: no ledger, no money.manage staff, so the same
-- single row lands on the same host as before.

create or replace function public.fn_notify_member_left(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_host     uuid;
  v_title    text;
  v_style    text;
  v_name     text;
  v_paid     numeric := 0;
  v_livemode boolean;
  v_data     jsonb;
begin
  -- Deliberately NOT filtered on status: this is called from inside
  -- leave_operator_trip just before the mark, and from the client just before
  -- the peer-trip delete. Both are still rows at that moment.
  if not exists (
    select 1 from public.group_trip_participants
    where trip_id = p_trip_id and user_id = auth.uid()
  ) then
    raise exception 'not a participant of this trip';
  end if;

  select host_id, title, hosting_style
    into v_host, v_title, v_style
    from public.group_trips where id = p_trip_id;

  if v_host is null or v_host = auth.uid() then
    return;  -- host leaving is not a "member left" event
  end if;

  v_name := public.user_display_name(auth.uid());
  v_data := jsonb_build_object('actor_name', v_name, 'trip_title', v_title);

  if v_style = 'C' then
    v_livemode := coalesce(
      nullif(current_setting('app.stripe_livemode', true), '')::boolean, false);

    -- Net of refunds already issued, in the mode we count — the same sum as
    -- operator_requirement_pay_state and the dashboard's money page.
    select coalesce(sum(e.amount_usd), 0) into v_paid
      from public.organized_trip_payment_events e
     where e.trip_id     = p_trip_id
       and e.user_id     = auth.uid()
       and e.event_type <> 'failed'
       and e.is_livemode = v_livemode;

    if v_paid > 0 then
      v_data := v_data || jsonb_build_object('paid_usd', v_paid);
    end if;

    -- Everyone who could decide the refund. `money.manage` is the operator of
    -- record and any co-operator; a Manager holds `travelers.remove` but not
    -- this, and telling them about money they cannot move is noise.
    insert into public.notifications
      (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
    select distinct uid, p_trip_id, 'member_left', 'admin', auth.uid(),
           'participant', auth.uid(), v_data
    from (
      select v_host as uid
      union
      select s.user_id
        from public.organized_trip_staff s
       where s.trip_id     = p_trip_id
         and s.user_id     is not null
         and s.accepted_at is not null
         and s.revoked_at  is null
         and s.role_key    = 'co_operator'
    ) x
    where uid is not null and uid <> auth.uid();

    return;
  end if;

  insert into public.notifications
    (recipient_id, trip_id, type, audience, actor_id, entity_type, entity_id, data)
  values (v_host, p_trip_id, 'member_left', 'admin', auth.uid(), 'participant', auth.uid(), v_data);
end $function$;

-- `fn_notify_member_left` was already granted to authenticated by the
-- 2026-06-10 hardening's re-grant list. CREATE OR REPLACE keeps that ACL; the
-- line is repeated here so a future DROP+CREATE of this function cannot
-- silently lose it (see reference_function_recreate_regrants_public).
revoke execute on function public.fn_notify_member_left(uuid) from public, anon;
grant execute on function public.fn_notify_member_left(uuid) to authenticated;
