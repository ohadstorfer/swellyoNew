// buildTripShareMessage — the text that goes out with a trip invite link.
//
// Shape (each line optional, omitted when the data isn't there):
//
//   Sri Lanka surf trip
//   🗓️ May 15–22
//   🧳 Planning together
//   🤙 3 spots open — join us!
//
//   https://…/trip/<id>
//
// The link stays on its own line at the end: WhatsApp (and most chat apps)
// build their preview card from the first URL they find, and keeping it
// unwrapped by punctuation stops apps from swallowing a trailing character.

import { STRUCTURE_DISPLAY } from '../../components/trips/TripDetailView';

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface TripShareInput {
  title?: string | null;
  /** "YYYY-MM-DD" (a full timestamp is tolerated — only the date part is read). */
  startDate?: string | null;
  endDate?: string | null;
  /** group_trips.trip_structure — the first slug becomes the 🧳 line. */
  structureSlugs?: string[] | null;
  participantCount?: number | null;
  maxParticipants?: number | null;
  inviteUrl: string;
}

/** Parse "YYYY-MM-DD" without going through Date (no timezone shifting). */
function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/**
 * Compact range, no year — "May 15–22", or "May 28 – Jun 3" across months.
 * The year is dropped on purpose: this reads as a chat message, not a record.
 */
export function formatShareDates(
  startDate?: string | null,
  endDate?: string | null
): string | null {
  if (!startDate) return null;
  const start = parseIsoDate(startDate);
  if (!start) return null;

  const startLabel = `${MONTH_SHORT[start.m - 1]} ${start.d}`;
  if (!endDate) return startLabel;

  const end = parseIsoDate(endDate);
  if (!end) return startLabel;

  if (end.m === start.m && end.y === start.y) {
    // Same month — no point repeating it ("May 15–22").
    return end.d === start.d ? startLabel : `${startLabel}–${end.d}`;
  }
  return `${startLabel} – ${MONTH_SHORT[end.m - 1]} ${end.d}`;
}

/** "El Salvador 26" → "El Salvador 26 surf trip"; left alone if already said. */
function titleLine(title?: string | null): string | null {
  const name = title?.trim();
  if (!name) return null;
  return /trip|surf/i.test(name) ? name : `${name} surf trip`;
}

/** "3 spots open — join us!", or a generic nudge when there's no limit set. */
function spotsLine(
  participantCount?: number | null,
  maxParticipants?: number | null
): string | null {
  if (maxParticipants == null || maxParticipants <= 0) {
    return 'Spots open — join us!';
  }
  const taken = participantCount ?? 0;
  const open = maxParticipants - taken;
  if (open <= 0) return null; // Trip is full — don't invite people to nothing.
  return `${open} spot${open === 1 ? '' : 's'} open — join us!`;
}

export function buildTripShareMessage(input: TripShareInput): string {
  const lines: string[] = [];

  const heading = titleLine(input.title);
  if (heading) lines.push(heading);

  const dates = formatShareDates(input.startDate, input.endDate);
  if (dates) lines.push(`🗓️ ${dates}`);

  const structure = input.structureSlugs?.find(slug => STRUCTURE_DISPLAY[slug]?.title);
  if (structure) lines.push(`🧳 ${STRUCTURE_DISPLAY[structure].title}`);

  const spots = spotsLine(input.participantCount, input.maxParticipants);
  if (spots) lines.push(`🤙 ${spots}`);

  // Blank line before the link so the preview card sits clear of the copy.
  return lines.length ? `${lines.join('\n')}\n\n${input.inviteUrl}` : input.inviteUrl;
}
