/**
 * Cancellation policy — the shape, the presets, and how to say them in words.
 *
 * Deliberately has NO imports. This site shares no code with the Expo app, so
 * this is a hand-kept copy of `src/services/trips/cancellationPolicy.ts` in the
 * app. Keeping it dependency-free is what makes the copy possible.
 * CHANGE ONE, CHANGE BOTH — an operator who sets a policy here and reads it in
 * the app must see the same sentences.
 *
 * The database is the authority on validity — `normalise_operator_cancellation`
 * rejects a bad rule and sorts the good ones furthest-out first. Everything
 * here exists so a person is told what is wrong BEFORE they hit save, not so
 * the client can decide what is allowed.
 */

export type CancellationPreset =
  | 'flexible'
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
 * The three fixed presets, written as rules.
 *
 * They are real rule sets rather than magic strings so that one refund
 * calculation can serve all four presets — a preset is just a custom policy
 * somebody else typed.
 */
export const PRESET_RULES: Record<
  Exclude<CancellationPreset, 'custom'>,
  CancellationRule[]
> = {
  flexible: [{ daysBefore: 30, refundPct: 100 }],
  standard: [{ daysBefore: 60, refundPct: 100 }],
  non_refundable: [],
};

export const PRESET_LABEL: Record<CancellationPreset, string> = {
  flexible: 'Flexible',
  standard: 'Standard',
  non_refundable: 'Deposit is non-refundable',
  custom: 'Custom',
};

export const PRESET_BLURB: Record<CancellationPreset, string> = {
  flexible: 'Full refund up to 30 days before the trip.',
  standard: 'Full refund up to 60 days before, then the deposit is kept.',
  non_refundable: 'The deposit is never refunded.',
  custom: 'Your own refund steps.',
};

export const DEFAULT_POLICY: CancellationPolicy = {
  preset: 'standard',
  rules: [],
  notes: null,
};

/** The rules that actually apply, whichever preset is chosen. */
export function effectiveRules(p: CancellationPolicy): CancellationRule[] {
  return p.preset === 'custom' ? p.rules : PRESET_RULES[p.preset];
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
  if (rules.length === 0) return ['The deposit is not refunded.'];

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
