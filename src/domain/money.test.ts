import { describe, it, expect } from 'vitest';
import {
  amountDueUsd,
  buildTripMoney,
  checkPriceChange,
  countsAsPayment,
  otherModeCount,
  stepState,
  sumPaidUsd,
  toNumber,
  type PaymentEvent,
  type TripPrice,
} from './money';
import { formatUsd } from '../lib/format';

const TRIP: TripPrice = { costPerPerson: 3000, depositAmount: 1000 };

const event = (o: Partial<PaymentEvent> = {}): PaymentEvent => ({
  userId: 'u1',
  requirementId: 'r-deposit',
  eventType: 'paid',
  amountUsd: 1000,
  isLivemode: false,
  createdAt: '2026-08-04T20:37:00Z',
  ...o,
});

describe('toNumber — Postgres numeric arrives as a string', () => {
  it('parses a string', () => {
    expect(toNumber('3000')).toBe(3000);
    expect(toNumber('1234.50')).toBe(1234.5);
  });

  it('passes a number through', () => {
    expect(toNumber(3000)).toBe(3000);
  });

  it('is null for nothing, not zero', () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('')).toBeNull();
  });

  it('never returns NaN', () => {
    // A NaN would render as "$NaN" and compare false against everything, so a
    // real debt would silently read as paid.
    expect(toNumber('not a number')).toBeNull();
    expect(toNumber({})).toBeNull();
  });
});

describe('amountDueUsd', () => {
  it('uses the trip default when the traveler has no frozen price', () => {
    expect(amountDueUsd('deposit', null, TRIP)).toBe(1000);
    expect(amountDueUsd('balance', null, TRIP)).toBe(2000);
  });

  it("prefers the traveler's own frozen price over the trip default", () => {
    const traveler = { priceTotalUsd: 4000, depositUsd: 1500 };
    expect(amountDueUsd('deposit', traveler, TRIP)).toBe(1500);
    expect(amountDueUsd('balance', traveler, TRIP)).toBe(2500);
  });

  it('falls back per field, not all-or-nothing', () => {
    // A traveler priced with no deposit still inherits the trip's deposit.
    const traveler = { priceTotalUsd: 5000, depositUsd: null };
    expect(amountDueUsd('deposit', traveler, TRIP)).toBe(1000);
    expect(amountDueUsd('balance', traveler, TRIP)).toBe(4000);
  });

  it('is null — not zero — when no price exists anywhere', () => {
    const noPrice: TripPrice = { costPerPerson: null, depositAmount: null };
    expect(amountDueUsd('balance', null, noPrice)).toBeNull();
    expect(amountDueUsd('deposit', null, noPrice)).toBeNull();
  });

  it('treats a missing deposit as zero when working out the balance', () => {
    const noDeposit: TripPrice = { costPerPerson: 3000, depositAmount: null };
    expect(amountDueUsd('balance', null, noDeposit)).toBe(3000);
  });

  it('is null when the deposit is larger than the total', () => {
    // Otherwise the balance goes negative, and a negative owed reads as paid.
    const traveler = { priceTotalUsd: 500, depositUsd: 1000 };
    expect(amountDueUsd('balance', traveler, TRIP)).toBeNull();
  });

  it('handles a deposit exactly equal to the total', () => {
    const traveler = { priceTotalUsd: 1000, depositUsd: 1000 };
    expect(amountDueUsd('balance', traveler, TRIP)).toBe(0);
  });

  it('adds in cents, so fractional prices do not drift', () => {
    const traveler = { priceTotalUsd: 0.3, depositUsd: 0.1 };
    expect(amountDueUsd('balance', traveler, TRIP)).toBe(0.2);
  });
});

describe('countsAsPayment', () => {
  it('excludes failed events', () => {
    expect(countsAsPayment(event({ eventType: 'failed' }), false)).toBe(false);
  });

  it('excludes the other Stripe mode', () => {
    expect(countsAsPayment(event({ isLivemode: true }), false)).toBe(false);
    expect(countsAsPayment(event({ isLivemode: false }), true)).toBe(false);
  });

  it('counts a matching paid event', () => {
    expect(countsAsPayment(event(), false)).toBe(true);
    expect(countsAsPayment(event({ isLivemode: true }), true)).toBe(true);
  });
});

