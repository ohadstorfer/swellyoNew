# Trip Detail UX Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Trip Detail instant to open, content-shaped skeleton on true first load, smooth slide-in/out transition, and all mutations migrated to react-query `useMutation` with automatic optimistic update + rollback + invalidation.

**Architecture:** Three new hook files (`useTripDetail.ts`, `useTripMutations.ts`, `TripDetailSkeleton.tsx`) slot under the existing react-query infrastructure from iteration 1. `TripDetailScreen.tsx` keeps all its UI/UX logic but swaps local `useState` data + manual fetch/setState mutation handlers for query data + mutation hooks. The `placeholderData` seed from the list cache makes the first frame of Trip Detail feel instant with no code changes in the list views.

**Tech Stack:** `@tanstack/react-query` v5 (already installed), `react-native-reanimated` v3 (already installed), TypeScript.

---

## File map

| Action | File | Responsibility |
| --- | --- | --- |
| Modify | `src/hooks/trips/useTripQueries.ts` | Add `tripsKeys.detail` + `tripsKeys.detailUpdates` etc. to key factory |
| Create | `src/hooks/trips/useTripDetail.ts` | 5 query hooks + `placeholderData` seeding |
| Create | `src/hooks/trips/useTripMutations.ts` | All 20 mutations with optimistic update / rollback / invalidation |
| Modify | `src/components/skeletons/TripSkeletons.tsx` | Add `TripDetailSkeleton` component |
| Modify | `src/components/skeletons/index.ts` | Re-export `TripDetailSkeleton` |
| Modify | `src/screens/trips/TripDetailScreen.tsx` | Wire hooks; replace loadAll/setState with query data; replace handlers with mutations; replace ActivityIndicator with skeleton |
| Modify | `src/screens/trips/TripsScreen.tsx` | Wrap `TripDetailScreen` render in `Reanimated.View entering/exiting` |

---

## Task 1 — Extend query key factory

**Files:**
- Modify: `src/hooks/trips/useTripQueries.ts`

- [ ] Add detail keys to `tripsKeys`:

```ts
// src/hooks/trips/useTripQueries.ts  (replace the existing tripsKeys export)
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
```

- [ ] Verify no TypeScript errors: `npx tsc --noEmit 2>&1 | grep useTripQueries`

---

## Task 2 — Build `useTripDetail.ts`

**Files:**
- Create: `src/hooks/trips/useTripDetail.ts`

- [ ] Create the file:

```ts
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
import type { ExploreData, MyTripsData } from './useTripQueries';

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
// Seed the detail from whichever list cache has this trip, so the header
// renders instantly even before the detail query resolves.
// ---------------------------------------------------------------------------
function seedFromListCache(
  queryClient: ReturnType<typeof useQueryClient>,
  tripId: string,
  currentUserId: string | null,
): TripCoreData | undefined {
  const exploreData = queryClient.getQueryData<ExploreData>(tripsKeys.explore);
  const exploreTrip = exploreData?.trips.find(t => t.id === tripId);
  if (exploreTrip) return { trip: exploreTrip, participants: [], myRequest: null };

  // Try every cached my-trips key (we don't know the userId in advance).
  const allKeys = queryClient.getQueryCache().getAll();
  for (const q of allKeys) {
    const key = q.queryKey as string[];
    if (key[0] === 'trips' && key[1] === 'my') {
      const myData = q.state.data as MyTripsData | undefined;
      if (!myData) continue;
      const all = [...myData.buckets.approved, ...myData.buckets.pending, ...myData.buckets.past];
      const found = all.find(t => t.id === tripId);
      if (found) return { trip: found, participants: [], myRequest: null };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Core: trip + participants + myRequest
// isHost-dependant secondary fetches are included so this is one round-trip.
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
      const myRequest = userIsHost || !currentUserId
        ? null
        : await getMyJoinRequest(tripId, currentUserId);
      return { trip: tripData, participants: participantsData, myRequest };
    },
    placeholderData: () => seedFromListCache(queryClient, tripId, currentUserId),
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
```

- [ ] Export the two data types from `useTripQueries.ts` so they can be imported by `useTripDetail.ts`:

```ts
// Add at the end of src/hooks/trips/useTripQueries.ts
export type { ExploreData, MyTripsData };
```

- [ ] `npx tsc --noEmit 2>&1 | grep useTripDetail`  — expect no errors.

---

## Task 3 — `TripDetailSkeleton`

