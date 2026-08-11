// Fetches every exchange rate we display, in one call.
//
// Was `fetchUsdToIls()` returning a single number with a hardcoded 3.0 fallback.
// The fallback is gone. Not because it was far off — USD/ILS was 2.9987 on
// 2026-08-10, so 3.0 was nearly right — but because it was a constant standing
// in for a moving number, with no signal when it drifted. It was written when
// 3.0 was accurate and would have gone on being trusted years later. A silently
// wrong price is unfixable by the user; a foreign-currency one is merely
// inconvenient. So this returns null on failure and the caller decides, which
// in practice always means "show USD".
//
// The endpoint returns all currencies in one response, so covering 14 costs
// exactly what covering 1 did.
import type { CurrencyCode, Rates } from './currency';
import { CURRENCY_ORDER } from './currency';

const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const TIMEOUT_MS = 8000;

/** All supported rates as units per 1 USD, or null if the fetch failed. */
export async function fetchAllRates(): Promise<Rates | null> {
  try {
    // The create flow blocks on this, so it cannot hang forever on a captive
    // wifi portal that accepts the connection and never answers.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(RATE_URL, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;

    const data = await res.json();
    const raw = data?.rates;
    if (!raw || typeof raw !== 'object') return null;

    const out: Rates = {};
    for (const code of CURRENCY_ORDER) {
      const value = raw[code];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out[code as CurrencyCode] = value;
      }
    }
    // USD against itself is always 1 — the endpoint includes it, but do not
    // depend on that.
    out.USD = 1;

    // A response that carried nothing we can use is a failure, not a rate set.
    return Object.keys(out).length > 1 ? out : null;
  } catch {
    return null;
  }
}
