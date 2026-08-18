/**
 * Paperwork asked of CREW, assigned one person at a time.
 *
 * The app's twin is `src/services/trips/staffRequirementsService.ts`. The copy
 * strings and the row shape below are deliberately identical to it: both write
 * into the same table, and an operator who ticks Passport on their phone and
 * again on the desktop must not end up looking at two different rows.
 *
 * ── The difference from traveler requirements, in one line ─────────────────
 * A traveler requirement applies to everyone who joins. A staff requirement
 * applies to nobody until it is assigned to a named person — because the
 * photographer flying in needs a visa and the local driver does not, and a list
 * that asks both is a list the operator learns to ignore.
 *
 * ── What this file is NOT ──────────────────────────────────────────────────
 * It is not a second requirements engine, and it is not a review queue. It
 * answers "who was asked for what, and did it arrive". Opening the file and
 * approving it is document review, which lives where document review lives.
 *
 * ── No deadline, no overdue ────────────────────────────────────────────────
 * Crew paperwork is FLAGGED, never gated. The operator hired this person and
 * knows the situation, and a countdown that locks the guide out two days before
 * departure is a worse outcome than the missing certificate.
 */
import { supabase } from '../lib/supabase';

/**
 * What crew can be asked for.
 *
 * `deposit` and `balance` are absent and cannot be added — the database refuses
 * a paying staff requirement from two directions at once
 * (`organized_trip_req_staff_never_pays` and `pay_kind_match`). `custom` is
 * absent because it needs a title typed by hand, which belongs in the trip's
 * requirement editor; an existing custom row still shows, see `extras` on the
 * component.
 */
export const STAFF_KINDS = [
  'passport',
  'visa',
  'waiver',
  'medical',
  'insurance',
  'flights',
] as const;

export type StaffKind = (typeof STAFF_KINDS)[number];

/**
 * What each kind is called when it is asked of CREW, and the line under it.
 *
 * Not the traveler catalog's copy: that is written to somebody buying a place
 * ("so your organiser can book your flights"), and this is read by the operator
 * deciding, then by the guide who works for them. It is also what gets written
 * onto the requirement row, so the wording the operator ticked is the wording
 * the crew member later reads.
 *
 * Copied verbatim from the app's STAFF_KIND_COPY. Change both or neither.
 */
export const STAFF_KIND_COPY: Record<StaffKind, { title: string; sub: string }> = {
  passport: { title: 'Passport', sub: 'A photo of the passport page.' },
  visa: { title: 'Visa', sub: 'Their entry permit for this destination.' },
  waiver: { title: 'Waiver', sub: 'They read your terms and agree by typing their name.' },
  medical: { title: 'Medical info', sub: 'Allergies, diet, injuries, medication.' },
  insurance: { title: 'Insurance', sub: 'Their policy document or confirmation.' },
  flights: { title: 'Flight details', sub: 'Their ticket, so you can plan the pickup.' },
};

/**
 * How each kind is stored. Only the waiver is something you AGREE to; the rest
 * are uploads — including `medical`, which is a form the app renders but a row
 * of `req_type = 'upload'` in the table. That is load-bearing, not a typo: it
 * matches the traveler catalog, and the two must agree or the same kind would
 * resolve differently depending on who was asked.
 */
const REQ_TYPE: Record<StaffKind, 'upload' | 'acknowledge'> = {
  passport: 'upload',
  visa: 'upload',
  waiver: 'acknowledge',
  medical: 'upload',
  insurance: 'upload',
  flights: 'upload',
};

/** A staff-audience requirement on a trip, and who currently has it. */
export type StaffRequirement = {
  requirementId: string;
  kind: string;
  reqType: string;
  title: string;
  helpText: string | null;
  /** `organized_trip_staff` row ids this requirement is assigned to. */
  assignedStaffIds: string[];
};

/**
 * Every staff-audience requirement on the trip, with its assignments.
 *
 * Two queries rather than a join, because the shape the UI wants (requirement →
 * the people who have it) is the opposite of what a join returns (one row per
 * pair), and the assignment table is tiny.
 */
