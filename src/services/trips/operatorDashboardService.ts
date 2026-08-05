/**
 * operatorDashboardService — the numbers behind the host's Dashboard tab.
 *
 * This is the app's port of the web operator dashboard (`operator-dashboard/`),
 * and it obeys that project's first rule: it adds NOTHING to the database. Every
 * read below is a plain table read the host is already allowed to make —
 * `otpe_read_own` grants payment events on `is_trip_host(trip_id)`,
 * `medical_operator_select` does the same for medical forms, and participants
 * are readable by any authenticated user. No RPC, no migration, no new grant.
 *
 * ── Why the money rule is not re-implemented here ───────────────────────────
 * `amountDue()` in tripPaymentsService is already the app's copy of
 * `operator_traveler_amount_due()`. This file calls it rather than restating
 * the deposit/balance arithmetic, so there is one place in the app that knows
 * what a step costs. The trip-wide AGGREGATION on top of it (who has paid, what
 * is still expected) is what is new.
 *
 * ── Two traps that are load-bearing ─────────────────────────────────────────
 * 1. Money is summed in whole CENTS, as integers. `0.1 + 0.2 !== 0.3`, and a
 *    trip with fifteen travelers sums fifteen of those errors into a total the
 *    operator will compare against Stripe by eye.
 * 2. A Postgres `numeric` arrives over PostgREST as a STRING. Everything goes
 *    through `toNumber()` first, or `1000 + 2000` silently becomes "10002000".
 */

import { supabase } from '../../config/supabase';
import {
  amountDue,
  STRIPE_LIVEMODE,
  type PayStep,
  type TravelerPrices,
} from './tripPaymentsService';

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

/** Never returns NaN. An unparseable value is "we do not know", which is null —
 *  not zero, because zero reads as "nothing owed" to every consumer below. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export const toCents = (usd: number): number => Math.round(usd * 100);
export const fromCents = (cents: number): number => cents / 100;

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

export type PaymentEvent = {
  userId: string;
  requirementId: string | null;
  /** 'paid' | 'refunded' | 'failed'. A refund carries a negative amount. */
  eventType: string;
  amountUsd: number;
  createdAt: string | null;
};

/** One pay requirement — the trip's Deposit or Final payment row. */
export type PayStepRow = {
  requirementId: string;
  kind: PayStep;
  title: string;
};

export type StepMoney = {
  requirementId: string;
  kind: PayStep;
  title: string;
  /** What this step costs this traveler. Null = no price exists anywhere. */
  dueUsd: number | null;
  paidUsd: number;
  state: 'paid' | 'unpaid' | 'no_price';
};

export type TravelerMoney = {
  userId: string;
  /** Their frozen price, falling back to the trip default. */
  totalUsd: number | null;
  paidUsd: number;
  steps: StepMoney[];
  /** Their counted events, newest first. */
  events: PaymentEvent[];
};

export type TripMoney = {
  travelers: TravelerMoney[];
  steps: PayStepRow[];
  /** Sum of the prices that exist. A traveler with no price adds nothing. */
  expectedUsd: number;
  /** Every counted event, including any from people who have since left. */
  collectedUsd: number;
  /** How many travelers have no price — the operator's own backlog. */
  noPriceCount: number;
  paidCountByKind: Record<PayStep, number>;
  events: PaymentEvent[];
  /**
   * Events belonging to the Stripe mode we are NOT counting.
   *
   * EXPO_PUBLIC_STRIPE_LIVEMODE has to flip together with the database's
   * `app.stripe_livemode`. Forgetting one is otherwise silent — the totals are
   * simply wrong with nothing on screen to say so — and this count is the only
   * signal available without a migration.
   */
  hiddenCount: number;
  /** 'managed' = Stripe collects. Anything else = paid outside Swellyo. */
  isOffline: boolean;
};

export type MedicalFlags = {
  formsCompleted: number;
  injuriesReported: number;
  allergiesReported: number;
  dietaryReported: number;
  medicationsReported: number;
};

// ---------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------

/** The raw rows `buildTripMoney` turns into numbers. */
export type TripMoneyInput = {
  members: { userId: string; priceTotalUsd: number | null; depositUsd: number | null }[];
  steps: PayStepRow[];
  trip: { costPerPerson: number | null; depositAmount: number | null; paymentMode: string | null };
  /** Every event on the trip, unfiltered — this function does the filtering. */
  events: (PaymentEvent & { isLivemode: boolean })[];
  /** Which Stripe mode counts as real money here. */
  liveMode: boolean;
};

/**
 * Every money number the Dashboard needs, in one pass.
 *
 * Pure, and separate from the fetch, for two reasons: it is the arithmetic that
 * can be wrong in ways nobody notices, so it is the part worth testing; and the
 * summary card, the traveler list and each person's sheet all read the result,
 * so they cannot disagree — a card saying "1 of 2 paid" above a list showing
 * something else is worse than either being wrong alone.
 */
