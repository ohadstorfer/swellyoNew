import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Image Service
 * 
 * Provides utilities for handling images across platforms.
 * On web: uses public folder paths
 * On mobile: uses full dev server URL with proper encoding
 */

// Supabase storage configuration for country images
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const COUNTRIES_BUCKET = 'Countries';

/**
 * Map country names to their image filenames in the Countries bucket
 * Handles variations like "Brazil.jpg", "Brazil2.jpg", etc.
 * Returns the base filename (without number) - we use the first available image
 */
const getCountryImageFileName = (countryName: string): string | null => {
  if (!countryName) return null;
  
  // Normalize country name: remove extra spaces, handle common variations
  const normalized = countryName.trim();
  const lowerCountry = normalized.toLowerCase();
  
  // Map of country names to their base image filename (without extension)
  // Maps to the base name (e.g., "Brazil.jpg" not "Brazil2.jpg")
  const countryMap: { [key: string]: string } = {
    'australia': 'Australia',
    'brazil': 'Brazil',
    'chile': 'Chile',
    'costa rica': 'CostaRica',
    'costa-rica': 'CostaRica',
    'costarica': 'CostaRica',
    'el salvador': 'ElSalvador',
    'el-salvador': 'ElSalvador',
    'elsalvador': 'ElSalvador',
    'fiji': 'Fiji',
    'france': 'France',
    'hawaii': 'Hawaii',
    'indonesia': 'Indonesia',
    'japan': 'Japan',
    'maldives': 'Maldives',
    'mexico': 'Mexico',
    'morocco': 'Morocco',
    'new zealand': 'NewZealand',
    'new-zealand': 'NewZealand',
    'newzealand': 'NewZealand',
    'nicaragua': 'Nicaragua',
    'panama': 'Panama',
    'peru': 'Peru',
    'philippines': 'Philippines',
    'portugal': 'Portugal',
    'south africa': 'SouthAfrica',
    'south-africa': 'SouthAfrica',
    'southafrica': 'SouthAfrica',
    'spain': 'Spain',
    'sri lanka': 'SriLanka',
    'sri-lanka': 'SriLanka',
    'srilanka': 'SriLanka',
    'tahiti': 'Tahiti',
    // Handle "Blacks Beach" as a special case
    'blacks beach': 'Blacks Beach',
    'blacks-beach': 'Blacks Beach',
  };
  
  const baseFileName = countryMap[lowerCountry];
  
  if (!baseFileName) {
    // Country not in the map - return null
    // This means the image doesn't exist in the Supabase bucket
    // The caller should use the fallback (flag or placeholder) instead
    return null;
  }
  
  return `${baseFileName}.jpg`;
};

/**
 * Get the public URL for a country image stored in Supabase storage
 * Returns null if country name doesn't match any known image
 */
export const getCountryImageFromStorage = (countryName: string): string | null => {
  if (!SUPABASE_URL) {
    if (__DEV__) {
      console.warn('[getCountryImageFromStorage] SUPABASE_URL is not set');
    }
    return null;
  }
  
  const fileName = getCountryImageFileName(countryName);
  if (!fileName) {
    return null;
  }
  
  // Encode the filename to handle spaces and special characters
  const encodedFileName = encodeURIComponent(fileName);
  const url = `${SUPABASE_URL}/storage/v1/object/public/${COUNTRIES_BUCKET}/${encodedFileName}`;
  
  if (__DEV__) {
    console.log('[getCountryImageFromStorage] Country:', countryName, '-> File:', fileName, '-> URL:', url);
  }
  
  return url;
};

/**
 * Get a fallback country image URL
 * Uses Lorem Picsum - a free, reliable service that doesn't require API keys
 * Returns a deterministic image URL based on country name
 * 
 * Note: For better quality, country-specific images, you can optionally use Pexels API
 * Get a free API key from https://www.pexels.com/api/ and add it to .env as EXPO_PUBLIC_PEXELS_API_KEY
 * Then use getCountryImageFromPexels() for async fetching
 */
export const getCountryImageFallback = (countryName: string): string => {
  if (!countryName) {
    return getCountryImagePlaceholder('Beach');
  }
  
  // Use Lorem Picsum with a deterministic seed based on country name
  // This ensures the same country always gets the same image
  return getCountryImagePlaceholder(countryName);
};

/**
 * Get a placeholder image for a country
 * Uses Lorem Picsum - a free, reliable service that doesn't require API keys
 * Returns a deterministic image URL based on country name
 */
const getCountryImagePlaceholder = (countryName: string): string => {
  // Create a deterministic seed from country name
  // This ensures the same country always gets the same image
  const seed = countryName.toLowerCase().split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const width = 350;
  const height = 200;
  
  // Lorem Picsum: Free, reliable, no API key needed, works on all browsers/devices
  // Returns a random but deterministic image based on seed
  // Format: https://picsum.photos/seed/{seed}/{width}/{height}
  return `https://picsum.photos/seed/${seed}/${width}/${height}`;
};

/**
 * Get a fallback country image from Pexels API (optional, requires API key)
 * Pexels provides free, high-quality stock photos
 * Falls back to placeholder if Pexels fails or API key is not available
 * 
 * Note: This is async and requires API key setup. Use getCountryImageFallback() for immediate synchronous fallback.
 */
export const getCountryImageFromPexels = async (countryName: string): Promise<string | null> => {
  if (!countryName) return null;
  
  const PEXELS_API_KEY = process.env.EXPO_PUBLIC_PEXELS_API_KEY;
  if (!PEXELS_API_KEY) {
    // No API key, return null to use synchronous fallback
    return null;
  }
  
  try {
    // Search for country + beach/surf related images
    const searchQuery = `${countryName} beach surf`;
    const encodedQuery = encodeURIComponent(searchQuery);
    
    // Pexels API endpoint
    const apiUrl = `https://api.pexels.com/v1/search?query=${encodedQuery}&per_page=1&orientation=landscape`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': PEXELS_API_KEY,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.photos && data.photos.length > 0) {
        // Return a small/medium size image (src.medium is 350x350, good for thumbnails)
        return data.photos[0].src.medium || data.photos[0].src.small || data.photos[0].src.tiny;
      }
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[getCountryImageFromPexels] Error fetching from Pexels:', error);
    }
  }
  
  // Fallback to placeholder
  return null;
};

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

