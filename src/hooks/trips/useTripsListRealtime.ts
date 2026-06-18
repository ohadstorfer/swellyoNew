/**
 * Live refresh for the Trips list screens (Explore + My Trips).
 *
 * Companion to useTripRealtime (per-open-trip): keeps the LIST data fresh
 * while TripsScreen is mounted — new trips appearing in Explore, card details
 * changing (title/cover/dates/cancelled), member counts moving.
 *
 * SCOPED into TWO private Broadcast topics, both fed by broadcast_trip_change:
 *   - 'trips-list'        (event 'trips_list_changed'): the public Explore
 *      catalogue only — a trip is created / its status changes / it is removed.
 *      Invalidates ONLY the Explore feed. One shared topic, auth checked once.
 *   - 'trips-mine:{uid}'  (event 'trips_mine_changed'): per-member fan-out for
 *      trip / participant changes on trips this user belongs to. Invalidates
 *      ONLY this user's My Trips — not every client on the screen.
 *
 * This replaces the earlier single global 'trips-list' topic that re-fetched
 * BOTH feeds on EVERY participant join/leave for EVERY connected client.
 *
 * FOCUS-GATED (see useTripRealtime): the card stack keeps TripsScreen mounted
 * behind whatever you open on top of it, so a plain useEffect would keep these
 * channels open while you're deep in a trip/chat. useFocusEffect closes them on
 * blur and re-opens + refetches the list on return.
 */
import { useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../config/supabase';
import { tripsKeys } from './useTripQueries';
import { TRIPS_LIST_TOPIC, tripsMineTopic } from '../../services/trips/tripsRealtime';

// Survives remounts within a session — throttles the focus catch-up so that
// returning to Trips within 5 minutes of the last refresh does not re-fetch
// all loaded infinite-query pages. Real broadcast events bypass this gate.
let lastListInvalidateAt = 0;
const FOCUS_CATCHUP_INTERVAL_MS = 5 * 60 * 1000; // 5 min

const COALESCE_MS = 300;

export function useTripsListRealtime(userId: string | undefined) {
  const queryClient = useQueryClient();

  useFocusEffect(useCallback(() => {
    // DEFERRED: channel setup + the focus catch-up refetch run AFTER the tab
    // transition/animation settles (InteractionManager), not synchronously on
    // focus. Doing them on focus committed new native views mid-slide and froze
    // the bottom-bar pill animation. Realtime is best-effort, so a few hundred ms
    // later is fine. Cleanup cancels the task if we blur before it runs.
    let exploreTimer: ReturnType<typeof setTimeout> | null = null;
    let mineTimer: ReturnType<typeof setTimeout> | null = null;
    let teardown: (() => void) | null = null;

    const invalidateExploreSoon = () => {
      if (exploreTimer) return;
      exploreTimer = setTimeout(() => {
        exploreTimer = null;
        lastListInvalidateAt = Date.now();
        queryClient.invalidateQueries({ queryKey: [...tripsKeys.explore] });
      }, COALESCE_MS);
    };

    const invalidateMineSoon = () => {
      if (!userId) return;
      if (mineTimer) return;
      mineTimer = setTimeout(() => {
        mineTimer = null;
        lastListInvalidateAt = Date.now();
        queryClient.invalidateQueries({ queryKey: [...tripsKeys.my(userId)] });
      }, COALESCE_MS);
    };

    const task = InteractionManager.runAfterInteractions(() => {
      // Catch up on changes missed while this screen was blurred — throttled to
      // avoid re-fetching all infinite-query pages on every return. Refresh both
      // feeds, since either could have changed while away.
      if (Date.now() - lastListInvalidateAt > FOCUS_CATCHUP_INTERVAL_MS) {
        invalidateExploreSoon();
        invalidateMineSoon();
      }

      const exploreChannel = supabase
        .channel(TRIPS_LIST_TOPIC, { config: { private: true } })
        .on('broadcast', { event: 'trips_list_changed' }, invalidateExploreSoon)
        .subscribe();

      const mineChannel = userId
        ? supabase
            .channel(tripsMineTopic(userId), { config: { private: true } })
            .on('broadcast', { event: 'trips_mine_changed' }, invalidateMineSoon)
            .subscribe()
        : null;

      teardown = () => {
        try { supabase.removeChannel(exploreChannel); } catch { /* noop */ }
        if (mineChannel) {
          try { supabase.removeChannel(mineChannel); } catch { /* noop */ }
        }
      };
    });

    return () => {
      task.cancel();
      if (exploreTimer) clearTimeout(exploreTimer);
      if (mineTimer) clearTimeout(mineTimer);
      if (teardown) teardown();
    };
  }, [queryClient, userId]));
}
