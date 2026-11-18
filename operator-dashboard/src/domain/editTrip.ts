/**
 * The rules behind the Edit trip page (`/trips/:tripId/edit`).
 *
 * ⚠️ TWIN of the app's `OperatorTripEditScreen.tsx` and the files it leans on:
 * `tripValidation.ts`, `groupTripsService.ts` (option lists and mutex pairs),
 * the sheet bodies' option copy, and `connectStatus.canCollectPayments`. This
 * site shares no code with the app, so every rule an operator can trip over
 * lives here, tested, and has to change in both places at once.
 *
 * Pure: no React, no Supabase. Each validator returns null when the value is
 * fine, or one sentence for the operator. Several mirror a database CHECK on
 * `group_trips` (verified live 18 Nov 2026) — when one of those changes, the
 * function here changes in the same commit or the operator gets a raw Postgres
 * error instead of a sentence.
 */

import { validateTripPrice } from './money';
import { resolveDeadlineISO, todayISO } from './requirements';
import type { ConnectState } from './connect';

// ─── Limits ──────────────────────────────────────────────────────────────────

export const MIN_SPOTS = 2;
export const MAX_SPOTS = 50;
export const MIN_AGE = 16;
export const MAX_AGE = 99;
/** `group_trips_age_window_min`: age_max - age_min >= 4. Same for every style. */
export const AGE_WINDOW = 4;
/** `group_trips_accommodation_gallery_max`. Extra photos besides the main one. */
export const STAY_GALLERY_MAX = 9;
/** SpecificStaySheetContent's NAME_MAX. */
export const STAY_NAME_MAX = 18;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 2000;
export const ABOUT_YOU_MAX = 1000;
export const WAVE_SIZE_MIN = 1;
export const WAVE_SIZE_MAX = 12;
/** The app's "+/-5 days" window around the length chosen at creation. */
export const DURATION_TOLERANCE = 5;

// ─── Option lists (copied from the app's sheet bodies) ───────────────────────

export type Option<T extends string = string> = { key: T; label: string; desc?: string };

export type SurfLevel = 'beginner' | 'intermediate' | 'advanced' | 'pro' | 'all';
export const LEVEL_OPTIONS: Option<SurfLevel>[] = [
  { key: 'beginner', label: 'Beginner', desc: 'Just getting started - paddling, popping up, white water.' },
  { key: 'intermediate', label: 'Intermediate', desc: 'Comfortable on green waves, working on turns.' },
  { key: 'advanced', label: 'Advanced', desc: 'Confident in bigger sets, charging unfamiliar breaks.' },
];

export type SurfStyle = 'shortboard' | 'midlength' | 'longboard' | 'softtop' | 'all';
export const BOARD_OPTIONS: Option<SurfStyle>[] = [
  { key: 'softtop', label: 'Soft-Top', desc: 'Foamy and forgiving - easy paddling, stable take-offs.' },
  { key: 'shortboard', label: 'Shortboard', desc: 'Quick and responsive for steeper, punchier waves.' },
  { key: 'midlength', label: 'Mid-Length', desc: 'Versatile glider - speed and maneuverability in one.' },
  { key: 'longboard', label: 'Longboard', desc: 'Classic logging - smooth trim and noserides on mellow waves.' },
];

export type WaveShape = 'soft' | 'wally' | 'barrel';
export const WAVE_SHAPE_OPTIONS: Option<WaveShape>[] = [
  { key: 'soft', label: 'Soft' },
  { key: 'wally', label: 'Standing' },
  { key: 'barrel', label: 'Barrel' },
];

export type TripStructureSlug =
  | 'shared_decisions'
  | 'structured_schedule'
  | 'loose_schedule'
  | 'book_own_stay'
  | 'book_together'
  | 'group_all_day'
  | 'own_thing_day';
export const TRIP_STRUCTURE_OPTIONS: Option<TripStructureSlug>[] = [
  { key: 'shared_decisions', label: 'Shared decisions on activities and schedule' },
  { key: 'structured_schedule', label: 'Structured daily schedule' },
  { key: 'loose_schedule', label: 'Loose daily schedule' },
  { key: 'book_own_stay', label: 'Book your own accommodation' },
  { key: 'book_together', label: 'Accommodation booked together' },
  { key: 'group_all_day', label: 'Group together most of the day' },
  { key: 'own_thing_day', label: 'Do your own thing during the day' },
];
/** `group_trips_trip_structure_valid` refuses any of these pairs together. */
export const TRIP_STRUCTURE_MUTEX: [TripStructureSlug, TripStructureSlug][] = [
  ['structured_schedule', 'loose_schedule'],
  ['book_own_stay', 'book_together'],
  ['group_all_day', 'own_thing_day'],
];

