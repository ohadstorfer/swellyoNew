import {
  deriveConnectState,
  canCollectPayments,
  paymentsAreLive,
  describeConnectState,
  UNKNOWN_CONNECT_STATUS,
  type ConnectStatus,
  type ConnectState,
} from '../connectStatus';

/** A connected account with nothing outstanding, overridable per test. */
const status = (over: Partial<ConnectStatus> = {}): ConnectStatus => ({
  ...UNKNOWN_CONNECT_STATUS,
  accountId: 'acct_123',
  ...over,
});

describe('deriveConnectState', () => {
  it('is not_started with no account, whatever else is set', () => {
    expect(deriveConnectState(UNKNOWN_CONNECT_STATUS)).toBe('not_started');
    // A status we failed to read leaves every flag false; it must not be
    // mistaken for an account that exists and is merely unfinished.
    expect(
      deriveConnectState(status({ accountId: null, chargesEnabled: true, detailsSubmitted: true })),
    ).toBe('not_started');
  });

  it('is incomplete when the account exists but the form was never submitted', () => {
    expect(deriveConnectState(status())).toBe('incomplete');
  });

  it('is incomplete when Stripe is waiting on the operator', () => {
    expect(
      deriveConnectState(status({ detailsSubmitted: true, currentlyDue: ['individual.id_number'] })),
    ).toBe('incomplete');
  });

  // The state the old single boolean could not express, and the reason for
  // the whole file: submitted, nothing outstanding, charges still off.
  it('is under_review when everything is answered and charges are still off', () => {
    expect(
      deriveConnectState(
        status({
          detailsSubmitted: true,
          pendingVerification: ['individual.verification.document'],
        }),
      ),
    ).toBe('under_review');
  });

  it('is under_review even with no pending_verification list', () => {
    // Stripe does not always populate pending_verification; details_submitted
    // with an empty currently_due is enough to know nobody is blocked.
    expect(deriveConnectState(status({ detailsSubmitted: true }))).toBe('under_review');
  });

  it('is ready once charges are enabled', () => {
    expect(deriveConnectState(status({ detailsSubmitted: true, chargesEnabled: true }))).toBe(
      'ready',
    );
  });

  it('is action_needed for a past-due item while charges still work', () => {
    // The operator who is selling today and gets switched off tomorrow.
    expect(
      deriveConnectState(
        status({ detailsSubmitted: true, chargesEnabled: true, pastDue: ['company.tax_id'] }),
      ),
    ).toBe('action_needed');
  });

  // Regression, from a real account on 2026-08-05. A failed SSN match leaves
  // past_due set on an account that was NEVER live. Ranking past_due above the
  // chargesEnabled check put it in 'action_needed', which PERMITS selling — so
  // an operator who could not collect a cent would have been allowed to
  // publish a paid trip.
  it('is incomplete, not action_needed, when past-due but charges never worked', () => {
    expect(
      deriveConnectState(
        status({
          detailsSubmitted: true,
          chargesEnabled: false,
          currentlyDue: ['individual.id_number'],
          pastDue: ['individual.id_number'],
          disabledReason: 'requirements.past_due',
        }),
      ),
    ).toBe('incomplete');
  });

  it('blocks selling for that account', () => {
    const s = status({
      detailsSubmitted: true,
      currentlyDue: ['individual.id_number'],
      pastDue: ['individual.id_number'],
      disabledReason: 'requirements.past_due',
    });
    expect(canCollectPayments(deriveConnectState(s))).toBe(false);
  });

  it('is incomplete when past_due is set with an empty currently_due', () => {
    // Defensive: Stripe normally mirrors overdue items into currently_due, but
    // nothing here should depend on that.
    expect(
      deriveConnectState(status({ detailsSubmitted: true, pastDue: ['individual.id_number'] })),
    ).toBe('incomplete');
  });

  it.each([
    'rejected.fraud',
    'rejected.incomplete_verification',
    'rejected.listed',
    'rejected.other',
    'rejected.terms_of_service',
    'platform_paused',
    'listed',
  ])('is blocked for disabled_reason %s', reason => {
    expect(
      deriveConnectState(status({ detailsSubmitted: true, disabledReason: reason })),
    ).toBe('blocked');
  });

  it('is blocked even if charges were previously enabled', () => {
    expect(
      deriveConnectState(
        status({ chargesEnabled: true, detailsSubmitted: true, disabledReason: 'rejected.fraud' }),
      ),
    ).toBe('blocked');
  });

  // The trap this guards against: Stripe reuses disabled_reason for ordinary
  // stages of onboarding. Treating any non-null value as a rejection would
  // tell an operator whose paperwork is merely being read that they were
  // refused.
  it.each([
    ['under_review', 'under_review'],
    ['requirements.pending_verification', 'under_review'],
  ] as [string, ConnectState][])(
    'does not treat disabled_reason %s as a rejection',
    (reason, expected) => {
      expect(deriveConnectState(status({ detailsSubmitted: true, disabledReason: reason }))).toBe(
        expected,
      );
    },
  );

  it('does not treat disabled_reason requirements.past_due as a rejection', () => {
    // The claim under test is "not blocked" — the operator can still fix this
    // themselves. Which recoverable state it lands in depends on whether
    // charges ever worked, and both are asserted separately above.
    const notLive = deriveConnectState(
      status({
        detailsSubmitted: true,
        disabledReason: 'requirements.past_due',
        pastDue: ['company.tax_id'],
      }),
    );
    expect(notLive).not.toBe('blocked');
    expect(notLive).toBe('incomplete');

    const live = deriveConnectState(
      status({
        detailsSubmitted: true,
        chargesEnabled: true,
        disabledReason: 'requirements.past_due',
        pastDue: ['company.tax_id'],
      }),
    );
    expect(live).not.toBe('blocked');
    expect(live).toBe('action_needed');
  });
});

