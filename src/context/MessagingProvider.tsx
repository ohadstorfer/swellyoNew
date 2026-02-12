/**
 * MessagingProvider
 * Global state management for conversations list
 * Handles real-time updates, caching, and unread counts
 */

import React, { createContext, useContext, useReducer, useRef, useEffect, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
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

  // Load conversations from cache first, then from server
  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      
      // Load from cache first (instant)
      const cached = await loadCachedConversationList();
      if (cached && cached.length > 0) {
        dispatch({ type: 'REPLACE_ALL', payload: cached });
      }

      // Then fetch from server
      const conversations = await messagingService.getConversations();
      dispatch({ type: 'REPLACE_ALL', payload: conversations });
      
      // Update cache
      await saveCachedConversationList(conversations);
      await updateLastSyncTimestamp();
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

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

