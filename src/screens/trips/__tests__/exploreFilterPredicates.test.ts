/**
 * Parity test for Workstream 2 Task 2.4 — pushing month/budget filters into the
 * explore_feed RPC.
 *
 * The RPC's WHERE clauses are a port of the OLD client-side JS predicates
 * (tripInMonth / tripInBudget). If the two ever diverged, a filter would return a
 * different set on the server than the client expects → the feature feels broken.
 *
 * Since we can't run SQL here, the SQL WHERE clauses are mirrored as pure TS
 * (sqlMonthMatch / sqlBudgetMatch in exploreFilterPredicates.ts). This test asserts
 * those ports agree with the original JS predicates for a fixed, adversarial trip
 * set — boundary prices, flexible date ranges, single-sided budgets, no-date and
 * no-budget trips. Keep this passing whenever you touch the predicates OR the
 * explore_feed migration.
 */
import {
  BUDGET_THRESHOLD,
  FilterableTrip,
  tripInMonth,
  tripInBudget,
  sqlMonthMatch,
  sqlBudgetMatch,
} from '../../../services/trips/exploreFilterPredicates';

// JS reference: a trip passes the month group if ANY selected month matches
// (mirrors applyExploreFilters' `months.some(...)`). Empty selection = off.
const jsMonthGroup = (trip: FilterableTrip, months: string[]): boolean =>
  months.length === 0 || months.some(ym => tripInMonth(trip, ym));

// JS reference: a trip passes the budget group if ANY selected budget chip
// matches (mirrors `budgets.some(...)`). Empty selection = off.
const jsBudgetGroup = (trip: FilterableTrip, budgets: string[]): boolean =>
  budgets.length === 0 || budgets.some(v => tripInBudget(trip, v));

// Map the budget chip selection to the RPC's threshold bounds, exactly like
// deriveExploreFilterKey in TripsScreen.
const budgetBounds = (budgets: string[]): { min: number | null; max: number | null } => ({
  min: budgets.includes('above') ? BUDGET_THRESHOLD : null, // band_hi >= min
  max: budgets.includes('below') ? BUDGET_THRESHOLD : null, // band_lo <= max
});

const TRIPS: FilterableTrip[] = [
  // loose months only
  { date_months: ['2026-07', '2026-08'] },
  { date_months: ['2026-12'] },
  // firm range spanning two months
  { start_date: '2026-06-20', end_date: '2026-07-05' },
  // firm range single month
  { start_date: '2026-09-10', end_date: '2026-09-20' },
  // no dates at all (matches no month)
  { date_months: null, start_date: null, end_date: null },
  // single-sided firm dates: only enter the firm-range branch when BOTH dates are
  // set, so these match NO month filter (start-only and end-only).
  { start_date: '2026-07-01', end_date: null },
  { start_date: null, end_date: '2026-07-31' },
  // budget shapes
  { cost_per_person: 1000 },                  // exactly on threshold → both chips
  { cost_per_person: 999 },                   // below only
  { cost_per_person: 1001 },                  // above only
  { budget_min: 500, budget_max: 2000 },      // band straddles threshold → both
  { budget_min: 200, budget_max: 800 },       // below only
  { budget_min: 1500, budget_max: 3000 },     // above only
  { budget_min: 1000, budget_max: null },     // single-sided, on threshold
  { budget_min: null, budget_max: 1000 },     // single-sided, on threshold
  // no budget at all (matches no budget chip)
  { cost_per_person: null, budget_min: null, budget_max: null },
  // combined: loose month + budget
  { date_months: ['2026-07'], budget_min: 600, budget_max: 1200 },
];

// Every month chip combination we can produce from the rolling chips.
const MONTH_SETS: string[][] = [
  [],
  ['2026-07'],
  ['2026-08'],
  ['2026-09'],
  ['2026-12'],
  ['2026-07', '2026-08'],
  ['2026-06', '2026-07', '2026-09'],
];

const BUDGET_SETS: string[][] = [[], ['below'], ['above'], ['below', 'above']];

describe('explore filter parity: SQL port vs original JS predicates', () => {
  it('month predicate: SQL port agrees with JS for every trip × month-set', () => {
    for (const trip of TRIPS) {
      for (const months of MONTH_SETS) {
        expect(sqlMonthMatch(trip, months)).toBe(jsMonthGroup(trip, months));
      }
    }
  });

  it('budget predicate: SQL port agrees with JS for every trip × budget-set', () => {
    for (const trip of TRIPS) {
      for (const budgets of BUDGET_SETS) {
        const { min, max } = budgetBounds(budgets);
        expect(sqlBudgetMatch(trip, min, max)).toBe(jsBudgetGroup(trip, budgets));
      }
    }
  });

  it('combined AND across groups: SQL port agrees with JS', () => {
    for (const trip of TRIPS) {
      for (const months of MONTH_SETS) {
        for (const budgets of BUDGET_SETS) {
          const { min, max } = budgetBounds(budgets);
          const sql = sqlMonthMatch(trip, months) && sqlBudgetMatch(trip, min, max);
          const js = jsMonthGroup(trip, months) && jsBudgetGroup(trip, budgets);
          expect(sql).toBe(js);
        }
      }
    }
  });

  // Spot-check the boundary semantics the RPC must preserve (inclusive both ways).
  it('a trip priced exactly at the threshold matches BOTH below and above', () => {
    const onThreshold: FilterableTrip = { cost_per_person: BUDGET_THRESHOLD };
    expect(sqlBudgetMatch(onThreshold, null, BUDGET_THRESHOLD)).toBe(true); // below
    expect(sqlBudgetMatch(onThreshold, BUDGET_THRESHOLD, null)).toBe(true); // above
  });

  it('single-sided firm dates never match a month filter (need BOTH dates)', () => {
    const startOnly: FilterableTrip = { start_date: '2026-07-01', end_date: null };
    const endOnly: FilterableTrip = { start_date: null, end_date: '2026-07-31' };
    // The covering month is 2026-07, yet only-one-side trips must NOT enter the
    // firm-range branch — SQL port and JS predicate must agree on that.
    expect(sqlMonthMatch(startOnly, ['2026-07'])).toBe(false);
    expect(jsMonthGroup(startOnly, ['2026-07'])).toBe(false);
    expect(sqlMonthMatch(endOnly, ['2026-07'])).toBe(false);
    expect(jsMonthGroup(endOnly, ['2026-07'])).toBe(false);
  });

  it('no-budget / no-date trips never match an ACTIVE filter', () => {
    const blank: FilterableTrip = {};
    expect(sqlMonthMatch(blank, ['2026-07'])).toBe(false);
    expect(sqlBudgetMatch(blank, BUDGET_THRESHOLD, BUDGET_THRESHOLD)).toBe(false);
    // ...but pass when the filter is OFF (empty selection).
    expect(sqlMonthMatch(blank, [])).toBe(true);
    expect(sqlBudgetMatch(blank, null, null)).toBe(true);
  });
});
