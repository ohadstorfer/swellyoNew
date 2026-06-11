/**
 * Audio Upload Service
 * Uploads voice-message m4a files to the message-images Supabase Storage bucket.
 * Mirrors imageUploadService's native FormData path (RN can read file:// URIs
 * directly via FormData without going through a Blob).
 */

import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '../../config/supabase';

const DEFAULT_MIME = 'audio/m4a';
const DEFAULT_FILENAME = 'audio.m4a';

export interface AudioUploadResult {
  audio_url: string;
  storage_path: string;
}

/**
 * Build a FormData body from a native file URI. React Native's networking
 * layer reads file:// URIs directly from FormData, bypassing Blob conversion.
 */
const nativeAudioFormData = (uri: string, contentType: string): FormData => {
  const formData = new FormData();
  const extension = contentType.includes('mp4') ? 'mp4' : 'm4a';
  formData.append('', {
    uri,
    name: `upload.${extension}`,
    type: contentType,
  } as any);
  return formData;
};

/**
 * Fetch a local file URI and convert to Blob. Web only — native goes through
 * the FormData path.
 */
const uriToBlob = async (uri: string): Promise<Blob> => {
  const response = await fetch(uri);
  return response.blob();
};

/**
 * Upload an audio file (typically m4a / AAC) to the shared message-images
 * bucket. Path: {conversationId}/{messageId}/audio.m4a
 *
 * The bucket's RLS policies (create_message_images_bucket.sql) scope INSERT to
 * conversation members and SELECT/DELETE the same way — same rules as images,
 * no extra policy work required.
 */
export async function uploadAudioToStorage(
  localUri: string,
  conversationId: string,
  messageId: string,
  mimeType: string = DEFAULT_MIME
): Promise<AudioUploadResult> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }

  const isNativeFileUri =
    Platform.OS !== 'web' &&
    (localUri.startsWith('file://') || localUri.startsWith('content://'));

  let uploadBody: Blob | FormData;
  if (isNativeFileUri) {
    uploadBody = nativeAudioFormData(localUri, mimeType);
  } else {
    uploadBody = await uriToBlob(localUri);
  }

  const storagePath = `${conversationId}/${messageId}/${DEFAULT_FILENAME}`;

  const { data, error } = await supabase.storage
    .from('message-images')
    .upload(storagePath, uploadBody, {
      contentType: mimeType,
      upsert: false,
      // Message media is immutable (path is keyed by message id), so it's
      // safe to cache long. Seconds only — supabase-js prefixes "max-age=".
      cacheControl: '31536000',
    });

  if (error) {
    console.error('[audioUploadService] Upload error:', error);
    throw error;
  }

  const { data: urlData } = supabase.storage
    .from('message-images')
    .getPublicUrl(data.path);

  return {
    audio_url: urlData.publicUrl,
    storage_path: storagePath,
  };
}
