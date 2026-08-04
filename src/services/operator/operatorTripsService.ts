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
import { syncPayRequirements } from '../trips/tripDocumentsService';

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
 *
 * `paymentMode` is the trip's CURRENT mode. On a managed trip the deposit row
 * has to follow the deposit amount: dropping the deposit to blank must retire
 * the row, and adding one to a single-payment trip must create it, or
 * operator_set_traveler_price rejects every per-traveler deposit with "no
 * active deposit requirement". Offline trips have no active pay rows at all,
 * so there is nothing to sync.
 */
export async function updateOperatorTripPrice(
  tripId: string,
  patch: { cost_per_person?: number | null; deposit_amount?: number | null },
  paymentMode: 'offline' | 'managed' = 'offline',
): Promise<void> {
  await freezeTripPrices(tripId);
  await updateGroupTrip(tripId, patch as UpdateGroupTripInput);
  if (paymentMode === 'managed' && 'deposit_amount' in patch) {
    await syncPayRequirements(tripId, (patch.deposit_amount ?? 0) > 0);
  }
}

/**
 * Turn payment collection on or off after the trip is published.
 *
 * The create wizard used to be the only place this could happen, because the
 * pay requirement rows are built at publish and a trip that says 'managed' with
 * no rows behind it asks for money it has no step to collect. This does both
 * halves, in the only order the database allows.
 *
 * Turning ON:
 *   1. write payment_mode (trg_pay_requires_managed_trip needs it first)
 *   2. freeze — operator_freeze_trip_prices returns 0 on an offline trip, so
 *      this MUST come after step 1. It is what pins everyone who joined while
 *      the trip was still offline to today's price instead of leaving them
 *      floating on the trip default forever.
 *   3. create/reactivate the pay rows
 * If 2 or 3 throws, payment_mode goes back to 'offline' — which also
 * deactivates anything step 3 half-created — and the error is rethrown. A trip
 * left mid-flip is the one outcome worth undoing work to avoid.
 *
 * Turning OFF is a single write: trg_deactivate_pay_rows_when_offline
 * deactivates the pay rows for us, and the ledger keeps every payment already
 * taken.
 */
export async function setOperatorTripPaymentMode(
  tripId: string,
  mode: 'offline' | 'managed',
  depositAmount: number | null,
): Promise<void> {
  if (mode === 'offline') {
    await updateGroupTrip(tripId, {
      payment_mode: 'offline',
      // Matches the wizard, which never stores a deposit on an offline trip.
      deposit_amount: null,
    } as UpdateGroupTripInput);
    return;
  }

  await updateGroupTrip(tripId, {
    payment_mode: 'managed',
    deposit_amount: depositAmount,
  } as UpdateGroupTripInput);
  try {
    await freezeTripPrices(tripId);
    await syncPayRequirements(tripId, (depositAmount ?? 0) > 0);
  } catch (e) {
    try {
      await updateGroupTrip(tripId, {
        payment_mode: 'offline',
        deposit_amount: null,
      } as UpdateGroupTripInput);
    } catch (revertErr) {
      // The revert is best-effort. Log it rather than replacing the real cause
      // with a second failure the operator can do nothing about.
      console.error('[operatorTripsService] payment-mode revert failed:', revertErr);
    }
    throw e;
  }
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