describe('sumPaidUsd', () => {
  it('adds matching events', () => {
    expect(sumPaidUsd([event(), event({ amountUsd: 2000 })], false)).toBe(3000);
  });

  it('ignores failed and other-mode events', () => {
    const events = [
      event({ amountUsd: 1000 }),
      event({ amountUsd: 999, eventType: 'failed' }),
      event({ amountUsd: 777, isLivemode: true }),
    ];
    expect(sumPaidUsd(events, false)).toBe(1000);
  });

  it('subtracts a refund, which is stored as a negative row', () => {
    const events = [event({ amountUsd: 1000 }), event({ eventType: 'refunded', amountUsd: -400 })];
    expect(sumPaidUsd(events, false)).toBe(600);
  });

  it('does not drift on amounts with cents', () => {
    // 0.1 + 0.2 !== 0.3 in floating point. Summing in cents is why this holds.
    const events = [event({ amountUsd: 0.1 }), event({ amountUsd: 0.2 })];
    expect(sumPaidUsd(events, false)).toBe(0.3);
  });

  it('is zero for no events', () => {
    expect(sumPaidUsd([], false)).toBe(0);
  });
});

describe('otherModeCount', () => {
  it('counts events from the mode we are not showing', () => {
    const events = [event({ isLivemode: false }), event({ isLivemode: true }), event({ isLivemode: true })];
    expect(otherModeCount(events, false)).toBe(2);
    expect(otherModeCount(events, true)).toBe(1);
  });

  it('does not count failed events as hidden money', () => {
    const events = [event({ isLivemode: true, eventType: 'failed' })];
    expect(otherModeCount(events, false)).toBe(0);
  });
});

describe('stepState', () => {
  it('is no_price when nothing is owed because no price is set', () => {
    expect(stepState(null, 0)).toBe('no_price');
    expect(stepState(null, 500)).toBe('no_price');
  });

  it('is paid when the exact amount was paid', () => {
    // `>=`, not `>`. Paying exactly what is owed is paid.
    expect(stepState(1000, 1000)).toBe('paid');
  });

  it('is paid when overpaid', () => {
    expect(stepState(1000, 1200)).toBe('paid');
  });

  it('is unpaid when short', () => {
    expect(stepState(1000, 999.99)).toBe('unpaid');
    expect(stepState(1000, 0)).toBe('unpaid');
  });

  it('does not let a float residue leave a settled step unpaid', () => {
    expect(stepState(0.3, 0.1 + 0.2)).toBe('paid');
  });

  it('treats a zero balance as paid', () => {
    // A deposit-only trip: the balance is zero and needs no payment.
    expect(stepState(0, 0)).toBe('paid');
  });
});