**Files:**
- Modify: `src/components/skeletons/TripSkeletons.tsx`
- Modify: `src/components/skeletons/index.ts`

- [ ] Add `TripDetailSkeleton` at the end of `TripSkeletons.tsx`:

```tsx
// Add at the bottom of src/components/skeletons/TripSkeletons.tsx
export const TripDetailSkeleton: React.FC = () => (
  <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
    {/* Hero image block */}
    <SkeletonBase width="100%" height={260} borderRadius={0} />
    <View style={{ padding: 20, gap: 12 }}>
      {/* Title */}
      <SkeletonBase width="70%" height={24} borderRadius={6} />
      {/* Destination + dates row */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <SkeletonBase width={120} height={16} borderRadius={6} />
        <SkeletonBase width={100} height={16} borderRadius={6} />
      </View>
      {/* Participant avatars row */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        {[0, 1, 2, 3].map(i => (
          <SkeletonBase key={i} width={36} height={36} borderRadius={18} />
        ))}
      </View>
      {/* Section title */}
      <SkeletonBase width="40%" height={18} borderRadius={6} style={{ marginTop: 16 }} />
      {/* Description lines */}
      <SkeletonBase width="100%" height={14} borderRadius={6} />
      <SkeletonBase width="90%" height={14} borderRadius={6} />
      <SkeletonBase width="60%" height={14} borderRadius={6} />
      {/* Another section */}
      <SkeletonBase width="40%" height={18} borderRadius={6} style={{ marginTop: 16 }} />
      <SkeletonBase width="100%" height={14} borderRadius={6} />
      <SkeletonBase width="80%" height={14} borderRadius={6} />
    </View>
  </View>
);
```

- [ ] Export it from `src/components/skeletons/index.ts`:

```ts
// Add to the existing export list in index.ts
export { TripDetailSkeleton } from './TripSkeletons';
```

- [ ] `npx tsc --noEmit 2>&1 | grep skeletons` — expect no errors.

---

## Task 4 — Wire TripDetailScreen reads

**Files:**
- Modify: `src/screens/trips/TripDetailScreen.tsx`

This task replaces the `loadAll`/`refreshGear`/`refreshGearRequests` callbacks and the
data `useState` vars with query data. UI-only state vars are untouched.

- [ ] Add imports at the top of `TripDetailScreen.tsx`, after existing imports:

```ts
import {
  useTripCore,
  useTripAdminUpdates,
  useTripGear,
  useTripRequests,
  useTripGearRequests,
} from '../../hooks/trips/useTripDetail';
import { TripDetailSkeleton } from '../../components/skeletons';
```

- [ ] Inside `TripDetailScreen`, **remove** these `useState` declarations (lines ~307–363):

```ts
// REMOVE all of these:
const [trip, setTrip] = useState<GroupTrip | null>(null);
const [participants, setParticipants] = useState<EnrichedParticipant[]>([]);
const [myRequest, setMyRequest] = useState<GroupTripJoinRequest | null>(null);
const [pendingRequests, setPendingRequests] = useState<EnrichedJoinRequest[]>([]);
const [declinedRequests, setDeclinedRequests] = useState<EnrichedJoinRequest[]>([]);
const [loading, setLoading] = useState(true);
const [gearItems, setGearItems] = useState<EnrichedGearItem[]>([]);
const [gearRequests, setGearRequests] = useState<EnrichedGearRequest[]>([]);
const [adminUpdates, setAdminUpdates] = useState<AdminUpdate[]>([]);
```

- [ ] Add query hooks right after the `currentUserId` line (line ~306):

```ts
// Replace removed useState vars with query hooks
const isHostEarly = false; // bootstrap value before trip loads; refined below
const coreQuery = useTripCore(tripId, currentUserId);
const trip = coreQuery.data?.trip ?? null;
const participants = coreQuery.data?.participants ?? [];
const myRequest = coreQuery.data?.myRequest ?? null;

// isHost must be derived BEFORE conditional hooks so hook order stays stable.
// Use the loaded trip; false on placeholder/loading.
const isHostDerived = !!trip && !!currentUserId && trip.host_id === currentUserId;

const updatesQuery = useTripAdminUpdates(tripId);
const adminUpdates = updatesQuery.data ?? [];

const gearQuery = useTripGear(tripId, currentUserId);
const gearItems = gearQuery.data ?? [];

const requestsQuery = useTripRequests(tripId, isHostDerived);
const pendingRequests = requestsQuery.data?.pending ?? [];
const declinedRequests = requestsQuery.data?.declined ?? [];

const gearRequestsQuery = useTripGearRequests(tripId, isHostDerived);
const gearRequests = gearRequestsQuery.data ?? [];
```

