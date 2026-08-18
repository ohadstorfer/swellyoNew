import { supabase } from '../lib/supabase';
import { toNumber } from '../domain/money';
import { fetchMyStaffTripIds } from './access';

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
  /**
   * The trip's own frozen cancellation terms, exactly as stored. Passed through
   * `policyFromTrip()` to become a policy — never cast, because a legacy or
   * NULL preset must read as "not specified", not as a default.
   */
  cancellationPreset: string | null;
  cancellationRules: unknown;
  cancellationNotes: string | null;
  /**
   * True when this trip is on the list because the person is CREW, not because
   * they host it. Display only — what they may do inside is decided per page by
   * `useTripAccess`, never by this flag.
   */
  viaCrew: boolean;
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
  'host_id, payment_mode, cost_per_person, deposit_amount, ' +
  // The trip's FROZEN cancellation terms, taken at publish. Read so the refund
  // dialog can show the operator the terms they are applying — never read from
  // `operator_settings`, which is today's default and may have changed since.
  'cancellation_preset, cancellation_rules, cancellation_notes';

function toTrip(t: any, viaCrew = false): OperatorTrip {
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
    cancellationPreset: t.cancellation_preset ?? null,
    cancellationRules: t.cancellation_rules ?? null,
    cancellationNotes: t.cancellation_notes ?? null,
    viaCrew,
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
 * Trips this person can run from here: the ones they host, and the ones they
 * are crew on.
 *
 * `hosting_style = 'C'` is what makes a trip an operator trip. A host is a
 * participant row with `role = 'host'` — there can be several per trip. Crew are
 * NOT participants at all (a person is one or the other, never both), which is
 * why they need their own read rather than a wider filter on this one.
 *
 * Two queries and a merge, not a union: they ask different tables different
 * questions, and PostgREST has no way to express "either of these".
 *
 * RLS is not what scopes this. `group_trips` is readable by any signed-in user,
 * so the filters here are about asking the right question. What actually
 * protects the trip is every page inside it — documents, medical, money — all
 * of which check a capability.
 */
export async function fetchOperatorTrips(userId: string): Promise<OperatorTrip[]> {
  let hostQuery = supabase
    .from('group_trip_participants')
    .select(`trip_id, group_trips!inner(${TRIP_COLUMNS})`)
    .eq('user_id', userId)
    .eq('role', 'host');

  if (!ALLOW_ALL_HOSTED) {
    hostQuery = hostQuery.eq('group_trips.hosting_style', 'C');
  }

  const [hosted, staffTripIds] = await Promise.all([
    hostQuery,
    // A failure here must not empty an operator's own list — they are the
    // common case and their trips do not depend on this read.
    fetchMyStaffTripIds(userId).catch(e => {
      console.error('[trips] could not read crew memberships:', e);
      return [] as string[];
    }),
  ]);

  if (hosted.error) throw hosted.error;

  const byId = new Map<string, OperatorTrip>();
  for (const row of (hosted.data ?? []) as any[]) {
    if (row.group_trips) {
      const trip = toTrip(row.group_trips);
      byId.set(trip.id, trip);
    }
  }

  // Crew trips. Fetched by id rather than through a join, because
  // organized_trip_staff has no foreign key PostgREST can embed group_trips
  // through — the same reason listTripStaff in the app runs two queries.
  const missing = staffTripIds.filter(id => !byId.has(id));
  if (missing.length > 0) {
    let crewQuery = supabase.from('group_trips').select(TRIP_COLUMNS).in('id', missing);
    if (!ALLOW_ALL_HOSTED) crewQuery = crewQuery.eq('hosting_style', 'C');

    const { data, error } = await crewQuery;
    if (error) throw error;
    for (const row of (data ?? []) as any[]) {
      const trip = toTrip(row, true);
      byId.set(trip.id, trip);
    }
  }

  // Soonest departure first; trips with no date sink to the bottom.
  return [...byId.values()].sort((a, b) =>
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
