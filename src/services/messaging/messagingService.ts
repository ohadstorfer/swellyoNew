import { supabase, isSupabaseConfigured } from '../../config/supabase';

/**
 * Messaging Service
 * Handles all conversation and messaging operations with Supabase
 */

// Conversation interface
export interface Conversation {
  id: string;
  title?: string;
  is_direct: boolean;
  metadata: any;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Enriched fields from joins
  last_message?: Message;
  unread_count?: number;
  unread_truncated?: boolean; // Indicates if unread count was truncated due to query limit
  other_user?: ConversationMember;
  members?: ConversationMember[];
}

// Conversation member interface
export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  adv_role?: 'adv_giver' | 'adv_seeker' | null; // Role in trip planning context
  joined_at: string;
  last_read_message_id?: string;
  last_read_at?: string;
  preferences: any;
  // Enriched from users table
  name?: string;
  profile_image_url?: string;
  email?: string;
}

// Message type
export type MessageType = 'text' | 'image';

// Message upload state (client-side only, not stored in DB)
export type MessageUploadState = 
  | 'pending'      // Created locally, not yet uploaded
  | 'uploading'   // Currently uploading to storage
  | 'sent'        // Successfully uploaded and saved to DB
  | 'failed';     // Upload or save failed

// Image metadata interface
export interface ImageMetadata {
  image_url: string;           // Full-resolution image URL
  thumbnail_url?: string;       // Optional thumbnail URL (for performance)
  width: number;               // Original image width in pixels
  height: number;              // Original image height in pixels
  file_size: number;           // File size in bytes
  mime_type: string;           // e.g., 'image/jpeg', 'image/png'
  storage_path: string;        // Path in Supabase Storage (for deletion)
}

// Message interface
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  
  // Message type and content
  type?: MessageType;           // 'text' | 'image' (defaults to 'text' for backward compatibility)
  body?: string;                // Text content (for text messages or image captions)
  rendered_body?: any;
  
  // Image-specific fields (only populated for type='image')
  image_metadata?: ImageMetadata;
  
  // Legacy attachments array (keep for backward compatibility)
  attachments: any[];
  
  // Upload state (client-side only, not stored in DB)
  upload_state?: MessageUploadState;
  upload_progress?: number;     // 0-100, only during 'uploading'
  upload_error?: string;        // Error message if upload_state === 'failed'
  
  // Existing fields
  is_system: boolean;
  edited: boolean;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  
  // Enriched from users/surfers
  sender_name?: string;
  sender_avatar?: string;
  sender?: {
    name?: string;
    avatar?: string;
  };
}

// Message reaction interface
export interface MessageReaction {
  message_id: string;
  user_id: string;
  reaction: string;
  reacted_at: string;
}

// Subscription callbacks interface
export interface MessageSubscriptionCallbacks {
  onNewMessage?: (message: Message) => void;
  onMessageUpdated?: (message: Message) => void;
  onMessageDeleted?: (messageId: string) => void;
  onTyping?: (userId: string, isTyping: boolean) => void;
}

// Conversation list subscription callbacks
export interface ConversationSubscriptionCallbacks {
  onNewMessage?: (conversationId: string, message: Message) => void;
  onMessageUpdated?: (conversationId: string, message: Message) => void;
  onMessageDeleted?: (conversationId: string, messageId: string) => void;
  onConversationUpdated?: (conversationId: string, updatedAt: string) => void;
  onReconnect?: () => void; // CRITICAL: Handle reconnect
}

class MessagingService {
  // Track active subscriptions for cleanup
  private activeSubscriptions = new Map<string, any>();
  // Track typing state per conversation
  private typingState = new Map<string, Map<string, number>>(); // conversationId -> userId -> timestamp
  // Rate limiting for typing indicators (500ms)
  private lastTypingEvent = new Map<string, number>(); // conversationId -> timestamp

