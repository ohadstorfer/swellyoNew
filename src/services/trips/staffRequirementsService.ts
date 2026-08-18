/**
 * Paperwork asked of STAFF, assigned one person at a time.
 *
 * Spec: docs/staff-requirements-and-wallet-delivery-spec-and-plan.html, Part A.
 * Schema: supabase/migrations/20260812000200_staff_requirements.sql
 *
 * ── The difference from traveler requirements, in one line ──────────────────
 * A traveler requirement applies to everyone who joins. A staff requirement
 * applies to nobody until it is assigned to a named person — because the
 * photographer flying in needs a visa and the local driver does not, and a list
 * that asks both is a list the operator learns to ignore.
 *
 * ── What this file is NOT ───────────────────────────────────────────────────
 * It is not a second requirements engine. Fulfilment — uploading, agreeing,
 * approving — goes through `tripDocumentsService` exactly as it does for
 * travelers, against the same tables. Everything here is assignment: who was
 * asked for what.
 *
 * Nor does it gate anything. A traveler with unmet requirements cannot join the
 * trip; a guide with unmet paperwork is FLAGGED. The operator hired them and
 * knows the situation, and locking the guide out of the trip two days before
 * departure is a worse outcome than the missing certificate.
 */
import { supabase } from '../../config/supabase';
import { REQUIREMENT_CATALOG, type RequirementKind } from './tripDocumentsService';

/** Which audience a requirement row is written for. */
export type RequirementAudience = 'traveler' | 'staff';

/**
 * What staff can be asked for.
 *
 * `deposit` and `balance` are absent and cannot be added. The database already
 * makes them impossible from the other direction — `pay_kind_match` says
 * (req_type = 'pay') = (kind in ('deposit','balance')), so either of those
 * kinds forces a pay row, and `organized_trip_req_staff_never_pays` refuses a
 * pay row addressed to staff. The two constraints meet in the middle. This list
 * exists so the refusal is a sentence rather than a 23514 reaching the screen.
 */
export const STAFF_REQUIREMENT_KINDS = [
  'passport',
  'visa',
  'waiver',
  'medical',
  'insurance',
  'flights',
  'custom',
] as const;

export type StaffRequirementKind = (typeof STAFF_REQUIREMENT_KINDS)[number];

/**
 * What each kind is called when it is asked of CREW, and the one line under it.
 *
 * Not REQUIREMENT_CATALOG's copy: that is written to a traveler buying a place
 * ("so your organiser can book your flights"), and this is read by the operator
 * deciding, then by the guide who works for them. It is also what
 * `ensureStaffRequirements` stores on the row, so the wording the operator
 * ticked is the wording the crew member later reads.
 *
 * `custom` is absent — it has no fixed copy by definition; the operator types
 * its title in the trip's requirement editor.
 */
export const STAFF_KIND_COPY: Record<string, { title: string; sub: string }> = {
  passport:  { title: 'Passport',       sub: 'A photo of the passport page.' },
  visa:      { title: 'Visa',           sub: 'Their entry permit for this destination.' },
  waiver:    { title: 'Waiver',         sub: 'They read your terms and agree by typing their name.' },
  medical:   { title: 'Medical info',   sub: 'Allergies, diet, injuries, medication.' },
  insurance: { title: 'Insurance',      sub: 'Their policy document or confirmation.' },
  flights:   { title: 'Flight details', sub: 'Their ticket, so you can plan the pickup.' },
};

/** A staff-audience requirement on a trip, and who it has been given to. */
export interface StaffRequirement {
  requirementId: string;
  kind: string;
  reqType: string;
  title: string;
  helpText: string | null;
  /** Staff row ids this requirement is currently assigned to. */
  assignedStaffIds: string[];
}

/** One row of a staff member's own task list. */
export interface MyStaffRequirement {
  requirementId: string;
  kind: string;
  reqType: string;
  title: string;
  helpText: string | null;
  assignedAt: string;
  /** Derived server-side from the evidence rows, never stored. */
  fulfilled: boolean;
}

