import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Image Service
 * 
 * Provides utilities for handling images across platforms.
 * On web: uses public folder paths
 * On mobile: uses full dev server URL with proper encoding
 */

/**
 * Get the proper image URL for the current platform
 * On web: uses public folder paths
 * On mobile: uses full dev server URL with proper encoding
 */
export const getImageUrl = (path: string): string => {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  if (Platform.OS === 'web') {
    // On web, use public folder paths directly
    return normalizedPath;
  }
  
  // On mobile (iOS/Android), we need to use the dev server URL
  // For Expo Go, images in public folder need to be accessed via the Metro dev server
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
          console.log(`[getImageUrl] Resolved: ${normalizedPath} -> ${fullUrl}`);
        }
        
        return fullUrl;
      }
    } catch (error) {
      console.warn('Error getting dev server URL for image:', error);
    }
    
    // Fallback: return path as-is (will show warning)
    // Note: This may not work in Expo Go - images should be in assets folder or served from a URL
    if (__DEV__) {
      console.warn(`Image path ${normalizedPath} may not work on mobile. Constants.debuggerHost not available.`);
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
  
  // Production: images should be bundled as assets or served from CDN
  // For now, return the path as-is (will need to be updated for production)
  return normalizedPath;
};

