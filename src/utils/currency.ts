// Multi-currency pricing for group trips — the "Booking.com method".
//
// Three currencies are in play and they are NOT interchangeable:
//
//   • STORED    — always USD. Every amount column in the database, every
//                 Stripe charge. Nothing in this file changes that.
//   • TRIP      — the currency the operator TYPED the price in
//                 (`budget_currency`), plus the rate frozen at that moment
//                 (`budget_fx_rate`, units of trip currency per 1 USD).
//                 Frozen once, never re-frozen on edit.
//   • VIEWER    — what this traveler SEES. Their override, else their country,
//                 else USD.
//
// The display rule, in order (see priceParts):
//   1. Viewer is on USD          → exact $. USD is the charge currency.
//   2. Viewer currency == trip's → the operator's REAL typed price, recovered
//                                  through the trip's frozen rate.
//   3. Otherwise                 → convert at today's cached rate, whole units.
//   4. No rate for (3)           → fall back to exact $. We never invent a rate;
//                                  a wrong price is worse than a foreign one.
//
// Every case prints a clean number. Booking.com shows a converted price as
// "AR$ 1,372,979" — no marker — and carries the caveat separately: an ⓘ beside
// the price, and a full sentence at checkout. We do the same; the sentence is
// `approxPaymentNote`, shown where the money is actually committed.
//
// Case 1 is checked before case 2 on purpose: legacy rows can carry
// `budget_currency = 'USD'` together with an ILS `budget_fx_rate` (the old
// create flow stored the ILS rate regardless of input currency), so matching
// "trip currency == viewer currency" on USD would multiply by the wrong number.

export type CurrencyCode =
  | 'USD' | 'ILS' | 'EUR' | 'GBP' | 'AUD' | 'NZD' | 'CAD'
  | 'CHF' | 'BRL' | 'JPY' | 'SEK' | 'NOK' | 'DKK' | 'ZAR';

/**
 * Symbols are a hand-kept table rather than `Intl.NumberFormat(…, {style:
 * 'currency'})` on purpose: Hermes resolves Intl against the platform's ICU, so
 * the same amount can render "$1,200" on iOS, "US$1,200" on Android and a third
 * way under Node in jest. Trip prices sit next to each other in lists — they
 * have to be byte-identical everywhere. Every symbol here is written BEFORE the
 * number, including the Scandinavian ones (locally "1 234 kr"), so that a
 * column of prices in mixed currencies still aligns on the left.
 */
const SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  ILS: '₪',
  EUR: '€',
  GBP: '£',
  // "$" alone is three different currencies. Never print it bare for these.
  AUD: 'AU$',
  NZD: 'NZ$',
  CAD: 'CA$',
  BRL: 'R$',
  ZAR: 'R',
  JPY: '¥',
  // No distinctive glyph (all three Nordics use "kr") — the ISO code IS clearer.
  CHF: 'CHF ',
  SEK: 'SEK ',
  NOK: 'NOK ',
  DKK: 'DKK ',
};

/** Picker order: charge currency first, then home market, then by reach. */
export const CURRENCY_ORDER: CurrencyCode[] = [
  'USD', 'ILS', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD',
  'CHF', 'BRL', 'JPY', 'SEK', 'NOK', 'DKK', 'ZAR',
];

/** The short list an operator can TYPE a price in. Display list is far longer. */
export const OPERATOR_CURRENCIES: CurrencyCode[] = ['USD', 'ILS', 'EUR', 'GBP'];

const CURRENCY_SET = new Set<string>(CURRENCY_ORDER);

/** Full display name, for the settings picker. */
export const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  USD: 'US Dollar',
  ILS: 'Israeli Shekel',
  EUR: 'Euro',
  GBP: 'British Pound',
  AUD: 'Australian Dollar',
  NZD: 'New Zealand Dollar',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  BRL: 'Brazilian Real',
  JPY: 'Japanese Yen',
  SEK: 'Swedish Krona',
  NOK: 'Norwegian Krone',
  DKK: 'Danish Krone',
  ZAR: 'South African Rand',
};

/**
 * `country_from` holds full country names (the onboarding picker's labels).
 * Anything not listed falls through to USD — deliberately, because USD is the
 * currency we actually charge in, so it is the only safe default.
 */
