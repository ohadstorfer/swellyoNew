/**
 * Cancellation policy — the shape, the presets, and how to say them in words.
 *
 * Deliberately has NO imports. The operator dashboard is a separate app that
 * shares no code with this one, so it carries a byte-identical copy at
 * `operator-dashboard/src/domain/cancellation.ts`. Keeping this file
 * dependency-free is what makes that copy possible; change one, change both.
 *
 * The database is the authority on validity — `normalise_operator_cancellation`
 * rejects a bad rule and sorts the good ones furthest-out first. Everything
 * here exists so a person is told what is wrong BEFORE they hit save, not so
 * the client can decide what is allowed.
 */

/**
 * `'flexible'` was a fourth preset — full refund up to 30 days out — removed
 * 2026-08-11. Nobody had it stored (checked live: one settings row, `standard`).
 *
 * ⚠️ THE DATABASE CHECK STILL ACCEPTS `'flexible'`. Left that way on purpose:
 * nothing can send it any more, and narrowing a constraint is a migration that
 * buys nothing. `toPreset()` is what makes leaving it safe — every read must go
 * through it, or a legacy row becomes a preset with no `PRESET_RULES` entry.
 */
export type CancellationPreset =
  | 'standard'
  | 'non_refundable'
  | 'custom';

/** "Cancel at least `daysBefore` days ahead and you get `refundPct` back." */
export interface CancellationRule {
  daysBefore: number;
  refundPct: number;
}

export interface CancellationPolicy {
  preset: CancellationPreset;
  /** Only meaningful when preset is 'custom'. Empty otherwise, by trigger. */
  rules: CancellationRule[];
  notes: string | null;
}

/**
 * The fixed presets, written as rules.
 *
 * They are real rule sets rather than magic strings so that one refund
 * calculation can serve every preset — a preset is just a custom policy
 * somebody else typed.
 */
export const PRESET_RULES: Record<
  Exclude<CancellationPreset, 'custom'>,
  CancellationRule[]
> = {
  standard: [{ daysBefore: 60, refundPct: 100 }],
  non_refundable: [],
};

/**
 * ⚠️ THE WORDS MUST MATCH `PRESET_RULES`, AND ONCE THEY DID NOT.
 *
 * Both fixed presets used to promise "the deposit is kept" — which a traveler
 * reads as "so I get the rest back". Neither rule set does that: `standard` is
 * `[{60, 100}]`, so cancelling on day 59 returns **nothing**, not the balance,
 * and `non_refundable` has no rules at all. Implementing "keep the deposit,
 * refund the balance" needs the deposit in the refund maths and a partial-
 * payment ledger to take it from; saying it in a blurb needs neither, which is
 * exactly why the wrong version survived. The words were corrected to the
 * rules, not the other way round.
 *
 * The stored key stays `non_refundable` — it is in a CHECK constraint and in
 * the operator dashboard. Only the sentence a human reads changed.
 */
export const PRESET_LABEL: Record<CancellationPreset, string> = {
  standard: 'Standard',
  non_refundable: 'No refunds',
  custom: 'Custom',
};

export const PRESET_BLURB: Record<CancellationPreset, string> = {
  standard: 'Full refund up to 60 days before. Nothing after that.',
  non_refundable: 'No refund at any time.',
  custom: 'Your own refund steps.',
};

export const DEFAULT_POLICY: CancellationPolicy = {
  preset: 'standard',
  rules: [],
  notes: null,
};

/**
 * A stored preset, or the default if the column holds anything else.
 *
 * Every read of `operator_settings.cancellation_preset` MUST go through this.
 * The read paths used to cast the column straight to `CancellationPreset`,
 * which was safe only while the type covered every value the CHECK allows —
 * and stopped being safe the moment `'flexible'` was dropped from one and not
 * the other. A legacy row would then arrive as a preset with no `PRESET_RULES`
 * entry, `effectiveRules` would hand back undefined, and `explain()` would read
 * `.length` off it and take the screen down.
 */
export function toPreset(raw: unknown): CancellationPreset {
  return raw === 'standard' || raw === 'non_refundable' || raw === 'custom'
    ? raw
    : DEFAULT_POLICY.preset;
}

/** A trip row's three cancellation columns, in whatever shape they arrive. */
export interface TripPolicyRow {
  cancellation_preset?: unknown;
  cancellation_rules?: unknown;
  cancellation_notes?: unknown;
}