export async function fetchStaffRequirements(tripId: string): Promise<StaffRequirement[]> {
  const { data: reqs, error: reqErr } = await supabase
    .from('organized_trip_requirements')
    .select('id, kind, req_type, title, help_text')
    .eq('trip_id', tripId)
    .eq('audience', 'staff')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (reqErr) throw reqErr;
  if (!reqs?.length) return [];

  const { data: assigns, error: assignErr } = await supabase
    .from('organized_trip_staff_requirements')
    .select('staff_id, requirement_id')
    .eq('trip_id', tripId);
  if (assignErr) throw assignErr;

  const byRequirement = new Map<string, string[]>();
  for (const a of assigns ?? []) {
    const key = a.requirement_id as string;
    const list = byRequirement.get(key);
    if (list) list.push(a.staff_id as string);
    else byRequirement.set(key, [a.staff_id as string]);
  }

  return (reqs as any[]).map(r => ({
    requirementId: r.id,
    kind: r.kind,
    reqType: r.req_type,
    title: r.title,
    helpText: r.help_text ?? null,
    assignedStaffIds: byRequirement.get(r.id) ?? [],
  }));
}

/**
 * The staff-audience requirement row for each of these kinds, creating any the
 * trip does not have yet. Returns the ids, in the order asked for.
 *
 * ── Why the operator ticks a KIND and not a row ────────────────────────────
 * Traveler requirements are built once, at publish, on a wizard step. Crew
 * paperwork is decided one person at a time, months later, in the middle of
 * inviting somebody — and an operator who has to leave this page, find the
 * trip's requirement editor, add "Passport (crew)" and come back has already
 * given up. So the crew screens offer the catalog directly and this turns a
 * tick into a row when one is needed.
 *
 * Existing rows win. Ticking Passport for a second guide reuses the first
 * guide's requirement rather than growing a duplicate — the assignment table is
 * what makes it personal, not the requirement.
 *
 * ⚠️ This can fail with 23505 on a trip that already asks TRAVELERS for the
 * same kind. `uq_organized_trip_req_kind_per_trip` is unique on
 * `(trip_id, kind)` and was never widened when `audience` was added, so one
 * trip cannot hold both a traveler passport and a crew passport. Every live
 * operator trip is in that state. See `friendlyStaffRequirementError`.
 */
export async function ensureStaffRequirements(
  tripId: string,
  kinds: StaffKind[],
): Promise<string[]> {
  if (!kinds.length) return [];

  const { data: existing, error } = await supabase
    .from('organized_trip_requirements')
    .select('id, kind')
    .eq('trip_id', tripId)
    .eq('audience', 'staff')
    .eq('is_active', true);
  if (error) throw error;

  const byKind = new Map<string, string>();
  for (const row of (existing ?? []) as any[]) {
    // First one wins — a trip with two active crew Passport rows is not a state
    // anything creates, and picking deterministically beats guessing.
    if (!byKind.has(row.kind)) byKind.set(row.kind, row.id);
  }

  const ids: string[] = [];
  for (const kind of kinds) {
    const found = byKind.get(kind);
    if (found) {
      ids.push(found);
      continue;
    }
    const { data, error: insErr } = await supabase
      .from('organized_trip_requirements')
      .insert({
        trip_id: tripId,
        kind,
        req_type: REQ_TYPE[kind],
        audience: 'staff',
        title: STAFF_KIND_COPY[kind].title,
        help_text: STAFF_KIND_COPY[kind].sub,
        // Crew paperwork has no deadline and no skip — see the file header. The
        // deadline_rule CHECK requires must_have to carry a null deadline.
        skip_at_onboarding: 'must_have',
        sort_order: 100,
        is_active: true,
      })
      .select('id')
      .single();
    if (insErr) throw insErr;
    byKind.set(kind, data.id as string);
    ids.push(data.id as string);
  }
  return ids;
}

/**
 * Ask this crew member for this requirement.
 *
 * `trip_id` is written explicitly even though a trigger checks it against both
 * parents: the RLS policies filter on it, and a policy that had to walk two
 * tables to find the trip would pay for that on every row read.
 *
 * Idempotent by way of the unique constraint — assigning twice is a no-op
 * rather than an error, because the UI is a tick box and double-clicks happen.
 */
