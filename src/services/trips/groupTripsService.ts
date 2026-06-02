import { supabase } from '../../config/supabase';
import { messagingService } from '../messaging/messagingService';
import type { PriceInclusions } from './priceInclusions';

export type HostingStyle = 'A' | 'B' | 'C';
export type SurfLevel = 'beginner' | 'intermediate' | 'advanced' | 'pro' | 'all';
export type SurfStyle = 'shortboard' | 'midlength' | 'longboard' | 'softtop' | 'all';
export type WaveShapeKind = 'soft' | 'wally' | 'barrel';

// -----------------------------------------------------------------------------
// trip_structure + trip_vibes (multi-select tag columns added May 2026 — both
// are `text[]` with DB-side CHECK constraints restricting values to the slugs
// below). See migration 20260527000000_group_trips_trip_structure_vibes.sql.
// -----------------------------------------------------------------------------
export type TripStructureSlug =
  | 'shared_decisions'
  | 'structured_schedule'
  | 'loose_schedule'
  | 'book_own_stay'
  | 'book_together'
  | 'group_all_day'
  | 'own_thing_day';
export type TripVibeSlug =
  | 'improve_surf'
  | 'surf_focused'
  | 'explore'
  | 'vacation';

export const TRIP_STRUCTURE_OPTIONS: { slug: TripStructureSlug; label: string }[] = [
  { slug: 'shared_decisions',    label: 'Shared decisions on activities and schedule' },
  { slug: 'structured_schedule', label: 'Structured daily schedule' },
  { slug: 'loose_schedule',      label: 'Loose daily schedule' },
  { slug: 'book_own_stay',       label: 'Book your own accommodation' },
  { slug: 'book_together',       label: 'Accommodation booked together' },
  { slug: 'group_all_day',       label: 'Group together most of the day' },
  { slug: 'own_thing_day',       label: 'Do your own thing during the day' },
];

// Single-select (radio). Order = display order, top→bottom = most→least surf.
// `intensity` (1–4) drives the surf-intensity meter shown on each pill.
export const TRIP_VIBE_OPTIONS: { slug: TripVibeSlug; label: string; intensity: number }[] = [
  { slug: 'improve_surf', label: 'Improve your surfing — training camp',        intensity: 4 },
  { slug: 'surf_focused', label: 'Surf-focused — wake up early, surf a lot',     intensity: 3 },
  { slug: 'explore',      label: 'Surf + Explore',                               intensity: 2 },
  { slug: 'vacation',     label: 'Vacation style — chill, loose surf, lay-days', intensity: 1 },
];

export const TRIP_STRUCTURE_MUTEX: [TripStructureSlug, TripStructureSlug][] = [
  ['structured_schedule', 'loose_schedule'],
  ['book_own_stay', 'book_together'],
  ['group_all_day', 'own_thing_day'],
];

// Vibe is single-select now — no co-existing pairs to enforce.
export const TRIP_VIBE_MUTEX: [TripVibeSlug, TripVibeSlug][] = [];

// Flow B leader credibility — how well the leader knows the destination / stay.
export type DestinationFamiliarity = 'never_been' | 'been_once' | 'been_multiple';
export type StayFamiliarity =
  | 'never_online'
  | 'never_recs'
  | 'stayed_once'
  | 'stayed_multiple';

export const DESTINATION_FAMILIARITY_OPTIONS: {
  slug: DestinationFamiliarity;
  label: string;
}[] = [
  { slug: 'never_been', label: 'Never been' },
  { slug: 'been_once', label: 'Been there once' },
  { slug: 'been_multiple', label: 'Been there multiple times' },
];

export const STAY_FAMILIARITY_OPTIONS: { slug: StayFamiliarity; label: string }[] = [
  { slug: 'never_online', label: 'Never stayed, found it online' },
  {
    slug: 'never_recs',
    label: 'Never stayed, got good recommendations from people I know that been there',
  },
  { slug: 'stayed_once', label: 'Stayed once, know the place' },
  { slug: 'stayed_multiple', label: 'Stayed multiple times, know the place very well' },
];

export type TripStatus = 'active' | 'cancelled';

export interface GroupGearItem {
  name: string;
  done: boolean;
}

/** Member-private gear item. Independent of the host's group_gear. */
export interface PersonalGearItem {
  name: string;
  done: boolean;
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
  duration_days: number | null; // trip length in days (only place it survives in months-mode)
  max_participants: number | null; // host-set cap on total people (incl. host); null = no cap set
  participant_count: number; // live count of joined people (incl. host). Trigger-maintained — read-only.

  /** Geocoded destination — source of truth, embedded from group_trip_destinations.
   *  Null until the host picks a place (or for legacy trips with no row). */
  destination: TripDestination | null;

  accommodation_type: string[] | null;
  accommodation_name: string | null;
  accommodation_url: string | null;
  accommodation_image_url: string | null;

  age_min: number | null;
  age_max: number | null;
  target_surf_levels: SurfLevel[];
  target_surf_styles: SurfStyle[];
  wave_shapes: WaveShapeKind[] | null;
  wave_size_min: number | null;
  wave_size_max: number | null;

  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
  budget_tier: string | null; // 'low' | 'medium' | 'high' — the tier the host picked

  // Multi-select tag columns (text[] with DB CHECK constraints). Replaces the
  // legacy single-value `trip_vibe` column dropped in the May 2026 migration.
  trip_structure: string[] | null;
  trip_vibes: string[] | null;

  // Flow C pricing (nullable).
  cost_per_person: number | null;
  price_inclusions: PriceInclusions | null; // rich "What's included" — see priceInclusions.ts

  // Step-3 Yes/No gate: did the host select a specific stay, or none yet?
  // (Renamed from accommodation_status — May 2026. See migration
  // 20260531000001_rename_accommodation_status_to_specific_stay_selected.sql)
  specific_stay_selected: boolean | null;

  // Flow B ("I'm the leader") credibility fields. Null for Flow A/C.
  host_destination_familiarity: DestinationFamiliarity | null;
  host_stay_familiarity: StayFamiliarity | null;
  host_lead_note: string | null;
  visibility: string | null; // 'public' | 'friends' | 'private'

  group_gear: string[];

  created_at: string;
  updated_at: string;
}

export type CommitmentStatus = 'none' | 'pending' | 'approved';

/** Categories the member picks from in the commitment sheet. Stored as strings
 *  in commitment_items (jsonb array) so we can add more without a migration. */