export const COUNTRY_TO_CURRENCY: Record<string, CurrencyCode> = {
  Israel: 'ILS',
  'United Kingdom': 'GBP',
  Australia: 'AUD',
  'New Zealand': 'NZD',
  Canada: 'CAD',
  Switzerland: 'CHF',
  Brazil: 'BRL',
  Japan: 'JPY',
  Sweden: 'SEK',
  Norway: 'NOK',
  Denmark: 'DKK',
  'South Africa': 'ZAR',
  // Eurozone
  Austria: 'EUR', Belgium: 'EUR', Croatia: 'EUR', Cyprus: 'EUR', Estonia: 'EUR',
  Finland: 'EUR', France: 'EUR', Germany: 'EUR', Greece: 'EUR', Ireland: 'EUR',
  Italy: 'EUR', Latvia: 'EUR', Lithuania: 'EUR', Luxembourg: 'EUR', Malta: 'EUR',
  Netherlands: 'EUR', Portugal: 'EUR', Slovakia: 'EUR', Slovenia: 'EUR', Spain: 'EUR',
};

/** Rates keyed by currency, expressed as units per 1 USD. */
export type Rates = Partial<Record<CurrencyCode, number>>;

/**
 * Everything a price needs to know about who is looking at it. Built once per
 * screen by `useViewer()` and passed down — never re-derived per row, because
 * a fresh object per card would re-render every price in the deck.
 */
export interface Viewer {
  currency: CurrencyCode;
  /** Today's rates. `null` when nothing has ever been cached (offline first run). */
  rates: Rates | null;
}

/** The pricing fields this module reads off a trip. Both may be absent. */
export interface TripPricing {
  budget_currency?: string | null;
  budget_fx_rate?: number | null;
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCY_SET.has(value);
}

