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

/**
 * `2 injuries · 1 allergy · 3 diet notes` — the flagged counts, zeros removed.
 *
 * Returns an EMPTY STRING when nothing is flagged, so the caller can say
 * "Nothing flagged." rather than printing a row of zeros. That distinction is
 * the whole point: this line used to render "0 medications" as content, four
 * words of noise sitting beside the counts that carry signal.
 *
 * Lives here rather than in the component so the zero-dropping is testable
 * without a renderer — it is the part with the edge cases.
 */
export function medicalFlagLine(flags: {
  injuriesReported: number;
  allergiesReported: number;
  dietaryReported: number;
  medicationsReported: number;
}): string {
  return [
    flags.injuriesReported > 0 && plural(flags.injuriesReported, 'injury', 'injuries'),
    flags.allergiesReported > 0 && plural(flags.allergiesReported, 'allergy', 'allergies'),
    flags.dietaryReported > 0 &&
      `${flags.dietaryReported} diet ${flags.dietaryReported === 1 ? 'note' : 'notes'}`,
    flags.medicationsReported > 0 && plural(flags.medicationsReported, 'medication'),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * What is still owed on the trip.
 *
 * Clamped at zero: an over-refund would otherwise print a negative balance,
 * which reads as the operator owing the traveler — not a claim this screen is
 * entitled to make.
 *
 * Meaningless on an `offline` trip, where Swellyo does not know what arrived.
 * The caller decides that; this is arithmetic.
 */
export function outstandingUsd(expectedUsd: number, collectedUsd: number): number {
  return Math.max(0, expectedUsd - collectedUsd);
}
