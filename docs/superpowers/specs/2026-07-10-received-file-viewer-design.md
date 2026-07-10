# In-app viewer for received file attachments

**Date:** 2026-07-10
**Status:** Approved, ready for implementation plan

## Problem

Tapping a received file in a chat downloads it and hands it to the OS share sheet. You leave the app to look at a PDF someone sent you. WhatsApp opens it in place.

Outgoing files already get a preview screen (`FilePreviewModal`, shipped 2026-07-09). Incoming files get nothing.

## Goals

- Tapping a received image, PDF, or text file opens it inside the app.
- The viewer offers a share button — the escape hatch to save to Files, open elsewhere, or forward.
- A caption sent with the file is shown.

## Non-goals

- **Rendering a CSV as a table.** WhatsApp does; we show raw text, same as the send-side preview.
- **A chevron menu in the header.** In WhatsApp it toggles table-vs-raw for a CSV. With no table view it would be empty.

## The security decision this reverses

`FileBubble.tsx`'s header currently states, as a deliberate posture:

> the file is NEVER rendered or executed inside the app

That line must change, because we are about to render bytes another user sent us. It is worth being precise about what actually changes, because it is less than it sounds and it is confined to one file type.

| Kind | New attack surface? | Why |
|---|---|---|
| Image | **None.** | Every `type='image'` chat message already decodes through `expo-image` (Glide / SDWebImage) in-process, in production, today. A `.png` arriving as a *document* is the same bytes through the same decoder. |
| Text (`txt`, `csv`) | **None.** | Bytes are read and placed in a `<Text>`. No parser. |
| PDF | **Yes — this is the whole delta.** | `react-native-pdf-renderer` parses attacker-controlled bytes in our process. |

Two things bound the PDF risk, and neither is an excuse to ignore it:

1. **The parsers are the system's**, not a vendored copy: PDFKit on iOS, PDFium on Android. They are patched by iOS and Android updates, not by our release cadence. Handing the same file to the OS share sheet routes it into the same parsers — QuickLook is PDFKit. What changes is *whose process* it runs in, not *whether* it is parsed.
2. **A render failure lands on `FileCard`**, never a crash-to-desktop, because `FilePreviewBody`'s `RenderBoundary` already catches it.

We accept this. The header comment gets rewritten to say what is true, so the next reader is not misled by a posture the code no longer holds.

## Design

### Where the viewer lives

`FileBubble.handleOpen` branches on `previewKindForExt(meta.ext)`:

- `'none'` (`zip`, `docx`, `pptx`, `mp3`, `mp4`, …) → **unchanged**. Download, hand to the share sheet.
- `'image' | 'pdf' | 'text'` → download to cache, open `FileViewerModal`.

**`FileBubble` mounts the modal itself.** The alternative — lifting state into `DirectMessageScreen` and `DirectGroupChat` — was rejected. Those two files are ~6300 lines each and their attach handlers are byte-for-byte duplicates that must be mirrored by hand; yesterday's review had to `diff` them to prove they had not drifted. `FileBubble` is already self-contained: it downloads, owns a `busy` spinner, and handles its own errors. Letting it own its modal keeps this change to **one component file** and adds nothing to either screen. Only one file is open at a time, so only one modal is ever mounted.

### Sharing the shell with the send-side preview

`FilePreviewModal` (send) and `FileViewerModal` (receive) differ only in their footer. Both are a dark full-screen modal with a close X, the filename as title, swipe-down dismiss, and `FilePreviewBody` as the body.

Extract **`FilePreviewShell`**: header, dismiss gesture, and `FilePreviewBody`, with the footer passed as `children`. Both modals become thin wrappers.

This is not gratuitous refactoring. Without it the two screens can drift, and the failure is silent: the same `.docx` could look one way before you send it and another way after you receive it, and nobody would notice until a user said so.

### The viewer

- **Header:** X (left), filename (center).
- **Body:** `FilePreviewBody` on the downloaded `file://` uri.
- **Footer:** the caption, when `message.body` is non-empty. A floating share button calls `Sharing.shareAsync(localUri, { mimeType })`.

### Two bugs fixed on the way, because the viewer does not work without them

**1. The cache filename is unsafe.** Today the file lands at:

```ts
const target = `${LegacyFS.cacheDirectory}${message.id}-${meta.display_name}`;
```

`display_name` is the sender's original filename — it may contain spaces, accents, or `#`. The share sheet does not care. `react-native-pdf-renderer` and `expo-file-system` do: a `file://` uri with unescaped characters **fails silently on Android**. This is the same percent-encoding class of bug the send-side research turned up (expo/expo#21792).

The target becomes `` `${cacheDirectory}${message.id}.${meta.ext}` ``. The pretty name still shows in the viewer's header, which is where a human reads it.

**2. The cache is never cleaned.** Every file ever opened stays in `cacheDirectory` forever. The viewer deletes the file when it closes, via `new File(uri).delete()` (`expo-file-system` 19). Sharing awaits `shareAsync` before the modal can close, so there is no race.

## Files touched

**New**
- `src/components/filePreview/FilePreviewShell.tsx` — header, gesture, body; footer as `children`
- `src/components/FileViewerModal.tsx`

**Modified**
- `src/components/FilePreviewModal.tsx` — rewritten as a thin wrapper over the shell
- `src/components/messages/FileBubble.tsx` — branch on `previewKindForExt`; safe cache filename; mount the viewer; rewrite the security comment

Nothing in `DirectMessageScreen.tsx` or `DirectGroupChat.tsx`.

## Acceptance criteria

1. Tapping a received PDF opens it in the app and renders page one.
2. Tapping a received `.zip` opens the OS share sheet, exactly as before.
3. Tapping a received `.csv` under 256 KB shows its raw text; over the cap, the file card.
4. Tapping a received image renders it.
5. A file whose renderer fails shows `FileCard`, never a blank pane.
6. The share button hands the file to the OS sheet with the right MIME type.
7. A file sent with a caption shows that caption in the viewer.
8. Closing the viewer deletes the downloaded file from `cacheDirectory`.
9. A file whose `display_name` contains a space or an accent renders on Android.
10. In Expo Go, a received PDF shows the file card — no crash.
11. `FilePreviewModal` (send side) still behaves exactly as before the shell extraction.

## Testing

- `previewKindForExt` is already unit-tested; the branch in `FileBubble` consumes it and needs no new test.
- Everything else is verified on-device by Ohad. No simulator or Maestro runs.
