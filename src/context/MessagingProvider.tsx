/**
 * MessagingProvider
 * Global state management for conversations list
 * Handles real-time updates, caching, and unread counts
 */

import React, { createContext, useContext, useReducer, useRef, useEffect, useCallback } from 'react';
import { AppState, AppStateStatus, InteractionManager } from 'react-native';
import { 
  messagingService, 
  Conversation, 
  Message,
  ConversationSubscriptionCallbacks 
} from '../services/messaging/messagingService';
import {
  loadCachedConversationList,
  saveCachedConversationList,
  getLastSyncTimestamp,
  updateLastSyncTimestamp,
} from '../services/messaging/conversationListCache';
import { chatHistoryCache } from '../services/messaging/chatHistoryCache';
import { supabase } from '../config/supabase';

// Conversation action types
type ConversationAction =
  | { type: 'NEW_MESSAGE'; payload: { conversationId: string; message: Message } }
  | { type: 'MESSAGE_UPDATED'; payload: { conversationId: string; message: Message } }
  | { type: 'MESSAGE_DELETED'; payload: { conversationId: string; messageId: string } }
  | { type: 'CONVERSATION_UPDATED'; payload: { conversationId: string; updatedAt: string } }
  | { type: 'MARK_AS_READ'; payload: { conversationId: string } }
  | { type: 'INCREMENT_UNREAD'; payload: { conversationId: string } }
  | { type: 'SET_UNREAD_COUNT'; payload: { conversationId: string; count: number } }
  | { type: 'REPLACE_ALL'; payload: { conversations: Conversation[] } }
  | { type: 'SYNC_FROM_SERVER'; payload: { conversations: Conversation[] } };

// Conversation reducer with O(n) reordering
const conversationReducer = (state: Conversation[], action: ConversationAction): Conversation[] => {
  switch (action.type) {
    case 'NEW_MESSAGE': {
      const { conversationId, message } = action.payload;
      
      // DEDUPLICATION: Ignore if we've already processed this message
      const existingConv = state.find(c => c.id === conversationId);
      if (existingConv?.last_message?.id === message.id) {
        // Already processed - ignore (idempotent)
        return state;
      }
      
      const index = state.findIndex(c => c.id === conversationId);
      
      if (index === -1) {
        // New conversation - would need to create from message
        // For now, just return state (will be added on next full load)
        return state;
      }
      
      // Update existing conversation
      const updatedConversation = {
        ...state[index],
        last_message: message,
        updated_at: message.created_at,
      };
      
      // O(n) move to top (not O(n log n) sort)
      const newList = [...state];
      newList.splice(index, 1);      // Remove from current position
      newList.unshift(updatedConversation); // Add to top
      
      return newList;
    }
    
    case 'MESSAGE_UPDATED': {
      const { conversationId, message } = action.payload;
      const index = state.findIndex(c => c.id === conversationId);
      
      if (index === -1) return state;
      
      const conv = state[index];
      
      // DEDUPLICATION: Only update if this is the last message AND it's actually different
      if (conv.last_message?.id === message.id) {
        // Check if message actually changed (prevent unnecessary updates)
        if (conv.last_message.body === message.body && 
            conv.last_message.edited === message.edited) {
          return state; // No change - ignore
        }
        
        const updated = [...state];
        updated[index] = {
          ...conv,
          last_message: message,
        };
        return updated;
      }
      
      return state;
    }
    
    case 'MESSAGE_DELETED': {
      const { conversationId, messageId } = action.payload;
      const index = state.findIndex(c => c.id === conversationId);
      
      if (index === -1) return state;
      
      const conv = state[index];
      // If deleted message was the last one, need to fetch previous
      if (conv.last_message?.id === messageId) {
        // Trigger fetch of previous message (async, optimistic update)
        const updated = [...state];
        updated[index] = {
          ...conv,
          last_message: undefined, // Will be updated when previous message is fetched
        };
        return updated;
      }
      
      return state;
    }
    
    case 'CONVERSATION_UPDATED': {
      const { conversationId, updatedAt } = action.payload;
      const index = state.findIndex(c => c.id === conversationId);
      
      if (index === -1) return state;
      
      // Move to top if updated_at changed significantly
      const conv = state[index];
      const newList = [...state];
      
      if (index > 0 && new Date(updatedAt) > new Date(conv.updated_at)) {
        newList.splice(index, 1);
        newList.unshift({ ...conv, updated_at: updatedAt });
      } else {
        newList[index] = { ...conv, updated_at: updatedAt };
      }
      
      return newList;
    }
    
    case 'INCREMENT_UNREAD': {
      const { conversationId } = action.payload;
      const index = state.findIndex(c => c.id === conversationId);
      if (index === -1) return state;
      
      const updated = [...state];
      updated[index] = {
        ...updated[index],
        unread_count: (updated[index].unread_count || 0) + 1,
      };
      return updated;
    }
    
    case 'SET_UNREAD_COUNT': {
      const { conversationId, count } = action.payload;
      const index = state.findIndex(c => c.id === conversationId);
      if (index === -1) return state;
      
      const updated = [...state];
      updated[index] = {
        ...updated[index],
        unread_count: count,
      };
      return updated;
    }
    
    case 'REPLACE_ALL':
      return action.payload;
      
    case 'SYNC_FROM_SERVER':
      // Merge server data with local state (server wins on conflicts)
      // NOTE: Sorting is ONLY allowed here because:
      // 1. This is infrequent (only on reconnect/restart)
      // 2. This is a full re-sync, not incremental update
      // 3. DO NOT copy this pattern elsewhere - use O(n) move-to-top for real-time updates
      const serverMap = new Map(action.payload.map(c => [c.id, c]));
      return state.map(local => {
        const server = serverMap.get(local.id);
        return server || local;
      }).concat(
        action.payload.filter(s => !state.some(l => l.id === s.id))
      ).sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      
    default:
      return state;
  }
};

