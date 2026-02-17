/**
 * Image Upload Service
 * Handles image compression, thumbnail generation, and upload to Supabase Storage
 */

import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ImageMetadata } from './messagingService';

// Conditionally import expo-image-manipulator only for native platforms
let ImageManipulator: any = null;
if (Platform.OS !== 'web') {
  try {
    ImageManipulator = require('expo-image-manipulator');
  } catch (error) {
    console.warn('[imageUploadService] expo-image-manipulator not available:', error);
  }
}

export interface PendingUpload {
  messageId: string;  // Real message ID (from DB)
  conversationId: string;
  localImageUri: string;  // Local file path
  compressedImageUri?: string;
  thumbnailUri?: string;
  uploadProgress?: number;
  createdAt: number;  // Timestamp
  retryCount: number;
}

export interface ImageProcessingResult {
  originalUri: string;
  thumbnailUri: string;
  width: number;
  height: number;
  fileSize: number;
  mimeType: string;
}

export interface UploadProgress {
  progress: number;  // 0-100
  uploaded: number;  // bytes uploaded
  total: number;     // total bytes
}

const PENDING_UPLOAD_KEY_PREFIX = '@pending_upload_';
const MAX_RETRIES = 3;
const MAX_IMAGE_SIZE_MB = 10;
const MAX_IMAGE_DIMENSIONS = 2048;
const THUMBNAIL_WIDTH = 300;
const ORIGINAL_JPEG_QUALITY = 0.85;
const THUMBNAIL_JPEG_QUALITY = 0.8;

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
 * Get file size from URI
 */
export const getFileSize = async (uri: string): Promise<number> => {
  if (uri.startsWith('data:')) {
    // Base64 data URL
    const arr = uri.split(',');
    return Math.round(arr[1].length * 0.75); // Approximate size
  } else {
    // File URI - fetch and get size
    const response = await fetch(uri);
    const blob = await response.blob();
    return blob.size;
  }
};

/**
 * Get image dimensions from URI
 */
export const getImageDimensions = async (uri: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    if (Platform.OS === 'web') {
      // Use HTMLImageElement constructor for web
      const ImageConstructor = (typeof window !== 'undefined' && window.Image) || (global as any).Image;
      const img = new ImageConstructor();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = reject;
      img.src = uri;
    } else {
      // React Native
      const Image = require('react-native').Image;
      Image.getSize(
        uri,
        (width: number, height: number) => {
          resolve({ width, height });
        },
        reject
      );
    }
  });
};

/**
 * Compress and resize image using Canvas API (web)
 */
async function compressImageWeb(uri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use HTMLImageElement constructor for web
    const ImageConstructor = (typeof window !== 'undefined' && window.Image) || (global as any).Image;
    const img = new ImageConstructor();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      // Resize if dimensions exceed limits
      if (width > MAX_IMAGE_DIMENSIONS || height > MAX_IMAGE_DIMENSIONS) {
        const ratio = Math.min(MAX_IMAGE_DIMENSIONS / width, MAX_IMAGE_DIMENSIONS / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to JPEG with quality
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        ORIGINAL_JPEG_QUALITY
      );
    };
    
    img.onerror = reject;
    img.src = uri;
  });
}

/**
 * Compress and resize image
 */
export async function compressImage(uri: string): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      return await compressImageWeb(uri);
    }
    
    if (!ImageManipulator) {
      throw new Error('expo-image-manipulator is not available');
    }
    
    const dimensions = await getImageDimensions(uri);
    
    // Resize if dimensions exceed limits
    let resizeAction: any = null;
    if (dimensions.width > MAX_IMAGE_DIMENSIONS || dimensions.height > MAX_IMAGE_DIMENSIONS) {
      // Calculate new dimensions maintaining aspect ratio
      const ratio = Math.min(MAX_IMAGE_DIMENSIONS / dimensions.width, MAX_IMAGE_DIMENSIONS / dimensions.height);
      resizeAction = {
        resize: {
          width: Math.round(dimensions.width * ratio),
          height: Math.round(dimensions.height * ratio),
        },
      };
    }

    const actions = resizeAction ? [resizeAction] : [];
    
    const result = await ImageManipulator.manipulateAsync(
      uri,
      actions,
      {
        compress: ORIGINAL_JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    return result.uri;
  } catch (error) {
    console.error('[imageUploadService] Error compressing image:', error);
    throw error;
  }
}

/**
 * Generate thumbnail from image using Canvas API (web)
 */
async function generateThumbnailWeb(uri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use HTMLImageElement constructor for web
    const ImageConstructor = (typeof window !== 'undefined' && window.Image) || (global as any).Image;
    const img = new ImageConstructor();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      // Calculate thumbnail dimensions maintaining aspect ratio
      const ratio = THUMBNAIL_WIDTH / width;
      width = THUMBNAIL_WIDTH;
      height = Math.round(height * ratio);
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to JPEG with quality
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        THUMBNAIL_JPEG_QUALITY
      );
    };
    
    img.onerror = reject;
    img.src = uri;
  });
}

/**
 * Generate thumbnail from image
 */
