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

  // Stored rows can't reach this (a DB CHECK blocks deposit > total), but a
  // live price-sheet form building this struct from two text fields mid-typing
  // can — e.g. a 5000 deposit entered before the 2000 total is corrected.
  // A negative raw figure is a contradictory configuration, not a real zero
  // balance, so it reads as "unknown" (null) — 0 would look like fully paid.
  it('returns null for a contradictory balance (deposit larger than total)', () => {
    expect(amountDue('balance', { totalUsd: 2000, depositUsd: 5000 })).toBeNull();
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

  // A contradictory configuration makes amountDue return null ("unknown"),
  // not zero. We still cannot ask for a negative amount, so outstanding
  // reads as 0 — never a negative number — even though nothing was paid.
  it('is zero (not negative) when the balance is contradictory', () => {
    expect(amountOutstanding('balance', { totalUsd: 2000, depositUsd: 5000 }, 0)).toBe(0);
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
  // bps = 15000 (150%) makes the raw cut bigger than the charge itself, so
  // this is the case that actually exercises the cap — 100 bps = 100% would
  // make raw === totalCents and never engage Math.min.
  it('never exceeds the charge', () => {
    expect(commissionCents(100, 15000)).toBe(100);
  });

  it('rounds to a whole cent', () => {
    expect(commissionCents(999, 1200)).toBe(120);
  });
});

import {
  REQUIREMENT_CATALOG,
  REQUIREMENT_ORDER,
  DEFAULT_TIMING,
} from '../tripDocumentsService';

describe('pay requirement kinds', () => {
  it('has both pay kinds in the catalog', () => {
    expect(REQUIREMENT_CATALOG.deposit).toBeDefined();
    expect(REQUIREMENT_CATALOG.balance).toBeDefined();
  });

  // The req_type is what routes state resolution to the ledger. Get this wrong
  // and the row waits forever for evidence that never arrives.
  it('routes both through the pay branch', () => {
    expect(REQUIREMENT_CATALOG.deposit.reqType).toBe('pay');
    expect(REQUIREMENT_CATALOG.balance.reqType).toBe('pay');
    expect(REQUIREMENT_CATALOG.deposit.action).toBe('pay');
    expect(REQUIREMENT_CATALOG.balance.action).toBe('pay');
  });

  it('puts the deposit before the balance', () => {
    expect(REQUIREMENT_ORDER.indexOf('deposit')).toBeLessThan(
      REQUIREMENT_ORDER.indexOf('balance'),
    );
  });

  // A deposit is due when you join, so it must be must_have with NO deadline —
  // organized_trip_req_deadline_rule rejects any other combination with a 23514.
  it('defaults the deposit to due on joining', () => {
    expect(DEFAULT_TIMING.deposit.skippable).toBe(false);
  });

  // A balance is due before departure, so it must be skippable WITH a deadline.
  it('defaults the balance to a deadline before departure', () => {
    expect(DEFAULT_TIMING.balance.skippable).toBe(true);
    expect(DEFAULT_TIMING.balance.daysBefore).toBeGreaterThan(0);
  });
});