- [ ] **Remove** the `loadAll`, `refreshGear`, `refreshGearRequests` callbacks (lines ~406–454) and the `useEffect(() => { loadAll(); }, [loadAll])` that follows them.

- [ ] **Remove** the `isHost` const (it's derived from `trip` which we still have), keep it pointing to `isHostDerived`:

```ts
// Replace:  const isHost = !!trip && !!currentUserId && trip.host_id === currentUserId;
// With (already defined above as isHostDerived, so just alias):
const isHost = isHostDerived;
```

- [ ] Replace the `if (loading)` block (~line 1130):

```tsx
// Replace:
if (loading) {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header onBack={onBack} />
      <View style={styles.centered}>
        <ActivityIndicator color="#0788B0" />
      </View>
    </SafeAreaView>
  );
}

// With:
if (coreQuery.isLoading && !coreQuery.data) {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header onBack={onBack} />
      <TripDetailSkeleton />
    </SafeAreaView>
  );
}
```

- [ ] In every mutation handler that called `refreshGear()`, replace with:

```ts
// Replace:   await refreshGear();
// With:
queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
```

- [ ] In every mutation handler that called `refreshGearRequests()`, replace with:

```ts
queryClient.invalidateQueries({ queryKey: tripsKeys.detailGearRequests(tripId) });
```

- [ ] Add `useQueryClient` import and `tripsKeys` import at the top:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
```

- [ ] Add `const queryClient = useQueryClient();` at the top of the component body (after `currentUserId`).

- [ ] `npx tsc --noEmit 2>&1 | grep TripDetailScreen` — fix any errors (typically
  unused import for `setLoading` etc. that were removed).

- [ ] **Smoke test on device/Expo Go:** open a trip from the Explore tab. The header should appear with data (no spinner) since it seeds from the list cache. Opening a brand-new trip shows the skeleton briefly.

---

## Task 5 — Mutations group 1: trip fields + status

**Files:**
- Create: `src/hooks/trips/useTripMutations.ts`
- Modify: `src/screens/trips/TripDetailScreen.tsx`

- [ ] Create `src/hooks/trips/useTripMutations.ts` with the first mutation group:

```ts
/**
 * All TripDetailScreen mutations, migrated to react-query useMutation.
 *
 * Pattern per mutation:
 *   onMutate  → cancelQueries + snapshot + optimistic setQueryData
 *   onError   → rollback from snapshot
 *   onSettled → invalidateQueries (reconcile with server)
 *
 * The hook is organised in sections matching the handlers in TripDetailScreen.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GroupTrip,
  updateGroupTrip,
  cancelTrip,
  completeTrip,
  leaveTrip,
  removeParticipant,
  requestToJoinTrip,
  withdrawJoinRequest,
  approveJoinRequest,
  declineJoinRequest,
  submitCommitment,
  addGearItem,
  updateGearItem,
  deleteGearItem,
  setMyGearClaim,
  approveGearRequest,
  declineGearRequest,
  setMyPersonalGearList,
  setTripGroupGear,
  setMyGroupGear,
  addAdminUpdate,
  updateAdminUpdate,
  deleteAdminUpdate,
  getTripParticipants,
  type CommitmentItem,
  type PersonalGearItem,
} from '../../services/trips/groupTripsService';
import { uploadTripImage } from '../../services/storage/storageService';
import { tripsKeys } from './useTripQueries';
import type { TripCoreData } from './useTripDetail';

export function useTripMutations(tripId: string, currentUserId: string | null) {
  const queryClient = useQueryClient();
  const detailKey = tripsKeys.detail(tripId);

  // Helper: snapshot + cancel + optimistic-set
  const snap = async (key: readonly unknown[]) => {
    await queryClient.cancelQueries({ queryKey: key });
    return queryClient.getQueryData(key);
  };

  // -------------------------------------------------------------------------
  // Trip field edits (host only — cover, about-host, description, dates, accommodation)
  // Each patches the trip object in the core cache optimistically.
  // -------------------------------------------------------------------------
  const updateTripFields = useMutation({
    mutationFn: async ({
      patch,
      coverLocalUri,
      accommodationLocalUri,
    }: {
      patch: Partial<GroupTrip>;
      coverLocalUri?: string;
      accommodationLocalUri?: string;
    }) => {
      if (coverLocalUri) {
        const res = await uploadTripImage(coverLocalUri, currentUserId!, 'hero');
        if (!res.success || !res.url) throw new Error(res.error || 'Failed to upload cover');
        patch = { ...patch, hero_image_url: res.url };
      }
      if (accommodationLocalUri && !/^https?:\/\//.test(accommodationLocalUri)) {
        const res = await uploadTripImage(accommodationLocalUri, currentUserId!, 'accommodation');
        if (!res.success || !res.url) throw new Error(res.error || 'Failed to upload stay photo');
        patch = { ...patch, accommodation_image_url: res.url };
      }
      await updateGroupTrip(tripId, patch);
      return patch;
    },
    onMutate: async ({ patch }) => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev ? { ...prev, trip: { ...prev.trip, ...patch } } : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
      queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    },
  });

  // -------------------------------------------------------------------------
  // Trip status
  // -------------------------------------------------------------------------
  const cancelTripMutation = useMutation({
    mutationFn: () => cancelTrip(tripId),
    onMutate: async () => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev ? { ...prev, trip: { ...prev.trip, status: 'cancelled' } } : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
      queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
      queryClient.invalidateQueries({ queryKey: tripsKeys.explore });
    },
  });

  const completeTripMutation = useMutation({
    mutationFn: () => completeTrip(tripId),
    onMutate: async () => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev ? { ...prev, trip: { ...prev.trip, status: 'completed' } } : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
      queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    },
  });

  return {
    updateTripFields,
    cancelTripMutation,
    completeTripMutation,
  };
}
```

- [ ] In `TripDetailScreen.tsx`, import the hook and wire the first group:

```ts
import { useTripMutations } from '../../hooks/trips/useTripMutations';
```

```ts
// Add at top of component body after queryClient:
const mutations = useTripMutations(tripId, currentUserId);
```

- [ ] Replace `handleSaveCover`:

```ts
const handleSaveCover = async (localUri: string) => {
  await mutations.updateTripFields.mutateAsync({ patch: {}, coverLocalUri: localUri });
};
```

- [ ] Replace `handleSaveAboutHost`:

```ts
const handleSaveAboutHost = async (text: string) => {
  await mutations.updateTripFields.mutateAsync({ patch: { host_lead_note: text || null } });
};
```

- [ ] Replace `handleSaveDescription`:

```ts
const handleSaveDescription = async (text: string) => {
  await mutations.updateTripFields.mutateAsync({ patch: { description: text } });
};
```

- [ ] Replace `handleSaveDates`:

```ts
const handleSaveDates = async (patch: DatesPatch) => {
  await mutations.updateTripFields.mutateAsync({ patch });
};
```

- [ ] Replace `handleSaveAccommodation` (keep upload logic, pass uri via mutations):

```ts
const handleSaveAccommodation = async (next: AccommodationInitial) => {
  const basePatch = {
    accommodation_type: next.kind ? [next.kind] : null,
    accommodation_name: next.name || null,
    accommodation_url: next.url || null,
    accommodation_image_url: next.photoUri,
    specific_stay_selected: true,
  };
  await mutations.updateTripFields.mutateAsync({
    patch: basePatch,
    accommodationLocalUri:
      next.photoUri && !/^https?:\/\//.test(next.photoUri) ? next.photoUri : undefined,
  });
};
```

- [ ] Replace `handleCancelTrip` (keep the Alert wrapper, swap inner call):

```ts
const handleCancelTrip = () => {
  Alert.alert('Cancel trip', "This will hide the trip from Explore...", [
    { text: 'Keep trip', style: 'cancel' },
    {
      text: 'Cancel trip',
      style: 'destructive',
      onPress: async () => {
        try {
          await mutations.cancelTripMutation.mutateAsync();
        } catch (e: any) {
          Alert.alert('Could not cancel', e?.message || 'Please try again.');
        }
      },
    },
  ]);
};
```

- [ ] Replace `handleCompleteTrip` similarly, calling `mutations.completeTripMutation.mutateAsync()`. Also call `setActiveTab('overview')` on success (in a `.then()`).

- [ ] Remove the individual loading booleans that are now covered by mutation state:
  - `cancelling` → replace with `mutations.cancelTripMutation.isPending`
  - `completing` → replace with `mutations.completeTripMutation.isPending`

- [ ] `npx tsc --noEmit 2>&1 | grep TripDetailScreen` — fix errors.

- [ ] **Test on device:** edit trip description → optimistic update shows instantly → confirmed after server resolves. Force an error (airplane mode) → rollback happens.

---

## Task 6 — Mutations group 2: join / leave

**Files:**
- Modify: `src/hooks/trips/useTripMutations.ts`
- Modify: `src/screens/trips/TripDetailScreen.tsx`

- [ ] Add to the `return` of `useTripMutations` (inside the same function, after the status mutations), adding the join/leave mutations:

```ts
  // -------------------------------------------------------------------------
  // Join / leave
  // -------------------------------------------------------------------------
  const requestsKey = tripsKeys.detailRequests(tripId);

  const requestToJoin = useMutation({
    mutationFn: (note: string) =>
      requestToJoinTrip(tripId, currentUserId!, note || undefined),
    onSettled: () => queryClient.invalidateQueries({ queryKey: detailKey }),
  });

  const withdrawRequest = useMutation({
    mutationFn: (requestId: string) => withdrawJoinRequest(requestId),
    onMutate: async () => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev && prev.myRequest
          ? { ...prev, myRequest: { ...prev.myRequest, status: 'withdrawn' } }
          : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: detailKey }),
  });

  const approveRequest = useMutation({
    mutationFn: (requestId: string) => approveJoinRequest(requestId),
    onMutate: async (requestId: string) => {
      const snapshot = await snap(requestsKey);
      queryClient.setQueryData<{ pending: any[]; declined: any[] }>(requestsKey, prev =>
        prev
          ? {
              pending: prev.pending.filter(r => r.id !== requestId),
              declined: prev.declined.filter(r => r.id !== requestId),
            }
          : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(requestsKey, ctx.snapshot);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
      queryClient.invalidateQueries({ queryKey: requestsKey });
      queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    },
  });

  const declineRequest = useMutation({
    mutationFn: (requestId: string) => declineJoinRequest(requestId),
    onMutate: async (requestId: string) => {
      const snapshot = await snap(requestsKey);
      queryClient.setQueryData<{ pending: any[]; declined: any[] }>(requestsKey, prev => {
        if (!prev) return prev;
        const moved = prev.pending.find(r => r.id === requestId);
        return {
          pending: prev.pending.filter(r => r.id !== requestId),
          declined: moved
            ? [{ ...moved, status: 'declined' }, ...prev.declined.filter(r => r.id !== requestId)]
            : prev.declined,
        };
      });
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(requestsKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: requestsKey }),
  });

  const leaveTrip_ = useMutation({
    mutationFn: () => leaveTrip(tripId, currentUserId!),
    onMutate: async () => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev
          ? { ...prev, participants: prev.participants.filter(p => p.user_id !== currentUserId) }
          : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
      queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    },
  });

  const removeParticipant_ = useMutation({
    mutationFn: (userId: string) => removeParticipant(tripId, userId),
    onMutate: async (userId: string) => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev
          ? { ...prev, participants: prev.participants.filter(p => p.user_id !== userId) }
          : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: detailKey }),
  });
```

- [ ] Add the new mutations to the `return` object of `useTripMutations`.

- [ ] In `TripDetailScreen.tsx`, wire the join/leave mutations:

```ts
// handleSubmitJoinRequest:
const handleSubmitJoinRequest = async (note: string) => {
  if (!currentUserId) return;
  await mutations.requestToJoin.mutateAsync(note);
  setJoinSheetOpen(false);
};

// handleWithdraw:
const handleWithdraw = async () => {
  if (!myRequest) return;
  await mutations.withdrawRequest.mutateAsync(myRequest.id);
};

// handleApprove:
const handleApprove = async (requestId: string) => {
  await mutations.approveRequest.mutateAsync(requestId);
};

// handleDecline:
const handleDecline = async (requestId: string) => {
  await mutations.declineRequest.mutateAsync(requestId);
};

// handleLeaveTrip: keep Alert wrapper, swap inner call
const handleLeaveTrip = () => {
  if (!currentUserId) return;
  Alert.alert('Leave trip', "You'll be removed from the group chat...", [
    { text: 'Stay', style: 'cancel' },
    {
      text: 'Leave',
      style: 'destructive',
      onPress: async () => {
        try {
          await mutations.leaveTrip_.mutateAsync();
        } catch (e: any) {
          Alert.alert('Could not leave', e?.message || 'Please try again.');
        }
      },
    },
  ]);
};

// handleRemoveParticipant: keep Alert wrapper, swap inner call
const handleRemoveParticipant = (userId: string) => {
  const target = participants.find(p => p.user_id === userId);
  const name = target?.name || 'this participant';
  Alert.alert('Remove from trip', `Are you sure you want to remove ${name}?`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove',
      style: 'destructive',
      onPress: () => mutations.removeParticipant_.mutateAsync(userId).catch((e: any) => {
        Alert.alert('Could not remove', e?.message || 'Please try again.');
      }),
    },
  ]);
};
```

- [ ] Replace loading state usage:
  - `submitting` (join/withdraw) → `mutations.requestToJoin.isPending || mutations.withdrawRequest.isPending`
  - `processingRequestId` → `mutations.approveRequest.isPending && mutations.approveRequest.variables === id` (or `mutations.declineRequest.isPending && ...`)
  - `leaving` → `mutations.leaveTrip_.isPending`
  - `removingUserId` → `mutations.removeParticipant_.isPending && mutations.removeParticipant_.variables === userId`

- [ ] `npx tsc --noEmit 2>&1 | grep TripDetailScreen` — fix errors.

- [ ] **Test:** request to join → optimistic myRequest appears → confirmed. Approve/decline → optimistic removal from pending list.

---

## Task 7 — Mutations group 3: gear

**Files:**
- Modify: `src/hooks/trips/useTripMutations.ts`
- Modify: `src/screens/trips/TripDetailScreen.tsx`

- [ ] Add gear mutations inside `useTripMutations` (after join/leave block):

```ts
  // -------------------------------------------------------------------------
  // Group gear (gear items + claims + requests)
  // -------------------------------------------------------------------------
  const gearKey = tripsKeys.detailGear(tripId);
  const gearRequestsKey = tripsKeys.detailGearRequests(tripId);

  const saveGearItem = useMutation({
    mutationFn: async ({ patch, itemId }: { patch: { name: string; needed_qty: number }; itemId?: string }) => {
      if (itemId) {
        await updateGearItem(itemId, patch);
      } else {
        await addGearItem(tripId, currentUserId!, patch.name, patch.needed_qty);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: gearKey }),
  });

  const deleteGearItem_ = useMutation({
    mutationFn: (itemId: string) => deleteGearItem(itemId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: gearKey }),
  });

  const setGearClaim = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      setMyGearClaim(itemId, currentUserId!, quantity),
    onSettled: () => queryClient.invalidateQueries({ queryKey: gearKey }),
  });

  const approveGearRequest_ = useMutation({
    mutationFn: ({ requestId, neededQty }: { requestId: string; neededQty: number }) =>
      approveGearRequest(requestId, neededQty),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: gearKey });
      queryClient.invalidateQueries({ queryKey: gearRequestsKey });
    },
  });

  const declineGearRequest_ = useMutation({
    mutationFn: (requestId: string) => declineGearRequest(requestId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: gearRequestsKey }),
  });

  // -------------------------------------------------------------------------
  // Personal / suggested gear (optimistic on participants in core cache)
  // -------------------------------------------------------------------------
  const setPersonalGear = useMutation({
    mutationFn: (next: PersonalGearItem[]) =>
      setMyPersonalGearList(tripId, currentUserId!, next),
    onMutate: async (next: PersonalGearItem[]) => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev
          ? {
              ...prev,
              participants: prev.participants.map(p =>
                p.user_id === currentUserId ? { ...p, personal_gear_by_me: next } : p
              ),
            }
          : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: detailKey }),
  });

  const setSuggestedGear = useMutation({
    mutationFn: (names: string[]) => setTripGroupGear(tripId, names.map(n => n.trim()).filter(Boolean)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: detailKey }),
  });

  const setGroupGear = useMutation({
    mutationFn: (next: import('../../services/trips/groupTripsService').GroupGearItem[]) =>
      setMyGroupGear(tripId, currentUserId!, next),
    onMutate: async (next) => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev
          ? {
              ...prev,
              participants: prev.participants.map(p =>
                p.user_id === currentUserId ? { ...p, personal_gear_by_host: next } : p
              ),
            }
          : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: detailKey }),
  });
```

- [ ] Add new gear mutations to the `return` of `useTripMutations`.

- [ ] In `TripDetailScreen.tsx`, wire gear mutations:

```ts
const handleSetGearClaim = async (itemId: string, quantity: number) => {
  await mutations.setGearClaim.mutateAsync({ itemId, quantity });
};

const handleSaveGearItem = async (patch: { name: string; needed_qty: number }, itemId?: string) => {
  await mutations.saveGearItem.mutateAsync({ patch, itemId });
};

const handleDeleteGearItem = async (itemId: string) => {
  await mutations.deleteGearItem_.mutateAsync(itemId);
};

const handleApproveGearRequest = async (request: EnrichedGearRequest, neededQty: number) => {
  await mutations.approveGearRequest_.mutateAsync({ requestId: request.id, neededQty });
};

const handleDeclineGearRequest = async (request: EnrichedGearRequest) => {
  await mutations.declineGearRequest_.mutateAsync(request.id);
};

// persistPersonalGear: replace with mutation
const persistPersonalGear = (next: PersonalGearItem[], _previous: PersonalGearItem[]) => {
  mutations.setPersonalGear.mutate(next);
};

// handleSavePacking / handleSaveSuggestedGear:
const handleSavePacking = async () => {
  const names = groupGearDraft.split('\n').map(s => s.trim()).filter(Boolean);
  setSavingPacking(true);
  try {
    await mutations.setSuggestedGear.mutateAsync(names);
    setEditingPacking(false);
    setGroupGearDraft('');
  } catch (e: any) {
    Alert.alert('Could not save list', e?.message || 'Please try again.');
  } finally {
    setSavingPacking(false);
  }
};

const handleSaveSuggestedGear = async (names: string[]) => {
  await mutations.setSuggestedGear.mutateAsync(names);
};

// handleToggleGroupGearItem:
const handleToggleGroupGearItem = async (itemName: string) => {
  if (!currentUserId) return;
  const next = myGroupGear.map(it =>
    it.name === itemName ? { ...it, done: !it.done } : it
  );
  mutations.setGroupGear.mutate(next);
};
```

- [ ] Wire `processingGearRequestId` loading state:
  - `mutations.approveGearRequest_.isPending && (mutations.approveGearRequest_.variables as any)?.requestId === request.id`

- [ ] `npx tsc --noEmit 2>&1 | grep -E "TripDetailScreen|useTripMutations"` — fix errors.

---

## Task 8 — Mutations group 4: admin updates + commitment

**Files:**
- Modify: `src/hooks/trips/useTripMutations.ts`
- Modify: `src/screens/trips/TripDetailScreen.tsx`

- [ ] Add updates + commitment mutations inside `useTripMutations`:

```ts
  // -------------------------------------------------------------------------
  // Admin updates
  // -------------------------------------------------------------------------
  const updatesKey = tripsKeys.detailUpdates(tripId);

  const addUpdate = useMutation({
    mutationFn: (body: string) => addAdminUpdate(tripId, currentUserId!, body),
    onMutate: async (body: string) => {
      const snapshot = await snap(updatesKey);
      // Optimistic placeholder (no id yet — server assigns it)
      queryClient.setQueryData<import('../../services/trips/groupTripsService').AdminUpdate[]>(
        updatesKey,
        prev => [{ id: '__optimistic__', body, created_at: new Date().toISOString() }, ...(prev ?? [])],
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(updatesKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: updatesKey }),
  });

  const editUpdate = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => updateAdminUpdate(id, body),
    onMutate: async ({ id, body }: { id: string; body: string }) => {
      const snapshot = await snap(updatesKey);
      queryClient.setQueryData<any[]>(updatesKey, prev =>
        prev ? prev.map(u => (u.id === id ? { ...u, body } : u)) : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(updatesKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: updatesKey }),
  });

  const deleteUpdate = useMutation({
    mutationFn: (id: string) => deleteAdminUpdate(id),
    onMutate: async (id: string) => {
      const snapshot = await snap(updatesKey);
      queryClient.setQueryData<any[]>(updatesKey, prev =>
        prev ? prev.filter(u => u.id !== id) : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(updatesKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: updatesKey }),
  });

  // -------------------------------------------------------------------------
  // Commitment
  // -------------------------------------------------------------------------
  const submitCommitment_ = useMutation({
    mutationFn: ({ items, note }: { items: CommitmentItem[]; note: string | null }) =>
      submitCommitment(tripId, currentUserId!, items, note),
    onMutate: async ({ items, note }: { items: CommitmentItem[]; note: string | null }) => {
      const snapshot = await snap(detailKey);
      queryClient.setQueryData<TripCoreData>(detailKey, prev =>
        prev
          ? {
              ...prev,
              participants: prev.participants.map(p =>
                p.user_id === currentUserId
                  ? { ...p, commitment_status: 'pending', commitment_items: items, commitment_note: note }
                  : p
              ),
            }
          : prev
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.snapshot) queryClient.setQueryData(detailKey, ctx.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: detailKey }),
  });
```

- [ ] Add all to `return` of `useTripMutations`.

- [ ] In `TripDetailScreen.tsx`, wire updates + commitment:

```ts
const handleSubmitUpdateBody = async (body: string) => {
  if (!currentUserId) return;
  const text = body.trim();
  if (!text) { handleCancelUpdateDraft(); return; }
  setSavingUpdate(true);
  try {
    if (editingUpdateId) {
      await mutations.editUpdate.mutateAsync({ id: editingUpdateId, body: text });
    } else {
      await mutations.addUpdate.mutateAsync(text);
    }
    handleCancelUpdateDraft();
  } catch (e: any) {
    Alert.alert('Could not save update', e?.message || 'Please try again.');
  } finally {
    setSavingUpdate(false);
  }
};

const handleDeleteUpdate = (update: AdminUpdate) => {
  Alert.alert('Delete update', 'This update will be removed for everyone.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        try {
          await mutations.deleteUpdate.mutateAsync(update.id);
          if (editingUpdateId === update.id) handleCancelUpdateDraft();
        } catch (e: any) {
          Alert.alert('Could not delete', e?.message || 'Please try again.');
        }
      },
    },
  ]);
};

const handleSubmitCommitment = async (items: CommitmentItem[], note: string) => {
  if (!currentUserId) return;
  await mutations.submitCommitment_.mutateAsync({ items, note: note || null });
};
```

- [ ] Remove the old `handleSubmitUpdate` (it's replaced by `handleSubmitUpdateBody` which already existed as the sheet-driven path — the inline path was a duplicate).

- [ ] `npx tsc --noEmit 2>&1 | grep -E "TripDetailScreen|useTripMutations"` — fix all errors.

- [ ] **Full smoke test on device:** create update → appears instantly; delete → disappears instantly; rollback on error. Submit commitment → button state updates immediately.

---

## Task 9 — Open/close slide transition

**Files:**
- Modify: `src/screens/trips/TripsScreen.tsx`

- [ ] Add `SlideInRight` and `SlideOutRight` imports (already has `Reanimated` import from the tab pager work):

```ts
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
  SlideInRight,
  SlideOutRight,
} from 'react-native-reanimated';
```

- [ ] Wrap the `TripDetailScreen` early-return in a `Reanimated.View`:

```tsx
// Replace:
if (selectedTripId) {
  return (
    <TripDetailScreen ... />
  );
}

// With:
if (selectedTripId) {
  return (
    <Reanimated.View
      style={{ flex: 1 }}
      entering={reduceMotion ? undefined : SlideInRight.duration(280).easing(Easing.out(Easing.cubic))}
      exiting={reduceMotion ? undefined : SlideOutRight.duration(220).easing(Easing.in(Easing.cubic))}
    >
      <TripDetailScreen
        tripId={selectedTripId}
        onBack={() => setSelectedTripId(null)}
        onOpenGroupChat={onOpenGroupChat}
        onEditTrip={setEditingTrip}
        onViewUserProfile={
          onViewUserProfile
            ? (userId: string) => onViewUserProfile(userId, selectedTripId)
            : undefined
        }
      />
    </Reanimated.View>
  );
}
```

- [ ] `npx tsc --noEmit 2>&1 | grep TripsScreen` — expect no errors.

- [ ] **Test on device:** tap a trip card → slides in from the right. Tap back → slides out to the right. With "Reduce Motion" enabled in iOS/Android accessibility settings → hard cut (no slide). Both transitions respect `reduceMotion`.

---

## Self-review

**Spec coverage:**
- A (instant open via placeholderData) → Task 2 (`seedFromListCache`) + Task 4
- B (skeleton) → Task 3 + Task 4
- C (transition) → Task 9
- D (full useMutation migration) → Tasks 5–8

**Placeholder scan:** all code blocks are complete. No TBDs.

**Type consistency:** `TripCoreData` defined in Task 2, used in Tasks 4–8. `tripsKeys.detail` defined in Task 1, used throughout. `useTripMutations` returns named mutations, consumed by name in Tasks 5–8.

**Note on `handleAddPersonalSubmit` + `handleSavePersonalItem`:** both ultimately call `setMyPersonalGearList`. Both should route through `mutations.setPersonalGear.mutateAsync(next)` and keep their local UI state (`setSavingPersonalItem`, `setAddPersonalSheetOpen`) as-is — the mutation handles cache; they handle UI.
