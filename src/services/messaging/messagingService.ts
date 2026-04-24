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
export type MessageType = 'text' | 'image' | 'video';

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

// Video metadata interface
export interface VideoMetadata {
  video_url: string;           // Compressed video URL (written by Lambda when MediaConvert finishes). Empty string until ready.
  original_url?: string;        // Presigned URL for the pre-compression original — lets the receiver play instantly while MediaConvert runs
  thumbnail_url?: string;       // Thumbnail frame URL
  duration: number;            // Duration in seconds
  width: number;               // Video width in pixels
  height: number;              // Video height in pixels
  file_size: number;           // File size in bytes
  mime_type: string;           // e.g., 'video/mp4'
  storage_path: string;        // S3 key path
}

// Snapshot of the message being replied to. Frozen at send time — edits to the
// original message don't mutate this snapshot (matches WhatsApp behavior).
export interface ReplyToSnapshot {
  message_id: string;
  sender_id: string;
  sender_name: string;
  type: MessageType;
  body?: string; // short label for media: 'Photo' | 'Video'
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

  // Video-specific fields (only populated for type='video')
  video_metadata?: VideoMetadata;

  // Legacy attachments array (keep for backward compatibility)
  attachments: any[];

  // Client-generated UUID for idempotent sends. Enforced unique per sender via
  // partial unique index messages_sender_client_id_idx. Null for legacy rows
  // predating the outbox. Populated by the send-path / outbox flush.
  client_id?: string | null;

  // Upload state (client-side only, not stored in DB)
  upload_state?: MessageUploadState;
  upload_progress?: number;     // 0-100, only during 'uploading'
  upload_error?: string;        // Error message if upload_state === 'failed'
  _localPreviewUri?: string;    // Local file URI used as fallback preview while upload is in flight
  
  // Existing fields
  is_system: boolean;
  edited: boolean;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  
  // Reply-to (WhatsApp-style quoted message). Snapshot is frozen at send time.
  reply_to_message_id?: string | null;
  reply_to_snapshot?: ReplyToSnapshot | null;

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

// Realtime subscription status (from Supabase channel .subscribe() callback)
export type RealtimeSubscriptionStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED';

// Subscription callbacks interface
export interface MessageSubscriptionCallbacks {
  onNewMessage?: (message: Message) => void;
  onMessageUpdated?: (message: Message) => void;
  onMessageDeleted?: (messageId: string) => void;
  onTyping?: (userId: string, isTyping: boolean) => void;
  onSubscriptionStatus?: (status: RealtimeSubscriptionStatus) => void;
  onReadReceiptUpdate?: (userId: string, lastReadAt: string | null) => void;
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
  private activeSubscriptions = new Map<string, () => void>();
  // Single source of truth: one channel per conversation (created before subscribe, used for messages + typing)
  private activeChannels = new Map<string, ReturnType<typeof supabase.channel>>();
  // Track typing state per conversation
  private typingState = new Map<string, Map<string, number>>(); // conversationId -> userId -> timestamp
  // Rate limiting for typing indicators (500ms)
  private lastTypingEvent = new Map<string, number>(); // conversationId -> timestamp
  // Per-conversation list subscriptions (separate from DM-screen channels above).
  // Used by MessagingProvider to reliably receive INSERT/UPDATE/DELETE events
  // for every conv in state, bypassing the RLS quirk of the unfiltered
  // conversations_list channel. Keyed by conversationId.
  private listSubscriptions = new Map<string, () => void>();

  /**
   * Get or create the Realtime channel for a conversation. Creates and stores the channel only if it
   * does not exist (pending map). Used by subscribeToMessages so one channel is shared for
   * postgres_changes and broadcast typing. Returns the same instance every time for that conversationId.
   */
  private getOrCreateConversationChannel(conversationId: string) {
    let channel = this.activeChannels.get(conversationId);
    if (channel) return channel;
    channel = supabase.channel(`messages:${conversationId}`);
    this.activeChannels.set(conversationId, channel);
    return channel;
  }

