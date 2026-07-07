// src/utils/__tests__/exchangeRate.test.ts
import { fetchUsdToIls } from '../exchangeRate';
import { FALLBACK_USD_TO_ILS } from '../currency';

describe('fetchUsdToIls', () => {
  afterEach(() => {
    // @ts-ignore
    global.fetch = undefined;
  });

  it('returns the live ILS rate on success', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'success', rates: { ILS: 3.65 } }),
    });
    await expect(fetchUsdToIls()).resolves.toBe(3.65);
  });

  it('falls back when the network throws', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchUsdToIls()).resolves.toBe(FALLBACK_USD_TO_ILS);
  });

  it('falls back when the rate is missing or non-finite', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'success', rates: {} }),
    });
    await expect(fetchUsdToIls()).resolves.toBe(FALLBACK_USD_TO_ILS);
  });

  it('falls back on a non-ok response', async () => {
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(fetchUsdToIls()).resolves.toBe(FALLBACK_USD_TO_ILS);
  });
});
