// This guard is the only thing standing between a traveler and paying a
// $6,250 trip twice. Every case below is one way that could happen — or one
// way the guard could get stuck ON and make a requirement permanently
// unpayable, which is the worse of the two failures.
//
// Jest-style, not Deno-style, deliberately: `inflight.ts` touches no Deno API,
// and the repo's Deno-style edge tests (scan-stalled-onboarding, scan-trip-
// reminders) do not run under `npx jest` at all. This one does.
import { hasClearingBankPayment, STALE_MARKER_MS, type LedgerRow } from '../inflight';

const NOW = Date.parse('2026-08-27T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();

const processing = (pi: string | null, d = 0, live = false): LedgerRow => ({
  event_type: 'processing', is_livemode: live, provider_object_id: pi, created_at: daysAgo(d),
});
const paid = (pi: string, live = false): LedgerRow => ({
  event_type: 'paid', is_livemode: live, provider_object_id: pi, created_at: daysAgo(0),
});
const failed = (pi: string, live = false): LedgerRow => ({
  event_type: 'failed', is_livemode: live, provider_object_id: pi, created_at: daysAgo(0),
});
const clearing = (events: LedgerRow[], live = false) => hasClearingBankPayment(events, live, NOW);

describe('hasClearingBankPayment', () => {
  it('lets a traveler with no payment history through', () => {
    expect(clearing([])).toBe(false);
  });

  it('blocks a second checkout while a bank payment is in flight', () => {
    expect(clearing([processing('pi_1')])).toBe(true);
  });

  it('never blocks on a card payment — no marker is written for one', () => {
    expect(clearing([paid('pi_1')])).toBe(false);
  });

  it('unblocks when the day-3 success lands, matched on the PaymentIntent', () => {
    expect(clearing([processing('pi_1'), paid('pi_1')])).toBe(false);
  });

  it('unblocks on a bounce too, or the trip would be unpayable forever', () => {
    // The most important case here. If `async_payment_failed` did not write
    // its 'failed' row, this stays true and nobody can ever pay that
    // requirement again, through any route.
    expect(clearing([processing('pi_1'), failed('pi_1')])).toBe(false);
  });

  it('blocks again on the retry after a bounce', () => {
    expect(clearing([processing('pi_1'), failed('pi_1'), processing('pi_2')])).toBe(true);
  });

  it('resolves per PaymentIntent, not per requirement', () => {
    // pi_1 resolved, pi_2 did not — the second marker must still block.
    expect(clearing([processing('pi_1'), paid('pi_1'), processing('pi_2')])).toBe(true);
  });

  it('treats a marker as stale at ten days, and not a minute before', () => {
    const at = (offsetMs: number): LedgerRow => ({
      event_type: 'processing', is_livemode: false, provider_object_id: 'pi_1',
      created_at: new Date(NOW - offsetMs).toISOString(),
    });
    expect(clearing([at(STALE_MARKER_MS - 60_000)])).toBe(true);
    expect(clearing([at(STALE_MARKER_MS + 60_000)])).toBe(false);
  });

  it('ignores a marker nothing could ever resolve', () => {
    // No PaymentIntent means no 'paid'/'failed' row can ever match it.
    expect(clearing([processing(null)])).toBe(false);
  });

  it('fails CLOSED on an unreadable timestamp', () => {
    // Dropping the guard is the outcome that costs money, so an unparseable
    // or missing date counts as recent rather than stale.
    const bad = (created_at: string | null): LedgerRow => ({
      event_type: 'processing', is_livemode: false, provider_object_id: 'pi_1', created_at,
    });
    expect(clearing([bad('not-a-date')])).toBe(true);
    expect(clearing([bad(null)])).toBe(true);
  });

  it('keeps Stripe test mode and live mode apart in both directions', () => {
    // A device test writes test-mode rows straight into the production
    // database; one must never block a real checkout.
    expect(clearing([processing('pi_1', 0, false)], true)).toBe(false);
    expect(clearing([processing('pi_1', 0, true)], false)).toBe(false);
  });

  it('does not let a resolution from the other mode unblock a marker', () => {
    // Mode is checked on the marker; the resolved-set is not mode-scoped,
    // which is only safe because a PaymentIntent id is unique per Stripe
    // account and the two modes never share one. Pinned so a future change
    // has to notice.
    expect(clearing([processing('pi_1', 0, false), paid('pi_1', true)])).toBe(false);
  });
});
