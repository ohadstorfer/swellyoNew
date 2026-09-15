-- The trip's refund terms are written once, at publish, and never again.
--
-- Product Specs §"Manage trip": "Only before any traveler joined: replace
-- waiver (for this trip specifically), edit cancellation policy (for this trip
-- specifically)." The waiver half has been true since 18 August
-- (20260818000100_waiver_replaceable_while_trip_is_empty). The policy half was
-- never built: `cancellation_preset` / `cancellation_rules` /
-- `cancellation_notes` are written in exactly one place in the whole product —
-- CreateTripFlowA, at publish — and after that an operator who chose the wrong
-- terms has no way back on either surface.
--
-- ── Why this needs a guard and not just a screen ───────────────────────────
-- Those three columns live on `group_trips`, whose UPDATE policy is
-- `trip_staff_can(id, 'trip.edit')`. Two separate problems follow, and RLS can
-- express neither, because RLS is row-level and both of these are about
-- columns and state:
--
--   WHO.  `trip.edit` is held by a Manager. Refund terms are money, and money
--         is fenced off from Managers everywhere else in this product —
--         prices authorise on group_trips.host_id (20260813200000), refunds
--         need money.manage. Terms decide what a refund IS, so they belong on
--         the same side of that fence. Decision D2, 4 September 2026.
--
--   WHEN. A traveler ticks these exact terms on the way to Stripe, and the
--         tick is recorded in organized_trip_policy_consents. Rewriting the
--         terms after that silently changes what somebody already agreed to,
--         which is the single thing this whole feature exists to prevent.
--
-- Same split the waiver guard uses, and for the same reason: policy for WHO,
-- trigger for WHEN. Here one trigger does both, because both are about the
-- same three columns.
--
-- ── "Empty" is not a member count ──────────────────────────────────────────
-- Copied deliberately from guard_waiver_replacement, which learned this the
-- hard way and wrote it down:
--
--   1. THE HOST IS A PARTICIPANT ROW on every type-C trip, so a literal
--      count(*) = 0 is never true and the carve-out would never open.
--   2. THE SIGNATURE-SHAPED CHECK IS THE LOAD-BEARING ONE. For the waiver that
--      is acknowledgements, because crew sign it and crew are not
--      participants. For the policy it is organized_trip_policy_consents,
--      because a traveler mid-onboarding has already ticked the terms and
--      holds no seat — participant_count does not see them, and they are
--      precisely the person this protects.
--
-- The member check is the rule as stated, and it keeps the promise easy to say
-- out loud: "you can change it until someone joins." The consent check is what
-- actually prevents harm.

-- ⚠️ DEFINER, unlike guard_operator_trip_money (20260813200000), which is
-- invoker. Not a style slip: this function has to COUNT rows in
-- organized_trip_policy_consents, whose only SELECT policy is
-- `user_id = auth.uid()`. Under invoker the operator would see nobody else's
-- consent, the count would come back 0 on a trip where ten people had ticked,
-- and the guard would wave the edit through. The money guard reads nothing —
-- it only compares columns and asks trip_staff_can() — so invoker is right
-- there and wrong here.
create or replace function public.guard_operator_trip_cancellation_policy()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_others integer;
  v_ticked integer;
begin
  -- Peer trips have no operator of record, no cancellation policy columns in
  -- use, and flat multi-host. Nothing to guard, and guarding them would be a
  -- behaviour change on trips this permission model does not describe.
  if new.hosting_style is distinct from 'C' then
    return new;
  end if;

  -- No JWT: the service role, a cron job, or a migration. Nothing writes these
  -- columns that way today; if something ever does it is not the threat this
  -- guards against, because it never carries a user's token.
  if auth.uid() is null then
    return new;
  end if;

  -- `is distinct from` on each column rather than a column list on the
  -- trigger: an editor that PATCHes the whole row sends every column on every
  -- save, so a column-list trigger would fire on a title change and refuse it.
  -- Only a real change is a change. Same reasoning as
  -- guard_operator_trip_dates.
  if new.cancellation_preset is not distinct from old.cancellation_preset
     and new.cancellation_rules is not distinct from old.cancellation_rules
     and new.cancellation_notes is not distinct from old.cancellation_notes then
    return new;
  end if;

  -- WHO. D2: the operator of record alone.
  if auth.uid() is distinct from old.host_id then
    raise exception
      'Only the operator of this trip can change its cancellation policy'
      using errcode = '42501';
  end if;

  -- WHEN, part one — the rule as promised. The host's own participant row does
  -- not count: they are the one asking.
  select count(*) into v_others
    from public.group_trip_participants p
   where p.trip_id = old.id
     and p.user_id is distinct from old.host_id;

  if v_others > 0 then
    raise exception
      'The cancellation policy cannot be changed once travelers have joined (% on this trip).',
      v_others
      using errcode = 'check_violation';
  end if;

  -- WHEN, part two — the one that actually prevents harm. Covers a traveler
  -- who is mid-onboarding: they have ticked these terms and hold no seat, so
  -- the count above cannot see them.
  select count(*) into v_ticked
    from public.organized_trip_policy_consents c
   where c.trip_id = old.id;

  if v_ticked > 0 then
    raise exception
      'The cancellation policy cannot be changed — % traveler(s) have already agreed to it.',
      v_ticked
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function public.guard_operator_trip_cancellation_policy() is
  'Column-level permission RLS cannot express: only group_trips.host_id may '
  'change cancellation_preset / _rules / _notes on an operator trip, and only '
  'while nobody has joined and nobody has agreed to them. group_trips UPDATE '
  'is trip.edit, which a Manager holds. Twin of guard_waiver_replacement — '
  'same carve-out, same trip, same moment it closes.';

-- House rule: nothing new is left executable by anon/authenticated. A trigger
-- function is not callable over PostgREST anyway, but get_advisors flags it.
revoke execute on function public.guard_operator_trip_cancellation_policy()
  from public, anon, authenticated;

drop trigger if exists trg_guard_operator_trip_cancellation_policy on public.group_trips;
create trigger trg_guard_operator_trip_cancellation_policy
  before update on public.group_trips
  for each row execute function public.guard_operator_trip_cancellation_policy();

-- ── Verify (read-only) ─────────────────────────────────────────────────────
-- select tgname from pg_trigger
--  where tgname = 'trg_guard_operator_trip_cancellation_policy';
--
-- Inside `begin; … rollback;`, with a Manager's claims on the session against a
-- hosting_style='C' trip — this must raise 42501:
--   update group_trips set cancellation_preset = 'non_refundable' where id = '<trip>';
-- and this must still succeed (no policy column changed):
--   update group_trips set title = title where id = '<trip>';
--
-- As the operator of record, on an EMPTY trip, the first one must succeed. On a
-- trip with one other participant, or one row in organized_trip_policy_consents,
-- it must raise check_violation naming the count.
