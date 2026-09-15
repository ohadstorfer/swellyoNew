/**
 * The poll that decides whether a Stripe approval is seen while the operator
 * is still on the screen.
 *
 * Every case below is the 2026-09-06 bug or a guard against re-introducing it.
 * The watch used to stop on anything that was not `under_review`, so the first
 * read after the Stripe sheet closed — almost always `incomplete`, because
 * Stripe clears `currently_due` a beat after submission — killed the watch on
 * its first tick. The card then sat on "Finish connecting Stripe" until the
 * screen was closed and reopened, on an account Stripe had already approved.
 */
import {
  watchInterval,
  WATCH_INTERVAL_MS,
  UNKNOWN_CONNECT_STATUS,
  type ConnectStatus,
} from '../connectStatus';

/** A connected account with nothing outstanding, overridable per test. */
const status = (over: Partial<ConnectStatus> = {}): ConnectStatus => ({
  ...UNKNOWN_CONNECT_STATUS,
  accountId: 'acct_123',
  ...over,
});

const NOW = 1_000_000;
const OPEN = NOW + 60_000; // watch window still open
const CLOSED = NOW - 1; // window already expired

describe('watchInterval — the window', () => {
  it('does not poll once the window has closed, however unsettled the state', () => {
    expect(watchInterval(status({ currentlyDue: ['x'] }), CLOSED, NOW)).toBe(false);
    expect(watchInterval(status({ detailsSubmitted: true }), CLOSED, NOW)).toBe(false);
  });

  it('polls while the window is open and nothing has been read yet', () => {
    expect(watchInterval(undefined, OPEN, NOW)).toBe(WATCH_INTERVAL_MS);
  });
});

describe('watchInterval — keeps watching while Stripe is still moving', () => {
  // THE REGRESSION TEST. Before the fix this returned false.
  it('keeps polling on incomplete — Stripe clears currently_due after submit', () => {
    const justClosedTheSheet = status({
      detailsSubmitted: true,
      currentlyDue: ['individual.verification.document'],
    });
    expect(watchInterval(justClosedTheSheet, OPEN, NOW)).toBe(WATCH_INTERVAL_MS);
  });

  it('keeps polling on under_review', () => {
    expect(watchInterval(status({ detailsSubmitted: true }), OPEN, NOW)).toBe(WATCH_INTERVAL_MS);
  });

  it('keeps polling on not_started, in case the account row lags behind', () => {
    expect(watchInterval(UNKNOWN_CONNECT_STATUS, OPEN, NOW)).toBe(WATCH_INTERVAL_MS);
  });
});

describe('watchInterval — stops once Stripe has decided', () => {
  it('stops on ready, which is the whole point of watching', () => {
    expect(watchInterval(status({ chargesEnabled: true }), OPEN, NOW)).toBe(false);
  });

  it('stops on action_needed — already live, and the next move is the operator’s', () => {
    expect(watchInterval(status({ chargesEnabled: true, pastDue: ['x'] }), OPEN, NOW)).toBe(false);
  });

  it('stops on blocked — Stripe refused, no amount of polling changes it', () => {
    expect(watchInterval(status({ disabledReason: 'rejected.fraud' }), OPEN, NOW)).toBe(false);
  });
});

describe('watchInterval — the reported bug, end to end', () => {
  it('watches an account through incomplete and stops the tick it turns ready', () => {
    const pending = status({ detailsSubmitted: true, currentlyDue: ['individual.id_number'] });
    const approved = status({ chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true });

    // Sheet closes: Stripe still lists a requirement. Must keep looking.
    expect(watchInterval(pending, OPEN, NOW)).toBe(WATCH_INTERVAL_MS);
    // Four seconds later, still pending. Still looking.
    expect(watchInterval(pending, OPEN, NOW + 4_000)).toBe(WATCH_INTERVAL_MS);
    // Stripe approves. The card flips and the polling stops on its own.
    expect(watchInterval(approved, OPEN, NOW + 8_000)).toBe(false);
  });
});
