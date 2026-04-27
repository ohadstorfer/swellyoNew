/**
 * MessagingProvider
 * Global state management for conversations list
 * Handles real-time updates, caching, and unread counts
 */

import React, { createContext, useContext, useReducer, useRef, useEffect, useCallback, useMemo } from 'react';
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
  clearConversationListCache,
} from '../services/messaging/conversationListCache';
import { chatHistoryCache } from '../services/messaging/chatHistoryCache';
import { messageOutbox } from '../services/messaging/messageOutbox';
import { supabase } from '../config/supabase';
import { avatarCacheService } from '../services/media/avatarCacheService';
import { userPresenceService } from '../services/presence/userPresenceService';
import { resetForLogout as imageUploadResetForLogout } from '../services/messaging/imageUploadService';
import { useOnboarding } from './OnboardingContext';

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
  | { type: 'APPEND_CONVERSATIONS'; payload: { conversations: Conversation[] } }
  | { type: 'SYNC_FROM_SERVER'; payload: { conversations: Conversation[] } }
  | { type: 'UPDATE_CONVERSATION'; payload: { conversation: Conversation } };

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
        // SACRED: Conversation not in state - create minimal conversation to preserve message
        // This should be rare (enrichment should have created it), but we must not drop the message
        console.warn('[MessagingProvider] ⚠️ NEW_MESSAGE for conversation not in state - creating minimal conversation to preserve message');
        
        // Try to get current user ID from context (best effort)
        // If we can't, use sender_id as fallback
        const fallbackUserId = message.sender_id;
        
        const minimal = createMinimalConversation(
          conversationId,
          message,
          fallbackUserId
        );
        
        // Add to top of list
        return [minimal, ...state];
      }
      
      // Update existing conversation
      // CRITICAL: Create new conversation object to ensure React detects change
      const updatedConversation = {
        ...state[index],
        last_message: message,
        updated_at: message.created_at,
      };
      
      // CRITICAL: Create new array without mutation to ensure React detects change
      // O(n) move to top (not O(n log n) sort)
      // Build new array: [updatedConversation, ...all others except the one at index]
      const newList = [
        updatedConversation,
        ...state.slice(0, index),
        ...state.slice(index + 1)
      ];
      
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
            conv.last_message.edited === message.edited &&
            conv.last_message.deleted === message.deleted) {
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

      // Update updated_at in place — do NOT reorder.
      // Reordering lives exclusively on NEW_MESSAGE so the list mirrors WhatsApp
      // behavior: a conversation only bubbles up when its last_message changes.
      // If conversations.updated_at is bumped server-side (e.g. sendMessage's
      // trailing conversations update) without a paired messages INSERT reaching
      // this client, we don't want to move the conv up with a stale preview.
      const conv = state[index];
      if (conv.updated_at === updatedAt) return state;
      const newList = [...state];
      newList[index] = { ...conv, updated_at: updatedAt };
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
    
    case 'UPDATE_CONVERSATION': {
      const { conversation } = action.payload;
      const index = state.findIndex(c => c.id === conversation.id);
      
      console.log('[MessagingProvider] 🔄 UPDATE_CONVERSATION reducer:', {
        conversationId: conversation.id,
        isNew: index === -1,
        hasOtherUser: !!conversation.other_user,
        otherUserName: conversation.other_user?.name,
      });
      
      if (index === -1) {
        // Conversation doesn't exist, add it to the top
        return [conversation, ...state];
      }
      
      // Merge enriched data with existing conversation to preserve latest message and other fields
      // CRITICAL: Don't replace - merge to avoid losing data from concurrent updates
      const existing = state[index];
      
      // CRITICAL: Preserve other_user from enriched conversation if it exists
      // If enriched conversation has other_user, use it (enrichment succeeded)
      // If enriched conversation doesn't have other_user but existing does, preserve existing
      // This ensures we don't lose other_user if enrichment partially fails
      const otherUser = conversation.other_user || existing.other_user;
      
      // Preserve latest message if existing has newer one
      const latestMessage = existing.last_message && conversation.last_message
        ? (new Date(existing.last_message.created_at) > new Date(conversation.last_message.created_at)
            ? existing.last_message
            : conversation.last_message)
        : (conversation.last_message || existing.last_message);
      
      // Preserve latest updated_at
      const latestUpdatedAt = existing.last_message && conversation.last_message
        ? (new Date(existing.last_message.created_at) > new Date(conversation.last_message.created_at)
            ? existing.updated_at
            : conversation.updated_at)
        : (conversation.updated_at || existing.updated_at);
      
      const merged = {
        ...existing,  // Preserve existing data first
        ...conversation,  // Apply enriched data (members, etc.)
        // CRITICAL: Explicitly set other_user to ensure it's preserved
        other_user: otherUser,
        // CRITICAL: Explicitly set latest message and updated_at
        last_message: latestMessage,
        updated_at: latestUpdatedAt,
      };
      
      console.log('[MessagingProvider] 🔄 UPDATE_CONVERSATION merge result:', {
        conversationId: conversation.id,
        hasOtherUser: !!merged.other_user,
        otherUserName: merged.other_user?.name,
        hasLatestMessage: !!merged.last_message,
        latestMessageId: merged.last_message?.id,
        mergedFromEnriched: !!conversation.other_user,
        preservedFromExisting: !!existing.other_user && !conversation.other_user,
      });
      
      // Move to top (O(n) operation)
      const updated = [...state];
      updated.splice(index, 1);      // Remove from current position
      updated.unshift(merged);       // Add merged conversation to top
      return updated;
    }
    
    case 'REPLACE_ALL': {
      const { conversations: newConversations } = action.payload;
      
      // Safety check: ensure newConversations is an array
      if (!Array.isArray(newConversations)) {
        console.warn('[MessagingProvider] REPLACE_ALL received invalid payload, returning current state');
        return state;
      }
      
      // If state is empty, just return new conversations (initial load)
      if (state.length === 0) {
        return newConversations;
      }
      
      // Smart merge: preserve conversations not in new fetch (they might be on next page)
      // Only update conversations that exist in new fetch, keep others
      const newConversationsMap = new Map(newConversations.map(c => [c.id, c]));
      const existingIds = new Set(state.map(c => c.id));
      
      // Update existing conversations, keep ones not in new fetch
      const updated = state.map(existing => {
        const updatedConv = newConversationsMap.get(existing.id);
        return updatedConv || existing; // Use updated version if available, otherwise keep existing
      });
      
      // Add new conversations that don't exist in state
      const newOnes = newConversations.filter(c => !existingIds.has(c.id));
      
      // Always sort by updated_at to ensure correct order after cache → server refresh
      const merged = [...updated, ...newOnes];
      return merged.sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    }
      
    case 'APPEND_CONVERSATIONS': {
      const { conversations: newConversations } = action.payload;
      
      // Safety check: ensure newConversations is an array
      if (!Array.isArray(newConversations)) {
        console.warn('[MessagingProvider] APPEND_CONVERSATIONS received invalid payload, returning current state');
        return state;
      }
      
      // Avoid duplicates by checking IDs
      const existingIds = new Set(state.map(c => c.id));
      const uniqueNew = newConversations.filter(c => !existingIds.has(c.id));
      return [...state, ...uniqueNew];
    }
      
    case 'SYNC_FROM_SERVER': {
      const { conversations: serverConversations } = action.payload;
      
      // Safety check: ensure serverConversations is an array
      if (!Array.isArray(serverConversations)) {
        console.warn('[MessagingProvider] SYNC_FROM_SERVER received invalid payload, returning current state');
        return state;
      }
      
      // Merge server data with local state (server wins on conflicts)
      // NOTE: Sorting is ONLY allowed here because:
      // 1. This is infrequent (only on reconnect/restart)
      // 2. This is a full re-sync, not incremental update
      // 3. DO NOT copy this pattern elsewhere - use O(n) move-to-top for real-time updates
      const serverMap = new Map(serverConversations.map(c => [c.id, c]));
      return state.map(local => {
        const server = serverMap.get(local.id);
        if (!server) return local;
        return {
          ...server,
          other_user: server.other_user ?? local.other_user,
          members: server.members ?? local.members,
        };
      }).concat(
        serverConversations.filter(s => !state.some(l => l.id === s.id))
      ).sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    }
      
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
  getCurrentConversationId: () => string | null;
  hasMoreConversations: boolean;
  isLoadingMoreConversations: boolean;
  loadMoreConversations: () => Promise<void>;
}

