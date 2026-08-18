// Mock the supabase client so importing the service doesn't init a real client
// (mirrors src/services/trips/__tests__/exploreSelect.test.ts). `from` is a
// real jest.fn() rather than an empty object because the ledger-read tests at
// the bottom of this file assert on the exact filter chain.
jest.mock('../../../config/supabase', () => ({ supabase: { from: jest.fn() } }));

import {
  amountDue,
  amountOutstanding,
  isPayingInFull,
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

// What `freeze_traveler_price()` produces for someone who joined on or after
// the full-payment deadline: deposit == total, balance == 0. Copy only — see
// 20260817000000_full_payment_after_deadline.sql.
describe('isPayingInFull', () => {
  it('is true when the deposit is the whole price', () => {
    expect(isPayingInFull({ totalUsd: 3000, depositUsd: 3000 })).toBe(true);
    // The other half of that deal: nothing left after onboarding.
    expect(amountDue('balance', { totalUsd: 3000, depositUsd: 3000 })).toBe(0);
  });

  it('is false for an ordinary split', () => {
    expect(isPayingInFull({ totalUsd: 3000, depositUsd: 1000 })).toBe(false);
  });

  // A trip that takes one single payment has no deposit ROW, so the deposit
  // step never renders and there is no label to fix. Answering "false" keeps
  // this about the deposit step and nothing else.
  it('is false when there is no deposit at all', () => {
    expect(isPayingInFull({ totalUsd: 3000, depositUsd: null })).toBe(false);
  });

  it('is false when nothing is priced, and for a missing struct', () => {
    expect(isPayingInFull({ totalUsd: null, depositUsd: null })).toBe(false);
    expect(isPayingInFull(null)).toBe(false);
    expect(isPayingInFull(undefined)).toBe(false);
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

// ─────────────────────────────────────────────────────────────────────────────
// fetchPaidByRequirement — the ledger read
//
// This mirrors `operator_requirement_pay_state()` in
// 20260803000000_operator_trip_payments.sql. The file header promises an exact
// mirror, and two of the filters are the whole point:
//   • `event_type <> 'failed'`
//   • `is_livemode = <the mode this build treats as real money>`
// A missing livemode filter is what made Stripe TEST payments — which the
// device test writes straight into the PRODUCTION database — read as real
// money on every screen.
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchPaidByRequirement', () => {
  /** Builds the chain fetchPaidByRequirement walks, recording every call.
   *  The final `.eq()` resolves, because that is what the service awaits. */
  const mockLedger = (rows: unknown[]) => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const record = (fn: string) => (...args: unknown[]) => {
      calls.push({ fn, args });
      return chain;
    };
    const chain: Record<string, unknown> = {
      select: record('select'),
      eq: record('eq'),
      neq: record('neq'),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return { chain, calls };
  };

  beforeEach(() => jest.clearAllMocks());

  it('excludes failed rows and filters to the expected Stripe mode', async () => {
    jest.isolateModules(() => {
      // Default (no env var) is test mode — the state during the device test,
      // where test-mode rows are exactly what should count.
      delete process.env.EXPO_PUBLIC_STRIPE_LIVEMODE;
    });
    const { supabase } = require('../../../config/supabase');
    const { fetchPaidByRequirement, STRIPE_LIVEMODE } = require('../tripPaymentsService');
    const { chain, calls } = mockLedger([]);
    (supabase.from as jest.Mock).mockReturnValue(chain);

    await fetchPaidByRequirement('t1', 'u1');

    expect(supabase.from).toHaveBeenCalledWith('organized_trip_payment_events');
    expect(calls).toContainEqual({ fn: 'neq', args: ['event_type', 'failed'] });
    // The load-bearing one. `STRIPE_LIVEMODE` is false by default, so this
    // also pins the default: test rows count until the env var says otherwise.
    expect(STRIPE_LIVEMODE).toBe(false);
    expect(calls).toContainEqual({ fn: 'eq', args: ['is_livemode', false] });
  });

  it('follows EXPO_PUBLIC_STRIPE_LIVEMODE when it says live', () => {
    // The go-live state. Must mirror the database's `app.stripe_livemode`;
    // the two are the same decision stored twice, because a phone cannot read
    // a Postgres GUC. Read at module load, hence isolateModules.
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_STRIPE_LIVEMODE = 'true';
      const { STRIPE_LIVEMODE } = require('../tripPaymentsService');
      expect(STRIPE_LIVEMODE).toBe(true);
    });
    delete process.env.EXPO_PUBLIC_STRIPE_LIVEMODE;
  });

  it('sums by requirement and ignores rows whose requirement was detached', async () => {
    const { supabase } = require('../../../config/supabase');
    const { fetchPaidByRequirement } = require('../tripPaymentsService');
    const { chain } = mockLedger([
      { requirement_id: 'r1', amount_usd: 500 },
      { requirement_id: 'r1', amount_usd: -200 }, // a refund is negative
      { requirement_id: 'r2', amount_usd: 1000 },
      // requirement_id goes NULL when a requirement is hard-deleted (the FK is
      // ON DELETE SET NULL). Such a row cannot be attributed to a step.
      { requirement_id: null, amount_usd: 900 },
    ]);
    (supabase.from as jest.Mock).mockReturnValue(chain);

    await expect(fetchPaidByRequirement('t1', 'u1')).resolves.toEqual({ r1: 300, r2: 1000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchMyRefunds — what the traveler is told came back
//
// Two filters carry the meaning, and both are easy to drop by accident:
//   • `status = 'succeeded'` — a refund the balance guardrail BLOCKED is a row
//     on this table and is not money anybody received. Showing it as
//     "Refunded $500" would be a promise nobody kept.
//   • `is_livemode` — the same mode filter the paid figure uses. Without it the
//     two numbers on the Payment card would come from different worlds.
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchMyRefunds', () => {
  /** The refunds chain, ending in `.order()` — that is what the service
   *  awaits, so that is what resolves. */
  const mockRefunds = (rows: unknown[]) => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const record = (fn: string) => (...args: unknown[]) => {
      calls.push({ fn, args });
      return chain;
    };
    const chain: Record<string, unknown> = {
      select: record('select'),
      eq: record('eq'),
      order: (...args: unknown[]) => {
        calls.push({ fn: 'order', args });
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return { chain, calls };
  };

  beforeEach(() => jest.clearAllMocks());

  it('reads only succeeded refunds, in this build\'s Stripe mode, for this user', async () => {
    const { supabase } = require('../../../config/supabase');
    const { fetchMyRefunds, STRIPE_LIVEMODE } = require('../tripPaymentsService');
    const { chain, calls } = mockRefunds([]);
    (supabase.from as jest.Mock).mockReturnValue(chain);

    await fetchMyRefunds('t1', 'u1');

    expect(supabase.from).toHaveBeenCalledWith('organized_trip_refunds');
    expect(calls).toContainEqual({ fn: 'eq', args: ['status', 'succeeded'] });
    expect(calls).toContainEqual({ fn: 'eq', args: ['is_livemode', STRIPE_LIVEMODE] });
    // Explicit, even though RLS scopes a traveler to their own rows: staff on
    // the trip can read everybody's, and an operator paying for their own seat
    // would otherwise sum the whole trip's refunds into their own card.
    expect(calls).toContainEqual({ fn: 'eq', args: ['user_id', 'u1'] });
  });

  it('sums numeric amounts and reports the most recent date', async () => {
    const { supabase } = require('../../../config/supabase');
    const { fetchMyRefunds } = require('../tripPaymentsService');
    // Postgres `numeric` arrives as a STRING. '200' + '150' is '200150', which
    // is why the service coerces before adding.
    const { chain } = mockRefunds([
      { amount_usd: '200', created_at: '2026-08-12T10:00:00Z' },
      { amount_usd: '150.50', created_at: '2026-08-01T10:00:00Z' },
    ]);
    (supabase.from as jest.Mock).mockReturnValue(chain);

    await expect(fetchMyRefunds('t1', 'u1')).resolves.toEqual({
      totalUsd: 350.5,
      // The query orders newest first, so the head is the last refund.
      lastAt: '2026-08-12T10:00:00Z',
      count: 2,
    });
  });

  it('reports nothing rather than null when there are no refunds', async () => {
    const { supabase } = require('../../../config/supabase');
    const { fetchMyRefunds } = require('../tripPaymentsService');
    const { chain } = mockRefunds([]);
    (supabase.from as jest.Mock).mockReturnValue(chain);

    // Zero, not null: the Payment card renders the line on `> 0`, and a null
    // total would have to be defended at every call site instead.
    await expect(fetchMyRefunds('t1', 'u1')).resolves.toEqual({
      totalUsd: 0,
      lastAt: null,
      count: 0,
    });
  });
});

// ── startCheckout's outcome ─────────────────────────────────────────────────
// The decode is three lines, and every one of them is load-bearing: it is what
// separates "they pressed back in Checkout" from "they paid", which the app
// could not tell apart at all before markers shipped. Getting `cancelled`
// wrong shows a spinner for a payment that never started; getting `returned`
// wrong drops a real payment on the floor.
describe('startCheckout outcome', () => {
  const openAuthSessionAsync = jest.fn();
  let invoke: jest.Mock;

  const load = (data: Record<string, unknown> = { url: 'https://checkout.stripe.com/c/pay/cs_test_123' }) => {
    let mod: any;
    jest.isolateModules(() => {
      jest.doMock('expo-web-browser', () => ({ openAuthSessionAsync }));
      jest.doMock('expo-linking', () => ({ createURL: () => 'swellyo://pay/done' }));
      const { supabase } = require('../../../config/supabase');
      invoke = jest.fn().mockResolvedValue({ data, error: null });
      supabase.functions = { invoke };
      mod = require('../tripPaymentsService');
    });
    return mod;
  };

  beforeEach(() => openAuthSessionAsync.mockReset());

  it('reads the cancel marker as cancelled', async () => {
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'swellyo://pay/done?swellyo_pay=cancel',
    });
    await expect(load().startCheckout('req1')).resolves.toBe('cancelled');
  });

  it('reads the success marker as returned', async () => {
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'swellyo://pay/done?swellyo_pay=success',
    });
    await expect(load().startCheckout('req1')).resolves.toBe('returned');
  });

  // The Expo Go return url already carries a query, so the marker lands after
  // an `&`. Matching only on `?` would read every dev-build cancel as a
  // payment.
  it('finds the marker after an existing query string', async () => {
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'exp://10.0.0.4:8081/--/pay/done?foo=1&swellyo_pay=cancel',
    });
    await expect(load().startCheckout('req1')).resolves.toBe('cancelled');
  });

  // Stripe replays sessions from a 24h idempotency cache, so for a day after
  // this ships some redirects come back marker-less. Unknown must fall to the
  // side that CONFIRMS — the old behaviour — not the side that assumes a
  // cancel and discards a real payment.
  it('treats a missing marker as returned, never as cancelled', async () => {
    openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'swellyo://pay/done' });
    await expect(load().startCheckout('req1')).resolves.toBe('returned');
  });

  // Swiped away on iOS / hardware back on Android: no redirect fired at all.
  it('reports a dismissed browser sheet as abandoned', async () => {
    openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' });
    await expect(load().startCheckout('req1')).resolves.toBe('abandoned');
  });

  it('reports a cancelled browser sheet as abandoned', async () => {
    openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    await expect(load().startCheckout('req1')).resolves.toBe('abandoned');
  });
});

