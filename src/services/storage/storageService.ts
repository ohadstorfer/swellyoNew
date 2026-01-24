import { supabase } from '../../config/supabase';
import { Platform } from 'react-native';

/**
 * Storage Service
 * Handles file uploads to Supabase Storage
 */

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

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
