import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

/**
 * Video Validation Constants
 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_DURATION_SECONDS = 20; // 20 seconds (UI limit)
export const ALLOWED_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
export const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi'];

/**
 * Format file size in human-readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Get file extension from URI or filename
 * Handles various URI formats including content:// and file:// without extensions
 */
export const getFileExtension = (uri: string): string => {
  // Try to extract extension from URI path
  let match = uri.match(/\.([a-zA-Z0-9]+)(\?|$|#)/);
  if (match) {
    return `.${match[1].toLowerCase()}`;
  }
  
  // For content:// URIs, try to get extension from the path segment
  if (uri.startsWith('content://')) {
    const pathMatch = uri.match(/\/[^/]+\.([a-zA-Z0-9]+)(\?|$|#)/);
    if (pathMatch) {
      return `.${pathMatch[1].toLowerCase()}`;
    }
  }
  
  // For file:// URIs, try to get extension from filename
  if (uri.startsWith('file://')) {
    const pathMatch = uri.match(/[^/]+\.([a-zA-Z0-9]+)(\?|$|#)/);
    if (pathMatch) {
      return `.${pathMatch[1].toLowerCase()}`;
    }
  }
  
  return '';
};

/**
 * Get MIME type from file extension
 */
export const getMimeTypeFromExtension = (extension: string): string | null => {
  const mimeMap: { [key: string]: string } = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
  };
  return mimeMap[extension.toLowerCase()] || null;
};

/**
 * Video metadata interface
 */
export interface VideoMetadata {
  duration: number; // in seconds
  width?: number;
  height?: number;
  fileSize: number; // in bytes
  mimeType?: string;
}

/**
 * Validate video file format and size
 */
export const validateVideoFile = async (
  uri: string,
  fileSize?: number,
  mimeType?: string
): Promise<{ valid: boolean; error?: string }> => {
  try {
    // Get file extension
    let extension = getFileExtension(uri);
    
    // If no extension found, try to infer from MIME type
    if (!extension && mimeType) {
      const mimeToExt: { [key: string]: string } = {
        'video/mp4': '.mp4',
        'video/quicktime': '.mov',
        'video/x-quicktime': '.mov',
        'video/webm': '.webm',
        'video/x-msvideo': '.avi',
      };
      extension = mimeToExt[mimeType] || '';
    }
    
    // If still no extension, allow on mobile (will be validated by MIME type during upload)
    if (!extension) {
      if (Platform.OS === 'web') {
        return { valid: false, error: 'Could not determine file format. Please ensure the file is a valid video (MP4, MOV, WebM, or AVI).' };
      }
      // On mobile, we'll validate by MIME type during upload
      // Continue with validation
    } else {
      // Check if extension is allowed
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return {
          valid: false,
          error: `Invalid video format. Allowed formats: ${ALLOWED_EXTENSIONS.join(', ')}`,
        };
      }
    }

    // Get file size if not provided
    let actualFileSize = fileSize;
    if (!actualFileSize) {
      if (Platform.OS === 'web') {
        // For web, we need to fetch the file to get size
        // This will be done in the upload function
      } else {
        // For mobile, use FileSystem
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (fileInfo.exists && 'size' in fileInfo) {
          actualFileSize = fileInfo.size;
        }
      }
    }

    // Validate file size
    if (actualFileSize && actualFileSize > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
};

/**
 * Get video metadata (duration, resolution, etc.)
 */
export const getVideoMetadata = async (uri: string): Promise<VideoMetadata | null> => {
  try {
    if (Platform.OS === 'web') {
      // For web, use HTML5 video element
      return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        
        video.onloadedmetadata = () => {
          const duration = video.duration;
          const width = video.videoWidth;
          const height = video.videoHeight;
          
          // Get file size
          fetch(uri)
            .then((response) => {
              const contentLength = response.headers.get('content-length');
              const fileSize = contentLength ? parseInt(contentLength, 10) : 0;
              
              resolve({
                duration,
                width,
                height,
                fileSize,
                mimeType: video.type || getMimeTypeFromExtension(getFileExtension(uri)) || undefined,
              });
            })
            .catch(() => {
              resolve({
                duration,
                width,
                height,
                fileSize: 0,
                mimeType: video.type || getMimeTypeFromExtension(getFileExtension(uri)) || undefined,
              });
            });
        };
        
        video.onerror = () => {
          reject(new Error('Failed to load video metadata'));
        };
        
        video.src = uri;
      });
    } else {
      // For mobile, use FileSystem to get file size
      // Duration and resolution will be validated during upload if needed
      let fileSize = 0;
      try {
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (fileInfo.exists && 'size' in fileInfo) {
          fileSize = fileInfo.size;
        }
      } catch (error) {
        console.warn('Could not get file size:', error);
      }
      
      // For mobile, we'll validate duration during upload using HTML5 video if possible
      // or rely on file size validation
      return {
        duration: 0, // Will be validated during upload if possible
        fileSize,
        mimeType: getMimeTypeFromExtension(getFileExtension(uri)) || undefined,
      };
    }
  } catch (error) {
    console.error('Error getting video metadata:', error);
    return null;
  }
};

/**
 * Validate video duration
 */
export const validateVideoDuration = (duration: number): { valid: boolean; error?: string } => {
  if (duration > MAX_DURATION_SECONDS) {
    return {
      valid: false,
      error: `Video is too long. Maximum duration is ${MAX_DURATION_SECONDS} seconds. Please trim your video and try again.`,
    };
  }
  return { valid: true };
};

/**
 * Complete video validation (format, size, duration)
 * Note: Duration validation may be skipped on mobile if metadata cannot be extracted
 */
export const validateVideoComplete = async (
  uri: string,
  mimeType?: string
): Promise<{ valid: boolean; error?: string; metadata?: VideoMetadata }> => {
  // Step 1: Validate file format and size
  const formatValidation = await validateVideoFile(uri, undefined, mimeType);
  if (!formatValidation.valid) {
    return formatValidation;
  }

  // Step 2: Get metadata
  const metadata = await getVideoMetadata(uri);
  if (!metadata) {
    // On mobile, if we can't get metadata, we'll still allow upload
    // but validate format and size which we already did
    if (Platform.OS !== 'web') {
      return { valid: true }; // Allow on mobile if format is valid
    }
    return {
      valid: false,
      error: 'Could not read video metadata. Please ensure the file is a valid video.',
    };
  }

  // Step 3: Validate file size from metadata
  if (metadata.fileSize > 0 && metadata.fileSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}`,
    };
  }

  // Step 4: Validate duration (only if we have duration info)
  if (metadata.duration > 0) {
    const durationValidation = validateVideoDuration(metadata.duration);
    if (!durationValidation.valid) {
      return durationValidation;
    }
  }

  return { valid: true, metadata };
};

