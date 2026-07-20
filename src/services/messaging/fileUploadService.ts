/**
 * File Upload Service — uploads chat file attachments to the private
 * `message-files/` S3 prefix via a membership-checked, allowlist-gated
 * presigned PUT (image-upload-s3 `get-message-file-upload-url`), and mints
 * short-lived presigned GETs for download (`get-message-file-download-url`).
 *
 * Mirrors imageUploadService's auth/transport, but the content-type is bound to
 * the picked file's extension (not hardcoded to image/jpeg), and reads are
 * private (no public URL is ever returned).
 */

import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { Platform } from 'react-native';
import { contentTypeFor } from './fileAttachmentPolicy';

const fnUrl = () => `${process.env.EXPO_PUBLIC_SUPABASE_URL || ''}/functions/v1/image-upload-s3`;
const anonKey = () => process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

async function callEdge(bodyObj: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(fnUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': anonKey(),
    },
    body: JSON.stringify(bodyObj),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Edge call failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

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

/**
 * Upload a picked file to storage. The object key is derived from the message
 * id only. Returns the storage path to persist in file_metadata.
 */
export async function uploadFileToStorage(
  localUri: string,
  conversationId: string,
  messageId: string,
  ext: string,
  onProgress?: (pct: number) => void,
): Promise<{ storagePath: string }> {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured');

  const { uploadUrl, key, contentType } = await callEdge({
    action: 'get-message-file-upload-url',
    conversationId,
    messageId,
    ext,
  });
  const ct = contentType || contentTypeFor(ext);

  const isNativeFileUri = Platform.OS !== 'web' &&
    (localUri.startsWith('file://') || localUri.startsWith('content://') || localUri.startsWith('ph://'));

  if (isNativeFileUri) {
    // createUploadTask (vs uploadAsync) is the same native transport but
    // reports byte-level progress for the bubble's progress ring.
    const LegacyFS = require('expo-file-system/legacy');
    const task = LegacyFS.createUploadTask(
      uploadUrl,
      localUri,
      {
        httpMethod: 'PUT',
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': ct },
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
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(`S3 upload failed (${result?.status})`);
    }
  } else {
    const body = await uriToBlob(localUri);
    // fetch() cannot observe request-body progress — XHR can.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', ct);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            onProgress((e.loaded / e.total) * 100);
          }
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`S3 upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('S3 upload failed (network error)'));
      xhr.send(body);
    });
  }

  return { storagePath: key as string };
}

/** Mint a short-lived (15 min) presigned GET for a stored file attachment. */
export async function getFileDownloadUrl(
  conversationId: string,
  storagePath: string,
): Promise<string> {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured');
  const { downloadUrl } = await callEdge({
    action: 'get-message-file-download-url',
    conversationId,
    storagePath,
  });
  if (!downloadUrl) throw new Error('No download URL returned');
  return downloadUrl as string;
}
