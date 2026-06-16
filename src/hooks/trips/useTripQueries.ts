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
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  GroupTrip,
  MyTripsBuckets,
  TripCardMeta,
  ExploreFeedRow,
  fetchMyTripsFeed,
  exploreFeed,
} from '../../services/trips/groupTripsService';

/** Query-key factory — keep keys in one place so invalidation can't drift. */
export const tripsKeys = {
  all: ['trips'] as const,
  explore: ['trips', 'explore'] as const,
  my: (userId: string) => ['trips', 'my', userId] as const,
  detail: (id: string) => ['trips', 'detail', id] as const,
  detailUpdates: (id: string) => ['trips', 'detail-updates', id] as const,
  detailGear: (id: string) => ['trips', 'detail-gear', id] as const,
  detailRequests: (id: string) => ['trips', 'detail-requests', id] as const,
  detailGearRequests: (id: string) => ['trips', 'detail-gear-requests', id] as const,
};

export type MyTripsData = { buckets: MyTripsBuckets; meta: Map<string, TripCardMeta> };

const EXPLORE_PAGE_LIMIT = 10;
const EMPTY_META: Map<string, TripCardMeta> = new Map();

/**
 * Explore deck: one `explore_feed` RPC per page via useInfiniteQuery. Host name/
 * avatar/count come in each row (no separate meta query → no avatar pop-in).
 * Freshness comes from realtime invalidation, so we disable refetch-on-mount/
 * focus (avoids refetching all loaded pages when returning to the screen).
 */
export function useExploreTrips() {
  const q = useInfiniteQuery({
    queryKey: tripsKeys.explore,
    queryFn: ({ pageParam, signal }) =>
      exploreFeed(EXPLORE_PAGE_LIMIT + 1, pageParam?.created_at ?? null, pageParam?.id ?? null, signal),
    initialPageParam: null as { created_at: string; id: string } | null,
    getNextPageParam: (last: ExploreFeedRow[]) =>
      last.length > EXPLORE_PAGE_LIMIT
        ? { created_at: last[EXPLORE_PAGE_LIMIT - 1].created_at, id: last[EXPLORE_PAGE_LIMIT - 1].id }
        : undefined,
    maxPages: 10,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const trips = useMemo(
    () => q.data?.pages.flatMap(p => p.slice(0, EXPLORE_PAGE_LIMIT)) ?? [],
    [q.data],
  );
  const meta = useMemo(() => {
    if (trips.length === 0) return EMPTY_META;
    const m = new Map<string, TripCardMeta>();
    for (const t of trips) {
      m.set(t.id, {
        hostName: t.host_name ?? null,
        hostAvatar: t.host_avatar ?? null,
        memberAvatars: t.member_avatars ?? [],
        totalCount: t.participant_count ?? 0,
      });
    }
    return m;
  }, [trips]);

  return {
    trips, meta,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
    isRefetching: q.isRefetching,
    hasNextPage: q.hasNextPage,
    fetchNextPage: q.fetchNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
  };
}

/**
 * My Trips, bucketed (approved / pending / past) + card meta — now ONE
 * `my_trips_feed` RPC (host name/avatar/count + member avatars come in each row,
 * no separate meta query). Disabled until a userId is known. Freshness comes from
 * realtime invalidation (useTripsListRealtime) + post-create/edit invalidation,
 * so — like Explore — we skip refetch-on-mount/focus (no re-running the RPC on
 * every tab switch / screen re-entry). The RPC reads auth.uid() itself; userId
 * stays in the query key only for cache identity + invalidation + list-seeding.
 */
export function useMyTrips(userId: string | null) {
  return useQuery<MyTripsData>({
    queryKey: userId ? tripsKeys.my(userId) : ['trips', 'my', 'anon'],
    enabled: !!userId,
    queryFn: ({ signal }) => fetchMyTripsFeed(signal),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}
