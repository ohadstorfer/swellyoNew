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
    throw new Error('Not authenticated. Please sign in again.');
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
  const response = await fetch(uri);
  const blob = await response.blob();
  return blob;
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

    let blob: Blob;

    // Handle different image formats
    if (imageUri.startsWith('data:')) {
      // Base64 data URL (web)
      console.log('[StorageService] Handling data: URI');
      blob = dataURLtoBlob(imageUri);
    } else if (imageUri.startsWith('blob:')) {
      // Blob URL (web - from expo-image-manipulator)
      console.log('[StorageService] Handling blob: URI');
      blob = await uriToBlob(imageUri);
    } else if (imageUri.startsWith('file://') || imageUri.startsWith('content://') || imageUri.startsWith('ph://')) {
      // Local file URI (React Native)
      console.log('[StorageService] Handling file:///content:///ph:// URI');
      blob = await uriToBlob(imageUri);
    } else if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
      // Already a URL - might be updating from existing
      // Fetch and re-upload
      console.log('[StorageService] Handling http:// URI');
      blob = await uriToBlob(imageUri);
    } else {
      // Fallback: Try to fetch as blob (works for most formats)
      // This handles cases where expo-image-manipulator returns unexpected formats
      console.log('[StorageService] Unknown format, attempting to fetch as blob...');
      try {
        blob = await uriToBlob(imageUri);
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
      .upload(fileName, blob, {
        contentType: 'image/jpeg',
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

    let blob: Blob;

    // Handle different video formats
    if (videoUri.startsWith('data:')) {
      // Base64 data URL (web)
      console.log('[StorageService] Handling data: URI for video');
      blob = dataURLtoBlob(videoUri);
    } else if (videoUri.startsWith('blob:')) {
      // Blob URL (web)
      console.log('[StorageService] Handling blob: URI for video');
      blob = await uriToBlob(videoUri);
    } else if (videoUri.startsWith('file://') || videoUri.startsWith('content://') || videoUri.startsWith('ph://')) {
      // Local file URI (React Native)
      console.log('[StorageService] Handling file:///content:///ph:// URI for video');
      blob = await uriToBlob(videoUri);
    } else if (videoUri.startsWith('http://') || videoUri.startsWith('https://')) {
      // Already a URL - fetch and re-upload
      console.log('[StorageService] Handling http:// URI for video');
      blob = await uriToBlob(videoUri);
    } else {
      // Fallback: Try to fetch as blob
      console.log('[StorageService] Unknown format, attempting to fetch as blob...');
      try {
        blob = await uriToBlob(videoUri);
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
      .upload(tempFileName, blob, {
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
