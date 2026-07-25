# Profile Video Upload Fix — Spec

**Goal:** the onboarding surf-video upload must never degrade the user's first session, and a killed app must never silently lose the video.

## The problem (plain English)

When a new user taps **Next** on the onboarding video step, the app starts uploading their video in the background and moves on (`OnboardingVideoUploadScreen.tsx:425-428`). Three things are wrong with it:

1. **It uploads the raw camera-roll original.** Often 4K HEVC — ~180 MB for 30 seconds. The upload runs for minutes and fights with everything the first session needs to download (profile, trips feed, images). Field replays show exactly this window as the "laggy / stuck" period.
2. **If the user kills the app, the video is gone.** No retry, no resume. And "kill the app" is exactly what users do when the first session feels stuck — so the bug eats its own evidence. This matches `profile_video_thumbnail_url` being almost always null historically.
3. **Nothing reports it.** No analytics on upload start/size/duration/fail, so we never saw it in the field.

Chat media already solved problem 1: `transcodeVideoForUpload` (src/services/messaging/videoTranscode.ts) shrinks a video to H.264 720p natively (a few seconds of CPU, off the JS thread), typically ~10× smaller, and **never throws** — every failure path returns the original file. The onboarding upload just doesn't use it.

## The fix (3 parts)

### Part 1 — Shrink before upload
In the onboarding flow, before `uploadProfileVideoS3` sends bytes:
- Call `transcodeVideoForUpload(videoUri, hints)` first. Upload the returned uri.
- Hints come from the picker asset (`fileSize`, `width`, `height`) — the screen must keep them alongside `userVideoUri` (today it keeps only uri + mimeType).
- After a successful transcode the uploaded file is mp4 → content type stays `video/mp4` (already hardcoded in the PUT).
- iOS-only module: on Android / Expo Go / old builds it returns the original and logs `SKIPPED (unavailable)` — same graceful behavior chat has. No new failure modes.
- Expected result: ~180 MB → ~15-25 MB. The upload window shrinks from minutes to seconds.

### Part 2 — Survive an app kill (copy + resume)
- **Copy the picked video into the app's documents folder first** (cheap local file copy) and upload from that copy. Picker files live in tmp/caches and can vanish; documents survive restarts.
- **Persist a small "pending upload" record in AsyncStorage**: `{ localUri, userId, mimeType, createdAt, attempts }`. Write it when the upload starts; delete it on success AND delete the local copy.
- **On app start** (after session restore): if a pending record exists, the file exists, and `attempts < 3` → retry the upload in the background (through the same transcode-then-upload path; the copy is already transcoded so the transcode step will skip as "not worth it"). Bump `attempts`. If the file is missing or attempts are exhausted → delete the record, log one analytics event, give up quietly.
- This turns "killed the app mid-upload" from *video lost forever* into *video arrives on next launch*.

### Part 3 — See it in the field
- Analytics events (via `analyticsService`, the working client): `profile_video_upload_started` (bytes, transcoded true/false), `profile_video_upload_succeeded` (bytes, duration_ms), `profile_video_upload_failed` (reason), `profile_video_upload_resumed` (attempt).
- These double as the experiment readout: after release, compare "first-session lag" reports between users whose event shows `transcoded: true` vs `unavailable`.

## Server side (AWS MediaConvert) — checked, no change needed

The Lambda `swellyo-video-processor` (us-east-1, account 128009599743, **no repo copy exists**) has two inline profiles in `getVideoSettings(profile)`:

