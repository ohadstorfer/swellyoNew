import {
  FALLBACK_USD_TO_ILS,
  isIsraeli,
  usdToIls,
  ilsToUsd,
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

  it('formats a single price by viewer country', () => {
    expect(formatPrice(500, 3.7, 'Israel')).toBe('₪1,850');
    expect(formatPrice(500, 3.7, 'United States')).toBe('$500');
    expect(formatPrice(500, 3.7, null)).toBe('$500');
    expect(formatPrice(null, 3.7, 'Israel')).toBeNull();
  });

  it('falls back to $ for Israeli viewer when rate is missing/invalid', () => {
    expect(formatPrice(500, null, 'Israel')).toBe('$500');
    expect(formatPrice(500, 0, 'Israel')).toBe('$500');
  });

  it('formats ranges in the viewer currency', () => {
    expect(formatPriceRange(1500, 2000, 3.7, 'United States')).toBe('$1,500-$2,000');
    expect(formatPriceRange(1500, 2000, 3.7, 'Israel')).toBe('₪5,550-₪7,400');
    expect(formatPriceRange(1500, null, 3.7, 'United States')).toBe('$1,500+');
    expect(formatPriceRange(null, 2000, 3.7, 'United States')).toBe('up to $2,000');
    expect(formatPriceRange(null, null, 3.7, 'Israel')).toBeNull();
  });

  it('exposes the fallback constant', () => {
    expect(FALLBACK_USD_TO_ILS).toBe(3.0);
  });
});
