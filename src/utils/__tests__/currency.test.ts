import {
  approxPaymentNote,
  isConvertedPrice,
  currencyForCountry,
  formatAmount,
  formatApproxLocal,
  formatTripPrice,
  formatTripPriceRange,
  fromTripCurrency,
  isCurrencyCode,
  resolveViewerCurrency,
  snapToRound,
  type Rates,
  type TripPricing,
  type Viewer,
} from '../currency';

const RATES: Rates = { USD: 1, ILS: 3.5, EUR: 0.92, GBP: 0.79, JPY: 150 };

const viewer = (currency: Viewer['currency'], rates: Rates | null = RATES): Viewer => ({
  currency,
  rates,
});

/** A trip an Israeli operator priced at ₪4,500, stored with cents. */
const ILS_TRIP: TripPricing = { budget_currency: 'ILS', budget_fx_rate: 3.5 };
/** Legacy row: priced in $, but the old flow still froze the ILS rate. */
const USD_TRIP: TripPricing = { budget_currency: 'USD', budget_fx_rate: 3.5 };
/** Pre-multi-currency row. */
const BARE_TRIP: TripPricing = { budget_currency: null, budget_fx_rate: null };

describe('currency resolution', () => {
  it('maps countries to currencies, unknown falls to USD', () => {
    expect(currencyForCountry('Israel')).toBe('ILS');
    expect(currencyForCountry('Portugal')).toBe('EUR');
    expect(currencyForCountry('United Kingdom')).toBe('GBP');
    expect(currencyForCountry('United States')).toBe('USD');
    expect(currencyForCountry('Narnia')).toBe('USD');
    expect(currencyForCountry(null)).toBe('USD');
    expect(currencyForCountry(undefined)).toBe('USD');
  });

  it('lets an explicit override beat the country', () => {
    expect(resolveViewerCurrency('Israel', 'EUR')).toBe('EUR');
    expect(resolveViewerCurrency('Israel', null)).toBe('ILS');
    expect(resolveViewerCurrency('Israel', undefined)).toBe('ILS');
    // A currency we do not support is ignored, not trusted.
    expect(resolveViewerCurrency('Israel', 'XYZ')).toBe('ILS');
  });

  it('validates currency codes', () => {
    expect(isCurrencyCode('ILS')).toBe(true);
    expect(isCurrencyCode('ils')).toBe(false);
    expect(isCurrencyCode('XYZ')).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });
});

describe('formatAmount', () => {
  it('puts the symbol first and groups thousands', () => {
    expect(formatAmount(4500, 'ILS')).toBe('₪4,500');
    expect(formatAmount(1285.71, 'USD')).toBe('$1,286');
    expect(formatAmount(1190, 'EUR')).toBe('€1,190');
  });

  it('disambiguates the dollar currencies and uses codes where no glyph exists', () => {
    expect(formatAmount(1200, 'AUD')).toBe('AU$1,200');
    expect(formatAmount(1200, 'CAD')).toBe('CA$1,200');
    expect(formatAmount(1200, 'NZD')).toBe('NZ$1,200');
    expect(formatAmount(1200, 'SEK')).toBe('SEK 1,200');
    expect(formatAmount(1200, 'CHF')).toBe('CHF 1,200');
  });

  it('shows whole units, including for zero-decimal currencies', () => {
    expect(formatAmount(120000, 'JPY')).toBe('¥120,000');
  });
});

describe('fromTripCurrency keeps the round trip honest', () => {
  it('stores cents so the operator sees back the price they typed', () => {
    const usd = fromTripCurrency(4500, 3.5);
    expect(usd).toBe(1285.71);
    expect(Math.round(usd * 3.5)).toBe(4500);
  });

  it('is exact when the division comes out clean', () => {
    expect(fromTripCurrency(4550, 3.5)).toBe(1300);
  });
});

describe('snapToRound', () => {
  it('recovers a round price from round-trip drift', () => {
    // Legacy whole-dollar row: ₪4,500 stored as $1,286 comes back as ₪4,501.
    expect(snapToRound(4501, 3.5)).toBe(4500);
  });

  it('does not invent a round price that was never typed', () => {
    // ₪4,550 is a real price. Snapping to ₪4,600 would be a 50-shekel lie.
    expect(snapToRound(4550, 3.5)).toBe(4550);
  });

  it('never moves a number further than the drift it corrects', () => {
    const rate = 3.5;
    const noise = rate * 0.5 + 0.5;
    for (const raw of [4523, 1187, 999, 12473, 87]) {
      expect(Math.abs(snapToRound(raw, rate) - raw)).toBeLessThanOrEqual(noise);
    }
  });

  it('stays tight for low-rate currencies', () => {
    expect(snapToRound(1187, 0.92)).toBe(1187);
    expect(snapToRound(1200, 0.92)).toBe(1200);
  });
});

