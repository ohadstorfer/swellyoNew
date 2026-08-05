/**
 * What Stripe thinks of one operator's payout account, and what to say about
 * it.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The app used to hold a single boolean, `charges_enabled`, and drew two
 * screens from it: "Connect Stripe" and "Stripe connected". Stripe's own model
 * has six meaningfully different states, and the single boolean collapsed the
 * two that matter most into one:
 *
 *   • the operator never finished the form          → charges_enabled = false
 *   • the operator finished, and Stripe is          → charges_enabled = false
 *     reviewing them (minutes, sometimes longer)
 *
 * So an operator who had just been told by Stripe "We will review the
 * information you submitted" came back to a button that said "Connect Stripe",
 * and to a Next button that refused to move. The only thing on offer was the
 * button they had already used. That is the bug this file fixes.
 *
 * Stripe is explicit that leaving the flow proves nothing:
 *   "When a connected account exits the onboarding flow … it doesn't confirm
 *    that they've provided all outstanding requirements. You must still check
 *    the statuses of the requested capabilities."
 *   — docs.stripe.com/connect/track-account-onboarding
 *
 * ── Pure on purpose ─────────────────────────────────────────────────────────
 * No network, no React. The rule that decides whether an operator is allowed
 * to sell a trip is worth having under unit test, and it is read from at least
 * three places (the create wizard, the edit screen, the card) that must not be
 * allowed to disagree.
 *
 * The server deliberately derives NONE of this — `stripe-connect-onboard`
 * returns the raw Stripe fields and nothing else, so this is the only
 * implementation of the rule anywhere.
 */

/** The raw Stripe fields, exactly as `stripe-connect-onboard` returns them. */
export interface ConnectStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** requirements.currently_due — Stripe is waiting on the operator. */
  currentlyDue: string[];
  /** requirements.past_due — the same, but a deadline has already passed. */
  pastDue: string[];
  /** requirements.pending_verification — Stripe is working, nobody is blocked. */
  pendingVerification: string[];
  /** requirements.disabled_reason — the account is switched off. */
  disabledReason: string | null;
}

export type ConnectState =
  /** No Stripe account at all. The first tap creates one. */
  | 'not_started'
  /** They opened the form and left things unanswered. Their move. */
  | 'incomplete'
  /** Everything is answered and Stripe is verifying. Nobody's move. */
  | 'under_review'
  /** Live, but something is past its deadline and will switch them off. */
  | 'action_needed'
  /** Charges work. */
  | 'ready'
  /** Stripe turned the account off in a way a form cannot fix. */
  | 'blocked';

/**
 * `disabled_reason` values that a form cannot fix.
 *
 * Deliberately NOT the whole list. Stripe also uses this field for
 * `requirements.past_due`, `requirements.pending_verification` and
 * `under_review`, which are ordinary, recoverable stages of onboarding — a
 * naive `disabledReason != null` check would tell an operator whose paperwork
 * is merely being read that their account was refused.
 */
const UNRECOVERABLE_REASONS = new Set([
  'rejected.fraud',
  'rejected.incomplete_verification',
  'rejected.listed',
  'rejected.other',
  'rejected.terms_of_service',
  'platform_paused',
  'listed',
]);

/**
 * The one rule. Order matters — each line assumes the ones above it failed.
 */
export function deriveConnectState(s: ConnectStatus): ConnectState {
  // Nothing exists yet. Checked first because every other field is false on a
  // status we have not been able to look up at all.
  if (!s.accountId) return 'not_started';

  // Refused outright. Above the `chargesEnabled` check because Stripe can
  // reject an account that was previously live.
  if (s.disabledReason && UNRECOVERABLE_REASONS.has(s.disabledReason)) return 'blocked';

  // Already live. A missed deadline here is the "works today, stops tomorrow"
  // case: warn loudly, but do not take away something that currently works.
  //
  // `action_needed` is deliberately gated on charges ALREADY being enabled.
  // An earlier version ranked `past_due` above this check, which put an
  // account that had NEVER been live into `action_needed` — and that state
  // permits selling. Found on a real account 2026-08-05: a failed SSN match
  // leaves `past_due = ['individual.id_number']` on a `charges_enabled = false`
  // account, which would then have been allowed to publish a trip it could
  // never collect on. Below, that same account correctly falls to
  // `incomplete`: Stripe is waiting on them, and they are blocked.
  if (s.chargesEnabled) return s.pastDue.length > 0 ? 'action_needed' : 'ready';

  // Not live, and Stripe is waiting on them. `past_due` is included because
  // Stripe lists overdue items in BOTH arrays — but on an account that never
  // worked, "past due" is not a warning about losing something, it is just
  // the next thing to go and do.
  if (s.currentlyDue.length > 0 || s.pastDue.length > 0) return 'incomplete';

  // Nothing outstanding and charges still off: Stripe is verifying. This is
  // the state the old boolean could not express, and the whole reason for
  // this file.
  if (s.detailsSubmitted) return 'under_review';

  // An account exists but the form was never submitted and Stripe is asking
  // for nothing — the shape of an account created the moment the sheet opened
  // and abandoned on the first screen.
  return 'incomplete';
}

