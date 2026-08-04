import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { supabase } from '../../config/supabase';
import { compressImage } from '../../utils/imageCompression';

/**
 * Traveler documents on organized (operator) trips — v1: passport image only,
 * no text extraction.
 *
 * Spec: docs/specs/operator-trips/passport-upload-v1.md
 *
 * Three things about this file are load-bearing:
 *
 * 1. The bucket is PRIVATE. There is no public URL and never will be. Reads go
 *    through `getViewUrl()`, which mints a ~60 second signed URL per view. Do
 *    not cache what it returns — not in react-query, not in state that outlives
 *    the screen, not in AsyncStorage. A signed URL is a bearer token.
 * 2. Live table names are `organized_trip_*` (renamed 2026-07-24). The bucket is
 *    still `group-trip-documents` — that mismatch is deliberate, not a bug.
 * 3. Every image is re-encoded to JPEG on the device before upload. That is what
 *    converts HEIC, caps the size, and drops EXIF (including the GPS of wherever
 *    the passport was photographed — usually someone's home).
 */

const BUCKET = 'group-trip-documents';

/** Keeps the two MRZ lines legible. Also a v2 dependency: the scanner will read
 *  these same files, so compressing harder later breaks every passport already
 *  uploaded. See spec §5.5. */
const MAX_DIMENSION = 2200;
const JPEG_QUALITY = 0.85;

/** Signed URLs live about a minute. Every other bucket in this app signs for an
 *  hour; documents deliberately do not. */
const SIGNED_URL_TTL_SECONDS = 60;

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
  | 'deposit'
  | 'balance';

/** What the traveler actually does. Drives which screen opens. */
export type RequirementAction = 'upload' | 'agree' | 'medical' | 'pay';

/**
 * One catalog for all six kinds, used by the operator wizard AND the traveler
 * Plan card, so the two sides can never disagree about what a kind means.
 *
 * ⚠️ `reqType` for `medical` is `'upload'`, and that is NOT a mistake.
 * `operator_trip_my_requirements` resolves state in this order:
 *
 *     when req_type = 'pay'         -> pay state
 *     when req_type = 'acknowledge' -> looks for a group_trip_acknowledgements row
 *     when kind     = 'medical'     -> looks at organized_trip_medical_forms.completed_at
 *     ...
 *
 * The `acknowledge` branch is tested BEFORE the `medical` branch. Giving medical
 * `req_type = 'acknowledge'` therefore sends it down the acknowledgement path,
 * where it waits forever for a row the medical form never writes. `'upload'`
 * falls through to the `kind = 'medical'` branch, which is the one that works.
 */
export const REQUIREMENT_CATALOG: Record<
  RequirementKind,
  {
    /** Row label the traveler reads. */
    title: string;
    helpText: string;
    reqType: 'upload' | 'acknowledge' | 'pay';
    action: RequirementAction;
    /** Upload kinds only — whether a PDF is accepted alongside a photo. */
    allowPdf: boolean;
    /** Operator-facing copy on the wizard step. */
    operatorTitle: string;
    operatorSub: string;
  }
> = {
  passport: {
    title: 'Passport',
    helpText: 'So your organiser can book your flights.',
    reqType: 'upload',
    action: 'upload',
    // A passport is a photo of a page. Keeping it image-only keeps the viewer
    // simple and keeps the file readable for the v2 scanner.
    allowPdf: false,
    operatorTitle: 'Passport',
    operatorSub: 'A photo of the passport page, so you can book flights.',
  },
  visa: {
    title: 'Visa',
    helpText: 'Proof of your visa or entry permit for this destination.',
    reqType: 'upload',
    action: 'upload',
    allowPdf: true,
    operatorTitle: 'Visa',
    operatorSub: 'For destinations that need one. Photo or PDF.',
  },
  insurance: {
    title: 'Travel insurance',
    helpText: 'Your policy document or confirmation.',
    reqType: 'upload',
    action: 'upload',
    allowPdf: true,
    operatorTitle: 'Travel insurance',
    operatorSub: 'Their policy document or confirmation. Photo or PDF.',
  },
  flights: {
    title: 'Flight details',
    helpText: 'Your ticket or booking confirmation, so the pickup can be planned.',
    reqType: 'upload',
    action: 'upload',
    allowPdf: true,
    operatorTitle: 'Flight details',
    operatorSub: 'Their ticket or booking, so you can plan pickups.',
  },
  waiver: {
    title: 'Waiver',
    helpText: 'Read and agree to the trip waiver.',
    reqType: 'acknowledge',
    action: 'agree',
    allowPdf: false,
    operatorTitle: 'Waiver',
    operatorSub: 'Travelers read your terms and agree by typing their name.',
  },
  medical: {
    title: 'Medical info',
    helpText: 'Allergies, diet, injuries and medication.',
    // See the warning above — 'upload' is load-bearing, not a typo.
    reqType: 'upload',
    action: 'medical',
    allowPdf: false,
    operatorTitle: 'Medical info',
    operatorSub: 'Allergies, diet, injuries, medication. A form, not a file.',
  },
  deposit: {
    title: 'Deposit',
    helpText: 'Pay your deposit to confirm your place.',
    // 'pay' routes state resolution straight to the ledger — see
    // operator_requirement_pay_state(). No document, no acknowledgement.
    reqType: 'pay',
    action: 'pay',
    allowPdf: false,
    operatorTitle: 'Deposit',
    operatorSub: 'A first payment when they join. Leave the amount blank for one single payment.',
  },
  balance: {
    title: 'Final payment',
    helpText: 'The rest of your trip cost.',
    reqType: 'pay',
    action: 'pay',
    allowPdf: false,
    operatorTitle: 'Final payment',
    operatorSub: 'The rest of the price, due before the trip starts.',
  },
};

