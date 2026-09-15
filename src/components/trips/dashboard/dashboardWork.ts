/**
 * "What still needs attention" — the Dashboard's sense of time and urgency.
 *
 * Kept out of the component because every function here has an edge case that
 * is the whole reason it exists, and none of them are testable inside a
 * renderer.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID: `RequirementState` has an `'overdue'`
 * value, and `fetchTripReview` already computes it, so "count the late ones"
 * looks like `state === 'overdue'`. It is not. Read the branches at
 * `tripDocumentsService.ts:1241 / 1256 / 1270` — `'overdue'` is only ever
 * reached when the traveler has sent NOTHING. Someone who sent a blurry
 * passport, had it rejected, and never sent another reads `'rejected'` forever,
 * months past the deadline. That is the person most likely to miss the flight,
 * and the obvious version of this count cannot see them.
 */
import type { ReviewItem, TravelerReview } from '../../../services/trips/tripDocumentsService';
import { todayISO } from '../../../services/trips/tripDocumentsService';

export type SortMode = 'work' | 'alpha';

/**
 * A local calendar date from a `YYYY-MM-DD` string.
 *
 * `new Date('2026-08-19')` parses as UTC midnight, which is the previous
 * evening for anyone west of Greenwich — the same class of bug the service's
 * `todayISO` comment warns about, in the other direction.
 */
function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Is this item late?
 *
 * `'overdue'` — the traveler sent nothing and the deadline passed. Plus the
 * case the service cannot express: rejected, never resent, deadline passed.
 *
 * Date strings compare correctly with `<` because `YYYY-MM-DD` sorts
 * lexicographically, which is the same test the service makes at line 1203.
 */
export function isLate(item: ReviewItem, today: string = todayISO()): boolean {
  if (item.state === 'overdue') return true;
  return item.state === 'rejected' && !!item.dueDate && item.dueDate < today;
}

/** Every late item on the trip, across every traveler. */
export function countLate(review: TravelerReview[], today: string = todayISO()): number {
  return review.reduce(
    (n, t) => n + t.items.reduce((m, i) => m + (isLate(i, today) ? 1 : 0), 0),
    0,
  );
}

/** Late items for one traveler. */
export function lateForTraveler(
  docs: TravelerReview | null,
  today: string = todayISO(),
): number {
  if (!docs) return 0;
  return docs.items.reduce((n, i) => n + (isLate(i, today) ? 1 : 0), 0);
}

/**
 * Worst first. Lower rank sorts higher.
 *
 * NOT-STARTED (2) OUTRANKS WAITING-ON-THE-OPERATOR (3) ON PURPOSE. Saying yes
 * to a file takes five seconds and the review banner already sends the operator
 * straight to that queue. Getting somebody to send one takes days of chasing,
 * and this list is the only place that work is visible at all.
 *
 * `null` docs rank last: while `review` is loading every traveler is null and
 * the order is meaningless anyway, so this must not shuffle them.
 */
export function travelerWorkRank(
  docs: TravelerReview | null,
  today: string = todayISO(),
): number {
  if (!docs) return 4;
  let rejected = false;
  let notStarted = false;
  for (const i of docs.items) {
    if (isLate(i, today)) return 0; // nothing outranks late — stop looking
    if (i.state === 'rejected') rejected = true;
    else if (i.state === 'not_started') notStarted = true;
  }
  if (rejected) return 1;
  if (notStarted) return 2;
  if (docs.toReview > 0) return 3;
  return 4;
}

/**
 * Travelers in the order the operator should work through them.
 *
 * Alphabetical INSIDE each rank, so the list is still stable and scannable
 * rather than re-shuffling every time a state changes.
 */
export function sortTravelers<T extends { userId: string; name: string | null }>(
  travelers: T[],
  byUser: Map<string, TravelerReview>,
  mode: SortMode,
  today: string = todayISO(),
): T[] {
  const byName = (a: T, b: T) => (a.name ?? '').localeCompare(b.name ?? '');
  if (mode === 'alpha') return [...travelers].sort(byName);
  return [...travelers].sort((a, b) => {
    const ra = travelerWorkRank(byUser.get(a.userId) ?? null, today);
    const rb = travelerWorkRank(byUser.get(b.userId) ?? null, today);
    return ra !== rb ? ra - rb : byName(a, b);
  });
}

export type TripPhase =
  | { kind: 'upcoming'; days: number }
  | { kind: 'today' }
  | { kind: 'under_way' }
  | { kind: 'ended' }
  | { kind: 'unknown' };

