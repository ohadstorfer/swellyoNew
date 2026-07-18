/**
 * Query hooks for TripDetailScreen data.
 *
 * The core hook uses placeholderData seeded from the already-cached list data
 * so the trip header renders immediately on first open — no spinner needed for
 * users coming from Explore or My Trips.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import {
  GroupTrip,
  EnrichedParticipant,
  GroupTripJoinRequest,
  EnrichedJoinRequest,
  EnrichedGearItem,
  EnrichedGearRequest,
  AdminUpdate,
  getTripById,
  getTripParticipants,
  getMyJoinRequest,
  listAdminUpdates,
  listGearItems,
  listPendingRequests,
  listDeclinedRequests,
  listGearRequests,
} from '../../services/trips/groupTripsService';
import { tripsKeys, EMPTY_EXPLORE_FILTER_KEY } from './useTripQueries';
import { isTripHost } from '../../utils/tripRole';
import type { MyTripsData } from './useTripQueries';

// ---------------------------------------------------------------------------
// Shared return types (used by TripDetailScreen + useTripMutations)
// ---------------------------------------------------------------------------
export type TripCoreData = {
  trip: GroupTrip | null;
  participants: EnrichedParticipant[];
  myRequest: GroupTripJoinRequest | null;
};

export type TripRequestsData = {
  pending: EnrichedJoinRequest[];
  declined: EnrichedJoinRequest[];
};

// ---------------------------------------------------------------------------
// Seed from whichever list cache has this trip, so the header renders
// instantly even before the detail query resolves.
// ---------------------------------------------------------------------------
function seedFromListCache(
  queryClient: ReturnType<typeof useQueryClient>,
  tripId: string,
  currentUserId: string | null,
): TripCoreData | undefined {
  // Seed from the no-filter Explore page (the default deck). Filtered explore
  // variants live under different keys; the unfiltered page is the common case.
  const infinite = queryClient.getQueryData<InfiniteData<GroupTrip[]>>(
    tripsKeys.exploreFiltered(EMPTY_EXPLORE_FILTER_KEY),
  );
  const exploreTrips = infinite?.pages.flat() ?? [];
  const exploreTrip = exploreTrips.find(t => t.id === tripId);
  if (exploreTrip) return { trip: exploreTrip, participants: [], myRequest: null };

  // My-trips lookup by exact key (userId is baked into it). This used to scan
  // getQueryCache().getAll() — an O(total-cache) walk on every mount, which
  // compounds over a long browse session; only the current user's key can
  // exist, so a direct read is equivalent.
  if (currentUserId) {
    const myData = queryClient.getQueryData<MyTripsData>(tripsKeys.my(currentUserId));
    if (myData) {
      const all = [
        ...myData.buckets.approved,
        ...myData.buckets.pending,
        ...myData.buckets.past,
      ];
      const found = all.find(t => t.id === tripId);
      if (found) return { trip: found, participants: [], myRequest: null };
    }
  }
  return undefined;
}

/** Trip-detail cache entries outlive their screen (card pop) by this much.
 *  Deliberately shorter than the app-wide 30-min default: a heavy Explore
 *  session touches dozens of trips (opens + viewport prefetches) and every
 *  entry pins memory AND lengthens the synchronous cache scans that every
 *  invalidateQueries call performs (see js-thread-freeze-spec.md). */
export const TRIP_DETAIL_GC_MS = 1000 * 60 * 5;

// ---------------------------------------------------------------------------
// Core: trip + participants + myRequest (one query key)
// ---------------------------------------------------------------------------

/** Critical trip-detail data (trip + participants + my join request), signal-aware.
 *  Shared by useTripCore AND the Explore deck's viewport prefetch so both prime the
 *  exact same query shape under tripsKeys.detail(tripId). */
export async function fetchTripCore(
  tripId: string, currentUserId: string | null, signal?: AbortSignal,
): Promise<TripCoreData> {
  const [tripData, participantsData] = await Promise.all([
    getTripById(tripId, signal),
    getTripParticipants(tripId, signal),
  ]);
  if (!tripData) return { trip: null, participants: [], myRequest: null };
  const userIsHost = isTripHost(tripData, participantsData, currentUserId);
  const myRequest =
    userIsHost || !currentUserId ? null : await getMyJoinRequest(tripId, currentUserId, signal);
  return { trip: tripData, participants: participantsData, myRequest };
}

export function useTripCore(tripId: string, currentUserId: string | null) {
  const queryClient = useQueryClient();
  return useQuery<TripCoreData>({
    queryKey: tripsKeys.detail(tripId),
    queryFn: ({ signal }) => fetchTripCore(tripId, currentUserId, signal),
    placeholderData: () => seedFromListCache(queryClient, tripId, currentUserId),
    gcTime: TRIP_DETAIL_GC_MS,
  });
}

export function useTripAdminUpdates(tripId: string) {
  return useQuery<AdminUpdate[]>({
    queryKey: tripsKeys.detailUpdates(tripId),
    queryFn: () => listAdminUpdates(tripId),
    gcTime: TRIP_DETAIL_GC_MS,
  });
}

export function useTripGear(tripId: string, currentUserId: string | null) {
  return useQuery<EnrichedGearItem[]>({
    queryKey: tripsKeys.detailGear(tripId),
    queryFn: () => listGearItems(tripId, currentUserId),
    gcTime: TRIP_DETAIL_GC_MS,
  });
}

export function useTripRequests(tripId: string, isHost: boolean) {
  return useQuery<TripRequestsData>({
    queryKey: tripsKeys.detailRequests(tripId),
    enabled: isHost,
    queryFn: async () => {
      const [pending, declined] = await Promise.all([
        listPendingRequests(tripId),
        listDeclinedRequests(tripId),
      ]);
      return { pending, declined };
    },
    gcTime: TRIP_DETAIL_GC_MS,
  });
}

export function useTripGearRequests(tripId: string, isHost: boolean) {
  return useQuery<EnrichedGearRequest[]>({
    queryKey: tripsKeys.detailGearRequests(tripId),
    enabled: isHost,
    queryFn: () => listGearRequests(tripId, 'pending'),
    gcTime: TRIP_DETAIL_GC_MS,
  });
}
