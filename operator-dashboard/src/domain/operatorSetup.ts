/**
 * Is this operator ready to sell a trip, and if not, what is left?
 *
 * ── The app has the same rule, and this is NOT a byte copy ──────────────────
 * `src/services/trips/operatorSetup.ts` in the app is the original. Unlike
 * `cancellation.ts`, this cannot be a straight copy, because the two apps learn
 * about Stripe in different ways:
 *
 *   · the app calls `stripe-connect-onboard` and gets Stripe's live
 *     `requirements` arrays;
 *   · this site reads the same fields off `operator_payout_accounts`, which
 *     the Connect webhook and the daily sweep keep current.
 *
 * Both then run the SAME six-state rule — the app's `connectStatus.ts` and this
 * project's `domain/connect.ts` twin. So the STEPS and their meaning are
 * shared; only where the fields come from differs.
 * Anything else that drifts is a bug — an operator must not be told they are
 * finished here and unfinished there.
 *
 * ── "Missing" is not "empty" ────────────────────────────────────────────────
 * Currency and policy both have working defaults, so neither can ever be
 * absent, and a null-check would call an operator finished who has never seen
 * the refund terms they are selling on. The `*ConfirmedAt` stamps record that a
 * human looked, which is a different fact from what the value is.
 */
import { connectStatusOf, type OperatorSettings, type PayoutState } from '../services/settings';
import { deriveConnectState } from './connect';

export type SetupStepKey =
  | 'stripe'
  | 'currency'
  | 'policy'
  | 'waiver'
  | 'insurance'
  | 'terms';

/**
 * Fixed order — the checklist and the banner both read top to bottom.
 *
 * Terms last on purpose: agreeing to sell on Swellyo is the final act, after an
 * operator can see what they are agreeing to run. Asking first, on a blank
 * account, is a click nobody reads.
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
 * ⚠️ THERE ARE NO TERMS YET. Placeholder, so the flow and the re-accept
 * mechanism exist before the document does. Must stay identical to
 * `OPERATOR_TERMS_VERSION` in the app's `services/trips/operatorSetup.ts` — if
 * the two drift, agreeing on one surface leaves the step unfinished on the
 * other. Change both together when real terms are published.
 */
export const OPERATOR_TERMS_VERSION = 'placeholder-2026-08-11';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  todo: string;
  done: boolean;
  /** Done, but because Stripe is still reviewing rather than approved. */
  pending?: boolean;
  /** This step cannot be finished on this site — it needs the phone app. */
  appOnly?: boolean;
}

export interface OperatorSetupInput {
  payout: PayoutState;
  settings: OperatorSettings;
}

/**
 * Stripe counts as done while Stripe is still reviewing.
 *
 * The app's `canCollectPayments` says ready | under_review | action_needed, for
 * a reason Ohad settled on 2026-08-05: blocking an operator whom Stripe is
 * merely reading punishes them for having done everything right.
 *
 * ⚠️ `blocked` is NOT done. Until 2026-08-19 this read four booleans, and an
 * account Stripe had REFUSED satisfied `detailsSubmitted` — so the checklist
 * ticked the step, the banner disappeared, and nothing anywhere said why no
 * trip could take money. `disabled_reason` was on the table all along; this
 * site simply never selected it.
 */
export function stripeDone(p: PayoutState): boolean {
  const state = deriveConnectState(connectStatusOf(p));
  return state === 'ready' || state === 'action_needed' || state === 'under_review';
}

export function operatorSetupSteps(input: OperatorSetupInput): SetupStep[] {
  const { payout, settings } = input;

  return [
    {
      key: 'stripe',
      title: 'Get paid',
      todo: 'Connect Stripe so travelers can pay you.',
      done: stripeDone(payout),
      // "Checking", not "Done" — submitted and waiting on Stripe. Derived the
      // same way as `done`, so a refused account can never read as pending.
      pending: deriveConnectState(connectStatusOf(payout)) === 'under_review',
      // Stripe's onboarding forms are embedded in the phone app and need the
      // secret key behind an edge function. Rebuilding that here would mean a
      // second onboarding path to keep in step with Stripe's six states.
      appOnly: true,
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
      // acceptance is an unfinished step, which is how new terms roll out
      // without a migration or a second column.
      done: settings.termsAcceptedAt != null && settings.termsVersion === OPERATOR_TERMS_VERSION,
    },
  ];
}

export function isOperatorSetupComplete(input: OperatorSetupInput): boolean {
  return operatorSetupSteps(input).every(s => s.done);
}

/** What is still outstanding, in checklist order. Empty when finished. */
export function outstandingSteps(input: OperatorSetupInput): SetupStep[] {
  return operatorSetupSteps(input).filter(s => !s.done);
}

/**
 * The line on the banner.
 *
 * ALWAYS names the next thing to do, never a count — "3 things left" says how
 * far away you are, which discourages and is not actionable. The banner shows
 * the count as a progress bar beside this, so the number is not lost.
 */
export function setupSummary(input: OperatorSetupInput): string {
  const left = outstandingSteps(input);
  if (left.length === 0) return 'Your setup is complete.';
  return left[0].todo;
}
