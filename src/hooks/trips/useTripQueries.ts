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
  my: (userId: string) => ['trips', 'my', userId] as const,
};

type ExploreData = { trips: GroupTrip[]; meta: Map<string, TripCardMeta> };
type MyTripsData = { buckets: MyTripsBuckets; meta: Map<string, TripCardMeta> };

/** Explore deck: active group trips + batched card meta. */
export function useExploreTrips() {
  return useQuery<ExploreData>({
    queryKey: tripsKeys.explore,
    queryFn: async () => {
      const trips = await listExploreTrips();
      const meta = await getTripCardMeta(trips);
      return { trips, meta };
    },
  });
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