export async function generateThumbnail(uri: string): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      return await generateThumbnailWeb(uri);
    }
    
    if (!ImageManipulator) {
      throw new Error('expo-image-manipulator is not available');
    }
    
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: THUMBNAIL_WIDTH } }],  // Maintain aspect ratio
      {
        compress: THUMBNAIL_JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    return result.uri;
  } catch (error) {
    console.error('[imageUploadService] Error generating thumbnail:', error);
    throw error;
  }
}

/**
 * Process image: compress and generate thumbnail
 */
export async function processImage(uri: string): Promise<ImageProcessingResult> {
  try {
    // Validate file size
    const fileSize = await getFileSize(uri);
    if (fileSize > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      throw new Error(`Image size exceeds ${MAX_IMAGE_SIZE_MB}MB limit`);
    }

    // Compress original
    const compressedUri = await compressImage(uri);
    
    // Generate thumbnail
    const thumbnailUri = await generateThumbnail(compressedUri);
    
    // Get final dimensions and size
    const dimensions = await getImageDimensions(compressedUri);
    const finalSize = await getFileSize(compressedUri);

    return {
      originalUri: compressedUri,
      thumbnailUri,
      width: dimensions.width,
      height: dimensions.height,
      fileSize: finalSize,
      mimeType: 'image/jpeg',
    };
  } catch (error) {
    console.error('[imageUploadService] Error processing image:', error);
    throw error;
  }
}

/**
 * Upload image to Supabase Storage
 */
export async function uploadImageToStorage(
  imageUri: string,
  conversationId: string,
  messageId: string,
  isThumbnail: boolean = false,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }

  try {
    // Convert URI to Blob
    let blob: Blob;
    if (imageUri.startsWith('data:')) {
      blob = dataURLtoBlob(imageUri);
    } else if (imageUri.startsWith('blob:')) {
      blob = await uriToBlob(imageUri);
    } else if (imageUri.startsWith('file://') || imageUri.startsWith('content://') || imageUri.startsWith('ph://')) {
      blob = await uriToBlob(imageUri);
    } else {
      blob = await uriToBlob(imageUri);
    }

    // Construct storage path: {conversation_id}/{message_id}/original.jpg or thumbnail.jpg
    const fileName = isThumbnail ? 'thumbnail.jpg' : 'original.jpg';
    const storagePath = `${conversationId}/${messageId}/${fileName}`;

    // Upload to storage
    // Note: Supabase Storage doesn't support progress callbacks directly
    // We'll simulate progress for now
    const { data, error } = await supabase.storage
      .from('message-images')
      .upload(storagePath, blob, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.error('[imageUploadService] Upload error:', error);
      throw error;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('message-images')
      .getPublicUrl(data.path);

    return urlData.publicUrl;
  } catch (error) {
    console.error('[imageUploadService] Error uploading image:', error);
    throw error;
  }
}

/**
 * Save pending upload to AsyncStorage
 */
export async function savePendingUpload(upload: PendingUpload): Promise<void> {
  try {
    const key = `${PENDING_UPLOAD_KEY_PREFIX}${upload.messageId}`;
    await AsyncStorage.setItem(key, JSON.stringify(upload));
  } catch (error) {
    console.error('[imageUploadService] Error saving pending upload:', error);
  }
}

/**
 * Get pending upload from AsyncStorage
 */
export async function getPendingUpload(messageId: string): Promise<PendingUpload | null> {
  try {
    const key = `${PENDING_UPLOAD_KEY_PREFIX}${messageId}`;
    const data = await AsyncStorage.getItem(key);
    if (!data) return null;
    return JSON.parse(data) as PendingUpload;
  } catch (error) {
    console.error('[imageUploadService] Error getting pending upload:', error);
    return null;
  }
}

/**
 * Get all pending uploads
 */
export async function getAllPendingUploads(): Promise<PendingUpload[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const pendingKeys = keys.filter(key => key.startsWith(PENDING_UPLOAD_KEY_PREFIX));
    
    if (pendingKeys.length === 0) return [];

    const items = await AsyncStorage.multiGet(pendingKeys);
    const uploads: PendingUpload[] = [];
    
    for (const [key, value] of items) {
      if (value) {
        try {
          uploads.push(JSON.parse(value) as PendingUpload);
        } catch (error) {
          console.error('[imageUploadService] Error parsing pending upload:', error);
        }
      }
    }
    
    return uploads;
  } catch (error) {
    console.error('[imageUploadService] Error getting all pending uploads:', error);
    return [];
  }
}

/**
 * Remove pending upload from AsyncStorage
 */
export async function removePendingUpload(messageId: string): Promise<void> {
  try {
    const key = `${PENDING_UPLOAD_KEY_PREFIX}${messageId}`;
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error('[imageUploadService] Error removing pending upload:', error);
  }
}

/**
 * Clear all pending uploads
 */
export async function clearAllPendingUploads(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const pendingKeys = keys.filter(key => key.startsWith(PENDING_UPLOAD_KEY_PREFIX));
    if (pendingKeys.length > 0) {
      await AsyncStorage.multiRemove(pendingKeys);
    }
  } catch (error) {
    console.error('[imageUploadService] Error clearing pending uploads:', error);
  }
}

