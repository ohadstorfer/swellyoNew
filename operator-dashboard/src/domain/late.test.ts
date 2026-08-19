import { describe, it, expect } from 'vitest';
import { countLate, countLateItems, isLate, tripPhase, type LateCandidate } from './late';

const TODAY = '2026-08-19';

const item = (o: Partial<LateCandidate> = {}): LateCandidate => ({
  state: 'not_started',
  dueDate: null,
  ...o,
});

describe('isLate', () => {
  it('counts overdue', () => {
    expect(isLate(item({ state: 'overdue' }), TODAY)).toBe(true);
  });

  it('counts a rejection whose deadline has passed', () => {
    // The whole reason this file exists: `deriveState` can never call this
    // person overdue, and they are the likeliest to miss the flight.
    expect(isLate(item({ state: 'rejected', dueDate: '2026-08-01' }), TODAY)).toBe(true);
  });

  it('does not count a rejection still inside its deadline', () => {
    expect(isLate(item({ state: 'rejected', dueDate: '2026-09-01' }), TODAY)).toBe(false);
  });

  it('does not count a rejection with no deadline at all', () => {
    expect(isLate(item({ state: 'rejected', dueDate: null }), TODAY)).toBe(false);
  });

  it('does not count the due date itself as passed', () => {
    expect(isLate(item({ state: 'rejected', dueDate: TODAY }), TODAY)).toBe(false);
  });

  it('never counts something already sent or approved', () => {
    expect(isLate(item({ state: 'submitted', dueDate: '2026-01-01' }), TODAY)).toBe(false);
    expect(isLate(item({ state: 'approved', dueDate: '2026-01-01' }), TODAY)).toBe(false);
    expect(isLate(item({ state: 'not_started', dueDate: '2026-01-01' }), TODAY)).toBe(false);
  });
});

describe('counting', () => {
  it('adds up one traveler', () => {
    expect(
      countLateItems(
        [
          item({ state: 'overdue' }),
          item({ state: 'rejected', dueDate: '2026-08-01' }),
          item({ state: 'approved' }),
        ],
        TODAY,
      ),
    ).toBe(2);
  });

  it('adds up the trip', () => {
    expect(
      countLate(
        [
          { items: [item({ state: 'overdue' })] },
          { items: [item({ state: 'approved' }), item({ state: 'overdue' })] },
          { items: [] },
        ],
        TODAY,
      ),
    ).toBe(2);
  });
});

describe('tripPhase', () => {
  it('counts the days to departure', () => {
    expect(tripPhase('2026-08-31', '2026-09-07', TODAY)).toEqual({ kind: 'upcoming', days: 12 });
  });

  it('knows today', () => {
    expect(tripPhase(TODAY, '2026-08-26', TODAY)).toEqual({ kind: 'today' });
  });

  it('knows a trip that is running', () => {
    expect(tripPhase('2026-08-15', '2026-08-26', TODAY)).toEqual({ kind: 'under_way' });
  });

  it('knows a trip that is over', () => {
    expect(tripPhase('2026-07-01', '2026-07-08', TODAY)).toEqual({ kind: 'ended' });
  });

  it('says nothing without a start date', () => {
    expect(tripPhase(null, null, TODAY)).toEqual({ kind: 'unknown' });
    expect(tripPhase('nonsense', null, TODAY)).toEqual({ kind: 'unknown' });
  });

  it('treats an end date as local, not UTC', () => {
    // The trip ends today: it is under way, not ended. A UTC parse would put
    // the boundary in the wrong place for anyone west of Greenwich.
    expect(tripPhase('2026-08-15', TODAY, TODAY)).toEqual({ kind: 'under_way' });
  });
});
