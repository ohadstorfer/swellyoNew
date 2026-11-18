/**
 * Create an operator trip — the pure half.
 *
 * A port of the app's operator create flow (`src/screens/trips/CreateTripFlowA.tsx`
 * with hostingStyle 'C'), its validators (`services/trips/tripValidation.ts`),
 * price inclusions (`priceInclusions.ts`), itinerary cleaning (`itinerary.ts`) and
 * the USD conversion (`utils/currency.ts` fromTripCurrency). Nothing here talks to
 * the network; `services/createTrip.ts` does the writes, in the app's order.
 *
 * ⚠️ This is a COPY of app logic, not a shared module (the dashboard shares no
 * code with the app, see SPEC.md). When the app's wizard changes a default, a
 * validation or a column, change it here too.
 *
 * Images are plain strings: an `https://` URL is already uploaded, anything else
 * is a key into the page's in-memory picked-files map (`local:<id>`). That keeps
 * the state JSON-serialisable for the localStorage draft — and the same
 * remote-vs-local test the app does with `isRemoteUrl`.
 */
import { DEFAULT_TIMING, LOCKED_ON_KINDS, isPayKind, type EditableKind } from './catalog';
import type { CancellationPolicy } from './cancellation';

// ── Option lists (groupTripsService.ts + CreateTripFlowA.tsx) ───────────────

export type SurfLevel = 'beginner' | 'intermediate' | 'advanced' | 'pro' | 'all';
export type SurfStyle = 'shortboard' | 'midlength' | 'longboard' | 'softtop' | 'all';
export type WaveShapeKind = 'soft' | 'wally' | 'barrel';
export type TripStructureSlug =
  | 'shared_decisions'
  | 'structured_schedule'
  | 'loose_schedule'
  | 'book_own_stay'
  | 'book_together'
  | 'group_all_day'
  | 'own_thing_day';
export type TripVibeSlug = 'improve_surf' | 'surf_focused' | 'explore' | 'vacation';
export type AccommodationKind =
  | 'villa'
  | 'hostel'
  | 'hotel'
  | 'surfcamp'
  | 'bungalow'
  | 'apartment'
  | 'guesthouse'
  | 'ecolodge'
  | 'other';

