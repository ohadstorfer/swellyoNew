/**
 * When the trip-level actions apply. Twinned with TripDetailScreen in the app:
 * `tripHasStarted`, `isLocked` (cancelled || completed || isTripPast) and the
 * header menu's "Complete trip" gate. Keep the two in step.
 *
 * Dates are compared as `YYYY-MM-DD` strings against the viewer's local today.
 * The app compares Date objects at local midnight, which is the same answer
 * without the UTC-midnight parse that `new Date('2026-11-18')` brings.
 */

export type TripDates = {
  status: string | null;
  startDate: string | null;
  endDate: string | null;
};

/** Local today as `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const day = (iso: string) => iso.slice(0, 10);

/** The app's `tripHasStarted`. No start date → true: "let the host decide". */
export function tripHasStarted(trip: TripDates, today = localToday()): boolean {
  if (!trip.startDate) return true;
  return day(trip.startDate) <= today;
}

/** The app's `isTripPast`: the end date is before today. No end date → false. */
export function tripIsPast(trip: TripDates, today = localToday()): boolean {
  if (!trip.endDate) return false;
  return day(trip.endDate) < today;
}

/** The app's `isLocked`. Nothing on a locked trip can be completed or cancelled. */
export function tripIsLocked(trip: TripDates, today = localToday()): boolean {
  return (
    trip.status === 'cancelled' || trip.status === 'completed' || tripIsPast(trip, today)
  );
}

/**
 * "Complete trip" — a host, once the trip is underway and still live.
 * `isHost` is the app's flat multi-host: `host_id` OR a `role = 'host'` row.
 */
export function canCompleteTrip(trip: TripDates, isHost: boolean, today = localToday()): boolean {
  return isHost && tripHasStarted(trip, today) && !tripIsLocked(trip, today);
}

/**
 * Who a reminder can go to. The same three states the two remind RPCs select
 * (`not_started`, `overdue`, `rejected`) — a narrower count would say "Remind 3"
 * and send 5. Pay rows are refused by the server (errcode 0A000) because
 * `fetchTripReview` never loads the ledger, so their state is meaningless here.
 */
export function isRemindable(item: { state: string; reqType: string }): boolean {
  if (item.reqType === 'pay') return false;
  return item.state === 'not_started' || item.state === 'overdue' || item.state === 'rejected';
}
