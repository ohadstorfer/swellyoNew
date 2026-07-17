# Chat Media Upload Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three chat-media bugs: (1) video retry uploads the thumbnail JPEG instead of the video, (2) a flat 60s timeout kills legitimate large-video uploads and leaves zombie transfers running, (3) batch sends fire all uploads concurrently and cascade-fail.

**Architecture:** Add a size-aware timeout helper and a concurrency-limited send queue as small pure modules in `src/services/messaging/`. Make `uploadVideoToS3` own its timeout with real cancellation (`createUploadTask` on native, `AbortController` on web). In both chat screens, store the real video URI on the optimistic row (`_localVideoUri`) so retry re-uploads the video, and route all media uploads through the queue.

**Tech Stack:** React Native 0.81 / Expo 54, expo-file-system (legacy), Supabase Storage + S3 presigned uploads, Jest (jest-expo).

## Global Constraints

- **Do NOT commit** — Ohad reviews and commits manually (no `git commit` steps in this plan).
- Both `src/screens/DirectMessageScreen.tsx` and `src/screens/DirectGroupChat.tsx` carry mirrored copies of the send/retry code — every screen change lands in BOTH.
- Never fall back to `_localPreviewUri` as a video source — for videos it is the poster JPEG. That fallback IS bug 1.
- Verify with `npx tsc --noEmit` and `npx jest` — no simulator/Maestro testing (Ohad tests on-device).
- Error UX stays as-is: failures mark the optimistic row `upload_state: 'failed'` and show the existing friendly alert.

---

### Task 1: Size-aware upload timeout helper

**Files:**
- Modify: `src/services/messaging/withTimeout.ts`
- Test: `src/services/messaging/__tests__/withTimeout.test.ts` (create or extend if it exists)

**Interfaces:**
- Produces: `mediaUploadTimeoutMs(sizeBytes: number): number` — exported from `withTimeout.ts`. Used by Tasks 3, 4, 5.

- [ ] **Step 1: Write the failing test**

```ts
import { mediaUploadTimeoutMs } from '../withTimeout';

describe('mediaUploadTimeoutMs', () => {
  it('returns the 2-minute floor for tiny/unknown files', () => {
    expect(mediaUploadTimeoutMs(0)).toBe(120_000);
    expect(mediaUploadTimeoutMs(500_000)).toBe(125_000); // 0.5MB → +5s
  });

  it('scales ~1s per 100KB (assumes 100 KB/s worst-case uplink)', () => {
    expect(mediaUploadTimeoutMs(10_000_000)).toBe(220_000); // 10MB → 120s + 100s
  });

  it('caps at 10 minutes', () => {
    expect(mediaUploadTimeoutMs(250 * 1024 * 1024)).toBe(600_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/withTimeout.test.ts`
Expected: FAIL — `mediaUploadTimeoutMs` is not exported.

- [ ] **Step 3: Implement**

Append to `src/services/messaging/withTimeout.ts`:

```ts
// Timeout for a media upload sized to the payload. Baseline 2 min covers
// presign round-trips and slow starts; then ~1s per 100KB assumes a
// worst-case ~100 KB/s uplink; capped at 10 min (matches the 250MB max
// video sharing bandwidth with other queued items).
export function mediaUploadTimeoutMs(sizeBytes: number): number {
  const base = 120_000;
  const perByte = Math.ceil((sizeBytes || 0) / 100_000) * 1000;
  return Math.min(600_000, base + perByte);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/withTimeout.test.ts` → PASS

---

### Task 2: Media send queue (concurrency 2)

**Files:**
- Create: `src/services/messaging/mediaSendQueue.ts`
- Test: `src/services/messaging/__tests__/mediaSendQueue.test.ts`

**Interfaces:**
- Produces: `enqueueMediaUpload<T>(fn: () => Promise<T>): Promise<T>` — runs `fn` when a slot (max 2 concurrent) frees up; resolves/rejects with `fn`'s result. Used by Tasks 4, 5.

- [ ] **Step 1: Write the failing test**