/**
 * Every staff-audience requirement on the trip, with its current assignments.
 *
 * Two queries rather than a join, because the assignment table is tiny and the
 * shape the UI wants (requirement → list of people) is the opposite of what a
 * join returns (one row per pair). Building it here keeps the caller simple.
 */
export async function listStaffRequirements(tripId: string): Promise<StaffRequirement[]> {
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

  return reqs.map(r => ({
    requirementId: r.id as string,
    kind: r.kind as string,
    reqType: r.req_type as string,
    title: r.title as string,
    helpText: (r.help_text as string | null) ?? null,
    assignedStaffIds: byRequirement.get(r.id as string) ?? [],
  }));
}

/**
 * The staff-audience requirement row for each of these kinds, creating any that
 * the trip does not have yet. Returns the ids, in the order asked for.
 *
 * ── Why the operator ticks a KIND and not a row ─────────────────────────────
 * Traveler requirements are built once, at publish, on a wizard step. Staff
 * paperwork is decided one person at a time, months later, in the middle of
 * inviting somebody — and an operator who has to leave that sheet, find the
 * trip's requirement editor, add "Passport (crew)" and come back has already
 * given up. So the crew screens offer the catalog directly and this turns a
 * tick into a row when one is needed.
 *
 * Existing rows win. Ticking Passport on a second guide reuses the first
 * guide's requirement rather than growing a second identical one — the
 * assignment table is what makes it personal, not the requirement.
 */
export async function ensureStaffRequirements(
  tripId: string,
  kinds: StaffRequirementKind[],
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
  for (const row of existing ?? []) {
    // First one wins — a trip with two active Passport rows for crew is not a
    // state anything creates, and picking deterministically beats guessing.
    if (!byKind.has(row.kind as string)) byKind.set(row.kind as string, row.id as string);
  }

  const ids: string[] = [];
  for (const kind of kinds) {
    const found = byKind.get(kind);
    if (found) {
      ids.push(found);
      continue;
    }
    const catalog = REQUIREMENT_CATALOG[kind as RequirementKind];
    if (!catalog) throw new Error(`"${kind}" cannot be asked of crew.`);
    const id = await createStaffRequirement({
      tripId,
      kind,
      // The catalog's own type, except that 'medical' is stored as an upload —
      // see the warning on REQUIREMENT_CATALOG. Never 'pay': the database
      // refuses a paying staff requirement, and STAFF_REQUIREMENT_KINDS has no
      // kind that would produce one.
      reqType: catalog.reqType === 'acknowledge' ? 'acknowledge' : 'upload',
      title: STAFF_KIND_COPY[kind]?.title ?? catalog.title,
      helpText: STAFF_KIND_COPY[kind]?.sub ?? catalog.helpText,
    });
    byKind.set(kind, id);
    ids.push(id);
  }
  return ids;
}

/**
 * Ask this staff member for this requirement.
 *
 * `trip_id` is written explicitly even though the trigger checks it against
 * both parents: the RLS policies filter on it, and a policy that had to walk
 * two tables to find the trip would pay for that on every row read.
 *
 * Idempotent by way of the unique constraint — assigning twice is a no-op
 * rather than an error, because the UI is a tick box and double-taps happen.
 */
