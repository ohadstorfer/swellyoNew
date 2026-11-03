// Trip itinerary — the day-by-day plan stored in group_trips.itinerary.
//
// Pure helpers only, so the wizard, the post-publish editor and the Overview
// agree on what a "planned" day is and how it reads. The Figma for the card is
// 18437:22173 (open) and 18437:22350 (closed).
//
// `day` is 1-based and NOT a date: a day keeps its plan when the trip moves. A
// day past the trip's new end stays stored but hidden from guests until the
// operator removes it or changes the dates back (see `daysPastEnd`).

export const MAX_DAY_PHOTOS = 6;
export const MAX_DAY_TITLE_LENGTH = 30;

export interface ItineraryActivity {
  /** "HH:mm", 24h. Null = no set time ("Free afternoon"). */
  time: string | null;
  name: string;
  place: string | null;
}

export interface ItineraryDay {
  day: number;
  title: string;
  /** Local file URIs until published, then S3 URLs. The first is the cover. */
  photos: string[];
  /** Width / height of each photo, by URI. Optional: only the guest card's morph
   *  needs it, to line the square thumbnail up with the full image. */
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

// Built from the parts, never `new Date(iso)`: that reads a bare date as UTC,
// which is the previous day everywhere west of Greenwich.
const parseDay = (iso: string | null | undefined): Date | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/**
 * Calendar days the trip touches, both ends included: Jun 15 – 22 is 8 days,
 * and each gets its own plan. NOT the wizard's `dayCount`, which subtracts the
 * dates and so counts nights (7 here).
 */
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

/** "Day 2 · Tue, Jun 16", or just "Day 2" for a trip with no start date. */
export const dayLabel = (startISO: string | null | undefined, day: number): string => {
  const start = parseDay(startISO);
  if (!start) return `Day ${day}`;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day - 1);
  return `Day ${day} · ${WEEKDAY[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;
};

/** "8 days · Jun 15 – 22, 2026". The month and year repeat only if they change. */
export const tripRangeLabel = (
  startISO: string | null | undefined,
  endISO: string | null | undefined,
): string => {
  const start = parseDay(startISO);
  const end = parseDay(endISO);
  if (!start || !end) return '';
  const total = tripCalendarDays(startISO, endISO);
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const from = `${MONTH[start.getMonth()]} ${start.getDate()}${startYear === endYear ? '' : `, ${startYear}`}`;
  const sameMonth = startYear === endYear && start.getMonth() === end.getMonth();
  const to = `${sameMonth ? '' : `${MONTH[end.getMonth()]} `}${end.getDate()}, ${endYear}`;
  return `${total} ${total === 1 ? 'day' : 'days'} · ${from} – ${to}`;
};

/** A day guests can see. The title is what makes the card readable. */
export const isDayPlanned = (day: ItineraryDay): boolean => day.title.trim().length > 0;

export const dayHasContent = (day: ItineraryDay): boolean =>
  isDayPlanned(day) ||
  day.photos.length > 0 ||
  day.activities.some(a => a.name.trim().length > 0);

/** The line under the title. Derived, so the operator never types it twice. */
export const dayHighlights = (day: ItineraryDay): string =>
  day.activities.map(a => a.name.trim()).filter(Boolean).join(' · ');

const byTime = (a: ItineraryActivity, b: ItineraryActivity): number => {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.time) return -1;
  return b.time ? 1 : 0;
};

// Removing a photo leaves its ratio behind, so this is where they get dropped.
const keepRatios = (
  day: ItineraryDay,
  photos: string[],
): Pick<ItineraryDay, 'photoRatios'> => {
  const kept = photos.filter(uri => day.photoRatios?.[uri] != null);
  if (kept.length === 0) return {};
  return { photoRatios: Object.fromEntries(kept.map(uri => [uri, day.photoRatios![uri]])) };
};

/** Trims, drops rows left blank, and puts timed activities first, in order. */
export const cleanDay = (day: ItineraryDay): ItineraryDay => ({
  ...day,
  title: day.title.trim(),
  photos: day.photos.slice(0, MAX_DAY_PHOTOS),
  ...keepRatios(day, day.photos.slice(0, MAX_DAY_PHOTOS)),
  activities: day.activities
    .map(a => ({ ...a, name: a.name.trim(), place: a.place?.trim() || null }))
    .filter(a => a.name.length > 0)
    .sort(byTime),
});

/** Replaces one day, keeping the list sorted. A day left blank is removed. */
export const upsertDay = (days: ItineraryDay[], next: ItineraryDay): ItineraryDay[] => {
  const rest = days.filter(d => d.day !== next.day);
  const cleaned = cleanDay(next);
  return (dayHasContent(cleaned) ? [...rest, cleaned] : rest).sort((a, b) => a.day - b.day);
};

/** What gets stored: only days guests can see. */
export const cleanItinerary = (days: ItineraryDay[]): ItineraryDay[] =>
  days
    .map(cleanDay)
    .filter(isDayPlanned)
    .sort((a, b) => a.day - b.day);

/** The planned days inside the trip's dates, which is what guests see. */
export const guestDays = (
  days: ItineraryDay[],
  startISO: string | null | undefined,
  endISO: string | null | undefined,
): ItineraryDay[] => {
  const total = tripCalendarDays(startISO, endISO);
  return cleanItinerary(days).filter(d => total === 0 || d.day <= total);
};

/** Planned days the trip's dates no longer reach. */
export const daysPastEnd = (days: ItineraryDay[], totalDays: number): ItineraryDay[] =>
  totalDays > 0 ? days.filter(d => d.day > totalDays && dayHasContent(d)) : [];

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Reads the column defensively: it is jsonb, and old clients can read new rows. */
export const normalizeItinerary = (raw: unknown): ItineraryDay[] => {
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
        ? row.activities
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
};

/**
 * Side of a photo's centre square once it is drawn with `cover` in a frame. The
 * square thumbnail variant is that centre square, so this is where it has to sit
 * to line up with the full image. Null ratio: the square fills the frame alone.
 */
export const coverSquareSide = (
  frameW: number,
  frameH: number,
  ratio: number | null,
): number => {
  if (ratio == null) return Math.max(frameW, frameH);
  const fitsHeight = ratio >= frameW / frameH;
  const drawnW = fitsHeight ? frameH * ratio : frameW;
  const drawnH = fitsHeight ? frameH : frameW / ratio;
  return Math.min(drawnW, drawnH);
};

const isRemote = (uri: string): boolean => /^https?:\/\//.test(uri);

/**
 * Uploads every photo still on the device and returns the days with their URLs.
 *
 * One at a time on purpose: the upload key is `hero-<timestamp>`, so two running
 * in the same millisecond would overwrite each other.
 */
export const uploadItineraryPhotos = async (
  days: ItineraryDay[],
  upload: (uri: string) => Promise<string>,
): Promise<ItineraryDay[]> => {
  const uploaded: ItineraryDay[] = [];
  for (const day of days) {
    const photos: string[] = [];
    const ratios: Record<string, number> = {};
    for (const uri of day.photos) {
      const url = isRemote(uri) ? uri : await upload(uri);
      photos.push(url);
      const ratio = day.photoRatios?.[uri];
      if (ratio != null) ratios[url] = ratio;
    }
    uploaded.push({
      ...day,
      photos,
      ...(Object.keys(ratios).length > 0 ? { photoRatios: ratios } : { photoRatios: undefined }),
    });
  }
  return uploaded;
};