/**
 * May this operator choose "Collect payment in Swellyo" at all?
 *
 * TRUE while Stripe is still reviewing. That is a deliberate change, made by
 * Ohad on 2026-08-05: blocking here punished the operator who had done
 * everything right and left them with nothing to do but wait on a screen. The
 * money is protected one layer down instead — `payments-checkout` refuses to
 * create a live-mode checkout unless the operator's account really can take
 * charges, so a trip published during review simply cannot collect until it
 * can. See {@link paymentsAreLive} for what the UI must keep saying meanwhile.
 *
 * 'action_needed' is also true: those operators are already live and selling.
 */
export function canCollectPayments(state: ConnectState): boolean {
  return state === 'ready' || state === 'under_review' || state === 'action_needed';
}

/**
 * Can a traveler actually be charged right now?
 *
 * Different question from {@link canCollectPayments} and the gap between them
 * is the entire "waiting" experience: the trip may be published and selling
 * while this is false. Anything that promises the operator money must be
 * gated on THIS, not on the other one.
 */
export function paymentsAreLive(s: ConnectStatus): boolean {
  return s.chargesEnabled;
}

/** What the operator is shown. Kept here so every surface says the same thing. */
export interface ConnectCopy {
  title: string;
  body: string;
  /** Label for the button that reopens Stripe. Null when there is nothing to do. */
  cta: string | null;
  /** Draw it as settled (done) rather than as a to-do. */
  done: boolean;
}

export function describeConnectState(state: ConnectState, s: ConnectStatus): ConnectCopy {
  switch (state) {
    case 'not_started':
      return {
        title: 'Connect Stripe',
        body: 'Takes a few minutes. You will need your ID and bank details. Money goes straight to you.',
        cta: 'Connect Stripe',
        done: false,
      };

    case 'incomplete':
      return {
        title: 'Finish connecting Stripe',
        body: s.currentlyDue.length
          ? // The count, not the field names. Stripe's are internal strings
            // like 'individual.verification.document', and with Express
            // accounts their own form is what collects them — the docs say
            // outright that we "don't have to communicate the specific
            // requirements". A number tells the operator how far off they are
            // without pretending we can explain Stripe's list.
            `Stripe still needs ${s.currentlyDue.length === 1 ? 'one more thing' : `${s.currentlyDue.length} more things`} from you.`
          : 'You closed the form before Stripe had everything.',
        cta: 'Finish setup',
        done: false,
      };

    case 'under_review':
      return {
        title: 'Stripe is checking your details',
        body: "This usually takes a few minutes. We'll let you know the moment you can get paid — you can carry on setting up your trip.",
        // No button on purpose. There is nothing for them to open: Stripe
        // would show them the same "Account onboarded" page they just closed,
        // which is what made this state feel broken in the first place.
        cta: null,
        done: false,
      };

    case 'action_needed':
      return {
        title: 'Stripe needs something from you',
        body: 'Some details are past their deadline. Send them now, or Stripe will stop your payments.',
        cta: 'Open Stripe',
        done: false,
      };

    case 'ready':
      return {
        title: 'Stripe connected',
        body: s.payoutsEnabled
          ? 'You can collect payments, and Stripe pays out to your bank.'
          : // Charges work, payouts do not. Money accumulates in their Stripe
            // balance rather than reaching their bank — worth saying plainly,
            // because it is not a problem today and very much is one later.
            'You can collect payments. Stripe is still setting up your bank payouts.',
        cta: null,
        done: true,
      };

    case 'blocked':
      return {
        title: 'Stripe could not approve this account',
        body: 'Stripe turned down this account, so it cannot collect payments. Stripe decides this, not Swellyo — contact Stripe support to find out why.',
        cta: null,
        done: false,
      };
  }
}

/** The status to assume when we could not reach the server at all. */
export const UNKNOWN_CONNECT_STATUS: ConnectStatus = {
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  currentlyDue: [],
  pastDue: [],
  pendingVerification: [],
  disabledReason: null,
};
