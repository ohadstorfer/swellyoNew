/**
 * react-query hooks for the Trips tabs (Explore + My Trips).
 *
 * These wrap the existing groupTripsService functions unchanged — the only new
 * behavior is caching + stale-while-revalidate. The QueryClient cache survives
 * tab switches and leaving/re-entering the Trips screen, so data shows
 * instantly and refreshes silently.
 *
 * Each hook returns { trips/buckets, meta } where meta is the batched
 * Map<tripId, TripCardMeta> (2 queries for the whole list, same as before).
 */
import { useQuery } from '@tanstack/react-query';
import {
  GroupTrip,
  MyTripsBuckets,
  TripCardMeta,
  getTripCardMeta,
  listExploreTrips,
  listMyTripsByBucket,
} from '../../services/trips/groupTripsService';

/** Query-key factory — keep keys in one place so invalidation can't drift. */
export const tripsKeys = {
  all: ['trips'] as const,
  explore: ['trips', 'explore'] as const,
  // Nested UNDER explore so any invalidateQueries({ queryKey: tripsKeys.explore })
  // (realtime, post-edit, etc.) also invalidates the meta query — no extra call
  // sites to keep in sync. Parameterised by trip ids so it auto-refetches when
  // the trip set changes.
  exploreMeta: (ids: string[]) => ['trips', 'explore', 'meta', ids.join(',')] as const,
  my: (userId: string) => ['trips', 'my', userId] as const,
  detail: (id: string) => ['trips', 'detail', id] as const,
  detailUpdates: (id: string) => ['trips', 'detail-updates', id] as const,
  detailGear: (id: string) => ['trips', 'detail-gear', id] as const,
  detailRequests: (id: string) => ['trips', 'detail-requests', id] as const,
  detailGearRequests: (id: string) => ['trips', 'detail-gear-requests', id] as const,
};

export type MyTripsData = { buckets: MyTripsBuckets; meta: Map<string, TripCardMeta> };

const EMPTY_TRIPS: GroupTrip[] = [];
const EMPTY_META: Map<string, TripCardMeta> = new Map();

/**
 * Explore deck. Split into two queries so the deck paints from the trips query
 * alone (1 round-trip); avatars/host names load via the nested meta query and
 * fill in progressively. `isLoading` gates the skeleton on TRIPS only.
 */
export function useExploreTrips() {
  const tripsQuery = useQuery<GroupTrip[]>({
    queryKey: tripsKeys.explore,
    queryFn: () => listExploreTrips(),
  });
  const trips = tripsQuery.data ?? EMPTY_TRIPS;

  const metaQuery = useQuery<Map<string, TripCardMeta>>({
    queryKey: tripsKeys.exploreMeta(trips.map(t => t.id)),
    enabled: trips.length > 0,
    queryFn: () => getTripCardMeta(trips),
  });

  return {
    trips,
    meta: metaQuery.data ?? EMPTY_META,
    isLoading: tripsQuery.isLoading,
    isMetaLoading: metaQuery.isLoading,
  };
}

/**
 * My Trips, bucketed (approved / pending / past) + batched card meta.
 * Disabled until a userId is known (mirrors the old `if (!userId)` guard).
 */
export function useMyTrips(userId: string | null) {
  return useQuery<MyTripsData>({
    queryKey: userId ? tripsKeys.my(userId) : ['trips', 'my', 'anon'],
    enabled: !!userId,
    queryFn: async () => {
      const buckets = await listMyTripsByBucket(userId as string);
      const meta = await getTripCardMeta([
        ...buckets.approved,
        ...buckets.pending,
        ...buckets.past,
      ]);
      return { buckets, meta };
    },
  });
}
