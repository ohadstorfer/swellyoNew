-- Operator sets one traveler's price.
--
-- `group_trip_participants` has no UPDATE policy that lets a host touch
-- another traveler's row — the only UPDATE policy is self-only
-- (`using (auth.uid() = user_id)`). Adding a host UPDATE policy would hand
-- hosts blanket write access to every column of every participant row,
-- including `role` — a much larger grant than this feature needs. A
-- SECURITY DEFINER RPC instead: it runs as the owner (bypassing the missing
-- policy) while `auth.uid()` still resolves to the real caller, so
-- `is_trip_host()` authorises correctly. `freeze_traveler_price()` (the
-- BEFORE UPDATE trigger from 20260803000000) lets the write through because
-- the caller genuinely is a host.
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
declare v_count integer;
begin
  if not public.is_trip_host(p_trip_id) then
    raise exception 'not your trip';
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

  update public.group_trip_participants
     set price_total_usd = p_total_usd,
         deposit_usd      = p_deposit_usd
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
