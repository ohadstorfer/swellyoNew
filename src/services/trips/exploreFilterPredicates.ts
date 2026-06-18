/**
 * Explore month/budget filter predicates — the single source of truth shared by
 * the client (TripsScreen chips) and the parity test that guards the explore_feed
 * SQL port.
 *
 * Two layers live here on purpose:
 *   1. The original JS predicates (tripInMonth / tripBudgetBand / tripInBudget)
 *      that used to filter the loaded page client-side.
 *   2. A pure TS PORT of the SQL WHERE clauses now in the explore_feed RPC
 *      (sqlMonthMatch / sqlBudgetMatch), expressed against the same trip fields.
 *
 * exploreFilterPredicates.test.ts asserts (1) and (2) agree for a fixed trip set,
 * so the server and the (now-removed) client filtering can never silently diverge.
 * If you change one, change the other and the SQL migration together.
 */

export const BUDGET_THRESHOLD = 1000; // $ — the below/above split point (boundary inclusive)

/** The trip fields the month/budget filters read — a structural subset of GroupTrip. */
export interface FilterableTrip {
  date_months?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  cost_per_person?: number | null;
  budget_min?: number | null;
  budget_max?: number | null;
}

// ---------------------------------------------------------------------------
// (1) Original JS predicates (client-side semantics)
//
// NOTE: tripInMonth / tripBudgetBand / tripInBudget are no longer on the
// production path (filtering now happens server-side in explore_feed). They are
// retained ONLY as the reference oracle for the SQL-port parity test
// (exploreFilterPredicates.test.ts). Do not wire them back into the UI.
// ---------------------------------------------------------------------------

// A trip happens in month "YYYY-MM" if its loose months list includes it, or if
// the month falls within the firm start..end range. No dates ⇒ matches nothing.
export const tripInMonth = (trip: FilterableTrip, ym: string): boolean => {
  if (trip.date_months?.some(m => m === ym)) return true;
  if (trip.start_date && trip.end_date) {
    return ym >= trip.start_date.slice(0, 7) && ym <= trip.end_date.slice(0, 7);
  }
  return false;
};

// Collapse the three budget shapes into one [min, max] band: a flat per-person
// price is a zero-width band; otherwise the min/max pair (single-sided fallback).
export const tripBudgetBand = (trip: FilterableTrip): [number, number] | null => {
  if (trip.cost_per_person != null) return [trip.cost_per_person, trip.cost_per_person];
  const lo = trip.budget_min;
  const hi = trip.budget_max;
  if (lo != null || hi != null) {
    const min = lo ?? hi!;
    const max = hi ?? lo!;
    return [min, max];
  }
  return null;
};

// "below" = band low end <= threshold; "above" = band high end >= threshold.
// Boundary inclusive both ways. No band ⇒ matches nothing.
export const tripInBudget = (trip: FilterableTrip, value: string): boolean => {
  const band = tripBudgetBand(trip);
  if (!band) return false;
  return value === 'below' ? band[0] <= BUDGET_THRESHOLD : band[1] >= BUDGET_THRESHOLD;
};

// ---------------------------------------------------------------------------
// (2) TS port of the explore_feed RPC WHERE clauses (server semantics)
// ---------------------------------------------------------------------------

/** Port of the SQL month WHERE clause. `months` = selected "YYYY-MM" set, OR'd.
 *  Empty/undefined ⇒ filter off (every trip passes). */
export const sqlMonthMatch = (trip: FilterableTrip, months: string[] | null | undefined): boolean => {
  if (!months || months.length === 0) return true; // p_months NULL/empty ⇒ off
  // gt.date_months && p_months  (array overlap)
  if (trip.date_months && trip.date_months.some(m => months.includes(m))) return true;
  // firm start..end covers any selected month (truncated to YYYY-MM)
  if (trip.start_date != null && trip.end_date != null) {
    const lo = trip.start_date.slice(0, 7);
    const hi = trip.end_date.slice(0, 7);
    return months.some(ym => ym >= lo && ym <= hi);
  }
  return false;
};

/** Port of the SQL budget WHERE clause. `budgetMin` = "above" bound (band_hi >=),
 *  `budgetMax` = "below" bound (band_lo <=). Both null ⇒ filter off. */
export const sqlBudgetMatch = (
  trip: FilterableTrip,
  budgetMin: number | null | undefined,
  budgetMax: number | null | undefined,
): boolean => {
  if (budgetMin == null && budgetMax == null) return true; // both NULL ⇒ off
  const hasBand =
    trip.cost_per_person != null || trip.budget_min != null || trip.budget_max != null;
  if (!hasBand) return false;
  // band_lo = COALESCE(cost_per_person, budget_min, budget_max)
  const bandLo = trip.cost_per_person ?? trip.budget_min ?? trip.budget_max!;
  // band_hi = COALESCE(cost_per_person, budget_max, budget_min)
  const bandHi = trip.cost_per_person ?? trip.budget_max ?? trip.budget_min!;
  const below = budgetMax != null && bandLo <= budgetMax;
  const above = budgetMin != null && bandHi >= budgetMin;
  return below || above;
};
