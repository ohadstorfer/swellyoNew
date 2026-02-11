import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../../config/supabase';

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
const LIFESTYLE_IMAGES_BUCKET = 'lifestyle-images';

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
    // Country not in the map - construct filename from country name
    // Convert "New Zealand" -> "NewZealand", "Costa Rica" -> "CostaRica", etc.
    const constructed = normalized
      .split(/[\s-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
    
    return `${constructed}.jpg`;
  }
  
  return `${baseFileName}.jpg`;
};

/**
 * Get the public URL for a country image stored in Supabase storage
 * Always returns a URL (even if image doesn't exist yet) - let Image component's onError handle 404s
 * This allows us to try bucket first, then fallback to Pexels if needed
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
        return data.photos[0].src.small || data.photos[0].src.tiny || data.photos[0].src.medium;
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
 * Upload a country image to Supabase storage bucket
 * This is called when a Pexels image is successfully fetched for a country
 * that doesn't have an image in the bucket yet
 * 
 * @param countryName - The country name
 * @param imageUrl - The Pexels image URL to upload
 * @returns The public URL of the uploaded image, or null if upload failed
 */
export const uploadCountryImageToStorage = async (
  countryName: string,
  imageUrl: string
): Promise<string | null> => {
  if (!SUPABASE_URL || !countryName || !imageUrl) {
    if (__DEV__) {
      console.warn('[uploadCountryImageToStorage] Missing required parameters');
    }
    return null;
  }

  try {
    // Get the filename for this country
    const fileName = getCountryImageFileName(countryName);
    if (!fileName) {
      if (__DEV__) {
        console.warn('[uploadCountryImageToStorage] Could not generate filename for:', countryName);
      }
      return null;
    }

    // Fetch the image from Pexels URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      if (__DEV__) {
        console.warn('[uploadCountryImageToStorage] Failed to fetch image from Pexels:', response.status);
      }
      return null;
    }

    // Convert to blob
    const blob = await response.blob();

    // Upload to Supabase storage
    const { data, error } = await supabase.storage
      .from(COUNTRIES_BUCKET)
      .upload(fileName, blob, {
        contentType: 'image/jpeg',
        upsert: true, // Overwrite if exists
      });

    if (error) {
      if (__DEV__) {
        console.warn('[uploadCountryImageToStorage] Upload error:', error);
      }
      return null;
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(COUNTRIES_BUCKET)
      .getPublicUrl(data.path);

    if (__DEV__) {
      console.log('[uploadCountryImageToStorage] Successfully uploaded:', countryName, '->', urlData.publicUrl);
    }

    return urlData.publicUrl;
  } catch (error) {
    if (__DEV__) {
      console.error('[uploadCountryImageToStorage] Exception:', error);
    }
    return null;
  }
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

// ============================================================================
// Lifestyle Images Functions
// ============================================================================

/**
 * Common words to remove from lifestyle keywords to extract core keyword
 * These are common suffixes/prefixes that don't change the core meaning
 */
const LIFESTYLE_STOP_WORDS = [
  'training', 'practice', 'classes', 'class', 'session', 'sessions',
  'workout', 'workouts', 'exercise', 'exercises', 'activity', 'activities',
  'doing', 'love', 'enjoy', 'enjoying', 'support', 'supporting',
  'and', 'or', 'the', 'a', 'an', 'for', 'with', 'in', 'on', 'at'
];

/**
 * Normalize lifestyle keyword by extracting core keyword from phrases
 * Handles variations like "Yoga training" -> "yoga", "remote work" -> "remote work"
 * 
 * @param keyword - The lifestyle keyword (can be any text)
 * @returns Normalized keyword for filename generation
 */