```ts
import { enqueueMediaUpload } from '../mediaSendQueue';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('enqueueMediaUpload', () => {
  it('runs at most 2 tasks concurrently', async () => {
    let running = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const results = gates.map(g => enqueueMediaUpload(async () => {
      running++; peak = Math.max(peak, running);
      await g.promise;
      running--;
    }));
    await Promise.resolve(); // let the queue start tasks
    expect(peak).toBe(2);
    gates.forEach(g => g.resolve());
    await Promise.all(results);
    expect(peak).toBe(2);
  });

  it('a rejected task frees its slot and propagates the error', async () => {
    const boom = enqueueMediaUpload(async () => { throw new Error('boom'); });
    await expect(boom).rejects.toThrow('boom');
    await expect(enqueueMediaUpload(async () => 42)).resolves.toBe(42);
  });

  it('preserves FIFO start order', async () => {
    const order: number[] = [];
    const gate = deferred<void>();
    const a = enqueueMediaUpload(async () => { order.push(1); await gate.promise; });
    const b = enqueueMediaUpload(async () => { order.push(2); await gate.promise; });
    const c = enqueueMediaUpload(async () => { order.push(3); });
    await Promise.resolve();
    expect(order).toEqual([1, 2]);
    gate.resolve();
    await Promise.all([a, b, c]);
    expect(order).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/messaging/__tests__/mediaSendQueue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/services/messaging/mediaSendQueue.ts`:

```ts
/**
 * Concurrency-limited queue for chat media uploads (images, videos, files).
 *
 * Why: a multi-item send used to fire every upload at once; N transfers split
 * the uplink so each one crawled past its timeout and the whole batch failed.
 * Optimistic bubbles still appear instantly — only the network transfer waits
 * for a slot. Concurrency 2 keeps one big video from serializing everything
 * while still leaving each transfer most of the bandwidth.
 */
const MAX_CONCURRENT = 2;

let active = 0;
const waiting: Array<() => void> = [];

export function enqueueMediaUpload<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      fn().then(resolve, reject).finally(() => {
        active--;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (active < MAX_CONCURRENT) run();
    else waiting.push(run);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/messaging/__tests__/mediaSendQueue.test.ts` → PASS

---

### Task 3: Cancellable, size-aware timeout inside `uploadVideoToS3`

**Files:**
- Modify: `src/services/messaging/videoUploadService.ts:290-360` (`uploadVideoToS3`)

**Interfaces:**
- Consumes: `mediaUploadTimeoutMs` and `TimeoutError` from `./withTimeout` (Task 1).
- Produces: new signature `uploadVideoToS3(videoUri, conversationId, messageId, timeoutMs?: number)` — same return type. On timeout it CANCELS the transfer (no zombie upload) and throws `TimeoutError('media-upload', timeoutMs)`. Callers (Tasks 4, 5) stop wrapping it in `withTimeout`.

No unit test — this function is pure I/O against expo-file-system and S3; verified by `tsc` + on-device test. (Jest-mocking `createUploadTask` would test the mock, not the behavior.)

- [ ] **Step 1: Rewrite the upload body with cancellation**

Replace the body of `uploadVideoToS3` from the `isNativeFileUri` check down (keep the presign section as-is), and add the `timeoutMs` parameter:

```ts
export async function uploadVideoToS3(
  videoUri: string,
  conversationId: string,
  messageId: string,
  timeoutMs: number = 600_000,
): Promise<{ s3Key: string; processedKey: string; originalUrl: string }> {
  // ... existing presign code unchanged ...

  const isNativeFileUri = Platform.OS !== 'web' &&
    (videoUri.startsWith('file://') || videoUri.startsWith('content://') || videoUri.startsWith('ph://'));

  if (isNativeFileUri) {
    // Native: createUploadTask (not uploadAsync) so a timeout can actually
    // cancel the transfer. A dangling upload otherwise keeps eating uplink
    // bandwidth and starves the retry / the rest of the batch.
    const LegacyFS = require('expo-file-system/legacy');
    const task = LegacyFS.createUploadTask(uploadUrl, videoUri, {
      httpMethod: 'PUT',
      uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'video/mp4' },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        task.uploadAsync(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TimeoutError('media-upload', timeoutMs)), timeoutMs);
        }),
      ]);
      // cancelAsync resolves uploadAsync with undefined — treat as failure.
      if (!result || result.status < 200 || result.status >= 300) {
        throw new Error(`S3 upload failed: ${result?.status} ${result?.body?.slice(0, 200)}`);
      }
    } catch (err) {
      task.cancelAsync().catch(() => {});
      throw err;
    } finally {
      clearTimeout(timer);
    }
  } else {
    let uploadBody: Blob;
    if (videoUri.startsWith('data:')) {
      uploadBody = dataURLtoBlob(videoUri);
    } else {
      uploadBody = await uriToBlob(videoUri);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const s3Response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: uploadBody,
        signal: controller.signal,
      });
      if (!s3Response.ok) {
        throw new Error(`S3 upload failed: ${await s3Response.text()}`);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new TimeoutError('media-upload', timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  console.log('[videoUploadService] Video uploaded to S3:', s3Key);
  return { s3Key, processedKey, originalUrl };
}
```

