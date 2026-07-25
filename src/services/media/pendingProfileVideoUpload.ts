/**
 * Resilient profile-video upload.
 *
 * WHY (2026-07-25 incident): onboarding uploaded the user's surf video as the
 * RAW camera-roll original (often 4K HEVC, ~180 MB), fire-and-forget, right as
 * the fresh user landed in the main app. That upload saturated the uplink and
 * made the whole first session laggy/stuck — and if the user killed the app
 * (exactly what they do when it feels stuck) the video was LOST with no retry
 * (matches historically-null profile_video_thumbnail_url).
 *
 * This module wraps the raw `uploadProfileVideoS3` with the same three things
 * chat media already does, plus durability:
 *   1. SHRINK first — H.264 720p via the native transcode (≈10× smaller, a few
 *      seconds of CPU off the JS thread; never throws — falls back to original).
 *   2. SURVIVE an app kill — copy the file into the documents dir (picker files
 *      live in tmp/caches and vanish), persist a tiny pending record, and retry
 *      on next launch (≤3 attempts).
 *   3. REPORT — analytics on start/succeed/fail/resume, doubling as the readout
 *      for whether the fix moved the first-session-lag reports.
 *
 * Durability is best-effort: if copying to documents fails (e.g. a `ph://` /
 * `content://` source the FS can't copy), we skip the pending-record feature
 * and upload directly — degrading to exactly today's behavior, never breaking
 * the upload. Same philosophy as the transcode: it's an optimisation, not a
 * requirement.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { uploadProfileVideoS3 } from '../storage/storageService';
import { analyticsService } from '../analytics/analyticsService';

const PENDING_KEY = 'swellyo_pending_profile_video_upload';

/** After this many failed launches, give up so we don't retry a doomed file forever. */
export const MAX_UPLOAD_ATTEMPTS = 3;

export interface PendingProfileVideoUpload {
  /** Durable file:// in the documents dir — already transcoded, safe to re-PUT. */
  localUri: string;
  userId: string;
  mimeType?: string;
  /** Epoch ms when the upload was first started. */
  createdAt: number;
  /** How many times we've tried to PUT this file (1 on first start). */
  attempts: number;
}

// ─── Pending-record CRUD (pure AsyncStorage — unit tested) ──────────────────

export async function savePendingUpload(rec: PendingProfileVideoUpload): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(rec));
  } catch (e) {
    console.warn('[pendingProfileVideo] save failed:', (e as Error)?.message);
  }
}

export async function getPendingUpload(): Promise<PendingProfileVideoUpload | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as PendingProfileVideoUpload;
    // Guard against a partially-written / legacy blob.
    if (!rec || typeof rec.localUri !== 'string' || typeof rec.userId !== 'string') {
      return null;
    }
    if (typeof rec.attempts !== 'number') rec.attempts = 1;
    return rec;
  } catch {
    return null;
  }
}

export async function clearPendingUpload(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch (e) {
    console.warn('[pendingProfileVideo] clear failed:', (e as Error)?.message);
  }
}

// ─── FS helpers (best-effort, defensive) ────────────────────────────────────

/** Single durable slot — there is only ever one pending profile video. */
function durableUriFor(): string | null {
  try {
    const FS = require('expo-file-system/legacy');
    if (!FS.documentDirectory) return null;
    return `${FS.documentDirectory}pending-profile-video.mp4`;
  } catch {
    return null;
  }
}

async function copyToDurable(fromUri: string): Promise<string | null> {
  const to = durableUriFor();
  if (!to) return null;
  try {
    const FS = require('expo-file-system/legacy');
    await FS.deleteAsync(to, { idempotent: true }); // copyAsync fails if dest exists
    await FS.copyAsync({ from: fromUri, to });
    return to;
  } catch (e) {
    console.warn('[pendingProfileVideo] copy-to-durable failed:', (e as Error)?.message);
    return null;
  }
}

async function deleteFileQuietly(uri: string | undefined | null): Promise<void> {
  if (!uri) return;
  try {
    const FS = require('expo-file-system/legacy');
    await FS.deleteAsync(uri, { idempotent: true });
  } catch {
    /* best-effort cleanup */
  }
}

async function fileSizeOf(uri: string): Promise<number> {
  try {
    const FS = require('expo-file-system/legacy');
    const info = await FS.getInfoAsync(uri, { size: true });
    return info?.exists ? info.size ?? 0 : 0;
  } catch {
    return 0;
  }
}

async function fileExists(uri: string): Promise<boolean> {
  try {
    const FS = require('expo-file-system/legacy');
    const info = await FS.getInfoAsync(uri);
    return !!info?.exists;
  } catch {
    return false;
  }
}

// ─── Orchestrator: shrink → durable copy → record → upload → cleanup ─────────

export interface StartProfileVideoUploadOpts {
  mimeType?: string;
  /** Picker asset hints so the transcode decision is right without a probe. */
  hints?: { width?: number; height?: number; fileSize?: number };
}

/**
 * Start a resilient profile-video upload. Fire-and-forget from the caller's
 * side (they never await it) — internally sequential so nothing races.
 *
 * On web / when durability isn't possible, degrades to a plain
 * `uploadProfileVideoS3` (today's behavior).
 */