export async function assignStaffRequirement(params: {
  tripId: string;
  staffId: string;
  requirementId: string;
}): Promise<void> {
  // Resolved here rather than passed in. `assigned_by` is an audit column —
  // who made this ask — and a caller that can pass it is a caller that can pass
  // the wrong one.
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
 * A hard delete, unlike revoking a staff member. The assignment is a live
 * instruction rather than a record of anything that happened — and if they had
 * already uploaded, the document itself survives in
 * `organized_trip_travelers_documents`, which is where the evidence belongs.
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
 * What the signed-in staff member has been asked for on this trip.
 *
 * Goes through the `staff_my_requirements` RPC rather than reading the tables,
 * for the same reason the traveler side uses a view: whether something is done
 * is derived from the evidence, and deriving it in two places is how the two
 * come to disagree.
 */
/** One asked-for item on one crew member, with what actually arrived. */
export interface StaffEvidenceRow {
  requirementId: string;
  kind: string;
  reqType: string;
  title: string;
  /**
   * 'submitted' = a file is in and nobody has decided; 'approved' = decided
   * yes; 'agreed'/'filled' = acknowledge and medical rows, which need no
   * decision; 'missing' = nothing yet. There is no 'rejected': rejecting
   * deletes the file (see project rule "reject stamps file_deleted_at"), so a
   * rejected upload correctly reads as missing again.
   */
  state: 'missing' | 'submitted' | 'approved' | 'agreed' | 'filled';
  documentId: string | null;
  storagePath: string | null;
}

/**
 * What one crew member was asked for and what they sent — the operator's side
 * of the same list `staff_my_requirements` gives the member.
 *
 * Reads the plain tables under the reviewer's own RLS (`docs.view` /
 * `docs.approve` on the documents, staff-table rights on the assignments) —
 * same pattern as the traveler review. Approve / reject then go through
 * tripDocumentsService's approveDocuments / rejectDocument unchanged: staff
 * evidence lives in the same documents table, so the decision plumbing is
 * already there.
 */
export async function fetchStaffPaperworkEvidence(params: {
  tripId: string;
  staffId: string;
  /** The member's account. Null for a Listed credit — then there is nothing
   *  to fetch and the caller should not be here. */
  userId: string;
}): Promise<StaffEvidenceRow[]> {
  const { tripId, staffId, userId } = params;

  const { data: assigns, error: assignErr } = await supabase
    .from('organized_trip_staff_requirements')
    .select('requirement_id')
    .eq('trip_id', tripId)
    .eq('staff_id', staffId);
  if (assignErr) throw assignErr;
  const ids = (assigns ?? []).map(a => a.requirement_id as string);
  if (ids.length === 0) return [];

  const { data: reqs, error: reqErr } = await supabase
    .from('organized_trip_requirements')
    .select('id, kind, req_type, title')
    .in('id', ids)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (reqErr) throw reqErr;
  if (!reqs?.length) return [];

  const [docs, acks, medical] = await Promise.all([
    supabase
      .from('organized_trip_travelers_documents')
      .select('id, requirement_id, storage_path, approved_at')
      .eq('user_id', userId)
      .in('requirement_id', ids)
      .is('file_deleted_at', null),
    supabase
      .from('group_trip_acknowledgements')
      .select('requirement_id')
      .eq('user_id', userId)
      .in('requirement_id', ids),
    supabase
      .from('organized_trip_medical_forms')
      .select('completed_at')
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const docByReq = new Map(
    (docs.data ?? []).map(d => [d.requirement_id as string, d]),
  );
  const agreed = new Set((acks.data ?? []).map(a => a.requirement_id as string));
  const medicalDone = !!medical.data?.completed_at;

  return reqs.map(r => {
    const id = r.id as string;
    const kind = r.kind as string;
    const reqType = r.req_type as string;
    const doc = docByReq.get(id);
    let state: StaffEvidenceRow['state'] = 'missing';
    if (kind === 'medical') state = medicalDone ? 'filled' : 'missing';
    else if (reqType === 'acknowledge') state = agreed.has(id) ? 'agreed' : 'missing';
    else if (doc) state = doc.approved_at ? 'approved' : 'submitted';
    return {
      requirementId: id,
      kind,
      reqType,
      title: r.title as string,
      state,
      documentId: (doc?.id as string | undefined) ?? null,
      storagePath: (doc?.storage_path as string | undefined) ?? null,
    };
  });
}

export async function fetchMyStaffRequirements(tripId: string): Promise<MyStaffRequirement[]> {
  const { data, error } = await supabase.rpc('staff_my_requirements', { p_trip_id: tripId });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    requirementId: r.requirement_id as string,
    kind: r.kind as string,
    reqType: r.req_type as string,
    title: r.title as string,
    helpText: (r.help_text as string | null) ?? null,
    assignedAt: r.assigned_at as string,
    fulfilled: !!r.fulfilled,
  }));
}

