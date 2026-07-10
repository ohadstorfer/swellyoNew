# WhatsApp-style album grouping for chat media

**Date:** 2026-07-10
**Status:** Approved
**Scope:** Both chat screens (DM + group), native + web rendering (display-only feature).

## Problem

Media sent together (multi-select or rapid individual sends) renders as N
separate full-width bubbles. WhatsApp collapses 4+ consecutive media into one
album bubble: a 2×2 grid with a "+N" overlay when there are more.

## Grouping rule (display-time, no DB change)

Consecutive messages collapse into an album when ALL hold:

- `type` image or video (or has image/video metadata), not deleted
- **no caption** (`body` empty/whitespace) — a grid can't show captions; WhatsApp
  excludes captioned media too
- same `sender_id` as the previous qualifying message
- `created_at` gap to the previous item ≤ **3 minutes**
- run length ≥ **4** (2–3 keep today's separate bubbles)

Derived at render time in `buildDisplayRows(invertedMessages)` →
`ChatDisplayRow[]` (`{kind:'message'}` | `{kind:'album', items[]}`), so it works
retroactively, for the recipient, for optimistic uploading rows, and albums
grow/merge as messages arrive or pages load. Album row key = oldest item's
`client_id || id`. Items stored chronological (oldest first = top-left tile).

## Album bubble (`MediaAlbumBubble`)

- 2×2 grid of the first 4 items, square tiles, `contentFit="cover"`, 2px gaps,
  outer 16px radius (13px inner, matching image bubbles)
- Tile source: image → `thumbnail_url || image_url || _localPreviewUri`;
  video → `video_metadata.thumbnail_url || _localPreviewUri` (+ ▶ overlay)
- \>4 items → 4th tile gets a dark scrim with "+N"; tapping it opens
  `AlbumGridModal`
- Per-tile upload states: spinner while `uploading`, alert-icon scrim when
  `failed` (tap = retry via existing `handleRetryUpload`)
- Tap tile → existing fullscreen viewers (image viewer / video sign-and-play
  path). Long-press tile → existing per-message menu (reply/react/delete…)
- Time + read receipt pill bottom-right, from the album's NEWEST item
  (existing `formatTime` + `ReadReceipt`/`getReceiptState` from the host)
- Reactions: hosts merge all items' reactions into one `MessageReactionsRow`
  under the grid; tapping a pill opens the reactions sheet for the first item
  carrying that emoji

## `AlbumGridModal`

Fullscreen dark modal, 3-column grid of ALL the album's items (same tile
rendering incl. upload states), top-left X. Tap tile → same open-item callback
(closes the modal, opens the viewer). Long-press → same per-message menu.

## Screen wiring (both screens, identical)

- `FlatList` data becomes `displayRows` (memo over `invertedMessages`);
  `renderItem`/`keyExtractor` branch on `row.kind`; neighbor gap/run logic reads
  the row's sender (album rows expose `sender_id`)
- Entering animation: album row animates when its newest item is unseen; all
  item ids get marked seen
- Reply-jump (`handleReplyPreviewPress`) maps message id → display-row index
  (row containing the id)
- Group chat: album rows reuse the avatar + sender-name layout of media
  messages (album is one "message" for run purposes)
- New state: `albumModalItems: Message[] | null` for the +N modal

## Out of scope (v1)

- Swipe between album items inside the fullscreen viewer
- Animated tile insertion as new items join an album (the grid re-renders)
- Swipe-to-reply on the album bubble as a whole (reply per item via long-press)

## Known behaviors

- While a multi-send batch uploads, the album assembles immediately from the
  optimistic rows (photos first; videos join after poster generation)
- If someone deletes an item, the album re-derives (may fall under 4 and
  explode back into single bubbles — same as WhatsApp)

## Testing

`npx tsc --noEmit` clean; on-device (Ohad): send 4+, 6+, mixed photo/video
batches both directions in DM + group; captions break grouping; +N modal;
per-tile retry on airplane-mode failure; reply-jump to an album item; reactions
on album items.
