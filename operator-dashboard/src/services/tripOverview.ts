/**
 * The trip Overview — everything a traveler reads about a trip in the app's
 * Overview tab, for the web.
 *
 * Source of truth: the app's `TripDetailViewRedesigned.tsx` and the VM that
 * `TripDetailScreen.tsx` builds for it (`buildTripDetailVM`, the `aboutHost`
 * object, `useTripCrew`). The pure label helpers below are ports of the app's
 * `TripDetailView.tsx`, `priceInclusions.ts` and `itinerary.ts`. This project
 * shares no code with the app, so they are copied, not imported — keep the two
 * honest with each other.
 *
 * `TripOverviewData` is a plain object on purpose: the create-trip wizard's
 * preview step can build one from form state and hand it to the same
 * component, with no query behind it.
 *
 * Rule 1 holds: no table, no function, no migration. Every read below was
 * already live and permitted — `group_trips` is readable by any signed-in user,
 * the roster and `organized_trip_staff` by anyone on the trip, `surfers`
 * profiles by any signed-in user.
 */
import { supabase } from '../lib/supabase';
import { toNumber } from '../domain/money';
import { fetchStaffRoles } from './staff';

// ─────────────────────────────────────────────────────────────────────────────
// The data the Overview renders
// ─────────────────────────────────────────────────────────────────────────────

export type ItineraryActivity = {
  /** "HH:mm", 24h. Null = no set time. */
  time: string | null;
  name: string;
  place: string | null;
};

export type ItineraryDay = {
  /** 1-based, not a date. */
  day: number;
  title: string;
  photos: string[];
  activities: ItineraryActivity[];
};

/** "What's included" — the `group_trips.price_inclusions` JSONB, as the app writes it. */
export type PriceInclusions = {
  meals?: string[];
  accommodation?: string[];
  transportation?: string[];
  surfSessions?: string[];
  surfEquipment?: string[];
  surfFilm?: { media?: string[]; count?: number | null; filmTypes?: string[] };
  videoAnalysis?: { included?: boolean; count?: number | null };
  activities?: { key: string; note?: string }[];
  wellness?: ({ key: string; payment: 'included' | 'extra' } | string)[];
  custom?: { title: string; description?: string }[];
};

export type OverviewPerson = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

/** The person shown in the top card and in "About <host>". */
export type OverviewHost = OverviewPerson & {
  age: number | null;
  countryFrom: string | null;
  /** Slug: beginner | intermediate | advanced | pro. */
  surfLevel: string | null;
  /** Slug: shortboard | midlength | longboard | softtop | ... */
  surfboardType: string | null;
  /** `surfers.travel_experience` — the "N Surf Trips" chip. */
  surfTrips: number | null;
};

export type OverviewCrewMember = {
  id: string;
  name: string;
  /** What they do on the trip: "Head guide". Free text. */
  title: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** Tier. Only 'operator' is read, to ring the person running the trip. */
  roleKey: string;
  countryFrom: string | null;
  /** A real Swellyo account, not a Listed name-and-photo credit. */
  hasAccount: boolean;
  /** Counted by the "Local Crew" card. */
  isLocal: boolean;
};

