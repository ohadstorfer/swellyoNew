/**
 * passportMrz — turn OCR text into passport fields, and those fields into the
 * block of text the operator copies.
 *
 * Everything here is PURE. No native modules, no network, no storage. That is
 * deliberate: this is the part that can be wrong in ways nobody notices, so it
 * is the part that has to be testable without a phone.
 *
 * ── Why the machine-readable zone, and not the printed page ──────────────────
 *
 * A passport carries the same details twice: printed for humans, and encoded in
 * the two `<<<<<`-filled lines at the bottom (the MRZ). We read the MRZ, because
 * it carries ICAO check digits. That means we can tell whether the read was
 * correct instead of quietly handing the operator a wrong passport number — and
 * a wrong passport number on a ticket is a traveler stopped at the gate.
 *
 * Check digits are also what make the repair attempts in `findMrzLines` safe. A
 * repaired line either satisfies its check digits or it does not; a bad guess is
 * flagged, never silently accepted.
 *
 * Spec: docs/specs/operator-trips/passport-copy-details.md
 */
import { parse as parseMrz } from 'mrz';

export type PassportFields = {
  surname: string;
  givenNames: string;
  passportNumber: string;
  /** Three-letter country code, e.g. `SLV`. What an airline actually wants. */
  nationality: string;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string;
  /** `F`, `M` or `X`. */
  sex: string;
  /** `YYYY-MM-DD`. */
  expiryDate: string;
};

export type PassportFieldKey = keyof PassportFields;

export type MrzReadResult = {
  fields: PassportFields;
  /** True only when the MRZ was found AND every check digit matched. */
  trusted: boolean;
  /** Fields whose check digit failed. Show these as "please check". */
  suspect: PassportFieldKey[];
  /** Set when nothing could be read. `fields` is then blank, for typing into. */
  problem: string | null;
};

export const EMPTY_FIELDS: PassportFields = {
  surname: '',
  givenNames: '',
  passportNumber: '',
  nationality: '',
  dateOfBirth: '',
  sex: '',
  expiryDate: '',
};

/** Order is the reading order of the printed page, and of the copied block. */
export const FIELD_ORDER: PassportFieldKey[] = [
  'surname',
  'givenNames',
  'passportNumber',
  'nationality',
  'dateOfBirth',
  'sex',
  'expiryDate',
];

export const FIELD_LABEL: Record<PassportFieldKey, string> = {
  surname: 'Surname',
  givenNames: 'Given names',
  passportNumber: 'Passport no',
  nationality: 'Nationality',
  dateOfBirth: 'Date of birth',
  sex: 'Sex',
  expiryDate: 'Expires',
};

/** The MRZ alphabet. Anything else means we are not looking at an MRZ line. */
const MRZ_CHARS = /^[A-Z0-9<]+$/;

/**
 * Characters OCR hands back instead of `<`.
 *
 * Vision and ML Kit both read a run of chevrons as guillemets or full-width
 * variants often enough that not normalising them costs us most passports.
 */
const CHEVRON_LOOKALIKES = /[«»‹›≪≫〈〉＜<]/g;

type MrzFormat = { name: 'TD3' | 'TD2'; lines: number; width: number };

/** Passports are TD3. TD2 costs nothing to support and covers older booklets. */
const FORMATS: MrzFormat[] = [
  { name: 'TD3', lines: 2, width: 44 },
  { name: 'TD2', lines: 2, width: 36 },
];

/** How far off a line's length may be before we stop trying to repair it. */
const LENGTH_TOLERANCE = 3;

function normaliseLine(raw: string): string {
  return raw
    .replace(CHEVRON_LOOKALIKES, '<')
    .replace(/\s/g, '')
    .toUpperCase();
}

function looksLikeMrz(line: string): boolean {
  if (line.length < 28) return false;
  if (!MRZ_CHARS.test(line)) return false;
  // Two chevrons is the lowest a real line goes; it rules out ordinary words
  // in caps, which is what the rest of a passport page is made of.
  return (line.match(/</g) ?? []).length >= 2;
}

