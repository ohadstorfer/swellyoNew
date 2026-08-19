/**
 * What is late, and where the trip is in time.
 *
 * The desktop twin of the app's `src/components/trips/dashboard/dashboardWork.ts`.
 * Same rule, same edge cases, so the phone and this site never disagree about
 * who is behind.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID: `RequirementState` has an `'overdue'`
 * value and `deriveState` already computes it, so "count the late ones" looks
 * like `state === 'overdue'`. It is not. Read `deriveState` — `'overdue'` is
 * only ever reached when the traveler has sent NOTHING. Someone who sent a
 * blurry passport, had it rejected and never sent another reads `'rejected'`
 * for ever, months past the deadline. That is the person most likely to miss
 * the flight, and the obvious version of this count cannot see them.
 *
 * `pay` rows can never be late here: `fetchTripReview` hardcodes them to
 * `not_started` because it does not load the ledger. Whether money deadlines
 * should ever read as late is decision D3 in dashboard-tab-ux.md.
 */
import { todayISO, type RequirementState } from './requirements';

/** The two fields lateness is decided from. Both `ReviewItem` and anything
 *  else carrying a state and a deadline satisfy this. */
export type LateCandidate = {
  state: RequirementState;
  dueDate: string | null;
};

/**
 * Is this item late?
 *
 * `'overdue'` — sent nothing, deadline passed. Plus the case `deriveState`
 * cannot express: rejected, never resent, deadline passed.
 *
 * Date strings compare correctly with `<` because `YYYY-MM-DD` sorts
 * lexicographically — the same test `deriveState` makes.
 */
export function isLate(item: LateCandidate, today: string = todayISO()): boolean {
  if (item.state === 'overdue') return true;
  return item.state === 'rejected' && !!item.dueDate && item.dueDate < today;
}

/** Late items for one traveler. */
export function countLateItems(
  items: LateCandidate[],
  today: string = todayISO(),
): number {
  return items.reduce((n, i) => n + (isLate(i, today) ? 1 : 0), 0);
}

/** Every late item on the trip, across every traveler. */
export function countLate(
  travelers: { items: LateCandidate[] }[],
  today: string = todayISO(),
): number {
  return travelers.reduce((n, t) => n + countLateItems(t.items, today), 0);
}

export type TripPhase =
  | { kind: 'upcoming'; days: number }
  | { kind: 'today' }
  | { kind: 'under_way' }
  | { kind: 'ended' }
  | { kind: 'unknown' };

/**
 * A local calendar date from a `YYYY-MM-DD` string.
 *
 * `new Date('2026-08-19')` parses as UTC midnight, which is the previous
 * evening for anyone west of Greenwich — so a trip leaving tomorrow would read
 * as leaving today.
 */
function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

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
