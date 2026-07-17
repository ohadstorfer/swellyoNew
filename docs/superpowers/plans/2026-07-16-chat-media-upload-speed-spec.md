# Spec: Faster chat media uploads (photos, videos, thumbnails)

**Date:** 2026-07-16 · **Branch:** ohad · **Status:** spec, not implemented

**Problem:** Media sends in DMs and group chats feel slow. Root cause is upload
payload size — there is effectively no client-side size reduction where it
matters. Everything below is OTA-able (no native changes).

---

## 1. Photos — lower re-encode constants

**What:** Chat photos are re-encoded at JPEG quality 0.95 with a 2560px cap →
typical 2–6 MB per photo. Chat-grade is ~1920px @ 0.8 → ~300–700 KB, roughly
5–10× faster upload with negligible visual loss at chat sizes.

**Files:**
- `src/services/messaging/imageUploadService.ts`
  - `MAX_IMAGE_DIMENSIONS`: 2560 → **1920**
  - `ORIGINAL_JPEG_QUALITY`: 0.95 → **0.8**

**Scope guard:** these constants are only used by the chat image path
(processImage / compressImage). Profile images and other uploads are separate
services — do not touch them.

**Acceptance:**
- A typical camera-roll photo produces a final upload ≤ ~800 KB (check the
  existing `📸 processed image` log: `finalFileSizeKB`).
- Sent photo still looks sharp full-screen on device.
- Web path uses the same constants — verify web send still works.

## 2. Videos — transcode at the picker before upload

**What:** `uploadVideoToS3` uploads the original picker file untouched
(MediaConvert compresses only *after* full upload). A 30s iPhone HEVC/4K clip
is 60–150+ MB. Adding `videoExportPreset` makes iOS transcode locally to
H.264 720p before handing over the file (~5–15× smaller). Net win on any
mobile uplink despite the local transcode wait.

**Files (all `launchImageLibraryAsync` calls that include `'videos'`):**
- `src/screens/DirectMessageScreen.tsx:2723`
- `src/screens/DirectGroupChat.tsx:2534`

Add to the picker options:
```ts
videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
```

**Notes / risks:**
- iOS-only effect; Android ignores it (acceptable — Android camera files are
  typically smaller; deeper Android compression is out of scope).
- The picker takes longer to return while transcoding — the existing picker
  spinner/flow must remain responsive; verify no double-tap send regression.
- `processVideo` hints (width/height/duration/fileSize) come from the picker
  asset — confirm they reflect the *exported* file, so `mediaUploadTimeoutMs`
  and the 250 MB validation use the right size.
- Camera-captured videos (`launchCameraAsync`), if any send video, get the
  same preset.

**Acceptance:**
- A 30s library video uploads a file ≤ ~15 MB (log fileSize in processVideo).
- Playback after MediaConvert processing still works (poster, dimensions ok).

## 3. Thumbnails — upload in parallel with the original

**What:** The thumbnail PUT currently awaits the original PUT (serial), adding
its full latency (presign round-trip + upload) to every photo send. Run both
with `Promise.all`.

**Files (identical pattern in both):**
- `src/screens/DirectMessageScreen.tsx:2946-2955`
- `src/screens/DirectGroupChat.tsx:2757-2766`

```ts
const [imageUrl, thumbnailUrl] = await Promise.all([
  withTimeout(uploadImageToStorage(processed.originalUri, convId, clientId, false),
    mediaUploadTimeoutMs(processed.fileSize), 'media-upload'),
  withTimeout(uploadImageToStorage(processed.thumbnailUri, convId, clientId, true),
    60000, 'media-upload'),
]);
```

**Notes:**
- Stays inside the same `enqueueMediaUpload` slot — the queue's
  MAX_CONCURRENT=2 counts sends, not PUTs; a thumbnail is small so bandwidth
  contention is negligible.
- On failure of either, behavior matches today: the send fails and existing
  retry/outbox handling applies (both are keyed by clientId, `upsert: false`
  path unchanged since paths are per-message).
- Also check `src/services/messaging/imageUploadRecovery.ts:101-107` — same
  serial pattern in the retry path; apply the same parallelization.

**Acceptance:**
- Photo send time drops by roughly the thumbnail upload+presign time (~0.5-1s).
- Failed-send retry path still works.

---

## Testing (per Ohad's flow: code review + tsc, then on-device)

- `npx tsc --noEmit` clean.
- Device: send photo, multi-photo batch, 30s video, in both a DM and a group
  chat; verify received rendering on a second account.
- Regression watch: the uncommitted 2026-07-15 media fixes (video retry,
  size-aware timeout, batch queue) touch the same lines — implement on top of
  that working tree, not around it.
