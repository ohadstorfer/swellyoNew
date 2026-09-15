// Is a bank payment already on its way for this requirement?
//
// Extracted from index.ts so it can be tested — it is the single thing
// standing between a traveler and paying $6,250 twice, and it lives inside a
// 700-line request handler that cannot be exercised without a live Stripe key
// and a database. See docs/specs/operator-trips/ach-bank-payments.md.

/** The columns `payments-checkout` selects. Anything else is irrelevant here. */
export type LedgerRow = {
  event_type: string;
  is_livemode: boolean;
  provider_object_id: string | null;
  created_at?: string | null;
};

/**
 * Past this, an unresolved marker is treated as abandoned rather than live.
 *
 * Stripe retries a webhook for about 3 days and then stops. If
 * `async_payment_succeeded` / `async_payment_failed` never lands — the
 * function was down for the whole retry window, or the signing secret was
 * mid-rotation — nothing will ever resolve the marker. Without a bound the
 * requirement would be permanently unpayable through any route.
 *
 * 10 days clears ACH's up-to-4 business days and the ~5 of the microdeposit
 * fallback with room to spare, so it never fires on a healthy payment. Past
 * it, letting them pay is the safer failure: a double charge is refundable,
 * a trip nobody can pay for is not.
 */
export const STALE_MARKER_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * True when a `processing` marker exists that nothing has resolved yet.
 *
 * Resolution is by shared PaymentIntent: the day-3 `paid` row (from
 * `checkout.session.async_payment_succeeded`) and the day-3 `failed` row
 * (from `async_payment_failed`) both carry the marker's
 * `provider_object_id`. A marker with neither is still in flight.
 *
 * Two deliberate fail-open cases, both because blocking forever is worse than
 * a refundable double charge:
 *   • a marker older than {@link STALE_MARKER_MS};
 *   • a marker with no `provider_object_id`, which nothing could ever resolve.
 *
 * And one deliberate fail-closed case: an unparseable `created_at` counts as
 * recent, because dropping the guard is the outcome that costs money.
 */
export function hasClearingBankPayment(
  events: readonly LedgerRow[],
  isLivemode: boolean,
  now: number = Date.now(),
): boolean {
  const resolved = new Set(
    events
      .filter(e => (e.event_type === 'paid' || e.event_type === 'failed') && e.provider_object_id)
      .map(e => e.provider_object_id),
  );

  return events.some(e => {
    if (e.event_type !== 'processing') return false;
    // Mode isolation, same rule as the money sum: a test-mode marker written
    // during a device test must never block a real checkout.
    if (e.is_livemode !== isLivemode) return false;
    if (!e.provider_object_id) return false;
    if (resolved.has(e.provider_object_id)) return false;

    const at = e.created_at != null ? Date.parse(String(e.created_at)) : NaN;
    if (Number.isFinite(at) && now - at > STALE_MARKER_MS) return false;
    return true;
  });
}
