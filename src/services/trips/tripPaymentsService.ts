/**
 * Payment amounts for operator trips.
 *
 * The trip price is only a DEFAULT. What a traveler owes lives on their own
 * participant row (`price_total_usd` / `deposit_usd`), frozen when they joined.
 * That is why changing a trip's price never rewrites an existing traveler's
 * deal — the same reason an order line stores its own amount rather than
 * pointing at the product.
 *
 * ⚠️ These functions mirror `operator_traveler_amount_due()` in
 * `20260803000000_operator_trip_payments.sql`. If one changes, the other must.
 * The SQL is authoritative — the client copy exists so the Plan tab can show an
 * amount without a round trip.
 */
import { supabase } from '../../config/supabase';
import * as WebBrowser from 'expo-web-browser';

export type PayStep = 'deposit' | 'balance';

export type TravelerPrices = {
  /** This traveler's total. Callers MUST resolve the trip's default price
   *  before constructing this object — `fetchTravelerPrices` is the function
   *  that does that coalesce (participant row, falling back to the trip's
   *  `cost_per_person`), matching the SQL's `coalesce(p.price_total_usd,
   *  t.cost_per_person)`. Null here means no price exists ANYWHERE — not on
   *  the participant row and not as a trip default — so nothing is owed
   *  until the operator sets one. A caller that skips the coalesce and
   *  builds this straight from a participant row will silently under-charge
   *  travelers who never got their own price frozen. */
  totalUsd: number | null;
  /** Their deposit. Null = this trip takes one single payment. */
  depositUsd: number | null;
};

/** What this step costs, or null when it cannot be determined: either the
 *  price is unknown, or the balance works out negative (deposit > total —
 *  a contradictory configuration; a DB CHECK blocks it in stored rows, but a
 *  live form building this struct from unvalidated, mid-typing input can hit
 *  it). Null, not zero, because zero reads as "fully paid" to every
 *  consumer — mirrors `operator_traveler_amount_due()` in
 *  `20260803000000_operator_trip_payments.sql`, which returns NULL instead
 *  of `greatest(..., 0)` for the same reason (`GREATEST` silently ignores
 *  NULL inputs in Postgres, which used to make an unpriced traveler read as
 *  paid in full). A genuine balance of exactly `0` — deposit equals total —
 *  still returns `0`. */
export function amountDue(step: PayStep, p: TravelerPrices): number | null {
  if (p.totalUsd == null) return null;
  if (step === 'deposit') return p.depositUsd;
  const balance = p.totalUsd - (p.depositUsd ?? 0);
  return balance < 0 ? null : balance;
}

/** What is still owed after everything already paid against this step. */
export function amountOutstanding(
  step: PayStep,
  p: TravelerPrices,
  paidUsd: number,
): number {
  const due = amountDue(step, p);
  if (due == null) return 0;
  return Math.max(0, due - paidUsd);
}

/** Stripe works in integer cents. Round, never truncate: 19.99 * 100 is
 *  1998.9999999999998 in floating point, and truncating undercharges. */
export function usdToStripeCents(usd: number): number {
  return Math.round(usd * 100);
}

/** Swellyo's cut, in cents. Capped at the charge itself — an application fee
 *  larger than the amount makes Stripe reject the whole session. */
export function commissionCents(totalCents: number, bps: number): number {
  return Math.min(totalCents, Math.round((totalCents * bps) / 10000));
}

/** Where Stripe sends the browser after Checkout. Stripe rejects custom URL
 *  schemes, so this cannot be `swellyo://`. It is a plain page that tells the
 *  traveler to go back to the app — we never read anything from it. */
const RETURN_URL = 'https://swellyo.com/pay/done';

export async function fetchTravelerPrices(
  tripId: string,
  userId: string,
): Promise<TravelerPrices> {
  const [participant, trip] = await Promise.all([
    supabase
      .from('group_trip_participants')
      .select('price_total_usd, deposit_usd')
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('group_trips')
      .select('cost_per_person, deposit_amount')
      .eq('id', tripId)
      .single(),
  ]);

  if (participant.error) throw participant.error;
  if (trip.error) throw trip.error;

  // Null on the participant row means they joined before payments were turned
  // on. Fall back to the trip price, exactly as operator_traveler_amount_due()
  // does in SQL.
  return {
    totalUsd: participant.data?.price_total_usd ?? trip.data?.cost_per_person ?? null,
    depositUsd: participant.data?.deposit_usd ?? trip.data?.deposit_amount ?? null,
  };
}

/** How much has been paid against each pay requirement, keyed by requirement id. */
export async function fetchPaidByRequirement(
  tripId: string,
  userId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('organized_trip_payment_events')
    .select('requirement_id, amount_usd')
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) throw error;

  const out: Record<string, number> = {};
  for (const e of data ?? []) {
    if (!e.requirement_id) continue;
    out[e.requirement_id] = (out[e.requirement_id] ?? 0) + Number(e.amount_usd);
  }
  return out;
}

/**
 * Open Stripe Checkout and wait for the browser sheet to close.
 *
 * ⚠️ The return trip is NOT proof of payment. Stripe rejects custom URL
 * schemes, so there is no reliable deep link back, and a traveler can close the
 * sheet at any moment. The webhook is the only source of truth — the caller
 * must refetch and trust the server, never this return value's optimism.
 */
export async function startCheckout(requirementId: string): Promise<'paid' | 'cancelled'> {
  const { data, error } = await supabase.functions.invoke('payments-checkout', {
    body: { requirementId, returnUrl: RETURN_URL },
  });
  if (error) throw error;
  if (!data?.url) throw new Error(data?.error ?? 'Could not start the payment');

  const result = await WebBrowser.openAuthSessionAsync(data.url, RETURN_URL);
  return result.type === 'success' ? 'paid' : 'cancelled';
}

export async function fetchConnectStatus(): Promise<{
  chargesEnabled: boolean;
  accountId: string | null;
}> {
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
    body: { action: 'status' },
  });
  if (error) throw error;
  return {
    chargesEnabled: !!data?.chargesEnabled,
    accountId: data?.accountId ?? null,
  };
}

export async function startConnectOnboarding(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
    body: { action: 'onboard', returnUrl: RETURN_URL },
  });
  if (error) throw error;
  if (!data?.onboardingUrl) throw new Error(data?.error ?? 'Could not open Stripe');
  await WebBrowser.openAuthSessionAsync(data.onboardingUrl, RETURN_URL);
}

/** Operator sets one traveler's own price. Goes through the
 *  `operator_set_traveler_price` RPC, not a direct table update — the only
 *  UPDATE policy on `group_trip_participants` is self-only
 *  (`auth.uid() = user_id`), so a host has no RLS path to write another
 *  traveler's row. The RPC is SECURITY DEFINER and re-checks
 *  `is_trip_host()` itself before writing. See
 *  20260803000100_operator_set_traveler_price.sql. */
export async function saveTravelerPrice(
  tripId: string,
  userId: string,
  totalUsd: number,
  depositUsd: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('operator_set_traveler_price', {
    p_trip_id: tripId,
    p_user_id: userId,
    p_total_usd: totalUsd,
    p_deposit_usd: depositUsd,
  });
  if (error) throw error;
}