export type TripVibeSlug = 'improve_surf' | 'surf_focused' | 'explore' | 'vacation';
/** Single-select. Top to bottom = most to least surf. */
export const TRIP_VIBE_OPTIONS: Option<TripVibeSlug>[] = [
  { key: 'improve_surf', label: 'Improve your surfing - training camp' },
  { key: 'surf_focused', label: 'Surf-focused - wake up early, surf a lot' },
  { key: 'explore', label: 'Surf + Explore' },
  { key: 'vacation', label: 'Vacation style - chill, loose surf, lay-days' },
];

export type StayKind =
  | 'villa'
  | 'hostel'
  | 'hotel'
  | 'surfcamp'
  | 'bungalow'
  | 'apartment'
  | 'guesthouse'
  | 'ecolodge'
  | 'other';
export const STAY_KIND_OPTIONS: Option<StayKind>[] = [
  { key: 'villa', label: 'Villa', desc: 'Shared house with private rooms' },
  { key: 'hostel', label: 'Hostel', desc: 'Budget-friendly, social vibe' },
  { key: 'hotel', label: 'Hotel', desc: 'Private rooms, more comfort' },
  { key: 'surfcamp', label: 'Surf camp', desc: 'Surf-focused, all-in package' },
  { key: 'bungalow', label: 'Bungalow', desc: 'Standalone, close to the beach' },
  { key: 'apartment', label: 'Apartment', desc: 'Self-catering, your own space' },
  { key: 'guesthouse', label: 'Guesthouse', desc: 'Homey, locally run' },
  { key: 'ecolodge', label: 'Eco lodge', desc: 'Off-grid, nature-immersed' },
  { key: 'other', label: 'Other', desc: 'Something else' },
];

export type JoinMode = 'approval' | 'instant';
export const JOIN_MODE_OPTIONS: Option<JoinMode>[] = [
  { key: 'approval', label: 'I approve each traveler', desc: 'Travelers send a request. They pay after you approve them.' },
  { key: 'instant', label: 'Anyone can join right away', desc: 'No request. Travelers join and go straight to checkout.' },
];

export type Visibility = 'public' | 'link_only';
export const VISIBILITY_OPTIONS: Option<Visibility>[] = [
  { key: 'public', label: 'Listed in explore', desc: 'Anyone browsing trips can find this one.' },
  {
    key: 'link_only',
    label: 'Link only',
    desc: 'Only people you send the link to can see it. Travelers who already joined keep their access.',
  },
];

export type PaymentMode = 'offline' | 'managed';
export const PAYMENT_MODE_OPTIONS: Option<PaymentMode>[] = [
  { key: 'offline', label: "I'll handle payment myself", desc: 'Travelers pay you outside the app, however you do it today.' },
  { key: 'managed', label: 'Collect payment in Swellyo', desc: 'Travelers pay by card. A deposit now, the rest before the trip.' },
];

export function labelOf<T extends string>(options: Option<T>[], key: string | null | undefined): string | null {
  if (!key) return null;
  return options.find(o => o.key === key)?.label ?? null;
}

// ─── Multi-select helpers ────────────────────────────────────────────────────

/** Order-insensitive equality, so toggling a set off and back on in a
 *  different order does not read as a change. */
export function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every(x => setB.has(x));
}

/**
 * Toggle one option. Picking one half of a mutex pair silently drops the other
 * half — the app's TripTagPicker does the same, and the database CHECK would
 * refuse the pair anyway.
 */
export function toggleWithMutex<T extends string>(
  selected: readonly T[],
  slug: T,
  mutex: [T, T][] = [],
): T[] {
  if (selected.includes(slug)) return selected.filter(s => s !== slug);
  const conflicting = new Set<T>();
  for (const [a, b] of mutex) {
    if (a === slug) conflicting.add(b);
    else if (b === slug) conflicting.add(a);
  }
  return [...selected.filter(s => !conflicting.has(s)), slug];
}

/** Picking the selected vibe again clears it — it is optional to publish. */
export function toggleSingle<T extends string>(selected: readonly T[], slug: T): T[] {
  return selected.includes(slug) ? [] : [slug];
}

