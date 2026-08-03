/**
 * Tests for the passport MRZ reader.
 *
 * The point of reading the machine-readable zone rather than the printed page
 * is that check digits tell us when the read is wrong. So the tests that matter
 * most are the ones proving a corrupted read is CAUGHT — not the happy path.
 */
import {
  findMrzLines,
  formatPassportDetails,
  mrzDateToISO,
  readMrzLines,
  readPassportText,
  EMPTY_FIELDS,
} from '../passportMrz';

// ── Building valid test passports ───────────────────────────────────────────
// Hand-written MRZ lines are almost always wrong in the check digits, which
// would make every test assert the failure path by accident. So we compute them
// the way ICAO 9303 does: weights 7-3-1, letters as A=10..Z=35, filler as 0.

const WEIGHTS = [7, 3, 1];

function charValue(c: string): number {
  if (c === '<') return 0;
  if (/[0-9]/.test(c)) return Number(c);
  return c.charCodeAt(0) - 55;
}

function checkDigit(input: string): number {
  return input
    .split('')
    .reduce((sum, c, i) => sum + charValue(c) * WEIGHTS[i % 3], 0) % 10;
}

function buildTd3(opts: {
  surname: string;
  givenNames: string;
  passportNumber: string;
  nationality: string;
  /** YYMMDD */
  birth: string;
  sex: 'M' | 'F' | '<';
  /** YYMMDD */
  expiry: string;
}): string[] {
  const names = `${opts.surname}<<${opts.givenNames.replace(/ /g, '<')}`;
  const line1 = `P<${opts.nationality}${names}`.padEnd(44, '<');

  const num = opts.passportNumber.padEnd(9, '<');
  const numC = checkDigit(num);
  const birthC = checkDigit(opts.birth);
  const expiryC = checkDigit(opts.expiry);
  const personal = '<'.repeat(14);
  const personalC = checkDigit(personal);
  const composite = checkDigit(
    `${num}${numC}${opts.birth}${birthC}${opts.expiry}${expiryC}${personal}${personalC}`,
  );

  const line2 =
    `${num}${numC}${opts.nationality}${opts.birth}${birthC}${opts.sex}` +
    `${opts.expiry}${expiryC}${personal}${personalC}${composite}`;

  return [line1, line2];
}

const MARIA = {
  surname: 'GONZALEZ',
  givenNames: 'MARIA LUZ',
  passportNumber: 'X1234567',
  nationality: 'SLV',
  birth: '940312',
  sex: 'F' as const,
  expiry: '290830',
};

// A fixed "today" so the two-digit-year rules are not time bombs.
const TODAY = new Date('2026-08-03T12:00:00Z');

describe('buildTd3 (the test helper itself)', () => {
  it('produces two lines of exactly 44 characters', () => {
    const [l1, l2] = buildTd3(MARIA);
    expect(l1).toHaveLength(44);
    expect(l2).toHaveLength(44);
  });
});

describe('readMrzLines', () => {
  it('reads every field off a valid passport', () => {
    const result = readMrzLines(buildTd3(MARIA), TODAY);

    expect(result.problem).toBeNull();
    expect(result.trusted).toBe(true);
    expect(result.suspect).toEqual([]);
    expect(result.fields).toEqual({
      surname: 'GONZALEZ',
      givenNames: 'MARIA LUZ',
      passportNumber: 'X1234567',
      nationality: 'SLV',
      dateOfBirth: '1994-03-12',
      sex: 'F',
      expiryDate: '2029-08-30',
    });
  });

  it('CATCHES a single wrong digit in the passport number', () => {
    const [l1, l2] = buildTd3(MARIA);
    // Change one character of the document number. The check digit no longer
    // agrees, which is the entire reason we read the MRZ and not the page.
    const corrupted = `${l2.slice(0, 3)}9${l2.slice(4)}`;

    const result = readMrzLines([l1, corrupted], TODAY);

    expect(result.trusted).toBe(false);
    expect(result.suspect).toContain('passportNumber');
  });

  it('CATCHES a wrong date of birth', () => {
    const [l1, l2] = buildTd3(MARIA);
    // Birth date sits at 13..18 on line 2.
    const corrupted = `${l2.slice(0, 13)}950312${l2.slice(19)}`;

    const result = readMrzLines([l1, corrupted], TODAY);

    expect(result.trusted).toBe(false);
    expect(result.suspect).toContain('dateOfBirth');
  });

  it('does not paint every field red when only the composite digit fails', () => {
    const [l1, l2] = buildTd3(MARIA);
    // Last character is the composite check digit.
    const wrongComposite = (Number(l2.slice(-1)) + 1) % 10;
    const corrupted = `${l2.slice(0, 43)}${wrongComposite}`;

    const result = readMrzLines([l1, corrupted], TODAY);

    // Trust is gone, but nothing is singled out — a composite failure does not
    // say which field is wrong, and flagging all three trains people to ignore
    // the flag.
    expect(result.trusted).toBe(false);
    expect(result.suspect).toEqual([]);
  });

  it('returns blank editable fields rather than throwing when there is no MRZ', () => {
    const result = readMrzLines(null, TODAY);

    expect(result.fields).toEqual(EMPTY_FIELDS);
    expect(result.trusted).toBe(false);
    expect(result.problem).toMatch(/could not find/i);
  });

  it('returns a problem rather than throwing on lines of the wrong length', () => {
    const result = readMrzLines(['P<SLVGONZALEZ', 'X12345'], TODAY);

    expect(result.fields).toEqual(EMPTY_FIELDS);
    expect(result.problem).not.toBeNull();
  });
});

