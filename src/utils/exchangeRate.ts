// Fetches the current USD->ILS rate once, at trip price-set time.
// Never throws: on any failure returns FALLBACK_USD_TO_ILS so pricing is never blocked.
import { FALLBACK_USD_TO_ILS } from './currency';

const RATE_URL = 'https://open.er-api.com/v6/latest/USD';

export async function fetchUsdToIls(): Promise<number> {
  try {
    const res = await fetch(RATE_URL);
    if (!res.ok) return FALLBACK_USD_TO_ILS;
    const data = await res.json();
    const rate = data?.rates?.ILS;
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      return rate;
    }
    return FALLBACK_USD_TO_ILS;
  } catch {
    return FALLBACK_USD_TO_ILS;
  }
}
