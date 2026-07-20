# WhatsApp-style Chat Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver chat videos through a single client-side compression pass (WhatsApp model) so they stop looking blurry, and stop serving the double-compressed MediaConvert output.

**Architecture:** The player already signs the uploaded `storage_path` on demand, but the `sign-dm-video` edge function *prefers* the MediaConvert `processed/` output whenever it exists — that's the double-lossy file. Flip that preference to the uploaded original (Task 1, the actual fix, OTA-able), stop the now-pointless MediaConvert poll (Task 2), then make the single client pass good quality on both platforms (iOS bitrate check — Task 3; add an Android transcoder — Task 4).

**Tech Stack:** React Native 0.81 / Expo 54, TypeScript, Supabase Edge Functions (Deno), AWS S3 + MediaConvert (Lambda, out of repo), iOS `AVAssetExportSession` (Swift Expo module), `react-native-compressor` (new, Android).

## Global Constraints

- **No Jest/simulator tests in this project.** Verification = `npx tsc --noEmit` (must stay clean) + the on-device checklist in each task. Ohad tests on device himself. (memory: no-sim/Maestro testing)
- **Do NOT commit.** Stage the listed paths; Ohad reviews and commits manually. Never `git commit -a` / `git reset --hard` (Ohad edits in parallel). (memory: never-reset-hard)
- **Edge function deploys:** download the LIVE version and diff before editing — the live fn may be AHEAD of the repo. Deploy via CLI (`supabase functions deploy process-profile-video-s3 --use-api`) and **preserve the existing `verify_jwt` setting** (do not flip it). (memory: edge-fn-deploy-via-cli, security-hardening)
- **Native modules must guard for Expo Go** with `isExpoGo` from `src/utils/keyboardAvoidingView` — a bare `require()` of a missing native module trips the global error handler even inside try/catch. (memory: ohad-tests-in-expo-go)
- **Never change the picker's `videoExportPreset`** — it stays Passthrough on purpose (non-Passthrough hangs the picker). (memory: chat-media-upload-speed)
- Target compression profile (both platforms): H.264 **Baseline or Main** profile, **no B-frames**, faststart (moov before mdat), 720p, ~1500 kbps video + ~128 kbps AAC. "High profile + B-frames" breaks some Android WhatsApp-adjacent decoders.

---

### Task 1: Serve the uploaded original, not the MediaConvert output (the fix)

The one change that fixes the blurry video. OTA-able — no app rebuild.

**Files:**
- Modify: `supabase/functions/process-profile-video-s3/index.ts:363-371` (the `sign-dm-video` key-selection block)

**Interfaces:**
- Consumes: `s3ObjectExists(key)`, `generatePresignedUrl('GET', key, ttl)`, `originalKey`, `processedKey` (all already defined earlier in the same handler).
- Produces: unchanged response shape `{ success, ready, videoUrl }`.

- [ ] **Step 1: Download the live edge function and diff against the repo**

```bash
supabase functions download process-profile-video-s3 --project-ref <ref>
# diff the downloaded index.ts against supabase/functions/process-profile-video-s3/index.ts
# Reconcile any live-ahead drift into the repo file BEFORE editing, so deploy doesn't regress the live fn.
```
Expected: either no diff, or you fold live-only changes into the repo copy first.

- [ ] **Step 2: Flip the key preference to the uploaded original**

Replace the block at `index.ts:363-371`:

```typescript
      // Prefer the compressed version; fall back to the original while MediaConvert
      // is still running. Short TTL — long enough for a viewing session, no longer.
      const SIGN_TTL_SECONDS = 6 * 60 * 60
      let keyToSign: string | null = null
      if (await s3ObjectExists(processedKey)) {
        keyToSign = processedKey
      } else if (await s3ObjectExists(originalKey)) {
        keyToSign = originalKey
      }
```

with:

```typescript
      // WhatsApp-style single-pass delivery: the uploaded file is already
      // client-compressed (H.264 720p on iOS), so serving MediaConvert's
      // processed/ output would be a SECOND lossy re-encode — that's what made
      // chat videos blurry. Serve the uploaded original directly. Fall back to
      // the processed output only for legacy messages whose original is gone.
      const SIGN_TTL_SECONDS = 6 * 60 * 60
      let keyToSign: string | null = null
      if (await s3ObjectExists(originalKey)) {
        keyToSign = originalKey
      } else if (await s3ObjectExists(processedKey)) {
        keyToSign = processedKey
      }
```