/**
 * DEV ONLY — the trip's crew paperwork as if all of it were assigned to me.
 *
 * Testing the crew screen properly needs a second account: an operator cannot
 * be crew on their own trip (`trg_staff_not_traveler` — they are already a
 * participant), so `staff_my_requirements` correctly returns nothing for them
 * and the screen has nothing to show.
 *
 * This skips ONLY the assignment join. Everything else is real: the same
 * requirement rows, the same upload / waiver / medical screens, the same
 * tables, under the tester's own user id. What it cannot prove is that the
 * assignment itself works — that still wants a second account.
 *
 * `fulfilled` mirrors the branch order in `staff_my_requirements`: kind first,
 * because a medical requirement is stored as an upload and satisfied by a form.
 */
export async function fetchStaffRequirementsAsMe(
  tripId: string,
  userId: string,
): Promise<MyStaffRequirement[]> {
  const { data: reqs, error } = await supabase
    .from('organized_trip_requirements')
    .select('id, kind, req_type, title, help_text, created_at')
    .eq('trip_id', tripId)
    .eq('audience', 'staff')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  if (!reqs?.length) return [];

  const ids = reqs.map(r => r.id as string);

  const [docs, acks, medical] = await Promise.all([
    supabase
      .from('organized_trip_travelers_documents')
      .select('requirement_id')
      .eq('user_id', userId)
      .in('requirement_id', ids)
      .is('file_deleted_at', null),
    supabase
      .from('group_trip_acknowledgements')
      .select('requirement_id')
      .eq('user_id', userId)
      .in('requirement_id', ids),
    supabase
      .from('organized_trip_medical_forms')
      .select('completed_at')
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const uploaded = new Set((docs.data ?? []).map(d => d.requirement_id as string));
  const agreed = new Set((acks.data ?? []).map(a => a.requirement_id as string));
  const medicalDone = !!medical.data?.completed_at;

  return reqs.map(r => ({
    requirementId: r.id as string,
    kind: r.kind as string,
    reqType: r.req_type as string,
    title: r.title as string,
    helpText: (r.help_text as string | null) ?? null,
    // No assignment row exists, so there is no assigned_at to report. The
    // screen does not render it.
    assignedAt: r.created_at as string,
    fulfilled:
      r.kind === 'medical'
        ? medicalDone
        : r.req_type === 'acknowledge'
          ? agreed.has(r.id as string)
          : uploaded.has(r.id as string),
  }));
}

/**
 * Create a requirement addressed to staff.
 *
 * Separate from `createRequirements` in tripDocumentsService because that one
 * builds the traveler set for a whole trip at publish. This adds one row, on
 * demand, to a trip that already exists.
 *
 * `req_type` is restricted here as well as in the database. The CHECK is what
 * makes it true; this is what makes the failure a readable message instead of a
 * 23514 surfacing in the UI.
 */
export async function createStaffRequirement(params: {
  tripId: string;
  kind: StaffRequirementKind;
  reqType: 'upload' | 'acknowledge';
  title: string;
  helpText?: string | null;
}): Promise<string> {
  if (params.reqType !== 'upload' && params.reqType !== 'acknowledge') {
    throw new Error('Staff can only be asked to upload or agree to something — never to pay.');
  }
  if (!STAFF_REQUIREMENT_KINDS.includes(params.kind)) {
    throw new Error(`"${params.kind}" cannot be asked of staff.`);
  }
  const { data, error } = await supabase
    .from('organized_trip_requirements')
    .insert({
      trip_id: params.tripId,
      kind: params.kind,
      req_type: params.reqType,
      audience: 'staff',
      title: params.title.trim(),
      help_text: params.helpText?.trim() || null,
      // Staff paperwork has no deadline and no skip — see the file header.
      skip_at_onboarding: 'must_have',
      sort_order: 100,
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}
