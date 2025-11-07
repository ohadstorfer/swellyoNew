import { Platform } from 'react-native';
import Constants from 'expo-constants';

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
    return normalizedPath;
  }
  
  // On mobile (iOS/Android), we need to use the dev server URL
  // For Expo Go, videos in public folder need to be accessed via the Metro dev server
  if (__DEV__) {
    try {
      // Try to get the dev server URL from Constants
      // In Expo Go, Constants.debuggerHost contains the dev server host
      if (Constants.debuggerHost) {
        // debuggerHost is like "localhost:8081" or "192.168.1.100:8081"
        // For public folder assets, we need to use the Metro dev server
        // The public folder is served at the root of the dev server
        return `http://${Constants.debuggerHost}${normalizedPath}`;
      }
      
      // Fallback: try manifest2 or expoConfig
      const manifest = Constants.expoConfig || Constants.manifest2 || Constants.manifest;
      if (manifest) {
        // Try to extract dev server URL from manifest
        if (Constants.manifest2?.extra?.expoGoServerUrl) {
          return `${Constants.manifest2.extra.expoGoServerUrl}${normalizedPath}`;
        }
        
        if ((manifest as any).extra?.expoGoServerUrl) {
          return `${(manifest as any).extra.expoGoServerUrl}${normalizedPath}`;
        }
      }
    } catch (error) {
      console.warn('Error getting dev server URL:', error);
    }
    
    // Fallback: return path as-is
    // Note: This may not work in Expo Go - videos should be in assets folder or served from a URL
    console.warn(`Video path ${normalizedPath} may not work on mobile. Consider using assets or a CDN.`);
    return normalizedPath;
  }
  
  // Production: videos should be bundled as assets or served from CDN
  // For now, return the path as-is (will need to be updated for production)
  return normalizedPath;
};

/**
 * Get background video source
 */
export const getBackgroundVideoSource = (): string => {
  if (Platform.OS === 'web') {
    return '/swellyo welcome video.mp4';
  }
  // On mobile, use the shorter filename
  return getVideoUrl('/swellyo169welcome.mp4');
};

