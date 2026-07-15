---
name: reference-media-album-bubble-grouping
description: How chat renders grouped photo/video albums (grid bubbles) and how Reply/Report long-press menu works, across DirectMessageScreen and DirectGroupChat
metadata:
  type: reference
---

Album grouping is a pure render-time derivation, NOT a DB concept — no album_id/group_id column exists.

- `src/utils/mediaAlbums.ts` — `buildDisplayRows(invertedMessages)` walks the newest-first message array and collapses runs of >=4 (`ALBUM_MIN`) consecutive, same-sender, captionless image/video messages within `ALBUM_GAP_MS` (3 min) of each other into one `AlbumRow`. `qualifiesForAlbum()` requires `type==='image'|'video'` (or metadata present) and no body text. Falls back to single `MessageRow`s if run < 4 or on any single-message change (retroactive re-derivation each render).
- `src/components/MediaAlbumBubble.tsx` — presentational 2x2 grid (`AlbumTile`), shows first 4 items, "+N" scrim on the 4th tile opens `AlbumGridModal.tsx`. Each tile independently supports tap (open fullscreen viewer via `onPressItem`) and long-press (`onLongPressItem` -> same per-message context menu as non-album bubbles).
- Both `src/screens/DirectMessageScreen.tsx` and `src/screens/DirectGroupChat.tsx` call `buildDisplayRows()` and render `<MediaAlbumBubble>` for album rows, `<SafeMessageBubble>` (error-boundary + PostHog redaction wrapper, `src/components/chat/SafeMessageBubble.tsx`) for normal rows. `src/screens/ChatScreen.tsx` (Swelly AI chat) does NOT use albums/SafeMessageBubble — single-user AI chat, no multi-media grouping needed.

Data model: each photo/video is its own row in the `messages` table (`type='image'|'video'`, own `image_metadata`/`video_metadata`). There is no shared batch/album id and no attachments array in practice — `attachments` column exists on `Message` interface but is legacy/unused for image/video (see messagingService.ts ~line 238 select list). Sending "multiple photos" = inserting N separate message rows in quick succession; the album UI is inferred from timing+sender+captionless heuristic.

Long-press / context menu flow (identical in both DM and group screens):
- `handleMessageLongPress(message, event, isLastInRun)` in DirectMessageScreen.tsx (~line 3764) / mirrored in DirectGroupChat.tsx — sets `selectedMessage`, `menuPosition`, opens `<MessageActionsMenu>` (`src/components/MessageActionsMenu.tsx`).
- Early-outs: deleted/is_system/`type==='commitment_request'` messages get no menu; own message with `upload_state==='failed'` gets a native `Alert.alert` (Reenviar/Copiar/Borrar) instead of the menu.
- `canReply` gate: false if deleted/is_system/upload failed, OR if `id === client_id` (not yet server-confirmed, so it can't anchor a reply reference).
- `canReport` gate: false for own messages, deleted, is_system, or failed uploads.
- `onReply` callback just does `setReplyingTo(selectedMessage)` + focuses composer.
- `onReport` callback sets `reportMessageContext` and opens the report BottomSheetShell after a 320ms timeout (two stacked Modals issue on iOS — closing one and opening another in the same frame drops the second's presentation).

Reply data structure — `ReplyToSnapshot` (messagingService.ts line ~144): `{ message_id, sender_id, sender_name, type, body? }`. Built as a frozen snapshot at send time (DirectMessageScreen.tsx ~line 2024), NOT a live reference — edits to the original later don't change the quote. The preview label for media types is computed inline at snapshot-build time: `type==='image' ? 'Photo' : type==='video' ? 'Video' : type==='audio' ? 'Voice message' : body`. Rendered via `<QuotedMessagePreview>` (referenced ~line 4445) inside the bubble, and `<ReplyPreviewBanner>` above the composer while composing a reply. Tapping a quoted preview calls `handleReplyPreviewPress(parentMessageId)` which scrolls/highlights the original message (uses `findRowIndexByMessageId` from mediaAlbums.ts to resolve album-nested targets too).
