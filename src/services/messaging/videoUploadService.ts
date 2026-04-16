/**
 * Video Upload Service for DM messages
 * Handles video thumbnail generation, S3 upload via presigned URLs, and polling for processed video
 */

import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { Platform } from 'react-native';
import { VideoMetadata } from './messagingService';

const MAX_VIDEO_SIZE_MB = 50;
const MAX_VIDEO_DURATION_SECONDS = 120; // 2 minutes for DMs

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

const getAuthHeaders = async (): Promise<HeadersInit> => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    throw new Error('Not authenticated');
  }
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set');
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    'apikey': anonKey,
  };
};

const getEdgeFunctionUrl = (): string => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  return `${supabaseUrl}/functions/v1/process-profile-video-s3`;
};

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
  console.log('[videoUploadService] Processing video:', uri.substring(0, 50));

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
    try {
      const VideoThumbnails = require('expo-video-thumbnails');

      // Get thumbnail at 1 second
      const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
        time: 1000,
        quality: 0.8,
      });
      thumbnailUri = thumbUri;
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

  // Validate
  if (fileSize > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
    throw new Error(`Video is too large (max ${MAX_VIDEO_SIZE_MB}MB)`);
  }

  if (duration > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(`Video is too long (max ${MAX_VIDEO_DURATION_SECONDS}s)`);
  }

  console.log('[videoUploadService] Video processed:', { width, height, duration, fileSize });

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
): Promise<{ s3Key: string; processedKey: string }> {
  console.log('[videoUploadService] Getting presigned URL for S3 upload');

  const functionUrl = getEdgeFunctionUrl();
  const headers = await getAuthHeaders();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Get presigned upload URL
  const presignResponse = await fetch(functionUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'get-upload-url',
      userId: user.id,
      prefix: `dm/${conversationId}/${messageId}`,
    }),
  });

  if (!presignResponse.ok) {
    const errorText = await presignResponse.text();
    throw new Error(`Failed to get presigned URL: ${errorText}`);
  }

  const { uploadUrl, s3Key, processedKey } = await presignResponse.json();
  console.log('[videoUploadService] Got presigned URL, uploading to S3:', s3Key);

  const isNativeFileUri = Platform.OS !== 'web' &&
    (videoUri.startsWith('file://') || videoUri.startsWith('content://') || videoUri.startsWith('ph://'));

  if (isNativeFileUri) {
    // Native: use expo-file-system uploadAsync with BINARY_CONTENT so the native HTTP stack
    // streams the file directly as the PUT body. This avoids the RN Blob shim which has
    // historically produced 0-byte uploads for large video files.
    const LegacyFS = require('expo-file-system/legacy');
    const result = await LegacyFS.uploadAsync(uploadUrl, videoUri, {
      httpMethod: 'PUT',
      uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'video/mp4' },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`S3 upload failed: ${result.status} ${result.body?.slice(0, 200)}`);
    }
  } else {
    let uploadBody: Blob;
    if (videoUri.startsWith('data:')) {
      uploadBody = dataURLtoBlob(videoUri);
    } else {
      uploadBody = await uriToBlob(videoUri);
    }

    const s3Response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: uploadBody,
    });

    if (!s3Response.ok) {
      const errorText = await s3Response.text();
      throw new Error(`S3 upload failed: ${errorText}`);
    }
  }

  console.log('[videoUploadService] Video uploaded to S3:', s3Key);
  return { s3Key, processedKey };
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
  const maxAttempts = 12;
  const delayMs = 15000; // 15 seconds

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const headers = await getAuthHeaders();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      console.log(`[videoUploadService] Polling for processed video (attempt ${attempt}/${maxAttempts})`);

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'get-processed-url',
          userId: user.id,
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
