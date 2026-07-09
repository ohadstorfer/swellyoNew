import {
  FALLBACK_USD_TO_ILS,
  isIsraeli,
  usdToIls,
  ilsToUsd,
  usdToIlsDisplay,
  roundIlsForDisplay,
  formatPrice,
  formatPriceRange,
} from '../currency';

describe('currency helpers', () => {
  it('detects Israel exactly, treats null/other as non-Israeli', () => {
    expect(isIsraeli('Israel')).toBe(true);
    expect(isIsraeli('United States')).toBe(false);
    expect(isIsraeli(null)).toBe(false);
    expect(isIsraeli(undefined)).toBe(false);
    expect(isIsraeli('israel')).toBe(false); // exact match only
  });

  it('converts and rounds to whole numbers', () => {
    expect(usdToIls(100, 3.7)).toBe(370);
    expect(ilsToUsd(370, 3.7)).toBe(100);
    expect(usdToIls(486.4, 3.7)).toBe(1800); // 486.4*3.7=1799.68 -> 1800
    expect(ilsToUsd(1800, 3.7)).toBe(486); // 1800/3.7=486.48 -> 486
  });

  it('rounds ₪ to the nearest 100 for display', () => {
    expect(roundIlsForDisplay(4220)).toBe(4200);
    expect(roundIlsForDisplay(4250)).toBe(4300);
    expect(roundIlsForDisplay(4280)).toBe(4300);
    expect(roundIlsForDisplay(12473)).toBe(12500);
  });

  it('never collapses a real ₪ price to zero', () => {
    expect(roundIlsForDisplay(40)).toBe(40);
    expect(roundIlsForDisplay(4)).toBe(10);
    expect(roundIlsForDisplay(0)).toBe(0);
    expect(roundIlsForDisplay(-5)).toBe(0);
    expect(roundIlsForDisplay(NaN)).toBe(0);
  });

  it('converts USD to ₪ and rounds to 100 in one step', () => {
    // 1134 * 3.7217 = 4220.4 -> 4200
    expect(usdToIlsDisplay(1134, 3.7217)).toBe(4200);
  });

  it('formats a single price by viewer country', () => {
    expect(formatPrice(500, 3.7, 'Israel')).toBe('₪1,900'); // 1850 -> nearest 100
    expect(formatPrice(500, 3.7, 'United States')).toBe('$500'); // $ never rounded
    expect(formatPrice(500, 3.7, null)).toBe('$500');
    expect(formatPrice(null, 3.7, 'Israel')).toBeNull();
  });

  it('falls back to $ for Israeli viewer when rate is missing/invalid', () => {
    expect(formatPrice(500, null, 'Israel')).toBe('$500');
    expect(formatPrice(500, 0, 'Israel')).toBe('$500');
  });

  it('formats ranges in the viewer currency', () => {
    expect(formatPriceRange(1500, 2000, 3.7, 'United States')).toBe('$1,500-$2,000');
    expect(formatPriceRange(1500, 2000, 3.7, 'Israel')).toBe('₪5,600-₪7,400'); // 5550/7400 -> nearest 100
    expect(formatPriceRange(1500, null, 3.7, 'United States')).toBe('$1,500+');
    expect(formatPriceRange(null, 2000, 3.7, 'United States')).toBe('up to $2,000');
    expect(formatPriceRange(null, null, 3.7, 'Israel')).toBeNull();
  });

  it('exposes the fallback constant', () => {
    expect(FALLBACK_USD_TO_ILS).toBe(3.0);
  });
});
