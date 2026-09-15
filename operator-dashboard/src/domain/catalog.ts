/**
 * The requirement kinds the dashboard knows how to display.
 *
 * Operators can invent their own items, so anything not in this list is a
 * custom requirement. Those get their own "Other requirements" list rather
 * than a tile, because the tiles are built around these four uploads.
 *
 * How custom items should properly be counted and exported is still open —
 * see docs/SPEC.md §8.
 */
export const KNOWN_UPLOAD_KINDS = ['passport', 'insurance', 'visa', 'flights'] as const;

export type KnownUploadKind = (typeof KNOWN_UPLOAD_KINDS)[number];

const LABELS: Record<string, string> = {
  passport: 'Passports',
  insurance: 'Insurance',
  visa: 'Visas',
  flights: 'Flights',
  waiver: 'Waiver',
  medical: 'Medical form',
};

/** Plural label for a tile row. Falls back to the operator's own wording. */
export function kindLabel(kind: string, fallbackTitle: string): string {
  return LABELS[kind] ?? fallbackTitle;
}

export function isKnownUploadKind(kind: string): boolean {
  return (KNOWN_UPLOAD_KINDS as readonly string[]).includes(kind);
}

/* ───────────────────────────────────────────────────────────────────────────
 * The editable set
 *
 * Spec: docs/specs/operator-trips/deadline-editing.md
 *
 * ⚠️ TWIN of `REQUIREMENT_CATALOG` / `REQUIREMENT_ORDER` / `DEFAULT_TIMING` in
 * the app's `src/services/trips/tripDocumentsService.ts`. The two projects
 * share no code, so this is written twice on purpose — same arrangement as
 * `src/domain/operatorSetup.ts`. The titles and help text below are INSERTED
 * INTO THE DATABASE when an operator switches a requirement on, and travelers
 * read them in the app. Drift here does not stay here.
 * ────────────────────────────────────────────────────────────────────────── */

export type EditableKind =
  | 'deposit'
  | 'balance'
  | 'passport'
  | 'waiver'
  | 'medical'
  | 'insurance'
  | 'visa'
  | 'flights';

/** Insert order, so every trip lists its requirements the same way. Also the
 *  `sort_order` written on a new row. */
export const REQUIREMENT_ORDER: EditableKind[] = [
  'deposit',
  'balance',
  'passport',
  'waiver',
  'medical',
  'insurance',
  'visa',
  'flights',
];

export const REQUIREMENT_CATALOG: Record<
  EditableKind,
  {
    /** Written to `title`. The traveler reads this. */
    title: string;
    /** Written to `help_text`. The traveler reads this too. */
    helpText: string;
    reqType: 'upload' | 'acknowledge' | 'pay';
    /** Operator-facing wording — this site only ever shows these two. */
    operatorTitle: string;
    operatorSub: string;
  }
> = {
  deposit: {
    title: 'Deposit',
    helpText: 'Pay your deposit to confirm your place.',
    reqType: 'pay',
    operatorTitle: 'Deposit',
    operatorSub: 'A first payment when they join.',
  },
  balance: {
    title: 'Final payment',
    helpText: 'The rest of your trip cost.',
    reqType: 'pay',
    operatorTitle: 'Final payment',
    operatorSub: 'The rest of the price, due before the trip starts.',
  },
  passport: {
    title: 'Passport',
    helpText: 'So your organiser can book your flights.',
    reqType: 'upload',
    operatorTitle: 'Passport',
    operatorSub: 'A photo of the passport page, so you can book flights.',
  },
  waiver: {
    title: 'Waiver',
    helpText: 'Read and agree to the trip waiver.',
    reqType: 'acknowledge',
    operatorTitle: 'Waiver',
    operatorSub: 'Travelers read your terms and agree by typing their name.',
  },
  medical: {
    title: 'Medical info',
    helpText: 'Allergies, diet, injuries and medication.',
    // ⚠️ 'upload', not 'acknowledge', and not a typo. The database resolves an
    // 'acknowledge' row by looking for an agreement the medical form never
    // writes, so it would wait forever. See the app's catalog for the full
    // branch order.
    reqType: 'upload',
    operatorTitle: 'Medical info',
    operatorSub: 'Allergies, diet, injuries, medication. A form, not a file.',
  },
  insurance: {
    title: 'Travel insurance',
    helpText: 'Your policy document or confirmation.',
    reqType: 'upload',
    operatorTitle: 'Travel insurance',
    operatorSub: 'Their policy document or confirmation. Photo or PDF.',
  },
  visa: {
    title: 'Visa',
    helpText: 'Proof of your visa or entry permit for this destination.',
    reqType: 'upload',
    operatorTitle: 'Visa',
    operatorSub: 'For destinations that need one. Photo or PDF.',
  },
  flights: {
    title: 'Flight details',
    helpText: 'Your ticket or booking confirmation, so the pickup can be planned.',
    reqType: 'upload',
    operatorTitle: 'Flight details',
    operatorSub: 'Their ticket or booking, so you can plan pickups.',
  },
};