/**
 * The policy frozen on a TRIP, or null when it has none.
 *
 * ⚠️ DELIBERATELY NOT `toPreset`. That coerces anything unrecognised to
 * 'standard', which is right for an operator's settings row — there is always a
 * working default — and badly wrong here. A trip with no policy must read as
 * NULL, not as "full refund up to 60 days before": every type A and B trip has
 * no policy, as does every operator trip published before the columns existed,
 * and inventing terms for a trip that never stated any is the one mistake this
 * whole feature exists to prevent.
 *
 * Null also covers the feed RPCs, which do not select these columns at all.
 */
export function policyFromTrip(
  row: TripPolicyRow | null | undefined,
): CancellationPolicy | null {
  const preset = row?.cancellation_preset;
  if (preset !== 'standard' && preset !== 'non_refundable' && preset !== 'custom') {
    return null;
  }
  return {
    preset,
    rules: rulesFromWire(row?.cancellation_rules),
    notes: typeof row?.cancellation_notes === 'string' ? row.cancellation_notes : null,
  };
}

/** The rules that actually apply, whichever preset is chosen. */
export function effectiveRules(p: CancellationPolicy): CancellationRule[] {
  return p.preset === 'custom' ? p.rules : PRESET_RULES[p.preset];
}

// ---------------------------------------------------------------------------
// turning a policy into a number
// ---------------------------------------------------------------------------

/**
 * `start_date` is a Postgres `date` — a calendar day with no time and no zone.
 *
 * ⚠️ NOT `new Date(s)`. That parses 'YYYY-MM-DD' as UTC midnight, while
 * `new Date()` is local, so in any timezone west of UTC the two are already
 * hours apart before the subtraction starts — enough to move a traveler across
 * a policy boundary and change what they are refunded. Building the date from
 * its parts gives local midnight, which is the only thing a calendar day can
 * honestly mean here.
 */
function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const startOfDay = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Whole days from `now` until the trip starts. Negative once it has begun.
 *
 * ⚠️ `round`, not `floor`. Both operands are local midnight, so the division is
 * exact — except across a daylight-saving boundary, where the span is 23 or 25
 * hours and `floor` would silently lose a day. Losing a day here is not a
 * rounding error, it is a traveler on the wrong side of a refund step.
 */
export function daysUntil(tripStartDate: string, now: Date = new Date()): number | null {
  const start = parseDateOnly(tripStartDate);
  if (!start) return null;
  return Math.round((startOfDay(start) - startOfDay(now)) / 86_400_000);
}

/**
 * What percentage this policy gives back, for a cancellation happening now.
 *
 * ⚠️ NULL IS NOT ZERO, and collapsing the two is the mistake this whole feature
 * exists to prevent. Null means "this trip never stated terms" — true of every
 * type A/B trip and every operator trip published before the policy columns.
 * Zero means "the terms were stated, and they give nothing back". Suggesting
 * "$0 back" for a trip that never said so invents a term the traveler never
 * agreed to. Callers must render null as *no suggestion at all*, never as 0%.
 *
 * Returns null when: there is no policy, or the trip has no start date (nothing
 * to measure the window against).
 */
export function refundPctFor(
  policy: CancellationPolicy | null | undefined,
  tripStartDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!policy) return null;
  if (!tripStartDate) return null;

  const days = daysUntil(tripStartDate, now);
  if (days === null) return null;

  // Furthest-out first — the order the DB trigger already stores them in, and
  // the order this walk depends on. Sorted again rather than trusted: a policy
  // built in the editor has not been through the trigger yet.
  const rules = [...effectiveRules(policy)].sort((a, b) => b.daysBefore - a.daysBefore);

  // The first window the traveler is still inside wins. No rules at all
  // (`non_refundable`) and "past every window" both land on 0 — which here is a
  // real answer the policy gave, not a missing one.
  for (const rule of rules) {
    if (days >= rule.daysBefore) return rule.refundPct;
  }
  return 0;
}

/**
 * What the policy suggests refunding, in dollars.
 *
 * A SUGGESTION. Nothing in the app applies this on its own — the operator can
 * always override it, including to zero or to everything. It exists so the
 * common case (a traveler who backed out) is one tap instead of arithmetic.
 *
 * Null propagates from `refundPctFor`: no policy, no suggestion.
 */
