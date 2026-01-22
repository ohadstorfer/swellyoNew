import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Video Service
 * 
 * Provides utilities for handling videos across platforms with optimized serving.
 * Best practices:
 * - Lazy loading for better performance
 * - Preload metadata only (not full video)
 * - Proper MIME types
 * - Optimized compression settings
 * 
 * On web: uses public folder paths OR Supabase storage URLs
 * On mobile: uses full dev server URL or asset paths OR Supabase storage URLs
 */

// Supabase storage configuration
// Use the same Supabase URL from environment variables to ensure consistency
// This should match EXPO_PUBLIC_SUPABASE_URL in your .env file
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const SURF_LEVEL_VIDEOS_BUCKET = 'surf-level-videos';

if (!SUPABASE_URL) {
  console.error('[videoService] EXPO_PUBLIC_SUPABASE_URL is not set. Video URLs will not work correctly.');
} else if (__DEV__) {
  console.log('[videoService] Using Supabase URL:', SUPABASE_URL);
}

/**
 * Get the public URL for a video stored in Supabase storage
 * Path should be relative to the bucket root (e.g., 'shortboard/Dipping My Toes.mp4')
 */
export const getSurfLevelVideoFromStorage = (bucketPath: string): string => {
  // Encode path segments to handle spaces and special characters
  // Supabase storage expects each path segment to be URL-encoded separately
  const pathParts = bucketPath.split('/').filter(Boolean);
  const encodedParts = pathParts.map(part => {
    // encodeURIComponent handles spaces, special chars, etc.
    // This converts "Dipping My Toes.mp4" to "Dipping%20My%20Toes.mp4"
    return encodeURIComponent(part);
  });
  const encodedPath = encodedParts.join('/');
  
  const url = `${SUPABASE_URL}/storage/v1/object/public/${SURF_LEVEL_VIDEOS_BUCKET}/${encodedPath}`;
  
  if (__DEV__) {
    console.log('[getSurfLevelVideoFromStorage] Input path:', bucketPath);
    console.log('[getSurfLevelVideoFromStorage] Encoded path:', encodedPath);
    console.log('[getSurfLevelVideoFromStorage] Generated URL:', url);
  }
  
  return url;
};

/**
 * Video optimization settings
 */
export const VIDEO_OPTIMIZATION = {
  // Preload strategy: 'none' = don't preload, 'metadata' = preload metadata only, 'auto' = preload full video
  preload: 'metadata' as const,
  // Enable lazy loading
  loading: 'lazy' as const,
  // Playback settings
  playsInline: true,
  muted: true,
  loop: false,
};

/**
 * Get the proper video URL for the current platform
 * On web: uses public folder paths
 * On mobile: uses full dev server URL or asset paths
 */