describe('findMrzLines', () => {
  it('finds the code lines among the rest of the printed page', () => {
    const [l1, l2] = buildTd3(MARIA);
    const ocr = [
      'PASAPORTE',
      'REPUBLICA DE EL SALVADOR',
      'Apellidos / Surname',
      'GONZALEZ',
      l1,
      l2,
    ].join('\n');

    expect(findMrzLines(ocr)).toEqual([l1, l2]);
  });

  it('normalises the guillemets OCR returns instead of chevrons', () => {
    const [l1, l2] = buildTd3(MARIA);
    const ocr = `${l1.replace(/</g, '«')}\n${l2}`;

    const found = findMrzLines(ocr);

    expect(found).toEqual([l1, l2]);
  });

  it('strips the spaces OCR sprinkles into the code lines', () => {
    const [l1, l2] = buildTd3(MARIA);
    const ocr = `${l1.slice(0, 20)} ${l1.slice(20)}\n${l2}`;

    expect(findMrzLines(ocr)).toEqual([l1, l2]);
  });

  it('ignores ordinary capitalised text on the page', () => {
    expect(findMrzLines('REPUBLICA DE EL SALVADOR\nPASAPORTE\nTYPE P')).toBeNull();
  });

  it('survives empty input', () => {
    expect(findMrzLines('')).toBeNull();
  });
});

describe('readPassportText', () => {
  it('goes from raw OCR text to fields in one call', () => {
    const [l1, l2] = buildTd3(MARIA);
    const result = readPassportText(`PASAPORTE\n${l1}\n${l2}`, TODAY);

    expect(result.trusted).toBe(true);
    expect(result.fields.surname).toBe('GONZALEZ');
  });

  it('repairs a line missing one filler character, and the check digits confirm it', () => {
    const [l1, l2] = buildTd3(MARIA);
    // Drop one filler from the personal-number run on line 2, the way OCR does.
    const short = l2.slice(0, 30) + l2.slice(31);
    expect(short).toHaveLength(43);

    const result = readPassportText(`${l1}\n${short}`, TODAY);

    // The repair is only trustworthy because the check digits agree with it.
    expect(result.trusted).toBe(true);
    expect(result.fields.passportNumber).toBe('X1234567');
  });

  it('does not invent a passport when the code lines are genuinely unreadable', () => {
    const [l1] = buildTd3(MARIA);
    // Line 2 mangled well past repair: half its characters are wrong.
    const junk = 'X9Z8Y7W6V5<<<<AAA111111B222222<<<<<<<<<<<<<9';

    const result = readPassportText(`${l1}\n${junk}`, TODAY);

    expect(result.trusted).toBe(false);
  });

  it('prefers a later run of code lines over an earlier lookalike', () => {
    const [l1, l2] = buildTd3(MARIA);
    const decoy = buildTd3({ ...MARIA, passportNumber: 'Z9999999', surname: 'WRONG' });

    const result = readPassportText(`${decoy[0]}\n${decoy[1]}\nSOME TEXT\n${l1}\n${l2}`, TODAY);

    expect(result.fields.surname).toBe('GONZALEZ');
    expect(result.fields.passportNumber).toBe('X1234567');
  });
});

describe('mrzDateToISO', () => {
  it('puts a birth year above this year in the last century', () => {
    // 94 > 26, so 1994 — not 2094.
    expect(mrzDateToISO('940312', 'birth', TODAY)).toBe('1994-03-12');
  });

  it('puts a birth year at or below this year in this century', () => {
    // Someone born in 2010 is 16 and can be on a trip.
    expect(mrzDateToISO('100312', 'birth', TODAY)).toBe('2010-03-12');
  });

  it('always reads an expiry as this century', () => {
    // A passport expiring in 2029, never 1929.
    expect(mrzDateToISO('290830', 'expiry', TODAY)).toBe('2029-08-30');
  });

  it('returns empty for a date that is not a date', () => {
    expect(mrzDateToISO('99XX99', 'birth', TODAY)).toBe('');
    expect(mrzDateToISO('941332', 'birth', TODAY)).toBe('');
    expect(mrzDateToISO(null, 'birth', TODAY)).toBe('');
  });
});

describe('formatPassportDetails', () => {
  it('writes the labelled block Ohad chose', () => {
    const text = formatPassportDetails({
      surname: 'GONZALEZ',
      givenNames: 'MARIA LUZ',
      passportNumber: 'X1234567',
      nationality: 'SLV',
      dateOfBirth: '1994-03-12',
      sex: 'F',
      expiryDate: '2029-08-30',
    });

    expect(text).toBe(
      [
        'Surname: GONZALEZ',
        'Given names: MARIA LUZ',
        'Passport no: X1234567',
        'Nationality: SLV',
        'Date of birth: 1994-03-12',
        'Sex: F',
        'Expires: 2029-08-30',
      ].join('\n'),
    );
  });

  it('leaves out fields that are empty', () => {
    const text = formatPassportDetails({
      ...EMPTY_FIELDS,
      surname: 'GONZALEZ',
      passportNumber: 'X1234567',
    });

    expect(text).toBe('Surname: GONZALEZ\nPassport no: X1234567');
  });

  it('produces nothing at all when there is nothing to copy', () => {
    expect(formatPassportDetails(EMPTY_FIELDS)).toBe('');
  });
});