export type TripOverviewData = {
  title: string | null;
  destinationLabel: string | null;
  /** Cover first. Two or more swipe sideways. Max 10 shown. */
  coverUrls: string[];

  startDate: string | null;
  endDate: string | null;
  /** ["YYYY-MM", ...] — month-only trips. */
  dateMonths: string[] | null;
  durationDays: number | null;

  /** 'A' planned together, 'B' captain, 'C' trip operator. */
  hostingStyle: string | null;

  skillLevels: string[];
  ageMin: number | null;
  ageMax: number | null;
  participantCount: number;
  maxParticipants: number | null;

  description: string;
  /** First selected vibe slug. */
  vibeSlug: string | null;
  surfStyles: string[];
  waveSizeMin: number | null;
  waveSizeMax: number | null;
  /** First wave shape slug: soft | wally | barrel. */
  waveShape: string | null;

  specificStaySelected: boolean | null;
  /** First `accommodation_type` slug, e.g. 'surf_camp'. */
  accommodationKind: string | null;
  accommodationName: string | null;
  accommodationUrl: string | null;
  accommodationImageUrl: string | null;
  accommodationGalleryUrls: string[];
  /** No data source yet in the app either; each shows only when set. */
  accommodationLogoUrl?: string | null;
  accommodationVerified?: boolean | null;
  ciSurfConservation: boolean;
  stokeCertified: boolean;

  /** USD. */
  costPerPerson: number | null;
  priceInclusions: PriceInclusions | null;
  budgetMin: number | null;
  budgetMax: number | null;
  /** The currency the operator typed the price in, and the rate frozen then. */
  budgetCurrency: string | null;
  budgetFxRate: number | null;

  itinerary: ItineraryDay[];

  host: OverviewHost | null;
  /** `group_trips.host_lead_note` — the "About <host>" bio. */
  hostBio: string | null;
  hostDestinationFamiliarity: string | null;
  hostStayFamiliarity: string | null;

  crew: OverviewCrewMember[];
  participants: OverviewPerson[];
};

// ─────────────────────────────────────────────────────────────────────────────
// The read
// ─────────────────────────────────────────────────────────────────────────────

const TRIP_COLUMNS = [
  'id', 'host_id', 'hosting_style', 'title', 'description', 'hero_image_url',
  'start_date', 'end_date', 'date_months', 'duration_days',
  'max_participants', 'participant_count',
  'age_min', 'age_max', 'target_surf_levels', 'target_surf_styles',
  'wave_shapes', 'wave_size_min', 'wave_size_max', 'trip_vibes',
  'specific_stay_selected', 'accommodation_type', 'accommodation_name',
  'accommodation_url', 'accommodation_image_url', 'accommodation_gallery_urls',
  'stoke_certified', 'ci_surf_conservation',
  'cost_per_person', 'price_inclusions',
  'budget_min', 'budget_max', 'budget_currency', 'budget_fx_rate',
  'host_lead_note', 'host_destination_familiarity', 'host_stay_familiarity',
  'itinerary',
  'destination:group_trip_destinations(name, short_label, country)',
].join(', ');

/** Present members only — a departed traveler keeps the row as 'left'/'removed'. */
const PRESENT_STATUSES = ['onboarding', 'active'];

/** Most senior first, so a traveler meets the person running the trip first. */
const TIER_DESC = ['operator', 'co_operator', 'manager', 'guide', 'crew', 'listed'];

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

