/**
 * What Stripe thinks of the operator's payout account.
 *
 * ⚠️ Like `cancellation.ts`, this is a hand-kept copy of the app's
 * `src/services/trips/connectStatus.ts`. Keep the two in step: an operator who
 * reads their Stripe state on their phone and again here must be told the same
 * thing, and one of the six states means "you will never be able to sell".
 *
 * ── Why six states and not a boolean ────────────────────────────────────────
 * This site used to read three booleans and show four states. Stripe's model
 * has six, and the boolean version collapsed the two that matter most:
 *
 *   • never finished the form            → charges_enabled = false
 *   • finished, Stripe is reviewing      → charges_enabled = false
 *   • Stripe REFUSED the account         → charges_enabled = false
 *
 * The third one is why this file exists. An account Stripe turned down was
 * being shown as "Not finished — Stripe still needs information from you",
 * which sends the operator to fill in a form that cannot help, while nobody
 * can pay for any of their trips.
 *
 * ── The source is the table, not Stripe ─────────────────────────────────────
 * The app asks `stripe-connect-onboard` for live fields. This site reads
 * `operator_payout_accounts`, which the Connect webhook and the daily sweep
 * keep current — no secret key, no round trip, and RLS gives each operator
 * their own row only.
 */

/** The raw Stripe fields, as stored on `operator_payout_accounts`. */
export interface ConnectStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** requirements.currently_due — Stripe is waiting on the operator. */
  currentlyDue: string[];
  /** requirements.past_due — the same, but a deadline has already passed. */
  pastDue: string[];
  /** requirements.disabled_reason — the account is switched off. */
  disabledReason: string | null;
}

export type ConnectState =
  /** No Stripe account at all. */
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
 * `disabled_reason` values a form cannot fix.
 *
 * Deliberately NOT the whole list. Stripe also uses this field for
 * `requirements.past_due`, `requirements.pending_verification` and
 * `under_review`, which are ordinary, recoverable stages — a naive
 * `disabledReason != null` check would tell an operator whose paperwork is
 * merely being read that their account was refused.
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
  // status we could not look up at all.
  if (!s.accountId) return 'not_started';

  // Refused outright. Above the `chargesEnabled` check because Stripe can
  // reject an account that was previously live.
  if (s.disabledReason && UNRECOVERABLE_REASONS.has(s.disabledReason)) return 'blocked';

  // Already live. A missed deadline here is the "works today, stops tomorrow"
  // case: warn loudly, but do not take away something that currently works.
  //
  // ⚠️ Gated on charges ALREADY being enabled. A failed SSN match leaves
  // `past_due = ['individual.id_number']` on an account that was NEVER live;
  // ranking past_due above this check would put it in `action_needed`, a state
  // that permits selling. Found on a real account 2026-08-05.
  if (s.chargesEnabled) return s.pastDue.length > 0 ? 'action_needed' : 'ready';

  // Not live, and Stripe is waiting on them. `past_due` is included because
  // Stripe lists overdue items in BOTH arrays — but on an account that never
  // worked, "past due" is just the next thing to go and do.
  if (s.currentlyDue.length > 0 || s.pastDue.length > 0) return 'incomplete';

  // Nothing outstanding and charges still off: Stripe is verifying.
  if (s.detailsSubmitted) return 'under_review';

  // An account exists, the form was never submitted, and Stripe is asking for
  // nothing — an account created the moment the sheet opened and abandoned.
  return 'incomplete';
}

/**
 * Can a traveler actually be charged right now?
 *
 * Anything that promises the operator money must be gated on THIS. A trip can
 * be published and selling while it is false — that gap is the whole "waiting
 * for Stripe" experience.
 */
export function paymentsAreLive(s: ConnectStatus): boolean {
  return s.chargesEnabled;
}

export interface ConnectCopy {
  /** Short label for the tag beside a heading. */
  tag: string;
  /** Which tag colour class to use. */
  tone: 'ok' | 'warn' | 'wait' | 'danger' | 'idle';
  /** One sentence, in the operator's terms. */
  line: string;
}

/**
 * What the operator is told, on Settings.
 *
 * The app's wording, shortened to a tag and a line because this card sits in a
 * list of other settings rather than in an onboarding flow.
 */
export function describeConnectState(state: ConnectState, s: ConnectStatus): ConnectCopy {
  switch (state) {
    case 'not_started':
      return {
        tag: 'Not connected',
        tone: 'idle',
        line: 'You cannot take payments in the app until Stripe is connected.',
      };

    case 'incomplete':
      return {
        tag: 'Not finished',
        tone: 'warn',
        // The count, not the field names: Stripe's are internal strings like
        // 'individual.verification.document', and their own form is what
        // collects them.
        line: s.currentlyDue.length
          ? `Stripe still needs ${
              s.currentlyDue.length === 1 ? 'one more thing' : `${s.currentlyDue.length} more things`
            } from you. Finish it in the Swellyo app.`
          : 'You closed Stripe’s form before it had everything. Finish it in the Swellyo app.',
      };

    case 'under_review':
      return {
        tag: 'Under review',
        tone: 'wait',
        line: 'Stripe has your details and is checking them. Nothing to do.',
      };

    case 'action_needed':
      return {
        tag: 'Action needed',
        tone: 'warn',
        line: 'Some details are past their deadline. Send them now, or Stripe will stop your payments.',
      };

    case 'ready':
      return s.payoutsEnabled
        ? {
            tag: 'Ready',
            tone: 'ok',
            line: 'Stripe can take payments and pay you out.',
          }
        : {
            // Charges work, payouts do not. Money piles up in the Stripe
            // balance instead of reaching the bank — not a problem today, very
            // much one later.
            tag: 'Payouts on hold',
            tone: 'warn',
            line: 'Stripe can take payments, but is not paying out yet. Stripe usually holds the first payout for a few days.',
          };

    case 'blocked':
      return {
        tag: 'Not approved',
        tone: 'danger',
        line: 'Stripe turned down this account, so it cannot collect payments. Stripe decides this, not Swellyo — contact Stripe support to find out why.',
      };
  }
}

/** What a trip page says when the money is not live yet. Null = say nothing. */
export function tripPaymentWarning(state: ConnectState): string | null {
  switch (state) {
    // Silence while we do not know yet. A banner that says "travelers cannot
    // pay" and disappears a second later is worse than a beat of nothing.
    case 'not_started':
    case 'ready':
    case 'action_needed':
      return null;
    case 'under_review':
      return "Stripe is still checking your details. Travelers can join, but they can't pay yet — we'll let you know the moment they can.";
    case 'blocked':
      return 'Stripe turned down your payout account, so nobody can pay for this trip. Contact Stripe support.';
    case 'incomplete':
      return "Travelers can't pay yet. Finish connecting Stripe in the Swellyo app.";
  }
}

/** The status to assume when the row could not be read at all. */
export const UNKNOWN_CONNECT_STATUS: ConnectStatus = {
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  currentlyDue: [],
  pastDue: [],
  disabledReason: null,
};
