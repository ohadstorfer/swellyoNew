/**
 * WhatsApp-style album grouping, derived at RENDER time — no schema change.
 *
 * Consecutive image/video messages from the same sender, each within
 * ALBUM_GAP_MS of its neighbor and with no caption, collapse into one album
 * row when the run reaches ALBUM_MIN. Because grouping is pure derivation
 * over the loaded window it works retroactively, for the recipient, for
 * optimistic uploading rows, and albums grow/merge as messages arrive or
 * older pages load. Deleting an item re-derives; a run that falls under
 * ALBUM_MIN explodes back into single bubbles (same as WhatsApp).
 */
import type { Message } from '../services/messaging/messagingService';

/** Minimum consecutive media to collapse into a grid. 2–3 stay single bubbles. */
export const ALBUM_MIN = 4;
/** Max created_at gap between neighboring items in one album. */
export const ALBUM_GAP_MS = 3 * 60 * 1000;

export interface AlbumRow {
  kind: 'album';
  /** Stable list key — the OLDEST item's identity (albums grow by appending
   *  newer items, so the oldest anchor only changes when pagination merges an
   *  older page in, which is a one-off remount). */
  key: string;
  sender_id: string;
  /** Chronological, oldest first (= top-left tile, WhatsApp order). ≥ ALBUM_MIN. */
  items: Message[];
}

export interface MessageRow {
  kind: 'message';
  message: Message;
}

export type ChatDisplayRow = AlbumRow | MessageRow;

/** Media message that can live inside an album: image/video, alive, captionless. */
export function qualifiesForAlbum(m: Message): boolean {
  if (m.deleted) return false;
  const isMedia =
    m.type === 'image' || m.type === 'video' || !!m.image_metadata || !!m.video_metadata;
  if (!isMedia) return false;
  // A caption forces a solo bubble — the grid has nowhere to show text.
  if (m.body && m.body.trim().length > 0) return false;
  return true;
}

const closeEnough = (a: Message, b: Message): boolean => {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (!isFinite(ta) || !isFinite(tb)) return false;
  return Math.abs(ta - tb) <= ALBUM_GAP_MS;
};

/**
 * Collapse an inverted (newest-first) message list into display rows for the
 * inverted FlatList. Output stays newest-first; an album's `items` are
 * chronological (oldest first).
 */
export function buildDisplayRows(inverted: Message[]): ChatDisplayRow[] {
  const rows: ChatDisplayRow[] = [];
  let i = 0;
  while (i < inverted.length) {
    const start = inverted[i];
    if (!qualifiesForAlbum(start)) {
      rows.push({ kind: 'message', message: start });
      i++;
      continue;
    }
    // Extend the run over consecutive qualifying same-sender neighbors.
    let end = i;
    while (
      end + 1 < inverted.length &&
      qualifiesForAlbum(inverted[end + 1]) &&
      inverted[end + 1].sender_id === start.sender_id &&
      closeEnough(inverted[end], inverted[end + 1])
    ) {
      end++;
    }
    const runLength = end - i + 1;
    if (runLength >= ALBUM_MIN) {
      // inverted[i..end] is newest→oldest; items must be oldest→newest.
      const items = inverted.slice(i, end + 1).reverse();
      const oldest = items[0];
      rows.push({
        kind: 'album',
        key: `album-${oldest.client_id || oldest.id}`,
        sender_id: start.sender_id,
        items,
      });
    } else {
      for (let j = i; j <= end; j++) {
        rows.push({ kind: 'message', message: inverted[j] });
      }
    }
    i = end + 1;
  }
  return rows;
}

/** Whole-album reply label: "N photos" / "N videos" / "N photos, M videos". */
export function describeAlbum(items: Message[]): string {
  const isVideo = (m: Message): boolean => m.type === 'video' || !!m.video_metadata;
  const videos = items.filter(isVideo).length;
  const photos = items.length - videos;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (photos > 0 && videos > 0) {
    return `${plural(photos, 'photo', 'photos')}, ${plural(videos, 'video', 'videos')}`;
  }
  if (videos > 0) return plural(videos, 'video', 'videos');
  return plural(photos, 'photo', 'photos');
}

/** Display-row index containing the given message id (album items count). */
export function findRowIndexByMessageId(rows: ChatDisplayRow[], id: string): number {
  return rows.findIndex((row) =>
    row.kind === 'message'
      ? row.message.id === id || row.message.client_id === id
      : row.items.some((m) => m.id === id || m.client_id === id),
  );
}
