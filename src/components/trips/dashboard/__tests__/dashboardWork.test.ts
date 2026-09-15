// "What still needs attention" — the Dashboard's urgency logic.
//
// The one test that matters most is `isLate` on a REJECTED item. `RequirementState`
// has an 'overdue' value and fetchTripReview already computes it, so the obvious
// implementation is `state === 'overdue'` — and it is wrong. 'overdue' is only
// ever reached when the traveler sent NOTHING (tripDocumentsService.ts:1241 /
// 1256 / 1270). Someone who sent a blurry passport, had it rejected, and never
// sent another reads 'rejected' forever, months past the deadline.
//
// That traveler is the most likely of anyone on the trip to be turned away at a
// border, and the obvious version of this count cannot see them.

jest.mock('../../../../config/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('expo-web-browser', () => ({}));
jest.mock('expo-linking', () => ({ createURL: () => '' }));

import {
  isLate,
  countLate,
  lateForTraveler,
  travelerWorkRank,
  sortTravelers,
  tripPhase,
  tripSummary,
  travelerCounts,
} from '../dashboardWork';
import type { ReviewItem, TravelerReview } from '../../../../services/trips/tripDocumentsService';

const TODAY = '2026-08-05';

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  requirementId: 'r1',
  kind: 'passport',
  reqType: 'upload',
  title: 'Passport',
  dueDate: null,
  state: 'not_started',
  documentId: null,
  storagePath: null,
  submittedAt: null,
  reviewedAt: null,
  note: null,
  fileDeleted: false,
  ...over,
});

const traveler = (userId: string, items: ReviewItem[]): TravelerReview => ({
  userId,
  items,
  toReview: items.filter(i => i.state === 'submitted').length,
  done: items.filter(i => i.state === 'approved').length,
  total: items.length,
});

describe('isLate', () => {
  it('counts an overdue item', () => {
    expect(isLate(item({ state: 'overdue' }), TODAY)).toBe(true);
  });

  it('counts a REJECTED item whose deadline has passed', () => {
    // The whole reason this function exists rather than `state === 'overdue'`.
    expect(isLate(item({ state: 'rejected', dueDate: '2026-07-01' }), TODAY)).toBe(true);
  });

  it('does not count a rejected item that still has time', () => {
    expect(isLate(item({ state: 'rejected', dueDate: '2026-09-01' }), TODAY)).toBe(false);
  });

  it('does not count a rejected item with no deadline at all', () => {
    expect(isLate(item({ state: 'rejected', dueDate: null }), TODAY)).toBe(false);
  });

  it('does not count something due today — a deadline is not missed until it passes', () => {
    expect(isLate(item({ state: 'rejected', dueDate: TODAY }), TODAY)).toBe(false);
  });

  it('does not count work already done or waiting on the operator', () => {
    expect(isLate(item({ state: 'approved', dueDate: '2026-07-01' }), TODAY)).toBe(false);
    expect(isLate(item({ state: 'submitted', dueDate: '2026-07-01' }), TODAY)).toBe(false);
    expect(isLate(item({ state: 'not_started' }), TODAY)).toBe(false);
  });
});

describe('countLate / lateForTraveler', () => {
  const review = [
    traveler('a', [item({ state: 'overdue' }), item({ state: 'approved' })]),
    traveler('b', [item({ state: 'rejected', dueDate: '2026-01-01' })]),
    traveler('c', [item({ state: 'submitted' })]),
  ];

  it('adds up every late item across the trip', () => {
    expect(countLate(review, TODAY)).toBe(2);
  });

  it('counts one traveler at a time', () => {
    expect(lateForTraveler(review[0], TODAY)).toBe(1);
    expect(lateForTraveler(review[2], TODAY)).toBe(0);
  });

  it('is zero for a traveler with no review row', () => {
    expect(lateForTraveler(null, TODAY)).toBe(0);
  });
});

