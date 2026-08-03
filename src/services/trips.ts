import { supabase } from '../lib/supabase';

export type OperatorTrip = {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  maxParticipants: number | null;
};

export type TripMember = {
  userId: string;
  role: string;
  joinedAt: string | null;
};

/**
 * Trips this operator hosts.
 *
 * `hosting_style = 'C'` is what makes a trip an operator trip. A host is a
 * participant row with `role = 'host'` — there can be several per trip.
 *
 * RLS already stops anyone reading a trip they do not belong to, so the
 * `user_id` filter here is about asking the right question, not about safety.
 */
export async function fetchOperatorTrips(userId: string): Promise<OperatorTrip[]> {
  const { data, error } = await supabase
    .from('group_trip_participants')
    .select(
      'trip_id, group_trips!inner(id, title, start_date, end_date, status, max_participants, hosting_style)',
    )
    .eq('user_id', userId)
    .eq('role', 'host')
    .eq('group_trips.hosting_style', 'C');

  if (error) throw error;

  const trips = (data ?? [])
    .map((row: any) => row.group_trips)
    .filter(Boolean)
    .map(
      (t: any): OperatorTrip => ({
        id: t.id,
        title: t.title ?? 'Untitled trip',
        startDate: t.start_date ?? null,
        endDate: t.end_date ?? null,
        status: t.status ?? null,
        maxParticipants: t.max_participants ?? null,
      }),
    );

  // Soonest departure first; trips with no date sink to the bottom.
  return trips.sort((a, b) =>
    String(a.startDate ?? '9999').localeCompare(String(b.startDate ?? '9999')),
  );
}

export async function fetchTrip(tripId: string): Promise<OperatorTrip> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('id, title, start_date, end_date, status, max_participants')
    .eq('id', tripId)
    .single();

  if (error) throw error;
  return {
    id: data.id,
    title: data.title ?? 'Untitled trip',
    startDate: data.start_date ?? null,
    endDate: data.end_date ?? null,
    status: data.status ?? null,
    maxParticipants: data.max_participants ?? null,
  };
}

/** Travelers on the trip. Only `member` rows — hosts are not travelers. */
export async function fetchMembers(tripId: string): Promise<TripMember[]> {
  const { data, error } = await supabase
    .from('group_trip_participants')
    .select('user_id, role, joined_at')
    .eq('trip_id', tripId)
    .eq('role', 'member');

  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    role: r.role,
    joinedAt: r.joined_at ?? null,
  }));
}
