import { supabase } from '../lib/supabase';
import { SayError } from './sayError';
import { toNumber } from '../domain/money';
import type { DestinationGeo, PaymentMode } from '../domain/editTrip';
import { syncPayRequirements } from './actions';

/**
 * Reads and writes for the Edit trip page. Twin of the app's
 * `operatorTripsService.ts` — same tables, same order, same guards.
 *
 * Rule 1: nothing new in the database. Every write here is one the app already
 * makes, and what decides whether it lands is RLS plus the triggers on
 * `group_trips` (verified live, 18 Nov 2026):
 *  - `trg_guard_operator_trip_money` — price, deposit, private room and payment
 *    mode are the operator of record's (`host_id`) alone.
 *  - `trg_guard_operator_trip_dates` — so are the dates.
 *  - `group_trip_destinations` policies are `auth.uid() = host_id` — and so is
 *    the destination.
 *  - everything else is `trip.edit`, which a Manager holds.
 *  - `trg_notify_trip_dates_changed` tells travelers about new dates. It fires
 *    on the write itself, so nothing here sends anything.
 */

const COLUMNS = [
  'id', 'title', 'description', 'hero_image_url', 'host_id', 'hosting_style', 'status',
  'max_participants', 'participant_count',
  'start_date', 'end_date', 'date_months', 'duration_days',
  'target_surf_levels', 'target_surf_styles', 'wave_shapes', 'wave_size_min', 'wave_size_max',
  'age_min', 'age_max',
  'trip_structure', 'trip_vibes',
  'accommodation_type', 'accommodation_name', 'accommodation_url', 'accommodation_image_url',
  'accommodation_gallery_urls', 'stoke_certified', 'ci_surf_conservation',
  'host_lead_note', 'itinerary',
  'cost_per_person', 'deposit_amount', 'private_room_price_usd', 'budget_currency',
  'join_mode', 'payment_mode', 'offline_payment_due_days_before', 'price_inclusions',
  'visibility',
].join(', ');

export type EditableTrip = {
  id: string;
  title: string;
  description: string | null;
  heroImageUrl: string | null;
  hostId: string | null;
  hostingStyle: string | null;
  status: string | null;
  maxParticipants: number | null;
  /** Host included. The number the capacity trigger compares against. */
  participantCount: number;
  startDate: string | null;
  endDate: string | null;
  dateMonths: string[];
  durationDays: number | null;
  levels: string[];
  boards: string[];
  waveShape: string | null;
  waveSizeMin: number | null;
  waveSizeMax: number | null;
  ageMin: number | null;
  ageMax: number | null;
  structure: string[];
  vibes: string[];
  stayKind: string | null;
  stayName: string | null;
  stayUrl: string | null;
  stayImageUrl: string | null;
  stayGallery: string[];
  stokeCertified: boolean;
  ciSurfConservation: boolean;
  aboutYou: string | null;
  itinerary: unknown;
  costPerPerson: number | null;
  depositAmount: number | null;
  privateRoomPrice: number | null;
  currency: string | null;
  joinMode: 'approval' | 'instant';
  paymentMode: PaymentMode;
  offlineDueDaysBefore: number | null;
  priceInclusions: unknown;
  visibility: string;
  destination: DestinationGeo | null;
};