export async function fetchTripOverview(tripId: string): Promise<TripOverviewData> {
  const { data: trip, error } = await supabase
    .from('group_trips')
    .select(TRIP_COLUMNS)
    .eq('id', tripId)
    .maybeSingle();
  if (error) throw error;
  if (!trip) throw new Error('Trip not found');
  const t = trip as any;

  const [people, crew] = await Promise.all([
    fetchPeople(tripId),
    // The app reads the crew on operator trips only.
    t.hosting_style === 'C' ? fetchShownCrew(tripId) : Promise.resolve([]),
  ]);

  // Embedded one-to-one: PostgREST returns an object, or an array on older
  // relationship metadata. Take either.
  const dest = Array.isArray(t.destination) ? t.destination[0] : t.destination;
  const hero = typeof t.hero_image_url === 'string' && t.hero_image_url ? [t.hero_image_url] : [];

  return {
    title: t.title ?? null,
    destinationLabel: dest?.short_label || dest?.name || dest?.country || null,
    coverUrls: hero,
    startDate: t.start_date ?? null,
    endDate: t.end_date ?? null,
    dateMonths: Array.isArray(t.date_months) ? strArr(t.date_months) : null,
    durationDays: toNumber(t.duration_days),
    hostingStyle: t.hosting_style ?? null,
    skillLevels: strArr(t.target_surf_levels),
    ageMin: toNumber(t.age_min),
    ageMax: toNumber(t.age_max),
    participantCount: people.participants.length || toNumber(t.participant_count) || 1,
    maxParticipants: toNumber(t.max_participants),
    description: t.description ?? '',
    vibeSlug: strArr(t.trip_vibes)[0] ?? null,
    surfStyles: strArr(t.target_surf_styles),
    waveSizeMin: toNumber(t.wave_size_min),
    waveSizeMax: toNumber(t.wave_size_max),
    waveShape: strArr(t.wave_shapes)[0] ?? null,
    specificStaySelected: t.specific_stay_selected ?? null,
    accommodationKind: strArr(t.accommodation_type)[0] ?? null,
    accommodationName: t.accommodation_name ?? null,
    accommodationUrl: t.accommodation_url ?? null,
    accommodationImageUrl: t.accommodation_image_url ?? null,
    accommodationGalleryUrls: strArr(t.accommodation_gallery_urls),
    // `=== true`: null means "never asked", and draws nothing.
    ciSurfConservation: t.ci_surf_conservation === true,
    stokeCertified: t.stoke_certified === true,
    costPerPerson: toNumber(t.cost_per_person),
    priceInclusions: (t.price_inclusions as PriceInclusions | null) ?? null,
    budgetMin: toNumber(t.budget_min),
    budgetMax: toNumber(t.budget_max),
    budgetCurrency: t.budget_currency ?? null,
    budgetFxRate: toNumber(t.budget_fx_rate),
    itinerary: normalizeItinerary(t.itinerary),
    host: people.host,
    hostBio: t.host_lead_note ?? null,
    hostDestinationFamiliarity: t.host_destination_familiarity ?? null,
    hostStayFamiliarity: t.host_stay_familiarity ?? null,
    crew,
    participants: people.participants,
  };
}

/**
 * The roster's faces, and the host's profile for the top card.
 *
 * Two queries, not an embed: both tables point at `auth.users` separately, so
 * PostgREST cannot join them. Hosts first, then by join date — the app's order,
 * so "the host" is the same person on both.
 */
async function fetchPeople(
  tripId: string,
): Promise<{ host: OverviewHost | null; participants: OverviewPerson[] }> {
  const { data: rows, error } = await supabase
    .from('group_trip_participants')
    .select('user_id, role, joined_at')
    .eq('trip_id', tripId)
    .in('status', PRESENT_STATUSES)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) return { host: null, participants: [] };

  const ids = rows.map((r: any) => r.user_id as string);
  const { data: surfers, error: surferError } = await supabase
    .from('surfers')
    .select('user_id, name, age, country_from, travel_experience, surfboard_type, surf_level_category, profile_image_url')
    .in('user_id', ids);
  if (surferError) throw surferError;
  const byId = new Map((surfers ?? []).map((s: any) => [s.user_id as string, s]));

  const sorted = [...rows].sort((a: any, b: any) =>
    a.role === b.role ? 0 : a.role === 'host' ? -1 : 1,
  );
  const participants: OverviewPerson[] = sorted.map((r: any) => {
    const s = byId.get(r.user_id);
    return { id: r.user_id, name: s?.name ?? null, avatarUrl: s?.profile_image_url ?? null };
  });

  const hostRow = sorted.find((r: any) => r.role === 'host');
  const hs = hostRow ? byId.get(hostRow.user_id) : undefined;
  const host: OverviewHost | null = hostRow
    ? {
        id: hostRow.user_id,
        name: hs?.name ?? null,
        avatarUrl: hs?.profile_image_url ?? null,
        age: toNumber(hs?.age),
        countryFrom: hs?.country_from ?? null,
        surfLevel: hs?.surf_level_category ?? null,
        surfboardType: hs?.surfboard_type ?? null,
        surfTrips: typeof hs?.travel_experience === 'number' ? hs.travel_experience : null,
      }
    : null;

  return { host, participants };
}