export type CommitmentItem = 'flight_booked' | 'insurance_sorted' | 'something_else';

export interface GroupTripParticipant {
  id: string;
  trip_id: string;
  user_id: string;
  role: 'host' | 'member';
  joined_at: string;
  committed: boolean;
  commitment_status: CommitmentStatus;
  commitment_items: string[];
  commitment_note: string | null;
  commitment_requested_at: string | null;
  commitment_decided_at: string | null;
  commitment_decided_by: string | null;
  personal_gear_by_host: GroupGearItem[];
  personal_gear_by_me: PersonalGearItem[];
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
  seen_decision_at: string | null;
}

/** A request whose decision (approved/declined) the requester hasn't seen yet.
 *  Enriched with the trip info we need to render the overlay card. */
export interface UnseenJoinDecision {
  request_id: string;
  status: 'approved' | 'declined';
  trip: {
    id: string;
    title: string | null;
    hero_image_url: string;
    destination_label: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  decided_at: string | null;
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
  commitment_status: CommitmentStatus;
  commitment_items: string[];
  commitment_note: string | null;
  personal_gear_by_host: GroupGearItem[];
  personal_gear_by_me: PersonalGearItem[];
}

/** Row shape for group_trip_commitment_requests (audit log). */
export interface GroupTripCommitmentRequest {
  id: string;
  trip_id: string;
  user_id: string;
  commitment_proofs: string[];
  note: string | null;
  status: 'pending' | 'approved' | 'declined' | 'superseded';
  message_id: string | null;
  decided_by: string | null;
  requested_at: string;
  decided_at: string | null;
}

/** A pending commitment request enriched with the requester's profile and trip
 *  title. Returned by listPendingCommitmentsToReviewFromUser for the host's UI. */
export interface PendingCommitmentToReview extends GroupTripCommitmentRequest {
  status: 'pending';
  trip_title: string | null;
  requester: ParticipantProfile | null;
}

export interface EnrichedJoinRequest extends GroupTripJoinRequest {
  requester: ParticipantProfile;
}

export type CreateGroupTripInput = Omit<
  GroupTrip,
  // participant_count is maintained by a DB trigger — never written by the client.
  'id' | 'host_id' | 'created_at' | 'updated_at' | 'destination' | 'participant_count'
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

  // Destination row is inserted separately by the caller (setTripDestination),
  // so it isn't embedded here yet — normalize to null.
  const trip = { ...(data as any), destination: null } as GroupTrip;

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

/** Subset of group_trip_destinations embedded into GroupTrip for display.
 *  This is the source of truth for a trip's location. */
export interface TripDestination {
  name: string | null;
  short_label: string | null;
  country: string | null; // ISO-2
  admin_level_1: string | null;
  lat: number | null;
  lng: number | null;
}

// Embed string + helpers — pull the destination row alongside the trip so the
// destinations table is the single source of truth for location.
const TRIP_DEST_EMBED =
  'destination:group_trip_destinations(name, short_label, country, admin_level_1, lat, lng)';

function pickDestination(embedded: any): TripDestination | null {
  if (!embedded) return null;
  // PostgREST returns an object for the 1:1 embed (unique trip_id), but tolerate
  // an array just in case the relationship is inferred as one-to-many.
  return (Array.isArray(embedded) ? embedded[0] ?? null : embedded) as TripDestination | null;
}

function normalizeTrip(row: any): GroupTrip {
  return { ...row, destination: pickDestination(row?.destination) } as GroupTrip;
}

/** Human-readable location label from a trip's destination. */
export function destinationLabel(
  d: { short_label?: string | null; name?: string | null; country?: string | null } | null | undefined
): string | null {
  if (!d) return null;
  return d.short_label || d.name || d.country || null;
}

/** Precise geocode data for a trip's destination (lives in group_trip_destinations). */
export interface TripDestinationGeo {
  place_id: string | null;
  name: string | null;
  short_label: string | null;
  formatted_address: string | null;
  locality: string | null;
  country: string | null; // ISO-2
  lat: number | null;
  lng: number | null;
  // Enriched async by the geocode-group-trip-destinations edge function.
  admin_level_1?: string | null;
  admin_level_2?: string | null;
  types?: string[] | null;
  geo_bucket_4?: string | null;
  geo_bucket_5?: string | null;
  geo_bucket_6?: string | null;
}

/**
 * Upsert the geocoded destination for a trip (1 row per trip). Called after
 * createGroupTrip with the place the host picked in the Google Places picker.
 * Best-effort at the call site — the trip still exists if this fails.
 *
 * After the upsert, fires the geocode-group-trip-destinations edge function in
 * the background to fill in admin_level_1/2, place types, and geohash buckets
 * (mirrors what geocode-user-destinations does for user_destinations). Enrich
 * failure is logged but never propagated — the caller's flow must not depend
 * on those fields being present immediately.
 */
export async function setTripDestination(
  tripId: string,
  geo: TripDestinationGeo
): Promise<void> {
  const { error } = await supabase
    .from('group_trip_destinations')
    .upsert({ trip_id: tripId, ...geo }, { onConflict: 'trip_id' });

  if (error) {
    console.error('[groupTripsService] setTripDestination error:', error);
    throw new Error(error.message);
  }

  supabase.functions
    .invoke('geocode-group-trip-destinations', { body: { trip_id: tripId } })
    .catch((e) => console.warn('[groupTripsService] geocode enrich failed:', e));
}

/**
 * Build a shareable invite URL for a group trip. Tokenless on purpose — group
 * trips use host-approved join requests, so the link just opens the trip's
 * detail in the app where the recipient taps "Request to join". The static
 * invite site (same one surftrips use) forwards `?grouptrip=` into the app via
 * the swellyo:// scheme; AppContent's Linking listener opens the trip.
 */
export function getGroupTripInviteUrl(tripId: string): string {
  const base = 'https://swellyo-invite.netlify.app';
  return `${base}/?grouptrip=${encodeURIComponent(tripId)}`;
}

// ---------------------------------------------------------------------------
// Budget estimate (Edge Function: estimate-trip-budget → OpenAI)
// ---------------------------------------------------------------------------
export interface BudgetTier {
  min: number;
  max: number;
  label?: string;
}
export interface BudgetEstimate {
  currency: 'USD';
  ranges: { low: BudgetTier; medium: BudgetTier; high: BudgetTier };
}
export interface EstimateBudgetParams {
  destination: string;
  country?: string | null;
  formattedAddress?: string | null;
  durationDays: number;
  accommodationType?: string | null;
  travelMonth?: string | null; // "YYYY-MM" — drives seasonality in the estimate
}

const isTier = (t: any): boolean =>
  t && typeof t.min === 'number' && typeof t.max === 'number';

/**
 * Ask the estimate-trip-budget Edge Function for 3 per-person USD ranges.
 * Throws on any failure (no key / offline / bad shape) so the caller can fall
 * back to manual entry.
 */
export async function estimateTripBudget(
  params: EstimateBudgetParams
): Promise<BudgetEstimate> {
  const { data, error } = await supabase.functions.invoke('estimate-trip-budget', {
    body: {
      destination: params.destination,
      country: params.country ?? null,
      formatted_address: params.formattedAddress ?? null,
      duration_days: params.durationDays,
      accommodation_type: params.accommodationType ?? null,
      travel_month: params.travelMonth ?? null,
    },
  });

  if (error) throw new Error(error.message || 'Budget estimate failed');
  if ((data as any)?.error) throw new Error((data as any).error);

  const ranges = (data as any)?.ranges;
  if (!ranges || !isTier(ranges.low) || !isTier(ranges.medium) || !isTier(ranges.high)) {
    throw new Error('Bad estimate response');
  }
  return data as BudgetEstimate;
}

export async function getTripDestination(
  tripId: string
): Promise<TripDestinationGeo | null> {
  const { data, error } = await supabase
    .from('group_trip_destinations')
    .select(
      'place_id, name, short_label, formatted_address, locality, country, lat, lng, admin_level_1, admin_level_2, types, geo_bucket_4, geo_bucket_5, geo_bucket_6'
    )
    .eq('trip_id', tripId)
    .maybeSingle();

  if (error) {
    console.warn('[groupTripsService] getTripDestination error:', error);
    return null;
  }
  return (data as TripDestinationGeo) ?? null;
}

export async function listExploreTrips(limit = 50, offset = 0): Promise<GroupTrip[]> {
  const { data, error } = await supabase
    .from('group_trips')
    .select(`*, ${TRIP_DEST_EMBED}`)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[groupTripsService] listExploreTrips error:', error);
    return [];
  }
  return (data || []).map(normalizeTrip);
}

