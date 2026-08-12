/**
 * Is this operator ready to sell a trip, and if not, what is left?
 *
 * ── Pure on purpose ─────────────────────────────────────────────────────────
 * No network, no React. Four surfaces ask this question and must never
 * disagree: the setup flow, the card on the Trips tab, the gate on the Create
 * chooser, and the trip wizard's pre-filled steps. Same shape as
 * `connectStatus.ts`, and for the same reason.
 *
 * ── "Missing" is not "empty" ────────────────────────────────────────────────
 * Two of the four steps have working defaults. `cancellation_preset` defaults
 * to 'standard' and a NULL `default_currency` legitimately means "follow my
 * country" — so neither can ever be absent, and a null-check would report an
 * operator as finished having never once seen the refund terms they are
 * selling on. What matters is whether a human looked, which is what the
 * `*ConfirmedAt` stamps record. That is a different fact from the value.
 */
import type { ConnectState } from './connectStatus';
import { canCollectPayments } from './connectStatus';
import type { OperatorSettings } from './operatorSettingsService';

export type SetupStepKey =
  | 'stripe'
  | 'currency'
  | 'policy'
  | 'waiver'
  | 'insurance'
  | 'terms';

/**
 * Fixed order — the flow, the card and the checklist all read top to bottom.
 *
 * Terms last on purpose. Agreeing to sell on Swellyo is the final act, after an
 * operator can actually see what they are agreeing to run: their payout
 * account, their prices, their refund rules, their paperwork. Asking first, on
 * a blank account, is a click nobody reads.
 */
export const SETUP_STEP_ORDER: SetupStepKey[] = [
  'stripe',
  'currency',
  'policy',
  'waiver',
  'insurance',
  'terms',
];

/**
 * Which version of the operator terms is current.
 *
 * ⚠️ STILL NOT A LAWYER'S DOCUMENT. What the operator now reads is a written
 * summary of the arrangement the code already implements — see
 * services/terms/operatorAgreement.ts, which sets out what it does and does not
 * claim. Accepting a `summary-` version records that the operator was shown
 * that description and agreed to it. It is not a signed contract.
 *
 * Bumped from `placeholder-2026-08-11`, where the sheet showed no terms at all.
 * That is a materially different thing to have agreed to, so an acceptance of
 * the old string is not carried over — those operators are asked again. (None
 * existed: `terms_accepted_at` was null for every operator when this changed.)
 * When the real agreement lands, bump this once more and the same thing
 * happens, which is the whole reason a version is stored rather than a boolean.
 */
export const OPERATOR_TERMS_VERSION = 'summary-2026-08-12';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  /** One line, shown while the step is still outstanding. */
  todo: string;
  done: boolean;
  /**
   * Done, but not by the operator's own doing — Stripe is still reviewing.
   * Counts as complete so nobody is parked on a screen waiting, and is worth
   * saying out loud so "ready" is not overstated. See the note on `stripeDone`.
   */
  pending?: boolean;
}

export interface OperatorSetupInput {
  connect: ConnectState;
  settings: OperatorSettings;
}

/**
 * Stripe counts as done while it is still `under_review`.
 *
 * Consistent with {@link canCollectPayments}, which Ohad changed on 2026-08-05
 * for the same reason: blocking here punishes the operator who did everything
 * right and leaves them nothing to do but wait. The money is protected a layer
 * down — `payments-checkout` refuses a live-mode checkout unless the account
 * really can take charges — so a trip built during review simply cannot collect
 * until it can.
 */
function stripeDone(state: ConnectState): boolean {
  return canCollectPayments(state);
}

export function operatorSetupSteps(input: OperatorSetupInput): SetupStep[] {
  const { connect, settings } = input;

  return [
    {
      key: 'stripe',
      title: 'Get paid',
      todo: 'Connect Stripe so travelers can pay you.',
      done: stripeDone(connect),
      pending: connect === 'under_review',
    },
    {
      key: 'currency',
      title: 'Price currency',
      todo: 'Choose the currency you set your prices in.',
      done: settings.currencyConfirmedAt != null,
    },
    {
      key: 'policy',
      title: 'Cancellation policy',
      todo: 'Decide what travelers get back if they cancel.',
      done: settings.policyConfirmedAt != null,
    },
    {
      key: 'waiver',
      title: 'Waiver',
      todo: 'Upload the waiver every traveler signs.',
      done: Boolean(settings.defaultWaiver),
    },
    {
      key: 'insurance',
      title: 'Insurance',
      todo: 'Upload your insurance certificate.',
      done: Boolean(settings.insurance),
    },
    {
      key: 'terms',
      title: 'Swellyo terms',
      todo: 'Agree to the terms for running trips.',
      // Version-matched, not merely "have they ever agreed". A stale
      // acceptance is an unfinished step — that is what lets new terms be
      // rolled out without a migration or a second column.
      done: settings.termsAcceptedAt != null && settings.termsVersion === OPERATOR_TERMS_VERSION,
    },
  ];
}

export function isOperatorSetupComplete(input: OperatorSetupInput): boolean {
  return operatorSetupSteps(input).every(s => s.done);
}

/** What is still outstanding, in flow order. Empty when finished. */
export function outstandingSteps(input: OperatorSetupInput): SetupStep[] {
  return operatorSetupSteps(input).filter(s => !s.done);
}

/** The step the flow should open on: the first unfinished one, else the first. */
export function firstOutstandingStep(input: OperatorSetupInput): SetupStepKey {
  return outstandingSteps(input)[0]?.key ?? SETUP_STEP_ORDER[0];
}

/**
 * The line on the Trips tab card.
 *
 * ALWAYS names the next thing to do, never a count. "3 things left" tells an
 * operator how far away they are, which is discouraging and not actionable;
 * "Connect Stripe so travelers can pay you" is one concrete move. The banner
 * shows the count as a progress bar beside this, so the number is not lost —
 * it just stops being the sentence.
 */
export function setupSummary(input: OperatorSetupInput): string {
  const left = outstandingSteps(input);
  if (left.length === 0) return 'Your setup is complete.';
  return left[0].todo;
}