/** Wizard order. Passport first because it is the reason operators can book. */
export const REQUIREMENT_ORDER: RequirementKind[] = [
  'deposit',
  'balance',
  'passport',
  'waiver',
  'medical',
  'insurance',
  'visa',
  'flights',
];

/** What the traveler must do for a requirement row, or null for kinds we do not
 *  handle (a `custom` item, or a `pay` requirement once payments land). */
export function actionForRequirement(r: {
  kind: string;
  reqType: string;
}): RequirementAction | null {
  const entry = REQUIREMENT_CATALOG[r.kind as RequirementKind];
  if (!entry) return null;
  return entry.action;
}

export type TripRequirement = {
  requirementId: string;
  kind: string;
  reqType: string;
  title: string;
  helpText: string | null;
  dueDate: string | null;
  state: RequirementState;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** The operator's note. On a rejection this is why. */
  note: string | null;
  documentId: string | null;
};

export type TravelerDocument = {
  id: string;
  userId: string;
  requirementId: string;
  storagePath: string;
  uploadedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  note: string | null;
  fileDeletedAt: string | null;
};

// ---------------------------------------------------------------------------
// Traveler side
// ---------------------------------------------------------------------------

/**
 * Every requirement on this trip for the current user, with its derived state.
 * `operator_trip_my_requirements` does the work server-side — per-traveler state
 * is never stored, always derived from the evidence rows.
 */
export async function fetchMyRequirements(tripId: string): Promise<TripRequirement[]> {
  const { data, error } = await supabase.rpc('operator_trip_my_requirements', {
    p_trip_id: tripId,
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    requirementId: r.requirement_id,
    kind: r.kind,
    reqType: r.req_type,
    title: r.title,
    helpText: r.help_text ?? null,
    dueDate: r.due_date ?? null,
    state: (r.effective_state ?? 'not_started') as RequirementState,
    submittedAt: r.submitted_at ?? null,
    reviewedAt: r.reviewed_at ?? null,
    note: r.approbation_note ?? null,
    documentId: r.document_id ?? null,
  }));
}

/** Just the passport row, or null when this trip does not ask for one. Peer
 *  trips never do — a DB trigger refuses to create the requirement. */
export async function fetchMyPassportRequirement(
  tripId: string,
): Promise<TripRequirement | null> {
  const all = await fetchMyRequirements(tripId);
  return all.find(r => r.kind === 'passport') ?? null;
}

/** The current user's own document row for a requirement, if any. */
export async function fetchMyDocument(
  tripId: string,
  requirementId: string,
  userId: string,
): Promise<TravelerDocument | null> {
  const { data, error } = await supabase
    .from('organized_trip_travelers_documents')
    .select(
      'id, user_id, requirement_id, storage_path, uploaded_at, approved_at, rejected_at, approbation_note, file_deleted_at',
    )
    .eq('trip_id', tripId)
    .eq('requirement_id', requirementId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapDocument(data) : null;
}

/**
 * Upload (or replace) the traveler's document for a requirement.
 *
 * Order matters. The object goes up FIRST, then the row. A row pointing at a
 * file that never landed shows the traveler a broken "submitted" state, while a
 * file with no row is invisible and gets swept as an orphan — so if only one of
 * the two can exist, it must be the file.
 */
export async function uploadDocument(params: {
  tripId: string;
  requirementId: string;
  userId: string;
  /** Local file URI from the camera, the photo library, or the file picker. */
  localUri: string;
  /** True when the picked file is a PDF (visa / insurance / flights only). */
  isPdf?: boolean;
}): Promise<{ documentId: string; storagePath: string }> {
  const { tripId, requirementId, userId, localUri, isPdf = false } = params;

  // Replacing? Clear the old file and row first — a unique index allows only
  // one live document per (trip, traveler, requirement).
  const existing = await fetchMyDocument(tripId, requirementId, userId);
  if (existing) {
    await deleteDocument(existing);
  }

  // Images are re-encoded to JPEG: one call converts HEIC, caps the longest
  // edge, and drops EXIF. A PDF is uploaded untouched — there is nothing to
  // re-encode, and a PDF carries no camera GPS.
  const uploadUri = isPdf
    ? localUri
    : await compressImage(localUri, { maxDimension: MAX_DIMENSION, quality: JPEG_QUALITY });

  // The key must match the storage policy's regex exactly:
  //   ^<uuid>/<uuid>/<uuid>\.(jpg|jpeg|png|heic|pdf)$
  const documentId = Crypto.randomUUID();
  const ext = isPdf ? 'pdf' : 'jpg';
  const contentType = isPdf ? 'application/pdf' : 'image/jpeg';
  const storagePath = `${tripId}/${userId}/${documentId}.${ext}`;

  const body = await toUploadBody(uploadUri, contentType);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType, upsert: false });
  if (upErr) throw upErr;

  const byteSize = await byteSizeOf(uploadUri);

  const { error: rowErr } = await supabase
    .from('organized_trip_travelers_documents')
    .insert({
      id: documentId,
      trip_id: tripId,
      user_id: userId,
      requirement_id: requirementId,
      storage_path: storagePath,
      mime_type: contentType,
      byte_size: byteSize,
    });

  if (rowErr) {
    // Do not leave an unreferenced object behind: nothing but the orphan sweep
    // would ever look at it again.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw rowErr;
  }

  return { documentId, storagePath };
}