- [ ] **Step 3: Deploy the edge function**

```bash
supabase functions deploy process-profile-video-s3 --use-api --project-ref <ref>
```
Expected: deploy succeeds; `verify_jwt` unchanged from its current value. Confirm the profile-video flow (`get-processed-url` for non-DM) is untouched — only the `sign-dm-video` branch changed.

- [ ] **Step 4: On-device verification**

  - Send a new video in a DM on iOS. Reopen it after ~2 min (long enough that MediaConvert would have finished). It must play **sharp** (the uploaded 720p file), not soft.
  - Open an **old** video message (sent before this deploy). It must still play (falls back to `processedKey` if its original was cleaned up).
  - Send a video in a group chat — same sharp result.

- [ ] **Step 5: Stage for Ohad to commit**

```bash
git add supabase/functions/process-profile-video-s3/index.ts
# Ohad reviews & commits. Suggested message:
# fix(video): serve uploaded original for DM video, not double-compressed MediaConvert output
```

---

### Task 2: Remove the now-pointless MediaConvert poll

With Task 1, `video_url` (the processed URL the poll writes) is only a last-resort fallback the player rarely reaches. The 28×15s poll is wasted network and reinforces the ~7-min "processing" wait we're eliminating. Remove it. OTA-able.

**Files:**
- Modify: `src/screens/DirectMessageScreen.tsx:3497-3501` and `:3760-3762` (two poll call sites)
- Modify: `src/screens/DirectGroupChat.tsx:3303-3305` and `:3580-3582` (mirror sites)
- Modify: `src/services/messaging/videoUploadService.ts:501-560` (delete the unused `pollForProcessedDmVideo` export)

**Interfaces:**
- Consumes: `uploadAndCreateVideo(...)` still returns `{ created, videoMetadata, thumbnailUri, processedKey }` — leave its shape unchanged; just stop reading `processedKey`.
- Produces: no new interface.

- [ ] **Step 1: Remove the poll at `DirectMessageScreen.tsx:3497-3501`**

Delete these lines:

```typescript
      // Poll for the processed (compressed) video in the background using the REAL
      // server id; the compressed video_url is swapped in via Realtime when ready.
      const { pollForProcessedDmVideo } = await import('../services/messaging/videoUploadService');
      pollForProcessedDmVideo(created.id, processedKey, videoMetadata)
        .catch(err => console.error('Background video poll error:', err));
```

And change the destructure two lines up (`:3482`) from:

```typescript
      const { created, videoMetadata, processedKey } = await enqueueMediaUpload(() =>
```

to (drop the unused `processedKey`):

```typescript
      const { created, videoMetadata } = await enqueueMediaUpload(() =>
```

- [ ] **Step 2: Remove the poll at `DirectMessageScreen.tsx:3760-3762`**

Delete:

```typescript
        const { pollForProcessedDmVideo } = await import('../services/messaging/videoUploadService');
        pollForProcessedDmVideo(created.id, processedKey, videoMetadata)
          .catch(err => console.error('Background video poll error:', err));
```

And change the destructure at `:3750` from `{ created, videoMetadata, processedKey }` to `{ created, videoMetadata }`.

- [ ] **Step 3: Apply the identical two removals in `DirectGroupChat.tsx`** (sites at `:3303-3305`/destructure `:3287`, and `:3580-3582`/destructure `:3571`). The surrounding code is line-for-line the same; make the same edits.

- [ ] **Step 4: Delete the dead `pollForProcessedDmVideo` function**

Remove `src/services/messaging/videoUploadService.ts:501-560` (the whole `export async function pollForProcessedDmVideo(...)` block and its doc comment). Leave `get-processed-url` in the edge function — the profile-video flow still uses it.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If it flags `processedKey` unused anywhere else, remove that read too. No reference to `pollForProcessedDmVideo` should remain (`grep -rn pollForProcessedDmVideo src` returns nothing).

- [ ] **Step 6: On-device verification**

Send a video (DM + group). It sends and plays exactly as before; no functional change beyond the missing background poll. Watch the logs — no more `Polling for processed video` lines.

- [ ] **Step 7: Stage for Ohad to commit**

```bash
git add src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx src/services/messaging/videoUploadService.ts
# Suggested message:
# refactor(video): drop MediaConvert poll now that DM video serves the single-pass upload
```

---

### Task 3: Verify (and if needed, pin) the iOS transcode bitrate

