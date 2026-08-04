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

/** What this step costs, or null when nothing is owed for it. Floors the
 *  balance at zero — stored rows can't produce a negative balance (a DB
 *  CHECK blocks deposit > total), but a live form building this struct from
 *  unvalidated, mid-typing input can. */
export function amountDue(step: PayStep, p: TravelerPrices): number | null {
  if (p.totalUsd == null) return null;
  if (step === 'deposit') return p.depositUsd;
  return Math.max(0, p.totalUsd - (p.depositUsd ?? 0));
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