export const SKILL_LEVEL_OPTIONS: { key: SurfLevel; label: string }[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

export const BOARD_TYPE_OPTIONS: { key: SurfStyle; label: string }[] = [
  { key: 'shortboard', label: 'Shortboard' },
  { key: 'midlength', label: 'Mid-length' },
  { key: 'softtop', label: 'Soft-top' },
  { key: 'longboard', label: 'Longboard' },
];

export const WAVE_SHAPE_OPTIONS: { key: WaveShapeKind; label: string }[] = [
  { key: 'soft', label: 'Soft' },
  { key: 'wally', label: 'Standing' },
  { key: 'barrel', label: 'Barrel' },
];
export const WAVE_SIZE_MIN = 1;
export const WAVE_SIZE_MAX = 12;
export const waveSizeLabel = (n: number): string =>
  n >= WAVE_SIZE_MAX ? `${WAVE_SIZE_MAX}+ ft` : `${n} ft`;

export const TRIP_STRUCTURE_OPTIONS: { slug: TripStructureSlug; label: string }[] = [
  { slug: 'shared_decisions', label: 'Shared decisions on activities and schedule' },
  { slug: 'structured_schedule', label: 'Structured daily schedule' },
  { slug: 'loose_schedule', label: 'Loose daily schedule' },
  { slug: 'book_own_stay', label: 'Book your own accommodation' },
  { slug: 'book_together', label: 'Accommodation booked together' },
  { slug: 'group_all_day', label: 'Group together most of the day' },
  { slug: 'own_thing_day', label: 'Do your own thing during the day' },
];

export const TRIP_STRUCTURE_MUTEX: [TripStructureSlug, TripStructureSlug][] = [
  ['structured_schedule', 'loose_schedule'],
  ['book_own_stay', 'book_together'],
  ['group_all_day', 'own_thing_day'],
];

export const TRIP_VIBE_OPTIONS: { slug: TripVibeSlug; label: string; intensity: number }[] = [
  { slug: 'improve_surf', label: 'Improve your surfing - training camp', intensity: 4 },
  { slug: 'surf_focused', label: 'Surf-focused - wake up early, surf a lot', intensity: 3 },
  { slug: 'explore', label: 'Surf + Explore', intensity: 2 },
  { slug: 'vacation', label: 'Vacation style - chill, loose surf, lay-days', intensity: 1 },
];

export const ACCOMMODATION_LABEL: Record<AccommodationKind, string> = {
  villa: 'Villa',
  hostel: 'Hostel',
  hotel: 'Hotel',
  surfcamp: 'Surf camp',
  bungalow: 'Bungalow',
  apartment: 'Apartment',
  guesthouse: 'Guesthouse',
  ecolodge: 'Eco lodge',
  other: 'Other',
};

export const JOIN_MODE_OPTIONS: { key: 'approval' | 'instant'; title: string; desc: string }[] = [
  {
    key: 'approval',
    title: 'I approve each traveler',
    desc: 'Travelers send a request. They pay after you approve them.',
  },
  {
    key: 'instant',
    title: 'Anyone can join right away',
    desc: 'No request. Travelers join and go straight to checkout.',
  },
];

/** StayGalleryStrip.tsx — extra stay photos after the main one. */
export const STAY_GALLERY_MAX = 9;

/** The four currencies operators price in (utils/currency.ts OPERATOR_CURRENCIES). */
export const OPERATOR_CURRENCIES = ['USD', 'ILS', 'EUR', 'GBP'] as const;
export type OperatorCurrency = (typeof OPERATOR_CURRENCIES)[number];

const COUNTRY_TO_OPERATOR_CURRENCY: Record<string, OperatorCurrency> = {
  Israel: 'ILS',
  'United Kingdom': 'GBP',
  ...Object.fromEntries(
    [
      'Austria', 'Belgium', 'Croatia', 'Cyprus', 'Estonia', 'Finland', 'France', 'Germany',
      'Greece', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta',
      'Netherlands', 'Portugal', 'Slovakia', 'Slovenia', 'Spain',
    ].map(c => [c, 'EUR' as const]),
  ),
};

export const CURRENCY_SYMBOL: Record<OperatorCurrency, string> = {
  USD: '$',
  ILS: '₪',
  EUR: '€',
  GBP: '£',
};

const isOperatorCurrency = (v: unknown): v is OperatorCurrency =>
  typeof v === 'string' && (OPERATOR_CURRENCIES as readonly string[]).includes(v);

/**
 * The currency the price is typed in. The operator's saved setting wins over the
 * country guess, clamped to the four operator currencies — same as the app's
 * `defaultOperatorCurrency` memo.
 */
export function defaultOperatorCurrency(
  saved: string | null | undefined,
  countryFrom: string | null | undefined,
): OperatorCurrency {
  if (isOperatorCurrency(saved)) return saved;
  return (countryFrom && COUNTRY_TO_OPERATOR_CURRENCY[countryFrom]) || 'USD';
}

/** Trip currency → USD, keeping cents. utils/currency.ts fromTripCurrency. */
export function fromTripCurrency(amount: number, rate: number): number {
  return Math.round((amount / rate) * 100) / 100;
}

/** An amount the operator typed, stored in USD. Null stays null. */
export function toUsd(
  amount: number | null,
  currency: OperatorCurrency,
  rate: number | null,
): number | null {
  if (amount == null || currency === 'USD' || rate == null) return amount;
  return fromTripCurrency(amount, rate);
}

// ── Price inclusions (priceInclusions.ts) ───────────────────────────────────

export const MEALS_OPTIONS = [
  { slug: 'breakfast', label: 'Breakfast' },
  { slug: 'lunch', label: 'Lunch' },
  { slug: 'dinner', label: 'Dinner' },
] as const;
export const ACCOMMODATION_INCL_OPTIONS = [
  { slug: 'private_room', label: 'Private room' },
  { slug: 'shared_room', label: 'Shared room' },
] as const;
export const TRANSPORTATION_OPTIONS = [
  { slug: 'intl_flights', label: 'International flights' },
  { slug: 'airport_transfer', label: 'Transport from airport to stay' },
  { slug: 'surf_transport', label: 'Transport to the surf and back' },
  { slug: 'local_transport', label: 'Local transport (scooter / bike)' },
] as const;
export const SURF_SESSIONS_OPTIONS = [
  { slug: 'escorting', label: 'Surf escorting' },
  { slug: 'locals', label: 'Surf escort by locals' },
  { slug: 'guidance_lessons', label: 'Surf guidance and lessons' },
] as const;
export const SURF_EQUIPMENT_OPTIONS = [
  { slug: 'board', label: 'Board' },
  { slug: 'wetsuit', label: 'Wetsuit' },
  { slug: 'surf_shirt', label: 'Surf shirt' },
  { slug: 'sunscreen', label: 'Sunscreen' },
  { slug: 'wax', label: 'Wax supply' },
] as const;
export const SURF_FILM_MEDIA_OPTIONS = [
  { slug: 'video', label: 'Video' },
  { slug: 'photo', label: 'Photo' },
] as const;
export const SURF_FILM_TYPE_OPTIONS = [
  { slug: 'telephoto', label: 'Telephoto' },
  { slug: 'in_water', label: 'In-water' },
  { slug: 'drone', label: 'Drone' },
] as const;
export const ACTIVITIES_OPTIONS = [
  { slug: 'day_tours', label: 'Day tours' },
  { slug: 'cultural', label: 'Cultural experiences' },
  { slug: 'nature', label: 'Nature trips' },
  { slug: 'nightlife', label: 'Nightlife / social' },
] as const;
export const WELLNESS_OPTIONS = [
  { slug: 'yoga', label: 'Yoga' },
  { slug: 'massage', label: 'Massage' },
  { slug: 'mobility', label: 'Mobility & stretching' },
  { slug: 'ice_bath', label: 'Ice bath / cold plunge' },
  { slug: 'sauna', label: 'Sauna' },
  { slug: 'breathwork', label: 'Breathwork' },
  { slug: 'meditation', label: 'Meditation' },
  { slug: 'sound_healing', label: 'Sound healing' },
  { slug: 'physio', label: 'Physio / recovery sessions' },
  { slug: 'nutrition', label: 'Nutrition guidance' },
  { slug: 'pilates', label: 'Pilates' },
  { slug: 'spa', label: 'Spa access' },
  { slug: 'thermal', label: 'Thermal baths / hot springs' },
  { slug: 'acupuncture', label: 'Acupuncture' },
  { slug: 'personal_training', label: 'Personal training' },
  { slug: 'gym', label: 'Gym access' },
  { slug: 'reiki', label: 'Reiki / energy work' },
] as const;

export interface SurfFilmInclusion {
  media?: string[];
  count?: number | null;
  filmTypes?: string[];
}
export interface VideoAnalysisInclusion {
  included?: boolean;
  count?: number | null;
}
export interface ActivityInclusion {
  key: string;
  note?: string;
}
export type WellnessPayment = 'included' | 'extra';
export interface WellnessInclusion {
  key: string;
  payment: WellnessPayment;
}
export interface CustomInclusion {
  title: string;
  description?: string;
}
export interface PriceInclusions {
  meals?: string[];
  accommodation?: string[];
  transportation?: string[];
  surfSessions?: string[];
  surfEquipment?: string[];
  surfFilm?: SurfFilmInclusion;
  videoAnalysis?: VideoAnalysisInclusion;
  activities?: ActivityInclusion[];
  wellness?: WellnessInclusion[];
  custom?: CustomInclusion[];
}

export const CATEGORY_TITLE: Record<keyof PriceInclusions, string> = {
  meals: 'Meals',
  accommodation: 'Accommodation',
  transportation: 'Transportation',
  surfSessions: 'Surf sessions',
  surfEquipment: 'Surf equipment',
  surfFilm: 'Filmed surf sessions',
  videoAnalysis: 'Video analysis',
  activities: 'Activities & excursions',
  wellness: 'Wellness & recovery',
  custom: 'Other',
};

export const CATEGORY_ORDER: (keyof PriceInclusions)[] = [
  'meals',
  'accommodation',
  'transportation',
  'surfSessions',
  'surfEquipment',
  'surfFilm',
  'videoAnalysis',
  'activities',
  'wellness',
];

/** Plain multi-select categories (a list of slugs). */
export const TAG_CATEGORIES = {
  meals: MEALS_OPTIONS,
  accommodation: ACCOMMODATION_INCL_OPTIONS,
  transportation: TRANSPORTATION_OPTIONS,
  surfSessions: SURF_SESSIONS_OPTIONS,
  surfEquipment: SURF_EQUIPMENT_OPTIONS,
} as const;

function customItemLine(c: CustomInclusion): string {
  const t = c.title.trim();
  const d = c.description?.trim();
  return t && d ? `${t} - ${d}` : t || d || '';
}

export function hasCategoryValue(
  inc: PriceInclusions | null | undefined,
  key: keyof PriceInclusions,
): boolean {
  if (!inc) return false;
  const v = inc[key];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (key === 'surfFilm') {
    const f = v as SurfFilmInclusion;
    return !!(f.media?.length || f.count != null || f.filmTypes?.length);
  }
  if (key === 'videoAnalysis') return !!(v as VideoAnalysisInclusion).included;
  return false;
}

/** Null when nothing is filled in — the app stores NULL, never `{}`. */
export function normalizePriceInclusions(
  inc: PriceInclusions | null | undefined,
): PriceInclusions | null {
  if (!inc) return null;
  const hasCustom = (inc.custom ?? []).some(c => customItemLine(c).length > 0);
  const anyValue = CATEGORY_ORDER.some(k => hasCategoryValue(inc, k)) || hasCustom;
  return anyValue ? inc : null;
}

// ── Itinerary (itinerary.ts) ────────────────────────────────────────────────

export const MAX_DAY_PHOTOS = 6;
export const MAX_DAY_TITLE_LENGTH = 30;

export interface ItineraryActivity {
  time: string | null;
  name: string;
  place: string | null;
}
export interface ItineraryDay {
  day: number;
  title: string;
  photos: string[];
  photoRatios?: Record<string, number>;
  activities: ItineraryActivity[];
}

export const emptyDay = (day: number): ItineraryDay => ({ day, title: '', photos: [], activities: [] });

const parseDay = (iso: string | null | undefined): Date | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export const tripCalendarDays = (
  startISO: string | null | undefined,
  endISO: string | null | undefined,
): number => {
  const start = parseDay(startISO);
  const end = parseDay(endISO);
  if (!start || !end) return 0;
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return days > 0 ? days : 0;
};

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const dayLabel = (startISO: string | null | undefined, day: number): string => {
  const start = parseDay(startISO);
  if (!start) return `Day ${day}`;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day - 1);
  return `Day ${day} · ${WEEKDAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
};

export const isDayPlanned = (day: ItineraryDay): boolean => day.title.trim().length > 0;

export const dayHasContent = (day: ItineraryDay): boolean =>
  isDayPlanned(day) || day.photos.length > 0 || day.activities.some(a => a.name.trim().length > 0);

const byTime = (a: ItineraryActivity, b: ItineraryActivity): number => {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.time) return -1;
  return b.time ? 1 : 0;
};

export const cleanDay = (day: ItineraryDay): ItineraryDay => {
  const photos = day.photos.slice(0, MAX_DAY_PHOTOS);
  const kept = photos.filter(uri => day.photoRatios?.[uri] != null);
  const { photoRatios: _drop, ...rest } = day;
  return {
    ...rest,
    title: day.title.trim(),
    photos,
    ...(kept.length > 0
      ? { photoRatios: Object.fromEntries(kept.map(uri => [uri, day.photoRatios![uri]])) }
      : {}),
    activities: day.activities
      .map(a => ({ ...a, name: a.name.trim(), place: a.place?.trim() || null }))
      .filter(a => a.name.length > 0)
      .sort(byTime),
  };
};

export const upsertDay = (days: ItineraryDay[], next: ItineraryDay): ItineraryDay[] => {
  const rest = days.filter(d => d.day !== next.day);
  const cleaned = cleanDay(next);
  return (dayHasContent(cleaned) ? [...rest, cleaned] : rest).sort((a, b) => a.day - b.day);
};

/** What is published: only days with a title, cleaned, in order. */
export const cleanItinerary = (days: ItineraryDay[]): ItineraryDay[] =>
  days.map(cleanDay).filter(isDayPlanned).sort((a, b) => a.day - b.day);

export const isRemoteUrl = (uri: string | null | undefined): boolean =>
  !!uri && /^https?:\/\//i.test(uri);

/** Swap each local photo for its uploaded URL, carrying the ratio across. */
export async function uploadItineraryPhotos(
  days: ItineraryDay[],
  upload: (uri: string) => Promise<string>,
): Promise<ItineraryDay[]> {
  const out: ItineraryDay[] = [];
  for (const day of days) {
    const photos: string[] = [];
    const ratios: Record<string, number> = {};
    for (const uri of day.photos) {
      const url = isRemoteUrl(uri) ? uri : await upload(uri);
      photos.push(url);
      const ratio = day.photoRatios?.[uri];
      if (ratio != null) ratios[url] = ratio;
    }
    const { photoRatios: _drop, ...rest } = day;
    out.push({ ...rest, photos, ...(Object.keys(ratios).length > 0 ? { photoRatios: ratios } : {}) });
  }
  return out;
}

// ── Wizard state ────────────────────────────────────────────────────────────

export type StepKey =
  | 'audience'
  | 'basics'
  | 'vibez'
  | 'budget'
  | 'aboutYou'
  | 'requirements'
  | 'itinerary'
  | 'preview';

/** Flow C, create mode: STEPS_BASE with aboutYou, requirements, itinerary before preview. */
export const STEPS: StepKey[] = [
  'audience',
  'basics',
  'vibez',
  'budget',
  'aboutYou',
  'requirements',
  'itinerary',
  'preview',
];

export const STEP_META: Record<StepKey, { title: string; subtitle: string }> = {
  audience: { title: 'Who is it for?', subtitle: 'The surfers, the levels, the wave.' },
  basics: { title: 'Trip details', subtitle: 'Where, when, what to call it.' },
  vibez: { title: 'Trip Vibe', subtitle: 'How it runs, the feel, the stay.' },
  budget: { title: 'Pricing', subtitle: 'Per person, and what it includes.' },
  aboutYou: { title: 'About you', subtitle: 'What travelers read about the person running it.' },
  requirements: {
    title: 'What travelers must send',
    subtitle: 'So you can book flights and organise the trip.',
  },
  itinerary: { title: 'Trip itinerary', subtitle: 'What each day looks like.' },
  preview: { title: 'Preview', subtitle: 'How your trip will look.' },
};

export type RequirementTiming = { skippable: boolean; daysBefore: number };

/** The place picked in the destination search (HomeBreakSelection). */
export interface DestinationGeo {
  placeId: string;
  full: string;
  short: string;
  name: string;
  locality: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export type AudienceCardKey = 'levels' | 'boards' | 'wave' | 'age';
export const AUDIENCE_REQUIRED: AudienceCardKey[] = ['levels', 'boards', 'wave'];

/** Document kinds an operator trip is seeded with (ONBOARDING_REQUIREMENT_SPEC minus pay kinds). */
export const FIXED_DOCUMENT_KINDS: EditableKind[] = ['waiver', 'medical', 'insurance', 'passport', 'flights', 'visa'];

export const WIZARD_STATE_VERSION = 1;

export interface WizardState {
  version: number;
  // audience
  ageMin: string;
  ageMax: string;
  skillLevels: SurfLevel[];
  waveShape: WaveShapeKind | null;
  waveSizeMin: number;
  waveSizeMax: number;
  surfStyles: SurfStyle[];
  /** Which audience cards the operator has looked at (the app's `audienceDone`). */
  audienceDone: AudienceCardKey[];
  // basics
  destination: string;
  destinationGeo: DestinationGeo | null;
  startDateISO: string | null;
  endDateISO: string | null;
  title: string;
  heroImage: string | null;
  description: string;
  maxParticipants: string;
  // vibez
  tripStructure: TripStructureSlug[];
  tripVibes: TripVibeSlug[];
  accommodationKind: AccommodationKind | null;
  accommodationName: string;
  accommodationUrl: string;
  accommodationImage: string | null;
  accommodationGallery: string[];
  stokeCertified: boolean;
  ciSurfConservation: boolean;
  // budget
  currency: OperatorCurrency | null;
  costPerPerson: string;
  privateRoomPrice: string;
  joinMode: 'approval' | 'instant';
  priceInclusions: PriceInclusions;
  paymentMode: 'offline' | 'managed';
  depositAmount: string;
  /** undefined = the operator's default policy. */
  cancellation?: CancellationPolicy;
  // aboutYou
  hostLeadNote: string;
  // requirements
  requirementKinds: EditableKind[];
  requirementTiming: Record<string, RequirementTiming>;
  /** Display only. The File itself lives in memory; a restored draft has none. */
  waiverFileName: string | null;
  suggestedPackingOn: boolean;
  suggestedPacking: string[];
  // itinerary
  itinerary: ItineraryDay[];
}

export const INITIAL_STATE: WizardState = {
  version: WIZARD_STATE_VERSION,
  ageMin: '',
  ageMax: '',
  skillLevels: ['beginner', 'intermediate', 'advanced'],
  waveShape: 'soft',
  waveSizeMin: 2,
  waveSizeMax: 4,
  surfStyles: ['shortboard', 'midlength', 'softtop', 'longboard'],
  audienceDone: [],
  destination: '',
  destinationGeo: null,
  startDateISO: null,
  endDateISO: null,
  title: '',
  heroImage: null,
  description: '',
  maxParticipants: '',
  tripStructure: [],
  tripVibes: [],
  accommodationKind: null,
  accommodationName: '',
  accommodationUrl: '',
  accommodationImage: null,
  accommodationGallery: [],
  stokeCertified: false,
  ciSurfConservation: false,
  currency: null,
  costPerPerson: '',
  privateRoomPrice: '',
  joinMode: 'approval',
  priceInclusions: {},
  paymentMode: 'offline',
  depositAmount: '',
  hostLeadNote: '',
  requirementKinds: [...FIXED_DOCUMENT_KINDS],
  requirementTiming: { ...DEFAULT_TIMING },
  waiverFileName: null,
  suggestedPackingOn: false,
  suggestedPacking: [],
  itinerary: [],
};

/** Toggle a structure tag, dropping its mutually-exclusive partner. */
export function toggleStructure(
  current: TripStructureSlug[],
  slug: TripStructureSlug,
): TripStructureSlug[] {
  if (current.includes(slug)) return current.filter(s => s !== slug);
  const partners = TRIP_STRUCTURE_MUTEX.filter(p => p.includes(slug)).flat();
  return [...current.filter(s => !partners.includes(s)), slug];
}

// ── Validation (tripValidation.ts + validateStep) ───────────────────────────

const MIN_AGE = 16;
const MAX_AGE = 99;
export const AGE_WINDOW = 4;
export const MIN_SPOTS = 2;
export const MAX_SPOTS = 50;

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

export function validateExactDates(start: string | null, end: string | null): string | null {
  if (!start || !end) return 'Pick the trip dates.';
  if (end < start) return 'The end date has to be on or after the start date.';
  return null;
}

export function validateStay(name: string, url: string, image: string | null): string | null {
  if (!name.trim()) return 'Add the name of the stay.';
  if (!url.trim()) return 'Add a link to the stay.';
  if (!image?.trim()) return 'Add a photo of the stay.';
  return null;
}

export function validatePrice(costPerPerson: number | null): string | null {
  if (costPerPerson == null) return 'Set the price per person.';
  if (costPerPerson <= 0) return 'The price has to be more than 0.';
  return null;
}

export function validateDeposit(deposit: number | null, costPerPerson: number | null): string | null {
  if (deposit == null) return null;
  if (deposit < 0) return 'The deposit has to be zero or more.';
  if (costPerPerson == null) return null;
  if (deposit > costPerPerson) return 'The deposit cannot be more than the price.';
  return null;
}

/** parseInt the way the wizard does: blank → null, garbage → NaN → null. */
export function intOrNull(raw: string): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Only a positive number counts — "0" means "none", same as blank. */
const positiveOrNull = (raw: string): number | null => {
  const n = intOrNull(raw);
  return n != null && n > 0 ? n : null;
};

export type FieldKey =
  | 'audience'
  | 'age'
  | 'skill'
  | 'waveShape'
  | 'destination'
  | 'when'
  | 'title'
  | 'heroImage'
  | 'description'
  | 'accommodationKind'
  | 'specificStay'
  | 'price'
  | 'privatePrice'
  | 'deposit'
  | 'waiver';

export type FieldErrors = Partial<Record<FieldKey, string>>;

export interface ValidateContext {
  connect: { loading: boolean; canCollect: boolean; blocked: boolean };
  hasDefaultWaiver: boolean;
  hasWaiverFile: boolean;
}

/** Per-step validation. Empty object = the step may advance. */
export function validateStep(step: StepKey, s: WizardState, ctx: ValidateContext): FieldErrors {
  const e: FieldErrors = {};
  switch (step) {
    case 'audience': {
      if (!AUDIENCE_REQUIRED.every(k => s.audienceDone.includes(k))) {
        e.audience = 'Set surf level, board style and the wave to continue';
      }
      const age = validateAgeRange(intOrNull(s.ageMin), intOrNull(s.ageMax));
      if (age) e.age = age;
      if (s.skillLevels.length === 0) e.skill = 'Pick at least one skill level';
      if (s.waveShape === null) e.waveShape = 'Pick a wave shape';
      return e;
    }
    case 'basics': {
      if (!s.destination.trim()) e.destination = 'Pick a destination for your trip';
      const dates = validateExactDates(s.startDateISO, s.endDateISO);
      if (dates) e.when = dates;
      if (!s.title.trim()) e.title = 'Your trip needs a name';
      if (!s.heroImage) e.heroImage = 'Add a cover photo to publish your trip';
      if (!s.description.trim()) e.description = 'Add a description so people know what to expect';
      return e;
    }
    case 'vibez': {
      if (!s.accommodationKind) e.accommodationKind = 'Pick an accommodation type';
      const stay = validateStay(s.accommodationName, s.accommodationUrl, s.accommodationImage);
      if (stay) e.specificStay = stay;
      return e;
    }
    case 'budget': {
      const priceError = validatePrice(intOrNull(s.costPerPerson));
      if (priceError) e.price = priceError;
      const rawPrivate = intOrNull(s.privateRoomPrice);
      if (rawPrivate != null) {
        const privateError = rawPrivate <= 0 ? 'Enter a price, or leave it blank' : validatePrice(rawPrivate);
        if (privateError) e.privatePrice = privateError;
      }
      if (s.paymentMode === 'managed') {
        // The app returns at the first payment problem; one message is enough.
        if (ctx.connect.loading) {
          e.deposit = 'Checking your Stripe account…';
          return e;
        }
        if (!ctx.connect.canCollect) {
          e.deposit = ctx.connect.blocked
            ? 'Stripe could not approve your account, so this trip cannot collect payment.'
            : 'Connect Stripe before collecting payment in the app.';
          return e;
        }
        const dep = positiveOrNull(s.depositAmount);
        const depositError = validateDeposit(dep, intOrNull(s.costPerPerson));
        if (depositError) {
          e.deposit = depositError;
          return e;
        }
        const priv = positiveOrNull(s.privateRoomPrice);
        if (dep != null && priv != null && dep > priv) {
          e.deposit = 'The deposit can’t be more than the private room price';
        }
      }
      return e;
    }
    case 'requirements': {
      if (!ctx.hasWaiverFile && !ctx.hasDefaultWaiver) {
        e.waiver = 'Upload your waiver PDF — travelers cannot join the trip until they can agree to it';
      }
      return e;
    }
    case 'aboutYou':
    case 'itinerary':
    case 'preview':
      return e;
  }
}

/** First step (in order) that fails, for "Publish" from the preview. */
export function firstInvalidStep(s: WizardState, ctx: ValidateContext): StepKey | null {
  for (const step of STEPS) {
    if (Object.keys(validateStep(step, s, ctx)).length > 0) return step;
  }
  return null;
}

/** Canonical Stripe gate — services/trips/connectStatus.ts canCollectPayments. */
export function canCollectPayments(state: string): boolean {
  return state === 'ready' || state === 'under_review' || state === 'action_needed';
}

// ── Requirements derivation (handleSubmit) ──────────────────────────────────

/**
 * Every requirement row the trip is created with: the pay kinds the budget step
 * implies, the toggled document kinds, and the locked-on waiver. Deduped, as the
 * app does with a Set.
 */
export function requirementKindsToCreate(s: WizardState): EditableKind[] {
  const payKinds: EditableKind[] =
    s.paymentMode === 'managed'
      ? positiveOrNull(s.depositAmount) != null
        ? ['deposit', 'balance']
        : ['balance']
      : [];
  const docs = s.requirementKinds.filter(k => !isPayKind(k));
  return Array.from(new Set([...payKinds, ...docs, ...LOCKED_ON_KINDS]));
}

// ── The INSERT (handleSubmit, create branch, isFixedFlow) ───────────────────

export interface UploadedMedia {
  heroUrl: string;
  accommodationImageUrl: string | null;
  galleryUrls: string[];
  itinerary: ItineraryDay[];
}

/**
 * The `group_trips` row, column for column what the app inserts for a Flow C
 * trip. `rate` is units of `currency` per 1 USD (1 for USD), frozen into
 * `budget_fx_rate`; every amount is stored in USD.
 */
export function buildTripInsert(
  s: WizardState,
  args: {
    currency: OperatorCurrency;
    rate: number;
    policy: CancellationPolicy;
    rulesWire: unknown[];
    media: UploadedMedia;
  },
): Record<string, unknown> {
  const { currency, rate, policy, rulesWire, media } = args;
  const fixedPrice = toUsd(intOrNull(s.costPerPerson), currency, rate);
  const rawDeposit = s.paymentMode === 'managed' ? positiveOrNull(s.depositAmount) : null;
  const depositUsd = toUsd(rawDeposit, currency, rate);
  const privateUsd = toUsd(positiveOrNull(s.privateRoomPrice), currency, rate);
  const balanceDue = Math.max(
    0,
    Math.round((s.requirementTiming.balance ?? DEFAULT_TIMING.balance).daysBefore),
  );

  return {
    hosting_style: 'C',
    status: 'active',
    title: s.title.trim() || null,
    description: s.description.trim(),
    hero_image_url: media.heroUrl,

    start_date: s.startDateISO,
    end_date: s.endDateISO,
    dates_set_in_stone: true,
    date_months: null,
    duration_days: null,
    max_participants: s.maxParticipants ? parseInt(s.maxParticipants, 10) : null,

    accommodation_type: s.accommodationKind ? [s.accommodationKind] : null,
    accommodation_name: s.accommodationName.trim() || null,
    accommodation_url: s.accommodationUrl.trim() || null,
    accommodation_image_url: media.accommodationImageUrl,
    ...(media.galleryUrls.length > 0 ? { accommodation_gallery_urls: media.galleryUrls } : {}),

    age_min: intOrNull(s.ageMin),
    age_max: intOrNull(s.ageMax),
    target_surf_levels: s.skillLevels.length ? s.skillLevels : ['all'],
    target_surf_styles: s.surfStyles.length ? s.surfStyles : ['all'],
    wave_shapes: s.waveShape ? [s.waveShape] : null,
    wave_size_min: s.waveSizeMin,
    wave_size_max: s.waveSizeMax,

    budget_min: null,
    budget_max: null,
    budget_currency: currency,
    budget_fx_rate: rate,
    budget_tier: null,

    trip_structure: s.tripStructure.length ? s.tripStructure : null,
    trip_vibes: s.tripVibes.length ? s.tripVibes : null,
    cost_per_person: fixedPrice,
    price_inclusions: normalizePriceInclusions(s.priceInclusions),
    payment_mode: s.paymentMode,
    private_room_price_usd: privateUsd,
    join_mode: s.joinMode === 'instant' ? 'instant' : 'approval',
    deposit_amount: s.paymentMode === 'managed' ? depositUsd : null,
    offline_payment_due_days_before: s.paymentMode === 'offline' ? balanceDue : null,

    cancellation_preset: policy.preset,
    cancellation_rules: rulesWire,
    cancellation_notes: policy.notes,

    specific_stay_selected: true,
    stoke_certified: s.stokeCertified,
    ci_surf_conservation: s.ciSurfConservation,
    host_destination_familiarity: null,
    host_stay_familiarity: null,
    host_lead_note: s.hostLeadNote.trim() || null,
    visibility: 'public',

    personal_gear_host_suggestion: s.suggestedPackingOn
      ? s.suggestedPacking.map(n => n.trim()).filter(Boolean)
      : [],

    ...(media.itinerary.length > 0 ? { itinerary: media.itinerary } : {}),
  };
}

/** `group_trip_destinations` row from the picked place (setTripDestination). */
export function destinationRow(g: DestinationGeo): Record<string, unknown> {
  return {
    place_id: g.placeId ?? null,
    name: g.name ?? null,
    short_label: g.short ?? null,
    formatted_address: g.full ?? null,
    locality: g.locality ?? null,
    country: g.country ?? null,
    lat: g.lat ?? null,
    lng: g.lng ?? null,
  };
}

// ── Draft (useTripWizardDraft) ──────────────────────────────────────────────

/**
 * Restore a saved draft. Anything not shaped like this version's state is
 * thrown away rather than half-loaded. Local (unuploaded) images cannot survive
 * a reload — their bytes were only ever in memory — so they are dropped here and
 * the operator picks them again.
 */
export function restoreDraft(raw: unknown): WizardState | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<WizardState>;
  if (d.version !== WIZARD_STATE_VERSION) return null;
  const merged: WizardState = { ...INITIAL_STATE, ...d };
  const keep = (u: string | null) => (isRemoteUrl(u) ? u : null);
  return {
    ...merged,
    heroImage: keep(merged.heroImage),
    accommodationImage: keep(merged.accommodationImage),
    accommodationGallery: merged.accommodationGallery.filter(isRemoteUrl),
    itinerary: merged.itinerary.map(day => ({ ...day, photos: day.photos.filter(isRemoteUrl) })),
    waiverFileName: null,
  };
}

/** True once the operator has entered anything worth keeping. */
export function isDraftWorthKeeping(s: WizardState): boolean {
  return (
    s.audienceDone.length > 0 ||
    !!s.destination.trim() ||
    !!s.title.trim() ||
    !!s.description.trim() ||
    !!s.costPerPerson
  );
}
