-- The traveler who paid the deposit and never finished onboarding.
--
-- Spec: docs/operator-trips-checklist.html §4 — "Deposit paid, onboarding
--       abandoned — and nobody notices".
-- Types: 20260818000200 (must already be applied — see its header).
--
-- ── The scenario ────────────────────────────────────────────────────────────
-- Approval takes no seat, and `activate_trip_membership` is what claims one.
-- So a traveler can pay their deposit, stop halfway through the documents, and
-- sit in `status = 'onboarding'` indefinitely:
--
--   • their money is with the operator,
--   • they are NOT on the trip and do not hold a spot,
--   • nothing tells them either of those things, and
--   • nothing tells the operator a paid traveler is stuck.
--
-- The only surface today is the dashboard's Waiting page, if the operator
-- thinks to look. Everything below closes that silence.
--
-- ── What counts as stalled ──────────────────────────────────────────────────
-- Deposit paid, still `onboarding`, and no activity for a while. "Activity" is
-- the LATEST of the four things a traveler can actually do — pay, upload a
-- document, sign something, fill the medical form — not the deposit date.
-- Clocking from the deposit would nag someone steadily working through a long
-- list, which is the opposite of the point.
--
-- Only managed trips: on an offline trip no payment event exists, so "paid"
-- cannot be observed here at all. Those travelers still stall silently — a
-- known follow-up, deliberately not guessed at.
--
-- ── Where the state lives ───────────────────────────────────────────────────
-- Three sent-at columns on the participant row, one per nudge, exactly like
-- `surfers.onboarding_reminder_*_sent_at` does for profile onboarding. A NULL
-- column IS the idempotency guard: the scanner claims a nudge by stamping it,
-- so a double cron run, a retry, or an overlapping invocation cannot send the
-- same message twice.
--
-- The operator digest is one column on the trip, not per traveler — ten people
-- stuck on one trip is one notification, not ten.
--
-- ✅ APPLIED to prod 2026-08-18.

-- ── 1. Nudge bookkeeping ────────────────────────────────────────────────────

alter table public.group_trip_participants
  add column if not exists stall_nudge_24h_sent_at timestamptz,
  add column if not exists stall_nudge_3d_sent_at  timestamptz,
  add column if not exists stall_nudge_7d_sent_at  timestamptz;

comment on column public.group_trip_participants.stall_nudge_24h_sent_at is
  'When the "you have not finished onboarding" nudge was sent. NULL = not yet; '
  'stamping it is how scan-stalled-onboarding claims the send, so a retry '
  'cannot duplicate it.';

alter table public.group_trips
  add column if not exists operator_stall_digest_sent_at timestamptz;

comment on column public.group_trips.operator_stall_digest_sent_at is
  'Last time the operator was told travelers are stuck in onboarding on this '
  'trip. One digest per trip, not one per traveler. Repeats weekly while '
  'anyone is still stuck.';

-- ── 2. What is still blocking one traveler ─────────────────────────────────
-- The state logic of `operator_trip_my_requirements`, for an ARBITRARY user
-- instead of auth.uid(). The scanner needs to name what someone is missing, and
-- that function can only answer about the caller.
--
-- must_have ONLY. Those are the rows that actually block `activate_trip_
-- membership`, so they are the true answer to "why am I not on the trip yet".
-- Listing a skippable item as "still needed" would simply be untrue.
--
-- Internal: revoked from everyone and called from inside another SECURITY
-- DEFINER function, the same shape as `operator_traveler_amount_due`. A direct
-- grant would buy nothing and widen the surface.

