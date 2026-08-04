-- Operator sets one traveler's price.
--
-- `group_trip_participants` has no UPDATE policy that lets a host touch
-- another traveler's row — the only UPDATE policy is self-only
-- (`using (auth.uid() = user_id)`). Adding a host UPDATE policy would hand
-- hosts blanket write access to every column of every participant row,
-- including `role` — a much larger grant than this feature needs. A
-- SECURITY DEFINER RPC instead: it runs as the owner (bypassing the missing
-- policy) while `auth.uid()` still resolves to the real caller, so the
-- authorisation check below sees the real person. `freeze_traveler_price()`
-- (the BEFORE UPDATE trigger from 20260803000000) lets the write through
-- because the caller genuinely is a host.
--
-- ── C3 (round 5): host_id, NOT is_trip_host() ──────────────────────────────
-- There are two different "host" identities in this schema and this function
-- used to mix them:
--
--   • `is_trip_host(trip)` is `participants where user_id = auth.uid() and
--     role = 'host'`. Flat multi-host has been live since 20260708000000, so
--     that set is the primary host PLUS everyone ever promoted through
--     "Set as admin" — and at least one production trip already has more than
--     one row with role = 'host'.
--   • `group_trips.host_id` is the single operator of record. It is the ONLY
--     identity that gets paid: payments-checkout reads
--     operator_payout_accounts for `trip.host_id` and nobody else.
--
-- Authorising a price write on the first while the money lands on the second
-- is a payment bypass. A traveler promoted to admin — a role the UI presents
-- as co-leadership, with no mention of money — could call this with
-- (trip, self, 0, 0), be marked `approved` on every pay requirement, and
-- travel free; likewise for their friends. So: host_id only.
--
-- Nobody sets their own price, not even the operator. The operator has no
-- legitimate need to (they are not paying themselves) and the rule removes
-- the whole shape of the attack rather than one route to it.
--
-- Every accepted write stamps price_set_by / price_set_at (added in
-- 20260803000000). Prices are not versioned; without the stamp a price change
-- leaves no trace at all, which is why the bypass above was undiscoverable
-- after the fact rather than merely possible.
--
-- freeze_traveler_price()'s own use of is_trip_host() is deliberately left
-- alone: it only PERMITS a write that this RPC is now the sole authorised
-- producer of, and tightening it to host_id would block this function's own
-- UPDATE (auth.uid() inside a SECURITY DEFINER function is still the caller).
create or replace function public.operator_set_traveler_price(
  p_trip_id     uuid,
  p_user_id     uuid,
  p_total_usd   numeric,
  p_deposit_usd numeric
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_count integer; v_has_deposit_req boolean;
begin
  if not exists (
    select 1 from public.group_trips
     where id = p_trip_id and host_id = auth.uid()
  ) then
    raise exception 'not your trip';
  end if;

  -- Belt and braces on top of the host_id check: even the operator of record
  -- may not price themselves.
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
end $$;

-- SECURITY DEFINER keeps the default PUBLIC execute grant, which also
-- reaches anon by default. Revoke both, then grant back only what's
-- intended — otherwise anon can call this over /rest/v1/rpc/.
revoke execute on function public.operator_set_traveler_price(uuid, uuid, numeric, numeric)
  from public, anon;
grant  execute on function public.operator_set_traveler_price(uuid, uuid, numeric, numeric)
  to authenticated;
