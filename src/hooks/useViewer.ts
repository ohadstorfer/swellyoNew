// Who is looking at this price, and what rates do we have for them.
//
// Every price on every screen goes through the `Viewer` this returns. The
// object identity is stable across renders — it only changes when the resolved
// currency changes or a rate refresh actually lands (roughly twice a day). That
// matters: trip cards render one of these per row, and an unstable object here
// would re-render every price in the deck on every parent render. This provider
// tree has already produced one render-storm freeze; see the memo note in
// UserProfileContext.
import { useEffect, useMemo, useState } from 'react';
import { useUserProfile } from '../context/UserProfileContext';
import { ratesService } from '../services/currency/ratesService';
import { resolveViewerCurrency, type Rates, type Viewer } from '../utils/currency';

/**
 * Today's rates, shared by every caller. Hydration and fetching are
 * de-duplicated inside ratesService, so mounting a hundred cards still costs
 * one disk read and at most one network call.
 */
export function useRates(): Rates | null {
  const [rates, setRates] = useState<Rates | null>(() => ratesService.getRates());

  useEffect(() => {
    let alive = true;
    const unsubscribe = ratesService.subscribe(() => {
      if (alive) setRates(ratesService.getRates());
    });
    ratesService
      .ensureLoaded()
      .then(next => {
        if (alive) setRates(next);
      })
      .catch(() => {
        // ratesService never throws for a failed fetch; this is belt and
        // braces for a rejected AsyncStorage read. No rates → prices show USD.
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return rates;
}

/** The viewer's resolved currency plus today's rates. Pass this to formatters. */
export function useViewer(): Viewer {
  const { profile } = useUserProfile();
  const rates = useRates();
  const currency = resolveViewerCurrency(profile?.country_from, profile?.display_currency);
  return useMemo(() => ({ currency, rates }), [currency, rates]);
}