describe('canCollectPayments', () => {
  it('lets an operator sell while Stripe is reviewing them', () => {
    // Ohad, 2026-08-05. Blocking here punished the operator who had done
    // everything right; payments-checkout is the layer that protects the money.
    expect(canCollectPayments('under_review')).toBe(true);
  });

  it('lets an already-live operator keep selling with a past-due item', () => {
    expect(canCollectPayments('action_needed')).toBe(true);
  });

  it.each(['not_started', 'incomplete', 'blocked'] as ConnectState[])(
    'refuses %s',
    state => {
      expect(canCollectPayments(state)).toBe(false);
    },
  );

  it('allows ready', () => {
    expect(canCollectPayments('ready')).toBe(true);
  });
});

describe('paymentsAreLive', () => {
  it('is false while Stripe reviews, even though selling is allowed', () => {
    const s = status({ detailsSubmitted: true });
    expect(canCollectPayments(deriveConnectState(s))).toBe(true);
    // The gap between these two IS the waiting state. Anything that promises
    // the operator money must read this one.
    expect(paymentsAreLive(s)).toBe(false);
  });

  it('is true once charges are enabled', () => {
    expect(paymentsAreLive(status({ chargesEnabled: true }))).toBe(true);
  });
});

describe('describeConnectState', () => {
  it('counts one outstanding thing in the singular', () => {
    const s = status({ detailsSubmitted: true, currentlyDue: ['individual.id_number'] });
    expect(describeConnectState('incomplete', s).body).toContain('one more thing');
  });

  it('counts several outstanding things in the plural', () => {
    const s = status({
      detailsSubmitted: true,
      currentlyDue: ['individual.id_number', 'company.tax_id'],
    });
    expect(describeConnectState('incomplete', s).body).toContain('2 more things');
  });

  it('never leaks Stripe requirement keys into the copy', () => {
    const s = status({ detailsSubmitted: true, currentlyDue: ['individual.verification.document'] });
    expect(describeConnectState('incomplete', s).body).not.toContain('individual');
  });

  it('offers no button while Stripe is reviewing', () => {
    // Reopening would show the same "Account onboarded" page they just closed,
    // which is what made this state feel broken.
    expect(describeConnectState('under_review', status({ detailsSubmitted: true })).cta).toBeNull();
  });

  it('offers a way back into Stripe whenever the operator can act', () => {
    for (const state of ['not_started', 'incomplete', 'action_needed'] as ConnectState[]) {
      expect(describeConnectState(state, status()).cta).toBeTruthy();
    }
  });

  it('says so when charges work but payouts do not', () => {
    const s = status({ chargesEnabled: true, payoutsEnabled: false });
    expect(describeConnectState('ready', s).body).toContain('payouts');
    expect(describeConnectState('ready', s).done).toBe(true);
  });

  it('marks only ready as done', () => {
    const states: ConnectState[] = [
      'not_started',
      'incomplete',
      'under_review',
      'action_needed',
      'blocked',
    ];
    for (const state of states) {
      expect(describeConnectState(state, status()).done).toBe(false);
    }
    expect(describeConnectState('ready', status({ chargesEnabled: true })).done).toBe(true);
  });
});