/**
 * A short-lived signed URL for one view.
 *
 * NEVER persist the result. Mint a new one if the viewer outlives it.
 */
export async function getViewUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('could not open this document');
  return data.signedUrl;
}

/** Remove the object and its row. Used by the traveler ("remove") and when
 *  replacing an existing upload. */
export async function deleteDocument(doc: {
  id: string;
  storagePath: string;
}): Promise<void> {
  if (doc.storagePath) {
    const { error } = await supabase.storage.from(BUCKET).remove([doc.storagePath]);
    // A missing object is fine — the row still has to go.
    if (error) console.warn('[tripDocuments] object remove failed, deleting row anyway');
  }
  const { error: rowErr } = await supabase
    .from('organized_trip_travelers_documents')
    .delete()
    .eq('id', doc.id);
  if (rowErr) throw rowErr;
}

// ---------------------------------------------------------------------------
// Requirement authoring (operator)
// ---------------------------------------------------------------------------

/**
 * Create the selected requirements for a trip. Called once, from the create-trip
 * wizard's Requirements step, right after the trip row exists.
 *
 * `must_have` is paired with a null deadline on purpose: the table's
 * `group_trip_req_deadline_rule` CHECK requires exactly that pairing
 * (`skippable` must carry a deadline, `must_have` must not).
 *
 * A `passport` row will be REFUSED by `trg_passport_requires_operator_trip`
 * unless the trip is `hosting_style = 'C'`. That is the point — the wizard only
 * shows the step on Flow C, and the database is what guarantees it.
 */
export type RequirementTiming = {
  /** false = must-have during onboarding (no Skip button, no deadline).
   *  true  = skippable, with a deadline relative to departure. */
  skippable: boolean;
  /** Days before departure. Only written when `skippable`. */
  daysBefore: number;
};

export async function createRequirements(
  tripId: string,
  kinds: RequirementKind[],
  timing: Record<string, RequirementTiming>,
): Promise<void> {
  if (kinds.length === 0) return;
  const rows = kinds.map(kind => {
    const c = REQUIREMENT_CATALOG[kind];
    const t = timing[kind] ?? DEFAULT_TIMING[kind];
    return {
      trip_id: tripId,
      kind,
      req_type: c.reqType,
      // The pairing is enforced by `group_trip_req_deadline_rule`: skippable
      // MUST carry a deadline, must_have MUST NOT. Sending both, or neither,
      // is a 23514 at insert time.
      skip_at_onboarding: t.skippable ? 'skippable' : 'must_have',
      deadline_days_before: t.skippable ? Math.max(0, Math.round(t.daysBefore)) : null,
      title: c.title,
      help_text: c.helpText,
      // Keep the catalog's order, so every trip lists requirements the same way.
      sort_order: REQUIREMENT_ORDER.indexOf(kind),
      is_active: true,
    };
  });
  const { error } = await supabase.from('organized_trip_requirements').insert(rows);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Operator side — changing what the trip asks for, after publish
//
// The wizard writes requirements once and never looks at them again. Everything
// below exists so an operator who forgot to tick "Travel insurance" is not stuck
// with that trip forever.
//
// No migration was needed: `organized_trip_req_write` is a FOR ALL policy on
// `is_trip_host(trip_id)`, so a host can already insert, update and delete their
// own trip's requirements.
// ---------------------------------------------------------------------------

/** A requirement as the operator edits it — the stored shape, not the traveler's
 *  derived state. `isActive: false` rows are included on purpose (see
 *  `saveRequirementChanges`). */
export type EditableRequirement = {
  id: string;
  kind: string;
  reqType: string;
  title: string;
  skippable: boolean;
  daysBefore: number;
  isActive: boolean;
};

/**
 * Every requirement row on the trip, active or not.
 *
 * Deliberately NOT `operator_trip_my_requirements`: that RPC resolves the
 * CALLER's state and hides inactive rows, and neither is what an editor needs.
 * This reads the table straight, which the host's RLS already allows.
 */
export async function fetchTripRequirements(
  tripId: string,
): Promise<EditableRequirement[]> {
  const { data, error } = await supabase
    .from('organized_trip_requirements')
    .select('id, kind, req_type, title, skip_at_onboarding, deadline_days_before, is_active')
    .eq('trip_id', tripId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id as string,
    kind: r.kind as string,
    reqType: r.req_type as string,
    title: r.title as string,
    skippable: r.skip_at_onboarding === 'skippable',
    // A must_have row has no stored deadline. Show the catalog default so the
    // stepper starts somewhere sensible the moment they switch to "They can
    // skip" — a stepper that opens on 0 reads as "due today".
    daysBefore:
      (r.deadline_days_before as number | null) ??
      DEFAULT_TIMING[r.kind as RequirementKind]?.daysBefore ??
      30,
    isActive: r.is_active as boolean,
  }));
}

