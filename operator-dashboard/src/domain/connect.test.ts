import { describe, it, expect } from 'vitest';
import {
  deriveConnectState,
  describeConnectState,
  tripPaymentWarning,
  UNKNOWN_CONNECT_STATUS,
  type ConnectStatus,
} from './connect';

const status = (o: Partial<ConnectStatus> = {}): ConnectStatus => ({
  ...UNKNOWN_CONNECT_STATUS,
  accountId: 'acct_1',
  ...o,
});

describe('deriveConnectState', () => {
  it('no account at all', () => {
    expect(deriveConnectState(UNKNOWN_CONNECT_STATUS)).toBe('not_started');
  });

  it('live and clear', () => {
    expect(deriveConnectState(status({ chargesEnabled: true }))).toBe('ready');
  });

  it('live with a missed deadline', () => {
    expect(
      deriveConnectState(status({ chargesEnabled: true, pastDue: ['individual.id_number'] })),
    ).toBe('action_needed');
  });

  it('submitted, nothing outstanding, charges still off', () => {
    expect(deriveConnectState(status({ detailsSubmitted: true }))).toBe('under_review');
  });

  it('Stripe is waiting on them', () => {
    expect(
      deriveConnectState(status({ detailsSubmitted: true, currentlyDue: ['company.tax_id'] })),
    ).toBe('incomplete');
  });

  it('an account created and abandoned', () => {
    expect(deriveConnectState(status())).toBe('incomplete');
  });

  it('past_due on an account that was NEVER live is incomplete, not action_needed', () => {
    // The 2026-08-05 bug: a failed SSN match leaves past_due on an account
    // with charges off. `action_needed` permits selling, so ranking past_due
    // above the charges check would let them publish a trip they can never
    // collect on.
    expect(
      deriveConnectState(status({ detailsSubmitted: true, pastDue: ['individual.id_number'] })),
    ).toBe('incomplete');
  });

  it('a rejection is blocked, even on an account that used to work', () => {
    expect(
      deriveConnectState(status({ chargesEnabled: true, disabledReason: 'rejected.fraud' })),
    ).toBe('blocked');
  });

  it('every unrecoverable reason blocks', () => {
    for (const reason of [
      'rejected.fraud',
      'rejected.incomplete_verification',
      'rejected.listed',
      'rejected.other',
      'rejected.terms_of_service',
      'platform_paused',
      'listed',
    ]) {
      expect(deriveConnectState(status({ disabledReason: reason }))).toBe('blocked');
    }
  });

  it('an ordinary disabled_reason is NOT a rejection', () => {
    // Stripe reuses this field for stages nobody is in trouble for.
    for (const reason of [
      'under_review',
      'requirements.pending_verification',
      'requirements.past_due',
    ]) {
      expect(
        deriveConnectState(status({ detailsSubmitted: true, disabledReason: reason })),
      ).toBe('under_review');
    }
  });
});

describe('what the operator is told', () => {
  it('names the refusal on Settings', () => {
    const s = status({ disabledReason: 'rejected.fraud' });
    const copy = describeConnectState(deriveConnectState(s), s);
    expect(copy.tone).toBe('danger');
    expect(copy.tag).toBe('Not approved');
  });

  it('separates charges from payouts', () => {
    const s = status({ chargesEnabled: true });
    expect(describeConnectState('ready', s).tag).toBe('Payouts on hold');
    expect(describeConnectState('ready', { ...s, payoutsEnabled: true }).tag).toBe('Ready');
  });

  it('the trip banner is silent when we do not know yet, and when money works', () => {
    expect(tripPaymentWarning('not_started')).toBeNull();
    expect(tripPaymentWarning('ready')).toBeNull();
    // Live but past a deadline: they CAN take money today, so the trip page
    // must not tell travelers' operator that nobody can pay.
    expect(tripPaymentWarning('action_needed')).toBeNull();
  });

  it('the trip banner speaks for every state where money is off', () => {
    expect(tripPaymentWarning('under_review')).toContain("can't pay yet");
    expect(tripPaymentWarning('incomplete')).toContain("can't pay yet");
    expect(tripPaymentWarning('blocked')).toContain('turned down');
  });
});
