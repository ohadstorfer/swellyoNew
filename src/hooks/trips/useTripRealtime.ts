/**
 * Live updates for an open TripDetailScreen.
 *
 * Subscribes to the private per-trip Broadcast topic (trip:{tripId}), fed by
 * the broadcast_trip_change DB trigger on all 8 group_trip tables
 * (20260610000001_group_trips_broadcast_trigger.sql). Each event is an
 * invalidation ping ({op, table}) — we bust the matching react-query keys and
 * let the existing queryFns refetch, so this can't drift from the service
 * layer. Invalidating a mounted key refetches immediately; otherwise it only
 * marks the cache stale, which is free.
 *
 * Broadcast (not postgres_changes) so subscription auth is evaluated once per
 * subscribe instead of per event per subscriber — same scaling rationale as
 * the messaging/reactions migrations.
 *
 * FOCUS-GATED: the card stack keeps every visited screen MOUNTED (instant
 * back), so a plain useEffect would hold this channel open forever and they'd
 * pile up — saturating the realtime socket. useFocusEffect tears the channel
 * down on blur and re-opens it on focus, so only the screen you're looking at
 * holds a live line. On re-focus we force a refetch to catch anything that
 * changed while we were unsubscribed. (This is the pattern React Navigation
 * v8's inactiveBehavior="pause" will automate.)
 */
import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../config/supabase';
import { tripsKeys } from './useTripQueries';
import { tripTopic } from '../../services/trips/tripsRealtime';

export function useTripRealtime(tripId: string) {
  const queryClient = useQueryClient();

  useFocusEffect(useCallback(() => {
    if (!tripId) return;

    const invalidate = (...keys: readonly unknown[][]) => {
      keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    };

    // Catch up on anything that changed while this screen was blurred (and its
    // channel was closed). Must cover EVERY key the broadcast handler below can
    // touch — the event that would have invalidated it was missed while the
    // channel was down, and this screen stays mounted in the card stack so
    // there's no refetch-on-mount to save us. (A host once didn't see a pending
    // join request for this exact reason: only `detail` was caught up here, so
    // the Plan tab's requests section stayed stale indefinitely.) Invalidating
    // is only a fetch for keys with a mounted observer; the rest just go stale.
    invalidate(
      [...tripsKeys.detail(tripId)],
      [...tripsKeys.detailRequests(tripId)],
      [...tripsKeys.detailUpdates(tripId)],
      [...tripsKeys.detailGear(tripId)],
      [...tripsKeys.detailGearRequests(tripId)],
    );

    const channel = supabase
      .channel(tripTopic(tripId), { config: { private: true } })
      .on('broadcast', { event: 'trip_changed' }, ({ payload }: any) => {
        switch (payload?.table as string | undefined) {
          case 'group_trips':
            invalidate([...tripsKeys.detail(tripId)], [...tripsKeys.explore], ['trips', 'my']);
            break;
          case 'group_trip_participants':
            // Participant rows carry commitment_status too, so this also
            // refreshes the commit pill when the host approves a commitment.
            invalidate([...tripsKeys.detail(tripId)], ['trips', 'my']);
            break;
          case 'group_trip_join_requests':
            invalidate([...tripsKeys.detail(tripId)], [...tripsKeys.detailRequests(tripId)]);
            break;
          case 'group_trip_admin_updates':
            invalidate([...tripsKeys.detailUpdates(tripId)]);
            break;
          case 'group_trip_commitment_requests':
            invalidate([...tripsKeys.detail(tripId)]);
            break;
          case 'group_trip_gear_items':
          case 'group_trip_gear_claims':
            invalidate([...tripsKeys.detailGear(tripId)]);
            break;
          case 'group_trip_gear_requests':
            invalidate([...tripsKeys.detailGearRequests(tripId)], [...tripsKeys.detailGear(tripId)]);
            break;
          default:
            // Unknown table (e.g. one added to the trigger before this map):
            // safe blanket refresh of the core query.
            invalidate([...tripsKeys.detail(tripId)]);
        }
      })
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch { /* noop */ }
    };
  }, [tripId, queryClient]));
}