export type MyTripBucket = 'approved' | 'pending' | 'past';

export interface MyTripsBuckets {
  approved: GroupTrip[];
  pending: GroupTrip[];
  past: GroupTrip[];
}

// Returns true if the trip should be considered past (end_date in the past,
// or — when only flexible date_months are set — the latest month has fully
// elapsed). Trips with no dates at all are treated as upcoming.
function isTripPast(trip: GroupTrip, today: Date = new Date()): boolean {
  if (trip.end_date) {
    return new Date(trip.end_date) < startOfDay(today);
  }
  if (trip.date_months && trip.date_months.length > 0) {
    const latest = [...trip.date_months].sort().pop()!;
    const [y, m] = latest.split('-').map(Number);
    // Trip is past once the month after `latest` has started.
    const startOfNextMonth = new Date(y, m, 1);
    return today >= startOfNextMonth;
  }
  return false;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Buckets the current user's trips into approved / pending / past.
 * - approved: user is a participant (host or member), trip is active and not past
 * - pending:  user has a pending join request, trip is still active
 * - past:     user is a participant and the trip has ended OR is cancelled
 *
 * Two queries in parallel: participant trips and pending-request trips. Bucketing
 * by end_date / date_months / status happens in JS so we don't need a DB column.
 */
export async function listMyTripsByBucket(userId: string): Promise<MyTripsBuckets> {
  const [participantRes, pendingRes] = await Promise.all([
    supabase
      .from('group_trip_participants')
      .select(`trip_id, group_trips!inner(*, ${TRIP_DEST_EMBED})`)
      .eq('user_id', userId),
    supabase
      .from('group_trip_join_requests')
      .select(`trip_id, group_trips!inner(*, ${TRIP_DEST_EMBED})`)
      .eq('requester_id', userId)
      .eq('status', 'pending'),
  ]);

  if (participantRes.error) {
    console.error('[groupTripsService] listMyTripsByBucket participants error:', participantRes.error);
  }
  if (pendingRes.error) {
    console.error('[groupTripsService] listMyTripsByBucket pending error:', pendingRes.error);
  }

  const approved: GroupTrip[] = [];
  const past: GroupTrip[] = [];
  const seen = new Set<string>();
  const today = new Date();

  for (const row of (participantRes.data || []) as any[]) {
    const trip = row.group_trips ? normalizeTrip(row.group_trips) : null;
    if (!trip || seen.has(trip.id)) continue;
    seen.add(trip.id);
    if (trip.status === 'cancelled' || isTripPast(trip, today)) {
      past.push(trip);
    } else {
      approved.push(trip);
    }
  }

  const pending: GroupTrip[] = [];
  for (const row of (pendingRes.data || []) as any[]) {
    const trip = row.group_trips ? normalizeTrip(row.group_trips) : null;
    if (!trip) continue;
    // If somehow already a participant, the approved/past bucket wins.
    if (seen.has(trip.id)) continue;
    if (trip.status !== 'active') continue;
    if (isTripPast(trip, today)) continue;
    pending.push(trip);
  }

  // Sort: approved + pending by start_date asc (soonest first), past by end_date desc (most recent first).
  const byStartAsc = (a: GroupTrip, b: GroupTrip) =>
    (a.start_date || '9999').localeCompare(b.start_date || '9999');
  const byEndDesc = (a: GroupTrip, b: GroupTrip) =>
    (b.end_date || b.start_date || '').localeCompare(a.end_date || a.start_date || '');

  approved.sort(byStartAsc);
  pending.sort(byStartAsc);
  past.sort(byEndDesc);

  return { approved, pending, past };
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
export type UpdateGroupTripInput = Partial<CreateGroupTripInput>;

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
 * Host updates the trip's master group_gear list (item names, ordered).
 * A DB trigger then syncs each participant's per-user list, preserving done state
 * for items that still exist in the new list and removing items that don't.
 */
export async function setTripGroupGear(
  tripId: string,
  names: string[]
): Promise<void> {
  const cleaned = names.map(n => n.trim()).filter(Boolean);
  const { error } = await supabase
    .from('group_trips')
    .update({ group_gear: cleaned })
    .eq('id', tripId);

  if (error) {
    console.error('[groupTripsService] setTripGroupGear error:', error);
    throw new Error(error.message);
  }
}

/**
 * Participant replaces their own personal_gear_by_host jsonb. Used to toggle a
 * single item's done state — the caller passes the full list with the toggled
 * item. RLS allows update only when auth.uid() === user_id.
 */
export async function setMyGroupGear(
  tripId: string,
  userId: string,
  list: GroupGearItem[]
): Promise<void> {
  const { error } = await supabase
    .from('group_trip_participants')
    .update({ personal_gear_by_host: list })
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) {
    console.error('[groupTripsService] setMyGroupGear error:', error);
    throw new Error(error.message);
  }
}

/**
 * Member replaces their own personal_gear_by_me jsonb. Host-defined items live
 * in group_trips.group_gear (and fan out into personal_gear_by_host) and are
 * NOT in this list — so members can never delete a host suggestion via this
 * call. RLS allows update only when auth.uid() === user_id.
 */
export async function setMyPersonalGearList(
  tripId: string,
  userId: string,
  list: PersonalGearItem[]
): Promise<void> {
  const cleaned = list
    .map(item => ({ name: item.name.trim(), done: !!item.done }))
    .filter(item => item.name.length > 0);

  const { error } = await supabase
    .from('group_trip_participants')
    .update({ personal_gear_by_me: cleaned })
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) {
    console.error('[groupTripsService] setMyPersonalGearList error:', error);
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
 * Member submits (or re-submits) a commitment request for a trip.
 * Flow:
 *   1. Mark any prior pending request for (trip, user) as 'superseded'.
 *   2. Insert a new pending row in group_trip_commitment_requests.
 *   3. Find-or-create the DM with the trip host and post a 'commitment_request'
 *      message with the structured metadata.
 *   4. Link the message back into the request row (message_id).
 *   5. Update group_trip_participants: status='pending' + snapshot of items/note.
 *
 * Returns the new request id and the chat message id so callers can refresh UI.
 */
export async function submitCommitment(
  tripId: string,
  userId: string,
  items: string[],
  note: string | null
): Promise<{ requestId: string; messageId: string | null }> {
  const tripRes = await supabase
    .from('group_trips')
    .select('id, host_id, title')
    .eq('id', tripId)
    .maybeSingle();
  if (tripRes.error || !tripRes.data) {
    console.error('[groupTripsService] submitCommitment: trip lookup failed', tripRes.error);
    throw new Error('Trip not found');
  }
  const hostId = (tripRes.data as any).host_id as string;
  const tripTitle = ((tripRes.data as any).title as string | null) ?? null;

  if (hostId === userId) {
    throw new Error('Host does not need to submit a commitment request');
  }

  // 1. Supersede any older pending request from this user for this trip so the
  //    host only sees the latest one in their review queue.
  {
    const { error: supersedeErr } = await supabase
      .from('group_trip_commitment_requests')
      .update({ status: 'superseded' })
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .eq('status', 'pending');
    if (supersedeErr) {
      console.warn('[groupTripsService] submitCommitment: supersede failed', supersedeErr);
    }
  }

  // 2. Insert the new request row.
  const insertReq = await supabase
    .from('group_trip_commitment_requests')
    .insert({
      trip_id: tripId,
      user_id: userId,
      commitment_proofs: items,
      note: note ?? null,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertReq.error || !insertReq.data) {
    console.error('[groupTripsService] submitCommitment: insert request failed', insertReq.error);
    throw new Error(insertReq.error?.message ?? 'Could not create commitment request');
  }
  const requestId = (insertReq.data as any).id as string;

  // 3. Find-or-create the DM with the host and post the structured message.
  let messageId: string | null = null;
  try {
    const conv = await messagingService.createDirectConversation(hostId);
    const msg = await messagingService.postCommitmentRequest(conv.id, {
      trip_id: tripId,
      request_id: requestId,
      trip_title: tripTitle,
      items,
      note: note ?? null,
      status: 'pending',
    });
    messageId = msg.id;

    // 4. Link the chat message back to the request row.
    await supabase
      .from('group_trip_commitment_requests')
      .update({ message_id: messageId })
      .eq('id', requestId);
  } catch (chatErr) {
    console.warn('[groupTripsService] submitCommitment: chat post failed', chatErr);
    // The request is still pending in DB — host can be notified another way.
  }

  // 5. Update participant snapshot.
  const { error: partErr } = await supabase
    .from('group_trip_participants')
    .update({
      commitment_status: 'pending',
      commitment_items: items,
      commitment_note: note,
      commitment_requested_at: new Date().toISOString(),
      commitment_decided_at: null,
      commitment_decided_by: null,
    })
    .eq('trip_id', tripId)
    .eq('user_id', userId);
  if (partErr) {
    console.warn('[groupTripsService] submitCommitment: participant update failed', partErr);
  }

  return { requestId, messageId };
}

/**
 * Host approves a pending commitment request.
 *  1. Update the request row → 'approved' + decided_by/at.
 *  2. Update the participant → commitment_status='approved' (trigger flips `committed`).
 *  3. Update the original chat message's commitment_metadata.status so the
 *     bubble stops offering an Approve action in any open chat client.
 *  4. Post a system banner ("<name> is now marked as committed") into the same DM.
 *
 * Idempotent: if the request is already approved this is a no-op.
 */
export async function approveCommitment(
  requestId: string,
  approverUserId: string
): Promise<void> {
  const reqRes = await supabase
    .from('group_trip_commitment_requests')
    .select('id, trip_id, user_id, status, message_id, commitment_proofs, note')
    .eq('id', requestId)
    .maybeSingle();
  if (reqRes.error || !reqRes.data) {
    console.error('[groupTripsService] approveCommitment: lookup failed', reqRes.error);
    throw new Error('Commitment request not found');
  }
  const req = reqRes.data as any;
  if (req.status === 'approved') return; // idempotent

  // 1. Mark request approved.
  const { error: updReqErr } = await supabase
    .from('group_trip_commitment_requests')
    .update({
      status: 'approved',
      decided_by: approverUserId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', requestId);
  if (updReqErr) {
    console.error('[groupTripsService] approveCommitment: request update failed', updReqErr);
    throw new Error(updReqErr.message);
  }

  // 2. Flip participant to approved (trigger keeps `committed` in sync).
  const { error: partErr } = await supabase
    .from('group_trip_participants')
    .update({
      commitment_status: 'approved',
      commitment_decided_at: new Date().toISOString(),
      commitment_decided_by: approverUserId,
    })
    .eq('trip_id', req.trip_id)
    .eq('user_id', req.user_id);
  if (partErr) {
    console.warn('[groupTripsService] approveCommitment: participant update failed', partErr);
  }

  // 3. Refresh the message bubble's status so any open chat reflects approval.
  if (req.message_id) {
    const { data: existingMsg } = await supabase
      .from('messages')
      .select('commitment_metadata')
      .eq('id', req.message_id)
      .maybeSingle();
    const meta = ((existingMsg as any)?.commitment_metadata ?? {}) as Record<string, unknown>;
    await supabase
      .from('messages')
      .update({
        commitment_metadata: { ...meta, status: 'approved' },
      })
      .eq('id', req.message_id);
  }

  // 4. Post the "X is now marked as committed" banner into the DM.
  try {
    const conv = await messagingService.createDirectConversation(req.user_id);
    const { data: surfer } = await supabase
      .from('surfers')
      .select('name')
      .eq('user_id', req.user_id)
      .maybeSingle();
    const name = ((surfer as any)?.name?.trim() as string | undefined) || 'They';
    await messagingService.postSystemMessage(conv.id, `${name} is now marked as committed`);
  } catch (bannerErr) {
    console.warn('[groupTripsService] approveCommitment: banner post failed', bannerErr);
  }
}

/**
 * Host declines a pending commitment request.
 * Mirrors approveCommitment:
 *  1. Mark the request row → 'declined' + decided_by/at.
 *  2. Reset the participant's commitment_status back to 'none' so they can re-submit later.
 *  3. Refresh the message bubble's metadata.status so any open chat reflects it.
 *  4. Post a system banner into the DM.
 *
 * Idempotent: no-op if already declined.
 */
export async function declineCommitment(
  requestId: string,
  declinerUserId: string
): Promise<void> {
  const reqRes = await supabase
    .from('group_trip_commitment_requests')
    .select('id, trip_id, user_id, status, message_id')
    .eq('id', requestId)
    .maybeSingle();
  if (reqRes.error || !reqRes.data) {
    console.error('[groupTripsService] declineCommitment: lookup failed', reqRes.error);
    throw new Error('Commitment request not found');
  }
  const req = reqRes.data as any;
  if (req.status === 'declined') return;

  const { error: updReqErr } = await supabase
    .from('group_trip_commitment_requests')
    .update({
      status: 'declined',
      decided_by: declinerUserId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', requestId);
  if (updReqErr) {
    console.error('[groupTripsService] declineCommitment: request update failed', updReqErr);
    throw new Error(updReqErr.message);
  }

  const { error: partErr } = await supabase
    .from('group_trip_participants')
    .update({
      commitment_status: 'none',
      commitment_decided_at: new Date().toISOString(),
      commitment_decided_by: declinerUserId,
    })
    .eq('trip_id', req.trip_id)
    .eq('user_id', req.user_id);
  if (partErr) {
    console.warn('[groupTripsService] declineCommitment: participant update failed', partErr);
  }

  if (req.message_id) {
    const { data: existingMsg } = await supabase
      .from('messages')
      .select('commitment_metadata')
      .eq('id', req.message_id)
      .maybeSingle();
    const meta = ((existingMsg as any)?.commitment_metadata ?? {}) as Record<string, unknown>;
    await supabase
      .from('messages')
      .update({
        commitment_metadata: { ...meta, status: 'declined' },
      })
      .eq('id', req.message_id);
  }

  try {
    const conv = await messagingService.createDirectConversation(req.user_id);
    const { data: surfer } = await supabase
      .from('surfers')
      .select('name')
      .eq('user_id', req.user_id)
      .maybeSingle();
    const name = ((surfer as any)?.name?.trim() as string | undefined) || 'They';
    await messagingService.postSystemMessage(conv.id, `${name}'s commitment was declined`);
  } catch (bannerErr) {
    console.warn('[groupTripsService] declineCommitment: banner post failed', bannerErr);
  }
}

/**
 * Host-side helper: list all pending commitment requests from a given user
 * across all trips the current viewer hosts. Used by the chat's "Review
 * commitment" sticky bar.
 *
 * Caller is expected to be the host of the returned requests' trips — RLS
 * enforces this server-side too.
 */
export async function listPendingCommitmentsToReviewFromUser(
  requesterUserId: string,
  hostUserId: string
): Promise<PendingCommitmentToReview[]> {
  const { data: hostedTrips, error: tripsErr } = await supabase
    .from('group_trips')
    .select('id, title')
    .eq('host_id', hostUserId);
  if (tripsErr || !hostedTrips || hostedTrips.length === 0) return [];
  const tripIdToTitle = new Map<string, string | null>();
  hostedTrips.forEach((t: any) => tripIdToTitle.set(t.id, t.title ?? null));
  const tripIds = Array.from(tripIdToTitle.keys());

  const { data: rows, error } = await supabase
    .from('group_trip_commitment_requests')
    .select('id, trip_id, user_id, commitment_proofs, note, status, message_id, decided_by, requested_at, decided_at')
    .eq('user_id', requesterUserId)
    .eq('status', 'pending')
    .in('trip_id', tripIds)
    .order('requested_at', { ascending: false });
  if (error || !rows) {
    if (error) console.warn('[groupTripsService] listPendingCommitmentsToReviewFromUser:', error);
    return [];
  }

  const { data: surfer } = await supabase
    .from('surfers')
    .select(PARTICIPANT_PROFILE_FIELDS)
    .eq('user_id', requesterUserId)
    .maybeSingle();
  const requester: ParticipantProfile | null = surfer
    ? {
        user_id: (surfer as any).user_id,
        name: (surfer as any).name ?? null,
        age: (surfer as any).age ?? null,
        surfboard_type: (surfer as any).surfboard_type ?? null,
        surf_level_category: (surfer as any).surf_level_category ?? null,
        profile_image_url: (surfer as any).profile_image_url ?? null,
        lifestyle_keywords: (surfer as any).lifestyle_keywords ?? null,
      }
    : null;

  return rows.map((r: any) => ({
    id: r.id,
    trip_id: r.trip_id,
    user_id: r.user_id,
    commitment_proofs: Array.isArray(r.commitment_proofs) ? (r.commitment_proofs as string[]) : [],
    note: r.note ?? null,
    status: 'pending' as const,
    message_id: r.message_id ?? null,
    decided_by: r.decided_by ?? null,
    requested_at: r.requested_at,
    decided_at: r.decided_at ?? null,
    trip_title: tripIdToTitle.get(r.trip_id) ?? null,
    requester,
  }));
}

/**
 * Member self-leaves a trip. Removes from group_trip_participants and from the
 * linked group conversation, and clears their join_request row so the
 * "Request to join" CTA re-appears if they ever want to rejoin.
 */
export async function leaveTrip(tripId: string, userId: string): Promise<void> {
  // Post the "<X> left the group" banner BEFORE deleting membership so RLS
  // still permits the insert (sender must be a conversation member).
  try {
    const conv = await messagingService.getConversationByTripId(tripId);
    if (conv?.id) {
      const { data: surfer } = await supabase
        .from('surfers')
        .select('name')
        .eq('user_id', userId)
        .maybeSingle();
      const name = (surfer as any)?.name?.trim() || 'User';
      await messagingService.postSystemMessage(conv.id, `${name} left the group`);
    }
  } catch (bannerError) {
    console.warn('[groupTripsService] leaveTrip banner failed:', bannerError);
  }

  const { error } = await supabase
    .from('group_trip_participants')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) {
    console.error('[groupTripsService] leaveTrip error:', error);
    throw new Error(error.message);
  }

  // Drop the join_request row so a fresh "Request to join" can be inserted.
  // Without this, the unique(trip_id, requester_id) constraint blocks the
  // re-request AND the CTA's `myRequest?.status !== 'approved'` gate would
  // also hide the button. RLS allows requester or host to delete their own.
  try {
    await supabase
      .from('group_trip_join_requests')
      .delete()
      .eq('trip_id', tripId)
      .eq('requester_id', userId);
  } catch (joinReqErr) {
    console.warn('[groupTripsService] leaveTrip join_request delete failed:', joinReqErr);
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
  // Post "<Host> removed <Target>" banner BEFORE deletion. Host stays in the
  // group so RLS lets the insert through.
  try {
    const conv = await messagingService.getConversationByTripId(tripId);
    if (conv?.id) {
      const adminId = (await supabase.auth.getUser()).data.user?.id ?? null;
      if (adminId) {
        const { data: surfers } = await supabase
          .from('surfers')
          .select('user_id, name')
          .in('user_id', [adminId, userId]);
        const byId = new Map<string, string>();
        (surfers || []).forEach((s: any) => {
          if (s?.name) byId.set(s.user_id, String(s.name).trim());
        });
        const adminName = byId.get(adminId) || 'User';
        const targetName = byId.get(userId) || 'User';
        await messagingService.postSystemMessage(
          conv.id,
          `${adminName} removed ${targetName}`
        );
      }
    }
  } catch (bannerError) {
    console.warn('[groupTripsService] removeParticipant banner failed:', bannerError);
  }

  const { error } = await supabase
    .from('group_trip_participants')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) {
    console.error('[groupTripsService] removeParticipant error:', error);
    throw new Error(error.message);
  }

  // Drop the matching join_request row so the removed user can submit a fresh
  // request later. Without this, the unique(trip_id, requester_id) constraint
  // blocks the re-request and the CTA's `status !== 'approved'` gate also
  // hides the button. Host has RLS delete rights on join_requests for their trip.
  try {
    await supabase
      .from('group_trip_join_requests')
      .delete()
      .eq('trip_id', tripId)
      .eq('requester_id', userId);
  } catch (joinReqErr) {
    console.warn('[groupTripsService] removeParticipant join_request delete failed:', joinReqErr);
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
    .select(`*, ${TRIP_DEST_EMBED}`)
    .eq('id', tripId)
    .single();

  if (error) {
    if ((error as any).code === 'PGRST116') return null; // no rows
    console.error('[groupTripsService] getTripById error:', error);
    return null;
  }
  return data ? normalizeTrip(data) : null;
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
    .select('role, joined_at, user_id, committed, commitment_status, commitment_items, commitment_note, personal_gear_by_host, personal_gear_by_me')
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
      commitment_status: (row.commitment_status as CommitmentStatus) ?? 'none',
      commitment_items: Array.isArray(row.commitment_items) ? row.commitment_items as string[] : [],
      commitment_note: row.commitment_note ?? null,
      personal_gear_by_host: Array.isArray(row.personal_gear_by_host) ? row.personal_gear_by_host as GroupGearItem[] : [],
      personal_gear_by_me: Array.isArray(row.personal_gear_by_me) ? row.personal_gear_by_me as PersonalGearItem[] : [],
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
  // Clear any prior request row (e.g. a previous 'declined' or 'withdrawn' one)
  // so the unique (trip_id, requester_id) constraint doesn't block a fresh
  // request. The "host or requester can delete" RLS policy permits this. We
  // intentionally re-INSERT rather than UPDATE back to 'pending' — the requester
  // UPDATE policy is deliberately locked to status='withdrawn' to prevent
  // self-approval, so a clean delete + pending insert is the supported path.
  const { error: delError } = await supabase
    .from('group_trip_join_requests')
    .delete()
    .eq('trip_id', tripId)
    .eq('requester_id', requesterId);
  if (delError) {
    console.error('[groupTripsService] requestToJoinTrip clear error:', delError);
    throw new Error(delError.message || 'Failed to request to join');
  }

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

/**
 * Declined requests for a trip with requester profile attached. Lets the host
 * reverse a decision (re-approve someone they previously declined). Mirrors
 * listPendingRequests but filters status='declined' and shows most-recent first.
 */
export async function listDeclinedRequests(
  tripId: string
): Promise<EnrichedJoinRequest[]> {
  const { data: requests, error } = await supabase
    .from('group_trip_join_requests')
    .select('*')
    .eq('trip_id', tripId)
    .eq('status', 'declined')
    .order('reviewed_at', { ascending: false });

  if (error) {
    console.error('[groupTripsService] listDeclinedRequests error:', error);
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
        const { data: surfer } = await supabase
          .from('surfers')
          .select('name')
          .eq('user_id', updated.requester_id)
          .maybeSingle();
        const name = (surfer as any)?.name?.trim() || 'User';
        await messagingService.postSystemMessage(
          conv.id,
          `${name} joined the group`
        );
      }
    } catch (chatError) {
      console.warn('[groupTripsService] add to trip group chat failed:', chatError);
    }
  }
}

// ---------------------------------------------------------------------------
// Group Gear — shared items the host wants the group to bring. Replaces the
// older group_packing_list jsonb model (which lacked quantities and approval).
// ---------------------------------------------------------------------------

export interface GearItem {
  id: string;
  trip_id: string;
  name: string;
  needed_qty: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  source_gear_request_id?: string | null;
}

export interface GearClaim {
  id: string;
  item_id: string;
  user_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface GearContributor {
  user_id: string;
  name: string | null;
  profile_image_url: string | null;
  quantity: number;
}

export interface EnrichedGearItem extends GearItem {
  claimed_qty: number; // SUM of claims
  contributors: GearContributor[];
  my_claim_qty: number; // current user's quantity (0 if no claim)
}

export type GearRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

export interface GearRequest {
  id: string;
  trip_id: string;
  requester_id: string;
  item_name: string;
  note: string | null;
  status: GearRequestStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface EnrichedGearRequest extends GearRequest {
  requester: ParticipantProfile;
}

/**
 * Lists all gear items for a trip, joined with their claims and contributor
 * profiles. Returns enriched rows with claimed_qty + contributors[] + the
 * current user's quantity (0 if no claim).
 */
export async function listGearItems(
  tripId: string,
  currentUserId: string | null
): Promise<EnrichedGearItem[]> {
  const { data: items, error: itemsError } = await supabase
    .from('group_trip_gear_items')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });

  if (itemsError) {
    console.error('[groupTripsService] listGearItems items error:', itemsError);
    return [];
  }
  if (!items || items.length === 0) return [];

  const itemIds = items.map((i: any) => i.id);
  const { data: claims, error: claimsError } = await supabase
    .from('group_trip_gear_claims')
    .select('item_id, user_id, quantity')
    .in('item_id', itemIds);

  if (claimsError) {
    console.error('[groupTripsService] listGearItems claims error:', claimsError);
  }

  const claimsByItem = new Map<string, { user_id: string; quantity: number }[]>();
  const userIds = new Set<string>();
  (claims || []).forEach((c: any) => {
    const arr = claimsByItem.get(c.item_id) || [];
    arr.push({ user_id: c.user_id, quantity: c.quantity });
    claimsByItem.set(c.item_id, arr);
    userIds.add(c.user_id);
  });

  let profilesById = new Map<string, { name: string | null; profile_image_url: string | null }>();
  if (userIds.size > 0) {
    const { data: surfers } = await supabase
      .from('surfers')
      .select('user_id, name, profile_image_url')
      .in('user_id', Array.from(userIds));
    (surfers || []).forEach((s: any) => {
      profilesById.set(s.user_id, {
        name: s.name ?? null,
        profile_image_url: s.profile_image_url ?? null,
      });
    });
  }

  return (items as GearItem[]).map(item => {
    const itemClaims = claimsByItem.get(item.id) || [];
    const claimed_qty = itemClaims.reduce((sum, c) => sum + c.quantity, 0);
    const my_claim_qty = currentUserId
      ? itemClaims.find(c => c.user_id === currentUserId)?.quantity ?? 0
      : 0;
    const contributors: GearContributor[] = itemClaims.map(c => ({
      user_id: c.user_id,
      name: profilesById.get(c.user_id)?.name ?? null,
      profile_image_url: profilesById.get(c.user_id)?.profile_image_url ?? null,
      quantity: c.quantity,
    }));
    return { ...item, claimed_qty, contributors, my_claim_qty };
  });
}

export async function addGearItem(
  tripId: string,
  hostId: string,
  name: string,
  neededQty: number,
  // When set, this item was created by approving a gear request. The DB uses it
  // to skip notifying the requester twice (they already get gear_request_decided).
  sourceGearRequestId?: string | null
): Promise<GearItem> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Item name is required');
  if (neededQty < 1) throw new Error('Quantity must be at least 1');

  const { data, error } = await supabase
    .from('group_trip_gear_items')
    .insert({
      trip_id: tripId,
      name: trimmed,
      needed_qty: neededQty,
      created_by: hostId,
      source_gear_request_id: sourceGearRequestId ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] addGearItem error:', error);
    throw new Error(error?.message || 'Failed to add item');
  }
  return data as GearItem;
}

export async function updateGearItem(
  itemId: string,
  patch: { name?: string; needed_qty?: number }
): Promise<GearItem> {
  const updates: any = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error('Item name cannot be empty');
    updates.name = trimmed;
  }
  if (patch.needed_qty !== undefined) {
    if (patch.needed_qty < 1) throw new Error('Quantity must be at least 1');
    updates.needed_qty = patch.needed_qty;
  }

  const { data, error } = await supabase
    .from('group_trip_gear_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] updateGearItem error:', error);
    throw new Error(error?.message || 'Failed to update item');
  }
  return data as GearItem;
}

export async function deleteGearItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('group_trip_gear_items').delete().eq('id', itemId);
  if (error) {
    console.error('[groupTripsService] deleteGearItem error:', error);
    throw new Error(error.message);
  }
}

/**
 * Upsert (or delete) the current user's claim on an item. quantity=0 deletes.
 * The DB enforces SUM(quantity) <= needed_qty via trigger.
 */
export async function setMyGearClaim(
  itemId: string,
  userId: string,
  quantity: number
): Promise<GearClaim | null> {
  if (quantity < 0) throw new Error('Quantity cannot be negative');

  if (quantity === 0) {
    const { error } = await supabase
      .from('group_trip_gear_claims')
      .delete()
      .eq('item_id', itemId)
      .eq('user_id', userId);
    if (error) {
      console.error('[groupTripsService] setMyGearClaim delete error:', error);
      throw new Error(error.message);
    }
    return null;
  }

  // upsert by (item_id, user_id) unique constraint
  const { data, error } = await supabase
    .from('group_trip_gear_claims')
    .upsert(
      { item_id: itemId, user_id: userId, quantity },
      { onConflict: 'item_id,user_id' }
    )
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] setMyGearClaim upsert error:', error);
    throw new Error(error?.message || 'Failed to update claim');
  }
  return data as GearClaim;
}

