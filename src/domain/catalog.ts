/**
 * The requirement kinds the dashboard knows how to display.
 *
 * Operators can invent their own items, so anything not in this list is a
 * custom requirement. Those get their own "Other requirements" list rather
 * than a tile, because the tiles are built around these four uploads.
 *
 * How custom items should properly be counted and exported is still open —
 * see docs/SPEC.md §8.
 */
export const KNOWN_UPLOAD_KINDS = ['passport', 'insurance', 'visa', 'flights'] as const;

export type KnownUploadKind = (typeof KNOWN_UPLOAD_KINDS)[number];

const LABELS: Record<string, string> = {
  passport: 'Passports',
  insurance: 'Insurance',
  visa: 'Visas',
  flights: 'Flights',
  waiver: 'Waiver',
  medical: 'Medical form',
};

/** Plural label for a tile row. Falls back to the operator's own wording. */
export function kindLabel(kind: string, fallbackTitle: string): string {
  return LABELS[kind] ?? fallbackTitle;
}

export function isKnownUploadKind(kind: string): boolean {
  return (KNOWN_UPLOAD_KINDS as readonly string[]).includes(kind);
}
