/**
 * Trip-level actions the app has and this site was missing: reminders, closing
 * a trip, co-hosts, and putting the operator on their own crew.
 *
 * Every call here is the app's own call, verbatim — same RPC, same table, same
 * columns. Nothing new in the database (SPEC Rule 1). The app source for each
 * is named next to it so the two can be diffed.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PRESENT_STATUSES } from './trips';

// ── Reminders ────────────────────────────────────────────────────────────────

/**
 * Nudge everyone who still owes this requirement.
 * App: `remindRequirement` in tripDocumentsService.ts.
 *
 * Returns how many were ACTUALLY sent: the RPC skips anyone reminded about this
 * requirement in the last 24 hours. Gated on `docs.view` inside the RPC; pay
 * rows are refused (errcode 0A000).
 */
export async function remindRequirement(tripId: string, requirementId: string): Promise<number> {
  const { data, error } = await supabase.rpc('operator_remind_requirement', {
    p_trip_id: tripId,
    p_requirement_id: requirementId,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

/**
 * Nudge ONE traveler about one requirement. 1 = sent, 0 = skipped (nothing
 * owed, or reminded in the last 24 hours — the cooldown is shared with the
 * everyone version). App: `remindTravelerRequirement`.
 */
export async function remindTravelerRequirement(
  tripId: string,
  requirementId: string,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('operator_remind_traveler_requirement', {
    p_trip_id: tripId,
    p_requirement_id: requirementId,
    p_user_id: userId,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Mark the trip completed. App: `completeTrip` in groupTripsService.ts — one
 * column write. It hides the trip from Explore and moves it to Past trips;
 * members keep the overview and the chat. There is no way back.
 */
export async function completeTrip(tripId: string): Promise<void> {
  const { error } = await supabase
    .from('group_trips')
    .update({ status: 'completed' })
    .eq('id', tripId);
  if (error) throw error;
}

// ── Co-hosts ("admins") ──────────────────────────────────────────────────────

/** App: `promoteTripHost`. The RPC checks `is_trip_host` itself. */
export async function promoteTripHost(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('promote_trip_host', {
    p_trip_id: tripId,
    p_user_id: userId,
  });
  if (error) throw error;
}

/** App: `demoteTripHost`. The database refuses removing the last host. */
export async function demoteTripHost(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('demote_trip_host', {
    p_trip_id: tripId,
    p_user_id: userId,
  });
  if (error) throw error;
}

/**
 * Everyone with `role = 'host'` on this trip. `fetchMembers` reads
 * `role = 'member'` only, so a promoted admin drops off the roster — this is
 * the list they land on instead.
 */
export async function fetchTripHosts(tripId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('group_trip_participants')
    .select('user_id')
    .eq('trip_id', tripId)
    .eq('role', 'host')
    .in('status', PRESENT_STATUSES);
  if (error) throw error;
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

/**
 * The app's `isTripHost`: `group_trips.host_id`, OR a `role = 'host'` row.
 * Flat multi-host — every promoted admin counts. That is the app's gate for
 * "Complete trip" and for Set / Remove as admin; money and cancelling stay on
 * `host_id` / capabilities and never read this.
 */
export function useTripHosts(tripId: string, ownerId: string | null) {
  const { user } = useAuth();
  const hosts = useQuery({
    queryKey: ['hosts', tripId],
    queryFn: () => fetchTripHosts(tripId),
    enabled: !!tripId,
  });
  const me = user?.id ?? null;
  const ids = hosts.data ?? [];
  return {
    hosts,
    /** Host user ids, the operator of record first. */
    ids: ownerId ? [ownerId, ...ids.filter(id => id !== ownerId)] : ids,
    me,
    viewerIsHost: !!me && (me === ownerId || ids.includes(me)),
    ready: hosts.isSuccess,
  };
}

// ── The operator on their own crew ───────────────────────────────────────────

/**
 * "Add yourself to the crew" — for an operator whose trip was published before
 * the app started doing this at publish. App: `ensureOperatorOnCrew` in
 * tripStaffService.ts, same row, same columns. Idempotent: the unique index
 * answers 23505 to a second insert, which is success.
 */
export async function ensureOperatorOnCrew(tripId: string, operatorId: string): Promise<void> {
  // The app seeds the bio from the trip's "about you" note.
  const { data: trip } = await supabase
    .from('group_trips')
    .select('host_lead_note')
    .eq('id', tripId)
    .maybeSingle();
  const bio = ((trip as { host_lead_note?: string | null } | null)?.host_lead_note ?? '').trim();

  const { error } = await supabase.from('organized_trip_staff').insert({
    trip_id: tripId,
    operator_id: operatorId,
    user_id: operatorId,
    role_key: 'operator',
    title: 'Operator',
    bio: bio || null,
    accepted_at: new Date().toISOString(),
  });
  if (error && (error as { code?: string }).code !== '23505') throw error;
}