export async function fetchEditableTrip(tripId: string): Promise<EditableTrip> {
  const [tripRes, destRes] = await Promise.all([
    supabase.from('group_trips').select(COLUMNS).eq('id', tripId).single(),
    supabase
      .from('group_trip_destinations')
      .select('place_id, name, short_label, formatted_address, locality, country, lat, lng')
      .eq('trip_id', tripId)
      .maybeSingle(),
  ]);
  if (tripRes.error) throw tripRes.error;
  // A destination read that fails should not hide the rest of the trip.
  if (destRes.error) console.warn('[editTrip] destination read failed:', destRes.error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tripRes.data as any;
  return {
    id: t.id,
    title: t.title ?? '',
    description: t.description ?? null,
    heroImageUrl: t.hero_image_url ?? null,
    hostId: t.host_id ?? null,
    hostingStyle: t.hosting_style ?? null,
    status: t.status ?? null,
    maxParticipants: t.max_participants ?? null,
    participantCount: t.participant_count ?? 0,
    startDate: t.start_date ?? null,
    endDate: t.end_date ?? null,
    dateMonths: t.date_months ?? [],
    durationDays: t.duration_days ?? null,
    levels: t.target_surf_levels ?? [],
    boards: t.target_surf_styles ?? [],
    waveShape: t.wave_shapes?.[0] ?? null,
    waveSizeMin: toNumber(t.wave_size_min),
    waveSizeMax: toNumber(t.wave_size_max),
    ageMin: t.age_min ?? null,
    ageMax: t.age_max ?? null,
    structure: t.trip_structure ?? [],
    vibes: t.trip_vibes ?? [],
    stayKind: t.accommodation_type?.[0] ?? null,
    stayName: t.accommodation_name ?? null,
    stayUrl: t.accommodation_url ?? null,
    stayImageUrl: t.accommodation_image_url ?? null,
    stayGallery: t.accommodation_gallery_urls ?? [],
    stokeCertified: t.stoke_certified === true,
    ciSurfConservation: t.ci_surf_conservation === true,
    aboutYou: t.host_lead_note ?? null,
    itinerary: t.itinerary ?? null,
    costPerPerson: toNumber(t.cost_per_person),
    depositAmount: toNumber(t.deposit_amount),
    privateRoomPrice: toNumber(t.private_room_price_usd),
    currency: t.budget_currency ?? null,
    joinMode: t.join_mode === 'instant' ? 'instant' : 'approval',
    paymentMode: t.payment_mode === 'managed' ? 'managed' : 'offline',
    offlineDueDaysBefore: t.offline_payment_due_days_before ?? null,
    priceInclusions: t.price_inclusions ?? null,
    // Null on legacy rows reads as 'public', as explore_feed treats it.
    visibility: t.visibility ?? 'public',
    destination: (destRes.data as DestinationGeo | null) ?? null,
  };
}

/**
 * Every field that is not money. One plain UPDATE, like the app's
 * `updateOperatorTrip`.
 *
 * `.select('id')` so a write RLS silently filtered out (zero rows) is an error
 * the operator sees, not a "Saved" that changed nothing.
 */
export async function updateTripFields(tripId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.from('group_trips').update(patch).eq('id', tripId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new SayError('You do not have permission to edit this trip.');
}

/**
 * The destination lives in its own table (upsert on trip_id), then the app's
 * `geocode-group-trip-destinations` fills in regions and geohash buckets in the
 * background. That second call never fails the save — same as the app.
 */
export async function setTripDestination(tripId: string, geo: DestinationGeo): Promise<void> {
  const { error } = await supabase
    .from('group_trip_destinations')
    .upsert({ trip_id: tripId, ...geo }, { onConflict: 'trip_id' });
  if (error) throw error;
  supabase.functions
    .invoke('geocode-group-trip-destinations', { body: { trip_id: tripId } })
    .catch(e => console.warn('[editTrip] geocode enrich failed:', e));
}

async function freezeTripPrices(tripId: string): Promise<void> {
  const { error } = await supabase.rpc('operator_freeze_trip_prices', { p_trip_id: tripId });
  if (error) throw error;
}

/**
 * Turn payment collection on or off. Twin of the app's
 * `setOperatorTripPaymentMode`, in the only order the database allows:
 *
 * ON:  1. write payment_mode (trg_pay_requires_managed_trip needs it first)
 *      2. freeze — returns 0 on an offline trip, so it MUST follow step 1
 *      3. create / reactivate the pay rows
 *      If 2 or 3 throws, go back to 'offline' (which also deactivates whatever
 *      step 3 half-made) and rethrow. A trip left mid-flip is worth undoing.
 *
 * OFF: one write. trg_deactivate_pay_rows_when_offline retires the pay rows;
 *      the ledger keeps every payment already taken. The deposit is cleared,
 *      as the wizard never stores one on an offline trip.
 */
export async function setTripPaymentMode(
  tripId: string,
  mode: PaymentMode,
  depositAmount: number | null,
): Promise<void> {
  if (mode === 'offline') {
    await updateTripFields(tripId, { payment_mode: 'offline', deposit_amount: null });
    return;
  }
  await updateTripFields(tripId, { payment_mode: 'managed', deposit_amount: depositAmount });
  try {
    await freezeTripPrices(tripId);
    await syncPayRequirements(tripId, (depositAmount ?? 0) > 0);
  } catch (e) {
    try {
      await updateTripFields(tripId, { payment_mode: 'offline', deposit_amount: null });
    } catch (revertErr) {
      // Best-effort. Never replace the real cause with a second failure.
      console.error('[editTrip] payment-mode revert failed:', revertErr);
    }
    throw e;
  }
}

/**
 * "About you" is also how the operator's own crew card introduces them. The
 * trip write is the one that must land; this is best-effort and does nothing on
 * a trip published before the operator was put on their own crew.
 */
export async function syncOperatorCrewBio(tripId: string, operatorId: string, bio: string | null): Promise<void> {
  const { error } = await supabase
    .from('organized_trip_staff')
    .update({ bio: bio?.trim() || null })
    .eq('trip_id', tripId)
    .eq('user_id', operatorId)
    .eq('role_key', 'operator')
    .is('revoked_at', null);
  if (error) throw error;
}

/**
 * How many people `trg_notify_trip_dates_changed` will write to: every
 * participant whose role is not host, NO status filter — a traveler still in
 * onboarding agreed to these dates and gets the notice too. Not
 * `participant_count`, which gives onboarding travelers no seat.
 *
 * Undercounts by pending join requesters, whom the trigger also tells — the
 * safe direction. The base table's SELECT policy is open to signed-in users;
 * only the price columns are withheld, and this reads none of them.
 */
export async function fetchDatesNotifyCount(tripId: string): Promise<number> {
  const { count, error } = await supabase
    .from('group_trip_participants')
    .select('user_id', { count: 'exact', head: true })
    .eq('trip_id', tripId)
    .neq('role', 'host');
  if (error) throw error;
  return count ?? 0;
}
