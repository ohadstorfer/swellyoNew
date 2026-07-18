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
 * holds a live line. Channel setup/teardown goes through acquireTopic
 * (tripsRealtime.ts) so fast blur→refocus reuses the live channel instead of
 * churning join/leave on the socket.
 *
 * CATCH-UP is split by why we're focusing:
 *  - Re-focus after a blur: the channel was DOWN, events were missed, and this
 *    screen stays mounted so nothing else refetches — invalidate every key the
 *    broadcast handler can touch. (A host once didn't see a pending join
 *    request because only `detail` was caught up here.)
 *  - First focus (fresh mount): the queries are mounting and manage their own
 *    freshness. We only invalidate when the cached detail is older than
 *    FIRST_FOCUS_FRESH_MS — a just-prefetched open (press-in / deck viewport)
 *    skips the burst entirely. This matters at scale: each invalidateQueries
 *    call is 2 synchronous O(total-cache) scans in query-core, and the old
 *    unconditional 5-key burst (10 scans + a refetch fan-out, per open) grew
 *    quadratically over a heavy browse session — a measured contributor to the
 *    progressive-lag freeze (docs/superpowers/plans/js-thread-freeze-spec.md).
 */
import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { tripsKeys } from './useTripQueries';
import { tripTopic, acquireTopic } from '../../services/trips/tripsRealtime';

const FIRST_FOCUS_FRESH_MS = 30_000;

export function useTripRealtime(tripId: string) {
  const queryClient = useQueryClient();
  const hasBlurredRef = useRef(false);

  useFocusEffect(useCallback(() => {
    if (!tripId) return;

    const invalidate = (...keys: readonly unknown[][]) => {
      keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    };

    const detailState = queryClient.getQueryState(tripsKeys.detail(tripId));
    const detailAgeMs = detailState?.dataUpdatedAt
      ? Date.now() - detailState.dataUpdatedAt
      : Infinity;
    if (hasBlurredRef.current || detailAgeMs > FIRST_FOCUS_FRESH_MS) {
      invalidate(
        [...tripsKeys.detail(tripId)],
        [...tripsKeys.detailRequests(tripId)],
        [...tripsKeys.detailUpdates(tripId)],
        [...tripsKeys.detailGear(tripId)],
        [...tripsKeys.detailGearRequests(tripId)],
      );
    }

    const release = acquireTopic(tripTopic(tripId), (channel) => {
      channel.on('broadcast', { event: 'trip_changed' }, ({ payload }: any) => {
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
      });
    });

    return () => {
      hasBlurredRef.current = true;
      release();
    };
  }, [tripId, queryClient]));
}