export function suggestedRefundUsd(args: {
  policy: CancellationPolicy | null | undefined;
  tripStartDate: string | null | undefined;
  /** What this traveler has actually paid, net of refunds already issued. */
  paidUsd: number;
  now?: Date;
}): number | null {
  const { policy, tripStartDate, paidUsd, now } = args;
  const pct = refundPctFor(policy, tripStartDate, now);
  if (pct === null) return null;
  if (!Number.isFinite(paidUsd) || paidUsd <= 0) return 0;

  // To the cent. A percentage of an odd amount is otherwise a number with
  // fifteen decimals, which Stripe rejects and a human cannot read.
  return Math.round(paidUsd * pct) / 100;
}

/**
 * One line, for a card or a row. Never mentions who pays it back — on an
 * operator trip the money is in the operator's Stripe account, not ours, so
 * "you will be refunded" would be a promise Swellyo cannot keep.
 */
export function summarise(p: CancellationPolicy): string {
  if (p.preset !== 'custom') return PRESET_BLURB[p.preset];

  const rules = [...p.rules].sort((a, b) => b.daysBefore - a.daysBefore);
  if (rules.length === 0) return 'No refund steps set.';

  const first = rules[0];
  if (rules.length === 1) {
    return first.refundPct >= 100
      ? `Full refund up to ${first.daysBefore} days before.`
      : `${first.refundPct}% back up to ${first.daysBefore} days before.`;
  }
  return `${first.refundPct}% back up to ${first.daysBefore} days before, then less in ${rules.length - 1} more step${rules.length - 1 === 1 ? '' : 's'}.`;
}

/** Every step, in reading order. For the detail view and the deposit screen. */
export function explain(p: CancellationPolicy): string[] {
  const rules = effectiveRules(p);
  // No rules is not "we forgot to say" — it is the whole policy, and it has to
  // read as one. See the PRESET_LABEL note on why this is not deposit-only.
  if (rules.length === 0) return ['No refund at any time, whenever you cancel.'];

  const sorted = [...rules].sort((a, b) => b.daysBefore - a.daysBefore);
  const lines = sorted.map(
    r => `Cancel ${r.daysBefore}+ days before: ${r.refundPct}% back`,
  );
  // The tail case is the one people actually get caught by, so it is stated
  // rather than left as the absence of a rule.
  const last = sorted[sorted.length - 1];
  if (last.daysBefore > 0) lines.push(`Less than ${last.daysBefore} days before: nothing`);
  return lines;
}

/**
 * What is wrong with this policy, in the order a person would fix it.
 * Empty means the database will accept it.
 */
export function validate(p: CancellationPolicy): string[] {
  const errors: string[] = [];
  if (p.preset !== 'custom') return errors;

  if (p.rules.length === 0) {
    errors.push('Add at least one refund step, or choose a ready-made policy.');
    return errors;
  }

  for (const r of p.rules) {
    if (!Number.isFinite(r.daysBefore) || r.daysBefore < 0 || r.daysBefore > 3650) {
      errors.push('Days before must be between 0 and 3650.');
      break;
    }
  }
  for (const r of p.rules) {
    if (!Number.isFinite(r.refundPct) || r.refundPct < 0 || r.refundPct > 100) {
      errors.push('Refund must be between 0 and 100 percent.');
      break;
    }
  }

  const days = p.rules.map(r => r.daysBefore);
  if (new Set(days).size !== days.length) {
    errors.push('Two steps use the same number of days.');
  }

  // Refunds that grow as the trip gets closer are almost always a typo, and
  // the database would happily store the mistake.
  const sorted = [...p.rules].sort((a, b) => b.daysBefore - a.daysBefore);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].refundPct > sorted[i - 1].refundPct) {
      errors.push('Later steps should refund less, not more.');
      break;
    }
  }

  if ((p.notes?.length ?? 0) > 2000) {
    errors.push('Notes are too long.');
  }

  return errors;
}

// ── Wire format ────────────────────────────────────────────────────────────
// The column stores snake_case keys; the apps use camelCase. Converting in one
// place keeps `days_before` out of every component.

export function rulesToWire(rules: CancellationRule[]): unknown[] {
  return rules.map(r => ({
    days_before: Math.round(r.daysBefore),
    refund_pct: Math.round(r.refundPct),
  }));
}

export function rulesFromWire(raw: unknown): CancellationRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => ({
      daysBefore: Number(r?.days_before),
      refundPct: Number(r?.refund_pct),
    }))
    .filter(r => Number.isFinite(r.daysBefore) && Number.isFinite(r.refundPct));
}
