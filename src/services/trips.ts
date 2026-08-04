import { supabase } from '../lib/supabase';
import { toNumber } from '../domain/money';

export type OperatorTrip = {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  maxParticipants: number | null;
  /** 'C' is an operator trip. Anything else is only visible in testing mode. */
  hostingStyle: string | null;
  /**
   * The operator of record — the single person Stripe pays out.
   *
   * NOT the same as "a host". This site finds trips through
   * `participants.role = 'host'`, which includes every admin promoted with
   * "Set as admin". Setting a price is guarded by the database on host_id
   * alone, so the price button must be hidden from everyone else or it fails
   * at the server with a raw error.
   */
  hostId: string | null;
  /** 'managed' = Stripe collects. 'offline' = paid outside Swellyo. */
  paymentMode: string | null;
  /** Trip-wide defaults. A traveler's own frozen price wins over these. */
  costPerPerson: number | null;
  depositAmount: number | null;
};

export type TripMember = {
  userId: string;
  role: string;
  joinedAt: string | null;
  /** Frozen when they joined. Null means no price is set for this person. */
  priceTotalUsd: number | null;
  depositUsd: number | null;
};

const TRIP_COLUMNS =
  'id, title, start_date, end_date, status, max_participants, hosting_style, ' +
  'host_id, payment_mode, cost_per_person, deposit_amount';

function toTrip(t: any): OperatorTrip {
  return {
    id: t.id,
    title: t.title ?? 'Untitled trip',
    startDate: t.start_date ?? null,
    endDate: t.end_date ?? null,
    status: t.status ?? null,
    maxParticipants: t.max_participants ?? null,
    hostingStyle: t.hosting_style ?? null,
    hostId: t.host_id ?? null,
    paymentMode: t.payment_mode ?? null,
    costPerPerson: toNumber(t.cost_per_person),
    depositAmount: toNumber(t.deposit_amount),
  };
}

/**
 * Testing escape hatch.
 *
 * With VITE_ALLOW_ALL_HOSTED_TRIPS=true the list stops filtering on
 * `hosting_style`, so ANY trip you host appears. This exists because the
 * operator product has almost no real trips yet, and the ones with useful
 * document data are ordinary peer trips.
 *
 * It only widens what YOU can see among trips you already host. RLS is
 * untouched, so it cannot reveal anyone else's trip. Leave it off in
 * production — an operator seeing their peer trips here would be confusing,
 * not dangerous.
 */
const ALLOW_ALL_HOSTED = import.meta.env.VITE_ALLOW_ALL_HOSTED_TRIPS === 'true';

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
  let query = supabase
    .from('group_trip_participants')
    .select(`trip_id, group_trips!inner(${TRIP_COLUMNS})`)
    .eq('user_id', userId)
    .eq('role', 'host');

  if (!ALLOW_ALL_HOSTED) {
    query = query.eq('group_trips.hosting_style', 'C');
  }

  const { data, error } = await query;

  if (error) throw error;

  const trips = (data ?? [])
    .map((row: any) => row.group_trips)
    .filter(Boolean)
    .map(toTrip);

  // Soonest departure first; trips with no date sink to the bottom.
  return trips.sort((a, b) =>
    String(a.startDate ?? '9999').localeCompare(String(b.startDate ?? '9999')),
  );
}

export async function fetchTrip(tripId: string): Promise<OperatorTrip> {
  const { data, error } = await supabase
    .from('group_trips')
    .select(TRIP_COLUMNS)
    .eq('id', tripId)
    .single();

  if (error) throw error;
  return toTrip(data);
}

/**
 * Travelers on the trip. Only `member` rows — hosts are not travelers.
 *
 * The price columns ride along here rather than in their own query: the money
 * screens need them per traveler, and this read already happens on every page.
 */
export async function fetchMembers(tripId: string): Promise<TripMember[]> {
  const { data, error } = await supabase
    .from('group_trip_participants')
    .select('user_id, role, joined_at, price_total_usd, deposit_usd')
    .eq('trip_id', tripId)
    .eq('role', 'member');

  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    role: r.role,
    joinedAt: r.joined_at ?? null,
    priceTotalUsd: toNumber(r.price_total_usd),
    depositUsd: toNumber(r.deposit_usd),
  }));
}