// ─── What each row writes ────────────────────────────────────────────────────

/** Boards are optional. Empty is "any board", which the wizard writes as ['all']. */
export function boardsForSave(next: SurfStyle[]): SurfStyle[] {
  return next.length ? next : ['all'];
}

/** Structure and vibe are optional; empty is stored as null, never []. */
export function optionalArrayForSave<T>(next: T[]): T[] | null {
  return next.length ? next : null;
}

/** 'all' is a stored "any" marker, not a choice an operator can tick. */
export function selectableLevels(stored: readonly string[] | null | undefined): SurfLevel[] {
  return (stored ?? []).filter((s): s is SurfLevel => LEVEL_OPTIONS.some(o => o.key === s));
}
export function selectableBoards(stored: readonly string[] | null | undefined): SurfStyle[] {
  return (stored ?? []).filter((s): s is SurfStyle => BOARD_OPTIONS.some(o => o.key === s));
}

// ─── Validators ──────────────────────────────────────────────────────────────

export function validateTitle(title: string): string | null {
  if (!title.trim()) return 'Give the trip a name.';
  return null;
}

/**
 * `participantCount` is `group_trips.participant_count` — host included, and
 * the number `trg_group_trips_capacity_floor` compares against. A floor built
 * on anything else would accept a value the database then refuses.
 */
export function validateSpots(
  maxParticipants: number | null,
  participantCount: number,
): string | null {
  if (maxParticipants == null) return null;
  if (!Number.isInteger(maxParticipants)) return 'Spots has to be a whole number.';
  if (maxParticipants < MIN_SPOTS) return `A trip needs at least ${MIN_SPOTS} spots.`;
  if (maxParticipants > MAX_SPOTS) return `The most spots you can set is ${MAX_SPOTS}.`;
  if (maxParticipants < participantCount) {
    return `${participantCount} people are on this trip. Remove someone first.`;
  }
  return null;
}

/** Each end bounded on its own first: no CHECK holds the 16-99 floor, and both
 *  CHECKs pass while either end is null. */
export function validateAgeRange(
  ageMin: number | null,
  ageMax: number | null,
  ageWindow: number = AGE_WINDOW,
): string | null {
  if (ageMin != null && (ageMin < MIN_AGE || ageMin > MAX_AGE)) return `Ages must be ${MIN_AGE}-${MAX_AGE}.`;
  if (ageMax != null && (ageMax < MIN_AGE || ageMax > MAX_AGE)) return `Ages must be ${MIN_AGE}-${MAX_AGE}.`;
  if (ageMin == null || ageMax == null) return null;
  if (ageMax < ageMin) return 'The oldest age has to be older than the youngest.';
  if (ageMax - ageMin < ageWindow) return `Make the age range at least ${ageWindow} years wide.`;
  return null;
}

export function ageLabel(ageMin: number | null, ageMax: number | null): string {
  if (ageMin == null && ageMax == null) return 'All ages';
  if (ageMax == null) return `${ageMin}+`;
  if (ageMin == null) return `Up to ${ageMax}`;
  return `${ageMin} – ${ageMax}`;
}

export function validateWave(shape: WaveShape | null, sizeMin: number, sizeMax: number): string | null {
  if (shape === null) return 'Pick a wave shape.';
  if (sizeMin < WAVE_SIZE_MIN || sizeMax > WAVE_SIZE_MAX || sizeMin > sizeMax) {
    return `Pick a size between ${WAVE_SIZE_MIN} and ${WAVE_SIZE_MAX}+ ft.`;
  }
  return null;
}

export function waveSizeLabel(n: number): string {
  return n >= WAVE_SIZE_MAX ? `${WAVE_SIZE_MAX}+ ft` : `${n} ft`;
}

/**
 * Price, deposit and private room are ONE save, because two CHECKs tie them:
 * `group_trips_deposit_not_over_price` and `group_trips_private_room_price_check`
 * (private room > 0, and the deposit no more than it). Split, an operator could
 * save a deposit the very next price edit invalidates.
 */
export function validatePriceSet(
  costPerPerson: number | null,
  depositAmount: number | null,
  privateRoomPrice: number | null,
): string | null {
  const base = validateTripPrice(costPerPerson, depositAmount);
  if (base) return base;
  if (privateRoomPrice != null && privateRoomPrice > 0) {
    if (depositAmount != null && depositAmount > privateRoomPrice) {
      return 'The deposit can’t be more than the private room price.';
    }
  }
  return null;
}