export function buildTripMoney(input: TripMoneyInput): TripMoney {
  const { members, steps, trip, events, liveMode } = input;

  // A 'failed' row is not money, and a row from the other Stripe mode is not
  // OUR money. Both are dropped; the second is counted so it can be reported.
  const counted: PaymentEvent[] = events
    .filter(e => e.eventType !== 'failed' && e.isLivemode === liveMode)
    .map(e => ({
      userId: e.userId,
      requirementId: e.requirementId,
      eventType: e.eventType,
      amountUsd: e.amountUsd,
      createdAt: e.createdAt,
    }));
  const hiddenCount = events.filter(
    e => e.eventType !== 'failed' && e.isLivemode !== liveMode,
  ).length;

  const paidCountByKind: Record<PayStep, number> = { deposit: 0, balance: 0 };
  let expectedCents = 0;
  let noPriceCount = 0;

  const travelers: TravelerMoney[] = members.map(m => {
    // Null on the participant row means they joined before payments were turned
    // on. Fall back to the trip price, exactly as the SQL coalesce does.
    const prices: TravelerPrices = {
      totalUsd: m.priceTotalUsd ?? trip.costPerPerson,
      depositUsd: m.depositUsd ?? trip.depositAmount,
    };

    const mine = counted.filter(e => e.userId === m.userId);
    const paidCents = mine.reduce((sum, e) => sum + toCents(e.amountUsd), 0);

    if (prices.totalUsd === null) noPriceCount += 1;
    else expectedCents += toCents(prices.totalUsd);

    const stepMoney: StepMoney[] = steps.map(s => {
      const dueUsd = amountDue(s.kind, prices);
      const stepPaidCents = mine
        .filter(e => e.requirementId === s.requirementId)
        .reduce((sum, e) => sum + toCents(e.amountUsd), 0);

      // No price means nothing can be owed, so nothing can be paid either —
      // never 'unpaid', which would read as a debt the traveler can settle.
      const state =
        dueUsd === null ? 'no_price' : stepPaidCents >= toCents(dueUsd) ? 'paid' : 'unpaid';
      if (state === 'paid') paidCountByKind[s.kind] += 1;

      return {
        requirementId: s.requirementId,
        kind: s.kind,
        title: s.title,
        dueUsd,
        paidUsd: fromCents(stepPaidCents),
        state,
      };
    });

    return {
      userId: m.userId,
      totalUsd: prices.totalUsd,
      paidUsd: fromCents(paidCents),
      steps: stepMoney,
      events: mine,
    };
  });

  return {
    travelers,
    steps,
    expectedUsd: fromCents(expectedCents),
    // Across the whole trip, not the sum of the rows above: someone who paid
    // and then left the trip still took the operator's money.
    collectedUsd: fromCents(counted.reduce((sum, e) => sum + toCents(e.amountUsd), 0)),
    noPriceCount,
    paidCountByKind,
    events: counted,
    hiddenCount,
    isOffline: (trip.paymentMode ?? 'offline') !== 'managed',
  };
}

/** Four parallel reads, then `buildTripMoney`. */
export async function fetchTripMoney(tripId: string): Promise<TripMoney> {
  const [tripRes, memberRes, reqRes, eventRes] = await Promise.all([
    supabase
      .from('group_trips')
      .select('cost_per_person, deposit_amount, payment_mode')
      .eq('id', tripId)
      .single(),
    supabase
      .from('group_trip_participants')
      .select('user_id, price_total_usd, deposit_usd')
      .eq('trip_id', tripId)
      // Hosts are not travelers — nobody charges the operator to run their own
      // trip, and counting them would put a permanent unpaid row on the list.
      .eq('role', 'member'),
    supabase
      .from('organized_trip_requirements')
      .select('id, kind, title, is_active')
      .eq('trip_id', tripId)
      .eq('req_type', 'pay')
      .eq('is_active', true),
    supabase
      .from('organized_trip_payment_events')
      .select('user_id, requirement_id, event_type, amount_usd, is_livemode, created_at')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false }),
  ]);

  if (tripRes.error) throw tripRes.error;
  if (memberRes.error) throw memberRes.error;
  if (reqRes.error) throw reqRes.error;
  if (eventRes.error) throw eventRes.error;

  // Deposit before balance, always — it is the order the traveler pays in and
  // the order every other screen lists them.
  const RANK: Record<PayStep, number> = { deposit: 0, balance: 1 };
  const steps: PayStepRow[] = (reqRes.data ?? [])
    .filter((r: any) => r.kind === 'deposit' || r.kind === 'balance')
    .map((r: any) => ({
      requirementId: r.id as string,
      kind: r.kind as PayStep,
      title: (r.title as string) ?? (r.kind === 'deposit' ? 'Deposit' : 'Final payment'),
    }))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind]);

  return buildTripMoney({
    members: (memberRes.data ?? []).map((m: any) => ({
      userId: m.user_id as string,
      priceTotalUsd: toNumber(m.price_total_usd),
      depositUsd: toNumber(m.deposit_usd),
    })),
    steps,
    trip: {
      costPerPerson: toNumber(tripRes.data?.cost_per_person),
      depositAmount: toNumber(tripRes.data?.deposit_amount),
      paymentMode: (tripRes.data?.payment_mode as string | null) ?? null,
    },
    events: (eventRes.data ?? []).map((e: any) => ({
      userId: e.user_id as string,
      requirementId: (e.requirement_id as string | null) ?? null,
      eventType: (e.event_type as string) ?? 'paid',
      amountUsd: toNumber(e.amount_usd) ?? 0,
      isLivemode: !!e.is_livemode,
      createdAt: (e.created_at as string | null) ?? null,
    })),
    liveMode: STRIPE_LIVEMODE,
  });
}

