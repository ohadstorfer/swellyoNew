import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const USER_PROFILE_CACHE_KEY = '@swellyo_user_profile';
const CACHE_VALIDITY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedUserProfile {
  name: string;
  photo: string | null;
  userId: string;
  timestamp?: number;
}

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

