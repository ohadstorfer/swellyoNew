-- Stripe breaking is no longer silent.
--
-- Spec: docs/operator-trips-checklist.html §4 — "Stripe breaking is silent".
-- Type: 20260818000500 (must already be applied — see its header).
--
-- ── The scenario ────────────────────────────────────────────────────────────
-- When an operator's Stripe account becomes ready, `stripe-connect-webhook`
-- sends them a notification. When it becomes DISABLED — a verification
-- deadline passes, Stripe freezes payouts, Stripe rejects the account outright
-- — nothing fires at all. The webhook refreshes the row and returns 200. The
-- operator finds out when a traveler's payment fails, which is the worst
-- possible messenger: the first person to learn that the operator cannot be
-- paid is the customer trying to pay them.
--
-- ── Why a trigger and not a branch in the webhook ───────────────────────────
-- Three different things write these columns, and any of them can be the one
-- that notices:
--
--   • `stripe-connect-webhook`  — Stripe pushed `account.updated`
--   • `stripe-connect-onboard`  — the operator opened a screen that polls
--   • `refresh-connect-accounts` — the daily sweep (20260818000700)
--
-- Putting the rule in any one of them means the other two stay silent. Putting
-- it in the row itself means all three fire it, and a fourth writer added later
-- inherits it for free. Same reasoning that made cancel/leave/remove/decline
-- triggers rather than app code, so that the web dashboard notifies exactly
-- like the phone does.
--
-- It is also the only place where the edge can be read safely. The webhook
-- claimed its false→true transition with a conditional UPDATE, which works but
-- has to be re-derived by every writer; inside a row-level trigger OLD and NEW
-- are the edge, under the row lock, with no way for two concurrent writers to
-- both see it.
--
-- ── What is NOT here ────────────────────────────────────────────────────────
-- `requirements_due` growing on a live account — Stripe asking for something
-- with a deadline still in the future. It is the honest early warning, and it
-- is left out because the column that would make it useful (Stripe's
-- `current_deadline`) is not stored. Warning "Stripe needs something" with no
-- date attached, repeatedly, is how an operator learns to ignore us. Follow-up,
-- deliberately not guessed at.

-- ── 1. Push priority for the new type ───────────────────────────────────────
--
-- Rebuilt whole, from the LIVE definition (`pg_get_functiondef`), not from the
-- previous migration file — see the note in 20260818000300 about live drifting
-- ahead of the repo. The only edit is the one added line.
--
-- Priority by reason, the way `join_request_decided` already varies by
-- `decision`:
--   0 = urgent, bypasses quiet hours. Money has stopped moving. Waking someone
--       at 3am is justified precisely once, and this is it: every hour they do
--       not know is an hour of failed checkouts they are being blamed for.
--   1 = respects quiet hours. A warning with time left on it, or payouts
--       pausing while charges still work — bad, but not bad tonight.
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
    when 'operator_stripe_action_needed' then
      case when p_data->>'reason' in ('charges_disabled', 'blocked') then 0 else 1 end
    when 'operator_requirement_due_soon' then 1
    when 'operator_setup_required'      then 1
    when 'onboarding_unfinished'        then 1
    when 'operator_onboarding_stalled'  then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;

-- ── 2. The edge detector ────────────────────────────────────────────────────