// ---------------------------------------------------------------------------
// medical
// ---------------------------------------------------------------------------

/**
 * Medical answers as COUNTS, with no names attached.
 *
 * The trip screen is background awareness — how many people have an allergy,
 * not who. Someone's allergies belong on their own sheet, which the operator
 * opens deliberately, and nowhere else.
 *
 * A "reported" answer is one with text in it. The explicit "none" checkbox is
 * an answer too, but it is not a flag.
 */
export async function fetchMedicalFlags(tripId: string): Promise<MedicalFlags> {
  const { data, error } = await supabase
    .from('organized_trip_medical_forms')
    .select(
      'allergies, allergies_none, dietary, dietary_none, injuries, injuries_none, medications, medications_none, completed_at',
    )
    .eq('trip_id', tripId);

  if (error) throw error;

  const rows = (data ?? []).filter((r: any) => !!r.completed_at);
  const reported = (text: unknown, none: unknown) => !none && !!String(text ?? '').trim();

  return {
    formsCompleted: rows.length,
    injuriesReported: rows.filter((r: any) => reported(r.injuries, r.injuries_none)).length,
    allergiesReported: rows.filter((r: any) => reported(r.allergies, r.allergies_none)).length,
    dietaryReported: rows.filter((r: any) => reported(r.dietary, r.dietary_none)).length,
    medicationsReported: rows.filter((r: any) => reported(r.medications, r.medications_none))
      .length,
  };
}

// ---------------------------------------------------------------------------
// surf stats
// ---------------------------------------------------------------------------

export type TravelerProfile = {
  userId: string;
  age: number | null;
  countryFrom: string | null;
  surfLevel: string | null;
  boardType: string | null;
};

/** Surf-shaped facts about the roster. The trip screen holds names and avatars
 *  already; these four columns are the ones it does not. */
export async function fetchTravelerProfiles(
  userIds: string[],
): Promise<Map<string, TravelerProfile>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('surfers')
    .select('user_id, age, country_from, surf_level_category, surfboard_type')
    .in('user_id', userIds);

  if (error) throw error;

  const map = new Map<string, TravelerProfile>();
  for (const r of data ?? []) {
    map.set(r.user_id, {
      userId: r.user_id,
      age: toNumber(r.age),
      countryFrom: r.country_from ?? null,
      surfLevel: r.surf_level_category ?? null,
      boardType: r.surfboard_type ?? null,
    });
  }
  return map;
}

export type SurfStats = {
  levels: [string, number][];
  boards: [string, number][];
  ageMin: number | null;
  ageMax: number | null;
  countryCount: number;
};

/**
 * Who is on this trip, as a shape rather than a list.
 *
 * Derived from profiles the screen already holds, so this is a pure function
 * and not a fifth round trip.
 */
export function buildSurfStats(
  profiles: {
    surfLevel?: string | null;
    boardType?: string | null;
    age?: number | null;
    countryFrom?: string | null;
  }[],
): SurfStats {
  const ages = profiles
    .map(p => p.age)
    .filter((a): a is number => typeof a === 'number' && a > 0);

  return {
    levels: tally(profiles.map(p => p.surfLevel ?? null)),
    boards: tally(profiles.map(p => p.boardType ?? null)),
    ageMin: ages.length ? Math.min(...ages) : null,
    ageMax: ages.length ? Math.max(...ages) : null,
    countryCount: new Set(profiles.map(p => p.countryFrom).filter(Boolean)).size,
  };
}

/** Most common first. Unset values are not a category. */
function tally(values: (string | null)[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