describe('formatTripPrice — the three cases', () => {
  it('case 1: USD viewer sees exact $, never marked approximate', () => {
    expect(formatTripPrice(1285.71, ILS_TRIP, viewer('USD'))).toBe('$1,286');
    expect(formatTripPrice(1285.71, BARE_TRIP, viewer('USD'))).toBe('$1,286');
  });

  it('case 2: viewer currency == trip currency shows the real typed price', () => {
    expect(formatTripPrice(1285.71, ILS_TRIP, viewer('ILS'))).toBe('₪4,500');
  });

  it('case 2 works for a legacy whole-dollar row too', () => {
    expect(formatTripPrice(1286, ILS_TRIP, viewer('ILS'))).toBe('₪4,500');
  });

  it('case 3: any other currency converts at today’s rate — clean, no marker', () => {
    // 1285.71 * 0.92 = 1182.9 -> 1183. Booking.com prints the converted number
    // plainly; the caveat lives in approxPaymentNote, not on the figure.
    expect(formatTripPrice(1285.71, ILS_TRIP, viewer('EUR'))).toBe('€1,183');
  });

  it('case 3 applies to an Israeli looking at a $-priced trip', () => {
    // The trip's frozen rate belongs to the operator's currency, not the
    // viewer's — a USD trip is converted at today's rate like any other.
    expect(formatTripPrice(1000, USD_TRIP, viewer('ILS'))).toBe('₪3,500');
  });

  it('case 4: no rate for the viewer falls back to $, never a guess', () => {
    // Nothing cached and the trip is not in the viewer's currency.
    expect(formatTripPrice(1000, USD_TRIP, viewer('ILS', null))).toBe('$1,000');
    expect(formatTripPrice(1000, BARE_TRIP, viewer('EUR', { USD: 1 }))).toBe('$1,000');
  });

  it('still shows the real price offline when the rate rides on the trip', () => {
    // Case 2 reads budget_fx_rate off the trip row, so an Israeli with no
    // cached rates at all still sees the operator's real ₪ price.
    expect(formatTripPrice(1000, ILS_TRIP, viewer('ILS', null))).toBe('₪3,500');
  });

  it('returns null when there is no price', () => {
    expect(formatTripPrice(null, ILS_TRIP, viewer('ILS'))).toBeNull();
    expect(formatTripPrice(undefined, ILS_TRIP, viewer('ILS'))).toBeNull();
  });
});

describe('formatTripPriceRange', () => {
  it('keeps one currency across both ends of a converted range', () => {
    expect(formatTripPriceRange(1000, 2000, ILS_TRIP, viewer('EUR'))).toBe('€920-€1,840');
  });

  it('formats a real price range in the trip’s own currency', () => {
    expect(formatTripPriceRange(1000, 2000, ILS_TRIP, viewer('ILS'))).toBe('₪3,500-₪7,000');
    expect(formatTripPriceRange(1500, 2000, ILS_TRIP, viewer('USD'))).toBe('$1,500-$2,000');
  });

  it('handles open-ended ranges', () => {
    expect(formatTripPriceRange(1500, null, ILS_TRIP, viewer('USD'))).toBe('$1,500+');
    expect(formatTripPriceRange(null, 2000, ILS_TRIP, viewer('USD'))).toBe('up to $2,000');
    expect(formatTripPriceRange(null, null, ILS_TRIP, viewer('ILS'))).toBeNull();
  });
});

describe('payment surfaces', () => {
  it('hints always use today’s rate, and carry no marker of their own', () => {
    // Even for the trip's own currency — at pay time the bank uses today's
    // rate, not the one frozen when the operator set the price.
    expect(formatApproxLocal(1000, viewer('ILS'))).toBe('₪3,500');
    expect(formatApproxLocal(1000, viewer('EUR'))).toBe('€920');
  });

  it('adds nothing for a USD viewer or with no rate', () => {
    expect(formatApproxLocal(1000, viewer('USD'))).toBeNull();
    expect(formatApproxLocal(1000, viewer('ILS', null))).toBeNull();
    expect(formatApproxLocal(null, viewer('ILS'))).toBeNull();
  });

  it('states all three promises, and only where they are true', () => {
    expect(approxPaymentNote(viewer('ILS'))).toBe(
      "The ₪ price is approximate. You'll pay in US$. The exchange rate may change before you pay.",
    );
    expect(approxPaymentNote(viewer('USD'))).toBeNull();
    expect(approxPaymentNote(viewer('ILS', null))).toBeNull();
  });

  it('uses a trimmed symbol in the note for code-style currencies', () => {
    expect(approxPaymentNote(viewer('SEK', { USD: 1, SEK: 10 }))).toContain('The SEK price is approximate.');
  });
});

describe('no price ever carries an approximation marker', () => {
  it('is absent from every formatter, converted or not', () => {
    const strings = [
      formatTripPrice(1285.71, ILS_TRIP, viewer('EUR')),
      formatTripPrice(1285.71, ILS_TRIP, viewer('ILS')),
      formatTripPrice(1285.71, ILS_TRIP, viewer('USD')),
      formatTripPriceRange(1000, 2000, ILS_TRIP, viewer('EUR')),
      formatApproxLocal(1000, viewer('ILS')),
      formatAmount(1200, 'JPY'),
    ];
    strings.forEach(str => expect(str ?? '').not.toContain('\u2248'));
  });

  it('still reports WHICH prices are conversions, for an ⓘ or a footnote', () => {
    expect(isConvertedPrice(ILS_TRIP, viewer('EUR'))).toBe(true);
    expect(isConvertedPrice(ILS_TRIP, viewer('ILS'))).toBe(false);
    expect(isConvertedPrice(ILS_TRIP, viewer('USD'))).toBe(false);
    // No rate to convert with — we fall back to USD, which is not a conversion.
    expect(isConvertedPrice(USD_TRIP, viewer('ILS', null))).toBe(false);
  });
});
