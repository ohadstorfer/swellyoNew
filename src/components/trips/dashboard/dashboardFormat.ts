/**
 * Formatting for the operator Dashboard.
 *
 * Money is shown in USD and only USD here, with no ₪ conversion — unlike the
 * traveler-facing Plan card, which converts for Israeli viewers. This is the
 * operator's ledger: it has to line up digit for digit with what they see in
 * Stripe, and Stripe settles in dollars. A converted figure would be a second
 * number to reconcile, at a rate that moved since.
 */

/**
 * `$1,200` — no cents when there are none.
 *
 * Whole amounts are the overwhelming majority of trip prices, and ".00" on
 * every row is noise that makes the real cents harder to spot.
 */
export function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '—';
  const whole = Math.abs(usd % 1) < 0.005;
  const sign = usd < 0 ? '-' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * `1 document` / `3 documents`.
 *
 * Takes an explicit plural because English is not regular — "1 allergy" is not
 * "1 allergys" — and because some call sites need a whole phrase
 * ("1 traveler has" / "2 travelers have").
 */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : many ?? `${one}s`}`;
}