create or replace function public.operator_trip_outstanding_titles(
  p_trip_id uuid, p_user_id uuid
) returns text[]
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(array_agg(r.title order by r.sort_order), '{}'::text[])
  from public.organized_trip_requirements_resolved r
  join public.organized_trip_requirements base on base.id = r.id
  left join public.organized_trip_travelers_documents d
         on d.requirement_id = r.id and d.user_id = p_user_id
  left join public.group_trip_acknowledgements a
         on a.requirement_id = r.id and a.user_id = p_user_id
        and (r.kind <> 'waiver'
             or a.operator_document_id = (
                  select od.id from public.organized_trip_operator_documents od
                   where od.trip_id = r.trip_id and od.kind = 'waiver'
                   order by od.version desc limit 1))
  left join public.organized_trip_medical_forms m
         on m.trip_id = r.trip_id and m.user_id = p_user_id
  where r.trip_id = p_trip_id
    and r.is_active
    and base.audience = 'traveler'
    and r.skip_at_onboarding = 'must_have'
    and case
          when r.req_type = 'pay'
            then public.operator_requirement_pay_state(p_trip_id, p_user_id, r.id) <> 'approved'
          when r.req_type = 'acknowledge' then a.id is null
          when r.kind = 'medical'         then m.completed_at is null
          -- Everything else is a file. Rejected counts as outstanding: the
          -- traveler has to send another one.
          else d.id is null or d.rejected_at is not null
        end;
$$;

revoke execute on function public.operator_trip_outstanding_titles(uuid, uuid)
  from public, anon, authenticated;

comment on function public.operator_trip_outstanding_titles(uuid, uuid) is
  'The must_have requirement titles this traveler has not satisfied. Mirrors the '
  'state logic of operator_trip_my_requirements, for an arbitrary user rather '
  'than auth.uid(). must_have ONLY: those are what actually block activation, '
  'and naming a skippable item as "still needed" would be untrue. Internal — '
  'called from inside other SECURITY DEFINER functions, never granted.';

-- ── 3. Who is stalled ───────────────────────────────────────────────────────
-- One definition, two readers: the scanner that sends the nudges, and the
-- dashboard that lists them. Written once so the notification and the to-do can
-- never disagree about who is stuck or for how long.
--
-- SECURITY DEFINER because it reads payment events, documents and
-- acknowledgements across travelers — but it is NOT open: the `trip_staff_can`
-- clause means anyone without `roster.view` on this trip simply gets no rows.
-- Filtering rather than raising keeps it usable straight from PostgREST.
--
-- ⚠️ `auth.uid() is null` is part of that check, not an oversight. The scanner
-- runs under the service role, where auth.uid() IS null and `trip_staff_can`
-- therefore returns FALSE — verified, not assumed. Without this the nudge job
-- would quietly find nobody, forever, on every trip, and nothing would look
-- broken. Same idiom and same reasoning as `freeze_traveler_price`: a null uid
-- means the service role, and the service role is trusted. It is not a hole for
-- anon, who cannot execute this at all.
--
-- ⚠️ RETURNS TABLE cannot be changed by CREATE OR REPLACE — this is DROP +
-- CREATE, and a recreated function comes back EXECUTE-able by PUBLIC. The
-- revoke/grant below is load-bearing, not decoration.

drop function if exists public.operator_stalled_onboarders(uuid);