const MessagingContext = createContext<MessagingContextType | undefined>(undefined);

/**
 * Fetches a conversation from the database and enriches it with user data
 * Used when a new message arrives for a conversation not in state
 * Includes retry logic (3 attempts) with detailed error logging
 */
const fetchAndEnrichConversation = async (
  conversationId: string,
  currentUserId: string,
  message: Message,
  retryCount: number = 0
): Promise<Conversation | null> => {
  const MAX_RETRIES = 3;
  console.log('[MessagingProvider] 🔍 fetchAndEnrichConversation called:', { conversationId, currentUserId, retryCount });
  if (!currentUserId) {
    return null;
  }

  try {
    const { supabase } = await import('../config/supabase');
    
    // Fetch conversation details
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, title, is_direct, metadata, created_by, created_at, updated_at')
      .eq('id', conversationId)
      .maybeSingle();

    console.log('[MessagingProvider] 📥 Fetched conversation:', {
      found: !!conversation,
      isDirect: conversation?.is_direct,
      error: convError?.message,
      retryCount,
    });

    if (convError || !conversation) {
      console.error('[MessagingProvider] Error fetching conversation:', {
        error: convError,
        conversationId,
        retryCount,
        willRetry: retryCount < MAX_RETRIES,
      });
      
      // Retry if we haven't exceeded max retries
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
        return fetchAndEnrichConversation(conversationId, currentUserId, message, retryCount + 1);
      }
      return null;
    }

    // Fetch conversation members
    const { data: members, error: membersError } = await supabase
      .from('conversation_members')
      .select('user_id, role, adv_role, joined_at, last_read_at, preferences')
      .eq('conversation_id', conversationId);

    if (membersError || !members || members.length === 0) {
      console.error('[MessagingProvider] Error fetching members:', {
        error: membersError,
        conversationId,
        retryCount,
        willRetry: retryCount < MAX_RETRIES,
      });
      
      // Retry if we haven't exceeded max retries
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
        return fetchAndEnrichConversation(conversationId, currentUserId, message, retryCount + 1);
      }
      return null;
    }

    console.log('[MessagingProvider] 👥 Fetched members:', {
      count: members?.length || 0,
    });

    // For direct conversations, find and enrich the other user
    let otherUser: ConversationMember | undefined;
    if (conversation.is_direct) {
      const otherMember = members.find(m => m.user_id !== currentUserId);
      console.log('[MessagingProvider] 👤 Other member check:', {
        otherMemberFound: !!otherMember,
        otherMemberId: otherMember?.user_id,
      });
      if (otherMember) {
        // Fetch user and surfer data in parallel
        const [userResult, surferResult] = await Promise.all([
          supabase
            .from('users')
            .select('email')
            .eq('id', otherMember.user_id)
            .maybeSingle(),
          supabase
            .from('surfers')
            .select('name, profile_image_url')
            .eq('user_id', otherMember.user_id)
            .maybeSingle(),
        ]);

        const userData = userResult.data;
        const surferData = surferResult.data;

        // Build name (same logic as getConversations)
        let name = 'Unknown';
        if (surferData?.name && surferData.name.trim() !== '') {
          name = surferData.name;
        } else if (userData?.email) {
          name = userData.email.split('@')[0];
        }

        otherUser = {
          ...otherMember,
          conversation_id: conversationId,
          name,
          profile_image_url: surferData?.profile_image_url,
          email: userData?.email,
        };
      }
    }

    // Build enriched members array - enrich ALL members with user/surfer data
    const memberUserIds = members.map(m => m.user_id);
    const [allUsersResult, allSurfersResult] = await Promise.all([
      supabase
        .from('users')
        .select('id, email')
        .in('id', memberUserIds),
      supabase
        .from('surfers')
        .select('user_id, name, profile_image_url')
        .in('user_id', memberUserIds),
    ]);

    const usersMap = new Map((allUsersResult.data || []).map(u => [u.id, u]));
    const surfersMap = new Map((allSurfersResult.data || []).map(s => [s.user_id, s]));

    const enrichedMembers = members.map(member => {
      const userData = usersMap.get(member.user_id);
      const surferData = surfersMap.get(member.user_id);
      
      let name = 'Unknown';
      if (surferData?.name && surferData.name.trim() !== '') {
        name = surferData.name;
      } else if (userData?.email) {
        name = userData.email.split('@')[0];
      }

      return {
        ...member,
        conversation_id: conversationId,
        name,
        profile_image_url: surferData?.profile_image_url,
        email: userData?.email,
      };
    });

    // Return fully enriched conversation with the new message
    const enriched = {
      ...conversation,
      last_message: message,
      updated_at: message.created_at,
      other_user: otherUser,
      members: enrichedMembers,
      unread_count: message.sender_id !== currentUserId ? 1 : 0,
    };

    console.log('[MessagingProvider] ✅ Enriched conversation:', {
      hasOtherUser: !!otherUser,
      otherUserName: otherUser?.name,
      otherUserProfileImage: !!otherUser?.profile_image_url,
    });

    return enriched;
  } catch (error) {
    console.error('[MessagingProvider] Error fetching and enriching conversation:', {
      error,
      conversationId,
      retryCount,
      willRetry: retryCount < 3,
    });
    
    // Retry if we haven't exceeded max retries
    if (retryCount < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
      return fetchAndEnrichConversation(conversationId, currentUserId, message, retryCount + 1);
    }
    
    return null;
  }
};