/**
 * Every plausible way to bring a line to the width the format requires.
 *
 * A long line gives up its trailing filler. A short line is missing filler, and
 * where that filler belongs depends on the format's trailing check digits: TD3
 * ends with a personal-number check digit AND a composite check digit, TD2 with
 * a composite alone. Rather than encode that per format and get it subtly
 * wrong, this returns BOTH placements and lets the check digits decide which
 * one was right — which is safe precisely because a bad guess fails validation
 * instead of quietly producing a plausible passport number.
 *
 * Returns an empty array when the line is too far off to repair honestly.
 */
function widthVariants(line: string, width: number): string[] {
  if (line.length === width) return [line];
  if (Math.abs(line.length - width) > LENGTH_TOLERANCE) return [];

  if (line.length > width) {
    const trimmed = line.replace(/<+$/, '');
    if (trimmed.length > width) return [];
    return [trimmed.padEnd(width, '<')];
  }

  const missing = width - line.length;
  const filler = '<'.repeat(missing);

  // Trailing filler means the line simply got cut short.
  if (/<$/.test(line)) return [line.padEnd(width, '<')];

  return [
    // Filler before the trailing check digits (TD3: two of them).
    line.slice(0, -2) + filler + line.slice(-2),
    // Filler before a single trailing check digit (TD2).
    line.slice(0, -1) + filler + line.slice(-1),
    // Last resort: the line lost characters off the end.
    line + filler,
  ];
}

/** Cartesian product of each line's repair variants. Small by construction. */
function combine(perLine: string[][]): string[][] {
  return perLine.reduce<string[][]>(
    (acc, variants) => acc.flatMap(prefix => variants.map(v => [...prefix, v])),
    [[]],
  );
}

/**
 * Every candidate MRZ the OCR text could contain, best guess first.
 *
 * The MRZ sits at the bottom of the page, so lower runs are preferred. Each run
 * may yield several candidates when a line needed repairing; the caller parses
 * them in order and keeps the first whose check digits agree.
 */
export function findMrzCandidates(ocrText: string): string[][] {
  const lines = (ocrText ?? '')
    .split(/\r?\n/)
    .map(normaliseLine)
    .filter(l => l.length > 0);

  const marked = lines.map(l => (looksLikeMrz(l) ? l : null));
  const found: string[][] = [];

  for (const format of FORMATS) {
    // Bottom-up: the MRZ is below everything else printed on the page.
    for (let i = marked.length - format.lines; i >= 0; i--) {
      const run = marked.slice(i, i + format.lines);
      if (run.some(l => l === null)) continue;

      const perLine = (run as string[]).map(l => widthVariants(l, format.width));
      if (perLine.some(v => v.length === 0)) continue;

      found.push(...combine(perLine));
    }
  }

  return found;
}

/**
 * The single best guess at the MRZ, or null.
 *
 * Prefer `readPassportText` in real code — it tries every candidate and keeps
 * the one the check digits vouch for. This exists for the simple case and for
 * showing what was found.
 */
export function findMrzLines(ocrText: string): string[] | null {
  return findMrzCandidates(ocrText)[0] ?? null;
}

/**
 * Expand a two-digit MRZ year.
 *
 * A birth year is in the past, so a two-digit year above this year's belongs to
 * the previous century. An expiry is in the future — a passport is valid ten
 * years at most — so it is always this century.
 *
 * The one case this gets wrong is someone aged exactly 100. That is not a
 * traveler we are going to have.
 */
function expandYear(yy: number, kind: 'birth' | 'expiry', today: Date): number {
  if (kind === 'expiry') return 2000 + yy;
  const currentTwoDigit = today.getFullYear() % 100;
  return yy > currentTwoDigit ? 1900 + yy : 2000 + yy;
}

