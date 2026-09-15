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
  /** Offline trips only: the full-payment deadline, days before departure.
   *  Null on a managed trip, whose deadline is on the `balance` row. */
  offlinePaymentDueDaysBefore: number | null;
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
  /**
   * 'onboarding' or 'active'. A traveler approved on an operator trip sits at
   * 'onboarding' and holds NO seat, so `participant_count` cannot see them —
   * which is why the summary tile counts these instead. See `travelerCounts`.
   */
  status: string | null;
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
  'cancellation_preset, cancellation_rules, cancellation_notes, ' +
  // OFFLINE trips only. A managed trip's full-payment deadline lives on its
  // `balance` requirement row instead — the database refuses pay rows on an
  // offline trip, so this column is where theirs has to live.
  'offline_payment_due_days_before';

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
    offlinePaymentDueDaysBefore:
      t.offline_payment_due_days_before === null ||
      t.offline_payment_due_days_before === undefined
        ? null
        : Number(t.offline_payment_due_days_before),
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
 *
 * Read from `organized_trip_traveler_prices`, not the table. Since migration
 * 20260906000100 the base table withholds the four price columns from every
 * signed-in user (any account could read anyone's price), and the view serves
 * them to the traveler and to staff with `payments.view_status` — the same
 * people who may read the ledger. Same columns, same filters.
 *
 * ⚠️ NO FALLBACK TO THE TABLE, and that is the fix for a trap this file had on
 * 6 Sep 2026. It used to retry against `group_trip_participants` when the view
 * was missing — asking for the very columns the migration had just revoked. So
 * the moment PostgREST's schema cache lagged behind the new view, every trip
 * page died with "permission denied for table group_trip_participants", which
 * `friendlyError` renders as "You do not have access to this trip." An operator
 * looking at their own trip was told they were not allowed in.
 *
 * A missing view is now an honest error naming the migration. The alternative —
 * reading the table without the price columns — is worse than an error: it
 * returns nulls, every traveler reads as unpaid, and the money screens quietly
 * say $0. That is the exact failure X-06 exists to prevent.
 */
export async function fetchMembers(tripId: string): Promise<TripMember[]> {
  const cols = 'user_id, role, status, joined_at, price_total_usd, deposit_usd';
  const { data, error } = await supabase
    .from('organized_trip_traveler_prices')
    .select(cols)
    .eq('trip_id', tripId)
    .eq('role', 'member')
    // PRESENT travelers only. Since 20260906000300 a departure keeps the row
    // and marks it 'left' or 'removed', and this list feeds every count on the
    // site — expected documents, collected of expected, the traveler tiles.
    // Without this, somebody who left last month would go on being counted as
    // owing a passport for ever. They are listed separately, by
    // `fetchDepartedMembers`. `.in` rather than `.not('status','in',...)` so a
    // future status nobody has taught this page about is excluded by default
    // instead of quietly counted.
    .in('status', PRESENT_STATUSES);

  // 42P01 is Postgres's "relation does not exist"; PGRST205 is PostgREST's
  // schema cache saying the same. The second one is the likely one and it is
  // usually not a missing migration at all — it is PostgREST still holding the
  // schema from before the view was created. `notify pgrst, 'reload schema'`
  // clears it. Say so, because the generic error sends the reader hunting for
  // a permissions problem that is not there.
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) {
    throw new Error(
      'The organized_trip_traveler_prices view is missing. Apply migration ' +
        '20260906000100, or run "notify pgrst, \'reload schema\'" if it is already applied.',
    );
  }

  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    role: r.role,
    // Defaults to 'active' when the column is absent, so a client running
    // against a pre-migration database behaves as it did.
    status: (r.status as string | null) ?? 'active',
    joinedAt: r.joined_at ?? null,
    priceTotalUsd: toNumber(r.price_total_usd),
    depositUsd: toNumber(r.deposit_usd),
  }));
}

/**
 * The two statuses that mean "on this trip".
 *
 * 'onboarding' counts: an approved traveler part-way through their paperwork
 * holds no seat but is very much on the trip, which is the whole point of the
 * "+N still joining" line. 'left' and 'removed' do not. Mirrors the same
 * predicate in the database (20260906000300).
 */
export const PRESENT_STATUSES = ['onboarding', 'active'] as const;

export type DepartedMember = {
  userId: string;
  /** 'left' — they used Exit. 'removed' — the operator took them off. */
  status: 'left' | 'removed';
  leftAt: string | null;
  /** Null on a self-exit; otherwise whoever removed them. */
  leftBy: string | null;
  leftReason: string | null;
  joinedAt: string | null;
  /** What they were on when they left. Kept so the money still adds up. */
  priceTotalUsd: number | null;
};

/**
 * Travelers who are no longer on the trip but kept their row.
 *
 * Empty until migration 20260906000300 is applied — nothing writes 'left' or
 * 'removed' before it, and the `left_at` column it adds does not exist, so the
 * select is caught and answered with an empty list rather than an error. That
 * makes this site safe to deploy in either order.
 *
 * People removed BEFORE that migration have no row at all and can only be
 * found through the ledger — see `fetchDepartedFromLedger`. The two sets are
 * disjoint by construction.
 */
export async function fetchDepartedMembers(tripId: string): Promise<DepartedMember[]> {
  const { data, error } = await supabase
    .from('group_trip_participants')
    .select('user_id, status, joined_at, left_at, left_by, left_reason')
    .eq('trip_id', tripId)
    .eq('role', 'member')
    .in('status', ['left', 'removed'])
    .order('left_at', { ascending: false });

  // 42703 is "column does not exist" — the migration has not run here yet.
  // 42P01 covers a database that somehow lacks the table entirely.
  if (error) {
    if (error.code === '42703' || error.code === '42P01' || error.code === 'PGRST204') return [];
    throw error;
  }

  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    status: r.status === 'removed' ? 'removed' : 'left',
    leftAt: r.left_at ?? null,
    leftBy: r.left_by ?? null,
    leftReason: r.left_reason ?? null,
    joinedAt: r.joined_at ?? null,
    priceTotalUsd: null,
  }));
}
