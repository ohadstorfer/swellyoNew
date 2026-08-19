/**
 * The policy → money calculation.
 *
 * This is the piece worth testing hardest in the whole refund feature: it is
 * pure, it has no UI to reveal a mistake, and every boundary it gets wrong is
 * an off-by-one on somebody's money. A traveler one day either side of a step
 * gets a different amount, and nothing on screen would look broken.
 */
import {
  refundPctFor,
  suggestedRefundUsd,
  daysUntil,
  type CancellationPolicy,
} from '../cancellationPolicy';

/** Local midnight, matching how the function reads a Postgres `date`. */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const standard: CancellationPolicy = { preset: 'standard', rules: [], notes: null };
const noRefunds: CancellationPolicy = { preset: 'non_refundable', rules: [], notes: null };
const stepped: CancellationPolicy = {
  preset: 'custom',
  rules: [
    { daysBefore: 60, refundPct: 100 },
    { daysBefore: 30, refundPct: 50 },
    { daysBefore: 7, refundPct: 25 },
  ],
  notes: null,
};

describe('daysUntil', () => {
  it('counts whole calendar days', () => {
    expect(daysUntil('2026-10-12', at(2026, 9, 12))).toBe(30);
    expect(daysUntil('2026-10-12', at(2026, 10, 11))).toBe(1);
    expect(daysUntil('2026-10-12', at(2026, 10, 12))).toBe(0);
  });

  it('goes negative once the trip has started', () => {
    expect(daysUntil('2026-10-12', at(2026, 10, 20))).toBe(-8);
  });

  it('survives a daylight-saving boundary', () => {
    // Spans the US DST change (1 Nov 2026), where one day is 25 hours. `floor`
    // on the raw millisecond span would lose a day here.
    expect(daysUntil('2026-11-10', at(2026, 10, 25))).toBe(16);
  });

  it('returns null for junk', () => {
    expect(daysUntil('', at(2026, 1, 1))).toBeNull();
    expect(daysUntil('not-a-date', at(2026, 1, 1))).toBeNull();
  });

  it('reads a full timestamp by its date part', () => {
    expect(daysUntil('2026-10-12T00:00:00Z', at(2026, 10, 2))).toBe(10);
  });
});

describe('refundPctFor — null is not zero', () => {
  it('is null with no policy', () => {
    expect(refundPctFor(null, '2026-10-12', at(2026, 1, 1))).toBeNull();
    expect(refundPctFor(undefined, '2026-10-12', at(2026, 1, 1))).toBeNull();
  });

  it('is null with no start date', () => {
    expect(refundPctFor(standard, null, at(2026, 1, 1))).toBeNull();
    expect(refundPctFor(standard, undefined, at(2026, 1, 1))).toBeNull();
  });

  it('is null when the start date is unparseable', () => {
    expect(refundPctFor(standard, 'someday', at(2026, 1, 1))).toBeNull();
  });

  it('distinguishes "no terms" from "terms that give nothing"', () => {
    // The distinction the whole feature turns on.
    expect(refundPctFor(null, '2026-10-12', at(2026, 10, 1))).toBeNull();
    expect(refundPctFor(noRefunds, '2026-10-12', at(2026, 10, 1))).toBe(0);
  });
});

describe('refundPctFor — boundaries', () => {
  it('pays in full outside the window', () => {
    expect(refundPctFor(standard, '2026-10-12', at(2026, 8, 1))).toBe(100);
  });

  it('pays in full EXACTLY on the boundary day', () => {
    // 60 days out. "Cancel 60+ days before" includes day 60.
    expect(refundPctFor(standard, '2026-10-12', at(2026, 8, 13))).toBe(100);
  });

  it('pays nothing one day inside the boundary', () => {
    expect(refundPctFor(standard, '2026-10-12', at(2026, 8, 14))).toBe(0);
  });

  it('walks a stepped policy step by step', () => {
    const start = '2026-10-12';
    expect(refundPctFor(stepped, start, at(2026, 8, 13))).toBe(100); // 60 days
    expect(refundPctFor(stepped, start, at(2026, 8, 14))).toBe(50);  // 59 days
    expect(refundPctFor(stepped, start, at(2026, 9, 12))).toBe(50);  // 30 days
    expect(refundPctFor(stepped, start, at(2026, 9, 13))).toBe(25);  // 29 days
    expect(refundPctFor(stepped, start, at(2026, 10, 5))).toBe(25);  // 7 days
    expect(refundPctFor(stepped, start, at(2026, 10, 6))).toBe(0);   // 6 days
  });

  it('gives nothing once the trip has started', () => {
    expect(refundPctFor(stepped, '2026-10-12', at(2026, 10, 13))).toBe(0);
  });

  it('does not trust the stored order of the rules', () => {
    // The DB trigger sorts furthest-out first, but a policy built in the editor
    // has not been through it yet.
    const unsorted: CancellationPolicy = {
      preset: 'custom',
      rules: [
        { daysBefore: 7, refundPct: 25 },
        { daysBefore: 60, refundPct: 100 },
        { daysBefore: 30, refundPct: 50 },
      ],
      notes: null,
    };
    expect(refundPctFor(unsorted, '2026-10-12', at(2026, 8, 14))).toBe(50);
  });

  it('treats a custom policy with no rules as nothing back', () => {
    const empty: CancellationPolicy = { preset: 'custom', rules: [], notes: null };
    expect(refundPctFor(empty, '2026-10-12', at(2026, 1, 1))).toBe(0);
  });
});

describe('suggestedRefundUsd', () => {
  it('applies the percentage', () => {
    expect(
      suggestedRefundUsd({ policy: stepped, tripStartDate: '2026-10-12', paidUsd: 900, now: at(2026, 9, 12) }),
    ).toBe(450);
  });

  it('rounds to the cent', () => {
    // 25% of 333.33 is 83.3325 — not a payable amount.
    expect(
      suggestedRefundUsd({ policy: stepped, tripStartDate: '2026-10-12', paidUsd: 333.33, now: at(2026, 10, 5) }),
    ).toBe(83.33);
  });

  it('propagates null rather than suggesting zero', () => {
    expect(
      suggestedRefundUsd({ policy: null, tripStartDate: '2026-10-12', paidUsd: 900, now: at(2026, 9, 12) }),
    ).toBeNull();
  });

  it('is zero when nothing was paid', () => {
    expect(
      suggestedRefundUsd({ policy: stepped, tripStartDate: '2026-10-12', paidUsd: 0, now: at(2026, 8, 1) }),
    ).toBe(0);
  });

  it('never returns more than was paid', () => {
    const paid = 900;
    const out = suggestedRefundUsd({
      policy: stepped, tripStartDate: '2026-10-12', paidUsd: paid, now: at(2026, 8, 1),
    });
    expect(out).toBe(900);
    expect(out!).toBeLessThanOrEqual(paid);
  });
});