/** 0 or blank means "no private room". Travelers who already picked one keep
 *  their own frozen price. */
export function privateRoomForSave(value: number | null): number | null {
  return value != null && value > 0 ? value : null;
}

/** A typed "0" deposit is the same as blank: one single payment, no deposit row. */
export function depositForSave(value: number | null): number | null {
  return value != null && value > 0 ? value : null;
}

// ─── Stay ────────────────────────────────────────────────────────────────────

export type StayDraft = {
  kind: StayKind | null;
  name: string;
  url: string;
  imageUrl: string | null;
  galleryUrls: string[];
  stokeCertified: boolean;
  ciSurfConservation: boolean;
};

export function validateStay(d: StayDraft): string | null {
  if (!d.kind) return 'Pick an accommodation type.';
  if (!d.name.trim()) return 'Add the name of the stay.';
  if (d.galleryUrls.length > STAY_GALLERY_MAX) return `Up to ${STAY_GALLERY_MAX} extra photos.`;
  return null;
}

/**
 * The patch the app's stay sheet writes. Extra photos only with a main photo —
 * the sheet clears them without one.
 */
export function stayPatch(d: StayDraft): Record<string, unknown> {
  const gallery = d.imageUrl ? d.galleryUrls.slice(0, STAY_GALLERY_MAX) : [];
  return {
    accommodation_type: d.kind ? [d.kind] : null,
    accommodation_name: d.name.trim() || null,
    accommodation_url: d.url.trim() || null,
    accommodation_image_url: d.imageUrl,
    accommodation_gallery_urls: gallery.length ? gallery : null,
    specific_stay_selected: true,
    stoke_certified: d.stokeCertified,
    ci_surf_conservation: d.ciSurfConservation,
  };
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export type DatesInitial = {
  startDate: string | null;
  endDate: string | null;
  /** yyyy-mm, the loose window chosen at creation. Kept, never edited here. */
  dateMonths: string[];
  durationDays: number | null;
};

export type DatesPatch = {
  start_date: string;
  end_date: string;
  dates_set_in_stone: true;
  date_months: string[] | null;
  duration_days: number;
};

const parseISO = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** Days the range touches, both ends included. */
export function rangeDays(start: string, end: string): number | null {
  const a = parseISO(start);
  const b = parseISO(end);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function lastDayOfMonth(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]), 0);
  return todayISO(d);
}

/**
 * The app's EditDatesSheet rules, as one function:
 *  - both dates, end on or after start;
 *  - inside the loose months chosen at creation, when there were any, and not
 *    starting before today when that window is in force;
 *  - the length within ±5 days of the length chosen at creation.
 */
export function datesRule(initial: DatesInitial, today: string = todayISO()): {
  minStart: string | null;
  maxEnd: string | null;
  minDays: number | null;
  maxDays: number | null;
} {
  const months = [...initial.dateMonths].sort();
  const from = months[0] ?? null;
  const to = months[months.length - 1] ?? null;
  const looseStart = from ? `${from}-01` : null;
  const minStart = looseStart ? (looseStart < today ? today : looseStart) : null;
  const maxEnd = to ? lastDayOfMonth(to) : null;
  const base = initial.durationDays;
  return {
    minStart,
    maxEnd,
    minDays: base ? Math.max(1, base - DURATION_TOLERANCE) : null,
    maxDays: base ? base + DURATION_TOLERANCE : null,
  };
}

export function validateDates(
  start: string | null,
  end: string | null,
  initial: DatesInitial,
  today: string = todayISO(),
): string | null {
  if (!start || !end) return 'Pick the trip dates.';
  if (!parseISO(start) || !parseISO(end)) return 'Pick the trip dates.';
  if (end < start) return 'The end date has to be on or after the start date.';
  const r = datesRule(initial, today);
  if (r.minStart && start < r.minStart) return 'Pick dates inside the months you chose.';
  if (r.maxEnd && end > r.maxEnd) return 'Pick dates inside the months you chose.';
  const len = rangeDays(start, end)!;
  if (r.minDays != null && r.maxDays != null && (len < r.minDays || len > r.maxDays)) {
    return `Pick ${r.minDays}-${r.maxDays} days.`;
  }
  return null;
}