After Task 1, iOS chat videos play the `AVAssetExportPreset1280x720` output. That preset is usually ~2–3 Mbps 720p (fine), but confirm it before assuming — if Apple's preset comes out too low, pin the bitrate. Native change → dev build required.

**Files:**
- (Measure only, first) — no change unless the sample proves the preset too low
- Modify (only if needed): `modules/swellyo-video-export/ios/SwellyoVideoExportModule.swift:35-52`

**Interfaces:**
- Consumes: nothing new.
- Produces: `transcode(path)` still resolves the output `file://` URL — signature unchanged.

- [ ] **Step 1: Measure the current preset output**

Send a real 1080p/4K ~30s clip on an iOS dev build. Pull the transcoded file (or read the `[videoTranscode] export complete` log line for the output KB) and check bitrate: `ffprobe -v error -show_entries format=bit_rate -of default=nk=1:nw=1 <file>` (or `bytes*8/seconds`).
Expected: if ≥ ~1500 kbps and it looks sharp on-device after Task 1 → **stop here, Task 3 is done, no code change.**

- [ ] **Step 2 (only if too low): Switch to a bitrate-pinned export**

Replace the `AVAssetExportSession(asset:presetName:)` block at `SwellyoVideoExportModule.swift:36-52` with an `AVAssetExportPresetHighestQuality` export, or an `AVAssetWriter` pipeline pinned to `AVVideoAverageBitRateKey: 2_000_000`, `AVVideoProfileLevelH264MainAutoLevel` (Main profile, no B-frames), 1280×720, keeping:

```swift
      session.outputFileType = .mp4
      session.shouldOptimizeForNetworkUse = true   // faststart — keep this
```

Only implement this branch if Step 1 proved it necessary; otherwise it's YAGNI.

- [ ] **Step 3: Rebuild + on-device verification** (if Step 2 ran)

Rebuild the iOS dev client (native change — never OTA onto an old build). Send the same clip; confirm sharp playback and file size in the WhatsApp ballpark (~4–6 MB for 30s).

- [ ] **Step 4: Stage for Ohad to commit** (if Step 2 ran)

```bash
git add modules/swellyo-video-export/ios/SwellyoVideoExportModule.swift
# Suggested message:
# feat(video): pin iOS chat-video transcode to ~2Mbps 720p Main profile
```

---

### Task 4: Add an Android client transcode (WhatsApp-style upload)

Today Android has no client transcode: after Task 1 it uploads (and plays) the raw camera original — great quality but a huge, slow upload. Add a single on-device pass so Android matches WhatsApp's fast upload. Native module → dev build required.

**Files:**
- Modify: `package.json` (add `react-native-compressor`)
- Modify: `src/services/messaging/videoTranscode.ts` (route Android through the compressor)
- Create: `src/services/messaging/androidVideoCompress.ts` (thin, Expo-Go-guarded wrapper)

**Interfaces:**
- Consumes: `transcodeVideoForUpload(uri, hints)` from `videoTranscode.ts` — call sites unchanged.
- Produces: `compressAndroidVideo(uri: string): Promise<string | null>` — resolves a `file://` output URI, or `null` when unavailable/failed (same contract as the iOS `transcodeVideo`).

- [ ] **Step 1: Install the dependency**

```bash
npm install react-native-compressor
```
Expected: added to `package.json`. (Native autolinking picks it up on the next dev build.)

- [ ] **Step 2: Write the Expo-Go-guarded Android wrapper**

Create `src/services/messaging/androidVideoCompress.ts`:

```typescript
/**
 * Android single-pass video compression (WhatsApp-style) via react-native-compressor.
 * Mirrors the iOS swellyo-video-export contract: resolves a file:// output URI,
 * or null when the native module is unavailable (Expo Go) or the compress fails —
 * callers then upload the original, since shrinking is an optimisation, not a
 * requirement.
 */
import { Platform } from 'react-native';

export async function compressAndroidVideo(uri: string): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  // Expo Go guard: the native module isn't linked there, and a bare require of a
  // missing native module trips RN's global error handler even inside try/catch.
  let isExpoGo = false;
  try {
    ({ isExpoGo } = require('../../utils/keyboardAvoidingView'));
  } catch {}
  if (isExpoGo) return null;

  try {
    const { Video } = require('react-native-compressor');
    // 'auto' targets a WhatsApp-like resolution/bitrate. H.264 output, single pass.
    const output: string = await Video.compress(uri, { compressionMethod: 'auto' });
    if (!output) return null;
    return output.startsWith('file://') ? output : `file://${output}`;
  } catch (e) {
    console.warn('[androidVideoCompress] compress failed — uploading original:', e);
    return null;
  }
}
```

- [ ] **Step 3: Route Android through the compressor in `videoTranscode.ts`**

At the top of `transcodeVideoForUpload` (`videoTranscode.ts:72`), before the existing `Platform.OS === 'web' || !isVideoExportAvailable` guard, add an Android branch that runs the compressor when `shouldTranscode(hints)` is true:

```typescript
  if (Platform.OS === 'android') {
    if (!shouldTranscode(hints)) {
      return { uri, transcoded: false, skipReason: 'not-worth-it' };
    }
    const { compressAndroidVideo } = require('./androidVideoCompress');
    const startedAt = Date.now();
    const outputUri = await compressAndroidVideo(uri);
    if (!outputUri) {
      return { uri, transcoded: false, skipReason: 'unavailable' };
    }
    const originalBytes = hints?.fileSize || (await fileSizeOf(uri));
    const finalBytes = await fileSizeOf(outputUri);
    if (finalBytes > 0 && originalBytes > 0 && finalBytes >= originalBytes) {
      return { uri, transcoded: false, skipReason: 'no-gain', originalBytes, finalBytes };
    }
    const savedPct = originalBytes > 0 ? Math.round((1 - finalBytes / originalBytes) * 100) : 0;
    console.log(
      `[videoTranscode] android compress — ${Math.round(originalBytes / 1024)}KB → ` +
      `${Math.round(finalBytes / 1024)}KB (saved ${savedPct}%) in ${Date.now() - startedAt}ms`,
    );
    return { uri: outputUri, transcoded: true, originalBytes, finalBytes };
  }
```

The existing iOS/web logic below stays as-is (the `!isVideoExportAvailable` path still covers web and old iOS builds).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Rebuild + on-device verification**

Rebuild the Android dev client (native module — never OTA onto a build without it). Then:
  - Send a large (>4MB) video from Android. Logs show `[videoTranscode] android compress — … saved N%`. Upload is visibly faster than the raw original.
  - Recipient on **iOS** can play it (confirms H.264 Baseline/Main, no B-frames — if it fails to decode, switch `compressionMethod: 'auto'` to `manual` with `bitrate` + a Baseline profile).
  - Send a small (<4MB) clip: it skips compression (`not-worth-it`) and sends instantly.
  - In Expo Go: sending still works (uploads original, no crash).

- [ ] **Step 6: Stage for Ohad to commit**

```bash
git add package.json package-lock.json src/services/messaging/androidVideoCompress.ts src/services/messaging/videoTranscode.ts
# Suggested message:
# feat(video): single-pass Android chat-video compression (react-native-compressor)
```

---

## Follow-ups (out of scope, note only)

- **Retry re-transcodes.** `handleRetryUpload` re-runs `uploadAndCreateVideo` from the original `sourceUri`, so a failed send re-transcodes on retry. Minor CPU cost; optimize later by caching the transcoded URI on the optimistic row.
- **AWS Lambda / MediaConvert** can stay live (its output is now unused for chat) or be disabled out-of-band later to cut cost. Not required by this plan.
- **Web** uploads the original (no browser transcode). Web is effectively unused; revisit only if that changes.

## Self-Review

- **Spec coverage:** single client pass (Tasks 3+4) ✓; serve uploaded file / drop server re-encode (Task 1) ✓; drop 7-min wait (Tasks 1+2) ✓; private presigned signing preserved (Task 1 keeps `sign-dm-video` + TTL) ✓; UX optimistic/progress/retry already built, unchanged ✓; backward compat for old `video_url` messages (Task 1 fallback + Step 4 test) ✓; H.264 Baseline/no-B-frames/faststart (Global Constraints + Task 3/4 tests) ✓.
- **Placeholder scan:** `<ref>` in deploy commands is the real Supabase project ref (fill at run time); every code step shows complete code. No TBD/TODO.
- **Type consistency:** `compressAndroidVideo` returns `Promise<string | null>` (matches `transcodeVideo`); `TranscodeResult` fields (`uri`, `transcoded`, `skipReason`, `originalBytes`, `finalBytes`) match `videoTranscode.ts`; `uploadAndCreateVideo` return shape left intact, only `processedKey` read is dropped.