  /**
   * Get existing channel for a conversation. Does not create. Used by startTyping/stopTyping so
   * they never create a second channel—they only send on the channel from subscribeToMessages.
   */
  private getChannel(conversationId: string): ReturnType<typeof supabase.channel> | undefined {
    return this.activeChannels.get(conversationId);
  }

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
        .select('id, conversation_id, sender_id, body, rendered_body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, reply_to_message_id, reply_to_snapshot')
        .eq('conversation_id', conversationId)
        // Note: We include deleted messages so they can be displayed with "deleted" placeholder
        .gt('updated_at', lastSyncDate)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) throw error;

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

      // For afterMessageId (incremental sync): ascending order to get messages after cursor
      // For initial load and beforeMessageId (pagination): descending order to get newest messages first
      const useAscending = !!afterMessageId;

      let query = supabase
        .from('messages')
        .select('id, conversation_id, sender_id, body, rendered_body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, reply_to_message_id, reply_to_snapshot')
        .eq('conversation_id', conversationId)
        // Note: We include deleted messages so they can be displayed with "deleted" placeholder
        .order('created_at', { ascending: useAscending })
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

      if (!messages || messages.length === 0) {
        return { messages: [], hasMore: false };
      }

      // Check if there are more messages (if we got limit+1, there are more)
      const hasMore = messages.length > limit;
      let paginatedMessages: typeof messages;
      if (hasMore) {
        if (useAscending) {
          // Ascending: extra message is at the end, drop it
          paginatedMessages = messages.slice(0, limit);
        } else {
          // Descending: extra message is the oldest (at the end), drop it
          paginatedMessages = messages.slice(0, limit);
        }
      } else {
        paginatedMessages = messages;
      }

