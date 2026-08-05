// `buildTripMoney` — the arithmetic behind the host's Dashboard tab.
//
// Worth testing because every failure here is SILENT. A wrong total still
// renders as a plausible number, and the operator's only cross-check is their
// Stripe dashboard by eye. The three traps this covers:
//
//   1. Float drift. Summing dollars gives 0.1 + 0.2 = 0.30000000000000004, and
//      a "paid in full" test that compares those never fires.
//   2. Mode mixing. A Stripe TEST payment lands in the production database, so
//      counting it would show money that does not exist.
//   3. No price. A traveler with no price owes nothing, which must NOT read as
//      paid — the bug that `greatest(..., 0)` caused in SQL.
jest.mock('../../../config/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('expo-web-browser', () => ({}));
jest.mock('expo-linking', () => ({ createURL: () => '' }));

import { buildTripMoney, buildSurfStats, toNumber, type TripMoneyInput } from '../operatorDashboardService';

const DEPOSIT = { requirementId: 'r-dep', kind: 'deposit' as const, title: 'Deposit' };
const BALANCE = { requirementId: 'r-bal', kind: 'balance' as const, title: 'Final payment' };

/** A managed trip with both pay steps and nothing paid, unless overridden. */
function input(over: Partial<TripMoneyInput> = {}): TripMoneyInput {
  return {
    members: [{ userId: 'u1', priceTotalUsd: 1000, depositUsd: 200 }],
    steps: [DEPOSIT, BALANCE],
    trip: { costPerPerson: null, depositAmount: null, paymentMode: 'managed' },
    events: [],
    liveMode: false,
    ...over,
  };
}

function paid(
  userId: string,
  requirementId: string | null,
  amountUsd: number,
  over: { eventType?: string; isLivemode?: boolean } = {},
) {
  return {
    userId,
    requirementId,
    eventType: over.eventType ?? 'paid',
    amountUsd,
    isLivemode: over.isLivemode ?? false,
    createdAt: '2026-08-01T00:00:00Z',
  };
}

describe('buildTripMoney — what each step costs', () => {
  it('splits the price into deposit and the balance after it', () => {
    const m = buildTripMoney(input());
    const [dep, bal] = m.travelers[0].steps;
    expect(dep.dueUsd).toBe(200);
    expect(bal.dueUsd).toBe(800);
  });

  it('charges the whole price as the balance when the trip takes no deposit', () => {
    const m = buildTripMoney(
      input({
        members: [{ userId: 'u1', priceTotalUsd: 1000, depositUsd: null }],
        steps: [BALANCE],
      }),
    );
    expect(m.travelers[0].steps[0].dueUsd).toBe(1000);
  });

  it('falls back to the trip price when the traveler has none of their own', () => {
    const m = buildTripMoney(
      input({
        members: [{ userId: 'u1', priceTotalUsd: null, depositUsd: null }],
        trip: { costPerPerson: 500, depositAmount: 100, paymentMode: 'managed' },
      }),
    );
    expect(m.travelers[0].totalUsd).toBe(500);
    expect(m.travelers[0].steps[0].dueUsd).toBe(100);
    expect(m.travelers[0].steps[1].dueUsd).toBe(400);
  });

  it("prefers the traveler's own frozen price over the trip default", () => {
    const m = buildTripMoney(
      input({
        members: [{ userId: 'u1', priceTotalUsd: 1200, depositUsd: 300 }],
        trip: { costPerPerson: 500, depositAmount: 100, paymentMode: 'managed' },
      }),
    );
    expect(m.travelers[0].totalUsd).toBe(1200);
    expect(m.travelers[0].steps[0].dueUsd).toBe(300);
  });
});

describe('buildTripMoney — a traveler with no price', () => {
  const noPrice = input({
    members: [{ userId: 'u1', priceTotalUsd: null, depositUsd: null }],
  });

  it('is never "paid" — nothing is owed, which is not the same as settled', () => {
    const m = buildTripMoney(noPrice);
    expect(m.travelers[0].steps.map(s => s.state)).toEqual(['no_price', 'no_price']);
    expect(m.paidCountByKind).toEqual({ deposit: 0, balance: 0 });
  });

  it('is counted as the operator\'s own backlog', () => {
    expect(buildTripMoney(noPrice).noPriceCount).toBe(1);
  });

  it('adds nothing to what the trip expects', () => {
    expect(buildTripMoney(noPrice).expectedUsd).toBe(0);
  });
});

describe('buildTripMoney — settling a step', () => {
  it('marks a step paid once the full amount has landed', () => {
    const m = buildTripMoney(input({ events: [paid('u1', 'r-dep', 200)] }));
    expect(m.travelers[0].steps[0].state).toBe('paid');
    expect(m.travelers[0].steps[1].state).toBe('unpaid');
    expect(m.paidCountByKind).toEqual({ deposit: 1, balance: 0 });
  });

  it('leaves a part-paid step unpaid, but keeps what arrived', () => {
    const m = buildTripMoney(input({ events: [paid('u1', 'r-dep', 50)] }));
    expect(m.travelers[0].steps[0].state).toBe('unpaid');
    expect(m.travelers[0].steps[0].paidUsd).toBe(50);
  });

  it('does not let one step pay for another', () => {
    const m = buildTripMoney(input({ events: [paid('u1', 'r-bal', 800)] }));
    expect(m.travelers[0].steps[0].state).toBe('unpaid');
    expect(m.travelers[0].steps[1].state).toBe('paid');
  });

  it('settles a step paid in instalments that only add up in cents', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point, so a dollar
    // comparison would leave this step unpaid forever.
    const m = buildTripMoney(
      input({
        members: [{ userId: 'u1', priceTotalUsd: 0.3, depositUsd: 0.3 }],
        steps: [DEPOSIT],
        events: [paid('u1', 'r-dep', 0.1), paid('u1', 'r-dep', 0.2)],
      }),
    );
    expect(m.travelers[0].steps[0].state).toBe('paid');
    expect(m.travelers[0].paidUsd).toBe(0.3);
  });

  it('takes a refund back off what was paid', () => {
    const m = buildTripMoney(
      input({
        events: [paid('u1', 'r-dep', 200), paid('u1', 'r-dep', -200, { eventType: 'refunded' })],
      }),
    );
    expect(m.travelers[0].paidUsd).toBe(0);
    expect(m.travelers[0].steps[0].state).toBe('unpaid');
  });
});

