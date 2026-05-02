import { Platform } from 'react-native';
import { isExpoGo } from './keyboardAvoidingView';

/**
 * Capture a single frame from a local video URI as a thumbnail.
 *
 * - Native: uses expo-video-thumbnails (skipped in Expo Go where the native
 *   module isn't linked).
 * - Web: loads the file into a hidden <video>, seeks to ~1s, draws onto a
 *   canvas, exports JPEG data URL.
 *
 * Returns null on any failure — callers should fall back to whatever
 * placeholder they already render.
 */
export async function captureVideoThumbnail(uri: string): Promise<string | null> {
  if (!uri) return null;

  if (Platform.OS === 'web') {
    return captureWeb(uri);
  }

  if (isExpoGo) return null;

  try {
    const VideoThumbnails = require('expo-video-thumbnails');
    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 1000,
      quality: 0.7,
    });
    return thumbUri ?? null;
  } catch (err) {
    console.warn('[videoThumbnail] native capture failed:', err);
    return null;
  }
}

function captureWeb(uri: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    (video as HTMLVideoElement).playsInline = true;
    video.crossOrigin = 'anonymous';

    let settled = false;
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    video.onloadedmetadata = () => {
      const target = Math.min(1, (video.duration || 1) / 2);
      try {
        video.currentTime = target;
      } catch {
        finish(null);
      }
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const targetWidth = Math.min(video.videoWidth || 240, 240);
        const ratio = video.videoHeight && video.videoWidth
          ? video.videoHeight / video.videoWidth
          : 1;
        canvas.width = targetWidth;
        canvas.height = Math.round(targetWidth * ratio);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.7));
      } catch (err) {
        console.warn('[videoThumbnail] web canvas draw failed:', err);
        finish(null);
      }
    };

    video.onerror = () => {
      finish(null);
    };

    // Bail after 2s so callers don't hang on a misbehaving file.
    setTimeout(() => finish(null), 2000);

    video.src = uri;
  });
}
