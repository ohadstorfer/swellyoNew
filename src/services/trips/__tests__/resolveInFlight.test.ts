// Mock the supabase client so importing the service doesn't init a real client
// (mirrors src/services/trips/__tests__/exploreSelect.test.ts). `from` is a
// real jest.fn() rather than an empty object because the ledger-read tests at
// the bottom of this file assert on the exact filter chain.
jest.mock('../../../config/supabase', () => ({ supabase: { from: jest.fn() } }));
// The client half of the ACH double-payment guard. It must agree with
// `payments-checkout/inflight.ts` on every case, or the row hides a Pay
// button the server is offering (a lost payment nobody can retry) or shows
// one the server will refuse (a red "failed" sheet for a payment in flight).
import { resolveInFlight, IN_FLIGHT_STALE_MS, type InFlightLedgerRow } from '../tripPaymentsService';

const NOW = Date.parse('2026-08-27T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const DAY = 86400000;

const processing = (req: string, pi: string | null, amount = 1000, msAgo = 0): InFlightLedgerRow => ({
  requirement_id: req, event_type: 'processing', provider_object_id: pi, amount_charged: amount, created_at: at(msAgo),
});
const paid = (req: string, pi: string): InFlightLedgerRow => ({
  requirement_id: req, event_type: 'paid', provider_object_id: pi, amount_charged: 1000, created_at: at(0),
});
const failed = (req: string, pi: string): InFlightLedgerRow => ({
  requirement_id: req, event_type: 'failed', provider_object_id: pi, amount_charged: 1000, created_at: at(0),
});

describe('resolveInFlight', () => {
  it('is empty with no history', () => {
    expect(resolveInFlight([], NOW)).toEqual({});
  });

  it('reports a bank payment in transit, with what was authorised', () => {
    expect(resolveInFlight([processing('dep', 'pi_1', 1000)], NOW)).toEqual({
      dep: { amountUsd: 1000, since: at(0) },
    });
  });

  it('reads amount_charged, never amount_usd — the marker is pinned to $0', () => {
    // A string, as Postgres numeric arrives over the wire.
    const row = { ...processing('dep', 'pi_1'), amount_charged: '1000.00' };
    expect(resolveInFlight([row], NOW).dep.amountUsd).toBe(1000);
  });

  it('clears when the day-3 success lands on the same PaymentIntent', () => {
    expect(resolveInFlight([processing('dep', 'pi_1'), paid('dep', 'pi_1')], NOW)).toEqual({});
  });

  it('clears on a bounce too — the row must go back to Pay', () => {
    expect(resolveInFlight([processing('dep', 'pi_1'), failed('dep', 'pi_1')], NOW)).toEqual({});
  });

  it('a retry after a bounce is in flight again, on its own marker', () => {
    const out = resolveInFlight(
      [processing('dep', 'pi_1', 1000, DAY), failed('dep', 'pi_1'), processing('dep', 'pi_2', 1000, 0)],
      NOW,
    );
    expect(out.dep).toEqual({ amountUsd: 1000, since: at(0) });
  });

  it('keeps requirements apart', () => {
    const out = resolveInFlight([processing('dep', 'pi_1'), processing('bal', 'pi_2', 2000)], NOW);
    expect(Object.keys(out).sort()).toEqual(['bal', 'dep']);
    expect(out.bal.amountUsd).toBe(2000);
  });

  it('ages out at exactly the server bound, so the two never disagree', () => {
    expect(resolveInFlight([processing('dep', 'pi_1', 1000, IN_FLIGHT_STALE_MS - 60_000)], NOW).dep).toBeDefined();
    expect(resolveInFlight([processing('dep', 'pi_1', 1000, IN_FLIGHT_STALE_MS + 60_000)], NOW)).toEqual({});
  });

  it('ignores a marker nothing could ever resolve', () => {
    expect(resolveInFlight([processing('dep', null)], NOW)).toEqual({});
  });

  it('treats an unreadable timestamp as recent, like the server does', () => {
    const row = { ...processing('dep', 'pi_1'), created_at: null };
    expect(resolveInFlight([row], NOW).dep).toBeDefined();
  });
});