create function public.operator_stalled_onboarders(p_trip_id uuid)
returns table (
  user_id          uuid,
  deposit_paid_at  timestamptz,
  last_activity_at timestamptz,
  stalled_hours    integer,
  missing_titles   text[]
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with mode as (
    -- The same livemode idiom as operator_requirement_pay_state: an unset GUC
    -- reads NULL, one that was set and cleared reads '', and ''::boolean
    -- raises 22P02 instead of defaulting.
    select coalesce(
             nullif(current_setting('app.stripe_livemode', true), '')::boolean,
             false) as livemode
  ),
  paid as (
    select e.user_id, min(e.created_at) as first_paid_at
      from public.organized_trip_payment_events e, mode m
     where e.trip_id     = p_trip_id
       and e.event_type <> 'failed'
       and e.is_livemode = m.livemode
       and e.amount_usd  > 0
     group by e.user_id
  )
  select
    p.user_id,
    pd.first_paid_at,
    act.last_at,
    (extract(epoch from (now() - act.last_at)) / 3600)::integer,
    public.operator_trip_outstanding_titles(p_trip_id, p.user_id)
  from public.group_trip_participants p
  join paid pd
    on pd.user_id = p.user_id
  join public.group_trips t
    on t.id = p.trip_id
  cross join lateral (
    select greatest(
      pd.first_paid_at,
      coalesce((select max(d.uploaded_at) from public.organized_trip_travelers_documents d
                 where d.trip_id = p_trip_id and d.user_id = p.user_id), pd.first_paid_at),
      coalesce((select max(a.agreed_at)   from public.group_trip_acknowledgements a
                 where a.trip_id = p_trip_id and a.user_id = p.user_id), pd.first_paid_at),
      coalesce((select max(m2.updated_at) from public.organized_trip_medical_forms m2
                 where m2.trip_id = p_trip_id and m2.user_id = p.user_id), pd.first_paid_at)
    ) as last_at
  ) act
  where p.trip_id = p_trip_id
    and p.status  = 'onboarding'
    and p.role    = 'member'
    -- A cancelled trip has nothing to finish, and a trip that has already
    -- started is past nudging.
    and t.status  = 'active'
    and (t.start_date is null or t.start_date > current_date)
    and (auth.uid() is null or public.trip_staff_can(p_trip_id, 'roster.view'));
$$;

revoke execute on function public.operator_stalled_onboarders(uuid) from public, anon;
grant  execute on function public.operator_stalled_onboarders(uuid) to authenticated;

comment on function public.operator_stalled_onboarders(uuid) is
  'Travelers who paid a deposit on this managed trip and never finished '
  'onboarding, how long since they last did anything, and which must_have steps '
  'still block them. Feeds both the nudge scanner and the operator dashboard '
  'to-do, so the two cannot disagree.';

-- ── 4. Make the two new types actually PUSH ────────────────────────────────
-- ⚠️ `notification_push_priority` ends in `else -1`, and -1 means feed-only. A
-- new type missing from this list writes a bell row and never pushes — and
-- nothing looks broken, because the row does appear in the app. Both types are
-- listed below for exactly that reason.
--
-- Priority 1, not 0: zero bypasses quiet hours, which is reserved for things
-- happening to you right now. "You have not finished signing up" can wait for
-- morning, and so can "two people are stuck".
--
-- Body copied from the LIVE definition (pg_get_functiondef, 2026-08-18), NOT
-- from 20260811000000 — live carries `when 'gear_claimed' then -1`, which that
-- migration does not. Rebuilding from the repo would have dropped it. It maps
-- to the same -1 the `else` gives, so nothing would have changed behaviourally,
-- but the next person to read this function would have lost the record that the
-- silence is deliberate. The only edits here are the two added types.

create or replace function public.notification_push_priority(
  p_type notification_type, p_data jsonb
) returns smallint
language sql
immutable
as $$
  select case p_type
    when 'join_request_received'        then 0
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end
    when 'commitment_request_received'  then 0
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end
    when 'member_committed'             then 1
    when 'gear_request_received'        then 0
    when 'gear_request_decided'         then 1
    when 'admin_update_posted'          then 1
    when 'group_gear_updated'           then 1
    when 'personal_gear_updated'        then 1
    when 'member_left'                  then 1
    when 'trip_cancelled'               then 0
    when 'member_removed'               then 0
    when 'trip_invite_received'         then 0
    when 'operator_staff_invited'       then 0
    when 'trip_invite_accepted'         then 0
    when 'trip_invite_declined'         then 1
    when 'operator_document_rejected'   then 0
    when 'operator_requirement_added'   then 1
    when 'operator_requirement_overdue' then 0
    when 'operator_requirement_overdue_operator' then 1
    when 'operator_stripe_ready'        then 1
    when 'operator_requirement_due_soon' then 1
    when 'operator_setup_required'      then 1
    when 'onboarding_unfinished'        then 1
    when 'operator_onboarding_stalled'  then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;
