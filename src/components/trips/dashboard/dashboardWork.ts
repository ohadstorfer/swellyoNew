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
