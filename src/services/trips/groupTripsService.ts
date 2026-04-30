import { supabase } from '../../config/supabase';
import { messagingService } from '../messaging/messagingService';

export type HostingStyle = 'A' | 'B' | 'C';
export type SurfLevel = 'beginner' | 'intermediate' | 'advanced' | 'pro' | 'all';
export type SurfStyle = 'shortboard' | 'midlength' | 'longboard' | 'softtop' | 'all';

export interface TripVibe {
  morning?: string[];
  afternoon?: string[];
  evening?: string[];
  night?: string[];
}

export interface SurfSpot {
  name: string;
  country?: string;
}

export type TripStatus = 'active' | 'cancelled';

export interface PackingItem {
  name: string;
  done: boolean;
}

export interface GroupPackingItem {
  name: string;
  single: boolean;
}

export interface GroupPackingClaim {
  item_name: string;
  user_id: string;
  user_name: string | null;
  user_profile_image_url: string | null;
}

export interface GroupTrip {
  id: string;
  host_id: string;
  hosting_style: HostingStyle;
  status: TripStatus;

  title: string | null;
  description: string;
  hero_image_url: string;

  start_date: string | null;
  end_date: string | null;
  dates_set_in_stone: boolean | null;
  date_months: string[] | null;

  destination_country: string | null;
  destination_area: string | null;
  destination_spot: string[] | null;

  accommodation_type: string[] | null;
  accommodation_name: string | null;
  accommodation_url: string | null;
  accommodation_image_url: string | null;

  vibe: TripVibe | null;
  surf_spots: SurfSpot[] | null;

  age_min: number;
  age_max: number;
  target_surf_levels: SurfLevel[];
  target_surf_styles: SurfStyle[];
  wave_fat_to_barreling: number | null;
  wave_size_min: number | null;
  wave_size_max: number | null;

  host_been_there: boolean | null;
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;

  packing_list: string[];
  group_packing_list: GroupPackingItem[];

  created_at: string;
  updated_at: string;
}

export interface GroupTripParticipant {
  id: string;
  trip_id: string;
  user_id: string;
  role: 'host' | 'member';
  joined_at: string;
  committed: boolean;
  packing_list: PackingItem[];
}

export type JoinRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

export interface GroupTripJoinRequest {
  id: string;
  trip_id: string;
  requester_id: string;
  status: JoinRequestStatus;
  request_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface ParticipantProfile {
  user_id: string;
  name: string | null;
  age: number | null;
  surfboard_type: string | null;
  surf_level_category: string | null;
  profile_image_url: string | null;
  lifestyle_keywords: string[] | null;
}

export interface EnrichedParticipant extends ParticipantProfile {
  role: 'host' | 'member';
  joined_at: string;
  committed: boolean;
  packing_list: PackingItem[];
}

export interface EnrichedJoinRequest extends GroupTripJoinRequest {
  requester: ParticipantProfile;
}

export type CreateGroupTripInput = Omit<
  GroupTrip,
  'id' | 'host_id' | 'created_at' | 'updated_at'
>;

/**
 * Insert a new group trip and add the host as a participant with role='host'.
 * Returns the created trip row.
 */
export async function createGroupTrip(
  hostId: string,
  input: CreateGroupTripInput
): Promise<GroupTrip> {
  const { data, error } = await supabase
    .from('group_trips')
    .insert({ ...input, host_id: hostId })
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] createGroupTrip error:', error);
    throw new Error(error?.message || 'Failed to create trip');
  }

  const trip = data as GroupTrip;

  // Best-effort: add host as participant. Do not fail the whole create if this errors.
  const { error: participantError } = await supabase
    .from('group_trip_participants')
    .insert({ trip_id: trip.id, user_id: hostId, role: 'host' });

  if (participantError) {
    console.warn('[groupTripsService] host participant insert failed:', participantError);
  }

  // Best-effort: create the linked group conversation (host-only at first; approved
  // members are added in approveJoinRequest). Visibility of the chat is gated client-side
  // by EXPO_PUBLIC_LOCAL_MODE; the row itself is always created so the feature can be
  // promoted to prod later without a backfill.
  try {
    const groupTitle = trip.title || 'Surftrip';
    await messagingService.createGroupConversation(groupTitle, [], { trip_id: trip.id });
  } catch (chatError) {
    console.warn('[groupTripsService] trip group chat creation failed:', chatError);
  }

  return trip;
}

export async function listExploreTrips(limit = 50, offset = 0): Promise<GroupTrip[]> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[groupTripsService] listExploreTrips error:', error);
    return [];
  }
  return (data || []) as GroupTrip[];
}

