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
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../config/supabase';
import { tripsKeys } from './useTripQueries';
import { tripTopic } from '../../services/trips/tripsRealtime';

export function useTripRealtime(tripId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tripId) return;

    const invalidate = (...keys: readonly unknown[][]) => {
      keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    };

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
      supabase.removeChannel(channel);
    };
  }, [tripId, queryClient]);
}
