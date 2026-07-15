# WhatsApp-style "reply to whole album" — Design

Date: 2026-07-14
Branch: ohad

## Problem

In chats (group and direct), photos/videos sent together render as an album grid
(`MediaAlbumBubble`). Today, long-pressing a tile opens the action menu on that
**single** tile, and Reply quotes only that one photo. We want WhatsApp behavior:
long-press any tile → the whole album highlights as selected → Reply produces a
quote reading "7 photos" / "3 videos" / "5 photos, 2 videos".

## Context (as-is)

- Albums are a **render-time** grouping in `src/utils/mediaAlbums.ts`. No album ID
  in the DB — each photo/video is its own `messages` row. `buildDisplayRows`
  collapses 4+ consecutive, same-sender, captionless media into an `AlbumRow`.
- `src/components/MediaAlbumBubble.tsx` is presentational. Each tile's long-press
  currently calls `handleMessageLongPress(tile, e, false)`.
- Reply target = `ReplyToSnapshot` (`messagingService.ts:144`) — a frozen
  single-`message_id` snapshot with `sender_id/sender_name/type/body`, where `body`
  holds a short media label ("Photo"/"Video"/"Voice message").
- Preview label built at send time in `DirectMessageScreen.tsx:2039-2046`.
- Composer banner: `ReplyPreviewBanner`. Quoted-in-bubble: `QuotedMessagePreview`.
- Tap-to-scroll resolves any tile → its album row via
  `findRowIndexByMessageId` (`mediaAlbums.ts:102`).
- Same logic mirrored in `DirectMessageScreen.tsx` and `DirectGroupChat.tsx`.
  `ChatScreen.tsx` (Swelly AI) has no albums — out of scope.

## Decisions

- Reply preview shows **count only** ("7 photos" / "3 videos" /
  "5 photos, 2 videos"), no thumbnail.
- Long-press **highlights the whole album bubble** as the selected state.
- **Report stays per-tile** (reports the single tapped image) — unchanged.
- Reply anchors to the **tapped tile's** `message_id`; no schema change. Scroll-to
  already maps any tile to its album row.

## Changes

### 1. `src/utils/mediaAlbums.ts`
Add pure helper `describeAlbum(items: Message[]): string`:
- Count image vs video (video = `type==='video' || video_metadata`).
- All images → `"N photos"` (singular "1 photo").
- All videos → `"N videos"` (singular "1 video").
- Mixed → `"N photos, M videos"` (singular-aware each side).

### 2. `src/components/MediaAlbumBubble.tsx`
Add optional prop `isSelected?: boolean`. When true, render a subtle full-bubble
scrim overlay (pointerEvents="none") to signal "whole batch selected".

### 3. `DirectMessageScreen.tsx` + mirror `DirectGroupChat.tsx`
- New state: `selectedAlbumItems: Message[] | null`, `selectedAlbumKey: string | null`,
  `replyingToAlbumLabel: string | null`.
- New `handleAlbumLongPress(album, tappedMessage, e)`: set `selectedMessage =
  tappedMessage` (anchor + Report target), stash `album.items`/`album.key`, open menu.
  Wire `MediaAlbumBubble.onLongPressItem` to it (replacing the direct
  `handleMessageLongPress(m, e, false)` call).
- Pass `isSelected={menuVisible && selectedAlbumKey === album.key}` to the bubble.
- Menu `onReply`: if `selectedAlbumItems` → `setReplyingTo(tappedMessage)` **and**
  `setReplyingToAlbumLabel(describeAlbum(items))`.
- `sendMessage` snapshot: if `replyingToAlbumLabel` set, use it as snapshot `body`
  (type stays anchor's media type so the media icon still shows).
- `ReplyPreviewBanner`: show `replyingToAlbumLabel` when set, else current per-type label.
- Clear `replyingToAlbumLabel` wherever `setReplyingTo(null)` runs (cancel banner,
  after send). Clear album selection (`selectedAlbumItems`/`selectedAlbumKey`) on
  menu close.

## Acceptance criteria

- Long-press any tile in an album (DM and group) → whole bubble shows selected scrim,
  menu opens with Reply + Report.
- Choosing Reply → composer banner reads "N photos"/"N videos"/"N photos, M videos".
- Sending → the sent message's quote shows the same count label + media icon.
- Tapping the quote scrolls/highlights the original album.
- Report reports the single tapped tile (unchanged).
- Non-album single media bubbles behave exactly as before.

## Non-goals / trade-offs

- No thumbnail in the quote (count only, by decision).
- No new DB column; reply anchors to one tile. If the album later drops below 4 and
  re-explodes into single bubbles, the quote still scrolls to the anchor tile.
- Swelly AI chat (`ChatScreen.tsx`) untouched.