export async function listMyTrips(hostId: string): Promise<GroupTrip[]> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('*')
    .eq('host_id', hostId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[groupTripsService] listMyTrips error:', error);
    return [];
  }
  return (data || []) as GroupTrip[];
}

export async function deleteGroupTrip(tripId: string): Promise<boolean> {
  const { error } = await supabase.from('group_trips').delete().eq('id', tripId);
  if (error) {
    console.error('[groupTripsService] deleteGroupTrip error:', error);
    return false;
  }
  return true;
}

/**
 * Soft-cancel a trip. Hides it from Explore but keeps the row + participants for history.
 * Existing participants see a "cancelled" banner on the detail screen.
 */
export async function cancelTrip(tripId: string): Promise<void> {
  const { error } = await supabase
    .from('group_trips')
    .update({ status: 'cancelled' })
    .eq('id', tripId);
  if (error) {
    console.error('[groupTripsService] cancelTrip error:', error);
    throw new Error(error.message);
  }
}

/**
 * Update an existing trip. Destination fields are intentionally excluded — the
 * destination is locked once the trip is created (per product requirement).
 */
export type UpdateGroupTripInput = Partial<
  Omit<
    CreateGroupTripInput,
    'destination_country' | 'destination_area' | 'destination_spot'
  >
>;

export async function updateGroupTrip(
  tripId: string,
  input: UpdateGroupTripInput
): Promise<GroupTrip> {
  const { data, error } = await supabase
    .from('group_trips')
    .update(input)
    .eq('id', tripId)
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] updateGroupTrip error:', error);
    throw new Error(error?.message || 'Failed to update trip');
  }
  return data as GroupTrip;
}

/**
 * Host updates the trip's master packing list (item names, ordered).
 * A DB trigger then syncs each participant's per-user list, preserving done state
 * for items that still exist in the new list and removing items that don't.
 */
export async function setTripPackingList(
  tripId: string,
  names: string[]
): Promise<void> {
  const cleaned = names.map(n => n.trim()).filter(Boolean);
  const { error } = await supabase
    .from('group_trips')
    .update({ packing_list: cleaned })
    .eq('id', tripId);

  if (error) {
    console.error('[groupTripsService] setTripPackingList error:', error);
    throw new Error(error.message);
  }
}

/**
 * Host updates the trip's group packing list (the shared, claim-able items).
 * Each item has a `single` flag controlling whether only one user can claim it.
 * A DB trigger prunes claims for items removed from the master list.
 */
export async function setTripGroupPackingList(
  tripId: string,
  items: GroupPackingItem[]
): Promise<void> {
  const cleaned = items
    .map(i => ({ name: i.name.trim(), single: !!i.single }))
    .filter(i => i.name.length > 0);
  const { error } = await supabase
    .from('group_trips')
    .update({ group_packing_list: cleaned })
    .eq('id', tripId);

  if (error) {
    console.error('[groupTripsService] setTripGroupPackingList error:', error);
    throw new Error(error.message);
  }
}

/**
 * Lists all claims on a trip's group packing items, joined to surfers for the
 * claimer's name + profile_image_url. Two queries (no FK between
 * group_trip_group_packing_claims and surfers — both reference auth.users).
 */
export async function listTripGroupPackingClaims(
  tripId: string
): Promise<GroupPackingClaim[]> {
  const { data: rows, error } = await supabase
    .from('group_trip_group_packing_claims')
    .select('item_name, user_id, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[groupTripsService] listTripGroupPackingClaims error:', error);
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((r: any) => r.user_id)));
  const { data: surfers } = await supabase
    .from('surfers')
    .select('user_id, name, profile_image_url')
    .in('user_id', userIds);

  const byId = new Map<string, { name: string | null; profile_image_url: string | null }>();
  (surfers || []).forEach((s: any) => {
    byId.set(s.user_id, {
      name: s.name ?? null,
      profile_image_url: s.profile_image_url ?? null,
    });
  });

  return rows.map((r: any) => ({
    item_name: r.item_name,
    user_id: r.user_id,
    user_name: byId.get(r.user_id)?.name ?? null,
    user_profile_image_url: byId.get(r.user_id)?.profile_image_url ?? null,
  }));
}

/**
 * Current user claims an item from the group packing list. The DB trigger
 * `enforce_group_packing_single_claim` rejects the insert if the item is
 * marked single and another claim already exists.
 */
export async function claimGroupPackingItem(
  tripId: string,
  userId: string,
  itemName: string
): Promise<void> {
  const { error } = await supabase
    .from('group_trip_group_packing_claims')
    .insert({ trip_id: tripId, user_id: userId, item_name: itemName });

  if (error) {
    console.error('[groupTripsService] claimGroupPackingItem error:', error);
    throw new Error(error.message);
  }
}

/**
 * Current user releases their claim on a group packing item.
 */
