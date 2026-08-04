/**
 * Field rules shared by the create wizard and the operator Edit trip screen.
 *
 * Pure on purpose: no React, no Supabase, no i18n. Each function returns null
 * when the value is fine, or one sentence to show the operator when it is not.
 *
 * Two of these mirror a database CHECK — validateDeposit
 * (group_trips_deposit_not_over_price) and validateAgeRange (the age span
 * CHECK). When either CHECK changes, change the function in the same commit or
 * the operator gets a raw Postgres error instead of a sentence.
 */

const MIN_AGE = 16;
const MAX_AGE = 99;
const MIN_SPOTS = 2;
const MAX_SPOTS = 50;

export function validateAgeRange(
  ageMin: number | null,
  ageMax: number | null,
  ageWindow: number,
): string | null {
  // Each end is bounded on its own, BEFORE the both-must-be-set guard. No DB
  // CHECK enforces the 16-99 floor — the migrations only carry `age_max >=
  // age_min` and the span rule, and both of those pass when either end is null.
  // So this function is the only thing standing between a half-filled sheet
  // (min typed, max not yet) and an out-of-range age reaching the row.
  if (ageMin != null && (ageMin < MIN_AGE || ageMin > MAX_AGE)) {
    return `Ages must be ${MIN_AGE}-${MAX_AGE}.`;
  }
  if (ageMax != null && (ageMax < MIN_AGE || ageMax > MAX_AGE)) {
    return `Ages must be ${MIN_AGE}-${MAX_AGE}.`;
  }
  // The comparison rules need both ends. An operator who has not opened the age
  // sheet yet has two nulls, and that is not an error on its own.
  if (ageMin == null || ageMax == null) return null;
  if (ageMax < ageMin) return 'The oldest age has to be older than the youngest.';
  if (ageMax - ageMin < ageWindow) {
    return `Make the age range at least ${ageWindow} years wide.`;
  }
  return null;
}

export type DatesInput = {
  mode: 'exact' | 'months';
  startDate: string | null; // ISO yyyy-mm-dd
  endDate: string | null;   // ISO yyyy-mm-dd
  months: string[];         // yyyy-mm
  durationDays: number | null;
};

export function validateDates(input: DatesInput): string | null {
  if (input.mode === 'exact') {
    if (!input.startDate || !input.endDate) return 'Pick the trip dates.';
    // ISO yyyy-mm-dd sorts the same as it compares, so a string compare is
    // correct here and skips every timezone question a Date would raise.
    if (input.endDate < input.startDate) {
      return 'The end date has to be on or after the start date.';
    }
    return null;
  }
  if (input.months.length === 0) return 'Pick at least one month.';
  if (input.durationDays == null || input.durationDays <= 0) {
    return 'Say how long the trip is.';
  }
  return null;
}

export type StayInput = {
  specificStaySelected: boolean;
  name: string | null;
  url: string | null;
  imageUrl: string | null;
};

export function validateStay(input: StayInput): string | null {
  if (!input.specificStaySelected) return null;
  if (!input.name?.trim()) return 'Add the name of the stay.';
  if (!input.url?.trim()) return 'Add a link to the stay.';
  if (!input.imageUrl?.trim()) return 'Add a photo of the stay.';
  return null;
}

export function validatePrice(costPerPerson: number | null): string | null {
  if (costPerPerson == null) return 'Set the price per person.';
  if (costPerPerson <= 0) return 'The price has to be more than 0.';
  return null;
}

export function validateDeposit(
  depositAmount: number | null,
  costPerPerson: number | null,
): string | null {
  if (depositAmount == null) return null;
  if (depositAmount < 0) return 'The deposit has to be zero or more.';
  // Matches the DB CHECK, which also passes when the price is null.
  if (costPerPerson == null) return null;
  if (depositAmount > costPerPerson) {
    return 'The deposit cannot be more than the price.';
  }
  return null;
}

/**
 * `participantCount` is group_trips.participant_count — the trigger-maintained
 * live count, host included. It is the same number max_participants is compared
 * against everywhere else (isFull on the detail screen, the join trigger), so a
 * floor built on anything else would let the client accept a value the database
 * then rejects. Someone who joined and has not paid still holds a spot.
 */
export function validateSpots(
  maxParticipants: number | null,
  participantCount: number,
): string | null {
  if (maxParticipants == null) return null;
  if (maxParticipants < MIN_SPOTS) return `A trip needs at least ${MIN_SPOTS} spots.`;
  if (maxParticipants > MAX_SPOTS) return `The most spots you can set is ${MAX_SPOTS}.`;
  if (maxParticipants < participantCount) {
    return `${participantCount} people are on this trip. Remove someone first.`;
  }
  return null;
}