describe('travelerWorkRank', () => {
  it('puts late first, whatever else is going on', () => {
    expect(
      travelerWorkRank(traveler('a', [item({ state: 'overdue' }), item({ state: 'submitted' })]), TODAY),
    ).toBe(0);
  });

  it('ranks rejected-with-time-left above not-started', () => {
    expect(travelerWorkRank(traveler('a', [item({ state: 'rejected', dueDate: '2026-09-01' })]), TODAY)).toBe(1);
    expect(travelerWorkRank(traveler('b', [item({ state: 'not_started' })]), TODAY)).toBe(2);
  });

  it('ranks not-started WORSE than waiting-on-the-operator', () => {
    // Deliberate. Approving takes five seconds and the review banner already
    // links straight to that queue; chasing takes days and this list is the
    // only place it is visible.
    const notStarted = travelerWorkRank(traveler('a', [item({ state: 'not_started' })]), TODAY);
    const waitingOnUs = travelerWorkRank(traveler('b', [item({ state: 'submitted' })]), TODAY);
    expect(notStarted).toBeLessThan(waitingOnUs);
  });

  it('ranks a finished traveler last', () => {
    expect(travelerWorkRank(traveler('a', [item({ state: 'approved' })]), TODAY)).toBe(4);
  });

  it('ranks an unknown traveler last so a loading list does not shuffle', () => {
    expect(travelerWorkRank(null, TODAY)).toBe(4);
  });
});

describe('sortTravelers', () => {
  const people = [
    { userId: 'zoe', name: 'Zoe' },
    { userId: 'amy', name: 'Amy' },
    { userId: 'bob', name: 'Bob' },
  ];
  const byUser = new Map<string, TravelerReview>([
    ['zoe', traveler('zoe', [item({ state: 'overdue' })])],
    ['amy', traveler('amy', [item({ state: 'approved' })])],
    ['bob', traveler('bob', [item({ state: 'not_started' })])],
  ]);

  it('puts the worst first, not the alphabet', () => {
    expect(sortTravelers(people, byUser, 'work', TODAY).map(p => p.userId)).toEqual([
      'zoe', // late
      'bob', // not started
      'amy', // done
    ]);
  });

  it('sorts alphabetically inside a rank, so the list stays scannable', () => {
    const tied = [
      { userId: 'zed', name: 'Zed' },
      { userId: 'ana', name: 'Ana' },
    ];
    const m = new Map<string, TravelerReview>([
      ['zed', traveler('zed', [item({ state: 'not_started' })])],
      ['ana', traveler('ana', [item({ state: 'not_started' })])],
    ]);
    expect(sortTravelers(tied, m, 'work', TODAY).map(p => p.userId)).toEqual(['ana', 'zed']);
  });

  it('honours the A–Z toggle', () => {
    expect(sortTravelers(people, byUser, 'alpha', TODAY).map(p => p.userId)).toEqual([
      'amy',
      'bob',
      'zoe',
    ]);
  });

  it('does not mutate the array it was given', () => {
    const original = [...people];
    sortTravelers(people, byUser, 'work', TODAY);
    expect(people).toEqual(original);
  });
});

describe('tripPhase', () => {
  it('counts the days to a future trip', () => {
    expect(tripPhase('2026-08-19', '2026-08-26', TODAY)).toEqual({ kind: 'upcoming', days: 14 });
  });

  it('knows departure day', () => {
    expect(tripPhase(TODAY, '2026-08-12', TODAY)).toEqual({ kind: 'today' });
  });

  it('knows the trip is under way', () => {
    expect(tripPhase('2026-08-01', '2026-08-12', TODAY)).toEqual({ kind: 'under_way' });
  });

  it('knows the trip is over', () => {
    expect(tripPhase('2026-07-01', '2026-07-08', TODAY)).toEqual({ kind: 'ended' });
  });

  it('is unknown with no start date, rather than inventing a countdown', () => {
    expect(tripPhase(null, null, TODAY)).toEqual({ kind: 'unknown' });
    expect(tripPhase(undefined, undefined, TODAY)).toEqual({ kind: 'unknown' });
  });

  it('treats a started trip with no end date as under way, not ended', () => {
    expect(tripPhase('2026-08-01', null, TODAY)).toEqual({ kind: 'under_way' });
  });

  it('parses dates in LOCAL time', () => {
    // `new Date('2026-08-06')` is UTC midnight — the evening of the 5th for
    // anyone west of Greenwich, which would report "0 days to go" on a trip
    // that leaves tomorrow.
    expect(tripPhase('2026-08-06', '2026-08-13', TODAY)).toEqual({ kind: 'upcoming', days: 1 });
  });
});


