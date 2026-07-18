# Chat Video: WhatsApp-style single-pass compression

**Date:** 2026-07-17
**Author:** Ohad
**Status:** Draft — pending review

## Problem

Chat videos ship at noticeably degraded quality: the poster/thumbnail is sharp, but the played video is soft/blurry. This started after we added a client-side compression "preset" step to speed up uploads.

Root cause is **double lossy encoding**:

```
Original → [client transcode: 720p H.264 (iOS only)] → [AWS MediaConvert re-encode] → delivered video
```

Before the client transcode was added, the pipeline was `Original → MediaConvert → delivered` (a **single** lossy pass) and quality was fine. The client transcode was added to shrink the upload, but it feeds an already-degraded input into MediaConvert, which re-compresses it again. MediaConvert cannot recover detail the client step already discarded.

Confirmed details from the current codebase:
- Picker is left at **Passthrough** (original) — intentional, to avoid a picker-hang bug. Do not change.
- Client transcode: `modules/swellyo-video-export/` (`AVAssetExportPreset1280x720`, mp4, `shouldOptimizeForNetworkUse = true`), gated by `src/services/messaging/videoTranscode.ts` (`shouldTranscode()`: only when `fileSize > 4MB` or max dimension `> 1280px`). **iOS only** — Android/web get no client transcode.
- Upload + presign + MediaConvert polling: `src/services/messaging/videoUploadService.ts` (S3 presigned PUT, `pollForProcessedDmVideo()` polls `processed/..._compressed.mp4`, backfills `messages.video_metadata.video_url`).
- MediaConvert itself is an **AWS Lambda outside this repo**, triggered by the S3 upload. The repo only presigns URLs and polls S3 for the `_compressed.mp4` output via edge fn `supabase/functions/process-profile-video-s3/index.ts`.
- Send orchestration + optimistic bubble: `src/screens/DirectMessageScreen.tsx` (~3288–3518), mirrored in `src/screens/DirectGroupChat.tsx`.
- Viewer: `src/components/FullscreenVideoPlayer.tsx`; grouped-media bubble: `src/components/MediaAlbumBubble.tsx`.

## Goal

Match WhatsApp's model: **one compression pass, on the client, and that file is the final delivered file.** No server-side re-encode of chat video. Preserve (and improve) the already-good upload UX.

Non-goals:
- Changing the AWS Lambda / MediaConvert job settings (out of repo).
- Touching the profile surf-video flow (separate, public S3 URL).
- Touching the picker's Passthrough setting.

## What WhatsApp actually does (research summary)

- **Single client-side pass**: H.264, 480p (Standard) / 720p (HD), ~1000–1500 kbps video + ~128 kbps AAC. That file is final; no verified server re-encode on a single send. (Meta Cloud API media docs; 9to5mac HD-toggle coverage.)
- **Compatibility**: H.264 Baseline/Main profile, **no B-frames**, faststart (moov before mdat). "High profile + B-frames" is a documented Android-client landmine.
- **UX**: optimistic bubble with local thumbnail → pending/clock state → background upload via an outbox that survives reconnect → automatic retry → clock clears on server ack.

## Design

### 1. Compression — one pass, on the client

- **iOS**: keep `swellyo-video-export`. Verify/raise output quality so it is the *final* deliverable, not a pre-pass:
  - Confirm the 720p preset yields ≥ ~1500 kbps (WhatsApp HD target). `AVAssetExportPreset1280x720` is a fixed-quality preset; if its bitrate is too low, switch to a bitrate-controlled export (`AVAssetExportSession` with an explicit video bitrate / `AVAssetWriter`) so we can pin ~1500 kbps, Baseline/Main profile, no B-frames.
  - Keep `shouldOptimizeForNetworkUse = true` (faststart ✓).
