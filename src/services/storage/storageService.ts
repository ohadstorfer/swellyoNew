import { supabase } from '../../config/supabase';
import { Platform } from 'react-native';
import { validateVideoComplete, getFileExtension, getMimeTypeFromExtension } from '../../utils/videoValidation';
import { isSupabaseConfigured } from '../../config/supabase';

/**
 * Storage Service
 * Handles file uploads to Supabase Storage
 */

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
  processing?: boolean; // Indicates video is being processed server-side
  tempPath?: string; // Temporary path for the uploaded video
}

/**
 * Get the Supabase Edge Function URL for video processing
 */
const getVideoProcessingFunctionUrl = async (): Promise<string> => {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }
  
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  if (!supabaseUrl) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL is not set');
  }
  
  return `${supabaseUrl}/functions/v1/process-profile-video`;
};

/**
 * Get authentication headers for Supabase Edge Function calls
 */
const getAuthHeaders = async (): Promise<HeadersInit> => {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error || !session) {
    console.log('[storageService] No session - auth guard will handle redirect');
    throw new Error('Not authenticated'); // Still throw for type safety, but auth guard will catch
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

/**
 * Convert a base64 data URL to a Blob
 */
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

/**
 * Fetch a file URI and convert to Blob (for React Native)
 */
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
 * Build a FormData body from a native file URI.
 * React Native's networking layer can read file:// URIs directly from FormData,
 * bypassing the need to convert to a Blob first.
 */
const nativeFileFormData = (uri: string, contentType: string): FormData => {
  const formData = new FormData();
  const extension = contentType.split('/')[1] || 'jpg';
  formData.append('', {
    uri,
    name: `upload.${extension}`,
    type: contentType,
  } as any);
  return formData;
};

/**
 * Upload a profile image to Supabase Storage
 * @param imageUri - The local file URI or base64 data URL
 * @param userId - The authenticated user's ID
 * @returns UploadResult with the public URL on success
 */
export const uploadProfileImage = async (
  imageUri: string,
  userId: string
): Promise<UploadResult> => {
  try {
    if (!imageUri || !userId) {
      return { success: false, error: 'Missing image or user ID' };
    }

    // Generate a unique filename
    const fileExtension = 'jpg';
    const fileName = `${userId}/profile-${Date.now()}.${fileExtension}`;

    console.log('[StorageService] Received image URI:', imageUri);
    console.log('[StorageService] URI type check:', {
      isData: imageUri.startsWith('data:'),
      isBlob: imageUri.startsWith('blob:'),
      isFile: imageUri.startsWith('file://'),
      isContent: imageUri.startsWith('content://'),
      isPh: imageUri.startsWith('ph://'),
      isHttp: imageUri.startsWith('http://') || imageUri.startsWith('https://'),
      firstChars: imageUri.substring(0, 50),
    });

    let uploadBody: Blob | FormData;
    const contentType = 'image/jpeg';

    // On native, use FormData with the file URI directly (avoids Blob issues)
    const isNativeFileUri = Platform.OS !== 'web' &&
      (imageUri.startsWith('file://') || imageUri.startsWith('content://') || imageUri.startsWith('ph://'));

    if (isNativeFileUri) {
      console.log('[StorageService] Native file URI – using FormData upload');
      uploadBody = nativeFileFormData(imageUri, contentType);
    } else if (imageUri.startsWith('data:')) {
      // Base64 data URL (web)
      console.log('[StorageService] Handling data: URI');
      uploadBody = dataURLtoBlob(imageUri);
    } else if (imageUri.startsWith('blob:')) {
      // Blob URL (web - from expo-image-manipulator)
      console.log('[StorageService] Handling blob: URI');
      uploadBody = await uriToBlob(imageUri);
    } else if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
      console.log('[StorageService] Handling http:// URI');
      uploadBody = await uriToBlob(imageUri);
    } else {
      console.log('[StorageService] Unknown format, attempting to fetch as blob...');
      try {
        uploadBody = await uriToBlob(imageUri);
        console.log('[StorageService] Successfully converted unknown format to blob');
      } catch (fetchError) {
        console.error('[StorageService] Failed to fetch as blob:', fetchError);
        console.error('[StorageService] Full URI (first 100 chars):', imageUri.substring(0, 100));
        return {
          success: false,
          error: `Unsupported image format. URI starts with: ${imageUri.substring(0, 20)}...`
        };
      }
    }

    // Try to upload directly - this is more reliable than checking buckets first
    // (bucket check might fail due to permissions, but upload might still work)
    const { data, error } = await supabase.storage
      .from('profile-images')
      .upload(fileName, uploadBody, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error('[StorageService] Upload error:', error);
      
      // Check if it's a bucket not found error
      if (error.message?.includes('Bucket not found') || error.message?.includes('does not exist')) {
        // Try to check if bucket exists (for better error message)
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = buckets?.some(bucket => bucket.name === 'profile-images');
        
        if (!bucketExists) {
          return { 
            success: false, 
            error: 'Storage bucket "profile-images" does not exist. Please create it in Supabase Storage.' 
          };
        }
      }
      
      // For other errors (permissions, etc.), return the error
      return { success: false, error: error.message || 'Upload failed' };
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from('profile-images')
      .getPublicUrl(data.path);

    console.log('[StorageService] Image uploaded successfully:', urlData.publicUrl);
    
    return { success: true, url: urlData.publicUrl };
  } catch (error) {
    console.error('[StorageService] Upload exception:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

/**
 * Upload a trip image (hero or accommodation) to the `trip-images` bucket.
 * Mirrors `uploadProfileImage` — same URI handling, different bucket and path.
 */
export const uploadTripImage = async (
  imageUri: string,
  userId: string,
  kind: 'hero' | 'accommodation' = 'hero'
): Promise<UploadResult> => {
  try {
    if (!imageUri || !userId) {
      return { success: false, error: 'Missing image or user ID' };
    }

    const fileName = `${userId}/${kind}-${Date.now()}.jpg`;
    const contentType = 'image/jpeg';

    let uploadBody: Blob | FormData;

    const isNativeFileUri = Platform.OS !== 'web' &&
      (imageUri.startsWith('file://') || imageUri.startsWith('content://') || imageUri.startsWith('ph://'));

    if (isNativeFileUri) {
      uploadBody = nativeFileFormData(imageUri, contentType);
    } else if (imageUri.startsWith('data:')) {
      uploadBody = dataURLtoBlob(imageUri);
    } else if (imageUri.startsWith('blob:') || imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
      uploadBody = await uriToBlob(imageUri);
    } else {
      try {
        uploadBody = await uriToBlob(imageUri);
      } catch (fetchError) {
        return {
          success: false,
          error: `Unsupported image format. URI starts with: ${imageUri.substring(0, 20)}...`
        };
      }
    }

    const { data, error } = await supabase.storage
      .from('trip-images')
      .upload(fileName, uploadBody, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error('[StorageService] Trip image upload error:', error);
      if (error.message?.includes('Bucket not found') || error.message?.includes('does not exist')) {
        return {
          success: false,
          error: 'Storage bucket "trip-images" does not exist. Please run the group_trips migration.'
        };
      }
      return { success: false, error: error.message || 'Upload failed' };
    }

    const { data: urlData } = supabase.storage
      .from('trip-images')
      .getPublicUrl(data.path);

    return { success: true, url: urlData.publicUrl };
  } catch (error) {
    console.error('[StorageService] Trip image upload exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

/**
 * Upload a profile video to Supabase Storage
 * @param videoUri - The local file URI or blob URL
 * @param userId - The authenticated user's ID
 * @returns UploadResult with the public URL on success
 */
export const uploadProfileVideo = async (
  videoUri: string,
  userId: string,
  mimeType?: string
): Promise<UploadResult> => {
  try {
    if (!videoUri || !userId) {
      return { success: false, error: 'Missing video or user ID' };
    }

    console.log('[StorageService] Received video URI:', videoUri);
    console.log('[StorageService] MIME type:', mimeType);
    console.log('[StorageService] URI type check:', {
      isData: videoUri.startsWith('data:'),
      isBlob: videoUri.startsWith('blob:'),
      isFile: videoUri.startsWith('file://'),
      isContent: videoUri.startsWith('content://'),
      isPh: videoUri.startsWith('ph://'),
      isHttp: videoUri.startsWith('http://') || videoUri.startsWith('https://'),
      firstChars: videoUri.substring(0, 50),
    });

    // Validate video before processing (pass MIME type if available)
    const validation = await validateVideoComplete(videoUri, mimeType);
    if (!validation.valid) {
      return { success: false, error: validation.error || 'Video validation failed' };
    }

    // Get file extension and determine content type
    // Try to get extension from URI first, then from MIME type
    let extension = getFileExtension(videoUri);
    if (!extension && mimeType) {
      const mimeToExt: { [key: string]: string } = {
        'video/mp4': '.mp4',
        'video/quicktime': '.mov',
        'video/x-quicktime': '.mov',
        'video/webm': '.webm',
        'video/x-msvideo': '.avi',
      };
      extension = mimeToExt[mimeType] || '.mp4';
    }
    extension = extension || '.mp4';
    
    // Use provided MIME type or infer from extension
    const finalMimeType = mimeType || getMimeTypeFromExtension(extension) || 'video/mp4';

    // Generate a unique filename for temporary storage
    const tempFileName = `temp/${userId}/profile-surf-video-${Date.now()}${extension}`;

    let uploadBody: Blob | FormData;

    // On native, use FormData with the file URI directly (avoids Blob issues)
    const isNativeFileUri = Platform.OS !== 'web' &&
      (videoUri.startsWith('file://') || videoUri.startsWith('content://') || videoUri.startsWith('ph://'));

    if (isNativeFileUri) {
      console.log('[StorageService] Native file URI – using FormData upload for video');
      uploadBody = nativeFileFormData(videoUri, finalMimeType);
    } else if (videoUri.startsWith('data:')) {
      // Base64 data URL (web)
      console.log('[StorageService] Handling data: URI for video');
      uploadBody = dataURLtoBlob(videoUri);
    } else if (videoUri.startsWith('blob:')) {
      // Blob URL (web)
      console.log('[StorageService] Handling blob: URI for video');
      uploadBody = await uriToBlob(videoUri);
    } else if (videoUri.startsWith('http://') || videoUri.startsWith('https://')) {
      console.log('[StorageService] Handling http:// URI for video');
      uploadBody = await uriToBlob(videoUri);
    } else {
      console.log('[StorageService] Unknown format, attempting to fetch as blob...');
      try {
        uploadBody = await uriToBlob(videoUri);
        console.log('[StorageService] Successfully converted unknown format to blob');
      } catch (fetchError) {
        console.error('[StorageService] Failed to fetch as blob:', fetchError);
        return {
          success: false,
          error: `Unsupported video format. URI starts with: ${videoUri.substring(0, 20)}...`
        };
      }
    }

    // Upload to temporary location in profile-surf-videos bucket
    const { data, error } = await supabase.storage
      .from('profile-surf-videos')
      .upload(tempFileName, uploadBody, {
        contentType: finalMimeType,
        upsert: false, // Don't overwrite temp files
      });

    if (error) {
      console.error('[StorageService] Video upload error:', error);
      
      // Check if it's a bucket not found error
      if (error.message?.includes('Bucket not found') || error.message?.includes('does not exist')) {
        // Try to check if bucket exists (for better error message)
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = buckets?.some(bucket => bucket.name === 'profile-surf-videos');
        
        if (!bucketExists) {
          return { 
            success: false, 
            error: 'Storage bucket "profile-surf-videos" does not exist. Please create it in Supabase Storage.' 
          };
        }
      }
      
      // For other errors (permissions, etc.), return the error
      return { success: false, error: error.message || 'Upload failed' };
    }

    console.log('[StorageService] Video uploaded to temp location:', tempFileName);

    // Trigger Edge Function for video processing
    try {
      const functionUrl = await getVideoProcessingFunctionUrl();
      const headers = await getAuthHeaders();

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          videoPath: tempFileName,
          userId: userId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[StorageService] Edge Function error:', errorText);
        // Don't fail the upload - the video is uploaded, processing might retry
        // Return success with processing status
        return {
          success: true,
          processing: true,
          tempPath: tempFileName,
          error: 'Video uploaded but processing failed. Please try again later.',
        };
      }

      const result = await response.json();
      console.log('[StorageService] Video processing started:', result);

      // Return success with processing status
      return {
        success: true,
        processing: true,
        tempPath: tempFileName,
      };
    } catch (functionError) {
      console.error('[StorageService] Failed to trigger video processing:', functionError);
      // Video is uploaded, but processing failed to start
      // Return success with processing status so user knows it's being processed
      return {
        success: true,
        processing: true,
        tempPath: tempFileName,
        error: 'Video uploaded but processing may be delayed. Please check back in a moment.',
      };
    }
  } catch (error) {
    console.error('[StorageService] Video upload exception:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

/**
 * Get the Supabase Edge Function URL for S3 video processing (LOCAL_MODE)
 */
const getS3VideoProcessingFunctionUrl = (): string => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  return `${supabaseUrl}/functions/v1/process-profile-video-s3`;
};

/**
 * Upload a profile video to AWS S3 via presigned URL.
 * Uses the process-profile-video-s3 Edge Function to get presigned URLs.
 * This is the default video upload path across all app modes.
 */
export const uploadProfileVideoS3 = async (
  videoUri: string,
  userId: string,
  mimeType?: string
): Promise<UploadResult> => {
  try {
    if (!videoUri || !userId) {
      return { success: false, error: 'Missing video or user ID' };
    }

    console.log('[StorageService/S3] Starting S3 upload for user:', userId);

    // Validate video before processing
    const validation = await validateVideoComplete(videoUri, mimeType);
    if (!validation.valid) {
      return { success: false, error: validation.error || 'Video validation failed' };
    }

    // Step 1: Get presigned upload URL from Edge Function
    const functionUrl = getS3VideoProcessingFunctionUrl();
    const headers = await getAuthHeaders();

    const presignResponse = await fetch(functionUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'get-upload-url',
        userId,
      }),
    });

    if (!presignResponse.ok) {
      const errorText = await presignResponse.text();
      console.error('[StorageService/S3] Failed to get presigned URL:', errorText);
      return { success: false, error: 'Failed to get upload URL' };
    }

    const { uploadUrl, s3Key, processedKey } = await presignResponse.json();
    console.log('[StorageService/S3] Got presigned URL for:', s3Key);

    const isNativeFileUri = Platform.OS !== 'web' &&
      (videoUri.startsWith('file://') || videoUri.startsWith('content://') || videoUri.startsWith('ph://'));

    if (isNativeFileUri) {
      // On native, stream the file directly via expo-file-system uploadAsync.
      // The RN Blob shim can produce 0-byte PUT bodies for large videos — this avoids it.
      console.log('[StorageService/S3] Uploading to S3 via FileSystem.uploadAsync...');
      const LegacyFS = require('expo-file-system/legacy');
      const result = await LegacyFS.uploadAsync(uploadUrl, videoUri, {
        httpMethod: 'PUT',
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': 'video/mp4' },
      });
      if (result.status < 200 || result.status >= 300) {
        console.error('[StorageService/S3] S3 upload failed:', result.status, result.body);
        return { success: false, error: `S3 upload failed (${result.status})` };
      }
    } else {
      let uploadBody: Blob;
      if (videoUri.startsWith('data:')) {
        uploadBody = dataURLtoBlob(videoUri);
      } else {
        uploadBody = await uriToBlob(videoUri);
      }

      console.log('[StorageService/S3] Uploading to S3 via fetch PUT...');
      const s3Response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: uploadBody,
      });

      if (!s3Response.ok) {
        const errorText = await s3Response.text();
        console.error('[StorageService/S3] S3 upload failed:', errorText);
        return { success: false, error: 'S3 upload failed' };
      }
    }

    console.log('[StorageService/S3] Video uploaded to S3:', s3Key);

    // Step 4: Wait for MediaConvert processing and update DB
    // Fire-and-forget: poll after a delay to update the DB
    pollForProcessedVideo(userId, processedKey, headers, functionUrl);

    return {
      success: true,
      processing: true,
      tempPath: s3Key,
    };
  } catch (error) {
    console.error('[StorageService/S3] Upload exception:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Poll for the processed video and update the DB (runs in background)
 */
const pollForProcessedVideo = async (
  userId: string,
  processedKey: string,
  headers: HeadersInit,
  functionUrl: string,
) => {
  const maxAttempts = 10;
  const delayMs = 15000; // 15 seconds between polls

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      console.log(`[StorageService/S3] Polling for processed video (attempt ${attempt}/${maxAttempts})`);

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
        if (result.ready) {
          console.log('[StorageService/S3] Processed video ready:', result.videoUrl);
          return;
        }
      }
    } catch (err) {
      console.warn(`[StorageService/S3] Poll attempt ${attempt} failed:`, err);
    }
  }

  console.warn('[StorageService/S3] Gave up polling for processed video after max attempts');
};

/**
 * Delete a profile video from Supabase Storage
 * @param videoPath - The path to the video (e.g., "userId/profile-surf-video-123.mp4")
 */
export const deleteProfileVideo = async (videoPath: string): Promise<boolean> => {
  try {
    const { error } = await supabase.storage
      .from('profile-surf-videos')
      .remove([videoPath]);

    if (error) {
      console.error('[StorageService] Delete video error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[StorageService] Delete video exception:', error);
    return false;
  }
};

/**
 * Delete a profile image from Supabase Storage
 * @param imagePath - The path to the image (e.g., "userId/profile-123.jpg")
 */
export const deleteProfileImage = async (imagePath: string): Promise<boolean> => {
  try {
    const { error } = await supabase.storage
      .from('profile-images')
      .remove([imagePath]);

    if (error) {
      console.error('[StorageService] Delete error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[StorageService] Delete exception:', error);
    return false;
  }
};