export async function startProfileVideoUpload(
  pickedUri: string,
  userId: string,
  opts: StartProfileVideoUploadOpts = {},
): Promise<void> {
  const { mimeType, hints } = opts;

  // Web can't do native transcode, FS durability, or cross-restart resume
  // (blob URLs die on reload) — upload directly, unchanged from today.
  if (Platform.OS === 'web') {
    analyticsService.track('profile_video_upload_started', { transcoded: false, platform: 'web' });
    const r = await uploadProfileVideoS3(pickedUri, userId, mimeType);
    analyticsService.track(
      r.success ? 'profile_video_upload_succeeded' : 'profile_video_upload_failed',
      { platform: 'web', reason: r.success ? undefined : r.error },
    );
    return;
  }

  const startedAt = Date.now();
  let uploadUri = pickedUri;
  let transcoded = false;
  let transcodedTempUri: string | null = null;

  // 1. Shrink (never throws; returns the original on any skip/failure).
  try {
    const { transcodeVideoForUpload } = await import('../messaging/videoTranscode');
    const shrunk = await transcodeVideoForUpload(pickedUri, {
      width: hints?.width,
      height: hints?.height,
      fileSize: hints?.fileSize,
    });
    uploadUri = shrunk.uri;
    transcoded = shrunk.transcoded;
    if (shrunk.transcoded) transcodedTempUri = shrunk.uri;
  } catch (e) {
    // transcodeVideoForUpload is designed never to throw, but stay defensive.
    console.warn('[pendingProfileVideo] transcode threw (uploading original):', (e as Error)?.message);
  }

  // 2. Copy to documents so an app-kill can't lose it. Best-effort.
  const durableUri = await copyToDurable(uploadUri);
  // The transcode temp is now redundant once we have a durable copy.
  if (durableUri && transcodedTempUri && transcodedTempUri !== durableUri) {
    await deleteFileQuietly(transcodedTempUri);
  }

  const finalUri = durableUri ?? uploadUri;
  const uploadBytes = await fileSizeOf(finalUri);

  // 3. Persist the pending record (only when we have a durable, resumable file).
  if (durableUri) {
    await savePendingUpload({
      localUri: durableUri,
      userId,
      mimeType,
      createdAt: startedAt,
      attempts: 1,
    });
  }

  analyticsService.track('profile_video_upload_started', {
    transcoded,
    durable: !!durableUri,
    bytes: uploadBytes,
  });

  // 4. Upload. content-type is video/mp4 after transcode; the raw PUT already
  //    hardcodes video/mp4, so pass mimeType through only for the fallback path.
  const result = await uploadProfileVideoS3(finalUri, userId, transcoded ? 'video/mp4' : mimeType);

  // 5. Cleanup / analytics. `success` means the bytes are safely in S3 (the
  //    MediaConvert step continues server-side), so it's safe to drop the copy.
  if (result.success) {
    analyticsService.track('profile_video_upload_succeeded', {
      transcoded,
      bytes: uploadBytes,
      duration_ms: Date.now() - startedAt,
    });
    await clearPendingUpload();
    await deleteFileQuietly(durableUri);
  } else {
    analyticsService.track('profile_video_upload_failed', {
      transcoded,
      reason: result.error,
      will_retry: !!durableUri, // resumable only when we persisted a record
    });
    // Leave the record + durable file in place for resumePendingProfileVideoUpload().
    // If we never persisted one (durability failed), there's nothing to resume —
    // same as today.
  }
}

/**
 * Retry a profile-video upload that a previous session started but didn't
 * finish (e.g. the user killed the app mid-upload). Call once, fire-and-forget,
 * after session restore. No-op when there's nothing pending.
 */
export async function resumePendingProfileVideoUpload(): Promise<void> {
  if (Platform.OS === 'web') return;

  const rec = await getPendingUpload();
  if (!rec) return;

  // The durable file is gone (OS cleared it, or a bug) — nothing to resume.
  if (!(await fileExists(rec.localUri))) {
    console.log('[pendingProfileVideo] pending file missing — dropping record');
    analyticsService.track('profile_video_upload_failed', { reason: 'file-gone', resumed: true });
    await clearPendingUpload();
    return;
  }

  // Give up after MAX_UPLOAD_ATTEMPTS so we never retry a doomed file forever.
  if (rec.attempts >= MAX_UPLOAD_ATTEMPTS) {
    console.log(`[pendingProfileVideo] max attempts (${rec.attempts}) reached — giving up`);
    analyticsService.track('profile_video_upload_failed', {
      reason: 'max-attempts',
      attempts: rec.attempts,
      resumed: true,
    });
    await clearPendingUpload();
    await deleteFileQuietly(rec.localUri);
    return;
  }

  const attempt = rec.attempts + 1;
  await savePendingUpload({ ...rec, attempts: attempt });
  analyticsService.track('profile_video_upload_resumed', { attempt });
  console.log(`[pendingProfileVideo] resuming upload (attempt ${attempt}) for user ${rec.userId}`);

  // The file is already transcoded from the original start, so no re-shrink.
  const result = await uploadProfileVideoS3(rec.localUri, rec.userId, rec.mimeType ?? 'video/mp4');

  if (result.success) {
    analyticsService.track('profile_video_upload_succeeded', { resumed: true, attempt });
    await clearPendingUpload();
    await deleteFileQuietly(rec.localUri);
  } else {
    // Leave the (bumped) record for the next launch to try again.
    analyticsService.track('profile_video_upload_failed', {
      reason: result.error,
      resumed: true,
      attempt,
      will_retry: attempt < MAX_UPLOAD_ATTEMPTS,
    });
  }
}