- **Android**: add a client transcode with the same target (720p / ~1500 kbps H.264 Baseline, AAC). Use `react-native-compressor` (`Video.compress`, `compressionMethod: 'auto'` or `manual` with pinned bitrate). This is a **native module** → needs a dev build, guard load with `isExpoGo` (returns "no transcode" in Expo Go, same contract as `swellyo-video-export`).
- **Web**: no client transcode (browsers can't transcode cheaply; web is effectively unused). Web uploads the original.
- Keep the existing `shouldTranscode()` gate philosophy (skip tiny clips, discard if output is larger than input).

### 2. Delivery — serve the uploaded file, drop the MediaConvert dependency

- The client-compressed upload becomes the **final** asset. Stop swapping the message to the MediaConvert `_compressed.mp4` output.
- **Do not** call/await `pollForProcessedDmVideo()` for chat video anymore (removes the ~7-min processing wait; video is ready when the upload finishes).
- Privacy/signing unchanged in mechanism: DM videos stay private and are served via on-demand presigned GET (`sign-dm-video`), but the signed object is now the **uploaded file** (`uploads/dm/{conversationId}/{messageId}/...`) instead of the `processed/..._compressed.mp4`. This keeps re-signable, non-expiring-by-design access (URLs are re-signed on demand, cached ~5 min client-side).
- The AWS Lambda can remain live and harmless (its output is simply unused), or be disabled later out-of-band. **This spec does not depend on turning it off.**

### 3. Upload UX — WhatsApp-style (mostly already built)

Already present, keep:
- Optimistic bubble at ~0ms with `_localPreviewUri` / `_localVideoUri` and `upload_state: 'uploading'`.
- Byte-level progress ring (`createUploadTask` / XHR), size-aware timeout, `enqueueMediaUpload` serialization.
- Failed state + Retry button.

Improvements to reach WhatsApp parity:
- **Order**: transcode → upload → *then* create the server row is fine; but make sure the compressed file (not the raw original) is what uploads. On Android this means the new transcode runs before upload, in background, without blocking the optimistic bubble (mirror the iOS placement at `DirectMessageScreen.tsx:3310`).
- **Retry robustness**: on failure, retry should re-use the already-transcoded file (don't re-transcode). Persist enough state on the optimistic row to resume.

## Data flow (new)

```
pick (Passthrough original)
  → optimistic bubble (local thumbnail, ~0ms)        [unchanged]
  → client transcode → final file
       iOS: swellyo-video-export (720p ~1500kbps)
       Android: react-native-compressor (720p ~1500kbps)
       web: skip (upload original)
  → upload final file to S3 (uploads/dm/{conv}/{msg}/...) with progress ring
  → create server message row, video_metadata points at the uploaded object
  → viewers sign the uploaded object on demand (sign-dm-video) and play it
  (no MediaConvert poll, no video_url swap)
```

## Error handling

- Native transcode module missing / Expo Go / web → skip transcode, upload original (existing fallback contract).
- Transcode output larger than input → keep original (`no-gain`, existing).
- Upload failure → optimistic row → `failed` + Retry (reuse transcoded file, no re-transcode).
- Signing failure on view → viewer already handles `videoUrl === null` (still-signing) gracefully.

## Testing / acceptance criteria

- [ ] iOS: a 1080p ~30s clip sent in chat plays back visibly sharp (no soft/blurry frames); file size in the WhatsApp ballpark (~4–6 MB).
- [ ] Android: same clip transcodes on-device to 720p H.264 and plays back sharp; verify it plays on iOS recipient (Baseline/Main profile, no B-frames).
- [ ] No 7-min wait: video is playable for the recipient as soon as the upload completes.
- [ ] Small clips (< 4MB, ≤ 720p) still skip transcode and send instantly.
- [ ] Retry after a forced upload failure does not re-transcode and succeeds.
- [ ] Expo Go / web: still send (original upload), no crash.
- [ ] Old messages that still point at a MediaConvert `video_url` continue to play (backward compat — viewer falls back correctly).

## Open questions / decisions to confirm in the plan

- Exact iOS bitrate mechanism: is `AVAssetExportPreset1280x720` already ~1500 kbps, or do we need an `AVAssetWriter`-based bitrate-pinned export? (Measure a sample first.)
- Backward compatibility: messages created before this change have `video_url` = MediaConvert output. Confirm the viewer prefers `video_url` when present and falls back to signing the uploaded object otherwise, so old and new messages both play.
- Whether to leave the AWS Lambda running (unused) or schedule its removal separately.
