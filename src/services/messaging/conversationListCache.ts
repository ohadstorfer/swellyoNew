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
  conversationTimestamps: Map<string, number>; // Per-conversation last update timestamps (stored as object for JSON)
  unreadCounts?: Record<string, number>; // Per-conversation unread counts (v3: added for persistence)
}

const CACHE_KEY = '@swellyo_conversation_list';
const CACHE_VERSION = 3; // Increment when schema changes (v3: added unread_count persistence)
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - conversations older than this are considered stale

// Serialization lock to prevent concurrent cache writes
// Uses atomic lock acquisition pattern to prevent micro-races
let saveLock: Promise<void> | null = null;

/**
 * Load cached conversation list
 */
export async function loadCachedConversationList(): Promise<Conversation[] | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const data: CachedConversationList = JSON.parse(cached);

    // Check version - invalidate if version mismatch
    // CRITICAL: Version 3 adds unreadCounts - old cache structure incompatible
    if (data.version !== CACHE_VERSION) {
      console.log(`[conversationListCache] Version mismatch (expected ${CACHE_VERSION}, got ${data.version}), clearing cache`);
      await clearConversationListCache();
      return null;
    }
    
    // CRITICAL: Ensure unreadCounts exists (defensive check for corrupted cache)
    if (!data.unreadCounts) {
      console.warn('[conversationListCache] Cache missing unreadCounts field, initializing empty');
      data.unreadCounts = {};
    }

    // Check for stale conversations (optional - can be used for background refresh)
    const now = Date.now();
    const staleConversations = (data.conversations || []).filter(conv => {
      const convTimestamp = data.conversationTimestamps?.[conv.id] || data.lastSync;
      return (now - convTimestamp) > STALE_THRESHOLD_MS;
    });
    
    if (staleConversations.length > 0) {
      console.log(`[conversationListCache] Found ${staleConversations.length} stale conversations`);
    }

    // Restore unread counts from cache
    const conversationsWithUnreadCounts = (data.conversations || []).map(conv => {
      const cachedUnreadCount = data.unreadCounts?.[conv.id];
      if (cachedUnreadCount !== undefined) {
        return {
          ...conv,
          unread_count: cachedUnreadCount,
        };
      }
      return conv;
    });

    return conversationsWithUnreadCounts.length > 0 ? conversationsWithUnreadCounts : null;
  } catch (error) {
    console.error('Error loading cached conversation list:', error);
    return null;
  }
}

/**
 * Save conversation list to cache
 * CRITICAL: Uses atomic serialization lock to prevent concurrent writes
 * CRITICAL: Re-reads from AsyncStorage after awaiting lock to ensure fresh data
 */
export async function saveCachedConversationList(conversations: Conversation[]): Promise<void> {
  // Atomic lock acquisition - no gap between check and assignment
  const previousLock = saveLock;
  let release!: () => void;
  
  saveLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  
  // Wait for previous save to complete (if any)
  if (previousLock) {
    await previousLock;
  }
  
  try {
    // CRITICAL: Re-read from AsyncStorage after awaiting lock to ensure fresh data
    // Previous save may have modified cache, so we must read fresh
    const existingData = await getCachedData();
    
    const now = Date.now();
    const conversationTimestamps: Record<string, number> = {};
    const unreadCounts: Record<string, number> = {};
    
    // Process conversations in new list
    conversations.forEach(conv => {
      // Simplified timestamp comparison: compare conversation's updated_at directly
      // CRITICAL: Handle missing updated_at gracefully
      if (!conv.updated_at) {
        // Missing updated_at - treat as changed, update timestamp
        conversationTimestamps[conv.id] = now;
      } else {
        // Convert to numeric timestamp for comparison
        const convUpdatedAt = new Date(conv.updated_at).getTime();
        
        // Validate timestamp is valid (not NaN)
        if (isNaN(convUpdatedAt)) {
          conversationTimestamps[conv.id] = now;
        } else {
          const existingConv = existingData?.conversations?.find(c => c.id === conv.id);
          const existingConvUpdatedAt = existingConv?.updated_at 
            ? new Date(existingConv.updated_at).getTime() 
            : null;
          
          // Update timestamp if conversation updated_at changed (allowing 1s tolerance for clock skew)
          if (existingConvUpdatedAt && !isNaN(existingConvUpdatedAt) && Math.abs(existingConvUpdatedAt - convUpdatedAt) < 1000) {
            // Conversation hasn't changed (within 1s tolerance) - keep existing cache timestamp
            const existingTimestamp = existingData?.conversationTimestamps?.[conv.id];
            conversationTimestamps[conv.id] = existingTimestamp || now;
          } else {
            // Conversation changed - update timestamp to now
            conversationTimestamps[conv.id] = now;
          }
        }
      }
      
      // CRITICAL: Server-provided unread_count always overrides cached one
      // If conversation object has unread_count, use it (server is authoritative)
      if (conv.unread_count !== undefined && conv.unread_count !== null) {
        unreadCounts[conv.id] = conv.unread_count;
      }
    });
    
    // Preserve timestamps and unread counts for conversations not in new list (they might be on next page)
    // CRITICAL: Only preserve if not overridden by server data above
    if (existingData) {
      // Preserve timestamps for conversations not in new list
      if (existingData.conversationTimestamps) {
        Object.entries(existingData.conversationTimestamps).forEach(([id, timestamp]) => {
          if (!conversationTimestamps[id]) {
            conversationTimestamps[id] = timestamp;
          }
        });
      }
      
      // Preserve unread counts ONLY for conversations not in new list
      // Conversations in new list already have their unread counts set above (server is authoritative)
      if (existingData.unreadCounts) {
        Object.entries(existingData.unreadCounts).forEach(([id, count]) => {
          // Only preserve if conversation not in new list (server didn't provide updated count)
          if (!unreadCounts[id] && !conversations.some(c => c.id === id)) {
            unreadCounts[id] = count;
          }
        });
      }
    }
    
    const data: CachedConversationList = {
      conversations,
      lastSync: Date.now(),
      version: CACHE_VERSION,
      conversationTimestamps: conversationTimestamps as any, // Store as object for JSON
      unreadCounts: unreadCounts as any, // Store as object for JSON
    };

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving conversation list to cache:', error);
  } finally {
    // Release lock atomically
    release();
    saveLock = null;
  }
}

/**
 * Get cached data (internal helper)
 */
async function getCachedData(): Promise<CachedConversationList | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch (error) {
    return null;
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


