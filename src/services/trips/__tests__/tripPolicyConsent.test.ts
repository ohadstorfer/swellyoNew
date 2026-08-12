/**
 * The consent string is the evidence.
 *
 * `consentText()` is what gets stored and hashed server-side, and
 * `consentCopy()` is what the sheet renders. These tests exist to hold those
 * two together: if they can ever disagree, the row that is supposed to prove
 * "we showed this traveler exactly these words" stops proving anything.
 *
 * The matching rule downstream is a plain string equality against the stored
 * `shown_text`, so a change to this output re-asks every traveler on a
 * policy-carrying trip. That is correct when the TERMS change and wasteful
 * when only our wording does — which is the second reason to pin it here.
 */
import {
  consentCopy,
  consentText,
} from '../tripPolicyConsent';
import type { CancellationPolicy } from '../cancellationPolicy';

jest.mock('../../../config/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const policy = (over: Partial<CancellationPolicy> = {}): CancellationPolicy => ({
  preset: 'standard',
  rules: [],
  notes: null,
  ...over,
});

describe('consentText', () => {
  it('is exactly the fields the sheet renders, in the order it renders them', () => {
    const p = policy({ preset: 'custom', rules: [{ daysBefore: 30, refundPct: 50 }], notes: 'Ask us first.' });
    const copy = consentCopy(p);

    // Composed from the SAME fields the sheet lays out — not re-derived here,
    // which would let this test pass while the two drifted apart.
    expect(consentText(p)).toBe(
      [copy.title, ...copy.steps, copy.notes, copy.footer].join('\n'),
    );
  });

  it('states who actually pays a refund', () => {
    // Not decoration. The money sits in the operator's Stripe account and
    // Swellyo has no refund path of its own, so a record of the traveler
    // accepting terms must never read as Swellyo promising to honour them.
    expect(consentText(policy())).toContain('Refunds are paid by the trip operator, not Swellyo.');
  });

  it('says the no-refund case out loud instead of listing nothing', () => {
    // `non_refundable` has no rules at all. An empty list would render as a
    // policy with no terms — the one reading a traveler must not be given.
    expect(consentText(policy({ preset: 'non_refundable' }))).toContain('No refund at any time');
  });

  it('includes the operator\'s own notes, and omits the line when there are none', () => {
    const withNotes = consentText(policy({ notes: '  Peak season is final sale.  ' }));
    expect(withNotes).toContain('Peak season is final sale.');
    // Trimmed, so trailing whitespace typed in the operator's form cannot
    // change the hash of terms that read identically.
    expect(withNotes).not.toContain('  Peak season');

    // Whitespace-only notes add no line at all — an empty paragraph between
    // the steps and the footer would read as something we forgot to fill in.
    const noNotes = consentText(policy({ notes: '   ' }));
    const bare = consentText(policy({ notes: null }));
    expect(noNotes).toBe(bare);
    expect(noNotes.split('\n').every(line => line.trim().length > 0)).toBe(true);
  });

  it('changes when the terms change — which is what re-asks the traveler', () => {
    const before = consentText(policy({ preset: 'standard' }));
    const after = consentText(policy({ preset: 'non_refundable' }));
    expect(before).not.toBe(after);
  });
});