export async function unclaimGroupPackingItem(
  tripId: string,
  userId: string,
  itemName: string
): Promise<void> {
  const { error } = await supabase
    .from('group_trip_group_packing_claims')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .eq('item_name', itemName);

  if (error) {
    console.error('[groupTripsService] unclaimGroupPackingItem error:', error);
    throw new Error(error.message);
  }
}

/**
 * Participant replaces their own packing_list jsonb. Used to toggle a single
 * item's done state — the caller passes the full list with the toggled item.
 * RLS allows update only when auth.uid() === user_id.
 */
export async function setMyPackingList(
  tripId: string,
  userId: string,
  list: PackingItem[]
): Promise<void> {
  const { error } = await supabase
    .from('group_trip_participants')
    .update({ packing_list: list })
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) {
    console.error('[groupTripsService] setMyPackingList error:', error);
    throw new Error(error.message);
  }
}

/**
 * A participant (host or member) marks their own commitment to a trip.
 * RLS enforces that auth.uid() === user_id, so users can only toggle their own row.
 */
export async function setTripCommitment(
  tripId: string,
  userId: string,
  committed: boolean
): Promise<void> {
  const { error } = await supabase
    .from('group_trip_participants')
    .update({ committed })
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) {
    console.error('[groupTripsService] setTripCommitment error:', error);
    throw new Error(error.message);
  }
}

/**
 * Member self-leaves a trip. Removes from group_trip_participants and from the
 * linked group conversation. Their original join request stays approved (history).
 */
export async function leaveTrip(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('group_trip_participants')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) {
    console.error('[groupTripsService] leaveTrip error:', error);
    throw new Error(error.message);
  }

  try {
    const conv = await messagingService.getConversationByTripId(tripId);
    if (conv?.id) {
      await messagingService.removeConversationMember(conv.id, userId);
    }
  } catch (chatError) {
    console.warn('[groupTripsService] leaveTrip chat removal failed:', chatError);
  }
}

/**
 * Host removes a participant. Same as leaveTrip from the DB perspective (the RLS
 * policy on group_trip_participants allows DELETE either by the user themselves
 * or by the trip host), but additionally invokes a push notification edge
 * function so the kicked user is notified.
 */
export async function removeParticipant(
  tripId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('group_trip_participants')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) {
    console.error('[groupTripsService] removeParticipant error:', error);
    throw new Error(error.message);
  }

  try {
    const conv = await messagingService.getConversationByTripId(tripId);
    if (conv?.id) {
      await messagingService.removeConversationMember(conv.id, userId);
    }
  } catch (chatError) {
    console.warn('[groupTripsService] removeParticipant chat removal failed:', chatError);
  }

  try {
    await supabase.functions.invoke('send-trip-removed-notification', {
      body: { trip_id: tripId, removed_user_id: userId },
    });
  } catch (notifError) {
    console.warn('[groupTripsService] removeParticipant notification failed:', notifError);
  }
}

// ---------------------------------------------------------------------------
// Trip detail / participants / join requests
// ---------------------------------------------------------------------------

const PARTICIPANT_PROFILE_FIELDS =
  'user_id, name, age, surfboard_type, surf_level_category, profile_image_url, lifestyle_keywords';

export async function getTripById(tripId: string): Promise<GroupTrip | null> {
  const { data, error } = await supabase
    .from('group_trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (error) {
    if ((error as any).code === 'PGRST116') return null; // no rows
    console.error('[groupTripsService] getTripById error:', error);
    return null;
  }
  return (data as GroupTrip) ?? null;
}

/**
 * Approved participants of a trip, including the host. Host first, then by joined_at asc.
 * Two queries (group_trip_participants → surfers) because there's no direct FK between
 * the two tables — both reference auth.users separately, so PostgREST can't auto-join.
 */
