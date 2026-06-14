/**
 * Live refresh for the Trips list screens (Explore + My Trips).
 *
 * Companion to useTripRealtime (per-open-trip): keeps the LIST data fresh
 * while TripsScreen is mounted — new trips appearing in Explore, card details
 * changing (title/cover/dates/cancelled), member counts moving.
 *
 * Subscribes to the private shared Broadcast topic 'trips-list', fed by the
 * broadcast_trip_change DB trigger (only group_trips + participants changes —
 * the tables that affect what cards show). One pub/sub topic regardless of
 * user count, auth checked once per subscription: scale-proof, unlike the
 * unfiltered postgres_changes subscription this replaced.
 *
 * FOCUS-GATED (see useTripRealtime): the card stack keeps TripsScreen mounted
 * behind whatever you open on top of it, so a plain useEffect would keep this
 * channel open while you're deep in a trip/chat. useFocusEffect closes it on
 * blur and re-opens + refetches the list on return.
 */
import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../config/supabase';
import { tripsKeys } from './useTripQueries';
import { TRIPS_LIST_TOPIC } from '../../services/trips/tripsRealtime';

export function useTripsListRealtime() {
  const queryClient = useQueryClient();

  useFocusEffect(useCallback(() => {
    // Coalesce bursts (e.g. several participant rows in one transaction) into
    // a single invalidation pass instead of one refetch per event.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidateSoon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries({ queryKey: [...tripsKeys.explore] });
        queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
      }, 300);
    };

    // Catch up on list changes missed while this screen was blurred.
    invalidateSoon();

    const channel = supabase
      .channel(TRIPS_LIST_TOPIC, { config: { private: true } })
      .on('broadcast', { event: 'trips_list_changed' }, invalidateSoon)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    };
  }, [queryClient]));
}