// ---------------------------------------------------------------------------
// Trip summary — Frame 39433
// ---------------------------------------------------------------------------

const payer = (
  totalUsd: number | null,
  paidUsd: number,
  steps: { state: string }[] = [],
) => ({ totalUsd, paidUsd, steps });

describe('tripSummary', () => {
  it('counts a traveler as fully paid only when EVERY step is settled', () => {
    const s = tripSummary({
      collectedUsd: 1000,
      expectedUsd: 6000,
      travelers: [
        payer(3000, 3000, [{ state: 'paid' }, { state: 'paid' }]),
        payer(3000, 500, [{ state: 'paid' }, { state: 'unpaid' }]),
      ],
    });
    expect(s.fullyPaid).toBe(1);
    expect(s.priced).toBe(2);
    expect(s.fullyPaidUsd).toBe(3000);
  });

  it('leaves a traveler with no price out of BOTH halves of the fraction', () => {
    // The alternative — counting them as unpaid — makes a trip where everyone
    // who owes anything has paid read as 1/2 forever.
    const s = tripSummary({
      collectedUsd: 3000,
      expectedUsd: 3000,
      travelers: [
        payer(3000, 3000, [{ state: 'paid' }]),
        payer(null, 0, [{ state: 'no_price' }]),
      ],
    });
    expect(s.fullyPaid).toBe(1);
    expect(s.priced).toBe(1);
  });

  it('falls back to the paid total on an offline trip, which has no steps', () => {
    const s = tripSummary({
      collectedUsd: 0,
      expectedUsd: 2000,
      travelers: [payer(2000, 2000, []), payer(2000, 1000, [])],
    });
    expect(s.fullyPaid).toBe(1);
  });

  it('does not call a zero-price traveler fully paid', () => {
    const s = tripSummary({
      collectedUsd: 0,
      expectedUsd: 0,
      travelers: [payer(0, 0, [])],
    });
    expect(s.fullyPaid).toBe(0);
    expect(s.priced).toBe(1);
  });

  it('is empty, not broken, on a trip with nobody on it', () => {
    const s = tripSummary({ collectedUsd: 0, expectedUsd: 0, travelers: [] });
    expect(s).toEqual({
      collectedUsd: 0,
      expectedUsd: 0,
      fullyPaid: 0,
      priced: 0,
      fullyPaidUsd: 0,
    });
  });
});

describe('travelerCounts', () => {
  it('separates people mid-onboarding from people holding a seat', () => {
    // This is the whole point: participant_count cannot see the onboarding
    // group, so a trip that is selling well reads as empty.
    const c = travelerCounts({
      travelers: [
        { status: 'approved' },
        { status: 'approved' },
        { status: 'onboarding' },
        { status: 'onboarding' },
        { status: 'onboarding' },
      ],
      maxParticipants: 12,
    });
    expect(c).toEqual({ going: 2, onboarding: 3, capacity: 12 });
  });

  it('treats a missing status as a seat, not as onboarding', () => {
    const c = travelerCounts({ travelers: [{}, { status: null }], maxParticipants: null });
    expect(c).toEqual({ going: 2, onboarding: 0, capacity: null });
  });
});
