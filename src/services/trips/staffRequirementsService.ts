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