export function datesPatch(start: string, end: string, initial: DatesInitial): DatesPatch {
  const months = [...initial.dateMonths].sort();
  return {
    start_date: start,
    end_date: end,
    dates_set_in_stone: true,
    date_months: months.length ? months : null,
    duration_days: rangeDays(start, end) ?? initial.durationDays ?? 1,
  };
}

/** The deadline rows a date change moves. Same fields the dashboard already
 *  reads in `fetchEditableRequirements`. */
export type DeadlineRow = {
  id: string;
  kind: string;
  skippable: boolean;
  daysBefore: number;
  isActive: boolean;
};

function formatDue(iso: string): string {
  const d = parseISO(iso)!;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * What a new start date does to the deadlines, in plain sentences, or '' when
 * there is nothing to say. Twin of the app's `describeDeadlineShift`:
 *
 *  · THE MONEY gets its own sentence with the date spelled out — a managed
 *    trip's `balance` row, or an offline trip's `offline_payment_due_days_before`.
 *  · THE PAPERWORK — every other active, skippable row, as a count. Must-have
 *    rows carry no deadline, so they never move.
 *
 * `requirements === undefined` (not loaded) is said out loud rather than read
 * as "nothing moves" — those are not the same claim.
 */
export function describeDeadlineShift(args: {
  currentStart: string | null;
  nextStart: string | null;
  paymentMode: string | null;
  offlineDaysBefore: number | null;
  requirements: DeadlineRow[] | undefined;
  today?: string;
}): string {
  const { currentStart, nextStart, paymentMode, offlineDaysBefore, requirements } = args;
  const today = args.today ?? todayISO();
  if (!nextStart || !currentStart || nextStart === currentStart) return '';
  if (requirements === undefined) return 'Deadline changes are still loading.';

  let inThePast = 0;
  const resolve = (daysBefore: number): string | null => {
    const due = resolveDeadlineISO(nextStart, daysBefore);
    if (due && due < today) inThePast += 1;
    return due;
  };

  const sentences: string[] = [];
  const balanceRow =
    paymentMode === 'managed'
      ? requirements.find(r => r.kind === 'balance' && r.isActive && r.skippable) ?? null
      : null;
  const offlineDays = paymentMode === 'offline' ? offlineDaysBefore : null;
  const payDue = balanceRow
    ? resolve(balanceRow.daysBefore)
    : offlineDays != null
      ? resolve(offlineDays)
      : null;
  if (payDue) sentences.push(`The final payment moves to ${formatDue(payDue)}.`);

  let docs = 0;
  for (const row of requirements) {
    if (!row.isActive || !row.skippable) continue;
    if (balanceRow && row.id === balanceRow.id) continue;
    if (resolve(row.daysBefore)) docs += 1;
  }
  if (docs > 0) {
    sentences.push(
      payDue
        ? `${docs} document ${docs === 1 ? 'deadline moves' : 'deadlines move'} with it.`
        : `${docs} ${docs === 1 ? 'deadline moves' : 'deadlines move'}.`,
    );
  }

  if (sentences.length === 0) return '';
  if (inThePast > 0) sentences.push(`${inThePast} ${inThePast === 1 ? 'lands' : 'land'} in the past.`);
  return sentences.join(' ');
}

/**
 * The "Change the dates?" confirm, or null when nobody needs telling.
 *
 * `notifyCount` is everyone `trg_notify_trip_dates_changed` writes a row for:
 * every non-host participant, onboarding included. "signed up", not "joined",
 * because that count includes people still accepting.
 */
export function datesConfirmMessage(notifyCount: number, shift: string): string | null {
  if (notifyCount === 0) return null;
  const first =
    `${notifyCount} ${notifyCount === 1 ? 'traveler' : 'travelers'} signed up on the old dates. ` +
    `We let ${notifyCount === 1 ? 'them' : 'them all'} know about the new ones.`;
  return [first, shift].filter(Boolean).join('\n\n');
}

/** The "Change where the trip goes?" confirm, or null when the trip is empty. */
export function destinationConfirmMessage(joinedCount: number): string | null {
  if (joinedCount === 0) return null;
  return (
    `${joinedCount} ${joinedCount === 1 ? 'traveler' : 'travelers'} joined for the old place. ` +
    'Make sure you tell them about this change.\n\nA visa requirement may no longer be right.'
  );
}

// ─── Getting paid ────────────────────────────────────────────────────────────

/** Twin of the app's `canCollectPayments`: an account Stripe is still
 *  reviewing may turn collection on; the charge itself is refused a layer down
 *  until it can really take money. */
export function canCollectPayments(state: ConnectState): boolean {
  return state === 'ready' || state === 'under_review' || state === 'action_needed';
}

/** Why "In Swellyo" cannot be saved yet, or null. Same order as the app. */
export function paymentModeBlocker(args: {
  next: PaymentMode;
  costPerPerson: number | null;
  connectLoading: boolean;
  connectState: ConnectState | null;
}): string | null {
  if (args.next !== 'managed') return null;
  if (args.costPerPerson == null) return 'Set a price per person before you collect payment in the app.';
  if (args.connectLoading || !args.connectState) return 'Checking your Stripe account…';
  if (canCollectPayments(args.connectState)) return null;
  if (args.connectState === 'blocked') {
    return 'Stripe could not approve your account, so this trip cannot collect payment.';
  }
  return 'Connect Stripe before you can collect payment in the app.';
}

export function paymentModeConfirm(next: PaymentMode): { title: string; message: string; confirmLabel: string } {
  return next === 'managed'
    ? {
        title: 'Collect payment in Swellyo?',
        message:
          'Travelers on this trip will be asked to pay by card. Everyone who already joined keeps the price the trip has right now.',
        confirmLabel: 'Turn on',
      }
    : {
        title: 'Stop collecting payment?',
        message:
          'Travelers will no longer be able to pay in the app. Payments already made stay recorded, and nothing is refunded.',
        confirmLabel: 'Turn off',
      };
}

export function offlineDeadlineLabel(days: number | null): string {
  if (days == null) return 'None';
  return days === 1 ? '1 day before the trip' : `${days} days before the trip`;
}

// ─── Destination (Google Places, New API) ────────────────────────────────────

export type DestinationGeo = {
  place_id: string | null;
  name: string | null;
  short_label: string | null;
  formatted_address: string | null;
  locality: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

type AddressComponent = { types?: string[]; longText?: string; shortText?: string };

/** City + ISO-2 country, with the app's fallback chain for the city:
 *  locality → sublocality → postal_town → admin_level_2. */
export function extractCityAndCountry(components: AddressComponent[]): {
  locality: string | null;
  country: string | null;
} {
  let locality: string | null = null;
  let sublocality: string | null = null;
  let postalTown: string | null = null;
  let adminL2: string | null = null;
  let country: string | null = null;
  for (const c of components ?? []) {
    const types = c.types ?? [];
    if (!c.longText && !c.shortText) continue;
    if (types.includes('locality')) locality = c.longText || null;
    else if (types.includes('sublocality_level_1') || types.includes('sublocality')) sublocality = c.longText || null;
    else if (types.includes('postal_town')) postalTown = c.longText || null;
    else if (types.includes('administrative_area_level_2')) adminL2 = c.longText || null;
    if (types.includes('country')) country = c.shortText || null;
  }
  return { locality: locality || sublocality || postalTown || adminL2, country };
}

/** A Places (New) details response → the row `group_trip_destinations` takes. */
export function destinationFromPlace(
  data: {
    id?: string;
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: AddressComponent[];
    displayName?: { text?: string };
  },
  fallback: { placeId: string; mainText: string; secondaryText: string },
): DestinationGeo {
  const { locality, country } = extractCityAndCountry(data.addressComponents ?? []);
  const name = data.displayName?.text || fallback.mainText;
  const short = locality && locality !== name ? `${name}, ${locality}` : name;
  return {
    place_id: data.id || fallback.placeId,
    name,
    short_label: short,
    formatted_address:
      data.formattedAddress ||
      `${fallback.mainText}${fallback.secondaryText ? ', ' + fallback.secondaryText : ''}`,
    locality,
    country,
    lat: typeof data.location?.latitude === 'number' ? data.location.latitude : null,
    lng: typeof data.location?.longitude === 'number' ? data.location.longitude : null,
  };
}

export function destinationLabel(
  d: { short_label?: string | null; name?: string | null; country?: string | null } | null | undefined,
): string | null {
  if (!d) return null;
  return d.short_label || d.name || d.country || null;
}

// ─── Number inputs ───────────────────────────────────────────────────────────

/** A whole number from a text field, or null for blank / not a number. */
export function parseWhole(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}
