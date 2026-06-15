/**
 * Query hooks for TripDetailScreen data.
 *
 * The core hook uses placeholderData seeded from the already-cached list data
 * so the trip header renders immediately on first open — no spinner needed for
 * users coming from Explore or My Trips.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { tripsKeys } from './useTripQueries';
import type { MyTripsData } from './useTripQueries';

// ---------------------------------------------------------------------------
// Shared return types (used by TripDetailScreen + useTripMutations)
// ---------------------------------------------------------------------------
export type TripCoreData = {
  trip: GroupTrip;
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
  const exploreTrips = queryClient.getQueryData<GroupTrip[]>(tripsKeys.explore);
  const exploreTrip = exploreTrips?.find(t => t.id === tripId);
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
export function useTripCore(tripId: string, currentUserId: string | null) {
  const queryClient = useQueryClient();
  return useQuery<TripCoreData>({
    queryKey: tripsKeys.detail(tripId),
    queryFn: async (): Promise<TripCoreData> => {
      const [tripData, participantsData] = await Promise.all([
        getTripById(tripId),
        getTripParticipants(tripId),
      ]);
      if (!tripData) return { trip: null as any, participants: [], myRequest: null };
      const userIsHost = !!currentUserId && tripData.host_id === currentUserId;
      const myRequest =
        userIsHost || !currentUserId
          ? null
          : await getMyJoinRequest(tripId, currentUserId);
      return { trip: tripData, participants: participantsData, myRequest };
    },
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
