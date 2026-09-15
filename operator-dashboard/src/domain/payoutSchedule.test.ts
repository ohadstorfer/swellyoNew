import { describe, expect, it } from 'vitest';
import {
  amountIn,
  canPayOutNow,
  describeClearing,
  describeNothingToPayOut,
  describeSweep,
  firstPayoutCaveat,
  formatMoney,
  type PayoutSchedule,
  type PayoutStatus,
} from './payoutSchedule';

const schedule = (over: Partial<PayoutSchedule> = {}): PayoutSchedule => ({
  interval: 'daily',
  delayDays: 2,
  weeklyAnchor: null,
  monthlyAnchor: null,
  ...over,
});

const status = (over: Partial<PayoutStatus> = {}): PayoutStatus => ({
  payoutsEnabled: true,
  hasEverPaidOut: true,
  payoutsStatus: 'enabled',
  currency: 'usd',
  schedule: schedule(),
  available: [],
  pending: [],
  ...over,
});

describe('describeClearing', () => {
  it('returns null when Stripe has not told us — 0 days is a different claim', () => {
    expect(describeClearing(schedule({ delayDays: null }))).toBeNull();
  });

  it('says same-day only when the delay really is zero', () => {
    expect(describeClearing(schedule({ delayDays: 0 }))).toContain('as soon as');
  });

  it('singularises one day', () => {
    expect(describeClearing(schedule({ delayDays: 1 }))).toContain('1 day after');
    expect(describeClearing(schedule({ delayDays: 2 }))).toContain('2 days after');
  });
});

describe('describeSweep', () => {
  it('names the weekday', () => {
    expect(describeSweep(schedule({ interval: 'weekly', weeklyAnchor: 'friday' }))).toContain('every Friday');
  });

  it('uses ordinals for the monthly anchor', () => {
    expect(describeSweep(schedule({ interval: 'monthly', monthlyAnchor: 1 }))).toContain('1st');
    expect(describeSweep(schedule({ interval: 'monthly', monthlyAnchor: 2 }))).toContain('2nd');
    expect(describeSweep(schedule({ interval: 'monthly', monthlyAnchor: 3 }))).toContain('3rd');
    expect(describeSweep(schedule({ interval: 'monthly', monthlyAnchor: 11 }))).toContain('11th');
    expect(describeSweep(schedule({ interval: 'monthly', monthlyAnchor: 21 }))).toContain('21st');
  });

  it('does not promise a 31st to someone paid in February', () => {
    for (const d of [29, 30, 31]) {
      expect(describeSweep(schedule({ interval: 'monthly', monthlyAnchor: d }))).toContain('last day');
    }
  });

  it('says manual money waits for the operator', () => {
    expect(describeSweep(schedule({ interval: 'manual' }))).toContain('until you pay it out');
  });
});

describe('canPayOutNow', () => {
  const withMoney = { available: [{ amount: 5000, currency: 'usd' }] };

  it('is false on an automatic schedule even with a balance', () => {
    // The rule that keeps the button off a daily account, where the balance is
    // swept the moment it clears and would read $0.00 nearly always.
    expect(canPayOutNow(status({ ...withMoney, schedule: schedule({ interval: 'daily' }) }))).toBe(false);
  });

  it('is true on manual with cleared money', () => {
    expect(canPayOutNow(status({ ...withMoney, schedule: schedule({ interval: 'manual' }) }))).toBe(true);
  });

  it('is false on manual with nothing cleared', () => {
    expect(canPayOutNow(status({ schedule: schedule({ interval: 'manual' }) }))).toBe(false);
  });

  it('is false when Stripe is not paying out at all', () => {
    expect(
      canPayOutNow(status({ ...withMoney, payoutsEnabled: false, schedule: schedule({ interval: 'manual' }) })),
    ).toBe(false);
  });
});

describe('describeNothingToPayOut', () => {
  it('distinguishes "still clearing" from "nothing sold" — the whole point', () => {
    expect(describeNothingToPayOut(status({ pending: [{ amount: 12000, currency: 'usd' }] }))).toContain(
      '$120.00',
    );
    expect(describeNothingToPayOut(status())).toBe('Nothing to pay out yet.');
  });
});

describe('amountIn', () => {
  it('ignores other currencies rather than summing them', () => {
    const list = [
      { amount: 100, currency: 'eur' },
      { amount: 900, currency: 'usd' },
    ];
    expect(amountIn(list, 'usd')).toBe(900);
    expect(amountIn(list, 'gbp')).toBe(0);
  });
});

describe('formatMoney', () => {
  it('handles zero-decimal currencies', () => {
    // 1000 JPY is ¥1,000, not ¥10.00 — dividing by 100 is wrong here.
    expect(formatMoney(1000, 'jpy')).toContain('1,000');
    expect(formatMoney(1000, 'usd')).toBe('$10.00');
  });
});

describe('firstPayoutCaveat', () => {
  it('is silent once the account has been paid before', () => {
    expect(firstPayoutCaveat(true)).toBeNull();
    expect(firstPayoutCaveat(false)).toContain('7–14 days');
  });
});