describe('checkPriceChange', () => {
  const base = { travelerName: 'Guy', currentTotalUsd: 3000 };

  it('saves with no confirmation when nothing has been paid', () => {
    // Confirmations only work while they are rare.
    const r = checkPriceChange({ ...base, newTotalUsd: 4000, paidUsd: 0 });
    expect(r).toEqual({ ok: true, confirm: null });
  });

  it('blocks a total below what they already paid', () => {
    const r = checkPriceChange({ ...base, newTotalUsd: 500, paidUsd: 1000 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected a block');
    expect(r.reason).toContain('already paid');
    expect(r.reason).toContain('$1,000');
    expect(r.reason).toContain('refund');
  });

  it('allows a total exactly equal to what they paid', () => {
    const r = checkPriceChange({ ...base, newTotalUsd: 1000, paidUsd: 1000 });
    expect(r.ok).toBe(true);
  });

  it('confirms, with the numbers, when money is already in', () => {
    const r = checkPriceChange({ ...base, newTotalUsd: 3500, paidUsd: 1000 });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.confirm) throw new Error('expected a confirmation');
    expect(r.confirm).toContain('Guy has paid $1,000');
    expect(r.confirm).toContain('owe $2,000 right now');
    expect(r.confirm).toContain('will owe $2,500');
  });

  it('leaves out the "owes now" clause when no price is set yet', () => {
    const r = checkPriceChange({
      travelerName: 'Maya',
      currentTotalUsd: null,
      newTotalUsd: 3000,
      paidUsd: 500,
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.confirm) throw new Error('expected a confirmation');
    expect(r.confirm).not.toContain('right now');
    expect(r.confirm).toContain('will owe $2,500');
  });

  it('allows raising a price after full payment', () => {
    // The balance step re-opens and checkout charges only the difference.
    // Operators need this for an added week or a room upgrade.
    const r = checkPriceChange({ ...base, newTotalUsd: 3500, paidUsd: 3000 });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.confirm) throw new Error('expected a confirmation');
    expect(r.confirm).toContain('will owe $500');
  });
});

describe('buildTripMoney', () => {
  const STEPS = [
    { requirementId: 'r-deposit', kind: 'deposit' as const, title: 'Deposit' },
    { requirementId: 'r-balance', kind: 'balance' as const, title: 'Final payment' },
  ];
  const MEMBERS = [
    { userId: 'guy', priceTotalUsd: 3000, depositUsd: 1000 },
    { userId: 'ohad', priceTotalUsd: 3000, depositUsd: 1000 },
  ];

  it('matches the live El Salvador trip: one deposit paid of two travelers', () => {
    const money = buildTripMoney({
      members: MEMBERS,
      steps: STEPS,
      trip: TRIP,
      events: [event({ userId: 'guy', requirementId: 'r-deposit', amountUsd: 1000 })],
      liveMode: false,
    });

    expect(money.expectedUsd).toBe(6000);
    expect(money.collectedUsd).toBe(1000);
    expect(money.paidCountByKind).toEqual({ deposit: 1, balance: 0 });
    expect(money.noPriceCount).toBe(0);

    const guy = money.travelers.find(t => t.userId === 'guy')!;
    expect(guy.steps.find(s => s.kind === 'deposit')!.state).toBe('paid');
    expect(guy.steps.find(s => s.kind === 'balance')!.state).toBe('unpaid');
    expect(guy.steps.find(s => s.kind === 'balance')!.dueUsd).toBe(2000);
  });

  it('counts a traveler with no price in the denominator, not as paid', () => {
    const money = buildTripMoney({
      members: [MEMBERS[0], { userId: 'maya', priceTotalUsd: null, depositUsd: null }],
      steps: STEPS,
      trip: { costPerPerson: null, depositAmount: null },
      events: [],
      liveMode: false,
    });

    expect(money.travelers).toHaveLength(2);
    expect(money.noPriceCount).toBe(1);
    // Guy has his own frozen price; Maya has none and the trip has no default.
    expect(money.expectedUsd).toBe(3000);
    expect(money.paidCountByKind).toEqual({ deposit: 0, balance: 0 });
    const maya = money.travelers.find(t => t.userId === 'maya')!;
    expect(maya.steps.every(s => s.state === 'no_price')).toBe(true);
  });

  it('keeps one traveler\'s payments away from another', () => {
    const money = buildTripMoney({
      members: MEMBERS,
      steps: STEPS,
      trip: TRIP,
      events: [event({ userId: 'guy', requirementId: 'r-deposit', amountUsd: 1000 })],
      liveMode: false,
    });
    expect(money.travelers.find(t => t.userId === 'ohad')!.paidUsd).toBe(0);
  });

  it('reports events from the other Stripe mode instead of counting them', () => {
    const money = buildTripMoney({
      members: MEMBERS,
      steps: STEPS,
      trip: TRIP,
      events: [
        event({ userId: 'guy', requirementId: 'r-deposit', amountUsd: 1000, isLivemode: true }),
        event({ userId: 'guy', requirementId: 'r-deposit', amountUsd: 500, isLivemode: true }),
      ],
      liveMode: false,
    });

    expect(money.collectedUsd).toBe(0);
    expect(money.hiddenCount).toBe(2);
    expect(money.events).toHaveLength(0);
  });

  it("counts a traveler's whole ledger, even a payment with no step link", () => {
    const money = buildTripMoney({
      members: MEMBERS,
      steps: STEPS,
      trip: TRIP,
      events: [event({ userId: 'guy', requirementId: null, amountUsd: 250 })],
      liveMode: false,
    });

    const guy = money.travelers.find(t => t.userId === 'guy')!;
    expect(guy.paidUsd).toBe(250);
    // ...but it settles no step, because it belongs to none.
    expect(guy.steps.every(s => s.state === 'unpaid')).toBe(true);
  });

  it('subtracts a refund from the trip total', () => {
    const money = buildTripMoney({
      members: MEMBERS,
      steps: STEPS,
      trip: TRIP,
      events: [
        event({ userId: 'guy', requirementId: 'r-deposit', amountUsd: 1000 }),
        event({ userId: 'guy', requirementId: 'r-deposit', eventType: 'refunded', amountUsd: -1000 }),
      ],
      liveMode: false,
    });

    expect(money.collectedUsd).toBe(0);
    // A refunded deposit is owed again.
    expect(money.paidCountByKind.deposit).toBe(0);
  });

  it('handles a trip with only a balance step', () => {
    const money = buildTripMoney({
      members: [{ userId: 'guy', priceTotalUsd: 3000, depositUsd: null }],
      steps: [STEPS[1]],
      trip: { costPerPerson: 3000, depositAmount: null },
      events: [event({ userId: 'guy', requirementId: 'r-balance', amountUsd: 3000 })],
      liveMode: false,
    });

    expect(money.paidCountByKind).toEqual({ deposit: 0, balance: 1 });
    expect(money.collectedUsd).toBe(3000);
  });
});

describe('formatUsd', () => {
  it('drops cents when there are none', () => {
    expect(formatUsd(3000)).toBe('$3,000');
  });

  it('shows cents when there are cents', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });

  it('shows a dash for nothing, never $0', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
  });

  it('shows a real zero as $0', () => {
    expect(formatUsd(0)).toBe('$0');
  });

  it('handles a negative, for an over-refund', () => {
    expect(formatUsd(-250)).toBe('-$250');
  });
});
