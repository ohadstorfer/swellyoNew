// Multi-currency pricing helpers for group trips.
// USD is the canonical stored currency; ₪ is derived via a per-trip frozen rate.
// Israeli users (country_from === 'Israel') see ₪, everyone else sees $.

export const FALLBACK_USD_TO_ILS = 3.0;

const ISRAEL = 'Israel';

/** True only for the exact profile country string 'Israel'. Null/other → false. */
export function isIsraeli(country: string | null | undefined): boolean {
  return country === ISRAEL;
}

function validRate(rate: number | null | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

/** USD → ₪, rounded to a whole shekel. */
export function usdToIls(usd: number, rate: number): number {
  return Math.round(usd * rate);
}

/** ₪ → USD, rounded to a whole dollar. */
export function ilsToUsd(ils: number, rate: number): number {
  return Math.round(ils / rate);
}

const ILS_ROUND_STEP = 100;

/**
 * Round a ₪ amount to the nearest ₪100 for display (₪4,220 → ₪4,200).
 *
 * Display-only. Never feed the result back into ilsToUsd — the stored USD would
 * drift a little on every round-trip. Sub-₪50 amounts fall back to the nearest
 * ₪10 so a real price can never collapse to ₪0.
 */
export function roundIlsForDisplay(ils: number): number {
  if (!Number.isFinite(ils) || ils <= 0) return 0;
  const rounded = Math.round(ils / ILS_ROUND_STEP) * ILS_ROUND_STEP;
  if (rounded > 0) return rounded;
  return Math.max(10, Math.round(ils / 10) * 10);
}

/** USD → ₪ for display: converts, then rounds to the nearest ₪100. */
export function usdToIlsDisplay(usd: number, rate: number): number {
  return roundIlsForDisplay(usd * rate);
}

function symbolAndAmount(
  usd: number,
  fxRate: number | null | undefined,
  viewerCountry: string | null | undefined,
): { symbol: string; amount: number } {
  if (isIsraeli(viewerCountry) && validRate(fxRate)) {
    return { symbol: '₪', amount: usdToIlsDisplay(usd, fxRate) };
  }
  return { symbol: '$', amount: Math.round(usd) };
}

/** Format one USD amount in the viewer's currency, whole numbers only. */
export function formatPrice(
  usdAmount: number | null | undefined,
  fxRate: number | null | undefined,
  viewerCountry: string | null | undefined,
): string | null {
  if (usdAmount == null) return null;
  const { symbol, amount } = symbolAndAmount(usdAmount, fxRate, viewerCountry);
  return `${symbol}${amount.toLocaleString('en-US')}`;
}

/** Format a USD min/max range in the viewer's currency. */
export function formatPriceRange(
  usdMin: number | null | undefined,
  usdMax: number | null | undefined,
  fxRate: number | null | undefined,
  viewerCountry: string | null | undefined,
): string | null {
  if (usdMin == null && usdMax == null) return null;
  if (usdMin != null && usdMax != null) {
    return `${formatPrice(usdMin, fxRate, viewerCountry)}-${formatPrice(usdMax, fxRate, viewerCountry)}`;
  }
  if (usdMin != null) return `${formatPrice(usdMin, fxRate, viewerCountry)}+`;
  return `up to ${formatPrice(usdMax, fxRate, viewerCountry)}`;
}