/**
 * Creates a minimal conversation with fallback data when enrichment fails
 * SACRED: Ensures message is never dropped, even if enrichment fails
 */
const createMinimalConversation = (
  conversationId: string,
  message: Message,
  currentUserId: string
): Conversation => {
  return {
    id: conversationId,
    title: undefined,
    is_direct: true, // Assume direct if we don't know
    metadata: {},
    created_by: currentUserId,
    created_at: message.created_at,
    updated_at: message.created_at,
    last_message: message,
    unread_count: message.sender_id !== currentUserId ? 1 : 0,
    other_user: {
      conversation_id: conversationId,
      user_id: message.sender_id !== currentUserId ? message.sender_id : '', // Will be enriched later
      role: 'member',
      joined_at: message.created_at,
      preferences: {},
      name: 'Unknown User', // Fallback - will be enriched in background
    },
    members: [],
  };
};

/**
 * Enriches a conversation with other_user data if missing
 * Only for direct conversations that are missing other_user
 * Includes retry logic (3 attempts) and handles partial failures gracefully
 */
const enrichConversationWithUserData = async (
  conversation: Conversation,
  currentUserId: string,
  message?: Message, // Optional: new message to include
  retryCount: number = 0
): Promise<Conversation | null> => {
  const MAX_RETRIES = 3;
  
  // Only enrich direct conversations missing other_user
  if (!conversation.is_direct || conversation.other_user || !currentUserId) {
    // If message provided and conversation already has other_user, just update the message
    if (message && conversation.other_user) {
      return {
        ...conversation,
        last_message: message,
        updated_at: message.created_at,
      };
    }
    return null; // No enrichment needed
  }

  try {
    const { supabase } = await import('../config/supabase');
    
    // Fetch conversation members
    const { data: members, error: membersError } = await supabase
      .from('conversation_members')
      .select('user_id, role, adv_role, joined_at, last_read_at, preferences')
      .eq('conversation_id', conversation.id);

    if (membersError || !members || members.length === 0) {
      console.error('[MessagingProvider] Error fetching members in enrichConversationWithUserData:', {
        error: membersError,
        conversationId: conversation.id,
        retryCount,
        willRetry: retryCount < MAX_RETRIES,
      });
      
      // Retry if we haven't exceeded max retries
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
        return enrichConversationWithUserData(conversation, currentUserId, message, retryCount + 1);
      }
      
      // Return partial conversation if fetch fails (don't block UI)
      return message ? {
        ...conversation,
        last_message: message,
        updated_at: message.created_at,
      } : null;
    }

    // Find the other user (not the current user)
    const otherMember = members.find(m => m.user_id !== currentUserId);
    if (!otherMember) {
      console.warn('[MessagingProvider] ⚠️ enrichConversationWithUserData: Other member not found', {
        conversationId: conversation.id,
        currentUserId,
        membersCount: members.length,
        memberIds: members.map(m => m.user_id),
      });
      // Return partial conversation if other member not found
      return message ? {
        ...conversation,
        last_message: message,
        updated_at: message.created_at,
      } : null;
    }

    // Fetch user and surfer data in parallel
    const [userResult, surferResult] = await Promise.all([
      supabase
        .from('users')
        .select('email')
        .eq('id', otherMember.user_id)
        .maybeSingle(),
      supabase
        .from('surfers')
        .select('name, profile_image_url')
        .eq('user_id', otherMember.user_id)
        .maybeSingle(),
    ]);

    const userData = userResult.data;
    const surferData = surferResult.data;

    // Build name (same logic as getConversations)
    let name = 'Unknown';
    if (surferData?.name && surferData.name.trim() !== '') {
      name = surferData.name;
    } else if (userData?.email) {
      name = userData.email.split('@')[0];
    }

    // Return enriched conversation with optional message
    // Even if user/surfer fetch fails, return conversation with at least member data
    const enriched = {
      ...conversation,
      ...(message && {
        last_message: message,
        updated_at: message.created_at,
      }),
      other_user: {
        ...otherMember,
        conversation_id: conversation.id,
        name,
        profile_image_url: surferData?.profile_image_url,
        email: userData?.email,
      },
    };
    
    console.log('[MessagingProvider] ✅ enrichConversationWithUserData success:', {
      conversationId: conversation.id,
      hasOtherUser: !!enriched.other_user,
      otherUserName: enriched.other_user?.name,
      otherUserId: enriched.other_user?.user_id,
      hasProfileImage: !!enriched.other_user?.profile_image_url,
    });
    
    return enriched;
  } catch (error) {
    console.error('[MessagingProvider] Error enriching conversation:', {
      error,
      conversationId: conversation.id,
      retryCount,
      willRetry: retryCount < MAX_RETRIES,
    });
    
    // Retry if we haven't exceeded max retries
    if (retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
      return enrichConversationWithUserData(conversation, currentUserId, message, retryCount + 1);
    }
    
    // Return partial conversation on error (don't block UI)
    return message ? {
      ...conversation,
      last_message: message,
      updated_at: message.created_at,
    } : null;
  }
};

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useOnboarding();
  const [conversations, dispatch] = useReducer(conversationReducer, []);
  const [loading, setLoading] = React.useState(true);
  const [hasMoreConversations, setHasMoreConversations] = React.useState(false);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = React.useState(false);
  const conversationsOffsetRef = useRef<number>(0);
  const isLoadingMoreRef = useRef<boolean>(false); // Ref-based lock to prevent race conditions
  const currentUserIdRef = useRef<string | null>(null);
  const currentConversationIdRef = useRef<string | null>(null);
  const lastProcessedMessageIds = useRef<Set<string>>(new Set());
  const subscriptionCleanupRef = useRef<(() => void) | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);

  // Per-conversation list subscriptions (one filtered channel per conv in state).
  // Complements the unfiltered conversations_list channel by guaranteeing delivery
  // for peer actions on convs the user isn't actively viewing. Reconciled below
  // in a useEffect that adds/removes subscriptions as `conversations` changes.
  const listSubsRef = useRef<Map<string, () => void>>(new Map());

  // Track active enrichment operations per conversation to prevent race conditions
  const activeEnrichments = useRef<Map<string, Promise<Conversation | null>>>(new Map());

  // Auth-state-driven reset: when user becomes null (logout/session loss), unsubscribe and clear state (single authority)
  useEffect(() => {
    if (user) {
      currentUserIdRef.current = user.id;
      return;
    }
    currentUserIdRef.current = null;
    const cleanup = subscriptionCleanupRef.current;
    subscriptionCleanupRef.current = null;
    if (cleanup) {
      cleanup();
    }
    // Tear down every per-conv list subscription so the next user doesn't inherit them.
    listSubsRef.current.forEach((unsub) => {
      try { unsub(); } catch (e) { console.warn('[MessagingProvider] list unsub failed on logout:', e); }
    });
    listSubsRef.current.clear();
    dispatch({ type: 'REPLACE_ALL', payload: { conversations: [] } });
    // Clear persistent caches so next user doesn't see old user's data
    clearConversationListCache().catch((err) => console.error('[MessagingProvider] Error clearing conversation list cache on logout:', err));
    chatHistoryCache.clearAll().catch((err) => console.error('[MessagingProvider] Error clearing chat history cache on logout:', err));
    imageUploadResetForLogout().catch((err) => console.error('[MessagingProvider] Error resetting uploads on logout:', err));
    // Drop any pending outbox entries so the next signed-in user cannot
    // inadvertently resend them (sendMessage binds the sender to the current
    // session, not the entry's recorded senderId).
    messageOutbox.clear().catch((err) => console.error('[MessagingProvider] Error clearing outbox on logout:', err));
  }, [user]);

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
  const loadConversations = useCallback(async (offset: number = 0) => {
    console.log('[MessagingProvider] 🔄 loadConversations called', { offset });
    const loadStartTime = Date.now();
    
    let cached: Conversation[] | null = null;
    
    try {
      if (offset === 0) {
        setLoading(true);
        conversationsOffsetRef.current = 0;
        // Reset lock on initial load
        isLoadingMoreRef.current = false;
      }
      
      // Load from cache first (only on initial load)
      if (offset === 0) {
        cached = await loadCachedConversationList();
        if (cached && cached.length > 0) {
          console.log(`[MessagingProvider] 📦 Loaded ${cached.length} conversations from cache`);
          dispatch({ type: 'REPLACE_ALL', payload: { conversations: cached } });
          
          // CRITICAL: Set loading to false IMMEDIATELY after showing cached data
          // This allows UI to render instantly, while server fetch happens in background
          setLoading(false);
          
          // Prefetch avatars from cached conversations
          const cachedAvatarUrls = cached
            .map(conv => conv.other_user?.profile_image_url)
            .filter((url): url is string => !!url);
          if (cachedAvatarUrls.length > 0) {
            avatarCacheService.prefetchAvatars(cachedAvatarUrls).catch(err => {
              console.error('[MessagingProvider] Error prefetching avatars from cache:', err);
            });
          }
          
        } else {
          console.log('[MessagingProvider] 📦 No cached conversations found');
          // Keep loading true if no cache (will show skeletons)
        }
      }

      // Skip server fetch if cache is fresh (< 5 minutes old) — reduces egress
      const lastSync = await getLastSyncTimestamp();
      const cacheAge = lastSync ? Date.now() - lastSync : Infinity;
      const cacheFresh = cached && cached.length > 0 && cacheAge < 5 * 60 * 1000;

      if (offset === 0 && cacheFresh) {
        console.log(`[MessagingProvider] ⏭️ Cache is fresh (${Math.round(cacheAge / 1000)}s old) — skipping server fetch`);
        conversationsOffsetRef.current = cached!.length;
      } else {
        // Fetch from server (non-blocking for UI if cache exists)
        const serverStartTime = Date.now();
        const result = await messagingService.getConversations(50, offset);
        const serverTime = Date.now() - serverStartTime;
        console.log(`[MessagingProvider] 📥 Fetched ${result.conversations.length} conversations from server in ${serverTime}ms (hasMore: ${result.hasMore}, offset: ${offset})`);

        setHasMoreConversations(result.hasMore);

        if (offset === 0) {
          dispatch({ type: 'REPLACE_ALL', payload: { conversations: result.conversations } });
          conversationsOffsetRef.current = result.conversations.length;
          await saveCachedConversationList(result.conversations);
          await updateLastSyncTimestamp();
        } else {
          dispatch({ type: 'APPEND_CONVERSATIONS', payload: { conversations: result.conversations } });
          conversationsOffsetRef.current += result.conversations.length;

          const existingCached = await loadCachedConversationList();
          if (existingCached && existingCached.length > 0) {
            const existingIds = new Set(existingCached.map(c => c.id));
            const uniqueNew = result.conversations.filter(c => !existingIds.has(c.id));
            const merged = [...existingCached, ...uniqueNew];
            await saveCachedConversationList(merged);
          } else {
            await saveCachedConversationList(result.conversations);
          }
        }

        // Prefetch avatars from server conversations
        const serverAvatarUrls = result.conversations
          .map(conv => conv.other_user?.profile_image_url)
          .filter((url): url is string => !!url);
        if (serverAvatarUrls.length > 0) {
          avatarCacheService.prefetchAvatars(serverAvatarUrls).catch(err => {
            console.error('[MessagingProvider] Error prefetching avatars from server:', err);
          });
        }

        // No cache case — set loading false after server fetch
        if (offset === 0 && (!cached || cached.length === 0)) {
          setLoading(false);
        }
      }
      
      const totalTime = Date.now() - loadStartTime;
      console.log(`[MessagingProvider] ✅ loadConversations complete in ${totalTime}ms`);
    } catch (error) {
      console.error('[MessagingProvider] ❌ Error loading conversations:', error);
      // Set loading to false on error so UI doesn't stay in loading state
      if (offset === 0) {
        setLoading(false);
        // On initial load error, reset hasMore conservatively
        setHasMoreConversations(false);
      } else {
        // On pagination error, reset hasMore to prevent user from being stuck
        setHasMoreConversations(false);
      }
      // Release lock
      isLoadingMoreRef.current = false;
      setIsLoadingMoreConversations(false);
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
    await loadConversations(0);
  }, [loadConversations]);

  // Load more conversations (pagination)
  const loadMoreConversations = useCallback(async () => {
    // Ref-based lock to prevent race conditions (synchronous check)
    if (isLoadingMoreRef.current || isLoadingMoreConversations || !hasMoreConversations) {
      return;
    }
    
    // Set lock immediately (synchronous)
    isLoadingMoreRef.current = true;
    setIsLoadingMoreConversations(true);
    
    try {
      // Capture offset at call time to prevent stale values
      const offset = conversationsOffsetRef.current;
      console.log('[MessagingProvider] 🔄 loadMoreConversations called', { offset, hasMore: hasMoreConversations });
      
      await loadConversations(offset);
    } catch (error) {
      console.error('[MessagingProvider] ❌ Error loading more conversations:', error);
      // Reset hasMore on error to prevent user from being stuck
      setHasMoreConversations(false);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMoreConversations(false);
    }
  }, [loadConversations, isLoadingMoreConversations, hasMoreConversations]);

  // Track subscription health for reconnect sync optimization
  const subscriptionHealthyRef = useRef<boolean>(true);
  const lastSyncRef = useRef<number>(0);

  // Handle reconnect sync (subscription-aware)
  const handleReconnect = useCallback(async () => {
    try {
      const now = Date.now();
      const lastSync = await getLastSyncTimestamp();
      const syncAge = now - lastSync;
      lastSyncRef.current = lastSync;
      
      // Only sync if:
      // 1. Subscription is unhealthy, OR
      // 2. Last sync was >10 minutes ago (time-based fallback)
      // Note: Explicit reconnect events from subscription status callback always trigger sync
      if (subscriptionHealthyRef.current && syncAge < 10 * 60 * 1000) {
        // Skip - subscription is healthy and recent sync
        return;
      }
      
      const updated = await messagingService.getConversationsUpdatedSince(lastSync);
      
      if (updated.length > 0) {
        dispatch({ type: 'SYNC_FROM_SERVER', payload: { conversations: updated } });
        
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
      lastSyncRef.current = now;
    } catch (error) {
      console.error('Error syncing on reconnect:', error);
    }
  }, []);

  // Handle real-time new-conversation discovery.
  //
  // Fires when `conversation_members` has an INSERT for the current user —
  // i.e. someone just started a DM with us. Previously this was covered by
  // the unfiltered `messages` INSERT on `conversations_list`, but that
  // subscription destabilized the realtime socket by forcing RLS evaluation
  // on every message in the DB. The new path is a one-row-per-user filter,
  // so it's cheap and doesn't touch the `messages` table at all.
  const handleNewConversation = useCallback(async (conversationId: string) => {
    // Ignore if we already have it in state (e.g. we initiated the DM).
    if (conversationsRef.current.some((c) => c.id === conversationId)) return;

    try {
      const lastSync = await getLastSyncTimestamp();
      // Look back at least 5 minutes so a stale lastSync (or a fresh session
      // with lastSync === 0) still catches the brand-new conversation row.
      const syncFrom = Math.max(lastSync, Date.now() - 5 * 60 * 1000);
      const updated = await messagingService.getConversationsUpdatedSince(syncFrom);
      if (updated.length > 0) {
        dispatch({ type: 'SYNC_FROM_SERVER', payload: { conversations: updated } });
      }
      await updateLastSyncTimestamp();
    } catch (error) {
      console.error('[MessagingProvider] Error syncing on new conversation:', error);
    }
  }, []);

  // Keep conversationsRef in sync with conversations state
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Debounced cache writes - batch writes during rapid updates, flush on critical events
  const cacheWriteTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (conversations.length > 0) {
      // Clear existing timer
      if (cacheWriteTimerRef.current) {
        clearTimeout(cacheWriteTimerRef.current);
      }
      
      // Debounce write (2 seconds)
      cacheWriteTimerRef.current = setTimeout(() => {
        saveCachedConversationList(conversations).catch(err => 
          console.error('Error updating cache:', err)
        );
      }, 2000);
    }
    
    return () => {
      if (cacheWriteTimerRef.current) {
        clearTimeout(cacheWriteTimerRef.current);
      }
    };
  }, [conversations]);

  // Flush cache immediately on critical events (app background, logout)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // Flush cache immediately on background
        if (cacheWriteTimerRef.current) {
          clearTimeout(cacheWriteTimerRef.current);
          cacheWriteTimerRef.current = null;
        }
        if (conversations.length > 0) {
          saveCachedConversationList(conversations).catch(() => {});
        }
      }
    });
    
    return () => subscription.remove();
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
          // Only preload top 1 conversation (reduced from 3) to minimize resource usage
          const topConversations = conversations.slice(0, 1);
        
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

  // Prefetch avatars when conversations change (for real-time updates)
  useEffect(() => {
    const avatarUrls = conversations
      .map(conv => conv.other_user?.profile_image_url)
      .filter((url): url is string => !!url);

    if (avatarUrls.length > 0) {
      // Prefetch in background (non-blocking)
      avatarCacheService.prefetchAvatars(avatarUrls).catch(err => {
        console.error('[MessagingProvider] Error prefetching avatars on conversation update:', err);
      });
    }
  }, [conversations]);

  // Reconcile per-conversation list subscriptions with the current list state.
  // For every conv in state we run a filtered messages channel that dispatches
  // NEW_MESSAGE / MESSAGE_UPDATED / MESSAGE_DELETED to the reducer. Handlers are
  // intentionally thin — they don't retrigger enrichment (the conv is already
  // enriched by virtue of being in state) and rely on the reducer's existing
  // dedup via lastProcessedMessageIds + last_message.id comparison.
  useEffect(() => {
    if (!user) return;

    const convIdsInState = new Set(conversations.map((c) => c.id));

    // Drop subscriptions for conversations that left state (pagination eviction, logout, etc.).
    listSubsRef.current.forEach((unsub, convId) => {
      if (!convIdsInState.has(convId)) {
        try { unsub(); } catch (e) { console.warn('[MessagingProvider] list unsub failed:', e); }
        listSubsRef.current.delete(convId);
      }
    });

    // Subscribe to any conversation we don't already cover.
    convIdsInState.forEach((convId) => {
      if (listSubsRef.current.has(convId)) return;

      const unsub = messagingService.subscribeToConversationListUpdates(convId, {
        onNewMessage: (conversationId, message) => {
          const me = currentUserIdRef.current;
          if (!me) return;
          if (isMessageProcessed(message.id)) return;
          markMessageProcessed(message.id);

          // Unread increment only when someone else sent it AND we aren't looking at this conv.
          const isFromOtherUser = message.sender_id !== me;
          const isConvOpen = currentConversationIdRef.current === conversationId;
          if (isFromOtherUser && !isConvOpen) {
            dispatch({ type: 'INCREMENT_UNREAD', payload: { conversationId } });
          }

          dispatch({ type: 'NEW_MESSAGE', payload: { conversationId, message } });
        },
        onMessageUpdated: (conversationId, message) => {
          if (!currentUserIdRef.current) return;
          dispatch({ type: 'MESSAGE_UPDATED', payload: { conversationId, message } });
        },
        onMessageDeleted: (conversationId, messageId) => {
          if (!currentUserIdRef.current) return;
          dispatch({ type: 'MESSAGE_DELETED', payload: { conversationId, messageId } });
        },
      });

      listSubsRef.current.set(convId, unsub);
    });
  }, [conversations, user, isMessageProcessed, markMessageProcessed]);

  // Set up subscription
  useEffect(() => {
    // Get current user ID
    let newConvUnsub: (() => void) | null = null;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        currentUserIdRef.current = user.id;
        // Initialize presence tracking for current user
        userPresenceService.trackCurrentUser().catch(error => {
          console.error('[MessagingProvider] Error initializing presence tracking:', error);
        });

        // Subscribe to new-conversation discovery. Fires when another user
        // starts a DM with us (INSERT on conversation_members filtered by
        // our user id). Triggers a focused sync so the new conversation
        // lands in state; the per-conv reconciler then subscribes its
        // filtered list:messages channel for subsequent message events.
        newConvUnsub = messagingService.subscribeToNewConversations(
          user.id,
          handleNewConversation
        );
      }
    });

    // Load conversations
    loadConversations();

    // Set up subscription with granular callbacks
    console.log('[MessagingProvider] 🚀 Setting up subscription...');
    const callbacks: ConversationSubscriptionCallbacks = {
      onNewMessage: async (conversationId, message) => {
        const activeUserId = currentUserIdRef.current;
        if (!activeUserId) return;
        console.log('[MessagingProvider] 🔔 onNewMessage callback triggered:', {
          conversationId,
          messageId: message.id,
          senderId: message.sender_id,
          hasBody: !!message.body,
          timestamp: new Date().toISOString(),
        });
        // Mark subscription as healthy when receiving messages
        subscriptionHealthyRef.current = true;
        
        // Validate message completeness
        if (!message || !message.id || !message.conversation_id || !message.created_at) {
          console.warn('[MessagingProvider] ⚠️ Invalid message received:', message);
          return;
        }
        
        console.log('[MessagingProvider] 🔔 onNewMessage called:', {
          conversationId,
          messageId: message.id,
          senderId: message.sender_id,
          currentUserId: currentUserIdRef.current,
          conversationsInState: conversationsRef.current.length,
          hasBody: !!message.body,
          hasCreatedAt: !!message.created_at,
        });

        // DEDUPLICATION: Check if already processed
        if (isMessageProcessed(message.id)) {
          console.log('[MessagingProvider] ⚠️ Message already processed, ignoring');
          return; // Ignore duplicate
        }
        markMessageProcessed(message.id);
        
        // Defensive check: ensure conversationsRef is populated (should be rare)
        if (conversationsRef.current.length === 0 && conversations.length > 0) {
          console.warn('[MessagingProvider] ⚠️ conversationsRef out of sync, syncing now');
          conversationsRef.current = conversations;
        }
        
        // Use ref to access latest conversations without causing re-renders
        const existingConv = conversationsRef.current.find(c => c.id === conversationId);
        console.log('[MessagingProvider] 🔍 Existing conversation check:', {
          found: !!existingConv,
          isDirect: existingConv?.is_direct,
          hasOtherUser: !!existingConv?.other_user,
          otherUserName: existingConv?.other_user?.name,
        });
        
        // Optimistic unread increment (if from other user and conversation not open)
        const isFromOtherUser = message.sender_id !== currentUserIdRef.current;
        const isConversationOpen = currentConversationIdRef.current === conversationId;
        if (isFromOtherUser && !isConversationOpen) {
          dispatch({ type: 'INCREMENT_UNREAD', payload: { conversationId } });
        }
        
        if (!existingConv) {
          console.log('[MessagingProvider] 🆕 NEW CONVERSATION - fetching and enriching');
          
          // SACRED: Always add conversation with message, even if enrichment fails
          // Check if enrichment already in progress for this conversation
          const existingEnrichment = activeEnrichments.current.get(conversationId);
          
          if (existingEnrichment) {
            // Enrichment already in progress - wait for it and use result
            console.log('[MessagingProvider] ⏳ Enrichment already in progress, waiting...');
            const enriched = await existingEnrichment;
            if (enriched) {
              dispatch({ type: 'UPDATE_CONVERSATION', payload: { conversation: enriched } });
              return;
            }
            // If enrichment failed, fall through to create minimal conversation
          } else if (currentUserIdRef.current) {
            // Start new enrichment (with lock to prevent concurrent calls)
            const enrichmentPromise = (async () => {
              try {
                return await fetchAndEnrichConversation(
                  conversationId,
                  currentUserIdRef.current!,
                  message
                );
              } finally {
                // Remove lock when done
                activeEnrichments.current.delete(conversationId);
              }
            })();
            
            activeEnrichments.current.set(conversationId, enrichmentPromise);
            
            // SACRED: Add conversation immediately with minimal data (don't wait for enrichment)
            const minimal = createMinimalConversation(
              conversationId,
              message,
              currentUserIdRef.current
            );
            dispatch({ type: 'UPDATE_CONVERSATION', payload: { conversation: minimal } });
            console.log('[MessagingProvider] ✅ Added minimal conversation immediately (enrichment in background)');
            
            // Enrich in background and update when complete
            enrichmentPromise.then((enriched) => {
              if (enriched) {
                console.log('[MessagingProvider] ✅ Background enrichment complete, updating conversation');
                dispatch({ type: 'UPDATE_CONVERSATION', payload: { conversation: enriched } });
              } else {
                console.warn('[MessagingProvider] ⚠️ Background enrichment failed, keeping minimal conversation');
              }
            }).catch((error) => {
              console.error('[MessagingProvider] Error in background enrichment:', error);
              // Keep minimal conversation - message is already preserved
            });
            
            return; // Done - message is already in minimal conversation
          } else {
            // No current user ID - create minimal conversation anyway
            console.warn('[MessagingProvider] ⚠️ No current user ID, creating minimal conversation');
            const minimal = createMinimalConversation(
              conversationId,
              message,
              message.sender_id // Use sender as fallback
            );
            dispatch({ type: 'UPDATE_CONVERSATION', payload: { conversation: minimal } });
            return;
          }
        } else if (existingConv.is_direct && !existingConv.other_user) {
          console.log('[MessagingProvider] 🔧 EXISTING CONVERSATION MISSING other_user - enriching:', {
            conversationId,
            isDirect: existingConv.is_direct,
            hasOtherUser: !!existingConv.other_user,
            currentUserId: currentUserIdRef.current,
          });
          // EXISTING CONVERSATION MISSING other_user: Enrich it with the new message
          // CRITICAL: Check if enrichment already in progress - if so, wait for it
          if (currentUserIdRef.current) {
            const enrichmentKey = `${conversationId}_enrich`;
            const existingEnrichment = activeEnrichments.current.get(enrichmentKey);
            
            if (existingEnrichment) {
              // Enrichment already in progress - wait for it and update with enriched data + new message
              console.log('[MessagingProvider] ⏳ Enrichment already in progress, waiting...');
              existingEnrichment.then((enriched) => {
                if (enriched) {
                  // Merge new message into enriched conversation
                  const updated = {
                    ...enriched,
                    last_message: message,
                    updated_at: message.created_at,
                  };
                  console.log('[MessagingProvider] ✅ Enrichment complete, updating with new message:', {
                    conversationId,
                    hasOtherUser: !!updated.other_user,
                    otherUserName: updated.other_user?.name,
                    messageId: message.id,
                  });
                  dispatch({ type: 'UPDATE_CONVERSATION', payload: { conversation: updated } });
                } else {
                  // Enrichment failed, just update message
                  dispatch({ type: 'NEW_MESSAGE', payload: { conversationId, message } });
                }
              }).catch((error) => {
                console.error('[MessagingProvider] Error waiting for enrichment:', error);
                // Fallback: just update message
                dispatch({ type: 'NEW_MESSAGE', payload: { conversationId, message } });
              });
              return; // Don't dispatch NEW_MESSAGE - will be handled by enrichment callback
            }
            
            // No enrichment in progress - start new enrichment
            // CRITICAL: Update message immediately for UI, enrich in background
            dispatch({ type: 'NEW_MESSAGE', payload: { conversationId, message } });
            
            const enrichmentPromise = (async () => {
              try {
                // CRITICAL: Use latest conversation from state (after NEW_MESSAGE update)
                // Wait for next tick to ensure state has updated
                await new Promise(resolve => setTimeout(resolve, 0));
                const latestConv = conversationsRef.current.find(c => c.id === conversationId) || existingConv;
                
                return await enrichConversationWithUserData(
                  latestConv,
                  currentUserIdRef.current!,
                  message
                );
              } finally {
                activeEnrichments.current.delete(enrichmentKey);
              }
            })();
            
            activeEnrichments.current.set(enrichmentKey, enrichmentPromise);
            
            enrichmentPromise.then((enriched) => {
              if (enriched && enriched.other_user) {
                console.log('[MessagingProvider] ✅ Background enrichment complete with other_user:', {
                  conversationId,
                  hasOtherUser: !!enriched.other_user,
                  otherUserName: enriched.other_user?.name,
                  hasMessage: !!enriched.last_message,
                  messageId: enriched.last_message?.id,
                });
                // CRITICAL: Merge ensures latest message is preserved, and other_user is added
                dispatch({ type: 'UPDATE_CONVERSATION', payload: { conversation: enriched } });
              } else {
                console.warn('[MessagingProvider] ⚠️ Background enrichment returned null/undefined or missing other_user:', {
                  conversationId,
                  enriched: !!enriched,
                  hasOtherUser: !!enriched?.other_user,
                });
                // Enrichment failed or returned incomplete data - don't update (message already in state)
              }
            }).catch((error) => {
              console.error('[MessagingProvider] Error in background enrichment:', error);
              // Message already updated, enrichment failure is acceptable
            });
            
            return; // Done - message is already updated
          } else {
            // No current user ID - just update message
            dispatch({ type: 'NEW_MESSAGE', payload: { conversationId, message } });
            return;
          }
        } else {
          console.log('[MessagingProvider] 📝 EXISTING CONVERSATION WITH other_user - just updating message');
        }
        
        // EXISTING CONVERSATION WITH other_user: Just update the message
        dispatch({ type: 'NEW_MESSAGE', payload: { conversationId, message } });
      },
      onMessageUpdated: (conversationId, message) => {
        const activeUserId = currentUserIdRef.current;
        if (!activeUserId) return;
        dispatch({ type: 'MESSAGE_UPDATED', payload: { conversationId, message } });
      },
      onMessageDeleted: async (conversationId, messageId) => {
        const activeUserId = currentUserIdRef.current;
        if (!activeUserId) return;
        dispatch({ type: 'MESSAGE_DELETED', payload: { conversationId, messageId } });
        
        // If deleted message was the last one, fetch previous message immediately
        const conv = conversationsRef.current.find(c => c.id === conversationId);
        if (conv?.last_message?.id === messageId) {
          try {
            // Fetch the most recent non-deleted message (limit 1, order by created_at DESC)
            const { data: previousMessages, error } = await supabase
              .from('messages')
              .select('id, conversation_id, sender_id, body, rendered_body, attachments, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata')
              .eq('conversation_id', conversationId)
              .eq('deleted', false)
              .order('created_at', { ascending: false })
              .limit(1);
            
            if (!error && previousMessages && previousMessages.length > 0) {
              const prevMessage = previousMessages[0];
              // Enrich with sender info
              const { data: surferData } = await supabase
                .from('surfers')
                .select('name, profile_image_url')
                .eq('user_id', prevMessage.sender_id)
                .maybeSingle();
              
              const enrichedMessage: Message = {
                ...prevMessage,
                sender_name: surferData?.name,
                sender_avatar: surferData?.profile_image_url,
              };
              
              dispatch({ 
                type: 'UPDATE_CONVERSATION', 
                payload: { 
                  conversation: { ...conv, last_message: enrichedMessage } 
                } 
              });
            } else {
              // No previous message - keep undefined
              dispatch({ 
                type: 'UPDATE_CONVERSATION', 
                payload: { 
                  conversation: { ...conv, last_message: undefined } 
                } 
              });
            }
          } catch (error) {
            console.error('[MessagingProvider] Error fetching previous message after delete:', error);
            // On error, keep undefined (already set by MESSAGE_DELETED action)
          }
        }
      },
      onConversationUpdated: (conversationId, updatedAt) => {
        const activeUserId = currentUserIdRef.current;
        if (!activeUserId) return;
        dispatch({ type: 'CONVERSATION_UPDATED', payload: { conversationId, updatedAt } });
      },
      onReconnect: () => {
        // Explicit reconnect event from subscription status - always sync
        subscriptionHealthyRef.current = true;
        handleReconnect();
      },
    };

    console.log('[MessagingProvider] 📞 Calling messagingService.subscribeToConversations...');
    const cleanup = messagingService.subscribeToConversations(callbacks);
    console.log('[MessagingProvider] ✅ Subscription cleanup function received:', typeof cleanup);
    subscriptionCleanupRef.current = cleanup;

    // Drain the outbox on mount (covers the "sent while offline, then app
    // killed" case) and on every foreground transition (covers "lost network,
    // came back"). The outbox guards against concurrent flushes internally.
    const flushOutbox = () => {
      messageOutbox
        .flushAll(async (entry) => {
          await messagingService.sendMessage(
            entry.conversationId,
            entry.body,
            [],
            entry.type,
            entry.clientId,
            entry.replyTo ?? undefined
          );
        })
        .catch((err) => console.warn('[MessagingProvider] outbox flush failed:', err));
    };
    flushOutbox();

    // Listen to app state changes (background → foreground)
    // Only sync if needed (subscription-aware)
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App came to foreground - check if sync is needed (subscription-aware)
        handleReconnect();
        flushOutbox();
      }
    });

    // Network recovery: drain the outbox as soon as connectivity returns, even
    // without an AppState transition (e.g. user toggles wifi while the app
    // stays in foreground). Lazy-require so older dev builds (without the
    // native module compiled in) don't crash at import; they just skip this
    // listener and rely on AppState + flush-on-conv-open for drain.
    let netSub: (() => void) | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NetInfo = require('@react-native-community/netinfo').default;
      let lastConnected: boolean | undefined;
      netSub = NetInfo.addEventListener((state: any) => {
        const connected = !!state.isConnected && state.isInternetReachable !== false;
        console.log('[MessagingProvider] NetInfo event', {
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          type: state.type,
          derivedConnected: connected,
          lastConnected,
          willFlush: lastConnected === false && connected,
        });
        if (lastConnected === false && connected) {
          console.log('[MessagingProvider] network recovered, flushing outbox');
          flushOutbox();
        }
        lastConnected = connected;
      });
    } catch (err) {
      console.warn(
        '[MessagingProvider] NetInfo unavailable (likely a dev build compiled before the package was installed). Falling back to AppState + conv-open flush only. Run `npx expo run:ios` to re-include NetInfo.',
        err
      );
    }

    return () => {
      cleanup();
      subscription.remove();
      if (netSub) netSub();
      if (newConvUnsub) newConvUnsub();
      // Tear down every per-conv list subscription on provider unmount.
      listSubsRef.current.forEach((unsub) => {
        try { unsub(); } catch (e) { console.warn('[MessagingProvider] list unsub failed on unmount:', e); }
      });
      listSubsRef.current.clear();
      // Stop tracking presence when component unmounts (user logs out)
      userPresenceService.stopTrackingCurrentUser().catch(error => {
        console.error('[MessagingProvider] Error stopping presence tracking:', error);
      });
    };
  }, [loadConversations, handleReconnect, handleNewConversation, isMessageProcessed, markMessageProcessed]);

  const setCurrentConversationId = useCallback((conversationId: string | null) => {
    currentConversationIdRef.current = conversationId;
  }, []);

  const getCurrentConversationId = useCallback(() => {
    return currentConversationIdRef.current;
  }, []);

  // CRITICAL: Memoize context value to ensure React detects changes
  // Only recreate when conversations array reference changes (reducer returns new array)
  const value: MessagingContextType = useMemo(() => ({
    conversations,
    unreadTotal,
    dispatch,
    markAsRead,
    refreshConversations,
    loading,
    setCurrentConversationId,
    getCurrentConversationId,
    hasMoreConversations,
    isLoadingMoreConversations,
    loadMoreConversations,
  }), [conversations, unreadTotal, dispatch, markAsRead, refreshConversations, loading, setCurrentConversationId, getCurrentConversationId, hasMoreConversations, isLoadingMoreConversations, loadMoreConversations]);

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