export async function listGearRequests(
  tripId: string,
  status: GearRequestStatus | 'all' = 'pending'
): Promise<EnrichedGearRequest[]> {
  let query = supabase
    .from('group_trip_gear_requests')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });
  if (status !== 'all') query = query.eq('status', status);

  const { data: requests, error } = await query;
  if (error) {
    console.error('[groupTripsService] listGearRequests error:', error);
    return [];
  }
  if (!requests || requests.length === 0) return [];

  const requesterIds = Array.from(new Set(requests.map((r: any) => r.requester_id)));
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

  return (requests as GearRequest[]).map(r => ({
    ...r,
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

export async function createGearRequest(
  tripId: string,
  requesterId: string,
  itemName: string,
  note?: string
): Promise<GearRequest> {
  const trimmedName = itemName.trim();
  if (!trimmedName) throw new Error('Item name is required');

  const { data, error } = await supabase
    .from('group_trip_gear_requests')
    .insert({
      trip_id: tripId,
      requester_id: requesterId,
      item_name: trimmedName,
      note: note?.trim() || null,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] createGearRequest error:', error);
    throw new Error(error?.message || 'Failed to send request');
  }
  return data as GearRequest;
}

/**
 * Host approves a gear request: creates the corresponding gear_item and marks
 * the request approved. Default needed_qty=1 — the host can edit afterwards.
 */
export async function approveGearRequest(
  requestId: string,
  neededQty: number = 1
): Promise<GearItem> {
  const { data: { user } } = await supabase.auth.getUser();
  const hostId = user?.id;
  if (!hostId) throw new Error('Not authenticated');

  // Fetch the request to get trip_id + item_name
  const { data: req, error: reqError } = await supabase
    .from('group_trip_gear_requests')
    .select('trip_id, item_name, status')
    .eq('id', requestId)
    .single();

  if (reqError || !req) {
    throw new Error(reqError?.message || 'Request not found');
  }
  if (req.status !== 'pending') {
    throw new Error('Request is no longer pending');
  }

  const item = await addGearItem(req.trip_id, hostId, req.item_name, neededQty, requestId);

  const { error: updateError } = await supabase
    .from('group_trip_gear_requests')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: hostId,
    })
    .eq('id', requestId);

  if (updateError) {
    console.error('[groupTripsService] approveGearRequest update error:', updateError);
    // Best-effort: the item was created; surface the partial failure.
    throw new Error(updateError.message);
  }
  return item;
}

export async function declineGearRequest(requestId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('group_trip_gear_requests')
    .update({
      status: 'declined',
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
    })
    .eq('id', requestId);

  if (error) {
    console.error('[groupTripsService] declineGearRequest error:', error);
    throw new Error(error.message);
  }
}

export async function withdrawGearRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('group_trip_gear_requests')
    .update({ status: 'withdrawn' })
    .eq('id', requestId);
  if (error) {
    console.error('[groupTripsService] withdrawGearRequest error:', error);
    throw new Error(error.message);
  }
}

