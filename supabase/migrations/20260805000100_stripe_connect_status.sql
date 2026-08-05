-- Stripe Connect: remember MORE than one boolean about an operator's account.
--
-- ── The problem this fixes ──────────────────────────────────────────────────
-- `operator_payout_accounts` stored exactly one fact: charges_enabled. Stripe's
-- own model has at least six states, and two of them are indistinguishable
-- through a single boolean:
--
--   • "they never finished the form"     → charges_enabled = false
--   • "they finished and Stripe is       → charges_enabled = false
--      reviewing them"
--
-- The app therefore drew the same "Connect Stripe" button in both, so an
-- operator who had just completed onboarding — and had been told by Stripe
-- "We will review the information you submitted" — came back to a screen that
-- looked like nothing had happened, and to a Next button that refused to move.
-- The only affordance offered was the button they had just used.
--
-- Stripe's guidance (docs.stripe.com/connect/track-account-onboarding):
--   "When a connected account exits the onboarding flow … it doesn't confirm
--    that they've provided all outstanding requirements. You must still check
--    the statuses of the requested capabilities."
-- and, on the `pending` capability status:
--   "The capability isn't active, but you don't need to provide any
--    requirements. Stripe might be in the process of verifying provided
--    information."
--
-- The columns below are exactly what is needed to tell those two apart, and to
-- tell "we need one more thing from you" apart from "we cannot approve you".
--
-- ── PREREQUISITE ────────────────────────────────────────────────────────────
-- Run 20260805000000_stripe_connect_status_enum.sql FIRST and let it commit.
-- notification_push_priority below references 'operator_stripe_ready', and
-- Postgres refuses to use an enum value added in the same transaction.

