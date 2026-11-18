/**
 * "What's included" — the shape of `group_trips.price_inclusions` (jsonb).
 *
 * ⚠️ TWIN of the app's `src/services/trips/priceInclusions.ts`. This site
 * shares no code with the app, so the option lists and the two rules that
 * decide what gets stored (`normalizePriceInclusions`,
 * `pruneBlankCustomInclusions`) are copied, not imported. Change both together:
 * a slug written here that the app does not know renders as a raw slug on a
 * traveler's phone.
 */

export type IncludeOption = { slug: string; label: string };

export const MEALS_OPTIONS: IncludeOption[] = [
  { slug: 'breakfast', label: 'Breakfast' },
  { slug: 'lunch', label: 'Lunch' },
  { slug: 'dinner', label: 'Dinner' },
];

export const ACCOMMODATION_INCL_OPTIONS: IncludeOption[] = [
  { slug: 'private_room', label: 'Private room' },
  { slug: 'shared_room', label: 'Shared room' },
];

export const TRANSPORTATION_OPTIONS: IncludeOption[] = [
  { slug: 'intl_flights', label: 'International flights' },
  { slug: 'airport_transfer', label: 'Transport from airport to stay' },
  { slug: 'surf_transport', label: 'Transport to the surf and back' },
  { slug: 'local_transport', label: 'Local transport (scooter / bike)' },
];

export const SURF_SESSIONS_OPTIONS: IncludeOption[] = [
  { slug: 'escorting', label: 'Surf escorting' },
  { slug: 'locals', label: 'Surf escort by locals' },
  { slug: 'guidance_lessons', label: 'Surf guidance and lessons' },
];

export const SURF_EQUIPMENT_OPTIONS: IncludeOption[] = [
  { slug: 'board', label: 'Board' },
  { slug: 'wetsuit', label: 'Wetsuit' },
  { slug: 'surf_shirt', label: 'Surf shirt' },
  { slug: 'sunscreen', label: 'Sunscreen' },
  { slug: 'wax', label: 'Wax supply' },
];

export const SURF_FILM_MEDIA_OPTIONS: IncludeOption[] = [
  { slug: 'video', label: 'Video' },
  { slug: 'photo', label: 'Photo' },
];

export const SURF_FILM_TYPE_OPTIONS: IncludeOption[] = [
  { slug: 'telephoto', label: 'Telephoto' },
  { slug: 'in_water', label: 'In-water' },
  { slug: 'drone', label: 'Drone' },
];

export const ACTIVITIES_OPTIONS: IncludeOption[] = [
  { slug: 'day_tours', label: 'Day tours' },
  { slug: 'cultural', label: 'Cultural experiences' },
  { slug: 'nature', label: 'Nature trips' },
  { slug: 'nightlife', label: 'Nightlife / social' },
];

export const WELLNESS_OPTIONS: IncludeOption[] = [
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

export type FlatIncludeKey =
  | 'meals'
  | 'accommodation'
  | 'transportation'
  | 'surfSessions'
  | 'surfEquipment';

export const FLAT_INCLUDE_OPTIONS: Record<FlatIncludeKey, IncludeOption[]> = {
  meals: MEALS_OPTIONS,
  accommodation: ACCOMMODATION_INCL_OPTIONS,
  transportation: TRANSPORTATION_OPTIONS,
  surfSessions: SURF_SESSIONS_OPTIONS,
  surfEquipment: SURF_EQUIPMENT_OPTIONS,
};

export function isFlatIncludeKey(key: string): key is FlatIncludeKey {
  return key in FLAT_INCLUDE_OPTIONS;
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

/** Legacy rows stored wellness as a bare `string[]`. Read either shape. */
export function normalizeWellness(
  value: ReadonlyArray<WellnessInclusion | string> | undefined,
): WellnessInclusion[] {
  return (value ?? []).map(w =>
    typeof w === 'string' ? { key: w, payment: 'included' as const } : w,
  );
}

const labelize = (options: IncludeOption[], slugs: string[] | undefined): string[] =>
  (slugs ?? []).map(s => options.find(o => o.slug === s)?.label ?? s);

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

/** One line under each category's title. Same wording as the app's rows. */
export function summarizeCategory(
  inc: PriceInclusions | null | undefined,
  key: keyof PriceInclusions,
): string {
  if (!inc) return '';
  if (isFlatIncludeKey(key)) {
    return labelize(FLAT_INCLUDE_OPTIONS[key], inc[key]).join(', ');
  }
  switch (key) {
    case 'wellness':
      return normalizeWellness(inc.wellness)
        .map(w => {
          const label = WELLNESS_OPTIONS.find(o => o.slug === w.key)?.label ?? w.key;
          return w.payment === 'extra' ? `${label} (extra)` : label;
        })
        .join(', ');
    case 'activities':
      return labelize(
        ACTIVITIES_OPTIONS,
        (inc.activities ?? []).map(a => a.key),
      ).join(', ');
    case 'surfFilm': {
      const f = inc.surfFilm;
      if (!f) return '';
      const parts: string[] = [];
      const media = labelize(SURF_FILM_MEDIA_OPTIONS, f.media);
      if (media.length) {
        parts.push(media.map((m, i) => (i === 0 ? m : m.toLowerCase())).join(' and '));
      }
      const types = labelize(SURF_FILM_TYPE_OPTIONS, f.filmTypes)
        .map(t => t.toLowerCase())
        .join(', ');
      if (f.count != null) {
        const sessions = `${f.count} session${f.count === 1 ? '' : 's'}`;
        parts.push(types ? `${sessions} of ${types}` : sessions);
      } else if (types) {
        parts.push(types);
      }
      return parts.join(', ');
    }
    case 'videoAnalysis': {
      const a = inc.videoAnalysis;
      if (!a?.included) return '';
      return a.count != null ? `${a.count} session${a.count === 1 ? '' : 's'}` : 'Included';
    }
    case 'custom':
      return (inc.custom ?? [])
        .map(c => c.title.trim())
        .filter(Boolean)
        .join(', ');
    default:
      return '';
  }
}

function customItemLine(c: CustomInclusion): string {
  const t = c.title.trim();
  const d = c.description?.trim();
  return t && d ? `${t} - ${d}` : t || d || '';
}

/**
 * Drop any "Add your own" item with no title and no description. Same
 * predicate as the app, so pressing "Add an inclusion" and never filling it in
 * does not leave a blank object in the column forever.
 */
export function pruneBlankCustomInclusions(inc: PriceInclusions): PriceInclusions {
  const custom = Array.isArray(inc.custom) ? inc.custom : [];
  return { ...inc, custom: custom.filter(c => c.title.trim() || c.description?.trim()) };
}

/** Null out an inclusions object with nothing in it, so `{}` is never stored. */
export function normalizePriceInclusions(
  inc: PriceInclusions | null | undefined,
): PriceInclusions | null {
  if (!inc) return null;
  const hasCustom = (inc.custom ?? []).some(c => customItemLine(c).length > 0);
  const anyValue = CATEGORY_ORDER.some(k => hasCategoryValue(inc, k)) || hasCustom;
  return anyValue ? inc : null;
}

/** What Save writes. Prune first, then collapse an empty object to null. */
export function inclusionsForSave(inc: PriceInclusions): PriceInclusions | null {
  return normalizePriceInclusions(pruneBlankCustomInclusions(inc));
}

/** Reads the column defensively: jsonb, and older rows may lack any key. */
export function readPriceInclusions(raw: unknown): PriceInclusions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const inc = raw as PriceInclusions;
  return { ...inc, wellness: inc.wellness ? normalizeWellness(inc.wellness) : undefined };
}