  /**
   * Get all conversations for the current user
   * OPTIMIZED: Batches all queries to avoid N+1 problem
   * @param limit - Maximum number of conversations to fetch (default: 50)
   * @param offset - Number of conversations to skip (default: 0)
   * @returns Object with conversations array and hasMore boolean indicating if more conversations exist
   */
  async getConversations(limit: number = 50, offset: number = 0): Promise<{ conversations: Conversation[], hasMore: boolean }> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Ensure we have a valid session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        console.log('[messagingService] No session in getConversations - auth guard will handle redirect');
        return { conversations: [], hasMore: false }; // Return empty array, auth guard will redirect
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[messagingService] No user in getConversations - auth guard will handle redirect');
        return { conversations: [], hasMore: false }; // Return empty array, auth guard will redirect
      }

      // Get conversations where user is a member with pagination
      // Fetch limit+1 to determine if there are more conversations
      // Note: Supabase range is inclusive-inclusive, so range(offset, offset+limit) returns limit+1 items
      const fetchLimit = limit + 1; // Explicitly fetch one extra to detect hasMore
      const { data: membershipData, error: membershipError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: false })
        .range(offset, offset + limit); // This returns limit+1 items (inclusive-inclusive)

      if (membershipError) throw membershipError;

      // Check if there are more conversations
      // If we got exactly limit+1 items, there are more
      // If we got fewer than limit+1, we've reached the end
      // Edge case: If we got exactly limit items, there might be more (backend returned fewer)
      // Conservative approach: If we got exactly limit items, assume there might be more
      const receivedCount = membershipData?.length || 0;
      const hasMore = receivedCount > limit || (receivedCount === limit && receivedCount > 0);
      
      // Take only the requested limit (remove the extra one we fetched if it exists)
      const paginatedMembershipData = membershipData ? membershipData.slice(0, limit) : [];
      const conversationIds = paginatedMembershipData.map(m => m.conversation_id);

      if (conversationIds.length === 0) {
        return { conversations: [], hasMore: false };
      }

      // OPTIMIZATION 1: Get conversation details with specific columns
      const { data: conversations, error: conversationsError } = await supabase
        .from('conversations')
        .select('id, title, is_direct, metadata, created_by, created_at, updated_at')
        .in('id', conversationIds)
        .order('updated_at', { ascending: false });

      if (conversationsError) throw conversationsError;

      if (!conversations || conversations.length === 0) {
        return { conversations: [], hasMore: false };
      }

      // OPTIMIZATION 2: Fetch all last messages using PostgreSQL DISTINCT ON via RPC
      // This guarantees exactly one message per conversation (the most recent)
      // Much more efficient and reliable than fetching many messages and filtering in JavaScript
      // Solves the issue where only the first few conversations show last message text
      const { data: lastMessages, error: messagesError } = await supabase
        .rpc('get_last_messages_per_conversation', {
          conv_ids: conversationIds
        });

      if (messagesError) {
        console.error('Error fetching last messages:', messagesError);
      }

      // Convert array to Map for easy lookup
      // RPC already returns exactly one message per conversation, so no need for deduplication
      const lastMessagesMap = new Map<string, Message>();
      if (lastMessages && lastMessages.length > 0) {
        lastMessages.forEach((msg: Message) => {
          lastMessagesMap.set(msg.conversation_id, msg);
      });
      }

      // OPTIMIZATION 3: Batch fetch all member data for all conversations
      const { data: allMembersData, error: allMembersError } = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id, role, adv_role, joined_at, last_read_message_id, last_read_at, preferences')
        .in('conversation_id', conversationIds);

      if (allMembersError) {
        console.error('Error fetching all members:', allMembersError);
      }

      // OPTIMIZATION 3.5: Extract user IDs early and fetch user data in parallel with other queries
      const allUserIds = new Set<string>();
      (allMembersData || []).forEach(member => {
        allUserIds.add(member.user_id);
      });
      const userIdsArray = Array.from(allUserIds);

      // OPTIMIZATION 4: Get current user's read status for all conversations in one query
      const { data: userMemberData, error: userMemberError } = await supabase
        .from('conversation_members')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id)
        .in('conversation_id', conversationIds);

      if (userMemberError) {
        console.error('Error fetching user member data:', userMemberError);
      }

      const userReadMap = new Map<string, string | null>();
      (userMemberData || []).forEach(member => {
        userReadMap.set(member.conversation_id, member.last_read_at);
      });

      // OPTIMIZATION 5: Fetch user names EARLY and in parallel with unread counts
      // This allows names to be available immediately
      const [usersResult, surfersResult] = await Promise.all([
        supabase
          .from('users')
          .select('id, email')
          .in('id', userIdsArray),
        supabase
          .from('surfers')
          .select('user_id, name, profile_image_url')
          .in('user_id', userIdsArray)
      ]);

      const usersData = usersResult.data || [];
      const surfersData = surfersResult.data || [];

      // Create lookup maps early (before unread counts calculation)
      const usersMap = new Map(usersData.map(u => [u.id, u]));
      const surfersMap = new Map(surfersData.map(s => [s.user_id, s]));

      // OPTIMIZATION 6: Calculate unread counts in a SINGLE query (instead of N queries)
      // Fetch all unread messages for all conversations, then count per conversation in JavaScript
      const unreadCountMap = new Map<string, number>();
      
      // Initialize all conversations with 0 unread
      conversations.forEach(conv => {
        unreadCountMap.set(conv.id, 0);
      });

      // Fetch all unread messages for all conversations in one query
      // We need messages where: conversation_id IN (ids), deleted=false, sender_id != user.id, created_at > last_read_at
      // Since last_read_at varies per conversation, we'll fetch all messages after the oldest last_read_at
      // and filter in JavaScript (more efficient than N queries)
      const lastReadAtValues = Array.from(userReadMap.values()).filter(ts => ts !== null);
      const oldestLastReadAt = lastReadAtValues.length > 0
        ? Math.min(...lastReadAtValues.map(ts => new Date(ts!).getTime()))
        : 0; // If no last_read_at values, use 0 (epoch) to fetch all messages

      // Fetch all messages that could potentially be unread
      // Use oldest last_read_at as the lower bound (or epoch if none exist)
      const cutoffDate = oldestLastReadAt > 0 
        ? new Date(oldestLastReadAt).toISOString()
        : new Date(0).toISOString(); // Epoch if no last_read_at

      // CRITICAL: Add limit to prevent fetching thousands of unread messages
      const UNREAD_MESSAGES_LIMIT = 1000;
      const { data: unreadMessages, error: unreadError } = await supabase
          .from('messages')
        .select('id, conversation_id, sender_id, created_at')
        .in('conversation_id', conversationIds)
          .eq('deleted', false)
        .neq('sender_id', user.id)
        .gt('created_at', cutoffDate)
        .limit(UNREAD_MESSAGES_LIMIT);

      // Track if we hit the limit (indicates there may be more unread messages)
      const hitUnreadLimit = unreadMessages && unreadMessages.length === UNREAD_MESSAGES_LIMIT;
      const conversationsWithTruncatedUnread = new Set<string>();

      if (!unreadError && unreadMessages) {
        // Count unread messages per conversation (filtering by actual last_read_at)
        unreadMessages.forEach(msg => {
          const lastReadAt = userReadMap.get(msg.conversation_id);
          const msgTime = new Date(msg.created_at).getTime();
          
          if (lastReadAt) {
            const lastReadTime = new Date(lastReadAt).getTime();
            if (msgTime > lastReadTime) {
              unreadCountMap.set(msg.conversation_id, (unreadCountMap.get(msg.conversation_id) || 0) + 1);
              // If we hit the limit, mark this conversation as potentially truncated
              if (hitUnreadLimit) {
                conversationsWithTruncatedUnread.add(msg.conversation_id);
              }
            }
          } else {
            // No last_read_at means all messages are unread (count this one)
            unreadCountMap.set(msg.conversation_id, (unreadCountMap.get(msg.conversation_id) || 0) + 1);
            // If we hit the limit, mark this conversation as potentially truncated
            if (hitUnreadLimit) {
              conversationsWithTruncatedUnread.add(msg.conversation_id);
            }
          }
        });
      }

      // Group members by conversation (after we have all data)
      const membersByConversation = new Map<string, typeof allMembersData>();
      (allMembersData || []).forEach(member => {
        if (!membersByConversation.has(member.conversation_id)) {
          membersByConversation.set(member.conversation_id, []);
        }
        membersByConversation.get(member.conversation_id)!.push(member);
      });

      // OPTIMIZATION 7: Enrich members using the lookup maps (no additional queries)
      // Names are already fetched, so this is just mapping
      const enrichedMembersByConv = new Map<string, ConversationMember[]>();
      membersByConversation.forEach((members, convId: string) => {
        const enriched = (members || []).map(member => {
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
            name,
            profile_image_url: surferData?.profile_image_url,
            email: userData?.email,
          };
        });
        enrichedMembersByConv.set(convId, enriched);
      });

      // Build final enriched conversations
      const enrichedConversations = conversations.map(conv => {
        const lastMessage = lastMessagesMap.get(conv.id);
        const unreadCount = unreadCountMap.get(conv.id) || 0;
        const enrichedMembers = enrichedMembersByConv.get(conv.id) || [];
        const unreadTruncated = conversationsWithTruncatedUnread.has(conv.id);

        // For direct conversations, find the other user
        let otherUser: ConversationMember | undefined;
        if (conv.is_direct && enrichedMembers.length > 0) {
          const otherMember = enrichedMembers.find(m => m.user_id !== user.id);
          if (otherMember) {
            otherUser = otherMember;
          }
        }

        return {
          ...conv,
          last_message: lastMessage,
          unread_count: unreadCount,
          unread_truncated: unreadTruncated,
          other_user: otherUser,
          members: enrichedMembers,
        };
      });

      return { conversations: enrichedConversations, hasMore };
    } catch (error) {
      console.error('Error fetching conversations:', error);
      throw error;
    }
  }

  /**
   * Get messages updated since a specific timestamp (version-aware sync)
   * @param conversationId - The conversation ID
   * @param lastSyncTimestamp - Timestamp to fetch messages updated after
   * @param limit - Maximum number of messages to fetch (default: 20)
   */
  async getMessagesUpdatedSince(
    conversationId: string,
    lastSyncTimestamp: number,
    limit: number = 20
  ): Promise<Message[]> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Convert timestamp to ISO string for query
      const lastSyncDate = new Date(lastSyncTimestamp).toISOString();
      
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, body, rendered_body, attachments, is_system, edited, deleted, created_at, updated_at, type, image_metadata')
        .eq('conversation_id', conversationId)
        .eq('deleted', false)
        .gt('updated_at', lastSyncDate)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) throw error;

      // #region agent log
      // Log raw database response to check if type and image_metadata are returned
      if (messages && messages.length > 0) {
        fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'messagingService.ts:436',message:'Raw database response from getMessagesUpdatedSince',data:{totalMessages:messages.length,conversationId,lastSyncTimestamp,allMessages:messages.map((msg,idx)=>({index:idx,id:msg.id,type:msg.type,hasType:'type' in msg,imageMetadata:msg.image_metadata,hasImageMetadata:'image_metadata' in msg,rawKeys:Object.keys(msg)})),sampleMessage:messages[0]},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion

      if (!messages || messages.length === 0) {
        return [];
      }

      // Fetch sender info separately for each unique sender (already batched)
      const senderIds = [...new Set(messages.map(msg => msg.sender_id))];
      
      if (senderIds.length === 0) {
        return messages.map(msg => ({
          ...msg,
          sender_name: undefined,
          sender_avatar: undefined,
        }));
      }

      // OPTIMIZATION: Batch fetch surfer data for all senders
      const { data: surfersData } = await supabase
        .from('surfers')
        .select('user_id, name, profile_image_url')
        .in('user_id', senderIds);

      // Create a map for quick lookup
      const surferMap = new Map(
        (surfersData || []).map(s => [s.user_id, s])
      );

      // Enrich messages with sender info
      return messages.map(msg => ({
        ...msg,
        sender_name: surferMap.get(msg.sender_id)?.name,
        sender_avatar: surferMap.get(msg.sender_id)?.profile_image_url,
      }));
    } catch (error) {
      console.error('Error fetching messages updated since:', error);
      throw error;
    }
  }

  /**
   * Get messages for a specific conversation
   * OPTIMIZED: Uses specific column selects instead of *
   * @param conversationId - The conversation ID
   * @param limit - Maximum number of messages to fetch (default: 50)
   * @param afterMessageId - Optional: Only fetch messages after this message ID (for incremental sync)
   * @param beforeMessageId - Optional: Only fetch messages before this message ID (for loading older messages)
   * @param beforeMessageCreatedAt - Optional: created_at timestamp of beforeMessageId (avoids extra query if provided)
   */
  async getMessages(
    conversationId: string, 
    limit: number = 50,
    afterMessageId?: string,
    beforeMessageId?: string,
    beforeMessageCreatedAt?: string
  ): Promise<{ messages: Message[], hasMore: boolean }> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Fetch limit+1 to determine if there are more messages
      const fetchLimit = limit + 1;
      
      let query = supabase
        .from('messages')
        .select('id, conversation_id, sender_id, body, rendered_body, attachments, is_system, edited, deleted, created_at, updated_at, type, image_metadata')
        .eq('conversation_id', conversationId)
        .eq('deleted', false)
        .order('created_at', { ascending: true })
        .limit(fetchLimit);

      // If afterMessageId is provided, fetch only messages after it (incremental sync)
      if (afterMessageId) {
        // First get the created_at of the message we're syncing after
        const { data: afterMessage } = await supabase
          .from('messages')
          .select('created_at')
          .eq('id', afterMessageId)
          .single();

        if (afterMessage) {
          query = query.gt('created_at', afterMessage.created_at);
        }
      }

      // If beforeMessageId is provided, fetch only messages before it (loading older messages)
      if (beforeMessageId) {
        if (beforeMessageCreatedAt) {
          // Use provided timestamp (avoids extra query)
          query = query.lt('created_at', beforeMessageCreatedAt);
        } else {
          // Fallback: query for created_at if not provided (backward compatibility)
          const { data: beforeMessage } = await supabase
            .from('messages')
            .select('created_at')
            .eq('id', beforeMessageId)
            .single();

          if (beforeMessage) {
            query = query.lt('created_at', beforeMessage.created_at);
          }
        }
      }

      const { data: messages, error } = await query;

      if (error) throw error;

      // #region agent log
      // Log raw database response to check if type and image_metadata are returned
      if (messages && messages.length > 0) {
        fetch('http://127.0.0.1:7242/ingest/6b4e2d69-2c76-430d-914a-aa3116b97922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'messagingService.ts:541',message:'Raw database response from getMessages',data:{totalMessages:messages.length,conversationId,allMessages:messages.map((msg,idx)=>({index:idx,id:msg.id,type:msg.type,hasType:'type' in msg,imageMetadata:msg.image_metadata,hasImageMetadata:'image_metadata' in msg,rawKeys:Object.keys(msg)})),sampleMessage:messages[0]},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion

      if (!messages || messages.length === 0) {
        return { messages: [], hasMore: false };
      }

      // Check if there are more messages (if we got limit+1, there are more)
      const hasMore = messages.length > limit;
      const paginatedMessages = hasMore ? messages.slice(0, limit) : messages;

      // Fetch sender info separately for each unique sender (already batched)
      const senderIds = [...new Set(paginatedMessages.map(msg => msg.sender_id))];
      
      if (senderIds.length === 0) {
        return {
          messages: paginatedMessages.map(msg => ({
            ...msg,
            sender_name: undefined,
            sender_avatar: undefined,
          })),
          hasMore
        };
      }

      // OPTIMIZATION: Batch fetch surfer data for all senders
      const { data: surfersData } = await supabase
        .from('surfers')
        .select('user_id, name, profile_image_url')
        .in('user_id', senderIds);

      // Create a map for quick lookup
      const surferMap = new Map(
        (surfersData || []).map(s => [s.user_id, s])
      );

      // Enrich messages with sender info
      return {
        messages: paginatedMessages.map(msg => ({
          ...msg,
          sender_name: surferMap.get(msg.sender_id)?.name,
          sender_avatar: surferMap.get(msg.sender_id)?.profile_image_url,
        })),
        hasMore
      };
    } catch (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(conversationId: string, body: string, attachments: any[] = [], type: MessageType = 'text'): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[messagingService] No user - auth guard will handle redirect');
        throw new Error('Not authenticated'); // Still throw for type safety, but auth guard will catch
      }

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          body,
          attachments,
          type: type || 'text',
        })
        .select()
        .single();

      if (error) throw error;

      // Update conversation's updated_at
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      return data;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  /**
   * Create an image message record (DB-first flow)
   * Creates the message record before upload, returns real message ID
   */
  async createImageMessage(conversationId: string, caption?: string): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Create message record with type='image' and image_metadata=null (will be populated after upload)
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          type: 'image',
          body: caption || null,
          image_metadata: null, // Will be populated after upload
        })
        .select()
        .single();

      if (error) throw error;

      // Update conversation's updated_at
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      return data;
    } catch (error) {
      console.error('Error creating image message:', error);
      throw error;
    }
  }

  /**
   * Update image message with metadata after upload completes
   */
  async updateImageMessageMetadata(messageId: string, imageMetadata: ImageMetadata): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase
        .from('messages')
        .update({
          image_metadata: imageMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('sender_id', user.id) // Ensure user owns the message
        .select()
        .single();

      if (error) throw error;

      // Update conversation's updated_at
      if (data) {
        await supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', data.conversation_id);
      }

      return data;
    } catch (error) {
      console.error('Error updating image message metadata:', error);
      throw error;
    }
  }

  /**
   * Create a new direct conversation with another user
   * @param otherUserId - The user ID to create a conversation with
   * @param fromTripPlanning - If true, sets adv_role: current user = adv_seeker, other user = adv_giver
   */
  async createDirectConversation(
    otherUserId: string, 
    fromTripPlanning: boolean = false
  ): Promise<Conversation> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Ensure we have a valid session with auth token
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        console.error('Session error:', sessionError);
        throw new Error('Failed to get authentication session');
      }
      if (!session) {
        console.log('[messagingService] No session - auth guard will handle redirect');
        throw new Error('Not authenticated'); // Still throw for type safety, but auth guard will catch
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[messagingService] No user - auth guard will handle redirect');
        throw new Error('Not authenticated'); // Still throw for type safety, but auth guard will catch
      }
      
      console.log('Creating conversation with user:', otherUserId, 'Current user:', user.id);
      console.log('Session exists:', !!session, 'Access token present:', !!session.access_token);

      // Check if a direct conversation already exists
      // Use maybeSingle() to handle cases where no conversations exist
      const { data: existingConversations, error: existingError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (existingError) {
        console.error('Error checking existing conversations:', existingError);
        // Continue to create new conversation even if check fails
      } else if (existingConversations && existingConversations.length > 0) {
        for (const { conversation_id } of existingConversations) {
          const { data: members, error: membersError } = await supabase
            .from('conversation_members')
            .select('user_id')
            .eq('conversation_id', conversation_id);

          if (membersError) {
            console.error('Error fetching members for conversation:', conversation_id, membersError);
            continue;
          }

          if (members && members.length === 2) {
            const userIds = members.map(m => m.user_id).sort();
            const targetUserIds = [user.id, otherUserId].sort();
            if (JSON.stringify(userIds) === JSON.stringify(targetUserIds)) {
              // Found existing conversation
              const { data: conv, error: convError } = await supabase
                .from('conversations')
                .select('*')
                .eq('id', conversation_id)
                .maybeSingle();
              
              if (convError) {
                console.error('Error fetching existing conversation:', convError);
                break;
              }
              
              if (conv) {
                console.log('Found existing conversation:', conv.id);
                return conv;
              }
            }
          }
        }
      }

      // Create new conversation
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          is_direct: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (convError) throw convError;

      // Add both users as members
      // If from trip planning: current user is adv_seeker, other user is adv_giver
      const { error: membersError } = await supabase
        .from('conversation_members')
        .insert([
          {
            conversation_id: conversation.id,
            user_id: user.id,
            role: 'owner',
            adv_role: fromTripPlanning ? 'adv_seeker' : null,
          },
          {
            conversation_id: conversation.id,
            user_id: otherUserId,
            role: 'member',
            adv_role: fromTripPlanning ? 'adv_giver' : null,
          },
        ]);

      if (membersError) throw membersError;

      return conversation;
    } catch (error) {
      console.error('Error creating direct conversation:', error);
      throw error;
    }
  }

  /**
   * Mark messages as read
   */
  async markAsRead(conversationId: string, messageId?: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[messagingService] No user - auth guard will handle redirect');
        throw new Error('Not authenticated'); // Still throw for type safety, but auth guard will catch
      }

      // If no messageId provided, get the latest message
      let targetMessageId = messageId;
      if (!targetMessageId) {
        const { data: lastMessage } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        targetMessageId = lastMessage?.id;
      }

      // Update last_read for this user in this conversation
      const { error } = await supabase
        .from('conversation_members')
        .update({
          last_read_message_id: targetMessageId,
          last_read_at: new Date().toISOString(),
        })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;
    } catch (error) {
      console.error('Error marking as read:', error);
      throw error;
    }
  }

  /**
   * Subscribe to messages in a conversation with unified subscription
   * Handles INSERT, UPDATE, DELETE events and typing indicators in a single channel
   */
  subscribeToMessages(
    conversationId: string, 
    callbacks: MessageSubscriptionCallbacks | ((message: Message) => void)
  ) {
    if (!isSupabaseConfigured()) {
      console.warn('Supabase is not configured, subscription will not work');
      return () => {}; // Return no-op unsubscribe function
    }

    // Support legacy callback signature for backward compatibility
    const normalizedCallbacks: MessageSubscriptionCallbacks = 
      typeof callbacks === 'function' 
        ? { onNewMessage: callbacks }
        : callbacks;

    // Clean up existing subscription if any
    const existingUnsubscribe = this.activeSubscriptions.get(conversationId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }

    // Initialize typing state for this conversation
    if (!this.typingState.has(conversationId)) {
      this.typingState.set(conversationId, new Map());
    }

    const channel = supabase
      .channel(`messages:${conversationId}`)
      // Handle new messages (INSERT)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          let newMessage = payload.new as Message;
          
          // CRITICAL: Check if payload is missing the type field
          // Supabase Realtime payloads should include all columns, but we verify to ensure data integrity
          // Note: image_metadata can be null for image messages (during upload), so we only check for type
          const needsFullFetch = newMessage.type === undefined;
          
          if (needsFullFetch) {
            // Fetch full message from database to ensure all fields are present
            try {
              const { data: fullMessage, error } = await supabase
                .from('messages')
                .select('id, conversation_id, sender_id, body, rendered_body, attachments, is_system, edited, deleted, created_at, updated_at, type, image_metadata')
                .eq('id', newMessage.id)
                .single();
              
              if (!error && fullMessage) {
                newMessage = fullMessage as Message;
                console.log('[MessagingService] Fetched full message for INSERT:', { id: newMessage.id, type: newMessage.type, hasImageMetadata: !!newMessage.image_metadata });
              } else {
                console.warn('[MessagingService] Failed to fetch full message for INSERT, using payload:', error);
              }
            } catch (error) {
              console.error('[MessagingService] Error fetching full message for INSERT:', error);
              // Continue with payload as fallback
            }
          }
          
          // Enrich message with sender info if needed
          if (!newMessage.sender_name || !newMessage.sender_avatar) {
            try {
              const { data: surferData } = await supabase
                .from('surfers')
                .select('name, profile_image_url')
                .eq('user_id', newMessage.sender_id)
                .maybeSingle();
              
              if (surferData) {
                newMessage.sender_name = surferData.name;
                newMessage.sender_avatar = surferData.profile_image_url;
              }
            } catch (error) {
              console.error('Error enriching message with sender info:', error);
            }
          }
          
          if (normalizedCallbacks.onNewMessage) {
            normalizedCallbacks.onNewMessage(newMessage);
          }
        }
      )
      // Handle message updates (UPDATE) - for edited messages
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          let updatedMessage = payload.new as Message;
          
          // CRITICAL: Always fetch full message for UPDATE events to ensure we have the latest image_metadata
          // UPDATE events are critical for image messages (when image_metadata is populated after upload)
          // This ensures cache always has complete data
          try {
            const { data: fullMessage, error } = await supabase
              .from('messages')
              .select('id, conversation_id, sender_id, body, rendered_body, attachments, is_system, edited, deleted, created_at, updated_at, type, image_metadata')
              .eq('id', updatedMessage.id)
              .single();
            
            if (!error && fullMessage) {
              updatedMessage = fullMessage as Message;
              console.log('[MessagingService] Fetched full message for UPDATE:', { id: updatedMessage.id, type: updatedMessage.type, hasImageMetadata: !!updatedMessage.image_metadata });
            } else {
              console.warn('[MessagingService] Failed to fetch full message for UPDATE, using payload:', error);
            }
          } catch (error) {
            console.error('[MessagingService] Error fetching full message for UPDATE:', error);
            // Continue with payload as fallback
          }
          
          // Enrich message with sender info if needed
          if (!updatedMessage.sender_name || !updatedMessage.sender_avatar) {
            try {
              const { data: surferData } = await supabase
                .from('surfers')
                .select('name, profile_image_url')
                .eq('user_id', updatedMessage.sender_id)
                .maybeSingle();
              
              if (surferData) {
                updatedMessage.sender_name = surferData.name;
                updatedMessage.sender_avatar = surferData.profile_image_url;
              }
            } catch (error) {
              console.error('Error enriching updated message with sender info:', error);
            }
          }
          
          if (normalizedCallbacks.onMessageUpdated) {
            normalizedCallbacks.onMessageUpdated(updatedMessage);
          }
        }
      )
      // Handle message deletions (DELETE)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const deletedMessageId = payload.old.id as string;
          if (normalizedCallbacks.onMessageDeleted) {
            normalizedCallbacks.onMessageDeleted(deletedMessageId);
          }
        }
      )
      // Handle typing indicators via broadcast
      .on(
        'broadcast',
        { event: 'typing' },
        (payload) => {
          const { userId, isTyping } = payload.payload as { userId: string; isTyping: boolean };
          if (normalizedCallbacks.onTyping) {
            normalizedCallbacks.onTyping(userId, isTyping);
          }
          
          // Track typing state
          const conversationTypingState = this.typingState.get(conversationId);
          if (conversationTypingState) {
            if (isTyping) {
              conversationTypingState.set(userId, Date.now());
            } else {
              conversationTypingState.delete(userId);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to messages for conversation ${conversationId}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`Error subscribing to messages for conversation ${conversationId}`);
        }
      });

    // Auto-cleanup typing indicators after 3 seconds
    const typingCleanupInterval = setInterval(() => {
      const conversationTypingState = this.typingState.get(conversationId);
      if (conversationTypingState) {
        const now = Date.now();
        const staleUsers: string[] = [];
        
        conversationTypingState.forEach((timestamp, userId) => {
          if (now - timestamp > 3000) {
            staleUsers.push(userId);
            if (normalizedCallbacks.onTyping) {
              normalizedCallbacks.onTyping(userId, false);
            }
          }
        });
        
        staleUsers.forEach(userId => conversationTypingState.delete(userId));
      }
    }, 1000);

    const unsubscribe = () => {
      clearInterval(typingCleanupInterval);
      supabase.removeChannel(channel);
      this.activeSubscriptions.delete(conversationId);
      this.typingState.delete(conversationId);
      this.lastTypingEvent.delete(conversationId);
    };

    this.activeSubscriptions.set(conversationId, unsubscribe);
    return unsubscribe;
  }

  /**
   * Start typing indicator (with rate limiting)
   */
  async startTyping(conversationId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Rate limiting: max 1 event per 500ms
      const lastEvent = this.lastTypingEvent.get(conversationId) || 0;
      const now = Date.now();
      if (now - lastEvent < 500) {
        return; // Skip if too soon
      }

      this.lastTypingEvent.set(conversationId, now);

      const channel = supabase.channel(`messages:${conversationId}`);
      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: user.id, isTyping: true },
      });
    } catch (error) {
      console.error('Error sending typing indicator:', error);
    }
  }

  /**
   * Stop typing indicator
   */
  async stopTyping(conversationId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const channel = supabase.channel(`messages:${conversationId}`);
      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: user.id, isTyping: false },
      });
    } catch (error) {
      console.error('Error stopping typing indicator:', error);
    }
  }

  /**
   * Edit a message (with 15-minute edit window)
   */
  async editMessage(conversationId: string, messageId: string, newBody: string): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Check if message exists and belongs to user
      const { data: existingMessage, error: fetchError } = await supabase
        .from('messages')
        .select('id, sender_id, created_at')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .eq('sender_id', user.id)
        .single();

      if (fetchError || !existingMessage) {
        throw new Error('Message not found or you do not have permission to edit it');
      }

      // Check 15-minute edit window
      const messageAge = Date.now() - new Date(existingMessage.created_at).getTime();
      const fifteenMinutes = 15 * 60 * 1000;
      if (messageAge > fifteenMinutes) {
        throw new Error('Message can only be edited within 15 minutes of sending');
      }

      // Update message
      const { data: updatedMessage, error: updateError } = await supabase
        .from('messages')
        .update({
          body: newBody,
          edited: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .eq('sender_id', user.id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Update conversation's updated_at
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      return updatedMessage;
    } catch (error) {
      console.error('Error editing message:', error);
      throw error;
    }
  }

  /**
   * Delete a message (soft delete)
   */
  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Check if message exists and belongs to user
      const { data: existingMessage, error: fetchError } = await supabase
        .from('messages')
        .select('id, sender_id')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .eq('sender_id', user.id)
        .single();

      if (fetchError || !existingMessage) {
        throw new Error('Message not found or you do not have permission to delete it');
      }

      // Soft delete
      const { error: deleteError } = await supabase
        .from('messages')
        .update({
          deleted: true,
          body: null, // Clear body for deleted messages
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .eq('sender_id', user.id);

      if (deleteError) throw deleteError;

      // Update conversation's updated_at
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    } catch (error) {
      console.error('Error deleting message:', error);
      throw error;
    }
  }

  /**
   * Subscribe to conversation updates (for the conversations list)
   */
  /**
   * Subscribe to conversation list updates with granular callbacks
   * Supports both legacy callback and new granular callbacks for backward compatibility
   */
  subscribeToConversations(
    callbacks: ConversationSubscriptionCallbacks | (() => void)
  ): () => void {
    console.log('[MessagingService] 🚀 subscribeToConversations called');
    
    if (!isSupabaseConfigured()) {
      console.error('[MessagingService] ❌ Supabase is not configured');
      throw new Error('Supabase is not configured');
    }

    // Backward compatibility: if it's a function, convert to callbacks object
    const normalizedCallbacks: ConversationSubscriptionCallbacks = 
      typeof callbacks === 'function'
        ? { onReconnect: callbacks }
        : callbacks;
    
    console.log('[MessagingService] ✅ Callbacks normalized:', {
      hasOnNewMessage: !!normalizedCallbacks.onNewMessage,
      hasOnMessageUpdated: !!normalizedCallbacks.onMessageUpdated,
      hasOnMessageDeleted: !!normalizedCallbacks.onMessageDeleted,
      hasOnConversationUpdated: !!normalizedCallbacks.onConversationUpdated,
      hasOnReconnect: !!normalizedCallbacks.onReconnect,
    });

    // Batch enrichment for sender info (to avoid N+1 queries)
    const pendingEnrichments = new Map<string, { message: Message; conversationId: string; timestamp: number }>();
    let enrichmentTimer: ReturnType<typeof setTimeout> | null = null;
    const ENRICHMENT_BATCH_DELAY = 100; // Batch enrichment every 100ms
    
    const processEnrichments = async () => {
      if (pendingEnrichments.size === 0) return;
      
      const enrichments = Array.from(pendingEnrichments.values());
      pendingEnrichments.clear();
      
      console.log('[MessagingService] 🔄 Processing enrichment batch:', {
        count: enrichments.length,
        conversationIds: [...new Set(enrichments.map(e => e.conversationId))],
      });
      
      // Get unique sender IDs
      const senderIds = [...new Set(enrichments.map(e => e.message.sender_id))];
      
      if (senderIds.length === 0) {
        console.log('[MessagingService] ⚠️ No sender IDs to enrich, calling callbacks directly');
        // No senders to enrich, call callbacks with unenriched messages
        enrichments.forEach(({ message, conversationId }) => {
          normalizedCallbacks.onNewMessage?.(conversationId, message);
        });
        return;
      }
      
      try {
        // Batch fetch surfer data for all senders
        const { data: surfersData } = await supabase
          .from('surfers')
          .select('user_id, name, profile_image_url')
          .in('user_id', senderIds);
        
        console.log('[MessagingService] ✅ Fetched surfer data:', {
          requested: senderIds.length,
          received: surfersData?.length || 0,
        });
        
        const surferMap = new Map(
          (surfersData || []).map(s => [s.user_id, s])
        );
        
        // Enrich messages and call callbacks
        enrichments.forEach(({ message, conversationId }) => {
          const surferData = surferMap.get(message.sender_id);
          const enrichedMessage: Message = {
            ...message,
            sender_name: surferData?.name,
            sender_avatar: surferData?.profile_image_url,
          };
          
          console.log('[MessagingService] 📤 Calling onNewMessage callback:', {
            conversationId,
            messageId: enrichedMessage.id,
            hasSenderName: !!enrichedMessage.sender_name,
            hasSenderAvatar: !!enrichedMessage.sender_avatar,
          });
          
          normalizedCallbacks.onNewMessage?.(conversationId, enrichedMessage);
        });
      } catch (error) {
        console.error('[MessagingService] ❌ Error enriching messages in batch:', error);
        // Call callbacks with unenriched messages on error
        enrichments.forEach(({ message, conversationId }) => {
          console.log('[MessagingService] 📤 Calling onNewMessage callback (fallback, no enrichment):', {
            conversationId,
            messageId: message.id,
          });
          normalizedCallbacks.onNewMessage?.(conversationId, message);
        });
      }
    };

    console.log('[MessagingService] 📡 Creating channel: conversations_list');
    
    // CRITICAL: For unfiltered subscriptions with RLS, Supabase Realtime needs
    // the RLS policy to be evaluated correctly. The issue is that without a filter,
    // Supabase might not properly evaluate RLS policies that use functions.
    // 
    // Since DirectMessageScreen works (with filter), but ConversationsScreen doesn't
    // (without filter), we need to ensure RLS evaluation works for unfiltered subscriptions.
    //
    // The RLS policy uses `is_user_conversation_member()` function which should work,
    // but Supabase Realtime might need a hint. Let's try adding a minimal filter
    // that doesn't restrict results but helps RLS evaluation.
    
    const channel = supabase
      .channel('conversations_list')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          // Try without filter first - if RLS policy is correct, this should work
          // If it doesn't work, the issue is RLS policy evaluation, not the subscription
        },
        (payload) => {
          console.log('[MessagingService] 🔔 RECEIVED MESSAGE INSERT EVENT:', {
            messageId: payload.new?.id,
            conversationId: payload.new?.conversation_id,
            senderId: payload.new?.sender_id,
            hasBody: !!payload.new?.body,
            timestamp: new Date().toISOString(),
          });
          
          const message = payload.new as Message;
          
          // CRITICAL: RLS policy should have already filtered this, but if we're receiving it,
          // it means the user CAN see it (RLS passed). The difference between this subscription
          // and DirectMessageScreen is that DirectMessageScreen uses a filter, which might
          // help Supabase optimize RLS evaluation. Without a filter, Supabase needs to
          // evaluate RLS for ALL messages, which might not work correctly with function-based policies.
          
          console.log('[MessagingService] 🔍 Message received, RLS check passed (user can see this message)');
          
          // Validate message has required fields
          if (!message.id || !message.conversation_id || !message.created_at) {
            console.warn('[MessagingService] ❌ Invalid message from subscription:', message);
            return;
          }
          
          console.log('[MessagingService] ✅ Valid message, adding to enrichment batch:', {
            messageId: message.id,
            conversationId: message.conversation_id,
          });
          
          // Add to batch for enrichment
          pendingEnrichments.set(message.id, {
            message,
            conversationId: message.conversation_id,
            timestamp: Date.now(),
          });
          
          // Clear existing timer and set new one
          if (enrichmentTimer) {
            clearTimeout(enrichmentTimer);
          }
          enrichmentTimer = setTimeout(processEnrichments, ENRICHMENT_BATCH_DELAY);
          
          // Legacy support: if only callback function provided, call it
          if (typeof callbacks === 'function') {
            callbacks();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const message = payload.new as Message;
          normalizedCallbacks.onMessageUpdated?.(message.conversation_id, message);
          // Legacy support
          if (typeof callbacks === 'function') {
            callbacks();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
        },
        (payload) => {
          const conv = payload.new as Conversation;
          normalizedCallbacks.onConversationUpdated?.(conv.id, conv.updated_at);
          // Legacy support
          if (typeof callbacks === 'function') {
            callbacks();
          }
        }
      )
      .subscribe((status) => {
        console.log('[MessagingService] 📡 Subscription status changed:', status);
        if (status === 'SUBSCRIBED') {
          console.log('[MessagingService] ✅ Successfully subscribed to conversations_list channel');
          // Just connected/reconnected - trigger sync
          // This callback fires on initial connection and on reconnect
          normalizedCallbacks.onReconnect?.();
          // Legacy support
          if (typeof callbacks === 'function') {
            callbacks();
          }
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[MessagingService] ❌ Channel subscription error - check Realtime configuration');
        } else if (status === 'TIMED_OUT') {
          console.error('[MessagingService] ❌ Channel subscription timed out');
        } else if (status === 'CLOSED') {
          console.warn('[MessagingService] ⚠️ Channel subscription closed');
        }
      });

    // Reconnect detection is handled via:
    // 1. Channel subscription status callback (above) - fires on SUBSCRIBED status
    // 2. AppState listener in MessagingProvider - handles background → foreground transitions

    return () => {
      supabase.removeChannel(channel);
    };
  }

  /**
   * Get conversations updated since a timestamp (for reconnect sync)
   */
  async getConversationsUpdatedSince(lastSync: number): Promise<Conversation[]> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const lastSyncDate = new Date(lastSync).toISOString();

      // Get conversations updated since lastSync
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return [];
      }

      // Get all conversations where user is a member
      const { data: membershipData, error: membershipError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (membershipError) throw membershipError;

      const conversationIds = membershipData.map(m => m.conversation_id);

      if (conversationIds.length === 0) {
        return [];
      }

      // Get conversations updated since lastSync
      const { data: conversations, error: conversationsError } = await supabase
        .from('conversations')
        .select('id, title, is_direct, metadata, created_by, created_at, updated_at')
        .in('id', conversationIds)
        .gt('updated_at', lastSyncDate)
        .order('updated_at', { ascending: false });

      if (conversationsError) throw conversationsError;

      if (!conversations || conversations.length === 0) {
        return [];
      }

      // Enrich with last message and unread counts (reuse logic from getConversations)
      // This is a simplified version - full enrichment would be the same as getConversations
      const lastMessagesPromises = conversations.map(conv =>
        supabase
          .from('messages')
          .select('id, conversation_id, sender_id, body, rendered_body, attachments, is_system, edited, deleted, created_at, updated_at, type, image_metadata')
          .eq('conversation_id', conv.id)
          .eq('deleted', false)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      );
      const lastMessagesResults = await Promise.all(lastMessagesPromises);
      const lastMessagesMap = new Map<string, Message>();
      lastMessagesResults.forEach((result, index) => {
        if (result.data && conversations[index]) {
          lastMessagesMap.set(conversations[index].id, result.data);
        }
      });

      // Calculate unread counts
      const unreadCountPromises = conversations.map(conv => {
        const lastMessage = lastMessagesMap.get(conv.id);
        if (!lastMessage) return Promise.resolve(0);

        return supabase
          .from('conversation_members')
          .select('last_read_at')
          .eq('conversation_id', conv.id)
          .eq('user_id', user.id)
          .maybeSingle()
          .then(memberResult => {
            const lastReadAt = memberResult.data?.last_read_at || new Date(0).toISOString();
            return supabase
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .eq('conversation_id', conv.id)
              .eq('deleted', false)
              .neq('sender_id', user.id)
              .gt('created_at', lastReadAt)
              .then(result => result.count || 0);
          });
      });
      const unreadCounts = await Promise.all(unreadCountPromises);
      const unreadCountMap = new Map<string, number>();
      conversations.forEach((conv, index) => {
        unreadCountMap.set(conv.id, unreadCounts[index]);
      });

      // Build enriched conversations (simplified - full version would include members, etc.)
      return conversations.map(conv => ({
        ...conv,
        last_message: lastMessagesMap.get(conv.id),
        unread_count: unreadCountMap.get(conv.id) || 0,
      })) as Conversation[];
    } catch (error) {
      console.error('Error fetching conversations updated since:', error);
      throw error;
    }
  }

  /**
   * Get unread count for a conversation (authoritative calculation)
   */
  async getUnreadCount(conversationId: string): Promise<number> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;

      // Get last_read_at for this conversation
      const { data: member } = await supabase
        .from('conversation_members')
        .select('last_read_at')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();

      const lastReadAt = member?.last_read_at || new Date(0).toISOString();

      // Count messages after last_read_at (excluding own messages)
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('deleted', false)
        .neq('sender_id', user.id)
        .gt('created_at', lastReadAt);

      return count || 0;
    } catch (error) {
      console.error('Error calculating unread count:', error);
      return 0;
    }
  }
}

export const messagingService = new MessagingService();

