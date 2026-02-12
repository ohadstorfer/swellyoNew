/**
 * Conversation List Cache Service
 * Caches conversation list metadata for instant loading
 * Uses version-based invalidation (not TTL)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Conversation } from './messagingService';

interface CachedConversationList {
  conversations: Conversation[];
  lastSync: number; // Timestamp of last sync
  version: number; // Schema version for invalidation
}

const CACHE_KEY = '@swellyo_conversation_list';
const CACHE_VERSION = 1; // Increment when schema changes

/**
 * Load cached conversation list
 */
export async function loadCachedConversationList(): Promise<Conversation[] | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const data: CachedConversationList = JSON.parse(cached);

    // Check version - invalidate if version mismatch
    if (data.version !== CACHE_VERSION) {
      await clearConversationListCache();
      return null;
    }

    return data.conversations || null;
  } catch (error) {
    console.error('Error loading cached conversation list:', error);
    return null;
  }
}

/**
 * Save conversation list to cache
 */
export async function saveCachedConversationList(conversations: Conversation[]): Promise<void> {
  try {
    const data: CachedConversationList = {
      conversations,
      lastSync: Date.now(),
      version: CACHE_VERSION,
    };

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving conversation list to cache:', error);
  }
}

/**
 * Get last sync timestamp
 */
export async function getLastSyncTimestamp(): Promise<number> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return 0;

    const data: CachedConversationList = JSON.parse(cached);
    return data.lastSync || 0;
  } catch (error) {
    console.error('Error getting last sync timestamp:', error);
    return 0;
  }
}

/**
 * Update last sync timestamp
 */
export async function updateLastSyncTimestamp(timestamp: number = Date.now()): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return;

    const data: CachedConversationList = JSON.parse(cached);
    data.lastSync = timestamp;

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Error updating last sync timestamp:', error);
  }
}

/**
 * Clear conversation list cache
 */
export async function clearConversationListCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.error('Error clearing conversation list cache:', error);
  }
}

