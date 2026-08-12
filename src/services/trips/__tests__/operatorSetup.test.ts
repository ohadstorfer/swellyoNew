import {
  operatorSetupSteps,
  isOperatorSetupComplete,
  outstandingSteps,
  firstOutstandingStep,
  setupSummary,
  SETUP_STEP_ORDER,
  OPERATOR_TERMS_VERSION,
  type OperatorSetupInput,
} from '../operatorSetup';
import type { OperatorSettings } from '../operatorSettingsService';
import { DEFAULT_POLICY } from '../cancellationPolicy';
import type { ConnectState } from '../connectStatus';

// Built here rather than imported from operatorSettingsService, which is not a
// pure module — it opens the Supabase client, which needs AsyncStorage, which
// is not available under jest. `operatorSetup` only TYPE-imports that file, so
// it stays testable with no mocks; importing a runtime value here would throw
// that away. `cancellationPolicy` is safe: it has no imports at all, by design.
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
  path: 'defaults/u/i.pdf',
  name: 'insurance.pdf',
  mime: 'application/pdf',
  sizeBytes: 10,
  uploadedAt: '2026-08-11T00:00:00Z',
};

const settings = (over: Partial<OperatorSettings> = {}): OperatorSettings => ({
  ...EMPTY,
  ...over,
});

const waiver = {
  path: 'defaults/u/w.pdf',
  name: 'waiver.pdf',
  hash: 'abc',
  sizeBytes: 10,
  uploadedAt: '2026-08-11T00:00:00Z',
};

/** Everything done, overridable per test. */
const ready = (over: Partial<OperatorSetupInput> = {}): OperatorSetupInput => ({
  connect: 'ready',
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

const stepsByKey = (input: OperatorSetupInput) =>
  Object.fromEntries(operatorSetupSteps(input).map(s => [s.key, s]));

describe('operatorSetupSteps', () => {
  it('returns the six steps in a fixed order, terms last', () => {
    expect(operatorSetupSteps(ready()).map(s => s.key)).toEqual(SETUP_STEP_ORDER);
    expect(SETUP_STEP_ORDER).toEqual([
      'stripe',
      'currency',
      'policy',
      'waiver',
      'insurance',
      'terms',
    ]);
  });

  it('a brand new operator has nothing done', () => {
    const fresh: OperatorSetupInput = { connect: 'not_started', settings: settings() };
    expect(operatorSetupSteps(fresh).every(s => !s.done)).toBe(true);
    expect(isOperatorSetupComplete(fresh)).toBe(false);
  });

  it('is complete when all four are settled', () => {
    expect(isOperatorSetupComplete(ready())).toBe(true);
    expect(outstandingSteps(ready())).toEqual([]);
  });
});

describe('a default value is not a confirmed one', () => {
  // The whole reason the *_confirmed_at columns exist. Both settings always
  // have a usable value, so a null-check would call this operator finished.
  it('an untouched operator is NOT done, even though the policy works', () => {
    const untouched = ready({ settings: settings({ defaultWaiver: waiver }) });

    expect(untouched.settings.policy).toEqual(DEFAULT_POLICY);
    expect(untouched.settings.policy.preset).toBe('standard');
    expect(untouched.settings.defaultCurrency).toBeNull();

    expect(stepsByKey(untouched).policy.done).toBe(false);
    expect(stepsByKey(untouched).currency.done).toBe(false);
    expect(isOperatorSetupComplete(untouched)).toBe(false);
  });

  it('confirming without changing anything is enough', () => {
    const confirmed = ready({
      settings: settings({
        defaultWaiver: waiver,
        insurance,
        termsAcceptedAt: '2026-08-11T00:00:00Z',
        termsVersion: OPERATOR_TERMS_VERSION,
        currencyConfirmedAt: '2026-08-11T00:00:00Z',
        policyConfirmedAt: '2026-08-11T00:00:00Z',
      }),
    });
    // Still the defaults — still complete. Looking is the requirement.
    expect(confirmed.settings.defaultCurrency).toBeNull();
    expect(isOperatorSetupComplete(confirmed)).toBe(true);
  });
});

describe('stripe', () => {
  // Matches canCollectPayments deliberately: blocking an operator whom Stripe
  // is merely reading punishes them for having done everything right.
  it.each<[ConnectState, boolean]>([
    ['not_started', false],
    ['incomplete', false],
    ['blocked', false],
    ['under_review', true],
    ['action_needed', true],
    ['ready', true],
  ])('%s → done: %s', (connect, done) => {
    expect(stepsByKey(ready({ connect })).stripe.done).toBe(done);
  });

  it('flags under_review as pending so the copy can say so', () => {
    expect(stepsByKey(ready({ connect: 'under_review' })).stripe.pending).toBe(true);
    expect(stepsByKey(ready({ connect: 'ready' })).stripe.pending).toBe(false);
  });
});

describe('waiver', () => {
  it('is done only with a stored template', () => {
    expect(stepsByKey(ready()).waiver.done).toBe(true);
    expect(stepsByKey(ready({ settings: settings({ defaultWaiver: null }) })).waiver.done).toBe(
      false,
    );
  });
});

describe('insurance', () => {
  it('is done only with a stored certificate', () => {
    expect(stepsByKey(ready()).insurance.done).toBe(true);
    expect(stepsByKey(ready({ settings: settings({ ...ready().settings, insurance: null }) })).insurance.done).toBe(
      false,
    );
  });
});

describe('terms', () => {
  it('is done when the CURRENT version was accepted', () => {
    expect(stepsByKey(ready()).terms.done).toBe(true);
  });

  it('is NOT done when an older version was accepted', () => {
    // The whole point of storing a version rather than a boolean: publishing
    // real terms must reopen this step for everyone who agreed to the
    // placeholder, with no migration and no second column.
    const stale = ready({
      settings: settings({ ...ready().settings, termsVersion: 'something-older' }),
    });
    expect(stepsByKey(stale).terms.done).toBe(false);
    expect(isOperatorSetupComplete(stale)).toBe(false);
  });

  it('is NOT done with a version but no timestamp', () => {
    const half = ready({
      settings: settings({ ...ready().settings, termsAcceptedAt: null }),
    });
    expect(stepsByKey(half).terms.done).toBe(false);
  });
});

describe('firstOutstandingStep', () => {
  it('opens on the first thing left, in flow order', () => {
    expect(firstOutstandingStep({ connect: 'not_started', settings: settings() })).toBe('stripe');
    expect(
      firstOutstandingStep(ready({ settings: settings({ defaultWaiver: waiver }) })),
    ).toBe('currency');
    expect(firstOutstandingStep(ready({ settings: settings({ ...ready().settings, defaultWaiver: null }) }))).toBe(
      'waiver',
    );
  });

  it('falls back to the first step when nothing is left', () => {
    // Never returns undefined — the flow can be reopened after finishing.
    expect(firstOutstandingStep(ready())).toBe('stripe');
  });
});

describe('setupSummary', () => {
  it('names the single remaining step', () => {
    const oneLeft = ready({ settings: settings({ ...ready().settings, defaultWaiver: null }) });
    expect(setupSummary(oneLeft)).toBe('Upload the waiver every traveler signs.');
  });

  it('names the NEXT step when several are left, never a count', () => {
    // The banner's progress bar carries "how many"; this sentence carries
    // "what to do now".
    const summary = setupSummary({ connect: 'not_started', settings: settings() });
    expect(summary).toBe('Connect Stripe so travelers can pay you.');
    expect(summary).not.toMatch(/\d/);
  });

  it('says so when finished', () => {
    expect(setupSummary(ready())).toBe('Your setup is complete.');
  });
});
