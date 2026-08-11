// One shared, cached copy of today's exchange rates.
//
// Rules this encodes, from the currency spec:
//   • Refresh when older than 12h. A trip price does not need a fresher rate
//     than that, and every extra fetch is a cold-start cost.
//   • Keep the last good copy FOREVER. A provider outage must never turn into
//     wrong prices; yesterday's real rate beats any invented one.
//   • Never invent a rate. No cache and no network → callers get null and show
//     USD, which is what we charge anyway.
//   • Freezing a rate into a trip is permanent, so `rateForSave` is stricter
//     than display: fresh, or recent, or nothing.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CurrencyCode, Rates } from '../../utils/currency';
import { fetchAllRates } from '../../utils/exchangeRate';

const STORAGE_KEY = 'swellyo.fx.rates.v1';

/** Display rates older than this get refreshed in the background. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * The oldest rate we will FREEZE into a trip. Deliberately much tighter than
 * the display window: a stale display price corrects itself on the next
 * refresh, a stale frozen rate misprices that trip for its whole life.
 */
const MAX_SAVE_AGE_MS = 48 * 60 * 60 * 1000;

interface CachedRates {
  rates: Rates;
  fetchedAt: number;
}

let cache: CachedRates | null = null;
let hydrated = false;
let inflight: Promise<CachedRates | null> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(fn => {
    try {
      fn();
    } catch {
      // A bad subscriber must not stop the others from updating.
    }
  });
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CachedRates;
    if (parsed?.rates && typeof parsed.fetchedAt === 'number') {
      cache = parsed;
      emit();
    }
  } catch {
    // Corrupt cache is the same as no cache.
  }
}

async function persist(next: CachedRates): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // In-memory copy still works for this session.
  }
}

/** Fetch once even if several screens ask at the same moment. */
async function refresh(): Promise<CachedRates | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const rates = await fetchAllRates();
      if (!rates) return cache; // keep the last good copy
      const next: CachedRates = { rates, fetchedAt: Date.now() };
      cache = next;
      await persist(next);
      emit();
      return next;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export const ratesService = {
  /** Today's rates, or null if we have never successfully fetched any. */
  getRates(): Rates | null {
    return cache?.rates ?? null;
  },

  /** When the current copy was fetched, for staleness decisions. */
  getFetchedAt(): number | null {
    return cache?.fetchedAt ?? null;
  },

  /**
   * Load from disk, then refresh if stale. Safe to call from every screen —
   * hydration happens once and the fetch is de-duplicated.
   */
  async ensureLoaded(): Promise<Rates | null> {
    await hydrate();
    const age = cache ? Date.now() - cache.fetchedAt : Infinity;
    if (age > REFRESH_AFTER_MS) await refresh();
    return cache?.rates ?? null;
  },

  /**
   * The rate to FREEZE into a trip being saved. Forces a fresh fetch, falls
   * back to a cached rate only if it is recent, and otherwise returns null so
   * the caller can refuse the save rather than freeze a guess.
   */
  async rateForSave(code: CurrencyCode): Promise<number | null> {
    if (code === 'USD') return 1;
    await hydrate();
    await refresh();
    if (!cache) return null;
    if (Date.now() - cache.fetchedAt > MAX_SAVE_AGE_MS) return null;
    const rate = cache.rates[code];
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Tests only — drops the in-memory copy so each case starts clean. */
  __resetForTests(): void {
    cache = null;
    hydrated = false;
    inflight = null;
    listeners.clear();
  },
};
