-- A failed payment is no longer silent.
--
-- Spec: docs/trip-notifications-plan.html, PAY-6 ("A payment did not finish").
-- Type: 20260819000000 (must already be applied — see its header).
-- Order: apply AFTER 20260818000600 — the function below is rebuilt from that
--        migration's version of `notification_push_priority`, so running these
--        out of order erases whichever line was added last.
--
-- ── The scenario ────────────────────────────────────────────────────────────
-- A traveler opens checkout for a deposit or a balance payment and the card is
-- declined, or they close the tab and never come back. Stripe tells us both —
-- `payment_intent.payment_failed` and `checkout.session.expired` — and until
-- now `stripe-webhook` acknowledged both events and told nobody. The old plan
-- note claimed the attempt only existed on the phone (`pendingPaymentStore`);
-- that was wrong, corrected in the plan 2026-08-18.
--
-- The producer is `stripe-webhook` (deployed 2026-08-19). Its inserts are
-- best-effort: until THIS pair of migrations is applied, the insert fails on
-- the unknown enum value, the webhook logs and returns 200, and nothing
-- retries — so the deploy and these files are safe to land in either order.
--
-- ── 1. Push priority for the new type ───────────────────────────────────────
--
-- Rebuilt whole, from 20260818000600's definition (which itself was rebuilt
-- from the LIVE definition — see the note there about live drifting ahead of
-- the repo). The only edit is the one added line.
--
-- Priority 1, never 0: a declined card is actionable but it is not a 3am
-- problem — outside quiet hours priority 1 sends immediately anyway. The
-- expired-checkout variant fires ~24h after the attempt, on Stripe's clock,
-- so it especially has no claim to bypass quiet hours.
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
    when 'operator_payment_stuck'       then 1
    when 'operator_requirement_due_soon' then 1
    when 'operator_setup_required'      then 1
    when 'onboarding_unfinished'        then 1
    when 'operator_onboarding_stalled'  then 1
    when 'member_joined'                then -1
    when 'gear_claimed'                 then -1
    else -1
  end::smallint;
$$;

-- ── 2. Push copy, as a template row ─────────────────────────────────────────
--
-- A template row instead of a render.ts case, so `dispatch-notification-queue`
-- needs NO deploy — its live copy is behind the repo, and `renderPush` checks
-- the template map before its switch. Same trick 20260806000000 used for the
-- Remind button. (The repo's render.ts still gains a fallback case, for the
-- day the function does get deployed and this row is ever deleted.)
--
-- bell_title / bell_body are deliberately NULL: a bell template overrides the
-- client's copy and flattens its layout (see 20260806000000's warning — one
-- row per key, push fields only, unless flattening is wanted). The bell copy
-- lives in notificationsService.ts like every other type's.
insert into public.notification_templates (key, push_title, push_body)
values (
  'operator_payment_stuck',
  'Your payment for {trip} did not go through',
  'Nothing was charged — you can try again'
)
on conflict (key) do nothing;