      // For descending queries, reverse to chronological order (oldest first)
      if (!useAscending) {
        paginatedMessages = paginatedMessages.reverse();
      }

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
   * Send a message in a conversation.
   * When `clientId` is provided the insert is idempotent via the partial unique
   * index messages_sender_client_id_idx — retries of the same (sender_id,
   * client_id) are absorbed as no-ops so flaky networks cannot create duplicates.
   */
  async sendMessage(
    conversationId: string,
    body: string,
    attachments: any[] = [],
    type: MessageType = 'text',
    clientId?: string,
    replyTo?: ReplyToSnapshot | null
  ): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Prefer the cached session (synchronous, no network). getUser() does a
      // round-trip to /auth/v1/user and can return null on a transient network
      // blip even though the user is logged in — that caused the outbox retry
      // to throw "Not authenticated" spuriously. Fall back to getUser only if
      // the session cache is empty.
      let senderId: string | undefined;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        senderId = session.user.id;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.log('[messagingService] No user - auth guard will handle redirect');
          throw new Error('Not authenticated'); // auth guard will catch
        }
        senderId = user.id;
      }

      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: senderId,
        body,
        attachments,
        type: type || 'text',
      };
      if (clientId) payload.client_id = clientId;
      if (replyTo) {
        payload.reply_to_message_id = replyTo.message_id;
        payload.reply_to_snapshot = replyTo;
      }

      let data: Message | null = null;

      if (clientId) {
        // Idempotent path: ON CONFLICT DO NOTHING. If the row already exists
        // (retry landed twice), maybeSingle returns null and we fetch the
        // winning row so callers still get a usable Message object.
        const { data: upserted, error } = await supabase
          .from('messages')
          .upsert(payload, { onConflict: 'sender_id,client_id', ignoreDuplicates: true })
          .select()
          .maybeSingle();

        if (error) throw error;

        if (upserted) {
          data = upserted as Message;
        } else {
          const { data: existing, error: fetchErr } = await supabase
            .from('messages')
            .select()
            .eq('sender_id', senderId)
            .eq('client_id', clientId)
            .single();
          if (fetchErr) throw fetchErr;
          data = existing as Message;
        }
      } else {
        const { data: inserted, error } = await supabase
          .from('messages')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        data = inserted as Message;
      }

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
   * Create a video message record in the database (metadata populated after upload)
   */
  async createVideoMessage(conversationId: string, caption?: string): Promise<Message> {
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
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          type: 'video',
          body: caption || null,
          video_metadata: null,
        })
        .select()
        .single();

      if (error) throw error;

      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      return data;
    } catch (error) {
      console.error('Error creating video message:', error);
      throw error;
    }
  }

  /**
   * Update video message with metadata after upload completes
   */
  async updateVideoMessageMetadata(messageId: string, videoMetadata: VideoMetadata): Promise<Message> {
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
          video_metadata: videoMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
        .eq('sender_id', user.id)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        await supabase
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', data.conversation_id);
      }

      return data;
    } catch (error) {
      console.error('Error updating video message metadata:', error);
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
      const lastReadAt = new Date().toISOString();
      const { error } = await supabase
        .from('conversation_members')
        .update({
          last_read_message_id: targetMessageId,
          last_read_at: lastReadAt,
        })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);

      if (error) throw error;

      // Also broadcast the receipt update on the conversation channel. This is a
      // faster, more reliable path than postgres_changes — the peer sees the blue
      // tick the moment we mark the conversation as read, without waiting for
      // replication to fan out. postgres_changes is still wired as a fallback for
      // clients that subscribe after the broadcast fires.
      const channel = this.getChannel(conversationId);
      if (channel) {
        try {
          await channel.send({
            type: 'broadcast',
            event: 'read_receipt',
            payload: { userId: user.id, lastReadAt },
          });
        } catch (broadcastError) {
          console.warn('[messagingService] read_receipt broadcast failed:', broadcastError);
        }
      }
    } catch (error) {
      console.error('Error marking as read:', error);
      throw error;
    }
  }

  /**
   * Fetch a specific member's last_read_at for a conversation.
   * Used to derive per-message read receipts (whether the other user has read up to a given message).
   */
  async getMemberLastReadAt(conversationId: string, userId: string): Promise<string | null> {
    if (!isSupabaseConfigured()) return null;
    try {
      const { data, error } = await supabase
        .from('conversation_members')
        .select('last_read_at')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.warn('[messagingService] getMemberLastReadAt error:', error);
        return null;
      }
      return data?.last_read_at ?? null;
    } catch (error) {
      console.error('[messagingService] getMemberLastReadAt failed:', error);
      return null;
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

    // Single channel per conversation: get or create (stored immediately so startTyping/stopTyping use same instance)
    const channel = this.getOrCreateConversationChannel(conversationId);

    channel
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

          if (__DEV__) {
            console.log('[MessagingService] INSERT payload keys:', Object.keys(payload.new ?? {}));
          }

          // CRITICAL: Check if payload is missing the type field or client_id key.
          // Supabase Realtime payloads should include all columns, but we verify to ensure data integrity.
          // image_metadata can be null for image messages (during upload), so we only check the type field.
          // client_id is checked with `in` (not `== null`) because legacy rows pre-outbox have
          // client_id=null — the key is present with null value. We only refetch when the key is
          // absent entirely (symptom of a publication that pre-dates the column).
          const needsFullFetch =
            newMessage.type === undefined ||
            !('client_id' in newMessage);
          
          if (needsFullFetch) {
            // Fetch full message from database to ensure all fields are present
            try {
              const { data: fullMessage, error } = await supabase
                .from('messages')
                .select('id, conversation_id, sender_id, body, rendered_body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, reply_to_message_id, reply_to_snapshot')
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
              .select('id, conversation_id, sender_id, body, rendered_body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, reply_to_message_id, reply_to_snapshot')
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
      // Handle read-receipt updates (conversation_members.last_read_at changes).
      // Fires when the other participant opens the conversation and markAsRead updates their row.
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_members',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { user_id: string; last_read_at: string | null };
          if (normalizedCallbacks.onReadReceiptUpdate && row?.user_id) {
            normalizedCallbacks.onReadReceiptUpdate(row.user_id, row.last_read_at ?? null);
          }
        }
      )
      // Fast realtime path for read receipts — markAsRead broadcasts on the same
      // channel. This arrives in milliseconds regardless of postgres replication lag.
      .on(
        'broadcast',
        { event: 'read_receipt' },
        (payload) => {
          const { userId, lastReadAt } = (payload.payload ?? {}) as {
            userId?: string;
            lastReadAt?: string | null;
          };
          if (normalizedCallbacks.onReadReceiptUpdate && userId) {
            normalizedCallbacks.onReadReceiptUpdate(userId, lastReadAt ?? null);
          }
        }
      )
      // Handle typing indicators via broadcast (event-driven, no polling)
      .on(
        'broadcast',
        { event: 'typing' },
        (payload) => {
          const { userId, isTyping } = payload.payload as { userId: string; isTyping: boolean };
          
          // Track typing state
          const conversationTypingState = this.typingState.get(conversationId);
          if (conversationTypingState) {
            if (isTyping) {
              conversationTypingState.set(userId, Date.now());
            } else {
              conversationTypingState.delete(userId);
            }
          }
          
          // Event-driven cleanup: Check for stale entries when processing events
          if (conversationTypingState) {
            const now = Date.now();
            conversationTypingState.forEach((timestamp, uid) => {
              if (now - timestamp > 3000) {
                conversationTypingState.delete(uid);
                if (normalizedCallbacks.onTyping) {
                  normalizedCallbacks.onTyping(uid, false);
                }
              }
            });
          }
          
          if (__DEV__) {
            console.log('[MessagingService] Typing received', { conversationId, userId, isTyping });
          }
          // Notify callback
          if (normalizedCallbacks.onTyping) {
            normalizedCallbacks.onTyping(userId, isTyping);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to messages for conversation ${conversationId}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`Error subscribing to messages for conversation ${conversationId}`);
          this.activeChannels.delete(conversationId);
        }
        normalizedCallbacks.onSubscriptionStatus?.(status as RealtimeSubscriptionStatus);
      });

    // Note: Typing cleanup is now event-driven (handled in broadcast event handler above)
    // No polling interval needed - cleanup happens when processing typing events

    const unsubscribe = () => {
      supabase.removeChannel(channel);
      this.activeSubscriptions.delete(conversationId);
      this.activeChannels.delete(conversationId);
      this.typingState.delete(conversationId);
      this.lastTypingEvent.delete(conversationId);
    };

    this.activeSubscriptions.set(conversationId, unsubscribe);
    return unsubscribe;
  }

  /**
   * Start typing indicator (with rate limiting). Uses the same channel as subscribeToMessages;
   * never creates a second channel.
   */
  async startTyping(conversationId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const channel = this.getChannel(conversationId);
      if (!channel) return; // No channel until subscribeToMessages has run (e.g. DM screen open)

      // Rate limiting: max 1 event per 500ms
      const lastEvent = this.lastTypingEvent.get(conversationId) || 0;
      const now = Date.now();
      if (now - lastEvent < 500) {
        return;
      }
      this.lastTypingEvent.set(conversationId, now);

      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: user.id, isTyping: true },
      });
      if (__DEV__) {
        console.log('[MessagingService] Typing sent', { conversationId, userId: user.id });
      }
    } catch (error) {
      console.error('Error sending typing indicator:', error);
    }
  }

  /**
   * Stop typing indicator. Uses the same channel as subscribeToMessages; never creates a second channel.
   */
  async stopTyping(conversationId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const channel = this.getChannel(conversationId);
      if (!channel) return;

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
   * Filtered per-conversation subscription for the conversations list.
   *
   * Why a second subscription layer exists: the unfiltered `conversations_list`
   * channel (see subscribeToConversations below) has documented RLS delivery
   * issues — peer events for conversations the user isn't actively viewing are
   * sometimes dropped. Filtered channels (conversation_id=eq.{id}) deliver
   * reliably, so MessagingProvider runs one of these per conv in state to
   * guarantee list preview / unread count / ordering updates.
   *
   * Channel name is intentionally distinct from subscribeToMessages'
   * `messages:{id}` so a DM screen subscription and a list subscription can
   * coexist on the same conversation without clobbering each other.
   */
  subscribeToConversationListUpdates(
    conversationId: string,
    callbacks: {
      onNewMessage?: (conversationId: string, message: Message) => void;
      onMessageUpdated?: (conversationId: string, message: Message) => void;
      onMessageDeleted?: (conversationId: string, messageId: string) => void;
    }
  ): () => void {
    if (!isSupabaseConfigured()) {
      return () => {};
    }

    const existing = this.listSubscriptions.get(conversationId);
    if (existing) {
      existing();
    }

    const channel = supabase
      .channel(`list:messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const message = payload.new as Message;
          if (!message?.id || !message.conversation_id || !message.created_at) return;
          callbacks.onNewMessage?.(conversationId, message);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const message = payload.new as Message;
          if (!message?.id) return;
          callbacks.onMessageUpdated?.(conversationId, message);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const messageId = (payload.old as { id?: string } | undefined)?.id;
          if (!messageId) return;
          callbacks.onMessageDeleted?.(conversationId, messageId);
        }
      )
      .subscribe((status) => {
        if (__DEV__ && status !== 'SUBSCRIBED') {
          console.log(`[MessagingService] list:messages:${conversationId} status: ${status}`);
        }
      });

    const unsubscribe = () => {
      supabase.removeChannel(channel);
      this.listSubscriptions.delete(conversationId);
    };
    this.listSubscriptions.set(conversationId, unsubscribe);
    return unsubscribe;
  }

  /**
   * Reset all in-memory state (called on logout).
   * Unsubscribes from every active channel, then clears all maps.
   */
  resetAll(): void {
    // Unsubscribe from all active channels
    this.activeSubscriptions.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (e) {
        console.warn('[MessagingService] Error during unsubscribe in resetAll:', e);
      }
    });
    this.activeSubscriptions.clear();
    this.activeChannels.clear();
    this.typingState.clear();
    this.lastTypingEvent.clear();
    this.listSubscriptions.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (e) {
        console.warn('[MessagingService] Error during list unsubscribe in resetAll:', e);
      }
    });
    this.listSubscriptions.clear();
    console.log('[MessagingService] All in-memory state reset');
  }

  /**
   * Clear all messages in a conversation (client-side delete).
   * Deletes messages from the database for the current user.
   */
  async clearConversationMessages(conversationId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId);

      if (error) {
        console.error('[MessagingService] Error clearing messages:', error);
        throw error;
      }

      // Also clear the local cache so messages don't reappear
      try {
        const { chatHistoryCache } = await import('./chatHistoryCache');
        chatHistoryCache.clearConversation(conversationId);
      } catch (cacheErr) {
        console.warn('[MessagingService] Error clearing cache:', cacheErr);
      }

      console.log(`[MessagingService] Cleared messages for conversation ${conversationId}`);
    } catch (error) {
      console.error('[MessagingService] Error in clearConversationMessages:', error);
      throw error;
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
        .select('id, sender_id, created_at, is_system, type')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .eq('sender_id', user.id)
        .single();

      if (fetchError || !existingMessage) {
        throw new Error('Message not found or you do not have permission to edit it');
      }

      // Prevent editing system messages
      if (existingMessage.is_system) {
        throw new Error('System messages cannot be edited');
      }

      // Prevent empty body for text messages
      if (!newBody.trim() && existingMessage.type === 'text') {
        throw new Error('Message body cannot be empty');
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
    console.log('[messagingService] deleteMessage called', { conversationId, messageId });
    
    if (!isSupabaseConfigured()) {
      console.error('[messagingService] Supabase not configured');
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('[messagingService] User not authenticated');
        throw new Error('Not authenticated');
      }

      console.log('[messagingService] Checking message ownership', {
        messageId,
        conversationId,
        userId: user.id,
      });

      // Check if message exists and belongs to user
      const { data: existingMessage, error: fetchError } = await supabase
        .from('messages')
        .select('id, sender_id, is_system')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .eq('sender_id', user.id)
        .single();

      if (fetchError || !existingMessage) {
        console.error('[messagingService] Message not found or permission denied', {
          messageId,
          conversationId,
          userId: user.id,
          error: fetchError,
        });
        throw new Error('Message not found or you do not have permission to delete it');
      }

      console.log('[messagingService] Message found', {
        messageId,
        isSystem: existingMessage.is_system,
        senderId: existingMessage.sender_id,
      });

      // Prevent deleting system messages
      if (existingMessage.is_system) {
        console.error('[messagingService] Attempted to delete system message', { messageId });
        throw new Error('System messages cannot be deleted');
      }

      console.log('[messagingService] Performing soft delete', { messageId, conversationId });

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

      if (deleteError) {
        console.error('[messagingService] Error updating message to deleted', {
          messageId,
          conversationId,
          error: deleteError,
        });
        throw deleteError;
      }

      console.log('[messagingService] Message soft deleted successfully', { messageId });

      // Update conversation's updated_at
      console.log('[messagingService] Updating conversation timestamp', { conversationId });
      const { error: conversationUpdateError } = await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      if (conversationUpdateError) {
        console.error('[messagingService] Error updating conversation timestamp', {
          conversationId,
          error: conversationUpdateError,
        });
        // Don't throw - conversation update is not critical
      } else {
        console.log('[messagingService] Conversation timestamp updated', { conversationId });
      }

      console.log('[messagingService] deleteMessage completed successfully', { messageId, conversationId });
    } catch (error) {
      console.error('[messagingService] Error in deleteMessage:', error);
      console.error('[messagingService] Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        conversationId,
        messageId,
      });
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

    // NOTE: Previously this channel also subscribed to unfiltered INSERT / UPDATE
    // on public.messages. That forced Supabase Realtime to evaluate the RLS
    // policy `is_user_conversation_member()` for every message in the whole DB
    // on behalf of this client, which destabilized the socket under load —
    // cascading CHANNEL_ERROR / TIMED_OUT across every channel on the same
    // connection (presence, per-conv list subs, DM subs).
    //
    // Those events are fully covered by the per-conversation channels set up
    // in MessagingProvider via subscribeToConversationListUpdates (see
    // `list:messages:${conversationId}` above). They use a cheap
    // `conversation_id=eq.<id>` filter, so the RLS evaluation scope stays
    // proportional to the user's own conversations instead of the whole table.
    //
    // This channel now only listens to `public.conversations` UPDATEs, which
    // is ~1 row per conversation and harmless at table scope.
    const channel = supabase
      .channel('conversations_list')
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
   * Subscribe to new-conversation discovery for the current user.
   *
   * When another user creates a conversation that includes this user (e.g.
   * starts a new DM), the server inserts a row into `conversation_members`
   * with this user's id. Subscribing to that INSERT — filtered on the user
   * id — lets the client react in real time and load the new conversation
   * without waiting for reconnect / foreground.
   *
   * This replaces the discovery path that used to live inside the old
   * unfiltered `messages` INSERT handler on `conversations_list`. That
   * unfiltered subscription destabilized the realtime socket because
   * Supabase had to evaluate the RLS policy on every message for every
   * user; scoping discovery to a one-row-per-user filter avoids the RLS
   * cost entirely.
   *
   * Requires `conversation_members` to be in the supabase_realtime
   * publication (see migration 20260422000000).
   */
  subscribeToNewConversations(
    userId: string,
    onConversationAdded: (conversationId: string) => void
  ): () => void {
    if (!isSupabaseConfigured() || !userId) {
      return () => {};
    }

    const channel = supabase
      .channel(`new_conversations:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_members',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const convId = (payload.new as { conversation_id?: string } | undefined)?.conversation_id;
          if (convId) onConversationAdded(convId);
        }
      )
      .subscribe((status) => {
        if (__DEV__ && status !== 'SUBSCRIBED') {
          console.log(`[MessagingService] new_conversations:${userId} status: ${status}`);
        }
      });

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
      // Note: We include deleted messages so they can be displayed with "deleted" placeholder
      const lastMessagesPromises = conversations.map(conv =>
        supabase
          .from('messages')
          .select('id, conversation_id, sender_id, body, rendered_body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, reply_to_message_id, reply_to_snapshot')
          .eq('conversation_id', conv.id)
          // Note: We include deleted messages so they can be displayed with "deleted" placeholder
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

