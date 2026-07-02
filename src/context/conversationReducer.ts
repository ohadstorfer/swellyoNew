/**
 * conversationReducer
 * Pure state logic for the conversations list, extracted from MessagingProvider
 * so it can be unit-tested in isolation (no supabase / service side effects).
 *
 * Sort key: a conversation's recency (see conversationRecency) descending.
 */

import type { Conversation, Message } from '../services/messaging/messagingService';

// Conversation action types
export type ConversationAction =
  | { type: 'NEW_MESSAGE'; payload: { conversationId: string; message: Message } }
  | { type: 'MESSAGE_UPDATED'; payload: { conversationId: string; message: Message } }
  | { type: 'MESSAGE_DELETED'; payload: { conversationId: string; messageId: string } }
  | { type: 'CONVERSATION_UPDATED'; payload: { conversationId: string; updatedAt: string } }
  | { type: 'MARK_AS_READ'; payload: { conversationId: string } }
  | { type: 'INCREMENT_UNREAD'; payload: { conversationId: string } }
  | { type: 'SET_UNREAD_COUNT'; payload: { conversationId: string; count: number } }
  | { type: 'SET_UNREAD_COUNTS'; payload: { counts: Record<string, number> } }
  | { type: 'REPLACE_ALL'; payload: { conversations: Conversation[] } }
  | { type: 'APPEND_CONVERSATIONS'; payload: { conversations: Conversation[] } }
  | { type: 'SYNC_FROM_SERVER'; payload: { conversations: Conversation[] } }
  | { type: 'UPDATE_CONVERSATION'; payload: { conversation: Conversation } }
  | { type: 'UPDATE_MEMBER_PREFERENCES'; payload: { conversationId: string; userId: string; preferences: any } };

/**
 * Effective recency of a conversation, in epoch ms = the NEWEST of its
 * updated_at and its last_message timestamp.
 *
 * Used as both the list sort key and the freshness comparator. Folding in
 * last_message.created_at matters because a server read can carry a STALE
 * updated_at (sendMessage's conversations.updated_at touch is fire-and-forget)
 * while last_message is already fresh — recency must not regress just because
 * one of the two signals lagged.
 */
export const conversationRecency = (c: Conversation): number => {
  const updatedMs = c.updated_at ? new Date(c.updated_at).getTime() : 0;
  const messageMs = c.last_message?.created_at ? new Date(c.last_message.created_at).getTime() : 0;
  const updated = Number.isNaN(updatedMs) ? 0 : updatedMs;
  const message = Number.isNaN(messageMs) ? 0 : messageMs;
  return Math.max(updated, message);
};

/**
 * Creates a minimal conversation with fallback data when enrichment fails
 * SACRED: Ensures message is never dropped, even if enrichment fails
 */
export const createMinimalConversation = (
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

// Conversation reducer with O(n) reordering
export const conversationReducer = (state: Conversation[], action: ConversationAction): Conversation[] => {
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
      // Bail out when nothing changes — a new array identity re-renders every
      // consumer of the context (AppContent downward), so no-op dispatches
      // must not produce new state.
      if (state[index].unread_count === count) return state;

      const updated = [...state];
      updated[index] = {
        ...updated[index],
        unread_count: count,
      };
      return updated;
    }

    case 'SET_UNREAD_COUNTS': {
      // Batched form: one dispatch (= one re-render) for a whole sync pass,
      // instead of one per conversation. Bails out when every count already
      // matches.
      const { counts } = action.payload;
      let changed = false;
      const updated = state.map(c => {
        const count = counts[c.id];
        if (count === undefined || c.unread_count === count) return c;
        changed = true;
        return { ...c, unread_count: count };
      });
      return changed ? updated : state;
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

    case 'UPDATE_MEMBER_PREFERENCES': {
      // In-place mutation of a single member's preferences (e.g. mute state).
      // Critically does NOT reorder the list — used when user changes preferences
      // and we want the conversation row to stay in its current position.
      const { conversationId, userId, preferences } = action.payload;
      const index = state.findIndex(c => c.id === conversationId);
      if (index === -1) return state;
      const existing = state[index];
      const updatedMembers = (existing.members ?? []).map(m =>
        m.user_id === userId ? { ...m, preferences } : m
      );
      const next = [...state];
      next[index] = { ...existing, members: updatedMembers };
      return next;
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

      // Always sort by recency to ensure correct order after cache → server refresh
      const merged = [...updated, ...newOnes];
      return merged.sort((a, b) => conversationRecency(b) - conversationRecency(a));
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

      // Merge server data with local state.
      // NOTE: Sorting is ONLY allowed here because:
      // 1. This is a full re-sync (reconnect/restart/inbox-broadcast sync)
      // 2. It is not an incremental update
      // 3. DO NOT copy this pattern elsewhere - use O(n) move-to-top for real-time updates
      //
      // FRESHNESS GUARD — why this isn't a blind "server wins":
      // The server read can LAG a just-sent optimistic update. sendMessage()'s
      // conversations.updated_at touch is fire-and-forget, so the broadcast that
      // triggers this sync (it fires for the sender too) can SELECT a stale
      // updated_at (pre-send) even though last_message is already fresh. Letting
      // `server` overwrite the optimistic updated_at, then re-sorting, would drop
      // the conversation back to its pre-send slot — the reported bug where a
      // conversation visibly bubbles to the top on send, then reverts ~1s later.
      // Recency is monotonic, so never let the merge move a conversation backwards:
      // keep whichever side is fresher (mirrors the UPDATE_CONVERSATION guard).
      const serverMap = new Map(serverConversations.map(c => [c.id, c]));
      return state.map(local => {
        const server = serverMap.get(local.id);
        if (!server) return local;
        const merged: Conversation = {
          ...server,
          other_user: server.other_user ?? local.other_user,
          members: server.members ?? local.members,
        };
        // Local optimistic state is fresher than this (possibly stale) server
        // read — preserve local recency + preview so the send isn't reverted.
        if (conversationRecency(local) > conversationRecency(server)) {
          merged.updated_at = local.updated_at;
          merged.last_message = local.last_message ?? server.last_message;
        }
        return merged;
      }).concat(
        serverConversations.filter(s => !state.some(l => l.id === s.id))
      ).sort((a, b) => conversationRecency(b) - conversationRecency(a));
    }

    default:
      return state;
  }
};
