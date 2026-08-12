/**
 * The operator agreement, as a document the UI can render.
 *
 * ⚠️ THIS IS A SUMMARY, NOT THE CONTRACT. No lawyer has written the operator
 * agreement yet. What is below is a plain-English description of the
 * arrangement the code and the database ALREADY implement — the operator is the
 * seller, money settles to their Stripe account, our commission is 12%, refunds
 * come out of their balance. Every sentence is a true statement about how
 * Swellyo works today, checkable against `payments-checkout`, the
 * `operator_payout_accounts` table and `cancellationPolicy.ts`.
 *
 * WHY A SUMMARY RATHER THAN AN EMPTY PANEL. This screen used to say only "the
 * terms are not published yet", on the reasoning that invented legal text is
 * the one kind of placeholder that gets mistaken for the real thing. That
 * reasoning still holds for FABRICATED CLAUSES and nothing here fabricates one:
 * there is no governing law, no indemnity, no limitation of liability, no
 * termination clause — the parts a lawyer writes are absent, and the sheet says
 * so. But it over-applied. An operator being asked to tick a box deserves to
 * know what deal they are ticking, and we know the deal; we built it.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED. Anything still undecided is listed in the
 * `pending` section instead of being guessed at — who absorbs the Stripe fee on
 * a refund (Ohad's open decision) and how chargebacks are recovered (Phase 3,
 * not built). Writing a confident sentence about either would be exactly the
 * fabrication this file avoids.
 *
 * WHEN THE REAL AGREEMENT ARRIVES:
 *   1. replace `SECTIONS` with the real text (or a fetch of the hosted doc),
 *   2. set `IS_DRAFT` to false,
 *   3. bump `OPERATOR_TERMS_VERSION` in services/trips/operatorSetup.ts.
 * Every operator on the old version gets an unfinished setup step again, which
 * is the entire reason the version is stored rather than a boolean.
 *
 * See docs/specs/operator-trips/agreements-and-terms.md.
 */

/** False once a lawyer's text replaces `SECTIONS`. Drives the draft banner and
 *  the wording of the consent checkbox — both must stop claiming "summary" at
 *  the same moment the content stops being one. */
export const IS_DRAFT = true;

export interface AgreementSection {
  heading: string;
  /** One paragraph per entry. Kept as separate strings rather than one blob
   *  with newlines so the renderer controls the rhythm between them. */
  paragraphs: string[];
}

export const SECTIONS: AgreementSection[] = [
  {
    heading: 'You sell the trip',
    paragraphs: [
      'When a traveler books a paid trip you have created, they are buying it from you. You are the seller. Swellyo is the platform you sell it on, not the travel provider.',
      'Your business is what appears on the traveler’s card statement, and the agreement to deliver the trip is between you and them.',
    ],
  },
  {
    heading: 'How you get paid',
    paragraphs: [
      'Travelers pay by card through Stripe. The money settles into your own Stripe account, in your own currency — it does not sit with Swellyo first.',
      'Swellyo’s commission is 12% of each payment. It is taken automatically at the moment the traveler pays, so what reaches your account is already net of it.',
    ],
  },
  {
    heading: 'Cancellations and refunds',
    paragraphs: [
      'You choose the cancellation policy for each trip. The traveler is shown it and has to agree to it before they can pay.',
      'That policy is fixed at the moment they pay. Changing your mind later does not change the terms someone already bought under.',
      'Refunds you issue come out of your Stripe balance, because that is where the money went.',
    ],
  },
  {
    heading: 'What you are responsible for',
    paragraphs: [
      'Running the trip as you advertised it, and describing dates, prices and what is included accurately.',
      'Honouring the cancellation policy you published.',
      'Holding any licences, registrations and insurance that running trips requires where you operate. Swellyo does not provide these and does not check them for you.',
    ],
  },
  {
    heading: 'What Swellyo is responsible for',
    paragraphs: [
      'Running the platform, processing payments through Stripe, and getting your share to your account.',
      'Swellyo does not organise, lead, or supervise your trips, and does not employ you.',
    ],
  },
  {
    heading: 'Still being worked out',
    paragraphs: [
      'Who covers the card processing fee when a refund is issued.',
      'What happens when a traveler disputes a charge with their own bank, rather than asking you for a refund.',
      'Whether specific countries require registrations beyond the ones above.',
      'These are open questions, not hidden terms. They will be answered in the full agreement, and you will be asked to read it then.',
    ],
  },
];

/** Shown under the title. Kept next to the content it describes so the two
 *  cannot drift — a "last reviewed" date on a document nobody edited is worse
 *  than no date at all. */
export const LAST_REVIEWED = '12 August 2026';