describe('buildTripMoney — which events count', () => {
  it('ignores a failed charge', () => {
    const m = buildTripMoney(input({ events: [paid('u1', 'r-dep', 200, { eventType: 'failed' })] }));
    expect(m.collectedUsd).toBe(0);
    expect(m.hiddenCount).toBe(0);
  });

  it('ignores a payment from the other Stripe mode, and says how many', () => {
    const m = buildTripMoney(
      input({ events: [paid('u1', 'r-dep', 200, { isLivemode: true })], liveMode: false }),
    );
    expect(m.collectedUsd).toBe(0);
    expect(m.travelers[0].steps[0].state).toBe('unpaid');
    expect(m.hiddenCount).toBe(1);
  });

  it('does not report a mode mismatch when there is none', () => {
    expect(buildTripMoney(input({ events: [paid('u1', 'r-dep', 200)] })).hiddenCount).toBe(0);
  });

  it('keeps money from someone who has since left the trip', () => {
    // They are gone from `members`, so they have no row — but the operator
    // still received the money, and the total has to say so.
    const m = buildTripMoney(input({ events: [paid('gone', 'r-dep', 200)] }));
    expect(m.travelers).toHaveLength(1);
    expect(m.collectedUsd).toBe(200);
  });
});

describe('buildTripMoney — trip totals', () => {
  it('sums prices across travelers without float drift', () => {
    const m = buildTripMoney(
      input({
        members: Array.from({ length: 3 }, (_, i) => ({
          userId: `u${i}`,
          priceTotalUsd: 0.1,
          depositUsd: null,
        })),
      }),
    );
    expect(m.expectedUsd).toBe(0.3);
  });

  it('counts every traveler in the denominator, priced or not', () => {
    const m = buildTripMoney(
      input({
        members: [
          { userId: 'u1', priceTotalUsd: 1000, depositUsd: 200 },
          { userId: 'u2', priceTotalUsd: null, depositUsd: null },
        ],
        events: [paid('u1', 'r-dep', 200)],
      }),
    );
    expect(m.travelers).toHaveLength(2);
    expect(m.paidCountByKind.deposit).toBe(1);
    expect(m.noPriceCount).toBe(1);
  });

  it('reads a trip that is not managed as paid outside Swellyo', () => {
    expect(buildTripMoney(input({ trip: { costPerPerson: null, depositAmount: null, paymentMode: 'offline' } })).isOffline).toBe(true);
    expect(buildTripMoney(input()).isOffline).toBe(false);
  });

  it('gives each traveler only their own payments', () => {
    const m = buildTripMoney(
      input({
        members: [
          { userId: 'u1', priceTotalUsd: 1000, depositUsd: 200 },
          { userId: 'u2', priceTotalUsd: 1000, depositUsd: 200 },
        ],
        events: [paid('u1', 'r-dep', 200)],
      }),
    );
    expect(m.travelers[0].events).toHaveLength(1);
    expect(m.travelers[1].events).toHaveLength(0);
    expect(m.travelers[1].paidUsd).toBe(0);
  });
});

describe('toNumber', () => {
  it('parses a Postgres numeric that arrived as a string', () => {
    expect(toNumber('1000.50')).toBe(1000.5);
  });

  it('returns null rather than NaN for something unparseable', () => {
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  it('keeps a real zero', () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber('0')).toBe(0);
  });
});

describe('buildSurfStats', () => {
  it('orders levels by how many people are at them', () => {
    const s = buildSurfStats([
      { surfLevel: 'beginner' },
      { surfLevel: 'advanced' },
      { surfLevel: 'beginner' },
    ]);
    expect(s.levels).toEqual([
      ['beginner', 2],
      ['advanced', 1],
    ]);
  });

  it('does not treat "not set" as a category', () => {
    const s = buildSurfStats([{ surfLevel: null }, { surfLevel: 'pro' }]);
    expect(s.levels).toEqual([['pro', 1]]);
  });

  it('reports the age range, ignoring people who never said', () => {
    const s = buildSurfStats([{ age: 31 }, { age: null }, { age: 22 }]);
    expect(s.ageMin).toBe(22);
    expect(s.ageMax).toBe(31);
  });

  it('has no age range when nobody said', () => {
    const s = buildSurfStats([{ age: null }, {}]);
    expect(s.ageMin).toBeNull();
    expect(s.ageMax).toBeNull();
  });

  it('counts distinct countries', () => {
    const s = buildSurfStats([
      { countryFrom: 'Israel' },
      { countryFrom: 'Israel' },
      { countryFrom: 'Argentina' },
      { countryFrom: null },
    ]);
    expect(s.countryCount).toBe(2);
  });
});
