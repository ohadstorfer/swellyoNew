/**
 * Requirement state derivation.
 *
 * "Done" is never stored anywhere. It is always worked out from the evidence:
 * a document row, an agreement row, or a completed medical form.
 *
 * This is a PORT of the logic that already exists twice in the mobile app —
 * once in the `operator_trip_my_requirements` SQL function and again in
 * `fetchTripReview()` (swellyoNative/src/services/trips/tripDocumentsService.ts).
 *
 * THE BRANCH ORDER IS LOAD-BEARING. `acknowledge` is tested before `medical`,
 * exactly as the database does it. Reordering these makes this site disagree
 * with the app about what "done" means, which is worse than being wrong —
 * it is being wrong in only some places.
 *
 * Known debt: three copies of one rule is a smell. The proper fix is the
 * `operator_trip_requirement_matrix` RPC, which was specced but never applied.
 * See docs/SPEC.md §6.
 */

export type RequirementState =
  | 'not_started'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'overdue';

export type RequirementKind =
  | 'passport'
  | 'waiver'
  | 'medical'
  | 'insurance'
  | 'visa'
  | 'flights'
  | (string & {});

/** `pay` exists in the database but has no UI here — there is no ledger yet. */
export type RequirementType = 'upload' | 'acknowledge' | 'fill' | 'pay';

export type Requirement = {
  id: string;
  kind: RequirementKind;
  reqType: RequirementType;
  title: string;
  dueDate: string | null;
  sortOrder: number;
  /** 'must_have' | a deadline flavour. Drives ordering, not state. */
  skipAtOnboarding: string | null;
};

export type DocumentRow = {
  id: string;
  userId: string;
  requirementId: string;
  storagePath: string | null;
  uploadedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  note: string | null;
  /** Past the 30-day purge the row outlives the file. */
  fileDeletedAt: string | null;
};

export type AcknowledgementRow = {
  userId: string;
  requirementId: string;
  agreedAt: string | null;
  operatorDocumentId: string | null;
};

export type MedicalRow = {
  userId: string;
  completedAt: string | null;
};

export type Evidence = {
  doc?: DocumentRow | null;
  ack?: AcknowledgementRow | null;
  medical?: MedicalRow | null;
  /** The trip's CURRENT waiver version. An older agreement does not count. */
  currentWaiverId?: string | null;
};

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Deliberately not `toISOString()` — that is UTC, which marks a deadline
 * overdue up to a day early for anyone west of Greenwich.
 */
export function todayISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Work out one requirement's state for one traveler.
 *
 * Overdue only ever applies when there is NO evidence. Something submitted
 * late is still submitted — the operator needs to review it either way, and
 * flagging it red helps nobody.
 */
export function deriveState(
  req: Requirement,
  evidence: Evidence,
  today: string,
): RequirementState {
  const overdue = !!req.dueDate && req.dueDate < today;

  // 1. Agreements (waiver, and any custom "I agree" item).
  if (req.reqType === 'acknowledge') {
    const ack = evidence.ack;
    // A waiver agreement only counts against the CURRENT version. Publishing
    // a v2 makes everyone who only signed v1 show as outstanding again.
    const counts =
      !!ack &&
      (req.kind !== 'waiver' ||
        ack.operatorDocumentId === evidence.currentWaiverId);
    return counts ? 'approved' : overdue ? 'overdue' : 'not_started';
  }

  // 2. The medical form. Keyed on KIND, not reqType — matches the app.
  if (req.kind === 'medical') {
    return evidence.medical?.completedAt
      ? 'approved'
      : overdue
        ? 'overdue'
        : 'not_started';
  }

  // 3. Everything else is an upload.
  const doc = evidence.doc;
  if (!doc) return overdue ? 'overdue' : 'not_started';
  if (doc.rejectedAt) return 'rejected';
  if (doc.approvedAt) return 'approved';
  return 'submitted';
}

/**
 * Does this requirement ever produce a FILE?
 *
 * This is NOT the same question as `reqType === 'upload'`, and the difference
 * is not hypothetical: the trip "El Salvador 26" has a requirement with
 * `kind = 'medical'` and `req_type = 'upload'` at the same time.
 *
 * `deriveState` treats any `kind = 'medical'` as the medical FORM, so such a
 * requirement can never carry a document. Any screen that decides "show upload
 * controls" must ask THIS, or it renders View / Export / Approve buttons for
 * something that will never have a file behind it.
 */
export function isUploadRequirement(req: {
  kind: string;
  reqType: string;
}): boolean {
  return req.reqType !== 'acknowledge' && req.kind !== 'medical';
}

/** Sort order the traveler sees: must-haves first, then by deadline. */
export function compareRequirements(a: Requirement, b: Requirement): number {
  return (
    Number(a.skipAtOnboarding !== 'must_have') -
      Number(b.skipAtOnboarding !== 'must_have') ||
    String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')) ||
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
}

/** Human label for a state. Kept here so every screen agrees on wording. */
export const STATE_LABEL: Record<RequirementState, string> = {
  not_started: 'Not started',
  submitted: 'Waiting for you',
  approved: 'Approved',
  rejected: 'Rejected',
  overdue: 'Overdue',
};