/** How the timing pair must be written. The `organized_trip_req_deadline_rule`
 *  CHECK requires exactly this pairing, so the two columns always move together
 *  — writing one without the other is a 23514. */
function timingColumns(t: RequirementTiming) {
  return {
    skip_at_onboarding: t.skippable ? 'skippable' : 'must_have',
    deadline_days_before: t.skippable ? Math.max(0, Math.round(t.daysBefore)) : null,
  };
}

/**
 * Turning a requirement OFF.
 *
 * Hard delete ONLY when nothing has been sent for it. The FKs from
 * `organized_trip_travelers_documents` and `group_trip_acknowledgements` are
 * ON DELETE CASCADE, and `purge-group-documents` finds files to delete by
 * walking the documents table — so deleting a requirement someone had uploaded
 * to would drop the only pointer to their passport and strand the file in the
 * private bucket forever. It would also erase a waiver agreement, which is a
 * legal record of who agreed to what.
 *
 * Once there IS evidence, `is_active = false` is the delete: the resolved view,
 * the traveler RPC and the review screen all filter on it, so the requirement
 * disappears from every screen while the evidence and its purge clock survive.
 *
 * Returns which one happened, so the caller can say something true.
 */
export async function removeRequirement(
  requirementId: string,
): Promise<'deleted' | 'deactivated'> {
  const [docs, acks] = await Promise.all([
    supabase
      .from('organized_trip_travelers_documents')
      .select('id', { count: 'exact', head: true })
      .eq('requirement_id', requirementId),
    supabase
      .from('group_trip_acknowledgements')
      .select('user_id', { count: 'exact', head: true })
      .eq('requirement_id', requirementId),
  ]);
  if (docs.error) throw docs.error;
  if (acks.error) throw acks.error;

  // A failed count reads as null. Treat "we don't know" as "there is evidence" —
  // deactivating something empty is recoverable, cascading a real passport away
  // is not.
  const untouched = docs.count === 0 && acks.count === 0;

  if (untouched) {
    const { error } = await supabase
      .from('organized_trip_requirements')
      .delete()
      .eq('id', requirementId);
    if (error) throw error;
    return 'deleted';
  }

  const { error } = await supabase
    .from('organized_trip_requirements')
    .update({ is_active: false })
    .eq('id', requirementId);
  if (error) throw error;
  return 'deactivated';
}

/** What the editor wants the trip to ask for. One entry per kind the operator
 *  has switched on; anything absent is off. */
export type RequirementDraft = {
  kind: RequirementKind;
  timing: RequirementTiming;
};

/**
 * Apply an edited requirement list to a published trip.
 *
 * Diffed against `existing` rather than rewritten, because a requirement's id is
 * what every document, acknowledgement and notification points at. Deleting and
 * re-inserting the same six kinds would silently detach every passport already
 * uploaded.
 *
 * Three cases:
 *   - on, no row yet          -> insert
 *   - on, row exists          -> update timing (and revive it if it was off)
 *   - off, row exists         -> `removeRequirement`
 *
 * Reviving an inactive row instead of inserting a fresh one is what makes
 * "remove it, change your mind, add it back" restore the passports travelers had
 * already sent, instead of asking eight people to upload them a second time.
 *
 * Kinds outside `REQUIREMENT_CATALOG` (a hand-written `custom` row) are left
 * completely alone — the editor cannot show them, so it must not delete them.
 */