create or replace function public.tg_notify_connect_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_reason text;
begin
  -- ⚠️ ONE notification per update, never one per symptom. A rejected account
  -- arrives with charges off, payouts off AND a disabled_reason in the same
  -- write; three separate `if`s would send three pushes about one event. The
  -- CASE stops at the first match, ordered by what the operator has to DO
  -- about it.
  v_reason := case
    -- Stripe refused the account in a way no form can fix. First, because it
    -- is the only one where the answer is "talk to Stripe" rather than "send
    -- them something" — and because it arrives wearing the other two as
    -- symptoms.
    --
    -- The list is `UNRECOVERABLE_REASONS` from src/services/trips/
    -- connectStatus.ts, and must stay equal to it. Deliberately NOT "any
    -- disabled_reason": Stripe reuses that field for `under_review`,
    -- `requirements.pending_verification` and `requirements.past_due`, which
    -- are ordinary stages of onboarding. Telling an operator whose paperwork
    -- is merely being read that they were refused is worse than saying
    -- nothing.
    when new.disabled_reason is distinct from old.disabled_reason
         and new.disabled_reason in (
           'rejected.fraud',
           'rejected.incomplete_verification',
           'rejected.listed',
           'rejected.other',
           'rejected.terms_of_service',
           'platform_paused',
           'listed'
         )
      then 'blocked'

    -- Payments have stopped. The outage itself.
    when old.charges_enabled and not new.charges_enabled
      then 'charges_disabled'

    -- Still selling, but a deadline has already passed — this is the warning
    -- that comes BEFORE the line above, and the entire reason to send anything
    -- at all. `new.charges_enabled` is required, and that guard is load-bearing:
    -- a failed SSN match leaves past_due set on an account that was NEVER live,
    -- where "you are about to lose payments" is simply false — they are
    -- mid-onboarding and the setup screen already says so. Same guard, same
    -- reason, as `action_needed` in connectStatus.ts.
    --
    -- Only on the empty→non-empty edge, so past_due growing from one item to
    -- two does not send a second push.
    when new.charges_enabled
         and cardinality(new.requirements_past_due) > 0
         and cardinality(old.requirements_past_due) = 0
      then 'past_due'

    -- Charges work, the bank transfer does not. Money piles up in their Stripe
    -- balance and never reaches them. Not urgent today and very much is later,
    -- which is exactly how the `ready` copy already describes it.
    when old.payouts_enabled and not new.payouts_enabled
      then 'payouts_disabled'

    else null
  end;

  -- ⚠️ NON-FATAL, and this block is load-bearing.
  --
  -- `operator_payout_accounts.user_id` references `auth.users`, but
  -- `notifications.recipient_id` references `public.users` — and 105 of the 811
  -- auth users have no `public.users` row (checked 2026-08-18). An operator who
  -- happens to be one of them would make this INSERT raise a foreign-key
  -- violation, and an exception in an AFTER trigger aborts the statement that
  -- fired it. That would mean the Stripe status write itself fails, the webhook
  -- returns 500, Stripe retries it forever, and the operator's account state
  -- never updates again — strictly worse than the silence this migration
  -- exists to fix.
  --
  -- So the notification is best-effort and the status write always wins, which
  -- is the same trade the webhook made deliberately when it owned this: "the
  -- status is already saved, which is the part that unblocks the operator in
  -- the app."
  --
  -- One block around both inserts, not two: the only realistic failure is the
  -- missing-user row above, which would take out either insert equally, and a
  -- warning naming the operator is enough to find it.
  begin

  if v_reason is not null then
    insert into public.notifications
      (recipient_id, trip_id, type, audience, entity_type, entity_id, data)
    values (
      new.user_id,
      -- Not about a trip. Like `operator_stripe_ready` and
      -- `operator_setup_required`, this is about the ACCOUNT, and it can fire
      -- before the operator's first trip exists.
      null,
      'operator_stripe_action_needed',
      'user',
      'payout_account',
      -- entity_id = the operator themselves, so the queue's dedup_key is
      -- stable rather than falling back to the notification's own row id,
      -- which is unique per insert and would therefore dedupe nothing.
      new.user_id,
      jsonb_build_object(
        'reason', v_reason,
        -- ⚠️ `stage` duplicates `reason` ON PURPOSE. tg_enqueue_push appends
        -- `data->>'stage'` to dedup_key, and without it a `past_due` warning
        -- still sitting pending would swallow the `charges_disabled` push that
        -- follows it — the escalation would be dropped in favour of the
        -- softer message. The app reads `reason`; only the queue reads this.
        'stage', v_reason,
        -- A count, never Stripe's field names. They are internal strings like
        -- 'individual.verification.document', and with Express accounts it is
        -- Stripe's own form that collects them — their docs say outright that
        -- we do not have to communicate the specific requirements.
        'past_due_count', cardinality(new.requirements_past_due)
      )
    );
  end if;

  -- The good news, moved here from `stripe-connect-webhook`.
  --
  -- It lived there since 20260805000100 and fired only when Stripe pushed
  -- `account.updated` to us. That made the promise on the waiting card — "We'll
  -- let you know the moment you can get paid" — conditional on a webhook
  -- endpoint being registered in a dashboard nobody re-checks, which is the
  -- same single point of failure that left the payment ledger empty for six
  -- days in August. Here, the daily sweep sends it too.
  --
  -- Not part of the CASE above: it is a different type, and an account that
  -- comes back to life after a past_due scare legitimately produces both.
  if new.charges_enabled and not old.charges_enabled then
    insert into public.notifications
      (recipient_id, trip_id, type, audience, entity_type, entity_id, data)
    values (new.user_id, null, 'operator_stripe_ready', 'user', 'payout_account', new.user_id, '{}'::jsonb);
  end if;

  exception when others then
    raise warning
      'tg_notify_connect_status: could not notify operator % about % (%)',
      new.user_id, coalesce(v_reason, 'ready'), sqlerrm;
  end;

  return null;  -- AFTER trigger; the return value is ignored.
end $$;

comment on function public.tg_notify_connect_status() is
  'Tells an operator when Stripe turns their payout account off, freezes their '
  'payouts, or turns it back on. Fires from the row, so the Connect webhook, '
  'the onboarding poll and the daily sweep all produce it identically.';

drop trigger if exists trg_notify_connect_status on public.operator_payout_accounts;

create trigger trg_notify_connect_status
  after update on public.operator_payout_accounts
  for each row
  -- The daily sweep rewrites every row every day, almost always with identical
  -- values and a fresh status_checked_at. This clause is what keeps that from
  -- entering the function 365 times a year per operator: only a material
  -- change gets that far.
  --
  -- past_due is compared as empty/non-empty rather than by contents, matching
  -- the edge the function actually acts on.
  when (
    old.charges_enabled is distinct from new.charges_enabled
    or old.payouts_enabled is distinct from new.payouts_enabled
    or old.disabled_reason is distinct from new.disabled_reason
    or (cardinality(old.requirements_past_due) = 0)
       is distinct from (cardinality(new.requirements_past_due) = 0)
  )
  execute function public.tg_notify_connect_status();

-- To undo:
--   drop trigger if exists trg_notify_connect_status on public.operator_payout_accounts;
--   drop function if exists public.tg_notify_connect_status();
--   (and restore the notification insert in stripe-connect-webhook)