/**
 * Where the trip is relative to today.
 *
 * `'unknown'` when there is no start date — a trip still being planned. The
 * caller drops the countdown and keeps the late count, rather than inventing a
 * number.
 */
export function tripPhase(
  startDateISO: string | null | undefined,
  endDateISO: string | null | undefined,
  today: string = todayISO(),
): TripPhase {
  if (!startDateISO) return { kind: 'unknown' };
  const start = parseLocalDate(startDateISO);
  const now = parseLocalDate(today);
  if (!start || !now) return { kind: 'unknown' };

  // Ended first: a finished trip is finished whatever its start date says.
  if (endDateISO && endDateISO < today) return { kind: 'ended' };

  // Both are local midnights, so rounding absorbs any DST hour in between.
  const days = Math.round((start.getTime() - now.getTime()) / 86_400_000);
  if (days > 0) return { kind: 'upcoming', days };
  if (days === 0) return { kind: 'today' };
  return { kind: 'under_way' };
}

// ---------------------------------------------------------------------------
// Trip summary — the three figures at the top of the Dashboard
// ---------------------------------------------------------------------------

/**
 * Product Specs §"Trip dashboard space", Frame 39433: "Payments collected
 * $16,800 of $28,000 · Fully paid 2/9 · Travelers 7/12".
 *
 * ⚠️ TWIN of `tripSummary` in the operator dashboard's `domain/money.ts`. The
 * two apps must not disagree about how many people have fully paid, and the
 * only way to guarantee that is one rule written twice and tested twice, the
 * way `late.ts` and `money.ts` already are over there.
 */
export type TripSummary = {
  collectedUsd: number;
  expectedUsd: number;
  /** Travelers whose every pay step is settled. */
  fullyPaid: number;
  /** Travelers who have a price at all — the denominator for `fullyPaid`. */
  priced: number;
  /** What those fully-paid travelers are worth in total. */
  fullyPaidUsd: number;
};

/**
 * Fully paid means every step, not "paid something".
 *
 * A traveler with no price is excluded from BOTH halves of the fraction rather
 * than counted as unpaid: they are the operator's own backlog (`noPriceCount`
 * already says how many), and putting them in the denominator would make a
 * trip where everyone has paid read as 7/9 forever.
 *
 * A traveler on a trip with no pay steps at all counts as fully paid if they
 * have a price and have paid it — `steps` is empty on an offline trip, and
 * `every` over an empty list is true, which is why the price check comes
 * first.
 */
export function tripSummary(money: {
  travelers: { totalUsd: number | null; paidUsd: number; steps: { state: string }[] }[];
  collectedUsd: number;
  expectedUsd: number;
}): TripSummary {
  let fullyPaid = 0;
  let priced = 0;
  let fullyPaidUsd = 0;

  for (const t of money.travelers) {
    if (t.totalUsd === null) continue;
    priced += 1;
    const settled =
      t.steps.length > 0
        ? t.steps.every(s => s.state === 'paid')
        : t.paidUsd >= t.totalUsd && t.totalUsd > 0;
    if (settled) {
      fullyPaid += 1;
      fullyPaidUsd += t.totalUsd;
    }
  }

  return {
    collectedUsd: money.collectedUsd,
    expectedUsd: money.expectedUsd,
    fullyPaid,
    priced,
    fullyPaidUsd,
  };
}

/**
 * How many travelers to show against the cap, and how many the cap cannot see.
 *
 * `group_trips.participant_count` deliberately excludes anyone still at
 * `status = 'onboarding'` — approval on an operator trip takes no seat, which
 * is right for capacity and wrong for every other use of the number. The trip
 * page then reads "2/12 going" while eight people are actively paying.
 *
 * So the tile shows the seat count, which is the honest answer to "how full is
 * this trip", and names the onboarding group separately instead of hiding it.
 * Callers pass the roster they already hold; nothing is fetched for this.
 */
export function travelerCounts(args: {
  /** Everyone on the trip's roster, travelers only — hosts and crew excluded. */
  travelers: { status?: string | null }[];
  maxParticipants?: number | null;
}): { going: number; onboarding: number; capacity: number | null } {
  let going = 0;
  let onboarding = 0;
  for (const t of args.travelers) {
    if (t.status === 'onboarding') onboarding += 1;
    else going += 1;
  }
  return { going, onboarding, capacity: args.maxParticipants ?? null };
}