export async function saveRequirementChanges(
  tripId: string,
  existing: EditableRequirement[],
  draft: RequirementDraft[],
): Promise<void> {
  const byKind = new Map<string, EditableRequirement>();
  for (const r of existing) {
    if (!REQUIREMENT_CATALOG[r.kind as RequirementKind]) continue;
    // Two rows of the same kind should not exist, but if one ever does, the
    // active one is the one the travelers are looking at.
    const prev = byKind.get(r.kind);
    if (!prev || (r.isActive && !prev.isActive)) byKind.set(r.kind, r);
  }

  const wanted = new Map(draft.map(d => [d.kind as string, d.timing]));
  const inserts: any[] = [];

  for (const kind of REQUIREMENT_ORDER) {
    const row = byKind.get(kind);
    const timing = wanted.get(kind);

    if (timing && !row) {
      const c = REQUIREMENT_CATALOG[kind];
      inserts.push({
        trip_id: tripId,
        kind,
        req_type: c.reqType,
        ...timingColumns(timing),
        title: c.title,
        help_text: c.helpText,
        sort_order: REQUIREMENT_ORDER.indexOf(kind),
        is_active: true,
      });
      continue;
    }

    if (timing && row) {
      const unchanged =
        row.isActive &&
        row.skippable === timing.skippable &&
        (!timing.skippable || row.daysBefore === Math.max(0, Math.round(timing.daysBefore)));
      if (unchanged) continue;
      const { error } = await supabase
        .from('organized_trip_requirements')
        .update({ ...timingColumns(timing), is_active: true })
        .eq('id', row.id);
      if (error) throw error;
      continue;
    }

    if (!timing && row && row.isActive) {
      await removeRequirement(row.id);
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from('organized_trip_requirements').insert(inserts);
    if (error) throw error;
  }
}

/**
 * The deadline scale. Operators think in named intervals, not arbitrary numbers,
 * so the stepper snaps through these rather than adding a fixed number of days:
 * the gap that matters near departure (a day, three days) is not the gap that
 * matters months out.
 */
export const DEADLINE_STEPS = [1, 3, 7, 14, 21, 30, 60, 90, 120, 180, 365];

/**
 * Move one notch along the scale. A value that is not on the scale (an older
 * row, or a future edit screen) snaps to the nearest step first, so the control
 * can never get stuck between notches.
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
 * Default timing per kind.
 *
 * Passport and waiver are must-have: the workbench marks both as required parts
 * of onboarding (Ohad, 22 Jul). The rest are skippable with a deadline the
 * operator can move — travelers routinely buy insurance and book flights after
 * they have committed to the trip.
 *
 * "Must-have" means urgency, not access: since the deposit is what secures a
 * spot, joining never waits on documents. A must-have item is simply an
 * obligation with no Skip button.
 */
export const DEFAULT_TIMING: Record<RequirementKind, RequirementTiming> = {
  passport: { skippable: false, daysBefore: 30 },
  waiver: { skippable: false, daysBefore: 30 },
  medical: { skippable: true, daysBefore: 30 },
  insurance: { skippable: true, daysBefore: 30 },
  visa: { skippable: true, daysBefore: 21 },
  flights: { skippable: true, daysBefore: 14 },
  // must_have carries NO deadline and skippable MUST carry one —
  // organized_trip_req_deadline_rule raises 23514 on any other pairing.
  deposit: { skippable: false, daysBefore: 0 },
  balance: { skippable: true, daysBefore: 30 },
};

/**
 * The real date a deadline lands on, or null when the trip has no exact start
 * date yet (months-only trips).
 *
 * Mirrors `organized_trip_requirements_resolved`, which computes
 * `start_date - deadline_days_before`. Deadlines are stored relative to
 * departure on purpose: duplicating a trip or moving its dates keeps every
 * deadline correct, where absolute dates would silently break.
 */
export function resolveDeadlineDate(
  startDateISO: string | null,
  daysBefore: number,
): Date | null {
  if (!startDateISO) return null;
  const start = new Date(startDateISO);
  if (Number.isNaN(start.getTime())) return null;
  const due = new Date(start);
  due.setDate(due.getDate() - Math.max(0, Math.round(daysBefore)));
  return due;
}

/**
 * Publish the operator's waiver as a PDF.
 *
 * Must exist before travelers can agree: `operator_trip_my_requirements` only
 * counts an agreement whose `operator_document_id` matches the CURRENT waiver
 * version, so a waiver requirement with no waiver document can never reach
 * `approved`.
 *
 * The object goes under `<trip_id>/operator/<uuid>.pdf`. That prefix is
 * deliberate: the storage policy lets any host WRITE there and any host or
 * participant READ it (travelers must be able to open the waiver), and the
 * nightly purge skips operator materials entirely — the waiver is the only
 * record of what someone agreed to, so it must outlive the 30-day file sweep.
 *
 * `document_hash` is computed HERE. The `trg_set_operator_document_hash`
 * trigger only hashes `body_text`; for a file it would leave the hash null, and
 * the hash is what proves the PDF a traveler agreed to is the PDF you still
 * hold.
 */
export async function publishWaiverPdf(
  tripId: string,
  localUri: string,
): Promise<string> {
  const { data: latest } = await supabase
    .from('organized_trip_operator_documents')
    .select('version')
    .eq('trip_id', tripId)
    .eq('kind', 'waiver')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const documentId = Crypto.randomUUID();
  // Must match the operator-materials policy regex exactly:
  //   ^<uuid>/operator/<uuid>\.(jpg|jpeg|png|heic|pdf)$
  const storagePath = `${tripId}/operator/${documentId}.pdf`;

  const body = await toUploadBody(localUri, 'application/pdf');
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType: 'application/pdf', upsert: false });
  if (upErr) throw upErr;

  const documentHash = await sha256OfFile(localUri);

  const { data, error } = await supabase
    .from('organized_trip_operator_documents')
    .insert({
      trip_id: tripId,
      kind: 'waiver',
      version: (latest?.version ?? 0) + 1,
      storage_path: storagePath,
      document_hash: documentHash,
    })
    .select('id')
    .single();

  if (error) {
    // Never leave an unreferenced waiver in the bucket — the purge skips this
    // prefix, so nothing would ever clean it up.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }
  return data.id as string;
}