/**
 * The crew travelers see — the app's `useTripCrew`: accepted people only, whose
 * tier carries `profile.shown_to_travelers`, most senior first.
 */
async function fetchShownCrew(tripId: string): Promise<OverviewCrewMember[]> {
  const [staffRes, roles] = await Promise.all([
    supabase
      .from('organized_trip_staff')
      .select('id, user_id, role_key, display_name, photo_url, title, bio, accepted_at, is_local')
      .eq('trip_id', tripId)
      .is('revoked_at', null),
    fetchStaffRoles(),
  ]);
  if (staffRes.error) throw staffRes.error;
  const rows = staffRes.data ?? [];

  const shown = new Set(
    roles.filter(r => r.capabilities.includes('profile.shown_to_travelers')).map(r => r.roleKey),
  );

  const ids = rows.map((r: any) => r.user_id).filter((id: string | null): id is string => !!id);
  let profiles = new Map<string, any>();
  if (ids.length > 0) {
    const { data: surfers, error } = await supabase
      .from('surfers')
      .select('user_id, name, profile_image_url, country_from')
      .in('user_id', ids);
    if (error) throw error;
    profiles = new Map((surfers ?? []).map((s: any) => [s.user_id as string, s]));
  }

  return rows
    .filter((r: any) => shown.has(r.role_key))
    // Someone who has not accepted is not on the crew yet.
    .filter((r: any) => !(r.user_id && !r.accepted_at))
    .sort((a: any, b: any) => TIER_DESC.indexOf(a.role_key) - TIER_DESC.indexOf(b.role_key))
    .map((r: any): OverviewCrewMember => {
      const p = r.user_id ? profiles.get(r.user_id) : undefined;
      return {
        id: r.id,
        name: p?.name ?? r.display_name ?? 'Unnamed',
        title: r.title ?? null,
        bio: r.bio ?? null,
        avatarUrl: p?.profile_image_url ?? r.photo_url ?? null,
        roleKey: r.role_key,
        countryFrom: p?.country_from ?? null,
        hasAccount: !!r.user_id,
        isLocal: r.is_local === true,
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels — ports of the app's TripDetailView / TripDetailScreen helpers
// ─────────────────────────────────────────────────────────────────────────────

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SKILL_LABEL: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  pro: 'Pro',
};
const SKILL_ORDER = ['beginner', 'intermediate', 'advanced', 'pro'];

const sortedSkills = (levels: string[]) =>
  levels
    .filter(l => l !== 'all' && SKILL_LABEL[l])
    .sort((a, b) => SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b));

/** "Intermediate+" — the lowest level, "+" when higher ones are on too. */
export function formatSkillLevel(levels: string[]): string {
  const real = sortedSkills(levels);
  if (real.length === 0) return 'All levels';
  return `${SKILL_LABEL[real[0]]}${real.length > 1 ? '+' : ''}`;
}

/** "Beginner - Intermediate", or one label. */
export function formatSkillRange(levels: string[]): string {
  const real = sortedSkills(levels);
  if (real.length === 0) return 'All levels';
  const lo = SKILL_LABEL[real[0]];
  const hi = SKILL_LABEL[real[real.length - 1]];
  return lo === hi ? lo : `${lo} - ${hi}`;
}

export function formatAge(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Any';
  if (min != null && max != null) return `${min}-${max}`;
  return String(min ?? max);
}

/** "Jun 15-22, 2026 · 8 days", or "Aug 2026 - Sep 2026 · 7 days" for month-only trips. */
export function formatTripDates(
  d: Pick<TripOverviewData, 'startDate' | 'endDate' | 'durationDays' | 'dateMonths'>,
): string {
  // Exact dates win over the stored `duration_days`: the column is written at
  // create time and some older trips kept a stale value after their dates
  // moved (El Salvador 26 read "28 days" for Jan 10-20). Month-only trips
  // still use the column — there is nothing else to count.
  const fromDates =
    d.startDate && d.endDate
      ? Math.round((Date.parse(d.endDate.slice(0, 10)) - Date.parse(d.startDate.slice(0, 10))) / 86_400_000) + 1
      : null;
  const days = fromDates && fromDates > 0 ? fromDates : d.durationDays;
  const len =
    days && days > 0
      ? ` · ${days} day${days === 1 ? '' : 's'}`
      : '';
  if (d.startDate) {
    const [y, m, day] = d.startDate.slice(0, 10).split('-').map(Number);
    const startLabel = `${MONTH[m - 1]} ${day}`;
    let main: string;
    if (d.endDate) {
      const [ey, em, ed] = d.endDate.slice(0, 10).split('-').map(Number);
      main =
        em === m
          ? `${MONTH[m - 1]} ${day}-${ed}, ${ey}`
          : `${startLabel} - ${MONTH[em - 1]} ${ed}, ${ey}`;
    } else {
      main = `${startLabel}, ${y}`;
    }
    return main + len;
  }
  if (d.dateMonths && d.dateMonths.length) {
    const sorted = [...d.dateMonths].sort();
    const first = sorted[0].split('-').map(Number);
    const last = sorted[sorted.length - 1].split('-').map(Number);
    const a = `${MONTH[first[1] - 1]} ${first[0]}`;
    if (sorted.length === 1) return `${a}${len}`;
    return `${a} - ${MONTH[last[1] - 1]} ${last[0]}${len}`;
  }
  return 'Dates TBD';
}

/** Midnight local on the first day — the countdown's target. */
export function countdownTarget(
  d: Pick<TripOverviewData, 'startDate' | 'dateMonths'>,
): Date | null {
  if (d.startDate) {
    const [y, m, day] = d.startDate.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, day);
  }
  if (d.dateMonths && d.dateMonths.length) {
    const [y, m] = [...d.dateMonths].sort()[0].split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  return null;
}

export const BOARD_SHORT: Record<string, string> = {
  shortboard: 'Shortboard',
  midlength: 'Mid - Length',
  softtop: 'Soft - Top',
  longboard: 'Longboard',
};

/** Pills read short → mid → long → soft, however the data is stored. */
export function orderedSurfStyles(styles: string[]): string[] {
  const order = ['shortboard', 'midlength', 'longboard', 'softtop'];
  const rank = (s: string) => (order.indexOf(s) === -1 ? order.length : order.indexOf(s));
  return styles.filter(s => s !== 'all').sort((a, b) => rank(a) - rank(b));
}

export const WAVE_SHAPE_LABEL: Record<string, string> = {
  soft: 'Soft',
  wally: 'Standing',
  barrel: 'Barreling',
};

/** "Surf-focused" — the vibe's short title, without its " - ..." description. */
const TRIP_VIBE_LABEL: Record<string, string> = {
  improve_surf: 'Improve your surfing - training camp',
  surf_focused: 'Surf-focused - wake up early, surf a lot',
  explore: 'Surf + Explore',
  vacation: 'Vacation style - chill, loose surf, lay-days',
};
export function vibeLabel(slug: string | null): string | null {
  if (!slug) return null;
  return TRIP_VIBE_LABEL[slug]?.split(' - ')[0] ?? null;
}

export const DESTINATION_FAMILIARITY_LABEL: Record<string, string> = {
  never_been: 'Never been',
  been_once: 'Been there once',
  been_multiple: 'Been there multiple times',
};

export const STAY_FAMILIARITY_LABEL: Record<string, string> = {
  never_online: 'Never stayed, found it online',
  never_recs:
    'Never stayed, got good recommendations from people I know who have been there',
  stayed_once: 'Stayed once, know the place',
  stayed_multiple: 'Stayed multiple times, know the place very well',
};

/** 'surf_camp' → 'Surf Camp'. */
export const titleCase = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ─────────────────────────────────────────────────────────────────────────────
// Price — the operator's own number, in the currency they typed it in
// ─────────────────────────────────────────────────────────────────────────────

const SYMBOLS: Record<string, string> = {
  USD: '$', ILS: '₪', EUR: '€', GBP: '£', AUD: 'AU$', NZD: 'NZ$', CAD: 'CA$',
  BRL: 'R$', ZAR: 'R', JPY: '¥', CHF: 'CHF ', SEK: 'SEK ', NOK: 'NOK ', DKK: 'DKK ',
};

const validRate = (r: number | null | undefined): r is number =>
  typeof r === 'number' && Number.isFinite(r) && r > 0;

/** The app's `snapToRound`: undo USD round-trip drift without inventing a price. */
function snapToRound(raw: number, rate: number): number {
  const noise = Math.max(1, rate * 0.5 + 0.5);
  for (const step of [100, 50, 10, 5, 1]) {
    const c = Math.round(raw / step) * step;
    if (Math.abs(raw - c) <= noise) return c;
  }
  return Math.round(raw);
}

/**
 * The app's `formatOperatorAmount`: the operator looking at their own price,
 * so their typed currency at the frozen rate — not a viewer's conversion.
 */
export function formatOperatorPrice(
  usd: number,
  currency: string | null,
  rate: number | null,
): string {
  const code = currency && SYMBOLS[currency] ? currency : 'USD';
  const amount = code === 'USD' || !validRate(rate) ? Math.round(usd) : snapToRound(usd * rate, rate);
  const sym = code === 'USD' || !validRate(rate) ? '$' : SYMBOLS[code];
  return `${sym}${amount.toLocaleString('en-US')}`;
}

/** The price line the app's bottom bar shows: a fixed price, else the budget range. */
export function priceLabel(d: TripOverviewData): { amount: string; estimate: boolean } | null {
  const one = (usd: number) => formatOperatorPrice(usd, d.budgetCurrency, d.budgetFxRate);
  if (d.costPerPerson != null) return { amount: one(d.costPerPerson), estimate: false };
  if (d.budgetMin != null && d.budgetMax != null)
    return { amount: `${one(d.budgetMin)}-${one(d.budgetMax)}`, estimate: true };
  if (d.budgetMin != null) return { amount: `${one(d.budgetMin)}+`, estimate: true };
  if (d.budgetMax != null) return { amount: `up to ${one(d.budgetMax)}`, estimate: true };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// What's included — port of the app's priceInclusions.ts (read side only)
// ─────────────────────────────────────────────────────────────────────────────

type Opt = { slug: string; label: string };
const MEALS: Opt[] = [
  { slug: 'breakfast', label: 'Breakfast' },
  { slug: 'lunch', label: 'Lunch' },
  { slug: 'dinner', label: 'Dinner' },
];
const ACCOMMODATION: Opt[] = [
  { slug: 'private_room', label: 'Private room' },
  { slug: 'shared_room', label: 'Shared room' },
];
const TRANSPORTATION: Opt[] = [
  { slug: 'intl_flights', label: 'International flights' },
  { slug: 'airport_transfer', label: 'Transport from airport to stay' },
  { slug: 'surf_transport', label: 'Transport to the surf and back' },
  { slug: 'local_transport', label: 'Local transport (scooter / bike)' },
];
const SURF_SESSIONS: Opt[] = [
  { slug: 'escorting', label: 'Surf escorting' },
  { slug: 'locals', label: 'Surf escort by locals' },
  { slug: 'guidance_lessons', label: 'Surf guidance and lessons' },
];
const SURF_EQUIPMENT: Opt[] = [
  { slug: 'board', label: 'Board' },
  { slug: 'wetsuit', label: 'Wetsuit' },
  { slug: 'surf_shirt', label: 'Surf shirt' },
  { slug: 'sunscreen', label: 'Sunscreen' },
  { slug: 'wax', label: 'Wax supply' },
];
const FILM_MEDIA: Opt[] = [
  { slug: 'video', label: 'Video' },
  { slug: 'photo', label: 'Photo' },
];
const FILM_TYPE: Opt[] = [
  { slug: 'telephoto', label: 'Telephoto' },
  { slug: 'in_water', label: 'In-water' },
  { slug: 'drone', label: 'Drone' },
];
const ACTIVITIES: Opt[] = [
  { slug: 'day_tours', label: 'Day tours' },
  { slug: 'cultural', label: 'Cultural experiences' },
  { slug: 'nature', label: 'Nature trips' },
  { slug: 'nightlife', label: 'Nightlife / social' },
];
const WELLNESS: Opt[] = [
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
];

export const INCLUSION_TITLE = {
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
} as const;

const labelize = (opts: Opt[], slugs: string[] | undefined) =>
  (slugs ?? []).map(s => opts.find(o => o.slug === s)?.label ?? s);

const wellnessList = (inc: PriceInclusions) =>
  (inc.wellness ?? []).map(w =>
    typeof w === 'string' ? { key: w, payment: 'included' as const } : w,
  );

export type InclusionSection = { title: string; items: string[]; asTags: boolean };

/** Titled sections, in the app's order. `asTags`: items read as one comma list. */
export function priceInclusionSections(inc: PriceInclusions | null): InclusionSection[] {
  if (!inc) return [];
  const out: InclusionSection[] = [];
  const tags = (title: string, items: string[]) => {
    if (items.length) out.push({ title, items, asTags: true });
  };

  tags(INCLUSION_TITLE.meals, labelize(MEALS, inc.meals));
  tags(INCLUSION_TITLE.accommodation, labelize(ACCOMMODATION, inc.accommodation));
  tags(INCLUSION_TITLE.transportation, labelize(TRANSPORTATION, inc.transportation));
  tags(INCLUSION_TITLE.surfSessions, labelize(SURF_SESSIONS, inc.surfSessions));
  tags(INCLUSION_TITLE.surfEquipment, labelize(SURF_EQUIPMENT, inc.surfEquipment));

  const f = inc.surfFilm;
  if (f && (f.media?.length || f.count != null || f.filmTypes?.length)) {
    const parts: string[] = [];
    const media = labelize(FILM_MEDIA, f.media);
    if (media.length) parts.push(media.map((m, i) => (i === 0 ? m : m.toLowerCase())).join(' and '));
    const types = labelize(FILM_TYPE, f.filmTypes).map(t => t.toLowerCase()).join(', ');
    if (f.count != null) {
      const sessions = `${f.count} session${f.count === 1 ? '' : 's'}`;
      parts.push(types ? `${sessions} of ${types}` : sessions);
    } else if (types) {
      parts.push(types);
    }
    if (parts.length) out.push({ title: INCLUSION_TITLE.surfFilm, items: [parts.join(', ')], asTags: false });
  }

  const va = inc.videoAnalysis;
  if (va?.included) {
    out.push({
      title: INCLUSION_TITLE.videoAnalysis,
      items: [va.count != null ? `${va.count} session${va.count === 1 ? '' : 's'}` : 'Included'],
      asTags: false,
    });
  }

  const acts = inc.activities ?? [];
  if (acts.length) {
    out.push({
      title: INCLUSION_TITLE.activities,
      items: acts.map(a => {
        const label = ACTIVITIES.find(o => o.slug === a.key)?.label ?? a.key;
        return a.note?.trim() ? `${label} - ${a.note.trim()}` : label;
      }),
      asTags: false,
    });
  }

  tags(
    INCLUSION_TITLE.wellness,
    wellnessList(inc)
      .filter(w => w.payment === 'included')
      .map(w => WELLNESS.find(o => o.slug === w.key)?.label ?? w.key),
  );

  const custom = (inc.custom ?? [])
    .map(c => {
      const t = c.title?.trim() ?? '';
      const d = c.description?.trim();
      return t && d ? `${t} - ${d}` : t || d || '';
    })
    .filter(Boolean);
  if (custom.length) out.push({ title: INCLUSION_TITLE.custom, items: custom, asTags: false });

  return out;
}

/** Offered for an extra cost — the "extra pay" wellness picks. */
export function priceInclusionAddOns(inc: PriceInclusions | null): string[] {
  if (!inc) return [];
  return wellnessList(inc)
    .filter(w => w.payment === 'extra')
    .map(w => WELLNESS.find(o => o.slug === w.key)?.label ?? w.key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Itinerary — port of the app's itinerary.ts (read side only)
// ─────────────────────────────────────────────────────────────────────────────

// Built from the parts, never `new Date(iso)`, which reads a bare date as UTC.
const parseDay = (iso: string | null | undefined): Date | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** Calendar days, both ends included: Jun 15 – 22 is 8. */
export function tripCalendarDays(start: string | null, end: string | null): number {
  const s = parseDay(start);
  const e = parseDay(end);
  if (!s || !e) return 0;
  const n = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return n > 0 ? n : 0;
}

/** "Day 2 · Tue, Jun 16", or "Day 2" with no start date. */
export function dayLabel(start: string | null, day: number): string {
  const s = parseDay(start);
  if (!s) return `Day ${day}`;
  const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + day - 1);
  return `Day ${day} · ${WEEKDAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
}

/** "8 days · Jun 15 – 22, 2026". */
export function tripRangeLabel(start: string | null, end: string | null): string {
  const s = parseDay(start);
  const e = parseDay(end);
  if (!s || !e) return '';
  const total = tripCalendarDays(start, end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const from = `${MONTH[s.getMonth()]} ${s.getDate()}${sameYear ? '' : `, ${s.getFullYear()}`}`;
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  const to = `${sameMonth ? '' : `${MONTH[e.getMonth()]} `}${e.getDate()}, ${e.getFullYear()}`;
  return `${total} ${total === 1 ? 'day' : 'days'} · ${from} – ${to}`;
}

/** "Surf · Lunch · Sunset session" — the line under a day's title. */
export const dayHighlights = (day: ItineraryDay): string =>
  day.activities.map(a => a.name.trim()).filter(Boolean).join(' · ');

/** The planned (titled) days inside the trip's dates — what guests see. */
export function guestDays(days: ItineraryDay[], start: string | null, end: string | null): ItineraryDay[] {
  const total = tripCalendarDays(start, end);
  return days
    .map(d => ({ ...d, title: d.title.trim() }))
    .filter(d => d.title.length > 0 && (total === 0 || d.day <= total))
    .sort((a, b) => a.day - b.day);
}

/** Reads the jsonb column defensively, timed activities first. */
export function normalizeItinerary(raw: unknown): ItineraryDay[] {
  if (!Array.isArray(raw)) return [];
  const asText = (v: unknown) => (typeof v === 'string' ? v : '');
  const days: ItineraryDay[] = [];
  for (const entry of raw) {
    const row = entry as Record<string, unknown> | null;
    if (!row || !Number.isInteger(row.day) || (row.day as number) < 1) continue;
    const activities = (Array.isArray(row.activities) ? row.activities : [])
      .map((a: any) => ({
        time: asText(a?.time) || null,
        name: asText(a?.name).trim(),
        place: asText(a?.place).trim() || null,
      }))
      .filter(a => a.name.length > 0)
      .sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : b.time ? 1 : 0));
    days.push({
      day: row.day as number,
      title: asText(row.title),
      photos: strArr(row.photos).slice(0, 6),
      activities,
    });
  }
  return days.sort((a, b) => a.day - b.day);
}