// ---------------------------------------------------------------------------
// Admin updates — free-text lines the host posts to all trip members.
// ---------------------------------------------------------------------------

export interface AdminUpdate {
  id: string;
  trip_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export async function listAdminUpdates(tripId: string): Promise<AdminUpdate[]> {
  const { data, error } = await supabase
    .from('group_trip_admin_updates')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[groupTripsService] listAdminUpdates error:', error);
    return [];
  }
  return (data || []) as AdminUpdate[];
}

export async function addAdminUpdate(
  tripId: string,
  authorId: string,
  body: string
): Promise<AdminUpdate> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Update body cannot be empty');

  const { data, error } = await supabase
    .from('group_trip_admin_updates')
    .insert({ trip_id: tripId, author_id: authorId, body: trimmed })
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] addAdminUpdate error:', error);
    throw new Error(error?.message || 'Failed to add update');
  }
  return data as AdminUpdate;
}

export async function updateAdminUpdate(
  updateId: string,
  body: string
): Promise<AdminUpdate> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Update body cannot be empty');

  const { data, error } = await supabase
    .from('group_trip_admin_updates')
    .update({ body: trimmed })
    .eq('id', updateId)
    .select()
    .single();

  if (error || !data) {
    console.error('[groupTripsService] updateAdminUpdate error:', error);
    throw new Error(error?.message || 'Failed to update');
  }
  return data as AdminUpdate;
}