/** `YYMMDD` → `YYYY-MM-DD`. Empty string when the input is not a real date. */
export function mrzDateToISO(
  yymmdd: string | null | undefined,
  kind: 'birth' | 'expiry',
  today: Date = new Date(),
): string {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return '';
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  const year = expandYear(yy, kind, today);
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function sexToLetter(value: unknown): string {
  if (value === 'male') return 'M';
  if (value === 'female') return 'F';
  if (value === 'nonspecified' || value === 'unspecified') return 'X';
  return '';
}

/**
 * Which field each failed check digit casts doubt on.
 *
 * The composite digit covers the whole second line, so a composite-only failure
 * says "something is off" without saying what. Marking all three fields red on
 * the strength of it would train the operator to ignore red, so it only clears
 * `trusted` — the banner says the read is unverified, and nothing is singled out.
 */
const CHECK_DIGIT_GUARDS: Record<string, PassportFieldKey> = {
  documentNumberCheckDigit: 'passportNumber',
  birthDateCheckDigit: 'dateOfBirth',
  expirationDateCheckDigit: 'expiryDate',
};

const FIELD_FROM_MRZ: Record<string, PassportFieldKey> = {
  lastName: 'surname',
  firstName: 'givenNames',
  documentNumber: 'passportNumber',
  nationality: 'nationality',
  birthDate: 'dateOfBirth',
  sex: 'sex',
  expirationDate: 'expiryDate',
};

/**
 * Parse MRZ lines into fields.
 *
 * Never throws. A passport that cannot be read comes back as blank fields plus
 * a `problem`, because the screen that shows this lets the operator type the
 * details in by hand — a failed read has to leave them somewhere useful, not at
 * a dead end.
 */
export function readMrzLines(
  lines: string[] | null,
  today: Date = new Date(),
): MrzReadResult {
  if (!lines || lines.length < 2) {
    return {
      fields: { ...EMPTY_FIELDS },
      trusted: false,
      suspect: [],
      problem: 'Could not find the two code lines at the bottom of the passport.',
    };
  }

  let parsed: ReturnType<typeof parseMrz>;
  try {
    // `autocorrect` fixes the O/0 and I/1 confusions OCR makes in number
    // fields. Every correction still has to satisfy the check digits.
    parsed = parseMrz(lines, { autocorrect: true });
  } catch {
    return {
      fields: { ...EMPTY_FIELDS },
      trusted: false,
      suspect: [],
      problem: 'The code lines were found but could not be read.',
    };
  }

  const f = parsed.fields;
  const fields: PassportFields = {
    surname: (f.lastName ?? '').trim(),
    givenNames: (f.firstName ?? '').trim(),
    passportNumber: (f.documentNumber ?? '').trim(),
    nationality: (f.nationality ?? '').trim(),
    dateOfBirth: mrzDateToISO(f.birthDate, 'birth', today),
    sex: sexToLetter(f.sex),
    expiryDate: mrzDateToISO(f.expirationDate, 'expiry', today),
  };

  const suspect = new Set<PassportFieldKey>();
  for (const detail of parsed.details ?? []) {
    if (detail.valid) continue;
    const key = detail.field ?? '';
    const guarded = CHECK_DIGIT_GUARDS[key] ?? FIELD_FROM_MRZ[key];
    if (guarded) suspect.add(guarded);
  }

  // A field the parser could not produce at all is worth checking too.
  for (const key of FIELD_ORDER) {
    if (!fields[key]) suspect.add(key);
  }

  return {
    fields,
    trusted: parsed.valid === true,
    suspect: FIELD_ORDER.filter(k => suspect.has(k)),
    problem: null,
  };
}

/**
 * OCR text straight to fields — the entry point real code should use.
 *
 * Tries every candidate the text could contain and keeps the first whose check
 * digits all agree. Only if none of them validate does it fall back to the best
 * readable one, which comes back with `trusted: false` and its doubtful fields
 * flagged. That ordering is what makes the line repairs in `findMrzCandidates`
 * safe: a wrong repair simply loses to a right one, or fails visibly.
 */
export function readPassportText(ocrText: string, today: Date = new Date()): MrzReadResult {
  const candidates = findMrzCandidates(ocrText);
  if (candidates.length === 0) return readMrzLines(null, today);

  let fallback: MrzReadResult | null = null;

  for (const lines of candidates) {
    const result = readMrzLines(lines, today);
    if (result.trusted) return result;
    if (!fallback && !result.problem) fallback = result;
  }

  return fallback ?? readMrzLines(candidates[0], today);
}

/**
 * The block that lands on the clipboard.
 *
 * Labelled lines, chosen by Ohad on 3 August: it pastes readably into an email,
 * a WhatsApp message or an airline form, which is where these details go.
 *
 * Empty fields are left out rather than emitted as a bare label. By the time
 * anyone taps Copy they have seen the blanks on screen; pasting `Surname:` with
 * nothing after it into a booking helps no one.
 */
export function formatPassportDetails(fields: PassportFields): string {
  return FIELD_ORDER.filter(key => fields[key]?.trim())
    .map(key => `${FIELD_LABEL[key]}: ${fields[key].trim()}`)
    .join('\n');
}