export const getVideoUrl = (path: string): string => {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  if (Platform.OS === 'web') {
    // On web, use public folder paths directly
    // Add cache-busting query param in development to ensure fresh videos
    if (__DEV__) {
      return `${normalizedPath}?t=${Date.now()}`;
    }
    return normalizedPath;
  }
  
  // On mobile (iOS/Android), we need to use the dev server URL
  // For Expo Go, videos in public folder need to be accessed via the Metro dev server
  if (__DEV__) {
    try {
      // Try multiple methods to get the dev server URL
      let devServerUrl: string | null = null;
      
      // Method 1: Use Constants.debuggerHost (most reliable)
      if (Constants.debuggerHost) {
        // debuggerHost is like "localhost:8081" or "192.168.1.100:8081"
        devServerUrl = `http://${Constants.debuggerHost}`;
      }
      
      // Method 2: Try manifest2 or expoConfig
      if (!devServerUrl) {
        // Try manifest2 first
        if (Constants.manifest2) {
          const m2 = Constants.manifest2 as any;
          // Check various possible locations in manifest2
          if (m2.extra?.expoGoServerUrl) {
            devServerUrl = m2.extra.expoGoServerUrl;
          } else if (m2.extra?.expoGo?.debuggerHost) {
            // expoGo.debuggerHost contains the dev server host
            devServerUrl = `http://${m2.extra.expoGo.debuggerHost}`;
          } else if (m2.extra?.expoGo?.url) {
            // Sometimes it's directly in expoGo.url
            devServerUrl = m2.extra.expoGo.url;
          } else if (m2.extra?.expoClient?.hostUri) {
            // expoClient.hostUri might contain the dev server
            devServerUrl = `http://${m2.extra.expoClient.hostUri}`;
          } else if (m2.server?.url) {
            devServerUrl = m2.server.url;
          } else if (m2.developer?.tool) {
            // Sometimes it's in developer.tool
            const tool = m2.developer.tool;
            if (tool === 'expo-cli' && m2.server) {
              devServerUrl = m2.server.url;
            }
          }
        }
        
        // Try expoConfig
        if (!devServerUrl && Constants.expoConfig) {
          const config = Constants.expoConfig as any;
          if (config.extra?.expoGoServerUrl) {
            devServerUrl = config.extra.expoGoServerUrl;
          } else if (config.server?.url) {
            devServerUrl = config.server.url;
          }
        }
        
        // Try legacy manifest
        if (!devServerUrl && Constants.manifest) {
          const manifest = Constants.manifest as any;
          if (manifest.extra?.expoGoServerUrl) {
            devServerUrl = manifest.extra.expoGoServerUrl;
          } else if (manifest.server?.url) {
            devServerUrl = manifest.server.url;
          }
        }
      }
      
      // Method 3: Try to construct from manifest2 hostUri or similar
      if (!devServerUrl && Constants.manifest2) {
        const m2 = Constants.manifest2 as any;
        // manifest2 might have hostUri or similar
        if (m2.hostUri) {
          devServerUrl = `http://${m2.hostUri}`;
        } else if (m2.extra?.hostUri) {
          devServerUrl = `http://${m2.extra.hostUri}`;
        }
      }
      
      if (devServerUrl) {
        // Encode the path properly to handle spaces and special characters
        // Split path into parts and encode each segment separately
        const pathParts = normalizedPath.split('/').filter(Boolean);
        const encodedParts = pathParts.map(part => encodeURIComponent(part));
        const encodedPath = '/' + encodedParts.join('/');
        
        const fullUrl = `${devServerUrl}${encodedPath}`;
        
        if (__DEV__) {
          console.log(`[getVideoUrl] Resolved: ${normalizedPath} -> ${fullUrl}`);
        }
        
        return fullUrl;
      }
    } catch (error) {
      console.warn('Error getting dev server URL for video:', error);
    }
    
    // Fallback: return path as-is (will show warning)
    // Note: This may not work in Expo Go - videos should be in assets folder or served from a URL
    if (__DEV__) {
      console.warn(`Video path ${normalizedPath} may not work on mobile. Constants.debuggerHost not available.`);
      console.log('Available Constants:', {
        debuggerHost: Constants.debuggerHost,
        hasExpoConfig: !!Constants.expoConfig,
        hasManifest2: !!Constants.manifest2,
        hasManifest: !!Constants.manifest,
      });
      
      // Log manifest2 structure for debugging
      if (Constants.manifest2) {
        const m2 = Constants.manifest2 as any;
        console.log('manifest2 structure:', {
          hasExtra: !!m2.extra,
          hasServer: !!m2.server,
          hasHostUri: !!m2.hostUri,
          extraKeys: m2.extra ? Object.keys(m2.extra) : [],
          serverKeys: m2.server ? Object.keys(m2.server) : [],
          expoGo: m2.extra?.expoGo,
          expoClient: m2.extra?.expoClient,
        });
      }
      
      // Log expoConfig structure for debugging
      if (Constants.expoConfig) {
        const config = Constants.expoConfig as any;
        console.log('expoConfig structure:', {
          hasExtra: !!config.extra,
          hasServer: !!config.server,
          extraKeys: config.extra ? Object.keys(config.extra) : [],
          serverKeys: config.server ? Object.keys(config.server) : [],
        });
      }
    }
    return normalizedPath;
  }
  
  // Production: videos should be bundled as assets or served from CDN
  // For now, return the path as-is (will need to be updated for production)
  return normalizedPath;
};

/**
 * Get video MIME type based on file extension
 */
export const getVideoMimeType = (path: string): string => {
  const ext = path.toLowerCase().split('.').pop();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'video/mp4'; // Default to MP4
  }
};

/**
 * Get optimized video attributes for HTML5 video element
 */
export const getVideoAttributes = () => {
  return {
    preload: VIDEO_OPTIMIZATION.preload,
    playsInline: VIDEO_OPTIMIZATION.playsInline,
    muted: VIDEO_OPTIMIZATION.muted,
    loop: VIDEO_OPTIMIZATION.loop,
    // Add loading attribute for lazy loading (if supported)
    ...(Platform.OS === 'web' && { loading: VIDEO_OPTIMIZATION.loading }),
  };
};

/**
 * Get background video source
 */
export const getBackgroundVideoSource = (): string => {
  if (Platform.OS === 'web') {
    return '/swellyo169welcome.webm';
  }
  // On mobile, use the shorter filename
  return getVideoUrl('/swellyo169welcome.mp4');
};

/**
 * Get background video source MP4 fallback (for mobile web compatibility)
 */
export const getBackgroundVideoSourceMP4 = (): string => {
  if (Platform.OS === 'web') {
    // Use the matching MP4 file (swellyo169welcome.mp4)
    return '/swellyo169welcome.mp4';
  }
  return getVideoUrl('/swellyo169welcome.mp4');
};
