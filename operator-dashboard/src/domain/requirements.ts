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
  /** Days before departure, as STORED. Null on a must_have row, which carries
   *  no deadline at all — `dueDate` is null there too. This is the number the
   *  editor's stepper moves; `dueDate` is what it resolves to. */
  deadlineDaysBefore: number | null;
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

/* ───────────────────────────────────────────────────────────────────────────
 * Editing deadlines
 *
 * Spec: docs/specs/operator-trips/deadline-editing.md
 *
 * ⚠️ EVERYTHING BELOW IS A TWIN of the app's
 * `src/services/trips/tripDocumentsService.ts`. The two projects share no code
 * — separate package.json, and this one is blocked in the app's
 * metro.config.js on purpose — so the rule is written twice. Same pattern as
 * `src/domain/operatorSetup.ts`. If one changes, change the other: an operator
 * who edits the same trip on their phone and here must be allowed to save
 * exactly the same things.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The deadline scale. Operators think in named intervals, not arbitrary
 * numbers, so the stepper snaps through these rather than adding a fixed
 * count of days: the gap that matters near departure (a day, three days) is
 * not the gap that matters months out.
 */
export const DEADLINE_STEPS = [1, 3, 7, 14, 21, 30, 60, 90, 120, 180, 365];

/**
 * Move one notch along the scale. A value that is not on the scale — an older
 * row, or one written before the scale existed — snaps to the nearest step
 * first, so the control can never get stuck between notches.
 */
export function stepDeadline(current: number, direction: 1 | -1): number {
  let idx = DEADLINE_STEPS.indexOf(current);
  if (idx === -1) {
    idx = DEADLINE_STEPS.reduce(
      (best, v, i) =>
        Math.abs(v - current) < Math.abs(DEADLINE_STEPS[best] - current) ? i : best,
      0,
    );
    // Already snapped — that move counts as the step.
    if (DEADLINE_STEPS[idx] !== current) return DEADLINE_STEPS[idx];
  }
  const next = Math.min(DEADLINE_STEPS.length - 1, Math.max(0, idx + direction));
  return DEADLINE_STEPS[next];
}

/** True when the value sits at an end of the scale — used to disable a button
 *  rather than let it silently do nothing. */
export function isDeadlineAtEnd(current: number, direction: 1 | -1): boolean {
  const idx = DEADLINE_STEPS.indexOf(current);
  if (idx === -1) return false;
  return direction === -1 ? idx === 0 : idx === DEADLINE_STEPS.length - 1;
}

/**
 * The real date a deadline lands on, as `YYYY-MM-DD`, or null when the trip
 * has no exact start date (a months-only trip).
 *
 * Deadlines are stored RELATIVE to departure on purpose: duplicating a trip or
 * moving its dates keeps every deadline correct, where absolute dates would
 * silently break.
 *
 * Strings throughout, never `new Date(iso)`. A bare `YYYY-MM-DD` parses as UTC
 * midnight, which west of Greenwich is the evening before — the app carried
 * that bug and rendered every deadline a day early for operators in the
 * Americas. Working in local calendar strings makes it unrepresentable here.
 */
export function resolveDeadlineISO(
  startDateISO: string | null,
  daysBefore: number,
): string | null {
  if (!startDateISO) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDateISO);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - Math.max(0, Math.round(daysBefore)));
  return todayISO(d);
}

/**
 * Must this step be refused?
 *
 * The rule: **an operator may not SET a deadline that has already gone.** Not
 * a warning — the button is dead, here and in the app.
 *
 * ⚠️ MIND THE DIRECTION. The scale is DAYS BEFORE DEPARTURE, so it runs
 * backwards against the calendar: `+1` means MORE days before, which is an
 * EARLIER date. Only `+1` is ever refused.
 *
 * `-1` is ALWAYS allowed, and that is policy rather than arithmetic. Fewer
 * days before is a later date, so it always moves a deadline toward the
 * future — but it does not always reach it. On a trip ten days out, a
 * deadline standing at 365 days before is deep in the past, and stepping down
 * to 180 is still in the past. Refusing that step because the result is also
 * historic would leave BOTH buttons dead and the operator unable to fix the
 * very row they came to fix. A step that improves things is never blocked,
 * even when it does not finish the job.
 *
 * False when the trip has no start date, and false at the ends of the scale —
 * a step that cannot move is `isDeadlineAtEnd`'s business, and answering
 * "true" here would disable the button for the wrong reason.
 *
 * TWIN: `deadlineStepBlocked` in the app's `tripDocumentsService.ts`.
 */
export function deadlineStepBlocked(
  current: number,
  direction: 1 | -1,
  startDateISO: string | null,
  today: string = todayISO(),
): boolean {
  if (direction === -1) return false;
  if (!startDateISO) return false;
  const next = stepDeadline(current, direction);
  if (next === current) return false;
  const due = resolveDeadlineISO(startDateISO, next);
  if (!due) return false;
  return due < today;
}

/** What the editor holds for one requirement. `daysBefore` is meaningless
 *  while `skippable` is false — a must_have row stores no deadline — but it is
 *  kept so switching the pills back and forth does not lose the number. */
export type RequirementTiming = {
  skippable: boolean;
  daysBefore: number;
};
