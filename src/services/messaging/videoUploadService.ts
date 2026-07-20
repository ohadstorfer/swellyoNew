/**
 * Video Upload Service for DM messages
 * Handles video thumbnail generation, S3 upload via presigned URLs, and polling for processed video
 */

import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { Platform } from 'react-native';
import { VideoMetadata } from './messagingService';

// Limits live in their own dependency-free module so the send path can enforce
// them without pulling this service in — see videoLimits.ts for why that matters.
import { assertVideoWithinLimits } from './videoLimits';

export { assertVideoWithinLimits } from './videoLimits';

export interface VideoProcessingResult {
  originalUri: string;
  thumbnailUri: string;
  width: number;
  height: number;
  duration: number;
  fileSize: number;
  mimeType: string;
}

/**
 * Metadata hints provided by the picker on native, where
 * expo-video-thumbnails doesn't return dimensions/duration.
 */
export interface VideoMetadataHints {
  width?: number;
  height?: number;
  duration?: number; // seconds
  fileSize?: number;
  mimeType?: string;
}

/**
 * Build a FormData body from a native file URI. RN's networking layer
 * reads file:// URIs directly from FormData, avoiding Blob shim issues.
 */
const nativeFileFormData = (uri: string, contentType: string): FormData => {
  const formData = new FormData();
  const extension = contentType.split('/')[1] || 'bin';
  formData.append('', {
    uri,
    name: `upload.${extension}`,
    type: contentType,
  } as any);
  return formData;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const dataURLtoBlob = (dataURL: string): Blob => {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

const uriToBlob = async (uri: string): Promise<Blob> => {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return response.blob();
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('Failed to convert URI to blob'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
};

const getAuthHeaders = async (): Promise<{ headers: HeadersInit; userId: string }> => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    throw new Error('Not authenticated');
  }
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set');
  }
  // The userId rides along because the session already carries it. Callers used
  // to follow this with `supabase.auth.getUser()`, which is a round trip to
  // /auth/v1/user for a value we are already holding — and auth in this app has
  // been measured at ~2.5s. It was pure latency on the tap-to-play path.
  // Authorisation is unaffected: the Edge Function authorises off the JWT.
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': anonKey,
    } as HeadersInit,
    userId: session.user.id,
  };
};

const getEdgeFunctionUrl = (): string => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  return `${supabaseUrl}/functions/v1/process-profile-video-s3`;
};

// ─── On-demand signing ───────────────────────────────────────────────────────

/**
 * Signed URLs already handed out, keyed by S3 key. Re-opening a video is common
 * (open, close, reopen; scrolling back through a chat) and each re-open
 * otherwise paid the full auth + Edge Function round trip again for a URL that
 * was still perfectly valid.
 *
 * TTL is deliberately far below the presign's own lifetime — this is a latency
 * cache, not a lifetime cache, so we can never hand back an expired URL.
 */
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const signingInFlight = new Map<string, Promise<string | null>>();

/** Drop every cached signing — call on logout so a URL can't outlive the session. */
export function resetSignedVideoUrlCache(): void {
  signedUrlCache.clear();
  signingInFlight.clear();
}

/**
 * Get a short-lived presigned URL for a DM video, signed on-demand when the user
 * opens it. DM videos are private (not public-readable), so we never persist a
 * playable URL — we sign per playback instead. The Edge Function authorizes
 * against conversation membership.
 *
 * Served from `signedUrlCache` when still fresh, so a re-open is instant.
 *
 * @param storagePath The S3 key stored in video_metadata.storage_path
 *                    (e.g. "uploads/dm/{convId}/{msgId}/video-{ts}.mp4")
 * @returns a presigned URL, or null if not authorized / not ready / on error
 */
