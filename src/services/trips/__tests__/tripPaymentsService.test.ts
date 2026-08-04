// Mock the supabase client so importing the service doesn't init a real client
// (mirrors src/services/trips/__tests__/exploreSelect.test.ts).
jest.mock('../../../config/supabase', () => ({ supabase: {} }));

import {
  amountDue,
  amountOutstanding,
  usdToStripeCents,
  commissionCents,
} from '../tripPaymentsService';

describe('amountDue', () => {
  it('gives the deposit for the deposit step', () => {
    expect(amountDue('deposit', { totalUsd: 2000, depositUsd: 500 })).toBe(500);
  });

  it('gives total minus deposit for the balance step', () => {
    expect(amountDue('balance', { totalUsd: 2000, depositUsd: 500 })).toBe(1500);
  });

  // A trip with no deposit has no deposit ROW at all, but the math must still
  // be safe if it is asked.
  it('returns null for a deposit step when no deposit is set', () => {
    expect(amountDue('deposit', { totalUsd: 2000, depositUsd: null })).toBeNull();
  });

  it('charges the full price as the balance when there is no deposit', () => {
    expect(amountDue('balance', { totalUsd: 2000, depositUsd: null })).toBe(2000);
  });

  // A traveler who joined before the operator turned payments on has no frozen
  // price. Nothing is owed until the operator gives them one.
  it('returns null when the traveler has no price at all', () => {
    expect(amountDue('balance', { totalUsd: null, depositUsd: null })).toBeNull();
    expect(amountDue('deposit', { totalUsd: null, depositUsd: 500 })).toBeNull();
  });
});

describe('amountOutstanding', () => {
  it('subtracts what was already paid', () => {
    expect(amountOutstanding('balance', { totalUsd: 2000, depositUsd: 500 }, 400)).toBe(1100);
  });

  // Overpaid, or refunded down to a negative sum. Never ask for a negative
  // amount — Stripe would reject it and the row should simply read as done.
  it('never goes below zero', () => {
    expect(amountOutstanding('deposit', { totalUsd: 2000, depositUsd: 500 }, 900)).toBe(0);
  });

  it('is zero when nothing is due', () => {
    expect(amountOutstanding('deposit', { totalUsd: 2000, depositUsd: null }, 0)).toBe(0);
  });

  // The operator raised this traveler's price after they paid. Their balance
  // reopens for the difference — the behaviour Ohad asked for.
  it('reopens when the price is raised after payment', () => {
    expect(amountOutstanding('balance', { totalUsd: 2400, depositUsd: 500 }, 1500)).toBe(400);
  });
});

describe('usdToStripeCents', () => {
  it('converts whole dollars', () => {
    expect(usdToStripeCents(1500)).toBe(150000);
  });

  // Floats. 19.99 * 100 is 1998.9999999999998 in IEEE 754, so a bare
  // Math.trunc would charge a cent less on a large share of prices.
  it('rounds rather than truncates', () => {
    expect(usdToStripeCents(19.99)).toBe(1999);
    expect(usdToStripeCents(0.1 + 0.2)).toBe(30);
  });
});

describe('commissionCents', () => {
  it('takes 12% at the default rate', () => {
    expect(commissionCents(150000, 1200)).toBe(18000);
  });

  it('takes nothing at zero', () => {
    expect(commissionCents(150000, 0)).toBe(0);
  });

  // Must never exceed the charge, or Stripe rejects the whole session.
  it('never exceeds the charge', () => {
    expect(commissionCents(100, 10000)).toBe(100);
  });

  it('rounds to a whole cent', () => {
    expect(commissionCents(999, 1200)).toBe(120);
  });
});
