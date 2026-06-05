/**
 * App-wide TanStack Query client (singleton).
 *
 * The cache lives here — not in any component — so data survives screen
 * unmount/remount. Re-entering a screen returns cached data instantly and only
 * revalidates in the background when it's stale (stale-while-revalidate).
 *
 * RN-specific defaults (see TanStack RN docs):
 *  - staleTime > 0 is REQUIRED: the default of 0 makes data immediately stale,
 *    which would refetch on every remount and defeat the whole point.
 *  - gcTime must be >= staleTime, or the cache is GC'd while still "fresh".
 *  - refetchOnWindowFocus is a no-op in RN (no browser "window"); we wire
 *    focusManager to AppState in App.tsx instead. Disabled here for clarity.
 *
 * NOTE: import this same instance wherever you need imperative access
 * (e.g. queryClient.clear() on logout) so there's only one cache.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min — prevents refetch on every remount
      gcTime: 1000 * 60 * 30, // 30 min — keep cache alive well after unmount
      retry: 2,
      refetchOnWindowFocus: false, // no-op in RN; explicit for clarity
      refetchOnReconnect: true, // matters on mobile networks
    },
  },
});
