import { supabase } from '../lib/supabase';

/**
 * Who has asked to come, and the two answers.
 *
 * Product Specs §"Trip dashboard space": "join requests — approve and reject",
 * listed for the trip manager AND the trip operator, and the spec's own rule is
 * that every function exists on both mobile and desktop. Until now an operator
 * sitting at a desktop could review sixty passports and not let a single person
 * onto the trip.
 *
 * ── Two UPDATEs, and deliberately nothing else ─────────────────────────────
 * The app's `approveJoinRequest` does more than this, and the extra is the part
 * that must NOT be copied. It adds the approved person to the trip's group
 * conversation — except on an operator trip, where it explicitly does not,
 * because approval there grants access to onboarding and no seat. Dropping a
 * stranger into a conversation about a trip they may never join is exactly the
 * thing that code is written to avoid, and this site only ever sees operator
 * trips.
 *
 * So the write is the status stamp, and every consequence — the participant
 * row, the notification, the seat arithmetic — belongs to the trigger on
 * `group_trip_join_requests`, which fires whichever surface did the stamping.
 * That is what keeps the two apps agreeing.
 *
 * ── Rule 1 ─────────────────────────────────────────────────────────────────
 * No new table, no new function, no migration. RLS on
 * `group_trip_join_requests` already decides who may answer one.
 */
export type JoinRequest = {
  id: string;
  tripId: string;
  requesterId: string;
  note: string | null;
  createdAt: string | null;
};

export async function fetchJoinRequests(tripId: string): Promise<JoinRequest[]> {
  const { data, error } = await supabase
    .from('group_trip_join_requests')
    .select('id, trip_id, requester_id, request_note, created_at')
    .eq('trip_id', tripId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id as string,
    tripId: r.trip_id as string,
    requesterId: r.requester_id as string,
    note: (r.request_note as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  }));
}

/**
 * Answer one request.
 *
 * `reviewed_by` is stamped from the caller's own session rather than left null:
 * on a trip with a co-operator and two managers, "who let this person in" is a
 * question somebody eventually asks.
 */
export async function decideJoinRequest(
  requestId: string,
  decision: 'approved' | 'declined',
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('group_trip_join_requests')
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
    })
    .eq('id', requestId)
    // Only a request still waiting. Two managers with the page open would
    // otherwise both "succeed", and the second would overwrite the first's
    // decision with the opposite one.
    .eq('status', 'pending');
  if (error) throw error;
}