export async function signDmVideoUrl(storagePath: string): Promise<string | null> {
  if (!storagePath || !isSupabaseConfigured()) return null;

  const cached = signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  // A second tap while the first is still signing rides the same request
  // instead of starting a competing round trip.
  const existing = signingInFlight.get(storagePath);
  if (existing) return existing;

  const request = (async (): Promise<string | null> => {
    try {
      const functionUrl = getEdgeFunctionUrl();
      const { headers, userId } = await getAuthHeaders();

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'sign-dm-video',
          userId,
          storagePath,
        }),
      });

      if (!response.ok) {
        console.warn('[videoUploadService] sign-dm-video failed:', await response.text());
        return null;
      }

      const result = await response.json();
      const url = result.ready && result.videoUrl ? result.videoUrl : null;
      if (url) {
        signedUrlCache.set(storagePath, { url, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
      }
      return url;
    } catch (error) {
      console.warn('[videoUploadService] sign-dm-video error:', error);
      return null;
    } finally {
      signingInFlight.delete(storagePath);
    }
  })();

  signingInFlight.set(storagePath, request);
  return request;
}

// ─── Video Processing ───────────────────────────────────────────────────────

/**
 * Get video metadata and generate a thumbnail.
 * No client-side compression — MediaConvert handles that.
 *
 * On native, dimensions and duration aren't reliably retrievable without heavy
 * dependencies. The picker provides them, so callers should forward them as hints.
 */
export async function processVideo(
  uri: string,
  hints?: VideoMetadataHints,
): Promise<VideoProcessingResult> {
  const startedAt = Date.now();

  let width = hints?.width ?? 0;
  let height = hints?.height ?? 0;
  let duration = hints?.duration ?? 0;
  let fileSize = hints?.fileSize ?? 0;
  let thumbnailUri = '';
  const mimeType = hints?.mimeType || 'video/mp4';

  if (Platform.OS === 'web') {
    // Web: use <video> element for metadata + canvas for thumbnail
    const result = await new Promise<{ width: number; height: number; duration: number; thumbnailUri: string }>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      video.onloadedmetadata = () => {
        duration = video.duration;
        width = video.videoWidth;
        height = video.videoHeight;

        // Seek to 1s for thumbnail
        video.currentTime = Math.min(1, video.duration / 2);
      };

      video.onseeked = () => {
        // Capture frame to canvas
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(video.videoWidth, 300);
        canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const thumb = canvas.toDataURL('image/jpeg', 0.8);
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
            thumbnailUri: thumb,
          });
        } else {
          reject(new Error('Could not get canvas context'));
        }
        // Do NOT revoke blob URL here — it's still needed for the S3 upload
      };

      video.onerror = () => {
        reject(new Error('Failed to load video'));
      };

      // Handle both data URLs and blob URLs
      if (uri.startsWith('data:') || uri.startsWith('blob:')) {
        video.src = uri;
      } else {
        video.src = uri;
      }
    });

    width = result.width;
    height = result.height;
    duration = result.duration;
    thumbnailUri = result.thumbnailUri;

    // Get file size
    if (uri.startsWith('data:')) {
      const arr = uri.split(',');
      fileSize = Math.round(arr[1].length * 0.75);
    } else {
      const blob = await fetch(uri).then(r => r.blob());
      fileSize = blob.size;
    }
  } else {
    // Native: use expo-video-thumbnails for the thumbnail, and expo-file-system/legacy
    // for the file size. Dimensions and duration come from the picker hints.
    //
    // Expo Go guard: the native module isn't linked in Expo Go, so require() would
    // trip the global error handler even inside try/catch (RN surfaces it anyway).
    try {
      const { isExpoGo } = require('../../utils/keyboardAvoidingView');
      if (!isExpoGo) {
        const VideoThumbnails = require('expo-video-thumbnails');
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
          time: 1000,
          quality: 0.8,
        });
        thumbnailUri = thumbUri;
      }
    } catch (error) {
      console.warn('[videoUploadService] Native thumbnail generation failed:', error);
      thumbnailUri = '';
    }

    if (!fileSize) {
      try {
        const LegacyFS = require('expo-file-system/legacy');
        const fileInfo = await LegacyFS.getInfoAsync(uri, { size: true });
        fileSize = fileInfo.size || 0;
      } catch (error) {
        console.warn('[videoUploadService] Native getInfoAsync failed:', error);
      }
    }
  }

  assertVideoWithinLimits({ fileSize, duration });

  console.log('[videoUploadService] video metadata + poster ready', {
    platform: Platform.OS,
    width,
    height,
    duration,
    fileSize,
    elapsedMs: Date.now() - startedAt,
  });

  return {
    originalUri: uri,
    thumbnailUri,
    width,
    height,
    duration,
    fileSize,
    mimeType,
  };
}

