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
): TripCoreData | undefined {
  // Seed from the no-filter Explore page (the default deck). Filtered explore
  // variants live under different keys; the unfiltered page is the common case.
  const infinite = queryClient.getQueryData<InfiniteData<GroupTrip[]>>(
    tripsKeys.exploreFiltered(EMPTY_EXPLORE_FILTER_KEY),
  );
  const exploreTrips = infinite?.pages.flat() ?? [];
  const exploreTrip = exploreTrips.find(t => t.id === tripId);
  if (exploreTrip) return { trip: exploreTrip, participants: [], myRequest: null };

  // Try every cached my-trips key (userId is baked into the key).
  for (const q of queryClient.getQueryCache().getAll()) {
    const key = q.queryKey as string[];
    if (key[0] === 'trips' && key[1] === 'my') {
      const myData = q.state.data as MyTripsData | undefined;
      if (!myData) continue;
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
    placeholderData: () => seedFromListCache(queryClient, tripId),
  });
}

export function useTripAdminUpdates(tripId: string) {
  return useQuery<AdminUpdate[]>({
    queryKey: tripsKeys.detailUpdates(tripId),
    queryFn: () => listAdminUpdates(tripId),
  });
}

export function useTripGear(tripId: string, currentUserId: string | null) {
  return useQuery<EnrichedGearItem[]>({
    queryKey: tripsKeys.detailGear(tripId),
    queryFn: () => listGearItems(tripId, currentUserId),
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
  });
}

export function useTripGearRequests(tripId: string, isHost: boolean) {
  return useQuery<EnrichedGearRequest[]>({
    queryKey: tripsKeys.detailGearRequests(tripId),
    enabled: isHost,
    queryFn: () => listGearRequests(tripId, 'pending'),
  });
}