interface MessagingContextType {
  conversations: Conversation[];
  unreadTotal: number;
  dispatch: React.Dispatch<ConversationAction>;
  markAsRead: (conversationId: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
  loading: boolean;
  setCurrentConversationId: (conversationId: string | null) => void;
}

const MessagingContext = createContext<MessagingContextType | undefined>(undefined);

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const [conversations, dispatch] = useReducer(conversationReducer, []);
  const [loading, setLoading] = React.useState(true);
  const currentUserIdRef = useRef<string | null>(null);
  const currentConversationIdRef = useRef<string | null>(null);
  const lastProcessedMessageIds = useRef<Set<string>>(new Set());
  const subscriptionCleanupRef = useRef<(() => void) | null>(null);

  // Calculate unread total
  const unreadTotal = conversations.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);

  // Track processed message IDs for deduplication
  const isMessageProcessed = useCallback((messageId: string): boolean => {
    return lastProcessedMessageIds.current.has(messageId);
  }, []);

  const markMessageProcessed = useCallback((messageId: string) => {
    lastProcessedMessageIds.current.add(messageId);
    // Limit set size to prevent memory leak (keep last 1000)
    if (lastProcessedMessageIds.current.size > 1000) {
      const first = lastProcessedMessageIds.current.values().next().value;
      lastProcessedMessageIds.current.delete(first);
    }
  }, []);

  // Preload message histories from SERVER (not just disk)
  // This ensures instant experience even on fresh install
  const preloadMessageHistoriesFromServer = useCallback(async (conversations: Conversation[]) => {
    console.log('[MessagingProvider] 🚀 PRELOAD START - conversations count:', conversations.length);
    
    const topConversations = conversations.slice(0, 10);
    console.log('[MessagingProvider] 📋 Preloading top 10 conversations:', topConversations.map(c => c.id));
    
    const preloadStartTime = Date.now();
    
    InteractionManager.runAfterInteractions(() => {
      console.log('[MessagingProvider] ⏱️ InteractionManager callback executed, starting parallel fetches');
      
      const preloadPromises = topConversations.map(async (conv) => {
        const convStartTime = Date.now();
        console.log(`[MessagingProvider] 📥 Starting fetch for conversation ${conv.id}`);
        
        try {
          const messages = await messagingService.getMessages(conv.id, 20);
          const fetchTime = Date.now() - convStartTime;
          console.log(`[MessagingProvider] ✅ Fetched ${messages?.length || 0} messages for ${conv.id} in ${fetchTime}ms`);
          
          if (messages && messages.length > 0) {
            const saveStartTime = Date.now();
            await chatHistoryCache.saveMessages(conv.id, messages);
            const saveTime = Date.now() - saveStartTime;
            console.log(`[MessagingProvider] 💾 Saved ${messages.length} messages to cache for ${conv.id} in ${saveTime}ms`);
            
            // Verify memory cache
            const memoryCached = chatHistoryCache.loadCachedMessages(conv.id);
            console.log(`[MessagingProvider] 🔍 Memory cache check after save for ${conv.id}:`, {
              inMemory: !!memoryCached,
              messageCount: memoryCached?.length || 0
            });
            
            if (!memoryCached) {
              console.warn(`[MessagingProvider] ⚠️ Memory cache MISS after save for ${conv.id} - warming explicitly`);
              chatHistoryCache.warmMemoryCache(conv.id, messages, Date.now());
              
              // Verify again
              const afterWarm = chatHistoryCache.loadCachedMessages(conv.id);
              console.log(`[MessagingProvider] 🔍 Memory cache check after warm for ${conv.id}:`, {
                inMemory: !!afterWarm,
                messageCount: afterWarm?.length || 0
              });
            }
          } else {
            console.log(`[MessagingProvider] ⚠️ No messages returned for conversation ${conv.id}`);
          }
        } catch (error) {
          console.error(`[MessagingProvider] ❌ Error preloading messages from server for ${conv.id}:`, error);
        }
      });
      
      Promise.all(preloadPromises).then(() => {
        const totalTime = Date.now() - preloadStartTime;
        console.log(`[MessagingProvider] 🎉 PRELOAD COMPLETE - Total time: ${totalTime}ms`);
      }).catch(err => {
        console.error('[MessagingProvider] ❌ Error in parallel message preload:', err);
      });
    });
  }, []);

  // Load conversations from cache first, then from server
  const loadConversations = useCallback(async () => {
    console.log('[MessagingProvider] 🔄 loadConversations called');
    const loadStartTime = Date.now();
    
    try {
      setLoading(true);
      
      // Load from cache first (instant)
      const cached = await loadCachedConversationList();
      if (cached && cached.length > 0) {
        console.log(`[MessagingProvider] 📦 Loaded ${cached.length} conversations from cache`);
        dispatch({ type: 'REPLACE_ALL', payload: cached });
        
        // CRITICAL: Set loading to false IMMEDIATELY after showing cached data
        // This allows UI to render instantly, while server fetch happens in background
        setLoading(false);
        
        // CRITICAL: Start preload IMMEDIATELY with cached data (don't wait for server)
        // This ensures messages are preloaded even if server fetch is slow
        console.log(`[MessagingProvider] 🚀 Triggering preload IMMEDIATELY with ${cached.length} cached conversations`);
        preloadMessageHistoriesFromServer(cached);
      } else {
        console.log('[MessagingProvider] 📦 No cached conversations found');
        // Keep loading true if no cache (will show skeletons)
      }

      // Then fetch from server (non-blocking for UI - loading already false if cache exists)
      const serverStartTime = Date.now();
      const result = await messagingService.getConversations(50, 0); // Fetch first page (50 conversations)
      const serverTime = Date.now() - serverStartTime;
      console.log(`[MessagingProvider] 📥 Fetched ${result.conversations.length} conversations from server in ${serverTime}ms (hasMore: ${result.hasMore})`);
      
      dispatch({ type: 'REPLACE_ALL', payload: result.conversations });
      
      // Update cache
      await saveCachedConversationList(result.conversations);
      await updateLastSyncTimestamp();
      
      // If preload wasn't triggered earlier (no cache), trigger it now
      if (!cached || cached.length === 0) {
        if (result.conversations.length > 0) {
          console.log(`[MessagingProvider] 🚀 Triggering preload for ${result.conversations.length} conversations (no cache)`);
          preloadMessageHistoriesFromServer(result.conversations);
        } else {
          console.log('[MessagingProvider] ⚠️ No conversations to preload');
        }
        // Set loading to false after server fetch completes (no cache case)
        setLoading(false);
      }
      
      const totalTime = Date.now() - loadStartTime;
      console.log(`[MessagingProvider] ✅ loadConversations complete in ${totalTime}ms`);
    } catch (error) {
      console.error('[MessagingProvider] ❌ Error loading conversations:', error);
      // Set loading to false on error so UI doesn't stay in loading state
      setLoading(false);
    }
    // Removed finally block - loading is now set to false in appropriate places above
  }, [preloadMessageHistoriesFromServer]);

  // Mark conversation as read
  const markAsRead = useCallback(async (conversationId: string) => {
    try {
      await messagingService.markAsRead(conversationId);
      
      // Recalculate unread count authoritatively
      const unreadCount = await messagingService.getUnreadCount(conversationId);
      dispatch({ 
        type: 'SET_UNREAD_COUNT', 
        payload: { conversationId, count: unreadCount } 
      });
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  }, []);

  // Refresh conversations
  const refreshConversations = useCallback(async () => {
    await loadConversations();
  }, [loadConversations]);

  // Handle reconnect sync
  const handleReconnect = useCallback(async () => {
    try {
      const lastSync = await getLastSyncTimestamp();
      const updated = await messagingService.getConversationsUpdatedSince(lastSync);
      
      if (updated.length > 0) {
        dispatch({ type: 'SYNC_FROM_SERVER', payload: updated });
        
        // AUTHORITATIVE: Recalculate all unread counts after reconnect
        for (const conv of updated) {
          const unreadCount = await messagingService.getUnreadCount(conv.id);
          dispatch({ 
            type: 'SET_UNREAD_COUNT', 
            payload: { conversationId: conv.id, count: unreadCount } 
          });
        }
      }
      
      await updateLastSyncTimestamp();
    } catch (error) {
      console.error('Error syncing on reconnect:', error);
    }
  }, []);

  // Update cache when conversations change
  useEffect(() => {
    if (conversations.length > 0) {
      saveCachedConversationList(conversations).catch(err => 
        console.error('Error updating cache:', err)
      );
    }
  }, [conversations]);

  // Predictive preloading - warm memory cache for top conversations
  // CRITICAL: Only warms memory cache, does NOT trigger disk reads
  const preloadedConversationsRef = useRef<Set<string>>(new Set());
  const debouncedPreloadRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any pending preload
    if (debouncedPreloadRef.current) {
      clearTimeout(debouncedPreloadRef.current);
    }
    
    // Debounce preloading (wait 500ms after conversations change)
    debouncedPreloadRef.current = setTimeout(() => {
      if (conversations.length > 0) {
        // Only preload top 3 (not 5) to avoid performance issues
        const topConversations = conversations.slice(0, 3);
        
        // Use InteractionManager to avoid blocking UI
        InteractionManager.runAfterInteractions(() => {
          topConversations.forEach(conv => {
            // Skip if already preloaded this session
            if (preloadedConversationsRef.current.has(conv.id)) {
              return;
            }
            
            // CRITICAL: Check memory cache first (synchronous, no disk read)
            const memoryCached = chatHistoryCache.loadCachedMessages(conv.id);
            if (memoryCached) {
              // Already in memory - no need to preload
              preloadedConversationsRef.current.add(conv.id);
              return;
            }
            
            // Memory cache miss - but DON'T trigger AsyncStorage read here
            // Preloading will happen naturally when user opens conversation
            preloadedConversationsRef.current.add(conv.id);
          });
        });
      }
    }, 500);
    
    return () => {
      if (debouncedPreloadRef.current) {
        clearTimeout(debouncedPreloadRef.current);
      }
    };
  }, [conversations]);

  // Set up subscription
  useEffect(() => {
    // Get current user ID
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        currentUserIdRef.current = user.id;
      }
    });

    // Load conversations
    loadConversations();

    // Set up subscription with granular callbacks
    const callbacks: ConversationSubscriptionCallbacks = {
      onNewMessage: (conversationId, message) => {
        // DEDUPLICATION: Check if already processed
        if (isMessageProcessed(message.id)) {
          return; // Ignore duplicate
        }
        markMessageProcessed(message.id);
        
        // Optimistic unread increment (if from other user and conversation not open)
        const isFromOtherUser = message.sender_id !== currentUserIdRef.current;
        const isConversationOpen = currentConversationIdRef.current === conversationId;
        if (isFromOtherUser && !isConversationOpen) {
          dispatch({ type: 'INCREMENT_UNREAD', payload: { conversationId } });
        }
        
        // Update last message
        dispatch({ type: 'NEW_MESSAGE', payload: { conversationId, message } });
      },
      onMessageUpdated: (conversationId, message) => {
        dispatch({ type: 'MESSAGE_UPDATED', payload: { conversationId, message } });
      },
      onMessageDeleted: (conversationId, messageId) => {
        dispatch({ type: 'MESSAGE_DELETED', payload: { conversationId, messageId } });
      },
      onConversationUpdated: (conversationId, updatedAt) => {
        dispatch({ type: 'CONVERSATION_UPDATED', payload: { conversationId, updatedAt } });
      },
      onReconnect: handleReconnect,
    };

    const cleanup = messagingService.subscribeToConversations(callbacks);
    subscriptionCleanupRef.current = cleanup;

    // Listen to app state changes (background → foreground)
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App came to foreground - revalidate
        handleReconnect();
      }
    });

    return () => {
      cleanup();
      subscription.remove();
    };
  }, [loadConversations, handleReconnect, isMessageProcessed, markMessageProcessed]);

  const setCurrentConversationId = useCallback((conversationId: string | null) => {
    currentConversationIdRef.current = conversationId;
  }, []);

  const value: MessagingContextType = {
    conversations,
    unreadTotal,
    dispatch,
    markAsRead,
    refreshConversations,
    loading,
    setCurrentConversationId,
  };

  return (
    <MessagingContext.Provider value={value}>
      {children}
    </MessagingContext.Provider>
  );
}

export function useMessaging() {
  const context = useContext(MessagingContext);
  if (context === undefined) {
    throw new Error('useMessaging must be used within a MessagingProvider');
  }
  return context;
}

// Context extension to track current conversation
interface MessagingContextTypeWithCurrent extends MessagingContextType {
  setCurrentConversationId: (conversationId: string | null) => void;
}

