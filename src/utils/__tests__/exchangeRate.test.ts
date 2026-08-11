// src/utils/__tests__/exchangeRate.test.ts
import { fetchAllRates } from '../exchangeRate';

/**
 * The whole point of this module after the multi-currency change: it returns
 * null on failure instead of a hardcoded rate. A wrong rate misprices every
 * trip in the app and nothing downstream can tell; null makes callers show USD,
 * which is what we actually charge.
 */
describe('fetchAllRates', () => {
  afterEach(() => {
    // @ts-ignore
    global.fetch = undefined;
  });

  const okResponse = (rates: Record<string, unknown>) => ({
    ok: true,
    json: async () => ({ result: 'success', rates }),
  });

  it('returns every supported rate from one call', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue(
      okResponse({ ILS: 3.65, EUR: 0.92, GBP: 0.79, JPY: 150, XXX: 42 }),
    );
    const rates = await fetchAllRates();
    expect(rates).toMatchObject({ ILS: 3.65, EUR: 0.92, GBP: 0.79, JPY: 150 });
    // Currencies we do not support are dropped, not carried around.
    expect(rates).not.toHaveProperty('XXX');
  });

  it('always pins USD to 1', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue(okResponse({ ILS: 3.65 }));
    await expect(fetchAllRates()).resolves.toMatchObject({ USD: 1 });
  });

  it('drops non-finite and non-positive rates', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue(
      okResponse({ ILS: 0, EUR: -1, GBP: 'nope', JPY: 150 }),
    );
    const rates = await fetchAllRates();
    expect(rates).not.toHaveProperty('ILS');
    expect(rates).not.toHaveProperty('EUR');
    expect(rates).not.toHaveProperty('GBP');
    expect(rates).toMatchObject({ JPY: 150 });
  });

  it('returns null when the network throws', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchAllRates()).resolves.toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(fetchAllRates()).resolves.toBeNull();
  });

  it('returns null when the payload carries no usable rate', async () => {
    // A response with nothing but the USD-to-itself pin is a failed fetch, not
    // a rate set — otherwise it would be cached and served as if it were real.
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue(okResponse({}));
    await expect(fetchAllRates()).resolves.toBeNull();
  });

  it('returns null when the body has no rates object at all', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(fetchAllRates()).resolves.toBeNull();
  });
});
