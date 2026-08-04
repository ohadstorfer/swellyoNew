/**
 * Database calls for the operator "Edit trip" screen.
 * Spec: docs/specs/operator-trips/operator-trip-edit.md
 *
 * Everything here is operator-trip only (hosting_style = 'C'). Peer trips keep
 * going through groupTripsService directly.
 */
import { supabase } from '../../config/supabase';
import {
  updateGroupTrip,
  setTripDestination,
  type UpdateGroupTripInput,
  type TripDestinationGeo,
} from '../trips/groupTripsService';

/**
 * Pin every joined traveler to the price they joined at. See spec §7.2.
 *
 * trg_freeze_traveler_price already does this at join time for a trip that is
 * already 'managed'. This covers the rows it deliberately left null: everyone
 * who joined while the trip was still 'offline'. Without it, editing
 * cost_per_person silently reprices all of them.
 *
 * Returns how many rows were frozen. 0 is a real answer — an offline trip, or a
 * trip with no price, or one where everybody is already frozen.
 */
export async function freezeTripPrices(tripId: string): Promise<number> {
  const { data, error } = await supabase.rpc('operator_freeze_trip_prices', {
    p_trip_id: tripId,
  });
  if (error) {
    console.error('[operatorTripsService] freezeTripPrices error:', error);
    throw new Error(error.message);
  }
  return data ?? 0;
}

/**
 * The only sanctioned way to change a trip's price. Freezes first, then writes.
 * If the freeze throws, the price is NOT written — a half-done reprice is worse
 * than none.
 */
export async function updateOperatorTripPrice(
  tripId: string,
  patch: { cost_per_person?: number | null; deposit_amount?: number | null },
): Promise<void> {
  await freezeTripPrices(tripId);
  await updateGroupTrip(tripId, patch as UpdateGroupTripInput);
}

/** Every field that is not the price. A plain passthrough — kept here so the
 *  screen imports one service, not two. */
export async function updateOperatorTrip(
  tripId: string,
  patch: UpdateGroupTripInput,
): Promise<void> {
  await updateGroupTrip(tripId, patch);
}

/** Destination lives in group_trip_destinations; updateGroupTrip deliberately
 *  excludes it (groupTripsService.ts:895-902). setTripDestination already
 *  upserts on trip_id, so this handles a change as well as a first write. */
export async function setOperatorTripDestination(
  tripId: string,
  geo: TripDestinationGeo,
): Promise<void> {
  await setTripDestination(tripId, geo);
}
