/**
 * One shared read of "what does Stripe think of my payout account".
 *
 * ── Why a hook and not just a fetch inside the card ─────────────────────────
 * Onboarding is not part of creating a trip. It has no trip id, `stripe-
 * connect-onboard` deliberately refuses to require one, and the plan (Ohad,
 * 2026-08-05) is that most operators will connect Stripe from a settings
 * screen BEFORE their first trip ever exists. So the data has to be reachable
 * from any screen, and there must be exactly one cache of it — three surfaces
 * (create wizard, trip edit, settings) each mounting their own fetch would ask
 * Stripe three times and then disagree with each other for the rest of the
 * session.
 *
 * The card that renders this is presentational and knows nothing about where
 * it is. A new surface is `useConnectStatus()` plus markup.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchConnectStatus } from '../../services/trips/tripPaymentsService';
import {
  deriveConnectState,
  canCollectPayments,
  paymentsAreLive,
  UNKNOWN_CONNECT_STATUS,
  WATCH_WINDOW_MS,
  watchInterval,
  type ConnectState,
  type ConnectStatus,
} from '../../services/trips/connectStatus';
import { onNotification } from '../../services/notifications/notificationsRealtimeHub';

/** Not under `tripsKeys` on purpose: this belongs to the operator, not a trip. */
export const connectStatusKey = ['stripe', 'connect-status'] as const;

export interface UseConnectStatus {
  status: ConnectStatus;
  state: ConnectState;
  /** May this operator choose "Collect payment in Swellyo"? */
  canCollect: boolean;
  /** Can a traveler be charged RIGHT NOW? False while Stripe reviews. */
  isLive: boolean;
  /** True only on the very first load, so the card can show one spinner and
   *  never blank out again on a background refetch. */
  loading: boolean;
  /** Ask again now. */
  refresh: () => void;
  /**
   * Call when the Stripe sheet closes. Re-reads immediately and then keeps
   * checking for a minute, so an approval that lands while they are still on
   * the screen updates the card by itself.
   */
  watchForChange: () => void;
}

export function useConnectStatus({ enabled = true }: { enabled?: boolean } = {}): UseConnectStatus {
  const queryClient = useQueryClient();
  // A timestamp rather than a boolean: it survives re-renders, and comparing
  // it to now() is what bounds the poll without a second timer to clean up.
  const [watchUntil, setWatchUntil] = useState(0);

  const query = useQuery({
    queryKey: connectStatusKey,
    queryFn: fetchConnectStatus,
    // Gates the NETWORK CALL, not the data. A disabled observer still reads
    // whatever is already in the cache under this key, which is what lets a
    // screen ask "can this operator collect?" for its own validation without
    // adding a second round trip — and what keeps an operator who never opens
    // "Collect payment in Swellyo" from being asked about Stripe at all.
    enabled,
    // Stripe is not going to change its mind in the next few seconds, and this
    // is a paid API round trip through an edge function — but it IS worth
    // re-asking when a screen that cares mounts.
    staleTime: 30_000,
    retry: 1,
    // Takes the query as an argument rather than closing over `query` — that
    // variable is still being defined here, and reading it would be a
    // temporal-dead-zone bug that only bites once polling actually starts.
    refetchInterval: q => watchInterval(q.state.data, watchUntil),
  });

  // A failed status read means "we do not know", and the safe reading of that
  // is "not connected" — never a crash, and never a blank card. The error is
  // surfaced through the query itself, not thrown.
  const status = query.data ?? UNKNOWN_CONNECT_STATUS;
  const state = deriveConnectState(status);

  // Stripe can approve long after the 60s watch window has closed, and the
  // operator may well still be sitting on the setup checklist when it does.
  //
  // `operator_stripe_ready` is written by `trg_notify_connect_status`, an AFTER
  // UPDATE trigger on `operator_payout_accounts` (20260818000600), on the
  // charges_enabled false→true edge. It is deliberately row-driven, so the
  // Connect webhook, this hook's own poll and the daily sweep all produce it
  // identically — which is what makes it a signal worth listening to rather
  // than polling for minutes.
  //
  // ⚠️ The poll is one of those writers: `stripe-connect-onboard` caches every
  // status read back into that row. So when OUR poll is what discovers the
  // approval, this row arrives as an echo of a refetch we just did. The guard
  // below is what stops that echo costing a second Stripe round trip — it only
  // re-reads when the cache does not already know, i.e. when the webhook or
  // the sweep got there first, which is the only case this listener exists for.
  useEffect(
    () =>
      onNotification({
        onInsert: row => {
          if (row.type !== 'operator_stripe_ready') return;
          const cached = queryClient.getQueryData<ConnectStatus>(connectStatusKey);
          if (cached && deriveConnectState(cached) === 'ready') return;
          void queryClient.invalidateQueries({ queryKey: connectStatusKey });
        },
      }),
    [queryClient],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: connectStatusKey });
  }, [queryClient]);

  const watchForChange = useCallback(() => {
    setWatchUntil(Date.now() + WATCH_WINDOW_MS);
    // Immediately, not in four seconds: closing the sheet is the most likely
    // moment for the answer to have changed, and a first tick that late reads
    // as the screen having ignored what they just did.
    void queryClient.invalidateQueries({ queryKey: connectStatusKey });
  }, [queryClient]);

  return {
    status,
    state,
    canCollect: canCollectPayments(state),
    isLive: paymentsAreLive(status),
    // isLoading, not isPending: a DISABLED query is pending forever (it has no
    // data and is not fetching), which would leave a gated screen showing a
    // spinner that never resolves.
    loading: query.isLoading,
    refresh,
    watchForChange,
  };
}
