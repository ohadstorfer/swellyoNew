// Display arithmetic for the operator Dashboard.
//
// These two functions exist as functions, rather than inline in the component,
// precisely because their edge cases are the whole point:
//
//   1. `medicalFlagLine` used to print zeros. "0 medications" is not
//      information — it is noise crowding out the counts that carry signal —
//      and an all-zero line has to be distinguishable from "no data" so the
//      caller can say "Nothing flagged." instead.
//   2. `outstandingUsd` must never go negative. An over-refund would otherwise
//      render as the operator owing the traveler.

import { medicalFlagLine, outstandingUsd, formatUsd, plural } from '../dashboardFormat';

const NONE = {
  injuriesReported: 0,
  allergiesReported: 0,
  dietaryReported: 0,
  medicationsReported: 0,
};

describe('medicalFlagLine', () => {
  it('drops zero counts instead of printing them', () => {
    expect(medicalFlagLine({ ...NONE, injuriesReported: 2 })).toBe('2 injuries');
  });

  it('returns an empty string when nothing is flagged, so the caller can say so', () => {
    // NOT "0 injuries · 0 allergies · 0 diet notes · 0 medications", which is
    // what this rendered before, and NOT the same as having no data at all.
    expect(medicalFlagLine(NONE)).toBe('');
  });

  it('joins every flagged count with the separator', () => {
    expect(
      medicalFlagLine({
        injuriesReported: 2,
        allergiesReported: 1,
        dietaryReported: 3,
        medicationsReported: 4,
      }),
    ).toBe('2 injuries · 1 allergy · 3 diet notes · 4 medications');
  });

  it('gets the irregular singulars right', () => {
    expect(
      medicalFlagLine({
        injuriesReported: 1,
        allergiesReported: 1,
        dietaryReported: 1,
        medicationsReported: 1,
      }),
    ).toBe('1 injury · 1 allergy · 1 diet note · 1 medication');
  });

  it('keeps only the flagged ones when some are zero', () => {
    expect(
      medicalFlagLine({ ...NONE, allergiesReported: 1, medicationsReported: 2 }),
    ).toBe('1 allergy · 2 medications');
  });
});

describe('outstandingUsd', () => {
  it('subtracts collected from expected', () => {
    expect(outstandingUsd(9000, 4200)).toBe(4800);
  });

  it('is zero when everything is paid', () => {
    // The caller hides the line at 0 — "$0 still owed" reads as a balance to
    // chase, and a full collected figure already says everyone has paid.
    expect(outstandingUsd(9000, 9000)).toBe(0);
  });

  it('clamps at zero when more came in than was expected', () => {
    // An over-refund, or a price lowered after payment. A negative here would
    // render as the operator owing the traveler.
    expect(outstandingUsd(9000, 9500)).toBe(0);
  });

  it('handles a trip that expects nothing', () => {
    expect(outstandingUsd(0, 0)).toBe(0);
  });
});

// Guards for the two helpers the above lean on — both already shipped, both
// easy to break from the outside.
describe('formatUsd', () => {
  it('drops cents when there are none', () => {
    expect(formatUsd(1200)).toBe('$1,200');
  });

  it('keeps real cents', () => {
    expect(formatUsd(1200.5)).toBe('$1,200.50');
  });

  it('renders an em dash rather than "$NaN" for missing money', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
    expect(formatUsd(Number.NaN)).toBe('—');
  });
});

describe('plural', () => {
  it('takes an explicit plural because English is not regular', () => {
    expect(plural(1, 'allergy', 'allergies')).toBe('1 allergy');
    expect(plural(2, 'allergy', 'allergies')).toBe('2 allergies');
  });

  it('falls back to +s', () => {
    expect(plural(0, 'document')).toBe('0 documents');
    expect(plural(1, 'document')).toBe('1 document');
  });
});