Add the import at the top of the file:

```ts
import { TimeoutError } from './withTimeout';
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → no new errors.

---

### Task 4: DirectMessageScreen — retry URI, timeouts, queue

**Files:**
- Modify: `src/services/messaging/messagingService.ts:192` (Message interface)
- Modify: `src/screens/DirectMessageScreen.tsx` — `uploadAndCreateImage` (~:2897), `handleImageSend` (~:2933), `uploadAndCreateFile` (~:3028), `uploadAndCreateVideo` (~:3203), `handleVideoSend` (~:3243), `handleRetryUpload` (~:3509)

**Interfaces:**
- Consumes: `mediaUploadTimeoutMs` (Task 1), `enqueueMediaUpload` (Task 2), new `uploadVideoToS3` signature (Task 3).
- Produces: `Message._localVideoUri?: string` (shared type, also consumed by Task 5). `uploadAndCreateVideo` gains optional last param `preprocessed?: VideoProcessingResult`.

No new unit tests — screen-level wiring, verified by `tsc` + on-device. All changes below are mirrored in Task 5 for the group screen.

- [ ] **Step 1: Add `_localVideoUri` to the Message type**

In `src/services/messaging/messagingService.ts`, under `_localPreviewUri` (line 192):

```ts
  _localPreviewUri?: string;    // Local file URI used as fallback preview while upload is in flight
  // For videos, _localPreviewUri is the poster JPEG — NOT a valid upload
  // source. The actual local video file lives here so Retry re-uploads the
  // video, never the thumbnail.
  _localVideoUri?: string;
```

- [ ] **Step 2: Imports in DirectMessageScreen.tsx**

Extend the existing `withTimeout` import and add the queue:

```ts
import { withTimeout, mediaUploadTimeoutMs } from '../services/messaging/withTimeout';
import { enqueueMediaUpload } from '../services/messaging/mediaSendQueue';
```

(If `withTimeout` is currently imported elsewhere/differently, extend that import statement instead of duplicating.)

- [ ] **Step 3: `uploadAndCreateImage` — size-aware timeout (~:2905-2914)**

```ts
    const processed = await processImage(localUri);
    const imgTimeout = mediaUploadTimeoutMs(processed.fileSize);
    const imageUrl = await withTimeout(
      uploadImageToStorage(processed.originalUri, convId, clientId, false),
      imgTimeout,
      'media-upload'
    );
    const thumbnailUrl = await withTimeout(
      uploadImageToStorage(processed.thumbnailUri, convId, clientId, true),
      60000,
      'media-upload'
    );
```

- [ ] **Step 4: `handleImageSend` — queue the upload (~:2992)**

```ts
      const { created, imageMetadata } = await enqueueMediaUpload(() =>
        uploadAndCreateImage(conversationId, clientId, uriToUse, caption)
      );
```

- [ ] **Step 5: `uploadAndCreateFile` — size-aware timeout (~:3036-3040)**

```ts
    const { storagePath } = await withTimeout(
      uploadFileToStorage(localUri, convId, clientId, baseMeta.ext),
      mediaUploadTimeoutMs(baseMeta.size_bytes),
      'file-upload',
    );
