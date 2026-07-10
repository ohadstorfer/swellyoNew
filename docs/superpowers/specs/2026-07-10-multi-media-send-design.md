# Multi-photo/video send in chats (WhatsApp-style)

**Date:** 2026-07-10
**Status:** Approved
**Scope:** Native only (iOS + Android). Web keeps single-pick. Both chat screens (DM + group).

## Problem

The attach-panel "Photos" path picks exactly one photo or video per trip to the
gallery. Sending five photos means five full round trips through picker →
preview → send. WhatsApp lets you select up to 30 items at once, review them in
one screen, caption each, and send them as a burst of individual messages.

## What we're building

### 1. Picker: allow multi-select

In `handleImagePicker` (both `DirectMessageScreen.tsx` and
`DirectGroupChat.tsx`), the native branch's `launchImageLibraryAsync` gains:

```ts
allowsMultipleSelection: true,
selectionLimit: 30,        // WhatsApp's cap
orderedSelection: true,    // iOS numbers the picks 1, 2, 3…
```

Routing on result:

- **1 asset** → today's exact flow, untouched (`ImagePreviewModal` /
  `VideoPreviewModal`).
- **≥2 assets** → map to `MediaReviewItem[]` and open the new
  `MediaReviewModal`.

```ts
interface MediaReviewItem {
  uri: string;
  isVideo: boolean;
  width?: number;
  height?: number;
  duration?: number;   // seconds (picker reports ms; convert at the boundary)
  mimeType?: string;
  fileSize?: number;
}
```

Mixed photo+video batches are allowed, like WhatsApp.

### 2. `MediaReviewModal` (new component)

`src/components/MediaReviewModal.tsx` — a fullscreen `<Modal>` shared by both
screens. Single-item modals are NOT touched; this component only ever sees
batches of ≥2 (though it must tolerate shrinking to 1 via deletes).

**Layout (WhatsApp mimicry):**

- Black fullscreen. Horizontal **pager** (paging `FlatList`, one item per
  screen). Photos render `resizeMode="contain"` like `ImagePreviewContent`;
  videos render with `expo-video`, tap to play/pause, starting paused.
- **Bottom chrome** (floats over media, rides the keyboard):
  1. Caption bar — same `ChatTextInput` styling as the single-item previews
     ("Add a caption...", dark pill, `allowEmpty`). It edits the **current
     item's** caption; captions live in a `Map<uri, string>` and the input
     swaps value as the pager settles on a new index.
  2. Thumbnail **filmstrip** — ~52px square thumbs in a horizontal row, in
     selection order. Active item gets a 2px border in the host chat's
     `primaryColor`. Tap a thumb → pager jumps there. Video thumbs get a small
     ▶ glyph overlay.
  3. **Send button** to the right of the filmstrip — theme-colored circle with
     a count badge (item count).
- **Top chrome**:
  - Top-left: **X** — discards the whole batch (calls `onCancel`).
  - Top-right: **trash** — removes the current item (WhatsApp's affordance).
    Removing the last remaining item closes the modal (cancel).
  - Top-right, next to trash: **crop** (photos only) — calls the host's
    existing `cropImage` helper via an `onCropImage` prop; a returned uri
    replaces the item's uri (caption carries over).

**Props:**

```ts
interface MediaReviewModalProps {
  visible: boolean;
  items: MediaReviewItem[];
  onSend: (items: Array<MediaReviewItem & { caption?: string }>) => void;
  onCancel: () => void;
  onCropImage?: (uri: string) => Promise<{ uri: string; width?: number; height?: number } | null>;
  primaryColor?: string;
}
```

Send has the same synchronous re-entrancy guard (`sendingRef`) the single-item
previews use.

### 3. Send: burst of individual messages

The host screen's `onSend` loops the ordered items and dispatches each through
the **existing** upload-first helpers — no pipeline changes:

- photo → `handleImageSend(caption, item.uri)`
- video → `handleVideoSend(caption, item.uri)`

Calls are made without awaiting completion (`void`), in order, so every
optimistic bubble appears immediately and in selection order; uploads proceed
concurrently in the background with the shipped per-message progress, retry,
and failure handling. Video metadata (dimensions/duration/mime) is passed the
same way the camera-modal override path does today; verify during
implementation that the override path doesn't read stale
`selectedVideoMetadataRef` state, and thread per-item metadata through if
needed.

## Out of scope (v1)

- Web multi-pick (web keeps the single hidden-`<input>` flow).
- `ChatCameraModal`'s gallery button (stays single-pick with inline preview).
- WhatsApp's "+" add-more-media button in the filmstrip.
- Per-item video trim inside the review screen.
- Reply-to context on multi-send batches (matches single-send behavior).

## Error handling

- Picker cancel → no-op (existing behavior).
- Crop cancel/failure → item unchanged.
- Per-item upload failures surface on that message's bubble via the existing
  retry/remove affordances; other items are unaffected.

## Testing

- `tsc --noEmit` clean.
- On-device (Ohad): mixed batch of photos+videos in a DM and a group chat;
  per-item captions land on the right messages; order preserved; trash and
  crop behave; single-pick path unchanged; Expo Go unaffected (expo-video and
  expo-image-picker are Expo-SDK modules, no new native deps).