export async function deleteAdminUpdate(updateId: string): Promise<void> {
  const { error } = await supabase
    .from('group_trip_admin_updates')
    .delete()
    .eq('id', updateId);

  if (error) {
    console.error('[groupTripsService] deleteAdminUpdate error:', error);
    throw new Error(error.message);
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

/**
 * AppContent boot query: any join requests whose decision the user hasn't
 * seen yet? Used to show the "You're in!" / "Not a match this time" overlay.
 *
 * Two queries because there's no direct PostgREST join from join_requests to
 * group_trips that returns the trip fields we want without a relationship hint.
 * Same shape as getTripParticipants.
 */
export async function listUnseenJoinDecisions(
  userId: string
): Promise<UnseenJoinDecision[]> {
  const { data: rows, error } = await supabase
    .from('group_trip_join_requests')
    .select('id, trip_id, status, reviewed_at')
    .eq('requester_id', userId)
    .in('status', ['approved', 'declined'])
    .is('seen_decision_at', null)
    .order('reviewed_at', { ascending: true });

  if (error) {
    console.warn('[groupTripsService] listUnseenJoinDecisions error:', error);
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const tripIds = Array.from(new Set(rows.map((r: any) => r.trip_id as string)));
  const { data: trips, error: tripsErr } = await supabase
    .from('group_trips')
    .select(`id, title, hero_image_url, start_date, end_date, ${TRIP_DEST_EMBED}`)
    .in('id', tripIds);
  if (tripsErr) {
    console.warn('[groupTripsService] listUnseenJoinDecisions trips error:', tripsErr);
    return [];
  }
  const tripById = new Map<string, any>();
  (trips || []).forEach((t: any) => tripById.set(t.id, t));

  const out: UnseenJoinDecision[] = [];
  rows.forEach((r: any) => {
    const trip = tripById.get(r.trip_id);
    if (!trip) return;
    out.push({
      request_id: r.id,
      status: r.status,
      decided_at: r.reviewed_at ?? null,
      trip: {
        id: trip.id,
        title: trip.title ?? null,
        hero_image_url: trip.hero_image_url ?? '',
        destination_label: destinationLabel(pickDestination(trip.destination)),
        start_date: trip.start_date ?? null,
        end_date: trip.end_date ?? null,
      },
    });
  });
  return out;
}

/**
 * Flip seen_decision_at to now() via a SECURITY DEFINER RPC. See migration
 * 20260514000003_join_request_seen_decision.sql for why this isn't a plain
 * UPDATE (the existing RLS restricts requester updates to status='withdrawn').
 */
export async function markJoinDecisionSeen(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_join_decision_seen', {
    p_request_id: requestId,
  });
  if (error) {
    console.warn('[groupTripsService] markJoinDecisionSeen error:', error);
  }
}