export async function getTripParticipants(
  tripId: string
): Promise<EnrichedParticipant[]> {
  const { data: rows, error } = await supabase
    .from('group_trip_participants')
    .select('role, joined_at, user_id, committed, packing_list')
    .eq('trip_id', tripId)
    .order('joined_at', { ascending: true });

  if (error) {
    console.error('[groupTripsService] getTripParticipants error:', error);
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const userIds = rows.map((r: any) => r.user_id);
  const { data: surfers } = await supabase
    .from('surfers')
    .select(PARTICIPANT_PROFILE_FIELDS)
    .in('user_id', userIds);

  const byId = new Map<string, ParticipantProfile>();
  (surfers || []).forEach((s: any) => {
    byId.set(s.user_id, {
      user_id: s.user_id,
      name: s.name ?? null,
      age: s.age ?? null,
      surfboard_type: s.surfboard_type ?? null,
      surf_level_category: s.surf_level_category ?? null,
      profile_image_url: s.profile_image_url ?? null,
      lifestyle_keywords: s.lifestyle_keywords ?? null,
    });
  });

  const enriched: EnrichedParticipant[] = rows.map((row: any) => {
    const profile = byId.get(row.user_id);
    return {
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      committed: !!row.committed,
      packing_list: Array.isArray(row.packing_list) ? row.packing_list as PackingItem[] : [],
      name: profile?.name ?? null,
      age: profile?.age ?? null,
      surfboard_type: profile?.surfboard_type ?? null,
      surf_level_category: profile?.surf_level_category ?? null,
      profile_image_url: profile?.profile_image_url ?? null,
      lifestyle_keywords: profile?.lifestyle_keywords ?? null,
    };
  });

  enriched.sort((a, b) => {
    if (a.role === b.role) return 0;
    return a.role === 'host' ? -1 : 1;
  });

  return enriched;
}

export async function requestToJoinTrip(
  tripId: string,
  requesterId: string,
  note?: string
): Promise<GroupTripJoinRequest> {
  const { data, error } = await supabase
    .from('group_trip_join_requests')
    .insert({
      trip_id: tripId,
      requester_id: requesterId,
      request_note: note ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] requestToJoinTrip error:', error);
    throw new Error(error?.message || 'Failed to request to join');
  }
  return data as GroupTripJoinRequest;
}

/**
 * Returns the most recent join request for this user on this trip (any status),
 * or null if none. Used by the detail screen to decide which CTA to show.
 */
export async function getMyJoinRequest(
  tripId: string,
  userId: string
): Promise<GroupTripJoinRequest | null> {
  const { data, error } = await supabase
    .from('group_trip_join_requests')
    .select('*')
    .eq('trip_id', tripId)
    .eq('requester_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[groupTripsService] getMyJoinRequest error:', error);
    return null;
  }
  return (data as GroupTripJoinRequest) ?? null;
}

export async function withdrawJoinRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('group_trip_join_requests')
    .update({ status: 'withdrawn' })
    .eq('id', requestId);

  if (error) {
    console.error('[groupTripsService] withdrawJoinRequest error:', error);
    throw new Error(error.message);
  }
}

/**
 * Pending requests for a trip with requester profile attached. Two queries
 * (no direct FK between group_trip_join_requests and surfers).
 */
export async function listPendingRequests(
  tripId: string
): Promise<EnrichedJoinRequest[]> {
  const { data: requests, error } = await supabase
    .from('group_trip_join_requests')
    .select('*')
    .eq('trip_id', tripId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[groupTripsService] listPendingRequests error:', error);
    return [];
  }
  if (!requests || requests.length === 0) return [];

  const requesterIds = requests.map((r: any) => r.requester_id);
  const { data: surfers } = await supabase
    .from('surfers')
    .select(PARTICIPANT_PROFILE_FIELDS)
    .in('user_id', requesterIds);

  const byId = new Map<string, ParticipantProfile>();
  (surfers || []).forEach((s: any) => {
    byId.set(s.user_id, {
      user_id: s.user_id,
      name: s.name ?? null,
      age: s.age ?? null,
      surfboard_type: s.surfboard_type ?? null,
      surf_level_category: s.surf_level_category ?? null,
      profile_image_url: s.profile_image_url ?? null,
      lifestyle_keywords: s.lifestyle_keywords ?? null,
    });
  });

  return requests.map((r: any) => ({
    ...(r as GroupTripJoinRequest),
    requester: byId.get(r.requester_id) ?? {
      user_id: r.requester_id,
      name: null,
      age: null,
      surfboard_type: null,
      surf_level_category: null,
      profile_image_url: null,
      lifestyle_keywords: null,
    },
  }));
}

export async function approveJoinRequest(requestId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: updated, error } = await supabase
    .from('group_trip_join_requests')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
    })
    .eq('id', requestId)
    .select('trip_id, requester_id')
    .single();

  if (error) {
    console.error('[groupTripsService] approveJoinRequest error:', error);
    throw new Error(error.message);
  }

  // Best-effort: add the approved user to the trip's group conversation. Idempotent.
  if (updated?.trip_id && updated?.requester_id) {
    try {
      const conv = await messagingService.getConversationByTripId(updated.trip_id);
      if (conv?.id) {
        await messagingService.addConversationMember(conv.id, updated.requester_id);
      }
    } catch (chatError) {
      console.warn('[groupTripsService] add to trip group chat failed:', chatError);
    }
  }
}

export async function declineJoinRequest(requestId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('group_trip_join_requests')
    .update({
      status: 'declined',
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
    })
    .eq('id', requestId);

  if (error) {
    console.error('[groupTripsService] declineJoinRequest error:', error);
    throw new Error(error.message);
  }
}
