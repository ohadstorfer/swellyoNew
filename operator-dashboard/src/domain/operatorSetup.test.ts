import { describe, it, expect } from 'vitest';
import {
  operatorSetupSteps,
  isOperatorSetupComplete,
  outstandingSteps,
  setupSummary,
  stripeDone,
  SETUP_STEP_ORDER,
  OPERATOR_TERMS_VERSION,
  type OperatorSetupInput,
} from './operatorSetup';
import { DEFAULT_POLICY } from './cancellation';
import { NO_PAYOUT, type OperatorSettings, type PayoutState } from '../services/settings';
// The app's copies, as text. This project shares no code with the app on
// purpose, so the twins are compared as files rather than imported.
import appOperatorSetupSource from '../../../src/services/trips/operatorSetup.ts?raw';
import appAgreementSource from '../../../src/services/terms/operatorAgreement.ts?raw';
import dashboardAgreementSource from './operatorAgreement.ts?raw';

const EMPTY: OperatorSettings = {
  defaultCurrency: null,
  policy: DEFAULT_POLICY,
  currencyConfirmedAt: null,
  policyConfirmedAt: null,
  defaultWaiver: null,
  insurance: null,
  termsAcceptedAt: null,
  termsVersion: null,
};

const insurance = {
  path: 'defaults/u/i.jpg',
  name: 'certificate.jpg',
  mime: 'image/jpeg',
  sizeBytes: 10,
  uploadedAt: '2026-08-11T00:00:00Z',
};

const settings = (over: Partial<OperatorSettings> = {}): OperatorSettings => ({
  ...EMPTY,
  ...over,
});

const payout = (over: Partial<PayoutState> = {}): PayoutState => ({
  ...NO_PAYOUT,
  ...over,
});

const waiver = {
  path: 'defaults/u/w.pdf',
  name: 'waiver.pdf',
  hash: 'abc',
  sizeBytes: 10,
  uploadedAt: '2026-08-11T00:00:00Z',
};

const ready = (over: Partial<OperatorSetupInput> = {}): OperatorSetupInput => ({
  payout: payout({ hasAccount: true, chargesEnabled: true, detailsSubmitted: true }),
  settings: settings({
    currencyConfirmedAt: '2026-08-11T00:00:00Z',
    policyConfirmedAt: '2026-08-11T00:00:00Z',
    defaultWaiver: waiver,
    insurance,
    termsAcceptedAt: '2026-08-11T00:00:00Z',
    termsVersion: OPERATOR_TERMS_VERSION,
  }),
  ...over,
});

const byKey = (i: OperatorSetupInput) =>
  Object.fromEntries(operatorSetupSteps(i).map(s => [s.key, s]));

describe('operatorSetupSteps', () => {
  it('has the same six steps, in the same order, as the app', () => {
    expect(SETUP_STEP_ORDER).toEqual([
      'stripe',
      'currency',
      'policy',
      'waiver',
      'insurance',
      'terms',
    ]);
    expect(operatorSetupSteps(ready()).map(s => s.key)).toEqual(SETUP_STEP_ORDER);
  });

  it('the terms version matches the app, or agreeing on one site leaves the other unfinished', () => {
    // Read straight out of the app's source rather than hand-pinned here. The
    // hand-pinned version of this test passed for three weeks while the app
    // had already moved on — both sides were stale together, which is the one
    // failure a pin cannot see.
    const m = appOperatorSetupSource.match(/export const OPERATOR_TERMS_VERSION = '([^']+)'/);
    expect(m?.[1]).toBeDefined();
    expect(OPERATOR_TERMS_VERSION).toBe(m![1]);
  });

  it('the agreement summary is the same document the app shows', () => {
    // Everything below the header comment must match byte for byte. The header
    // is allowed to differ — each file says which one is the copy.
    const body = (src: string) => src.slice(src.indexOf('export const IS_DRAFT'));
    expect(body(dashboardAgreementSource)).toBe(body(appAgreementSource));
  });

  it('terms are NOT done when an older version was accepted', () => {
    const stale = ready({
      settings: settings({ ...ready().settings, termsVersion: 'something-older' }),
    });
    expect(byKey(stale).terms.done).toBe(false);
    expect(isOperatorSetupComplete(stale)).toBe(false);
  });

  it('insurance is done only with a stored certificate', () => {
    expect(byKey(ready()).insurance.done).toBe(true);
    expect(
      byKey(ready({ settings: settings({ ...ready().settings, insurance: null }) })).insurance.done,
    ).toBe(false);
  });

  it('a brand new operator has nothing done', () => {
    const fresh: OperatorSetupInput = { payout: payout(), settings: settings() };
    expect(operatorSetupSteps(fresh).every(s => !s.done)).toBe(true);
    expect(isOperatorSetupComplete(fresh)).toBe(false);
  });

  it('is complete when all four are settled', () => {
    expect(isOperatorSetupComplete(ready())).toBe(true);
    expect(outstandingSteps(ready())).toEqual([]);
  });

  it('marks stripe as app-only — this site cannot finish it', () => {
    expect(byKey(ready()).stripe.appOnly).toBe(true);
    // Nothing else is: the other three are fully doable here.
    expect(byKey(ready()).currency.appOnly).toBeUndefined();
  });
});

describe('a default value is not a confirmed one', () => {
  // The reason the *_confirmed_at columns exist. Both settings always have a
  // usable value, so a null-check would call this operator finished.
  it('an untouched operator is NOT done, even though the policy works', () => {
    const untouched = ready({ settings: settings({ defaultWaiver: waiver }) });
    expect(untouched.settings.policy.preset).toBe('standard');
    expect(byKey(untouched).policy.done).toBe(false);
    expect(byKey(untouched).currency.done).toBe(false);
    expect(isOperatorSetupComplete(untouched)).toBe(false);
  });

  it('confirming without changing anything is enough', () => {
    expect(isOperatorSetupComplete(ready())).toBe(true);
    expect(ready().settings.defaultCurrency).toBeNull();
  });
});

describe('stripeDone — the app rule, in the columns this site has', () => {
  it('is done once charges are enabled (ready, and action_needed)', () => {
    expect(stripeDone(payout({ hasAccount: true, chargesEnabled: true }))).toBe(true);
  });

  it('is done while Stripe is still reviewing (under_review)', () => {
    // Matches canCollectPayments: blocking someone Stripe is merely reading
    // punishes them for having done everything right.
    expect(stripeDone(payout({ hasAccount: true, detailsSubmitted: true }))).toBe(true);
  });

  it('is NOT done when the form was never submitted (incomplete)', () => {
    expect(stripeDone(payout({ hasAccount: true }))).toBe(false);
  });

  it('is NOT done with no account at all (not_started)', () => {
    expect(stripeDone(payout())).toBe(false);
    // Defensive: flags set without an account must not read as connected.
    expect(stripeDone(payout({ detailsSubmitted: true }))).toBe(false);
  });
});

describe('setupSummary', () => {
  it('names the NEXT step, never a count', () => {
    const summary = setupSummary({ payout: payout(), settings: settings() });
    expect(summary).toBe('Connect Stripe so travelers can pay you.');
    expect(summary).not.toMatch(/\d/);
  });

  it('names the last one when only the waiver is left', () => {
    const oneLeft = ready({ settings: settings({ ...ready().settings, defaultWaiver: null }) });
    expect(setupSummary(oneLeft)).toBe('Upload the waiver every traveler signs.');
  });

  it('says so when finished', () => {
    expect(setupSummary(ready())).toBe('Your setup is complete.');
  });
});