const normalizeLifestyleKeyword = (keyword: string): string => {
  if (!keyword) return '';
  
  // Trim and lowercase for normalization
  let normalized = keyword.trim().toLowerCase();
  
  // Remove common stop words to extract core keyword
  // Split by spaces/hyphens and filter out stop words
  const words = normalized.split(/[\s-]+/).filter(word => {
    const cleanWord = word.replace(/[^a-z0-9]/g, ''); // Remove special chars
    return cleanWord && !LIFESTYLE_STOP_WORDS.includes(cleanWord);
  });
  
  // If we filtered out everything, use original (trimmed, lowercase)
  if (words.length === 0) {
    return normalized.replace(/[^a-z0-9\s-]/g, '').trim();
  }
  
  // Join remaining words with space (will be converted to PascalCase in filename)
  return words.join(' ');
};

/**
 * Map lifestyle keyword to image filename
 * Handles ANY text input, not just predefined keywords
 * Normalizes variations like "Yoga training" -> "Yoga.jpg"
 */
const getLifestyleImageFileName = (lifestyleKeyword: string): string | null => {
  if (!lifestyleKeyword) return null;
  
  // Normalize to extract core keyword
  const normalized = normalizeLifestyleKeyword(lifestyleKeyword);
  if (!normalized) return null;
  
  // Convert to PascalCase filename
  // Split by spaces/hyphens, capitalize first letter of each word, join
  const fileName = normalized
    .split(/[\s-]+/)
    .filter(word => word.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  
  if (!fileName) return null;
  
  // Extension will be added during upload based on image type
  // For storage check, we'll try multiple extensions
  return fileName;
};

/**
 * Get the public URL for a lifestyle image stored in Supabase storage
 * Tries multiple extensions (.jpg, .png, .webp) since format is auto-detected
 * Always returns a URL (even if image doesn't exist yet) - let Image component's onError handle 404s
 */
export const getLifestyleImageFromStorage = (lifestyleKeyword: string): string | null => {
  if (!SUPABASE_URL) {
    if (__DEV__) {
      console.warn('[getLifestyleImageFromStorage] SUPABASE_URL is not set');
    }
    return null;
  }
  
  const baseFileName = getLifestyleImageFileName(lifestyleKeyword);
  if (!baseFileName) {
    return null;
  }
  
  // Try .jpg first (most common), then .png, then .webp
  // For now, return .jpg URL - if it doesn't exist, onError will trigger Pexels fetch
  // Alternative: Could check all three, but that requires multiple API calls
  // Better to let Image component's onError handle 404s
  const fileName = `${baseFileName}.jpg`;
  const encodedFileName = encodeURIComponent(fileName);
  const url = `${SUPABASE_URL}/storage/v1/object/public/${LIFESTYLE_IMAGES_BUCKET}/${encodedFileName}`;
  
  if (__DEV__) {
    console.log('[getLifestyleImageFromStorage] Lifestyle:', lifestyleKeyword, '-> File:', fileName, '-> URL:', url);
  }
  
  return url;
};

/**
 * Get a fallback lifestyle image URL
 * Uses Lorem Picsum - a free, reliable service that doesn't require API keys
 */
export const getLifestyleImageFallback = (lifestyleKeyword: string): string => {
  if (!lifestyleKeyword) {
    return getLifestyleImagePlaceholder('lifestyle');
  }
  
  return getLifestyleImagePlaceholder(lifestyleKeyword);
};

/**
 * Get a placeholder image for a lifestyle keyword
 */
const getLifestyleImagePlaceholder = (lifestyleKeyword: string): string => {
  const seed = lifestyleKeyword.toLowerCase().split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const width = 350;
  const height = 350; // Square for lifestyle icons
  
  return `https://picsum.photos/seed/${seed}/${width}/${height}`;
};

/**
 * Get a lifestyle image from Pexels API (optional, requires API key)
 * Uses the ORIGINAL keyword text for search (better results than normalized)
 * Pexels can handle variations like "Yoga training" better than just "yoga"
 * 
 * @param lifestyleKeyword - The original lifestyle keyword (can be any text)
 * @returns Pexels image URL or null
 */
export const getLifestyleImageFromPexels = async (lifestyleKeyword: string): Promise<string | null> => {
  if (!lifestyleKeyword) return null;
  
  const PEXELS_API_KEY = process.env.EXPO_PUBLIC_PEXELS_API_KEY;
  if (!PEXELS_API_KEY) {
    return null;
  }
  
  try {
    // Use original keyword for Pexels search (better results)
    // Pexels can handle phrases like "Yoga training" better than normalized "yoga"
    const searchQuery = lifestyleKeyword.trim();
    const encodedQuery = encodeURIComponent(searchQuery);
    
    // Pexels API endpoint - use square orientation for lifestyle icons
    const apiUrl = `https://api.pexels.com/v1/search?query=${encodedQuery}&per_page=1&orientation=square`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': PEXELS_API_KEY,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.photos && data.photos.length > 0) {
        // Return medium size (350x350, good for square lifestyle icons)
        return data.photos[0].src.medium || data.photos[0].src.small || data.photos[0].src.tiny;
      }
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[getLifestyleImageFromPexels] Error fetching from Pexels:', error);
    }
  }
  
  return null;
};

