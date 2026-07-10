import { getStrongDirection } from '../textDirection';

describe('getStrongDirection', () => {
  // Neutral content — no strong directional character. These are the cases
  // where the keyboard direction gets to break the tie.
  it.each([
    ['empty string', ''],
    ['single emoji', '😋'],
    ['multiple emoji', '😋🤙🏼🌊'],
    ['ZWJ family emoji', '👨‍👩‍👧'],
    ['flag emoji', '🇮🇱'],
    ['digits only', '123'],
    ['digits + emoji', '123 😋'],
    ['punctuation', '?!.,:;'],
    ['whitespace', '   \n '],
  ])('returns null for neutral content: %s', (_label, text) => {
    expect(getStrongDirection(text)).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(getStrongDirection(null)).toBeNull();
    expect(getStrongDirection(undefined)).toBeNull();
  });

  // Strong content — first strong character wins (Unicode bidi convention).
  it.each([
    ['plain English', 'hello', 'ltr'],
    ['accented Latin', 'café', 'ltr'],
    ['Hebrew', 'שלום', 'rtl'],
    ['Arabic', 'مرحبا', 'rtl'],
    ['emoji then English', '😋 hello', 'ltr'],
    ['emoji then Hebrew', '😋 שלום', 'rtl'],
    ['digits then Hebrew', '123 שלום', 'rtl'],
    ['English then Hebrew (first strong wins)', 'ok שלום', 'ltr'],
    ['Hebrew then English (first strong wins)', 'שלום ok', 'rtl'],
  ])('%s → %s', (_label, text, expected) => {
    expect(getStrongDirection(text)).toBe(expected);
  });
});
