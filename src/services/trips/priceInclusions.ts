// =============================================================================
// priceInclusions — the "What's included" model for Flow C (fully-planned,
// fixed-price trips). The whole structure lives in ONE JSONB column
// `group_trips.price_inclusions` (added 20260601000001). It is opaque to the DB
// (never filtered in SQL), so it can grow without a migration.
//
// Replaces the old flat `price_includes text[]` column.
// =============================================================================

export type IncludeOption<TSlug extends string = string> = {
  slug: TSlug;
  label: string;
};

// --- Category option sets ----------------------------------------------------
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
] as const;

// --- Sub-shapes for the categories with extra parameters ---------------------
export interface SurfFilmInclusion {
  media?: string[]; // 'video' | 'photo' (both = "both")
  count?: number | null; // how many films (optional)
  filmTypes?: string[]; // 'telephoto' | 'in_water' | 'drone' (optional)
}

export interface VideoAnalysisInclusion {
  included?: boolean;
  count?: number | null; // how many sessions (optional)
}

/** An activity selection carries its own free-text note (where, how long, why). */
export interface ActivityInclusion {
  key: string;
  note?: string;
}

/** A host-defined "add your own" inclusion — same shape as the built-in
 *  categories: a short title + a description. */
export interface CustomInclusion {
  title: string;
  description?: string;
}

// --- The full model ----------------------------------------------------------
export interface PriceInclusions {
  meals?: string[];
  accommodation?: string[];
  transportation?: string[];
  surfSessions?: string[];
  surfEquipment?: string[];
  surfFilm?: SurfFilmInclusion;
  videoAnalysis?: VideoAnalysisInclusion;
  activities?: ActivityInclusion[];
  wellness?: string[];
  custom?: CustomInclusion[]; // "add your own" — repeatable title + description
}

// --- Helpers -----------------------------------------------------------------
const labelize = (
  options: readonly IncludeOption[],
  slugs: string[] | undefined,
): string[] =>
  (slugs ?? []).map(s => options.find(o => o.slug === s)?.label ?? s);

/** True when a category holds at least one selection. */
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
  if (key === 'videoAnalysis') {
    const a = v as VideoAnalysisInclusion;
    return !!a.included;
  }
  return false;
}

/** Short, comma-joined summary for a single category (for the wizard rows). */
export function summarizeCategory(
  inc: PriceInclusions | null | undefined,
  key: keyof PriceInclusions,
): string {
  if (!inc) return '';
  switch (key) {
    case 'meals':
      return labelize(MEALS_OPTIONS, inc.meals).join(', ');
    case 'accommodation':
      return labelize(ACCOMMODATION_INCL_OPTIONS, inc.accommodation).join(', ');
    case 'transportation':
      return labelize(TRANSPORTATION_OPTIONS, inc.transportation).join(', ');
    case 'surfSessions':
      return labelize(SURF_SESSIONS_OPTIONS, inc.surfSessions).join(', ');
    case 'surfEquipment':
      return labelize(SURF_EQUIPMENT_OPTIONS, inc.surfEquipment).join(', ');
    case 'wellness':
      return labelize(WELLNESS_OPTIONS, inc.wellness).join(', ');
    case 'activities':
      return labelize(
        ACTIVITIES_OPTIONS,
        (inc.activities ?? []).map(a => a.key),
      ).join(', ');
    case 'surfFilm': {
      const f = inc.surfFilm;
      if (!f) return '';
      const media = labelize(SURF_FILM_MEDIA_OPTIONS, f.media);
      const parts = [...media];
      if (f.count != null) parts.push(`×${f.count}`);
      const types = labelize(SURF_FILM_TYPE_OPTIONS, f.filmTypes);
      if (types.length) parts.push(`(${types.join(', ')})`);
      return parts.join(' ');
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

/** Render a custom item as a single "Title — description" line (or just one). */
function customItemLine(c: CustomInclusion): string {
  const t = c.title.trim();
  const d = c.description?.trim();
  return t && d ? `${t} — ${d}` : t || d || '';
}

/** Display title for each category (used by the wizard rows + detail view). */
export const CATEGORY_TITLE: Record<keyof PriceInclusions, string> = {
  meals: 'Meals',
  accommodation: 'Accommodation',
  transportation: 'Transportation',
  surfSessions: 'Surf sessions',
  surfEquipment: 'Surf equipment',
  surfFilm: 'Surf film',
  videoAnalysis: 'Video analysis',
  activities: 'Activities & excursions',
  wellness: 'Wellness & recovery',
  custom: 'Other',
};

// Order the categories appear in the wizard + detail view.
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

/** Flatten the inclusions into titled sections for the read-only detail view.
 *  Each section: a category title + its human-readable lines. */
export function priceInclusionSections(
  inc: PriceInclusions | null | undefined,
): { title: string; items: string[] }[] {
  if (!inc) return [];
  const out: { title: string; items: string[] }[] = [];

  for (const key of CATEGORY_ORDER) {
    if (key === 'activities') {
      const acts = inc.activities ?? [];
      if (!acts.length) continue;
      const items = acts.map(a => {
        const label = ACTIVITIES_OPTIONS.find(o => o.slug === a.key)?.label ?? a.key;
        return a.note?.trim() ? `${label} — ${a.note.trim()}` : label;
      });
      out.push({ title: CATEGORY_TITLE.activities, items });
      continue;
    }
    if (!hasCategoryValue(inc, key)) continue;
    const summary = summarizeCategory(inc, key);
    if (summary) out.push({ title: CATEGORY_TITLE[key], items: [summary] });
  }

  if (inc.custom?.length) {
    const items = inc.custom.map(customItemLine).filter(Boolean);
    if (items.length) out.push({ title: CATEGORY_TITLE.custom, items });
  }
  return out;
}

/** Null out an empty inclusions object so we don't persist `{}`. */
export function normalizePriceInclusions(
  inc: PriceInclusions | null | undefined,
): PriceInclusions | null {
  if (!inc) return null;
  const hasCustom = (inc.custom ?? []).some(c => customItemLine(c).length > 0);
  const anyValue = CATEGORY_ORDER.some(k => hasCategoryValue(inc, k)) || hasCustom;
  return anyValue ? inc : null;
}