-- ══════════════════════════════════════════════════════════════════
-- 1. The status Stripe actually reports
-- ══════════════════════════════════════════════════════════════════
-- Nothing here is written by users. The table has no INSERT/UPDATE/DELETE
-- policy at all (see 20260803000000) — only the service role, i.e. the Stripe
-- edge functions, writes it. `grant select` is table-wide and the existing
-- `opa_read_own` policy is row-scoped, so these columns inherit exactly the
-- same "readable by their owner and nobody else" rule without another grant.
alter table public.operator_payout_accounts
  -- Has the operator ever finished the onboarding form? This is the field that
  -- separates "not started" from "under review" — Stripe sets it true the
  -- moment the form is submitted, long before charges are enabled.
  add column if not exists details_submitted boolean not null default false,
  -- Can Stripe pay the money OUT to their bank? Separate from charges_enabled:
  -- an account can legitimately be able to take money and not yet be able to
  -- receive it, and an operator deserves to be told which half is missing.
  add column if not exists payouts_enabled boolean not null default false,
  -- requirements.currently_due — non-empty means STRIPE IS WAITING ON THEM.
  -- Stored as the raw Stripe field names (e.g. 'individual.verification.
  -- document'); we deliberately do not translate them, because with Express
  -- accounts Stripe's own hosted form is what collects them and the docs are
  -- explicit that we "don't have to communicate the specific requirements".
  -- Kept only so the UI can say "2 things left" and so a support conversation
  -- has something concrete in it.
  add column if not exists requirements_due text[] not null default '{}',
  -- requirements.past_due — the same, but a deadline has already passed, so it
  -- reads as urgent rather than as a to-do.
  add column if not exists requirements_past_due text[] not null default '{}',
  -- requirements.disabled_reason — set when Stripe has actively turned the
  -- account off (rejected.fraud, platform_paused, under_review, …). This is
  -- the one state the operator cannot fix by filling in a form.
  add column if not exists disabled_reason text,
  -- When did we last ask Stripe? Purely diagnostic, but the first question
  -- about a stuck account is always "is this cached from an hour ago?".
  add column if not exists status_checked_at timestamptz;

-- One Stripe account belongs to exactly one operator. `user_id` is the primary
-- key, so the table already stops one user holding two accounts; this stops the
-- reverse, which is the direction `stripe-connect-webhook` depends on — it
-- looks a row up BY `stripe_account_id` and acts on it, and two matching rows
-- would mean one operator's approval silently enabling someone else's.
--
-- It also turns that lookup from a sequential scan into an index hit. Every
-- account.updated event for every operator runs it.
--
-- Partial, because the column is nullable and stays null between "Stripe made
-- the account" and "we managed to persist the id". Several nulls are fine; two
-- of the same real id are not.
create unique index if not exists uq_opa_stripe_account
  on public.operator_payout_accounts (stripe_account_id)
  where stripe_account_id is not null;

comment on column public.operator_payout_accounts.details_submitted is
  'Stripe account.details_submitted. True once the onboarding form was submitted, even while charges are still disabled. Distinguishes "never started" from "under review".';
comment on column public.operator_payout_accounts.requirements_due is
  'Stripe account.requirements.currently_due. Non-empty means Stripe is waiting on the operator, so send them back into onboarding.';
comment on column public.operator_payout_accounts.disabled_reason is
  'Stripe account.requirements.disabled_reason. Non-null means the account is switched off and a form cannot fix it.';

-- ══════════════════════════════════════════════════════════════════
-- 2. Push priority for the "you can get paid now" notification
-- ══════════════════════════════════════════════════════════════════
-- ⚠️ THIS BODY WAS COPIED FROM THE LIVE DATABASE, NOT FROM A REPO FILE.
-- The live notification_push_priority has drifted AHEAD of every migration in
-- this repo (operator_* cases were added to production directly). Replacing it
-- from an older repo file would silently demote those types back to feed-only.
-- If you ever touch it again: read the live definition first
--   select pg_get_functiondef('public.notification_push_priority(public.notification_type, jsonb)'::regprocedure);
-- and add to THAT, exactly as this migration does. The only change here is the
-- single 'operator_stripe_ready' line.
--
-- CREATE OR REPLACE (not DROP + CREATE) on purpose: a replace preserves the
-- existing grants, where a drop would re-grant EXECUTE to PUBLIC.
create or replace function public.notification_push_priority(p_type notification_type, p_data jsonb)
returns smallint language sql immutable as $function$
  select case p_type
    when 'join_request_received'        then 0      -- 1.1 host decision
    when 'join_request_decided'         then case when p_data->>'decision' = 'approved' then 0 else 1 end  -- 1.2 / 1.3
    when 'commitment_request_received'  then 0      -- 2.7 host decision
    when 'commitment_decided'           then case when p_data->>'decision' = 'approved' then 0 else -1 end -- 2.8 push / 2.9 feed-only
    when 'member_committed'             then 1      -- 2.8 momentum to others
    when 'gear_request_received'        then 0      -- 2.10 host decision
    when 'gear_request_decided'         then 1      -- 2.11
    when 'admin_update_posted'          then 1      -- 2.1
    when 'group_gear_updated'           then 1      -- 2.5
    when 'personal_gear_updated'        then 1      -- 2.2
    when 'member_left'                  then 1      -- 1.6
    when 'trip_cancelled'               then 0      -- 5.2
    when 'member_removed'               then 0      -- 5.3
    when 'trip_invite_received'         then 0      -- host invites you: urgent
    when 'trip_invite_accepted'         then 0      -- invitee accepted: urgent to host
    when 'trip_invite_declined'         then 1      -- invitee declined: normal to host
    -- operator trips:
    when 'operator_document_rejected'   then 0      -- creates work for the traveler
    when 'operator_requirement_added'   then 1      -- a new obligation after publish
    when 'operator_requirement_overdue' then 0      -- the traveler missed a deadline
    when 'operator_requirement_overdue_operator' then 1  -- the operator's own heads-up
    -- Stripe finished reviewing the operator and they can now be paid. Good
    -- news, and nothing is on fire: 1, not 0, so it waits out quiet hours
    -- rather than waking someone at 3am to tell them their paperwork cleared.
    -- The card in the app also refreshes on its own, so a delayed push only
    -- ever arrives second.
    when 'operator_stripe_ready'        then 1
    -- feed only in Phase 1:
    when 'member_joined'                then -1     -- 1.4 push is LATER (batched)
    when 'gear_claimed'                 then -1     -- 2.4 feed only
    else -1
  end::smallint;
$function$;
