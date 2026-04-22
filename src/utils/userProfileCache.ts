import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { SupabaseSurfer } from '../services/database/supabaseDatabaseService';

const USER_PROFILE_CACHE_KEY = '@swellyo_user_profile';
const FULL_PROFILE_CACHE_KEY = '@swellyo_user_profile_full';
const CACHE_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedUserProfile {
  name: string;
  photo: string | null;
  userId: string;
  timestamp?: number;
}

export interface CachedFullUserProfile {
  userId: string;
  surfer: SupabaseSurfer;
  timestamp: number;
}

// Safari private mode throws on localStorage access; one shared guard avoids code duplication.
const isWebStorageAvailable = (): boolean => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true;
  try {
    const testKey = '__storage_test__';
    window.localStorage.setItem(testKey, 'test');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
};

/**
 * Load cached user profile from AsyncStorage
 */
export const loadCachedUserProfile = async (): Promise<CachedUserProfile | null> => {
  try {
    // Check if AsyncStorage is available (handles Safari private mode and other edge cases)
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        // Test localStorage availability (Safari private mode throws)
        const testKey = '__storage_test__';
        window.localStorage.setItem(testKey, 'test');
        window.localStorage.removeItem(testKey);
      } catch (e) {
        // localStorage not available (e.g., Safari private mode)
        console.warn('localStorage not available, skipping cache load');
        return null;
      }
    }
    
    const cached = await AsyncStorage.getItem(USER_PROFILE_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      // Check if cache is still valid (optional - can remove timestamp check for permanent cache)
      const age = Date.now() - (data.timestamp || 0);
      if (age < CACHE_VALIDITY_MS) {
        return { name: data.name, photo: data.photo, userId: data.userId };
      }
    }
  } catch (error) {
    // Gracefully handle storage errors (Safari private mode, quota exceeded, etc.)
    console.warn('Error loading cached user profile (will fetch from server):', error);
  }
  return null;
};

/**
 * Save user profile to cache
 */
export const saveCachedUserProfile = async (name: string, photo: string | null, userId: string): Promise<void> => {
  try {
    // Check if AsyncStorage is available (handles Safari private mode and other edge cases)
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        // Test localStorage availability (Safari private mode throws)
        const testKey = '__storage_test__';
        window.localStorage.setItem(testKey, 'test');
        window.localStorage.removeItem(testKey);
      } catch (e) {
        // localStorage not available (e.g., Safari private mode)
        console.warn('localStorage not available, skipping cache save');
        return;
      }
    }
    
    await AsyncStorage.setItem(USER_PROFILE_CACHE_KEY, JSON.stringify({
      name,
      photo,
      userId,
      timestamp: Date.now(),
    }));
  } catch (error) {
    // Gracefully handle storage errors (Safari private mode, quota exceeded, etc.)
    // Don't throw - caching is optional, app should work without it
    console.warn('Error saving cached user profile (non-critical):', error);
  }
};

/**
 * Update only the photo in the cached user profile
 */
export const updateCachedUserProfilePhoto = async (photo: string | null, userId: string): Promise<void> => {
  try {
    // Load existing cache
    const cached = await loadCachedUserProfile();
    
    if (cached && cached.userId === userId) {
      // Update photo while keeping existing name
      await saveCachedUserProfile(cached.name, photo, userId);
    } else {
      // If no cache exists or userId doesn't match, we can't update
      // Just save with a placeholder name (will be updated on next full cache)
      await saveCachedUserProfile('User', photo, userId);
    }
  } catch (error) {
    console.warn('Error updating cached user profile photo:', error);
  }
};

/**
 * Clear cached user profile (e.g. on logout).
 * Non-throwing; safe to call from logout handlers.
 */
export const clearCachedUserProfile = async (): Promise<void> => {
  try {
    if (!isWebStorageAvailable()) return;
    await AsyncStorage.multiRemove([USER_PROFILE_CACHE_KEY, FULL_PROFILE_CACHE_KEY]);
  } catch (error) {
    console.warn('Error clearing cached user profile (non-critical):', error);
  }
};

/**
 * Load the full cached surfer profile (all fields) for the logged-in user.
 * Returns null if cache missing, expired, or storage unavailable.
 */
export const loadCachedFullProfile = async (): Promise<CachedFullUserProfile | null> => {
  try {
    if (!isWebStorageAvailable()) return null;
    const cached = await AsyncStorage.getItem(FULL_PROFILE_CACHE_KEY);
    if (!cached) return null;
    const data = JSON.parse(cached) as CachedFullUserProfile;
    const age = Date.now() - (data.timestamp || 0);
    if (age >= CACHE_VALIDITY_MS) return null;
    return data;
  } catch (error) {
    console.warn('Error loading cached full profile (will fetch from server):', error);
    return null;
  }
};

/**
 * Persist the full surfer profile to cache. Also updates the lightweight
 * CachedUserProfile so the two caches stay in sync for consumers that only
 * need name/photo (e.g., ConversationsScreen header legacy path).
 */
export const saveCachedFullProfile = async (surfer: SupabaseSurfer): Promise<void> => {
  try {
    if (!isWebStorageAvailable()) return;
    const payload: CachedFullUserProfile = {
      userId: surfer.user_id,
      surfer,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(FULL_PROFILE_CACHE_KEY, JSON.stringify(payload));
    // Keep lightweight cache in sync so legacy readers see fresh data.
    await saveCachedUserProfile(
      surfer.name,
      surfer.profile_image_url ?? null,
      surfer.user_id,
    );
  } catch (error) {
    console.warn('Error saving cached full profile (non-critical):', error);
  }
};