// ─── S3 Upload ──────────────────────────────────────────────────────────────

/**
 * Upload video to S3 via presigned URL from Edge Function.
 * Returns the S3 key and expected processed key.
 */
export async function uploadVideoToS3(
  videoUri: string,
  conversationId: string,
  messageId: string,
  onProgress?: (pct: number) => void,
): Promise<{ s3Key: string; processedKey: string; originalUrl: string }> {
  // Stage logs, interpolated rather than object args (log collectors drop
  // object payloads). Every await below can stall — auth in this app has been
  // measured at 2.5s — and a stall here looks identical to a slow upload from
  // the outside: a bubble stuck on "Uploading…". These say which one it is.
  const t0 = Date.now();
  console.log('[videoUploadService] upload step 1/4: auth headers');

  const functionUrl = getEdgeFunctionUrl();
  const { headers, userId } = await getAuthHeaders();

  console.log(`[videoUploadService] upload step 2/4: presign fetch (+${Date.now() - t0}ms)`);
  const presignResponse = await fetch(functionUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'get-upload-url',
      userId,
      prefix: `dm/${conversationId}/${messageId}`,
    }),
  });

  if (!presignResponse.ok) {
    const errorText = await presignResponse.text();
    throw new Error(`Failed to get presigned URL: ${errorText}`);
  }

  const { uploadUrl, s3Key, processedKey, originalUrl } = await presignResponse.json();
  console.log(`[videoUploadService] upload step 3/4: presigned OK (+${Date.now() - t0}ms)`);

  const isNativeFileUri = Platform.OS !== 'web' &&
    (videoUri.startsWith('file://') || videoUri.startsWith('content://') || videoUri.startsWith('ph://'));

  if (isNativeFileUri) {
    // uploadAsync is the proven native binary PUT transport for exported iOS
    // files. Timeout policy belongs to the send orchestration layer.
    const LegacyFS = require('expo-file-system/legacy');
    // The size of what we're ACTUALLY putting on the wire. This is the number
    // that decides whether a send takes 3s or 3min, so it gets logged before
    // the PUT rather than inferred afterwards from how long it took.
    let putBytes = 0;
    try {
      putBytes = (await LegacyFS.getInfoAsync(videoUri, { size: true }))?.size ?? 0;
    } catch {}
    console.log(
      `[videoUploadService] upload step 4/4: PUT ${Math.round(putBytes / 1024)}KB ` +
      `(+${Date.now() - t0}ms)`,
    );
    // createUploadTask (vs uploadAsync) is the same native transport but
    // reports byte-level progress for the bubble's progress ring.
    const task = LegacyFS.createUploadTask(
      uploadUrl,
      videoUri,
      {
        httpMethod: 'PUT',
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': 'video/mp4' },
      },
      onProgress
        ? (p: { totalBytesSent: number; totalBytesExpectedToSend: number }) => {
            if (p.totalBytesExpectedToSend > 0) {
              onProgress((p.totalBytesSent / p.totalBytesExpectedToSend) * 100);
            }
          }
        : undefined,
    );
    const result = await task.uploadAsync();
    console.log(
      `[videoUploadService] PUT returned ${result?.status} (+${Date.now() - t0}ms)`,
    );
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(`S3 upload failed: ${result?.status} ${result?.body?.slice(0, 200)}`);
    }
  } else {
    let uploadBody: Blob;
    if (videoUri.startsWith('data:')) {
      uploadBody = dataURLtoBlob(videoUri);
    } else {
      uploadBody = await uriToBlob(videoUri);
    }
    // fetch() cannot observe request-body progress — XHR can.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', 'video/mp4');
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            onProgress((e.loaded / e.total) * 100);
          }
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`S3 upload failed: ${xhr.status} ${String(xhr.response ?? '').slice(0, 200)}`));
      };
      xhr.onerror = () => reject(new Error('S3 upload failed (network error)'));
      xhr.send(uploadBody);
    });
  }

  return { s3Key, processedKey, originalUrl };
}