/**
 * Upload a lifestyle image to Supabase storage bucket
 * Auto-detects image format from blob and uses appropriate extension
 * Uses normalized keyword for filename to ensure consistency
 * 
 * @param lifestyleKeyword - The original lifestyle keyword
 * @param imageUrl - The Pexels image URL to upload
 * @returns The public URL of the uploaded image, or null if upload failed
 */
export const uploadLifestyleImageToStorage = async (
  lifestyleKeyword: string,
  imageUrl: string
): Promise<string | null> => {
  if (!SUPABASE_URL || !lifestyleKeyword || !imageUrl) {
    if (__DEV__) {
      console.warn('[uploadLifestyleImageToStorage] Missing required parameters');
    }
    return null;
  }

  try {
    // Get the base filename using normalized keyword (for consistency)
    const baseFileName = getLifestyleImageFileName(lifestyleKeyword);
    if (!baseFileName) {
      if (__DEV__) {
        console.warn('[uploadLifestyleImageToStorage] Could not generate filename for:', lifestyleKeyword);
      }
      return null;
    }

    // Fetch the image from Pexels URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      if (__DEV__) {
        console.warn('[uploadLifestyleImageToStorage] Failed to fetch image from Pexels:', response.status);
      }
      return null;
    }

    // Convert to blob and detect MIME type
    const blob = await response.blob();
    const mimeType = blob.type || 'image/jpeg'; // Default to jpeg
    
    // Determine file extension from MIME type
    let extension = '.jpg';
    let contentType = 'image/jpeg';
    
    if (mimeType.includes('png')) {
      extension = '.png';
      contentType = 'image/png';
    } else if (mimeType.includes('webp')) {
      extension = '.webp';
      contentType = 'image/webp';
    } else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      extension = '.jpg';
      contentType = 'image/jpeg';
    }
    
    const fileName = `${baseFileName}${extension}`;

    // Upload to Supabase storage
    const { data, error } = await supabase.storage
      .from(LIFESTYLE_IMAGES_BUCKET)
      .upload(fileName, blob, {
        contentType,
        upsert: true, // Overwrite if exists
      });

    if (error) {
      if (__DEV__) {
        console.warn('[uploadLifestyleImageToStorage] Upload error:', error);
      }
      return null;
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(LIFESTYLE_IMAGES_BUCKET)
      .getPublicUrl(data.path);

    if (__DEV__) {
      console.log('[uploadLifestyleImageToStorage] Successfully uploaded:', lifestyleKeyword, '->', urlData.publicUrl);
    }

    return urlData.publicUrl;
  } catch (error) {
    if (__DEV__) {
      console.error('[uploadLifestyleImageToStorage] Exception:', error);
    }
    return null;
  }
};

