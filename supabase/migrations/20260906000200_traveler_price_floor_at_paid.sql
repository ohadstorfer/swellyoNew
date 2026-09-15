-- ─────────────────────────────────────────────────────────────────────────────
-- A traveler's price cannot be set below what they have already paid.
--
-- Until now operator_set_traveler_price had no floor: on 6 September 2026 it
-- accepted a $500 total for a traveler who had paid $1,000, stamped it, and
-- said nothing (test M-13). From there amountOutstanding() clamps at zero, the
-- row reads "fully paid", and no row anywhere records that the traveler is
-- owed $500. The phone sheet warned and let it through; the website blocked
-- it on the client only. Ohad decided on 6 September: block on both sides.
--
-- "Paid" here is the same sum operator_requirement_pay_state uses, minus the
-- per-requirement filter: every non-failed ledger row for this traveler on
-- this trip, in the Stripe mode we currently count. Refunds are negative rows
-- ('refunded' < 0 by otpe_amount_sign_matches_type), so a refund lowers the
-- floor by itself — refund first, then lower the price, and it goes through.
-- That is the message the error gives, and the order the clients point at.
--
-- CREATE OR REPLACE keeps the function's ACL (authenticated + service_role
-- EXECUTE, nothing to PUBLIC or anon) — verified before writing this. Only
-- the body changes; every existing guard is kept word for word.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.operator_set_traveler_price(
  p_trip_id uuid, p_user_id uuid, p_total_usd numeric, p_deposit_usd numeric
) returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_count integer; v_has_deposit_req boolean; v_paid numeric;
begin
  if not exists (
    select 1 from public.group_trips
     where id = p_trip_id and host_id = auth.uid()
  ) and not (
    exists (
      select 1 from public.group_trips
       where id = p_trip_id and hosting_style = 'C'
    )
    and public.trip_staff_can(p_trip_id, 'money.manage')
  ) then
    raise exception 'not your trip';
  end if;

  -- Belt and braces: nobody prices themselves, owner included.
  if p_user_id = auth.uid() then
    raise exception 'you cannot set your own price';
  end if;

  -- `null < 0` is NULL, not true, so a null total would otherwise sail past
  -- every guard below and get written straight to price_total_usd. From
  -- there operator_traveler_amount_due() returns NULL and
  -- operator_requirement_pay_state() reads 'not_started' forever, with no
  -- way for the traveler to pay a must_have item — the same class of
  -- permanently-unsatisfiable requirement as I6 in 20260803000000.
  if p_total_usd is null then
    raise exception 'a price is required';
  end if;

  if p_total_usd < 0 then
    raise exception 'price cannot be negative';
  end if;

  if p_deposit_usd is not null and p_deposit_usd < 0 then
    raise exception 'deposit cannot be negative';
  end if;

  if p_deposit_usd is not null and p_deposit_usd > p_total_usd then
    raise exception 'deposit cannot exceed the total price';
  end if;

  -- C2 (round 5): a deposit is only collectable if a deposit REQUIREMENT
  -- exists to collect it against. The create wizard treats a blank or zero
  -- deposit as "one single payment" and publishes a `balance` row alone — no
  -- `deposit` row. Writing deposit_usd on such a trip is silently
  -- uncollectable money: operator_traveler_amount_due('balance') becomes
  -- `price - deposit`, so the traveler is billed the reduced balance, every
  -- pay row reads `approved`, and the operator is short the deposit with no
  -- error anywhere. TravelerPriceSheet hides the field in that case; this is
  -- the server-side half, because the client is not the authority on money.
  select exists (
    select 1 from public.organized_trip_requirements
     where trip_id = p_trip_id and kind = 'deposit' and is_active
  ) into v_has_deposit_req;

  if p_deposit_usd is not null and not v_has_deposit_req then
    raise exception
      'this trip takes one single payment — it has no deposit step to collect a deposit against';
  end if;

  -- M-13: the floor. Same sum as operator_requirement_pay_state, across every
  -- requirement. Refunds are negative rows, so they lower it on their own.
  select coalesce(sum(amount_usd), 0) into v_paid
    from public.organized_trip_payment_events
   where trip_id     = p_trip_id
     and user_id     = p_user_id
     and event_type <> 'failed'
     and is_livemode = coalesce(
                         nullif(current_setting('app.stripe_livemode', true), '')::boolean,
                         false);

  if p_total_usd < v_paid then
    raise exception
      'This traveler has already paid $%, which is more than $%. Refund the difference first, then lower the price.',
      trim(to_char(v_paid, 'FM999999990.00')), trim(to_char(p_total_usd, 'FM999999990.00'))
      using errcode = 'check_violation';
  end if;

  update public.group_trip_participants
     set price_total_usd = p_total_usd,
         deposit_usd     = p_deposit_usd,
         price_set_by    = auth.uid(),
         price_set_at    = now()
   where trip_id = p_trip_id
     and user_id = p_user_id;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'no participant row for trip % / user %', p_trip_id, p_user_id;
  end if;
end;
$function$;