/**
 * Upload video thumbnail to Supabase Storage (reuses message-images bucket)
 */
export async function uploadThumbnailToStorage(
  thumbnailUri: string,
  conversationId: string,
  messageId: string,
): Promise<string> {
  if (!isSupabaseConfigured() || !thumbnailUri) {
    return '';
  }

  try {
    const contentType = 'image/jpeg';
    const isNativeFileUri = Platform.OS !== 'web' &&
      (thumbnailUri.startsWith('file://') || thumbnailUri.startsWith('content://') || thumbnailUri.startsWith('ph://'));

    let uploadBody: Blob | FormData;
    if (isNativeFileUri) {
      uploadBody = nativeFileFormData(thumbnailUri, contentType);
    } else if (thumbnailUri.startsWith('data:')) {
      uploadBody = dataURLtoBlob(thumbnailUri);
    } else {
      uploadBody = await uriToBlob(thumbnailUri);
    }

    const storagePath = `${conversationId}/${messageId}/video-thumbnail.jpg`;

    const { data, error } = await supabase.storage
      .from('message-images')
      .upload(storagePath, uploadBody, {
        contentType,
        upsert: false,
        // Message media is immutable (path is keyed by message id), so it's
        // safe to cache long. Seconds only — supabase-js prefixes "max-age=".
        cacheControl: '31536000',
      });

    if (error) {
      console.error('[videoUploadService] Thumbnail upload error:', error);
      return '';
    }

    const { data: urlData } = supabase.storage
      .from('message-images')
      .getPublicUrl(data.path);

    return urlData.publicUrl;
  } catch (error) {
    console.error('[videoUploadService] Error uploading thumbnail:', error);
    return '';
  }
}

/**
 * Poll for the processed video and return the presigned URL when ready.
 * Updates the message's video_metadata in the DB.
 */
export async function pollForProcessedDmVideo(
  messageId: string,
  processedKey: string,
  videoMetadata: Omit<VideoMetadata, 'video_url'>,
): Promise<void> {
  const functionUrl = getEdgeFunctionUrl();
  const maxAttempts = 28;
  const delayMs = 15000; // 15 seconds (28 × 15s ≈ 7 min, sized for 250 MB videos)

  const { headers, userId } = await getAuthHeaders();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      console.log(`[videoUploadService] Polling for processed video (attempt ${attempt}/${maxAttempts})`);

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'get-processed-url',
          userId,
          processedKey,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.ready && result.videoUrl) {
          console.log('[videoUploadService] Processed video ready');

          // Update the message with the processed video URL
          const fullMetadata: VideoMetadata = {
            ...videoMetadata,
            video_url: result.videoUrl,
          };

          await supabase
            .from('messages')
            .update({
              video_metadata: fullMetadata,
              updated_at: new Date().toISOString(),
            })
            .eq('id', messageId);

          return;
        }
      }
    } catch (err) {
      console.warn(`[videoUploadService] Poll attempt ${attempt} failed:`, err);
    }
  }

  console.warn('[videoUploadService] Gave up polling after max attempts');
}
