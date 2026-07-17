/**
 * JS face of the swellyo-video-export native module. iOS-only: it wraps
 * AVAssetExportSession to re-encode a local video to H.264 720p before upload.
 *
 * Degrades to an inert `null` when the native side is absent (Expo Go, web,
 * Android, or a build made before this module existed) — requireOptionalNativeModule
 * returns null instead of throwing, so callers never need a try/catch and simply
 * upload the original file.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeSwellyoVideoExport = {
  transcode(path: string): Promise<string>;
};

const native = requireOptionalNativeModule<NativeSwellyoVideoExport>('SwellyoVideoExport');

/** True when a real transcode can run (iOS dev/prod build with this module). */
export const isVideoExportAvailable = native != null;

/**
 * Re-encode `uri` to H.264 720p mp4. Resolves the new file:// URL, or null when
 * the module is unavailable or the export failed — callers fall back to the
 * original file, since shrinking is an optimisation and never a requirement.
 */
export async function transcodeVideo(uri: string): Promise<string | null> {
  if (!native) return null;
  try {
    return await native.transcode(uri);
  } catch {
    return null;
  }
}
