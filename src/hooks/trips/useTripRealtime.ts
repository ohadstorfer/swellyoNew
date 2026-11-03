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
const COALESCE_MS = 300;

export function useTripRealtime(tripId: string) {
  const queryClient = useQueryClient();
  const hasBlurredRef = useRef(false);

  useFocusEffect(useCallback(() => {
    if (!tripId) return;

    const invalidate = (...keys: readonly unknown[][]) => {
      keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    };

    // Broadcast events are coalesced for COALESCE_MS: one user action often
    // writes several trip tables (join request + participant + trip count),
    // and each event used to refetch `detail` again on every member's open
    // trip screen — cancelling the in-flight fetch each time, while the server
    // still ran it. Same keys still get invalidated, just once, a beat later
    // (same pattern as useTripsListRealtime).
    const pending = new Map<string, unknown[]>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      const keys = Array.from(pending.values());
      pending.clear();
      if (keys.length > 0) invalidate(...keys);
    };
    const invalidateSoon = (...keys: readonly unknown[][]) => {
      keys.forEach((queryKey) => pending.set(JSON.stringify(queryKey), [...queryKey]));
      if (!flushTimer) flushTimer = setTimeout(flushPending, COALESCE_MS);
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
        // The operator Dashboard's three queries — money, medical, profiles.
        // They sat outside EVERY automatic refresh path: not here, not in the
        // broadcast handler below, nowhere. Their only invalidation in the whole
        // repo was one manual call from the traveler price sheet. So an operator
        // who backgrounded the app and came back read yesterday's money.
        //
        // ONE PREFIX KEY, not three. Prefix matching covers all three, and the
        // header above is explicit that each entry here costs two synchronous
        // O(total-cache) scans — three keys would have tripled this addition's
        // share of the burst that was measured into the progressive-lag freeze.
        ['operatorDashboard'],
      );
    }

    const release = acquireTopic(tripTopic(tripId), (channel) => {
      channel.on('broadcast', { event: 'trip_changed' }, ({ payload }: any) => {
        switch (payload?.table as string | undefined) {
          case 'group_trips':
            invalidateSoon([...tripsKeys.detail(tripId)], [...tripsKeys.explore], ['trips', 'my']);
            break;
          case 'group_trip_participants':
            // Participant rows carry commitment_status too, so this also
            // refreshes the commit pill when the host approves a commitment.
            invalidateSoon([...tripsKeys.detail(tripId)], ['trips', 'my']);
            break;
          case 'group_trip_join_requests':
            invalidateSoon([...tripsKeys.detail(tripId)], [...tripsKeys.detailRequests(tripId)]);
            break;
          case 'group_trip_admin_updates':
            invalidateSoon([...tripsKeys.detailUpdates(tripId)]);
            break;
          case 'group_trip_commitment_requests':
            invalidateSoon([...tripsKeys.detail(tripId)]);
            break;
          case 'group_trip_gear_items':
          case 'group_trip_gear_claims':
            invalidateSoon([...tripsKeys.detailGear(tripId)]);
            break;
          case 'group_trip_gear_requests':
            invalidateSoon([...tripsKeys.detailGearRequests(tripId)], [...tripsKeys.detailGear(tripId)]);
            break;
          default:
            // Unknown table (e.g. one added to the trigger before this map):
            // safe blanket refresh of the core query.
            invalidateSoon([...tripsKeys.detail(tripId)]);
        }
      });
    });

    return () => {
      hasBlurredRef.current = true;
      // Deliver anything still queued instead of dropping it.
      flushPending();
      release();
    };
  }, [tripId, queryClient]));
}
