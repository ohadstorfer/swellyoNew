import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Message } from './messagingService';

/**
 * Chat History Cache Service
 * Implements WhatsApp-style instant loading with incremental sync
 * Optimized for performance: stores only 30 messages, LRU eviction, incremental sync
 */

interface CachedConversation {
  messages: Message[];
  lastMessageId: string | null; // For incremental sync
  lastSync: number; // Timestamp
  version: number; // Schema version for cache invalidation
  conversationId: string;
}

const CACHE_KEY_PREFIX = '@swellyo_chat_history_';
const CACHE_VERSION = 1;
const MAX_CACHED_CONVERSATIONS = 10;
const MAX_MESSAGES_PER_CONVERSATION = 30;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_TOTAL_CACHE_SIZE_MB = 5;
const ESTIMATED_BYTES_PER_MESSAGE = 2000; // ~2KB per message

class ChatHistoryCache {
  private conversationAccessOrder: string[] = []; // For LRU tracking

  /**
   * Get cache key for a conversation
   */
  private getCacheKey(conversationId: string): string {
    return `${CACHE_KEY_PREFIX}${conversationId}`;
  }

  /**
   * Get all cache keys
   */
  private async getAllCacheKeys(): Promise<string[]> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      return allKeys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
    } catch (error) {
      console.error('[chatHistoryCache] Error getting cache keys:', error);
      return [];
    }
  }

  /**
   * Estimate cache size
   */
  private estimateCacheSize(messages: Message[]): number {
    return messages.length * ESTIMATED_BYTES_PER_MESSAGE;
  }

  /**
   * Evict oldest conversations if we exceed limits
   */
  private async evictOldConversations(): Promise<void> {
    try {
      const allKeys = await this.getAllCacheKeys();
      
      if (allKeys.length <= MAX_CACHED_CONVERSATIONS) {
        return; // Within limit
      }

      // Get access times for all conversations
      const accessTimes: Array<{ key: string; lastSync: number }> = [];
      for (const key of allKeys) {
        try {
          const cached = await AsyncStorage.getItem(key);
          if (cached) {
            const data: CachedConversation = JSON.parse(cached);
            accessTimes.push({ key, lastSync: data.lastSync });
          }
        } catch (error) {
          // Skip invalid entries
          continue;
        }
      }

      // Sort by lastSync (oldest first)
      accessTimes.sort((a, b) => a.lastSync - b.lastSync);

      // Remove oldest conversations until we're under limit
      const toRemove = accessTimes.slice(0, allKeys.length - MAX_CACHED_CONVERSATIONS);
      const keysToRemove = toRemove.map(item => item.key);
      
      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
        console.log(`[chatHistoryCache] Evicted ${keysToRemove.length} old conversations`);
      }
    } catch (error) {
      console.error('[chatHistoryCache] Error evicting old conversations:', error);
    }
  }

  /**
   * Check if cache is valid (not expired)
   */
  private isCacheValid(cached: CachedConversation): boolean {
    const age = Date.now() - cached.lastSync;
    return age < CACHE_TTL_MS && cached.version === CACHE_VERSION;
  }

  /**
   * Load cached messages for a conversation
   * Returns last 30 messages instantly (WhatsApp-style)
   */
  async loadCachedMessages(conversationId: string): Promise<Message[] | null> {
    try {
      const key = this.getCacheKey(conversationId);
      const cached = await AsyncStorage.getItem(key);
      
      if (!cached) {
        return null;
      }

      const data: CachedConversation = JSON.parse(cached);
      
      // Check if cache is valid
      if (!this.isCacheValid(data)) {
        // Cache expired or version mismatch, remove it
        await AsyncStorage.removeItem(key);
        return null;
      }

      // Update access order for LRU
      this.updateAccessOrder(conversationId);

      // Return last 30 messages (or all if less than 30)
      const messages = data.messages || [];
      return messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    } catch (error) {
      console.error('[chatHistoryCache] Error loading cached messages:', error);
      return null;
    }
  }

  /**
   * Save messages to cache
   * Only stores last 30 messages to keep cache lightweight
   */
  async saveMessages(conversationId: string, messages: Message[]): Promise<void> {
    try {
      // Only store last 30 messages
      const messagesToCache = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
      
      // Check total cache size
      const estimatedSize = this.estimateCacheSize(messagesToCache);
      if (estimatedSize > MAX_TOTAL_CACHE_SIZE_MB * 1024 * 1024) {
        console.warn('[chatHistoryCache] Cache size limit reached, evicting old conversations');
        await this.evictOldConversations();
      }

      const lastMessageId = messagesToCache.length > 0 
        ? messagesToCache[messagesToCache.length - 1].id 
        : null;

      const cached: CachedConversation = {
        messages: messagesToCache,
        lastMessageId,
        lastSync: Date.now(),
        version: CACHE_VERSION,
        conversationId,
      };

      const key = this.getCacheKey(conversationId);
      await AsyncStorage.setItem(key, JSON.stringify(cached));
      
      // Update access order
      this.updateAccessOrder(conversationId);
      
      // Evict old conversations if needed
      await this.evictOldConversations();
    } catch (error) {
      console.error('[chatHistoryCache] Error saving messages to cache:', error);
      // Don't throw - caching is optional
    }
  }

  /**
   * Merge new messages with cached messages
   * Handles conflicts by timestamp (server messages take precedence)
   */
  mergeMessages(cached: Message[], newMessages: Message[]): Message[] {
    // Create a map of cached messages by ID
    const messageMap = new Map<string, Message>();
    cached.forEach(msg => messageMap.set(msg.id, msg));

    // Update or add new messages
    newMessages.forEach(newMsg => {
      const existing = messageMap.get(newMsg.id);
      if (existing) {
        // Server message takes precedence (might be edited/deleted)
        messageMap.set(newMsg.id, newMsg);
      } else {
        // New message
        messageMap.set(newMsg.id, newMsg);
      }
    });

    // Convert back to array and sort by created_at
    const merged = Array.from(messageMap.values());
    merged.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Return last 30 messages
    return merged.slice(-MAX_MESSAGES_PER_CONVERSATION);
  }

  /**
   * Get last message ID for incremental sync
   */
  async getLastMessageId(conversationId: string): Promise<string | null> {
    try {
      const key = this.getCacheKey(conversationId);
      const cached = await AsyncStorage.getItem(key);
      
      if (!cached) {
        return null;
      }

      const data: CachedConversation = JSON.parse(cached);
      return data.lastMessageId;
    } catch (error) {
      console.error('[chatHistoryCache] Error getting last message ID:', error);
      return null;
    }
  }

  /**
   * Invalidate cache for a conversation (e.g., on edit/delete)
   */
  async invalidateConversation(conversationId: string): Promise<void> {
    try {
      const key = this.getCacheKey(conversationId);
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('[chatHistoryCache] Error invalidating cache:', error);
    }
  }

  /**
   * Partially update cache (update specific message on edit/delete)
   */
  async updateMessage(conversationId: string, messageId: string, updatedMessage: Message | null): Promise<void> {
    try {
      const key = this.getCacheKey(conversationId);
      const cached = await AsyncStorage.getItem(key);
      
      if (!cached) {
        return; // No cache to update
      }

      const data: CachedConversation = JSON.parse(cached);
      
      if (updatedMessage) {
        // Update existing message
        const index = data.messages.findIndex(msg => msg.id === messageId);
        if (index !== -1) {
          data.messages[index] = updatedMessage;
        }
      } else {
        // Remove deleted message
        data.messages = data.messages.filter(msg => msg.id !== messageId);
      }

      data.lastSync = Date.now();
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error('[chatHistoryCache] Error updating message in cache:', error);
    }
  }

  /**
   * Update access order for LRU eviction
   */
  private updateAccessOrder(conversationId: string): void {
    // Remove from array if exists
    this.conversationAccessOrder = this.conversationAccessOrder.filter(
      id => id !== conversationId
    );
    // Add to end (most recently used)
    this.conversationAccessOrder.push(conversationId);
  }

  /**
   * Clear all cached conversations
   */
  async clearAll(): Promise<void> {
    try {
      const keys = await this.getAllCacheKeys();
      await AsyncStorage.multiRemove(keys);
      this.conversationAccessOrder = [];
    } catch (error) {
      console.error('[chatHistoryCache] Error clearing all cache:', error);
    }
  }
}

export const chatHistoryCache = new ChatHistoryCache();

