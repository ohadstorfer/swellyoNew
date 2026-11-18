/**
 * The slider / calendar / age filters in explore_feed (migration
 * 20261113000000_explore_feed_slider_dates_age), via their TS ports.
 * Change these together with the SQL.
 */
import {
  sqlPriceRangeMatch,
  sqlDateRangeMatch,
  sqlAgeRangeMatch,
} from '../../../services/trips/exploreFilterPredicates';

describe('budget slider (price band overlaps the range)', () => {
  it('is off when both ends are open', () => {
    expect(sqlPriceRangeMatch({}, null, null)).toBe(true);
  });
  it('a flat price must sit inside the range, ends inclusive', () => {
    const t = { cost_per_person: 2000 };
    expect(sqlPriceRangeMatch(t, 1000, 3000)).toBe(true);
    expect(sqlPriceRangeMatch(t, 2000, 2000)).toBe(true);
    expect(sqlPriceRangeMatch(t, 2500, null)).toBe(false);
    expect(sqlPriceRangeMatch(t, null, 1500)).toBe(false);
  });
  it('a min/max band passes when it overlaps', () => {
    const t = { budget_min: 1000, budget_max: 3000 };
    expect(sqlPriceRangeMatch(t, 2500, 5000)).toBe(true);
    expect(sqlPriceRangeMatch(t, 3500, null)).toBe(false);
  });
  it('a trip with no price never matches an active slider', () => {
    expect(sqlPriceRangeMatch({}, 0 + 250, null)).toBe(false);
  });
});

describe('dates calendar', () => {
  const firm = { start_date: '2026-12-10', end_date: '2026-12-17' };
  const loose = { date_months: ['2027-01', '2027-02'] };
  it('firm dates overlap the picked days', () => {
    expect(sqlDateRangeMatch(firm, '2026-12-15', '2026-12-30')).toBe(true);
    expect(sqlDateRangeMatch(firm, '2026-12-18', '2026-12-30')).toBe(false);
    expect(sqlDateRangeMatch(firm, '2026-12-17', null)).toBe(true); // single day
  });
  it('loose months overlap the picked months', () => {
    expect(sqlDateRangeMatch(loose, '2026-12-20', '2027-01-05')).toBe(true);
    expect(sqlDateRangeMatch(loose, '2027-03-01', '2027-03-09')).toBe(false);
  });
  it('a trip with no dates never matches an active filter', () => {
    expect(sqlDateRangeMatch({}, '2026-12-01', '2026-12-31')).toBe(false);
    expect(sqlDateRangeMatch({}, null, null)).toBe(true);
  });
});

describe('age range', () => {
  it('a trip with no age limit is all ages and always passes', () => {
    expect(sqlAgeRangeMatch({}, 30, 40)).toBe(true);
    expect(sqlAgeRangeMatch({ age_min: null, age_max: null }, 18, 22)).toBe(true);
  });
  it('a limited trip must overlap the picked range', () => {
    const t = { age_min: 25, age_max: 35 };
    expect(sqlAgeRangeMatch(t, 30, 50)).toBe(true);
    expect(sqlAgeRangeMatch(t, 36, null)).toBe(false);
    expect(sqlAgeRangeMatch(t, null, 24)).toBe(false);
  });
  it('a one-sided trip limit only checks that side', () => {
    expect(sqlAgeRangeMatch({ age_min: 30 }, null, 28)).toBe(false);
    expect(sqlAgeRangeMatch({ age_min: 30 }, 60, null)).toBe(true);
  });
});