function validRate(rate: number | null | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

/** Auto currency for a profile country. Unknown / null → USD. */
export function currencyForCountry(country: string | null | undefined): CurrencyCode {
  if (!country) return 'USD';
  return COUNTRY_TO_CURRENCY[country] ?? 'USD';
}

/**
 * The viewer's effective currency: explicit override wins, else their country,
 * else USD. Auto-detection alone is not enough — it is wrong for anyone who
 * travels, moved, or filled onboarding in a hurry — which is exactly why the
 * settings override exists.
 */
export function resolveViewerCurrency(
  country: string | null | undefined,
  override: string | null | undefined,
): CurrencyCode {
  if (isCurrencyCode(override)) return override;
  return currencyForCountry(country);
}

/** USD → trip currency at the trip's frozen rate. */
export function toTripCurrency(usd: number, rate: number): number {
  return usd * rate;
}

/**
 * Trip currency → USD, keeping cents.
 *
 * The cents matter. Storing whole dollars means ₪4,500 ÷ 3.5 = $1,286 comes
 * back out as ₪4,501, and the operator sees a price they never typed. Two
 * decimals make the round trip exact for every realistic rate, and every
 * downstream consumer already handles cents (`cost_per_person` is numeric,
 * Stripe charges in cents, `formatExactUsd` prints them).
 */
export function fromTripCurrency(amount: number, rate: number): number {
  return Math.round((amount / rate) * 100) / 100;
}

const SNAP_STEPS = [100, 50, 10, 5, 1];

/**
 * Undo round-trip drift without inventing a different price.
 *
 * A price stored in USD and converted back is never bit-exact — legacy rows
 * (whole-dollar storage) can land up to half a rate-unit off, e.g. ₪4,500
 * comes back as ₪4,501. Snapping blindly to the nearest ₪100 fixes that one
 * and breaks ₪4,550 into ₪4,600.
 *
 * So: snap to the COARSEST round number that is within the known drift, and
 * otherwise leave the number alone. The result can never move further than the
 * error already baked into the stored value, which makes this safe by
 * construction rather than by taste.
 */
export function snapToRound(raw: number, rate: number): number {
  if (!Number.isFinite(raw)) return 0;
  const noise = Math.max(1, rate * 0.5 + 0.5);
  for (const step of SNAP_STEPS) {
    const candidate = Math.round(raw / step) * step;
    if (Math.abs(raw - candidate) <= noise) return candidate;
  }
  return Math.round(raw);
}

/** Whole units with thousands separators, e.g. `₪4,500` / `AU$1,200`. */
export function formatAmount(amount: number, code: CurrencyCode): string {
  const whole = Math.round(amount);
  return `${SYMBOLS[code]}${whole.toLocaleString('en-US')}`;
}

interface PriceParts {
  amount: number;
  code: CurrencyCode;
  /**
   * True when this is a conversion at today's rate rather than a real price.
   *
   * It does NOT put a marker on the number. Booking.com prints the converted
   * amount clean — "AR$ 1,372,979" — and carries the caveat separately, in an
   * ⓘ beside the price and in a full sentence at checkout. A "≈" glued to every
   * price makes the whole app look unsure of itself, and the traveler cannot
   * act on it anyway: the caveat only matters at the moment they pay, which is
   * exactly where `approxPaymentNote` says it in words.
   */
  approx: boolean;
}

function priceParts(usd: number, trip: TripPricing | null | undefined, viewer: Viewer): PriceParts {
  const code = viewer.currency;

  // 1. USD viewer — this is the currency we actually charge. Never an estimate.
  if (code === 'USD') return { amount: Math.round(usd), code: 'USD', approx: false };

  // 2. Viewer's currency is the one the operator typed in → their real price.
  const tripCode = trip?.budget_currency;
  const frozen = trip?.budget_fx_rate;
  if (isCurrencyCode(tripCode) && tripCode === code && validRate(frozen)) {
    return { amount: snapToRound(toTripCurrency(usd, frozen), frozen), code, approx: false };
  }

  // 3. Estimate at today's rate.
  const daily = viewer.rates?.[code];
  if (validRate(daily)) return { amount: Math.round(usd * daily), code, approx: true };

  // 4. No rate anywhere — show what we charge rather than a guess.
  return { amount: Math.round(usd), code: 'USD', approx: false };
}

/** One trip price in the viewer's currency. Clean number, no marker. */
export function formatTripPrice(
  usd: number | null | undefined,
  trip: TripPricing | null | undefined,
  viewer: Viewer,
): string | null {
  if (usd == null) return null;
  const parts = priceParts(usd, trip, viewer);
  return formatAmount(parts.amount, parts.code);
}

/**
 * Is this price a conversion rather than a real one? For an ⓘ affordance or a
 * footnote — never for decorating the number itself.
 */
export function isConvertedPrice(
  trip: TripPricing | null | undefined,
  viewer: Viewer,
): boolean {
  return priceParts(1, trip, viewer).approx;
}

/** A min/max trip price range in the viewer's currency. */
export function formatTripPriceRange(
  usdMin: number | null | undefined,
  usdMax: number | null | undefined,
  trip: TripPricing | null | undefined,
  viewer: Viewer,
): string | null {
  if (usdMin == null && usdMax == null) return null;

  // Both ends share one trip and one viewer, so they agree on currency —
  // resolve it once so a range can never mix two symbols.
  const ref = priceParts(usdMin ?? usdMax ?? 0, trip, viewer);
  const one = (usd: number) => formatAmount(priceParts(usd, trip, viewer).amount, ref.code);

  if (usdMin != null && usdMax != null) return `${one(usdMin)}-${one(usdMax)}`;
  if (usdMin != null) return `${one(usdMin)}+`;
  return `up to ${one(usdMax as number)}`;
}

/**
 * The local-currency hint beside a payment amount.
 *
 * ALWAYS at today's rate — even when the viewer's currency is the one the
 * operator typed in. At browse time the operator's frozen price is the honest
 * number; at pay time it is not, because the bank converts at today's rate, not
 * at one frozen months ago. Booking.com's checkout estimate works the same way.
 *
 * No "≈": this always sits beside the exact USD figure being charged, and
 * `approxPaymentNote` states the caveat in words right underneath. The number
 * is the secondary one on the row already.
 *
 * Returns null when the viewer is on USD (there is nothing to add) or when no
 * rate is cached.
 */
export function formatApproxLocal(
  usd: number | null | undefined,
  viewer: Viewer,
): string | null {
  if (usd == null || viewer.currency === 'USD') return null;
  const daily = viewer.rates?.[viewer.currency];
  if (!validRate(daily)) return null;
  return formatAmount(usd * daily, viewer.currency);
}

/**
 * An amount shown to the OPERATOR in the currency they are typing in.
 *
 * Not the same job as formatTripPrice: there is no viewer here and no estimate
 * — the operator is looking at their own money in their own currency.
 * Falls back to USD (what we store and charge) rather than guessing when no
 * rate is available.
 */
export function formatOperatorAmount(
  usd: number,
  code: CurrencyCode,
  rate: number | null | undefined,
): string {
  if (!Number.isFinite(usd)) return `${SYMBOLS[code]}—`;
  if (code === 'USD' || !validRate(rate)) return formatAmount(usd, 'USD');
  return formatAmount(snapToRound(toTripCurrency(usd, rate), rate), code);
}

/**
 * The Booking.com sentence, in our words. Three promises: it is approximate,
 * here is what you will actually be charged, and the rate can still move.
 * Returns null for USD viewers — for them none of it is true.
 */
export function approxPaymentNote(viewer: Viewer): string | null {
  if (viewer.currency === 'USD') return null;
  if (!validRate(viewer.rates?.[viewer.currency])) return null;
  const symbol = SYMBOLS[viewer.currency].trim();
  return `The ${symbol} price is approximate. You'll pay in US$. The exchange rate may change before you pay.`;
}