```

- [ ] **Step 6: `uploadAndCreateVideo` — accept preprocessed result, drop the outer 60s wrapper (~:3203-3216)**

```ts
  const uploadAndCreateVideo = async (
    convId: string,
    clientId: string,
    localUri: string,
    caption: string | undefined,
    videoHints?: any,
    preprocessed?: import('../services/messaging/videoUploadService').VideoProcessingResult,
  ): Promise<{ created: Message; videoMetadata: any; thumbnailUri: string; processedKey: string }> => {
    const { processVideo, uploadVideoToS3, uploadThumbnailToStorage } = await import('../services/messaging/videoUploadService');
    // handleVideoSend already ran processVideo for the poster — reuse it
    // instead of generating the thumbnail a second time.
    const processed = preprocessed ?? await processVideo(localUri, videoHints);
    // uploadVideoToS3 enforces its own size-aware timeout WITH cancellation
    // (a plain withTimeout leaves a zombie transfer eating bandwidth).
    const [uploadResult, thumbnailUrl] = await Promise.all([
      uploadVideoToS3(localUri, convId, clientId, mediaUploadTimeoutMs(processed.fileSize)),
      withTimeout(uploadThumbnailToStorage(processed.thumbnailUri, convId, clientId), 60000, 'media-upload'),
    ]);
```

(Rest of the function unchanged.)

- [ ] **Step 7: `handleVideoSend` — store the real video URI, pass preprocessed, queue the upload**

Optimistic row (~:3316): add `_localVideoUri`:

```ts
      upload_state: 'uploading',
      _localPreviewUri: processed.thumbnailUri,
      _localVideoUri: videoUri,
      video_metadata: posterMetadata,
```

Upload call (~:3329):

```ts
      const { created, videoMetadata, processedKey } = await enqueueMediaUpload(() =>
        uploadAndCreateVideo(conversationId, clientId, videoUri, caption, videoHints, processed)
      );
```

Success swap (~:3337): also clear the new field:

```ts
            ? { ...created, video_metadata: created.video_metadata ?? videoMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined, _localVideoUri: undefined }
```

- [ ] **Step 8: `handleRetryUpload` — use the video URI, never the poster**

At the top of the non-file branch (~:3560-3576), replace the single `localUri` check with per-type source resolution:

```ts
    const mediaType = message.type === 'video' || message.video_metadata
      ? 'video'
      : message.type === 'audio'
        ? 'audio'
        : 'image';
    // Videos MUST retry from _localVideoUri — _localPreviewUri is the poster
    // JPEG, and uploading it as the video is exactly the bug that produced
    // unplayable "sent" videos (thumbnail + dead play button).
    const sourceUri = mediaType === 'video' ? message._localVideoUri : localUri;
    if (!sourceUri) {
      const label = mediaType === 'video' ? 'video' : mediaType === 'audio' ? 'voice message' : 'photo';
      Alert.alert(
        `${mediaType === 'audio' ? 'Voice message' : mediaType === 'video' ? 'Video' : 'Photo'} unavailable`,
        `The original ${label} is no longer available on this device. Remove this message?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => handleRemoveFailedMedia(message) },
        ]
      );
      return;
    }
```

Then in the try block, queue each branch and use `sourceUri` (~:3586-3627):

```ts
      if (mediaType === 'video') {
        const { created, videoMetadata, processedKey } = await enqueueMediaUpload(() =>
          uploadAndCreateVideo(convId, clientId, sourceUri, message.body || undefined)
        );
        setMessages((prev) => {
          const next = prev.map(m =>
            m.id === mid ? { ...created, video_metadata: created.video_metadata ?? videoMetadata, upload_state: 'sent' as const, _localPreviewUri: undefined, _localVideoUri: undefined } : m
          );
          chatHistoryCache.saveMessages(convId, next).catch(() => {});
          return next;
        });
        const { pollForProcessedDmVideo } = await import('../services/messaging/videoUploadService');
        pollForProcessedDmVideo(created.id, processedKey, videoMetadata)
          .catch(err => console.error('Background video poll error:', err));
      } else if (mediaType === 'audio') {
        // unchanged, still uses sourceUri (=== localUri for audio)
        ...uploadAndCreateVoice(convId, clientId, sourceUri, recording, message.reply_to_snapshot ?? null);
      } else {
        const { created, imageMetadata } = await enqueueMediaUpload(() =>
          uploadAndCreateImage(convId, clientId, sourceUri, message.body || undefined)
        );
        // ...unchanged swap
      }
```

Also queue the file-retry branch (~:3535):

```ts
        const { created, fileMetadata } = await enqueueMediaUpload(() =>
          uploadAndCreateFile(convId, clientIdF, localUri, {
            display_name: fm.display_name, ext: fm.ext, mime_type: fm.mime_type, size_bytes: fm.size_bytes,
          }, message.body || undefined)
        );
```

And queue the initial file send inside `handleFileSend` the same way (find its `await uploadAndCreateFile(` call and wrap it in `enqueueMediaUpload(() => ...)`).

- [ ] **Step 9: Stale-upload sweep keeps the video URI**

Check the app-resume sweep around line 1390-1425 (flips stuck `uploading` rows to `failed`): confirm it spreads the existing message (`{ ...m, upload_state: 'failed' }`) so `_localVideoUri` survives. If it rebuilds the object field-by-field, add `_localVideoUri: m._localVideoUri`.

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit` → no new errors.

---

### Task 5: DirectGroupChat — mirror Task 4

**Files:**
- Modify: `src/screens/DirectGroupChat.tsx` — `uploadAndCreateImage` (~:2711 area), `uploadAndCreateVideo` (:3003), `handleVideoSend` (:3043, optimistic row :3116, upload call :3129), `handleRetryUpload` (:3325, video branch :3403), `uploadAndCreateFile`, `handleFileSend`, MediaReviewModal `onSend` (:5966)

**Interfaces:**
- Consumes: everything Task 4 consumes, plus `Message._localVideoUri` added in Task 4 Step 1.

- [ ] **Step 1: Apply every DirectMessageScreen change (Task 4 Steps 2-9) to the mirrored code in DirectGroupChat.tsx**

The group screen's functions are line-for-line mirrors. Apply identically:
- imports (`mediaUploadTimeoutMs`, `enqueueMediaUpload`)
- size-aware timeout in `uploadAndCreateImage` / `uploadAndCreateFile`
- `uploadAndCreateVideo`: `preprocessed` param, `uploadVideoToS3(..., mediaUploadTimeoutMs(processed.fileSize))`, thumbnail keeps 60s `withTimeout`
- `handleVideoSend`: `_localVideoUri: videoUri` on the optimistic row (:3116), `enqueueMediaUpload(() => uploadAndCreateVideo(..., processed))`, clear `_localVideoUri` on the success swap
- `handleImageSend` / `handleFileSend`: wrap `uploadAndCreate*` in `enqueueMediaUpload`
- `handleRetryUpload`: `sourceUri = mediaType === 'video' ? message._localVideoUri : localUri`, unavailable-alert on missing, queue all branches, clear `_localVideoUri` on success
- stale-upload sweep: confirm `_localVideoUri` survives the spread

Diff the two screens' handlers afterward to confirm parity:

```bash
# quick sanity: both screens reference the new symbols the same number of times
grep -c "_localVideoUri" src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
grep -c "enqueueMediaUpload" src/screens/DirectMessageScreen.tsx src/screens/DirectGroupChat.tsx
```

Expected: matching (or near-matching) counts across the two files.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → no new errors.

---

### Task 6: Full verification

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: same error count as before this work (baseline it first if unsure: `git stash && npx tsc --noEmit 2>&1 | wc -l && git stash pop`).

- [ ] **Step 2: Run the messaging test suite**

Run: `npx jest src/services/messaging`
Expected: all pass, including the two new test files.

- [ ] **Step 3: Hand off for on-device testing (Ohad)**

Manual test script:
1. Send one large video (>60 MB) on wifi → should upload (no 60s TimeoutError), play on both ends.
2. Airplane-mode mid-upload → row goes `failed` → Retry with network back → video must actually PLAY on the recipient side (not thumbnail + dead play button).
3. Send a mixed batch of 6+ photos/videos from MediaReviewModal → all bubbles appear instantly, uploads complete 2-at-a-time, none time out.
4. Kill the app mid-upload, reopen → stuck row shows Retry → Retry works for a video.
5. Repeat 1-3 in a group chat.

**Do not commit** — leave the diff for Ohad's review.
