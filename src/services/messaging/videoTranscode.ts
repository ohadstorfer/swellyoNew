/**
 * Policy + IO around the swellyo-video-export native transcode.
 *
 * The picker deliberately stays on its Passthrough default so it returns
 * instantly (see the videoExportPreset comment at the picker call sites). That
 * leaves us holding the camera-roll original — often 4K HEVC at ~50 Mbit/s,
 * i.e. ~180 MB for 30s — which is the single biggest reason a chat video takes
 * minutes to send. Shrinking it to H.264 720p first typically cuts the bytes
 * ~10× and costs a few seconds of local CPU.
 *
 * This runs AFTER the optimistic bubble is on screen, so the user never waits
 * on it. Every failure path returns the original uri: a transcode is an
 * optimisation, and must never be able to block or fail a send.
 */
import { Platform } from 'react-native';
import { transcodeVideo, isVideoExportAvailable } from '../../../modules/swellyo-video-export';

/**
 * Below this, a transcode costs more wall-clock than the upload it saves.
 * ~4 MB uploads in a couple of seconds even on a weak uplink.
 */
export const TRANSCODE_MIN_BYTES = 4 * 1024 * 1024;

/** Anything wider/taller than 720p is worth re-encoding even when it's small. */
export const TRANSCODE_MIN_DIMENSION = 1280;

export interface TranscodeHints {
  width?: number;
  height?: number;
  fileSize?: number;
}

export interface TranscodeResult {
  /** The uri to upload — the transcoded file, or the original when skipped. */
  uri: string;
  transcoded: boolean;
  /** Why the original was kept; undefined when a transcode actually happened. */
  skipReason?: 'unavailable' | 'not-worth-it' | 'failed' | 'no-gain';
  originalBytes?: number;
  finalBytes?: number;
}

/**
 * Whether shrinking this asset is worth the CPU. Pure — the IO lives in
 * `transcodeVideoForUpload` so this stays unit-testable.
 *
 * `fileSize` is the strong signal: a 720p clip can still be 30 MB if it's long,
 * and is worth re-encoding. Dimensions are the fallback when the picker didn't
 * report a size.
 */
export function shouldTranscode(hints: TranscodeHints | undefined): boolean {
  const fileSize = hints?.fileSize ?? 0;
  if (fileSize > 0) return fileSize > TRANSCODE_MIN_BYTES;
  const maxDimension = Math.max(hints?.width ?? 0, hints?.height ?? 0);
  return maxDimension > TRANSCODE_MIN_DIMENSION;
}

const fileSizeOf = async (uri: string): Promise<number> => {
  try {
    const LegacyFS = require('expo-file-system/legacy');
    const info = await LegacyFS.getInfoAsync(uri, { size: true });
    return info?.size ?? 0;
  } catch {
    return 0;
  }
};

/**
 * Shrink `uri` for upload when it's worth it. Always resolves — never throws —
 * so a send can await it without a try/catch.
 */
export async function transcodeVideoForUpload(
  uri: string,
  hints?: TranscodeHints,
): Promise<TranscodeResult> {
  // Every skip is logged: a silent skip is indistinguishable from a slow upload
  // in the field, and 'unavailable' specifically means "this build predates the
  // native module" — i.e. the whole optimisation is off and needs a rebuild.
  if (Platform.OS === 'web' || !isVideoExportAvailable) {
    console.log(
      `[videoTranscode] SKIPPED (native module unavailable — rebuild needed) — ` +
      `uploading original of ${Math.round((hints?.fileSize ?? 0) / 1024)}KB`,
    );
    return { uri, transcoded: false, skipReason: 'unavailable' };
  }
  if (!shouldTranscode(hints)) {
    console.log(
      `[videoTranscode] skipped (not worth it) — ` +
      `${Math.round((hints?.fileSize ?? 0) / 1024)}KB, ${hints?.width}x${hints?.height}`,
    );
    return { uri, transcoded: false, skipReason: 'not-worth-it' };
  }
  console.log(
    `[videoTranscode] starting export — ` +
    `${Math.round((hints?.fileSize ?? 0) / 1024)}KB, ${hints?.width}x${hints?.height}`,
  );

  const startedAt = Date.now();
  const outputUri = await transcodeVideo(uri);
  if (!outputUri) {
    console.warn('[videoTranscode] export failed — uploading the original');
    return { uri, transcoded: false, skipReason: 'failed' };
  }

  const originalBytes = hints?.fileSize || (await fileSizeOf(uri));
  const finalBytes = await fileSizeOf(outputUri);

  // An already-efficient source can come out BIGGER than it went in. Uploading
  // the original is strictly better then, so throw the export away.
  if (finalBytes > 0 && originalBytes > 0 && finalBytes >= originalBytes) {
    return { uri, transcoded: false, skipReason: 'no-gain', originalBytes, finalBytes };
  }

  // Interpolated, not an object arg: the log collectors we read this back with
  // drop object payloads, which is exactly when we need the numbers most.
  const savedPct = originalBytes > 0 ? Math.round((1 - finalBytes / originalBytes) * 100) : 0;
  console.log(
    `[videoTranscode] export complete — ${Math.round(originalBytes / 1024)}KB → ` +
    `${Math.round(finalBytes / 1024)}KB (saved ${savedPct}%) in ${Date.now() - startedAt}ms`,
  );

  return { uri: outputUri, transcoded: true, originalBytes, finalBytes };
}