// ── startCheckout partial amounts ───────────────────────────────────────────
// The dangerous failure here is version skew: a payments-checkout deployment
// that predates partial payments silently ignores the unknown `amountUsd`
// field and mints a session for the FULL outstanding amount. The current
// deployment echoes what it actually charged; its absence must abort BEFORE
// the browser opens, or a "$100" button puts the whole bill in front of the
// traveler.
describe('startCheckout partial amounts', () => {
  const openAuthSessionAsync = jest.fn();
  let invoke: jest.Mock;

  const load = (data: Record<string, unknown>) => {
    let mod: any;
    jest.isolateModules(() => {
      jest.doMock('expo-web-browser', () => ({ openAuthSessionAsync }));
      jest.doMock('expo-linking', () => ({ createURL: () => 'swellyo://pay/done' }));
      const { supabase } = require('../../../config/supabase');
      invoke = jest.fn().mockResolvedValue({ data, error: null });
      supabase.functions = { invoke };
      mod = require('../tripPaymentsService');
    });
    return mod;
  };

  beforeEach(() => {
    openAuthSessionAsync.mockReset();
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'swellyo://pay/done?swellyo_pay=success',
    });
  });

  it('sends the chosen amount to the edge function', async () => {
    const mod = load({ url: 'https://checkout.stripe.com/x', amountUsd: 100 });
    await mod.startCheckout('req1', 100);
    expect(invoke).toHaveBeenCalledWith('payments-checkout', {
      body: { requirementId: 'req1', returnUrl: 'swellyo://pay/done', amountUsd: 100 },
    });
  });

  it('omits the field entirely for a full payment', async () => {
    const mod = load({ url: 'https://checkout.stripe.com/x' });
    await mod.startCheckout('req1');
    expect(invoke).toHaveBeenCalledWith('payments-checkout', {
      body: { requirementId: 'req1', returnUrl: 'swellyo://pay/done' },
    });
  });

  it('refuses to open Checkout when the server did not echo the amount', async () => {
    const mod = load({ url: 'https://checkout.stripe.com/x' }); // stale deployment shape
    await expect(mod.startCheckout('req1', 100)).rejects.toThrow(/full amount/);
    expect(openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('a full payment does not care whether the amount was echoed', async () => {
    const mod = load({ url: 'https://checkout.stripe.com/x' });
    await expect(mod.startCheckout('req1')).resolves.toBe('returned');
  });
});