export async function assignStaffRequirement(params: {
  tripId: string;
  staffId: string;
  requirementId: string;
}): Promise<void> {
  // Resolved here rather than passed in. `assigned_by` is an audit column — who
  // made this ask — and a caller that can pass it is a caller that can pass the
  // wrong one.
  const { data: auth } = await supabase.auth.getUser();
  const assignedBy = auth?.user?.id;
  if (!assignedBy) throw new Error('Not signed in');

  const { error } = await supabase.from('organized_trip_staff_requirements').upsert(
    {
      trip_id: params.tripId,
      staff_id: params.staffId,
      requirement_id: params.requirementId,
      assigned_by: assignedBy,
    },
    { onConflict: 'staff_id,requirement_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

/**
 * Stop asking.
 *
 * A hard delete, unlike revoking a crew member. The assignment is a live
 * instruction rather than a record of anything that happened — and if they had
 * already sent it, the document itself survives in
 * `organized_trip_travelers_documents`, which is where the evidence belongs.
 * Nobody else asked for the same thing is affected.
 */
export async function unassignStaffRequirement(
  staffId: string,
  requirementId: string,
): Promise<void> {
  const { error } = await supabase
    .from('organized_trip_staff_requirements')
    .delete()
    .eq('staff_id', staffId)
    .eq('requirement_id', requirementId);
  if (error) throw error;
}

/**
 * What has actually arrived, keyed `userId|requirementId`.
 *
 * Derived from the evidence rather than stored, exactly as the traveler side
 * derives it — and by the same three rules, in the same order:
 *
 *   • the waiver (and any `acknowledge` row) is done when they agreed
 *   • `medical` is done when the form is complete, NOT when a file exists —
 *     it is stored as an upload but answered as a form
 *   • everything else is done when a document row exists whose file is still
 *     there (`file_deleted_at` is null, so the 30-day purge does not silently
 *     turn a delivered passport back into a missing one... it does, and that is
 *     correct: the file really is gone)
 *
 * Binary on purpose. There is no approve or reject for crew paperwork yet, so
 * an "awaiting review" state would be a queue nobody can clear.
 */
export async function fetchStaffFulfilment(tripId: string): Promise<Set<string>> {
  const [docRes, ackRes, medRes] = await Promise.all([
    supabase
      .from('organized_trip_travelers_documents')
      .select('user_id, requirement_id, file_deleted_at')
      .eq('trip_id', tripId),
    supabase
      .from('group_trip_acknowledgements')
      .select('user_id, requirement_id')
      .eq('trip_id', tripId),
    supabase
      .from('organized_trip_medical_forms')
      .select('user_id, completed_at')
      .eq('trip_id', tripId),
  ]);
  if (docRes.error) throw docRes.error;
  if (ackRes.error) throw ackRes.error;
  if (medRes.error) throw medRes.error;

  const done = new Set<string>();
  for (const d of (docRes.data ?? []) as any[]) {
    if (!d.file_deleted_at) done.add(`${d.user_id}|${d.requirement_id}`);
  }
  for (const a of (ackRes.data ?? []) as any[]) {
    done.add(`${a.user_id}|${a.requirement_id}`);
  }
  // The medical form has no requirement_id of its own — it is one row per
  // person per trip — so it is folded in by the caller, which knows which
  // requirement is the medical one. Exposed as a separate set to keep that
  // honest rather than inventing a key here.
  const medicalDone = new Set<string>(
    ((medRes.data ?? []) as any[]).filter(m => m.completed_at).map(m => m.user_id as string),
  );
  // Stored under a reserved key that `isFulfilled` below knows how to read, so
  // the "medical is a form, not a file" rule lives in this file rather than in
  // whichever component happens to render the tick.
  for (const userId of medicalDone) done.add(`${userId}|${MEDICAL_KEY}`);

  return done;
}

const MEDICAL_KEY = 'medical-form';

/**
 * Has this person sent this? The only correct way to read the set above.
 *
 * Returns false for a Listed credit — no account means nobody who could have
 * sent anything.
 */
export function isFulfilled(
  done: Set<string>,
  userId: string | null,
  requirement: Pick<StaffRequirement, 'requirementId' | 'kind'>,
): boolean {
  if (!userId) return false;
  const key = requirement.kind === 'medical' ? MEDICAL_KEY : requirement.requirementId;
  return done.has(`${userId}|${key}`);
}

/**
 * Turn the one database error this page can realistically produce into a
 * sentence an operator can act on.
 *
 * The collision is real and it is not their fault: `audience` was added to
 * `organized_trip_requirements` without widening the `(trip_id, kind)` unique
 * index, so a trip that asks travelers for a passport cannot also ask crew for
 * one. Every operator trip on production is in that state today. Until the
 * index is widened, saying so beats "duplicate key value violates unique
 * constraint".
 */
export function friendlyStaffRequirementError(e: unknown): string | null {
  const code = (e as { code?: string } | null)?.code;
  const message = (e as { message?: string } | null)?.message ?? '';
  if (code === '23505' || message.includes('uq_organized_trip_req_kind_per_trip')) {
    return "This trip already asks travelers for the same document, and one trip can't ask for it twice yet. Ask a developer to widen uq_organized_trip_req_kind_per_trip.";
  }
  return null;
}