/**
 * Where a kind starts when it is switched on.
 *
 * `skippable: false` decides ACCESS, not urgency: the must-have set IS the
 * wall between "approved" and "in the trip". A traveler holds no seat until
 * every must_have is satisfied. The split is "can they finish it right now,
 * alone?" — waiver, medical and deposit can be done in one sitting; insurance,
 * passports, flights and visas all need a third party.
 */
export const DEFAULT_TIMING: Record<EditableKind, { skippable: boolean; daysBefore: number }> = {
  waiver: { skippable: false, daysBefore: 30 },
  medical: { skippable: false, daysBefore: 30 },
  deposit: { skippable: false, daysBefore: 0 },
  insurance: { skippable: true, daysBefore: 30 },
  passport: { skippable: true, daysBefore: 30 },
  flights: { skippable: true, daysBefore: 14 },
  visa: { skippable: true, daysBefore: 21 },
  // Not part of onboarding: the rest of the money, due long after joining.
  // must_have carries NO deadline and skippable MUST carry one, so a pay row
  // that is meant to have a due date has to be skippable.
  balance: { skippable: true, daysBefore: 30 },
};

/** The reliable test for "is this a money row" — reads the catalog rather than
 *  hardcoding the two strings, so there is one place that knows. */
export const isPayKind = (kind: string): boolean =>
  REQUIREMENT_CATALOG[kind as EditableKind]?.reqType === 'pay';

export const isEditableKind = (kind: string): kind is EditableKind =>
  kind in REQUIREMENT_CATALOG;

/**
 * The requirements an operator may not switch OFF.
 *
 * Only the waiver, and not for a technical reason — it is the one agreement
 * the product has (there is no terms acceptance and no separate liability
 * form), so a trip running without it has no record of what anyone agreed to.
 *
 * ⚠️ Locks OFF, never ON. A trip whose waiver is already inactive still shows
 * under "Not asked for" with a working Add, so an operator can put it back.
 * Forcing it on instead would make every Save on such a trip silently
 * re-create a requirement they had deliberately removed.
 *
 * ⚠️ TWIN of `LOCKED_ON_KINDS` in the app's `CreateTripFlowA.tsx` and
 * `ManageRequirementsSheet.tsx`. All three have to agree, or "always on" is
 * only true on whichever screen the operator did not use.
 */
export const LOCKED_ON_KINDS: EditableKind[] = ['waiver'];

/** Said on the row, in place of the missing Remove button, so the absence
 *  explains itself where it is. */
export const LOCKED_ON_SUB: Partial<Record<EditableKind, string>> = {
  waiver: 'On every trip — it is the only record of what travelers agreed to.',
};

/**
 * Kinds whose TIMING is not the operator's to set, and what it is pinned to.
 *
 * `deposit` only. It is the WALL: a must_have with no deadline, paid inside
 * onboarding, and nobody becomes a member without it
 * (`activate_trip_membership`). Making it skippable does not move a date, it
 * removes the wall — and `freeze_traveler_price` / `operator_trip_full_payment_due`
 * (migration 20260817000000) exist ONLY because the balance is skippable and
 * the deposit is not. A skippable deposit lets a traveler leave onboarding a
 * full member having paid nothing, holding a seat, owing the whole price.
 *
 * `balance` is deliberately NOT here — it is the rest of the money, due long
 * after joining, and its deadline is the operator's whole point.
 *
 * ⚠️ TWIN of `LOCKED_TIMING` in the app's
 * `src/services/trips/tripDocumentsService.ts`.
 */
export const LOCKED_TIMING: Partial<
  Record<EditableKind, { skippable: boolean; daysBefore: number }>
> = {
  deposit: { skippable: false, daysBefore: 0 },
};

/** What actually gets written for a kind: the pinned timing when there is one,
 *  otherwise what the operator chose. Applied on the write path as well as in
 *  the UI, so a stale editor tab cannot slip a skippable deposit through. */
export function resolveTiming<T extends { skippable: boolean; daysBefore: number }>(
  kind: string,
  chosen: T,
): T | { skippable: boolean; daysBefore: number } {
  return LOCKED_TIMING[kind as EditableKind] ?? chosen;
}
