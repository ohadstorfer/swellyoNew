/**
 * The day-by-day plan stored in `group_trips.itinerary` (jsonb).
 *
 * ⚠️ TWIN of the app's `src/services/trips/itinerary.ts` — the parts the
 * editor needs. Same rules for what a "planned" day is and what gets stored,
 * so a plan written here reads the same on a traveler's phone.
 *
 * `day` is 1-based and NOT a date: a day keeps its plan when the trip moves.
 */

export const MAX_DAY_PHOTOS = 6;
export const MAX_DAY_TITLE_LENGTH = 30;

export interface ItineraryActivity {
  /** "HH:mm", 24h. Null = no set time. */
  time: string | null;
  name: string;
  place: string | null;
}

export interface ItineraryDay {
  day: number;
  title: string;
  /** S3 URLs. The first is the cover. */
  photos: string[];
  /** Width / height per photo URL. Only the app's guest card reads it, but it is
   *  carried through untouched so an edit here never strips it. */
  photoRatios?: Record<string, number>;
  activities: ItineraryActivity[];
}

export const emptyDay = (day: number): ItineraryDay => ({
  day,
  title: '',
  photos: [],
  activities: [],
});

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Built from the parts, never `new Date(iso)`: a bare date parses as UTC, which
// is the previous day everywhere west of Greenwich.
const parseDay = (iso: string | null | undefined): Date | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** Calendar days the trip touches, both ends included (Jun 15 – 22 is 8). */
export function tripCalendarDays(
  startISO: string | null | undefined,
  endISO: string | null | undefined,
): number {
  const start = parseDay(startISO);
  const end = parseDay(endISO);
  if (!start || !end) return 0;
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return days > 0 ? days : 0;
}

/** "Day 2 · Tue, Jun 16", or just "Day 2" for a trip with no start date. */
export function dayLabel(startISO: string | null | undefined, day: number): string {
  const start = parseDay(startISO);
  if (!start) return `Day ${day}`;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day - 1);
  return `Day ${day} · ${WEEKDAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
}

export const isDayPlanned = (day: ItineraryDay): boolean => day.title.trim().length > 0;

export const dayHasContent = (day: ItineraryDay): boolean =>
  isDayPlanned(day) ||
  day.photos.length > 0 ||
  day.activities.some(a => a.name.trim().length > 0);

/** Has photos or activities but no title — dropped on save, so it must not be
 *  closed without asking or its photos are lost without a word. */
export const dayNeedsTitle = (day: ItineraryDay): boolean =>
  dayHasContent(day) && !isDayPlanned(day);

export const dayHighlights = (day: ItineraryDay): string =>
  day.activities.map(a => a.name.trim()).filter(Boolean).join(' · ');

const byTime = (a: ItineraryActivity, b: ItineraryActivity): number => {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.time) return -1;
  return b.time ? 1 : 0;
};

const keepRatios = (day: ItineraryDay, photos: string[]): Pick<ItineraryDay, 'photoRatios'> => {
  const kept = photos.filter(uri => day.photoRatios?.[uri] != null);
  if (kept.length === 0) return {};
  return { photoRatios: Object.fromEntries(kept.map(uri => [uri, day.photoRatios![uri]])) };
};

/** Trims, drops blank activity rows, and puts timed activities first. */
export function cleanDay(day: ItineraryDay): ItineraryDay {
  const photos = day.photos.slice(0, MAX_DAY_PHOTOS);
  const { photoRatios: _drop, ...rest } = day;
  void _drop;
  return {
    ...rest,
    title: day.title.trim(),
    photos,
    ...keepRatios(day, photos),
    activities: day.activities
      .map(a => ({ ...a, name: a.name.trim(), place: a.place?.trim() || null }))
      .filter(a => a.name.length > 0)
      .sort(byTime),
  };
}

/** Replaces one day, keeping the list sorted. A day left blank is removed. */
export function upsertDay(days: ItineraryDay[], next: ItineraryDay): ItineraryDay[] {
  const rest = days.filter(d => d.day !== next.day);
  const cleaned = cleanDay(next);
  return (dayHasContent(cleaned) ? [...rest, cleaned] : rest).sort((a, b) => a.day - b.day);
}

/** What gets stored: only days guests can see. */
export function cleanItinerary(days: ItineraryDay[]): ItineraryDay[] {
  return days
    .map(cleanDay)
    .filter(isDayPlanned)
    .sort((a, b) => a.day - b.day);
}

/** Planned days the trip's dates no longer reach. Kept, but hidden from guests. */
export function daysPastEnd(days: ItineraryDay[], totalDays: number): ItineraryDay[] {
  return totalDays > 0 ? days.filter(d => d.day > totalDays && dayHasContent(d)) : [];
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads the column defensively: it is jsonb, and old clients can read new rows. */
export function normalizeItinerary(raw: unknown): ItineraryDay[] {
  if (!Array.isArray(raw)) return [];
  const days: ItineraryDay[] = [];
  for (const entry of raw) {
    const row = entry as Partial<Record<keyof ItineraryDay, unknown>> | null;
    if (!row || !Number.isInteger(row.day) || (row.day as number) < 1) continue;
    const ratios = Object.entries((row.photoRatios ?? {}) as Record<string, unknown>).filter(
      (pair): pair is [string, number] => typeof pair[1] === 'number' && pair[1] > 0,
    );
    days.push({
      day: row.day as number,
      title: asText(row.title),
      photos: Array.isArray(row.photos)
        ? row.photos.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [],
      ...(ratios.length > 0 ? { photoRatios: Object.fromEntries(ratios) } : {}),
      activities: Array.isArray(row.activities)
        ? (row.activities as Array<Record<string, unknown> | null>)
            .map(a => ({
              time: asText(a?.time) || null,
              name: asText(a?.name),
              place: asText(a?.place) || null,
            }))
            .filter(a => a.name.length > 0)
        : [],
    });
  }
  return days.sort((a, b) => a.day - b.day);
}

/** The days a list shows: one per calendar day, plus any planned day past the
 *  end, so a plan the dates no longer reach is still visible to remove. */
export function dayNumbersToShow(days: ItineraryDay[], totalDays: number): number[] {
  const base = Array.from({ length: totalDays }, (_, i) => i + 1);
  const extra = days.map(d => d.day).filter(n => n > totalDays);
  return [...new Set([...base, ...extra])].sort((a, b) => a - b);
}
