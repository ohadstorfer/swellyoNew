# In-chat camera with recent-photos filmstrip (WhatsApp-style)

**Date:** 2026-07-09 · **Author:** Ohad + Claude · **Status:** Approved

## What

Replace the OS camera (`ImagePicker.launchCameraAsync`) in chats (1:1 and group) with an
in-app full-screen camera that shows a horizontal filmstrip of the most recent gallery
photos/videos above the shutter, like WhatsApp. Tapping a thumbnail routes that asset
straight into the existing send-preview flow.

## Architecture

New self-contained `src/components/ChatCameraModal.tsx` (RN `Modal`, full-screen,
`navigationBarTranslucent` on Android). `DirectGroupChat.handleCameraCapture` becomes:
check `currentConversationId`, early-return on web, `setCameraVisible(true)`.

Contract — the modal's only outputs:

```ts
onCapture: (asset: {
  uri: string; isVideo: boolean;
  width?: number; height?: number;
  duration?: number;        // seconds, video only
  mimeType?: string;
}) => void;
onCancel: () => void;
```

`onCapture` runs the same block that today follows `launchCameraAsync`: sets the
metadata refs and opens `ImagePreviewModal` or `VideoPreviewModal` per `isVideo`.
Upload pipeline, outbox, previews: untouched.

Internal split:
- `ChatCameraModal` — permissions, `mode: 'idle' | 'recording'`, handoff.
- Camera controls — header (close, flash), shutter (tap = photo, hold = video),
  flip, gallery button (reuses `handleImagePicker` flow via `onOpenGallery` prop).
- `RecentMediaStrip` — filmstrip; receives `onSelect(asset)`, knows nothing of the camera.

## Filmstrip

- `expo-media-library` `getAssetsAsync({ mediaType: ['photo','video'], sortBy: 'creationTime', first: 30 })`,
  horizontal `FlatList` of square thumbnails, paginate with `endCursor` on end-reached.
- Videos show a duration badge (`0:11`) bottom-right.
- Tap → `getAssetInfoAsync()` and use **`localUri`**, not `uri` (iOS returns `ph://`
  which the upload pipeline can't read) → `onSelect` → same preview routing as capture.
- Photos taken in-app go to cache, not the gallery (same as today) — they route
  directly to preview, so absence from the strip is fine. We do NOT save to gallery.

## Permissions

Two independent permissions; denying gallery must not break the camera:
- **Camera** (`expo-camera`) — required. Denied → same Alert + "Open Settings" as today; modal doesn't open.
- **Gallery** (`expo-media-library`) — optional. Denied → strip replaced by one
  "Allow photo access" tile that requests (or opens Settings when `!canAskAgain`).
- **Microphone** — requested lazily on first hold-to-record, not on open. Denied → alert; photos keep working.
- iOS limited / Android partial access: show whatever `getAssetsAsync` returns; no manage-selection flow.

## Shutter

- Tap → `takePictureAsync()` → `onCapture({ isVideo: false, ... })`.
- Hold (~300ms threshold) → `recordAsync({ maxDuration: 60 })`, ring turns red, timer shown;
  release → `stopRecording()` → `onCapture({ isVideo: true, ... })`. Short holds still count as video.
- Flash cycles off → on → auto. Flip toggles front/back.
- The Android "Take Photo / Record Video" Alert chooser is deleted; `launchCameraAsync` no longer used in this flow.

## Platform / shipping

- `expo-camera` + `expo-media-library` — both work in Expo Go (testable there), both
  NATIVE modules: **ship requires a native rebuild, not OTA-able**. Joins the existing rebuild backlog.
- app.json: add both plugins with permission strings (iOS camera/mic/photos strings already exist).
- Web: unchanged (early return preserved).

## Errors

- iOS Simulator (no camera) → existing "test on a physical device" alert.
- `takePictureAsync`/`recordAsync` failure → `showErrorAlert`, modal stays open for retry.