- **`dm`** (chat): was 360p/800kbps — the real cause of the 2026-07-17 blurry-chat bug (the "double compression" theory was investigated then and **refuted**: MediaConvert re-encodes to its target regardless of input, so the client transcode never affected quality, only upload speed). Fixed 2026-07-17 to 720p / QVBR 8 / 2.0Mbps.
- **`profile`** (surf/profile videos — this spec's path): **720p / QVBR 7 / 2.5Mbps / HIGH L4 / 128kbps audio** — already good. **Leave it as-is.**

So this spec's flow (client 720p H.264 → MediaConvert 720p re-encode) is exactly the chat flow post-fix. The one risk introduced: MediaConvert now encodes from a second-generation 720p file instead of the 4K original (chat already lives with this). Acceptance criterion 6 below covers it; the escape hatch if profile videos look soft is a one-line Lambda tweak (`profile` branch QVBR 7 → 8), deployed via `aws lambda update-function-code` — no app change, no OTA.

Related S3 fact that must not regress: `uploads/` self-deletes after 1 day (lifecycle rule) — the durable file is always `processed/…_compressed.mp4`. This spec never serves `uploads/` URLs.

## What this spec does NOT change
- The picker stays on Passthrough (never set `videoExportPreset` — it blocks the picker; see memory + videoTranscode.ts comments).
- `pollForProcessedVideo` (MediaConvert wait) stays as-is.
- The fire-and-forget shape stays — the user still never waits on the upload. Shrinking + resuming makes background safe; forcing the user to wait is worse UX and unnecessary.
- Web keeps today's path (module unavailable → original file), unchanged behavior.

## Files touched
- `src/screens/OnboardingVideoUploadScreen.tsx` — keep asset hints; on Next: copy to documents → write pending record → transcode → upload.
- `src/services/storage/storageService.ts` — `uploadProfileVideoS3`: accept a pre-shrunk file; on success delete pending record + local copy; analytics hooks.
- NEW `src/services/media/pendingProfileVideoUpload.ts` — the AsyncStorage record + `resumePendingProfileVideoUpload()` helper.
- `src/components/AppContent.tsx` (or OnboardingContext post-restore hook) — one call to `resumePendingProfileVideoUpload()` after session restore, fire-and-forget with `.catch`.
- `src/components/ProfileEditPanel/ProfileEditSurfVideoScreen.tsx` — same transcode adoption for the profile-edit re-upload path (same bug, same fix).

## Acceptance criteria
1. Picking a 4K video and finishing onboarding uploads a file ~10× smaller (verify via the `[videoTranscode] export complete` log + S3 object size).
2. Kill the app mid-upload → reopen → the video uploads within a minute, and the profile shows it after MediaConvert finishes.
3. On Android/Expo Go the flow behaves exactly as today (original uploads, no errors).
4. All 4 analytics events visible in PostHog after a device test run.
5. `npx tsc --noEmit` shows no new errors; jest tests for the pending-record helper (write/read/clear/attempt-cap) pass.
6. **Quality check (device):** the processed profile video (the `processed/` MediaConvert output, i.e. what other users see on the profile) looks sharp — compare side by side with an old profile video uploaded from a raw original. If soft → bump the Lambda `profile` branch QVBR 7→8 (see Server side section); do NOT touch the client transcode.

## Test notes (no simulator — Ohad tests on device)
- Device A (iOS, real build): record/pick a large 4K clip, finish onboarding, watch Metro logs for transcode + upload; kill mid-upload; reopen; verify resume.
- Verify by code + tsc for the Android fallback (module returns null → original path).

## Status
- [x] Spec approved
- [x] Implementation (2026-07-25) — see note below
- [ ] Device test (Ohad)
- [ ] Ship — OTA-able ✔ (reuses the `swellyo-video-export` native module already in builds 45/46; verified `git merge-base` that module commit is an ancestor of build 45)

### Implementation note (what shipped vs the spec)
One deliberate deviation from the file list: the pending-record cleanup + analytics live in the new orchestrator, NOT inside `uploadProfileVideoS3` — putting them in `storageService` would create a circular import (storageService ↔ pending helper). `uploadProfileVideoS3` stays the pure byte-mover, untouched. Same behavior, cleaner seam.

Files actually changed:
- NEW `src/services/media/pendingProfileVideoUpload.ts` — record CRUD + `startProfileVideoUpload()` orchestrator (transcode → durable copy → record → upload → cleanup + analytics) + `resumePendingProfileVideoUpload()`. Durability is best-effort: if the FS copy fails (e.g. an uncopyable `ph://`/`content://` source) it degrades to a plain direct upload (today's behavior), never breaks the upload.
- NEW `src/services/media/__tests__/pendingProfileVideoUpload.test.ts` — 9 tests, record CRUD + attempt cap. Green.
- `src/screens/OnboardingVideoUploadScreen.tsx` — captures picker hints (w/h/fileSize), `handleNext` → `startProfileVideoUpload`.
- `src/components/ProfileEditPanel/ProfileEditSurfVideoScreen.tsx` — same hint capture + switch to `startProfileVideoUpload`.
- `src/components/AppContent.tsx` — `resumePendingProfileVideoUpload()` fired once post-auth (gated on `shouldShowConversations`, fire-and-forget), alongside push registration.

Verification: `npx tsc --noEmit` = 172 errors (no new ones; the one AppContent error is the pre-existing trip-type mismatch). Media/transcode/timeout suites: 34/34 green.