/** SHA-256 of a local file, as lowercase hex. Hashes the real bytes, not a
 *  base64 rendering of them, so it matches what any other tool would compute. */
async function sha256OfFile(uri: string): Promise<string | null> {
  try {
    const FileSystem = require('expo-file-system/legacy');
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (e) {
    // A missing hash is survivable — the waiver still works, it just loses the
    // integrity proof. Losing the upload over it would not be.
    console.warn('[tripDocuments] could not hash the waiver file');
    return null;
  }
}

/** The current waiver for a trip, or null when none is published. */
export async function fetchWaiver(tripId: string): Promise<{
  id: string;
  version: number;
  bodyText: string | null;
  storagePath: string | null;
} | null> {
  const { data, error } = await supabase
    .from('organized_trip_operator_documents')
    .select('id, version, body_text, storage_path')
    .eq('trip_id', tripId)
    .eq('kind', 'waiver')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    version: data.version,
    bodyText: data.body_text ?? null,
    storagePath: data.storage_path ?? null,
  };
}

/**
 * Agree to a waiver. The RPC captures IP and user-agent server-side from the
 * request headers, so the client cannot forge them — this is the legal record
 * of who agreed to which version (ESIGN/UETA).
 */
export async function acknowledgeRequirement(
  requirementId: string,
  fullName: string,
): Promise<void> {
  const { error } = await supabase.rpc('operator_requirement_acknowledge', {
    p_requirement_id: requirementId,
    p_full_name: fullName.trim(),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Medical form
// ---------------------------------------------------------------------------

export type MedicalForm = {
  id?: string;
  allergies: string;
  allergiesNone: boolean;
  dietary: string;
  dietaryNone: boolean;
  injuries: string;
  injuriesNone: boolean;
  medications: string;
  medicationsNone: boolean;
  completedAt: string | null;
};

export const EMPTY_MEDICAL_FORM: MedicalForm = {
  allergies: '',
  allergiesNone: false,
  dietary: '',
  dietaryNone: false,
  injuries: '',
  injuriesNone: false,
  medications: '',
  medicationsNone: false,
  completedAt: null,
};

export async function fetchMyMedicalForm(
  tripId: string,
  userId: string,
): Promise<MedicalForm | null> {
  const { data, error } = await supabase
    .from('organized_trip_medical_forms')
    .select(
      'id, allergies, allergies_none, dietary, dietary_none, injuries, injuries_none, medications, medications_none, completed_at',
    )
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    allergies: data.allergies ?? '',
    allergiesNone: !!data.allergies_none,
    dietary: data.dietary ?? '',
    dietaryNone: !!data.dietary_none,
    injuries: data.injuries ?? '',
    injuriesNone: !!data.injuries_none,
    medications: data.medications ?? '',
    medicationsNone: !!data.medications_none,
    completedAt: data.completed_at ?? null,
  };
}

/**
 * Save the medical form and mark it complete.
 *
 * Select-then-insert-or-update rather than upsert: there is no unique index on
 * (trip_id, user_id), so `upsert` has no conflict target to work with and would
 * quietly insert a second row.
 */
export async function saveMedicalForm(
  tripId: string,
  userId: string,
  form: MedicalForm,
): Promise<void> {
  const payload = {
    allergies: form.allergiesNone ? null : form.allergies.trim() || null,
    allergies_none: form.allergiesNone,
    dietary: form.dietaryNone ? null : form.dietary.trim() || null,
    dietary_none: form.dietaryNone,
    injuries: form.injuriesNone ? null : form.injuries.trim() || null,
    injuries_none: form.injuriesNone,
    medications: form.medicationsNone ? null : form.medications.trim() || null,
    medications_none: form.medicationsNone,
    completed_at: new Date().toISOString(),
  };

  const existing = await fetchMyMedicalForm(tripId, userId);
  if (existing?.id) {
    const { error } = await supabase
      .from('organized_trip_medical_forms')
      .update(payload)
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('organized_trip_medical_forms')
    .insert({ trip_id: tripId, user_id: userId, ...payload });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Host side
// ---------------------------------------------------------------------------

/** Every traveler's document for one requirement on this trip. RLS returns
 *  nothing useful unless the caller is a host. */
export async function fetchDocumentsForReview(
  tripId: string,
  requirementId: string,
): Promise<TravelerDocument[]> {
  const { data, error } = await supabase
    .from('organized_trip_travelers_documents')
    .select(
      'id, user_id, requirement_id, storage_path, uploaded_at, approved_at, rejected_at, approbation_note, file_deleted_at',
    )
    .eq('trip_id', tripId)
    .eq('requirement_id', requirementId)
    .order('uploaded_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapDocument);
}

/**
 * Everything the host needs to review this trip, in one round trip.
 *
 * Built entirely from plain table reads — no RPC, no new migration. The four
 * tables below already let a host SELECT every row on their own trip
 * (`otd_select`, `ack_select`, `medical_operator_select`,
 * `organized_trip_req_select`), so the only thing missing was somewhere to
 * combine them.
 *
 * `userIds` comes from the caller's participant list rather than a join. The
 * screen already holds names and avatars for those people, so fetching them
 * again here would be a second round trip for data we have.
 *
 * The medical read deliberately selects ONLY `user_id, completed_at`. Whether
 * someone filled the form in is review state; what they wrote is not, and a
 * review list is the wrong place to be carrying anyone's allergies around.
 */
export type ReviewItem = {
  requirementId: string;
  kind: string;
  reqType: string;
  title: string;
  dueDate: string | null;
  state: RequirementState;
  /** Upload kinds only — null for a waiver or the medical form. */
  documentId: string | null;
  storagePath: string | null;
  submittedAt: string | null;
  note: string | null;
  /** Past the 30-day purge the row outlives the file. */
  fileDeleted: boolean;
};

export type TravelerReview = {
  userId: string;
  items: ReviewItem[];
  /** Uploads sitting at `submitted` — the number the host has to act on. */
  toReview: number;
  done: number;
  total: number;
};

export type TripReview = {
  travelers: TravelerReview[];
  totalToReview: number;
};

export async function fetchTripReview(
  tripId: string,
  userIds: string[],
): Promise<TripReview> {
  if (userIds.length === 0) return { travelers: [], totalToReview: 0 };

  const [reqRes, docRes, ackRes, medRes, waiver] = await Promise.all([
    supabase
      .from('organized_trip_requirements_resolved')
      .select('id, kind, req_type, title, due_date, sort_order, skip_at_onboarding')
      .eq('trip_id', tripId)
      .eq('is_active', true),
    supabase
      .from('organized_trip_travelers_documents')
      .select(
        'id, user_id, requirement_id, storage_path, uploaded_at, approved_at, rejected_at, approbation_note, file_deleted_at',
      )
      .eq('trip_id', tripId),
    supabase
      .from('group_trip_acknowledgements')
      .select('user_id, requirement_id, agreed_at, operator_document_id')
      .eq('trip_id', tripId),
    supabase
      .from('organized_trip_medical_forms')
      .select('user_id, completed_at')
      .eq('trip_id', tripId),
    fetchWaiver(tripId),
  ]);

  if (reqRes.error) throw reqRes.error;
  if (docRes.error) throw docRes.error;
  if (ackRes.error) throw ackRes.error;
  if (medRes.error) throw medRes.error;

  const requirements = (reqRes.data ?? [])
    .sort(
      (a: any, b: any) =>
        // Same order the traveler sees: must-haves first, then by deadline.
        Number(a.skip_at_onboarding !== 'must_have') -
          Number(b.skip_at_onboarding !== 'must_have') ||
        String(a.due_date ?? '').localeCompare(String(b.due_date ?? '')) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );

  const docs = docRes.data ?? [];
  const acks = ackRes.data ?? [];
  const medical = medRes.data ?? [];
  const today = todayISO();

  const travelers = userIds.map(userId => {
    const items: ReviewItem[] = requirements.map((r: any) => {
      const overdue = !!r.due_date && r.due_date < today;
      const base = {
        requirementId: r.id,
        kind: r.kind,
        reqType: r.req_type,
        title: r.title,
        dueDate: r.due_date ?? null,
      };

      // Pay rows resolve from the ledger, which fetchTripReview does not load.
      // Showing them as never-started would be a lie, so they read as
      // 'not_started' with no review action — the host sees money on the
      // traveler price sheet instead.
      if (r.req_type === 'pay') {
        return {
          ...base,
          state: 'not_started' as RequirementState,
          documentId: null,
          storagePath: null,
          submittedAt: null,
          note: null,
          fileDeleted: false,
        };
      }

      // Mirrors `operator_trip_my_requirements` branch for branch. The order of
      // these tests is load-bearing: `acknowledge` is checked BEFORE `medical`,
      // exactly as the RPC does, or the two sides would disagree about state.
      if (r.req_type === 'acknowledge') {
        const ack = acks.find(
          (a: any) =>
            a.requirement_id === r.id &&
            a.user_id === userId &&
            // A waiver agreement only counts against the CURRENT version.
            (r.kind !== 'waiver' || a.operator_document_id === waiver?.id),
        );
        return {
          ...base,
          state: (ack ? 'approved' : overdue ? 'overdue' : 'not_started') as RequirementState,
          documentId: null,
          storagePath: null,
          submittedAt: ack?.agreed_at ?? null,
          note: null,
          fileDeleted: false,
        };
      }

      if (r.kind === 'medical') {
        const m = medical.find((x: any) => x.user_id === userId);
        return {
          ...base,
          state: (m?.completed_at
            ? 'approved'
            : overdue
            ? 'overdue'
            : 'not_started') as RequirementState,
          documentId: null,
          storagePath: null,
          submittedAt: m?.completed_at ?? null,
          note: null,
          fileDeleted: false,
        };
      }

      const d = docs.find(
        (x: any) => x.requirement_id === r.id && x.user_id === userId,
      );
      const state: RequirementState = !d
        ? overdue
          ? 'overdue'
          : 'not_started'
        : d.rejected_at
        ? 'rejected'
        : d.approved_at
        ? 'approved'
        : 'submitted';

      return {
        ...base,
        state,
        documentId: d?.id ?? null,
        storagePath: d?.storage_path ?? null,
        submittedAt: d?.uploaded_at ?? null,
        note: d?.approbation_note ?? null,
        fileDeleted: !!d?.file_deleted_at,
      };
    });

    return {
      userId,
      items,
      toReview: items.filter(i => i.state === 'submitted').length,
      done: items.filter(i => i.state === 'approved').length,
      total: items.length,
    };
  });

  return {
    travelers,
    totalToReview: travelers.reduce((n, t) => n + t.toReview, 0),
  };
}

/** Local calendar date as YYYY-MM-DD. `toISOString()` would be UTC, which turns
 *  a deadline overdue up to a day early for anyone west of Greenwich. */
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function approveDocuments(
  documentIds: string[],
  note?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('operator_approve_documents', {
    p_document_ids: documentIds,
    p_note: note ?? null,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

/**
 * Reject: mark the row, then delete the file.
 *
 * The RPC keeps the row (carrying the note) and the host has the storage DELETE
 * policy, so the client removes the object. If that second step fails the row is
 * left rejected with `file_deleted_at` still null — which is exactly the
 * condition the nightly purge sweeps. So a failure here leaks nothing; it just
 * delays the delete. Never block the UI on it.
 */
export async function rejectDocument(
  doc: { id: string; storagePath: string },
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('operator_reject_document', {
    p_document_id: doc.id,
    p_note: note ?? null,
  });
  if (error) throw error;

  if (doc.storagePath) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([doc.storagePath]);
    if (rmErr) {
      console.warn('[tripDocuments] reject: file delete failed; the purge job will sweep it');
    }
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function mapDocument(row: any): TravelerDocument {
  return {
    id: row.id,
    userId: row.user_id,
    requirementId: row.requirement_id,
    storagePath: row.storage_path,
    uploadedAt: row.uploaded_at,
    approvedAt: row.approved_at ?? null,
    rejectedAt: row.rejected_at ?? null,
    note: row.approbation_note ?? null,
    fileDeletedAt: row.file_deleted_at ?? null,
  };
}

/**
 * Same shape as storageService: React Native's networking layer reads a file://
 * URI straight out of FormData, which avoids materialising the whole image in
 * JS memory. Web falls back to a Blob.
 */
async function toUploadBody(uri: string, contentType: string): Promise<Blob | FormData> {
  const isNativeFile =
    Platform.OS !== 'web' &&
    (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('ph://'));

  if (isNativeFile) {
    const formData = new FormData();
    const name = contentType === 'application/pdf' ? 'upload.pdf' : 'upload.jpg';
    formData.append('', { uri, name, type: contentType } as any);
    return formData;
  }

  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return res.blob();
  }

  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('could not read the selected image'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

/** Best-effort size for the metadata row. Never worth failing an upload over. */
async function byteSizeOf(uri: string): Promise<number> {
  try {
    if (Platform.OS === 'web') {
      const res = await fetch(uri);
      return (await res.blob()).size;
    }
    // `getInfoAsync` lives on the legacy entry point in expo-file-system v19
    // (SDK 54). Same import the rest of this repo uses.
    const FileSystem = require('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(uri);
    return info?.exists && 'size' in info ? info.size : 0;
  } catch {
    return 0;
  }
}
