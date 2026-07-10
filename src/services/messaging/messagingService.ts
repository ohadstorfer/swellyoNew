import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { getRealtimeMode, conversationTopic, userInboxTopic } from './realtimeMode';
import { withTimeout } from './withTimeout';

/**
 * Messaging Service
 * Handles all conversation and messaging operations with Supabase
 */

// --- Realtime-migration (broadcast) types ---
// `op` is the DB op for message events ('INSERT'|'UPDATE'|'DELETE') or 'member_added'
// for the new-conversation event (conversation_members INSERT). message_id is absent
// for member_added — the handler only needs conversation_id either way.
export type InboxEvent = { conversation_id: string; message_id?: string; op: string };
export type InboxIntent = { kind: 'touch'; conversationId: string; messageId?: string };

/**
 * Pure mapper: converts a raw user-inbox broadcast payload into an intent the
 * provider can act on, or null if the payload is malformed. No side effects.
 * Only conversation_id is required (message_id is absent for new-conversation events).
 */
export function inboxEventToIntent(e: InboxEvent): InboxIntent | null {
  if (!e || !e.conversation_id) return null;
  return { kind: 'touch', conversationId: e.conversation_id, messageId: e.message_id };
}

// Conversation interface
export interface Conversation {
  id: string;
  title?: string;
  is_direct: boolean;
  direct_pair_key?: string | null;
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
  joined_at: string;
  last_read_message_id?: string;
  last_read_at?: string;
  preferences: any;
  // Enriched from users table
  name?: string;
  profile_image_url?: string;
  email?: string;
}

// Mute sentinel for "Always" — far-future timestamp stored in preferences.muted_until.
// WhatsApp's "Always" maps to this; auto-expiration logic still works (a real expiry
// in the past would naturally pass), so callers don't need a special case.
export const MUTE_ALWAYS_UNTIL = new Date('2099-01-01T00:00:00.000Z');

const SEND_TIMEOUT_MS = 30000; // matches the new-conversation timeout already used in the screens

// Message type
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'commitment_request' | 'file' | 'contact';

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

// Audio (voice message) metadata interface
export interface AudioMetadata {
  audio_url: string;           // Public URL from Supabase Storage
  storage_path: string;        // Path in message-images bucket: {convId}/{msgId}/audio.m4a
  duration_ms: number;         // Recording duration in milliseconds
  waveform: number[];          // Decimated amplitude samples (0..1), ~50 entries
  mime_type: string;           // e.g., 'audio/m4a', 'audio/mp4'
  size_bytes: number;          // File size
}

// File attachment metadata. Carried on messages of type 'file'. The bytes live
// in the private S3 prefix message-files/{convId}/{msgId}/file.<ext>; reads go
// through a short-lived, membership-checked presigned GET (never a public URL).
export interface FileMetadata {
  storage_path: string;        // message-files/{convId}/{msgId}/file.<ext>
  display_name: string;        // sanitized original filename (UI only, never used in the key)
  mime_type: string;           // e.g. 'application/pdf'
  ext: string;                 // lowercased extension, no dot
  size_bytes: number;          // File size in bytes
}

// Shared-contact metadata. Carried on messages of type 'contact'. Stored inline
// on the row (no upload). Display-only in v1 — numbers are tap-to-copy.
export interface ContactMetadata {
  display_name: string;
  phone_numbers: { label?: string; number: string }[];
  emails?: { label?: string; email: string }[];
}

// Commitment-request metadata. Carried on messages of type 'commitment_request'
// to render the structured "X requested to be Committed" bubble in chat and to
// power the host's Review-bar Approve flow.
export interface CommitmentMetadata {
  trip_id: string;
  request_id: string;
  trip_title?: string | null;
  items: string[];             // e.g. ['flight_booked', 'accommodation_booked', 'something_else']
  note?: string | null;
  status?: 'pending' | 'approved' | 'declined' | 'superseded'; // mirrors group_trip_commitment_requests.status
}

// Snapshot of the message being replied to. Frozen at send time — edits to the
// original message don't mutate this snapshot (matches WhatsApp behavior).
export interface ReplyToSnapshot {
  message_id: string;
  sender_id: string;
  sender_name: string;
  type: MessageType;
  body?: string; // short label for media: 'Photo' | 'Video' | 'Voice message'
}

// Message interface
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  
  // Message type and content
  type?: MessageType;           // 'text' | 'image' (defaults to 'text' for backward compatibility)
  body?: string;                // Text content (for text messages or image captions)

  // Image-specific fields (only populated for type='image')
  image_metadata?: ImageMetadata;

  // Video-specific fields (only populated for type='video')
  video_metadata?: VideoMetadata;

  // Audio-specific fields (only populated for type='audio')
  audio_metadata?: AudioMetadata | null;

  // Commitment-request fields (only populated for type='commitment_request')
  commitment_metadata?: CommitmentMetadata | null;

  // File-attachment fields (only populated for type='file')
  file_metadata?: FileMetadata | null;

  // Shared-contact fields (only populated for type='contact')
  contact_metadata?: ContactMetadata | null;

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

  // WhatsApp-style emoji reactions. Aggregated for UI; one entry per distinct emoji.
  reactions?: AggregatedReaction[];

  // Enriched from users/surfers
  sender_name?: string;
  sender_avatar?: string;
  sender?: {
    name?: string;
    avatar?: string;
  };
}

// Raw reaction row from the message_reactions table.
// PK is (message_id, user_id) — one reaction per user per message.
export interface MessageReaction {
  message_id: string;
  user_id: string;
  reaction: string;
  reacted_at: string;
}

// Aggregated view used by the UI: one entry per distinct emoji on a message.
export interface AggregatedReaction {
  emoji: string;
  count: number;
  userIds: string[];
  hasMine: boolean;
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
  // Fires when a conversation_members row is inserted or deleted — used by
  // group-chat headers / detail screens to refresh the live participant list
  // when someone joins, leaves, or is removed.
  onMembersChanged?: () => void;
  // Fires when a conversation_members row's role column changes (promote /
  // demote). Read receipts ride on the same UPDATE event but only touch
  // last_read_at, so we surface role separately to avoid spurious refetches.
  onRoleChanged?: (userId: string, newRole: string | null) => void;
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
  // Consolidated "list updates" channels (see subscribeToConversationListUpdatesBatch).
  // Replaces the old one-channel-per-conversation approach, which put ~3×N
  // postgres_changes bindings on a single websocket and destabilized the socket
  // past ~50 conversations (cascading CHANNEL_ERROR).
  private listBatchChannels: ReturnType<typeof supabase.channel>[] = [];
  private listBatchSeq = 0;
  // Log a realtime channel error only ONCE per down-episode (cleared on SUBSCRIBED),
  // so a dead websocket can't spam the console with identical CHANNEL_ERROR lines.
  private realtimeErrorLogged = new Set<string>();

  /**
   * Log a realtime CHANNEL_ERROR/TIMED_OUT once per down-episode. The first failure
   * for a given key warns; repeats are suppressed until clearRealtimeError(key) runs
   * (on SUBSCRIBED). Keeps the signal, kills the redbox storm when the socket is dead.
   */
  private logRealtimeErrorOnce(key: string, message: string): void {
    if (this.realtimeErrorLogged.has(key)) return;
    this.realtimeErrorLogged.add(key);
    console.warn(message);
  }

  private clearRealtimeError(key: string): void {
    this.realtimeErrorLogged.delete(key);
  }

  /**
   * Get or create the Realtime channel for a conversation. Creates and stores the channel only if it
   * does not exist (pending map). Used by subscribeToMessages so one channel is shared for
   * postgres_changes and broadcast typing. Returns the same instance every time for that conversationId.
   */
  private getOrCreateConversationChannel(conversationId: string) {
    let channel = this.activeChannels.get(conversationId);
    if (channel) return channel;
    // In legacy mode the channel is created exactly as before (public).
    // In shadow/broadcast modes it must be a private channel so the DB
    // trigger's broadcasts (sent to a private topic) can be received.
    channel =
      getRealtimeMode() !== 'legacy'
        ? supabase.channel(conversationTopic(conversationId), { config: { private: true } })
        : supabase.channel(`messages:${conversationId}`);
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
      const tStart = Date.now();
      let tPrev = tStart;
      const stageTimes: string[] = [];
      const markStage = (label: string) => {
        const now = Date.now();
        stageTimes.push(`${label}=${now - tPrev}ms`);
        tPrev = now;
      };

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
      markStage('auth');

      // Get ALL conversation IDs the user is a member of. We can't paginate on
      // conversation_members directly because its natural sort (joined_at) does
      // not reflect activity — a user who joined many group chats recently can
      // push older but actively-used direct chats off page 1, hiding them in
      // the UI. We page on conversations.updated_at instead.
      const { data: membershipData, error: membershipError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (membershipError) throw membershipError;
      markStage('memberships');

      const allMemberConversationIds = (membershipData || []).map(m => m.conversation_id);

      if (allMemberConversationIds.length === 0) {
        return { conversations: [], hasMore: false };
      }

      // OPTIMIZATION 1: Get conversation details ordered by recent activity,
      // with pagination applied here (not on memberships).
      const { data: pagedConversations, error: conversationsError } = await supabase
        .from('conversations')
        .select('id, title, is_direct, metadata, created_by, created_at, updated_at')
        .in('id', allMemberConversationIds)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit); // inclusive-inclusive → up to limit+1

      if (conversationsError) throw conversationsError;
      markStage('page');

      const receivedCount = pagedConversations?.length || 0;
      const hasMore = receivedCount > limit;
      const conversations = pagedConversations ? pagedConversations.slice(0, limit) : [];

      if (!conversations || conversations.length === 0) {
        return { conversations: [], hasMore: false };
      }

      const enrichedConversations = await this.enrichConversations(conversations, user, markStage);

      if (__DEV__) {
        console.log(`[messagingService] getConversations stages: total=${Date.now() - tStart}ms :: ${stageTimes.join(' ')}`);
      }

      return { conversations: enrichedConversations, hasMore };
    } catch (error) {
      console.error('Error fetching conversations:', error);
      throw error;
    }
  }

  /**
   * Batched enrichment shared by getConversations and getConversationsUpdatedSince.
   *
   * Given a list of bare conversation rows (id, title, is_direct, metadata,
   * created_by, created_at, updated_at) and the current user, this issues the
   * BATCHED set of queries:
   *   - rpc('get_last_messages_per_conversation', { conv_ids }) — exactly one call
   *   - all-members of the page (.in)
   *   - current user's read state (.in)
   *   - users + surfers profile lookups (.in)
   *   - ONE capped unread query (.in, UNREAD_MESSAGES_LIMIT), counted in JS
   * and returns the full Conversation shape (last_message, unread_count,
   * unread_truncated, other_user, members). No per-conversation round-trips.
   *
   * @param markStage optional timing hook (used by getConversations only)
   */
  private async enrichConversations(
    conversations: Array<{ id: string; is_direct?: boolean; updated_at?: string } & Record<string, any>>,
    user: { id: string },
    markStage?: (label: string) => void,
  ): Promise<Conversation[]> {
    const conversationIds = conversations.map(c => c.id);

    // Queries 5, 6, 7 each depend only on conversationIds — run them
    // concurrently. Supabase builders resolve {data, error} and never
    // reject, so Promise.all cannot short-circuit and each error keeps
    // its original non-fatal handling below. Array order intentionally
    // matches the old sequential order (conversation_members is queried
    // twice; relative order is observable).
    const [lastMessagesRes, allMembersRes, userMemberRes] = await Promise.all([
      supabase
        .rpc('get_last_messages_per_conversation', {
          conv_ids: conversationIds
        }),
      supabase
        .from('conversation_members')
        .select('conversation_id, user_id, role, joined_at, last_read_message_id, last_read_at, preferences')
        .in('conversation_id', conversationIds),
      supabase
        .from('conversation_members')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id)
        .in('conversation_id', conversationIds),
    ]);
    const { data: lastMessages, error: messagesError } = lastMessagesRes;
    const { data: allMembersData, error: allMembersError } = allMembersRes;
    const { data: userMemberData, error: userMemberError } = userMemberRes;
    markStage?.('lastMessages+members+readState');

    // OPTIMIZATION 2 (processing): one last message per conversation (the most recent)
    // Much more efficient and reliable than fetching many messages and filtering in JavaScript
    // Solves the issue where only the first few conversations show last message text
    if (messagesError) {
      console.error('Error fetching last messages:', messagesError);
    }

    // Convert array to Map for easy lookup
    // RPC already returns exactly one message per conversation, so no need for deduplication.
    // The RPC RETURNS TABLE exposes image_metadata/video_metadata/audio_metadata/
    // commitment_metadata, so spreading each row carries those previews through.
    const lastMessagesMap = new Map<string, Message>();
    if (lastMessages && lastMessages.length > 0) {
      lastMessages.forEach((msg: Message) => {
        lastMessagesMap.set(msg.conversation_id, msg);
      });
    }

    // OPTIMIZATION 3 (processing): member data for all conversations
    if (allMembersError) {
      console.error('Error fetching all members:', allMembersError);
    }

    // OPTIMIZATION 3.5: Extract user IDs early and fetch user data in parallel with other queries
    const allUserIds = new Set<string>();
    (allMembersData || []).forEach(member => {
      allUserIds.add(member.user_id);
    });
    const userIdsArray = Array.from(allUserIds);

    // OPTIMIZATION 4 (processing): current user's read status
    if (userMemberError) {
      console.error('Error fetching user member data:', userMemberError);
    }

    const userReadMap = new Map<string, string | null>();
    (userMemberData || []).forEach(member => {
      userReadMap.set(member.conversation_id, member.last_read_at);
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

    // Queries 8 (profiles, needs userIds from q6) and 9 (unreads, needs
    // cutoff from q7) are independent of each other — run concurrently.
    const [usersResult, surfersResult, unreadResult] = await Promise.all([
      supabase
        .from('users')
        .select('id, email')
        .in('id', userIdsArray),
      supabase
        .from('surfers')
        .select('user_id, name, profile_image_url')
        .in('user_id', userIdsArray),
      supabase
        .from('messages')
        .select('id, conversation_id, sender_id, created_at')
        .in('conversation_id', conversationIds)
        .eq('deleted', false)
        .neq('sender_id', user.id)
        .gt('created_at', cutoffDate)
        .limit(UNREAD_MESSAGES_LIMIT),
    ]);
    const { data: unreadMessages, error: unreadError } = unreadResult;
    markStage?.('profiles+unread');

    const usersData = usersResult.data || [];
    const surfersData = surfersResult.data || [];

    // Create lookup maps early (before unread counts calculation)
    const usersMap = new Map(usersData.map(u => [u.id, u]));
    const surfersMap = new Map(surfersData.map(s => [s.user_id, s]));

    // OPTIMIZATION 6 (processing): count unread messages per conversation in
    // JavaScript (fetched above in a SINGLE query instead of N queries)
    const unreadCountMap = new Map<string, number>();

    // Initialize all conversations with 0 unread
    conversations.forEach(conv => {
      unreadCountMap.set(conv.id, 0);
    });

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

    return enrichedConversations as Conversation[];
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
        .select('id, conversation_id, sender_id, body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, audio_metadata, commitment_metadata, reply_to_message_id, reply_to_snapshot')
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
        .select('id, conversation_id, sender_id, body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, audio_metadata, commitment_metadata, reply_to_message_id, reply_to_snapshot')
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
   * Fetch a window of messages centered on a target: `span` older + the target
   * + `span` newer, chronological, sender-enriched. Used by reply-jump to
   * re-anchor the in-memory window (Telegram-style "jump to message").
   */
  async getMessagesAround(
    conversationId: string,
    targetMessageId: string,
    span: number = 20
  ): Promise<{ messages: Message[]; hasMoreOlder: boolean }> {
    if (!isSupabaseConfigured()) throw new Error('Supabase is not configured');
    const cols = 'id, conversation_id, sender_id, body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, audio_metadata, commitment_metadata, reply_to_message_id, reply_to_snapshot';
    try {
      const { data: target } = await supabase
        .from('messages').select('created_at').eq('id', targetMessageId).single();
      if (!target) return { messages: [], hasMoreOlder: false };

      const { data: olderDesc } = await supabase
        .from('messages').select(cols)
        .eq('conversation_id', conversationId)
        .lte('created_at', target.created_at)
        .order('created_at', { ascending: false })
        .limit(span + 1);

      const { data: newerAsc } = await supabase
        .from('messages').select(cols)
        .eq('conversation_id', conversationId)
        .gt('created_at', target.created_at)
        .order('created_at', { ascending: true })
        .limit(span);

      const hasMoreOlder = (olderDesc?.length ?? 0) > span;
      const olderTrimmed = (olderDesc ?? []).slice(0, span).reverse(); // chronological, includes target
      const merged = [...olderTrimmed, ...(newerAsc ?? [])];

      const senderIds = [...new Set(merged.map((m: any) => m.sender_id))];
      if (senderIds.length === 0) return { messages: merged as Message[], hasMoreOlder };
      const { data: surfersData } = await supabase
        .from('surfers').select('user_id, name, profile_image_url').in('user_id', senderIds);
      const surferMap = new Map((surfersData ?? []).map((s: any) => [s.user_id, s]));
      return {
        messages: merged.map((m: any) => ({
          ...m,
          sender_name: surferMap.get(m.sender_id)?.name,
          sender_avatar: surferMap.get(m.sender_id)?.profile_image_url,
        })) as Message[],
        hasMoreOlder,
      };
    } catch (error) {
      console.error('Error fetching messages around target:', error);
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
        const { data: upserted, error } = await withTimeout(
          supabase
            .from('messages')
            .upsert(payload, { onConflict: 'sender_id,client_id', ignoreDuplicates: true })
            .select()
            .maybeSingle(),
          SEND_TIMEOUT_MS,
          'send-upsert'
        );

        if (error) throw error;

        if (upserted) {
          data = upserted as Message;
        } else {
          const { data: existing, error: fetchErr } = await withTimeout(
            supabase.from('messages').select().eq('sender_id', senderId).eq('client_id', clientId).single(),
            SEND_TIMEOUT_MS,
            'send-fetch'
          );
          if (fetchErr) throw fetchErr;
          data = existing as Message;
        }
      } else {
        const { data: inserted, error } = await withTimeout(
          supabase.from('messages').insert(payload).select().single(),
          SEND_TIMEOUT_MS,
          'send-insert'
        );
        if (error) throw error;
        data = inserted as Message;
      }

      // Fire-and-forget: bounded, and never blocks the send return. The message
      // is already inserted; updated_at is non-critical recency metadata.
      withTimeout(
        supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId),
        10000,
        'send-touch'
      ).catch((e) => console.warn('[messagingService] updated_at touch failed:', e));

      return data;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  /**
   * Insert an inline "system" banner message into a conversation
   * (e.g. "X left the group", "Y removed X", "X joined the group").
   *
   * The current auth user is used as `sender_id` so RLS lets the row through —
   * the actor MUST still be a conversation member at insert time, so callers
   * doing a leave/remove must call this BEFORE removing the membership.
   *
   * Best-effort: failures are logged and swallowed so they cannot break the
   * underlying membership operation. The row is broadcast to every other
   * member via the existing `messages` realtime channel.
   */
  async postSystemMessage(conversationId: string, body: string): Promise<void> {
    if (!isSupabaseConfigured()) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const senderId = session?.user?.id;
      if (!senderId) {
        console.warn('[messagingService] postSystemMessage: no auth user');
        return;
      }

      const { error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          body,
          type: 'text',
          is_system: true,
          attachments: [],
        });
      if (error) {
        console.warn('[messagingService] postSystemMessage insert failed:', error);
        return;
      }

      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    } catch (e) {
      console.warn('[messagingService] postSystemMessage error:', e);
    }
  }

  /**
   * Insert a 'commitment_request' message — the structured bubble surfaced in
   * the host's DM with the member when the member submits their commitment.
   *
   * Returns the inserted row so the caller can link it back from
   * group_trip_commitment_requests.message_id.
   */
  async postCommitmentRequest(
    conversationId: string,
    metadata: CommitmentMetadata,
    body: string = ''
  ): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }
    const { data: { session } } = await supabase.auth.getSession();
    const senderId = session?.user?.id;
    if (!senderId) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        body,
        type: 'commitment_request',
        commitment_metadata: metadata,
        attachments: [],
      })
      .select()
      .single();

    if (error) {
      console.error('[messagingService] postCommitmentRequest insert failed:', error);
      throw error;
    }

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return data as Message;
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
   * Create an image message with its metadata in a single insert (upload-first
   * flow). client_id makes it idempotent and lets the client swap the optimistic
   * row when Realtime echoes it. Returns the created (or existing) Message.
   */
  async createImageMessageWithMetadata(
    conversationId: string,
    caption: string | undefined,
    imageMetadata: any,
    clientId: string
  ): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Mirror sendMessage's auth pattern: prefer cached session, fall back to getUser.
      let senderId: string | undefined;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        senderId = session.user.id;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          throw new Error('Not authenticated');
        }
        senderId = user.id;
      }

      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: senderId,
        type: 'image',
        body: caption ?? '',
        image_metadata: imageMetadata,
        client_id: clientId,
      };

      // Idempotent path: ON CONFLICT DO NOTHING on (sender_id, client_id). If the
      // row already exists (retry landed twice / realtime echo race), fetch the
      // winning row so callers still get a usable Message object.
      let data: Message | null = null;
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

      // Update conversation's updated_at (best-effort).
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      return data;
    } catch (error) {
      console.error('Error creating image message with metadata:', error);
      throw error;
    }
  }

  /**
   * Shared idempotent insert for upload-first typed messages (file / contact).
   * Mirrors createImageMessageWithMetadata's auth + ON CONFLICT DO NOTHING on
   * (sender_id, client_id). The row is only written once the caller has what it
   * needs (upload done for files; nothing to upload for contacts).
   */
  private async createTypedMessageWithMetadata(
    conversationId: string,
    type: MessageType,
    metadataColumn: 'file_metadata' | 'contact_metadata',
    metadata: unknown,
    clientId: string,
    body: string = '',
  ): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    let senderId: string | undefined;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      senderId = session.user.id;
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      senderId = user.id;
    }

    const payload: Record<string, unknown> = {
      conversation_id: conversationId,
      sender_id: senderId,
      type,
      body,
      [metadataColumn]: metadata,
      client_id: clientId,
    };

    let data: Message | null = null;
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

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return data;
  }

  /** Upload-first file message (bytes already uploaded to storage). */
  async createFileMessageWithMetadata(
    conversationId: string,
    fileMetadata: FileMetadata,
    clientId: string,
    body: string = '',
  ): Promise<Message> {
    return this.createTypedMessageWithMetadata(
      conversationId, 'file', 'file_metadata', fileMetadata, clientId, body,
    );
  }

  /** Shared-contact message (inline metadata, no upload). */
  async createContactMessageWithMetadata(
    conversationId: string,
    contactMetadata: ContactMetadata,
    clientId: string,
    body: string = '',
  ): Promise<Message> {
    return this.createTypedMessageWithMetadata(
      conversationId, 'contact', 'contact_metadata', contactMetadata, clientId, body,
    );
  }

  /**
   * Create a video message with its metadata in a single insert (upload-first
   * flow). Mirrors createImageMessageWithMetadata: client_id makes it idempotent
   * and lets the client swap the optimistic row when Realtime echoes it. The row
   * is only created AFTER the upload succeeds, so a failed send leaves no ghost.
   */
  async createVideoMessageWithMetadata(
    conversationId: string,
    caption: string | undefined,
    videoMetadata: any,
    clientId: string
  ): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Prefer cached session, fall back to getUser (matches sendMessage).
      let senderId: string | undefined;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        senderId = session.user.id;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          throw new Error('Not authenticated');
        }
        senderId = user.id;
      }

      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: senderId,
        type: 'video',
        body: caption ?? '',
        video_metadata: videoMetadata,
        client_id: clientId,
      };

      // Idempotent path: ON CONFLICT DO NOTHING on (sender_id, client_id).
      let data: Message | null = null;
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

      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      return data;
    } catch (error) {
      console.error('Error creating video message with metadata:', error);
      throw error;
    }
  }

  /**
   * Create an audio (voice) message with its metadata in a single insert
   * (upload-first flow). Mirrors createImageMessageWithMetadata. Voice messages
   * have no caption, so body is always ''. The row is only created AFTER the
   * upload succeeds, so a failed send leaves no ghost. Pass replyTo to carry a
   * quoted-message snapshot.
   */
  async createAudioMessageWithMetadata(
    conversationId: string,
    audioMetadata: any,
    clientId: string,
    replyTo?: ReplyToSnapshot | null
  ): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Prefer cached session, fall back to getUser (matches sendMessage).
      let senderId: string | undefined;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        senderId = session.user.id;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          throw new Error('Not authenticated');
        }
        senderId = user.id;
      }

      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: senderId,
        type: 'audio',
        body: '',
        audio_metadata: audioMetadata,
        client_id: clientId,
      };
      if (replyTo) {
        payload.reply_to_message_id = replyTo.message_id;
        payload.reply_to_snapshot = replyTo;
      }

      // Idempotent path: ON CONFLICT DO NOTHING on (sender_id, client_id).
      let data: Message | null = null;
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

      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      return data;
    } catch (error) {
      console.error('Error creating audio message with metadata:', error);
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
   * Create a voice-message row in the database (DB-first flow, mirrors image/video).
   * audio_metadata is populated by updateAudioMessageMetadata once the upload finishes.
   */
  async createAudioMessage(
    conversationId: string,
    replyTo?: ReplyToSnapshot | null
  ): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      const payload: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: user.id,
        type: 'audio',
        body: null,
        audio_metadata: null,
      };
      if (replyTo) {
        payload.reply_to_message_id = replyTo.message_id;
        payload.reply_to_snapshot = replyTo;
      }

      const { data, error } = await supabase
        .from('messages')
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      return data;
    } catch (error) {
      console.error('Error creating audio message:', error);
      throw error;
    }
  }

  /**
   * Patch a voice-message row with its uploaded audio_metadata. Owner-only update.
   */
  async updateAudioMessageMetadata(
    messageId: string,
    audioMetadata: AudioMetadata
  ): Promise<Message> {
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
          audio_metadata: audioMetadata,
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
      console.error('Error updating audio message metadata:', error);
      throw error;
    }
  }

  /**
   * Create a new direct conversation with another user
   * @param otherUserId - The user ID to create a conversation with
   * @param fromTripPlanning - If true, marks this as a Swelly-match conversation (used for the swelly_first_match_at analytics field).
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

      // Canonical sorted pair key — matches the partial unique index on conversations.
      const [uidA, uidB] = [user.id, otherUserId].sort();
      const directPairKey = `${uidA}:${uidB}`;

      const fetchByPairKey = async () => {
        const { data, error } = await supabase
          .from('conversations')
          .select('*')
          .eq('is_direct', true)
          .eq('direct_pair_key', directPairKey)
          .maybeSingle();
        if (error) {
          console.error('Error fetching existing direct conversation:', error);
          return null;
        }
        return data;
      };

      const existing = await fetchByPairKey();
      if (existing) {
        console.log('Found existing conversation:', existing.id);
        return existing;
      }

      // Create new conversation. The partial unique index makes this race-safe:
      // a concurrent caller that wins the insert will cause us to hit 23505,
      // and we'll fetch their row instead.
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          is_direct: true,
          created_by: user.id,
          direct_pair_key: directPairKey,
        })
        .select()
        .single();

      if (convError) {
        if ((convError as { code?: string }).code === '23505') {
          const winner = await fetchByPairKey();
          if (winner) {
            console.log('Lost direct-conversation insert race; using existing:', winner.id);
            return winner;
          }
        }
        throw convError;
      }

      // Add both users as members
      const { error: membersError } = await supabase
        .from('conversation_members')
        .insert([
          {
            conversation_id: conversation.id,
            user_id: user.id,
            role: 'owner',
          },
          {
            conversation_id: conversation.id,
            user_id: otherUserId,
            role: 'member',
          },
        ]);

      if (membersError) throw membersError;

      // Analytics: first-ever Swelly match by this user. Idempotent (DB filters IS NULL).
      // Only count when this conversation came from Swelly (fromTripPlanning) AND is newly created here.
      if (fromTripPlanning) {
        supabase
          .from('surfers')
          .update({ swelly_first_match_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .is('swelly_first_match_at', null)
          .then(({ error: markErr }) => {
            if (markErr) console.warn('markFirstEvent(swelly_first_match_at) failed:', markErr);
          });
      }

      return conversation;
    } catch (error) {
      console.error('Error creating direct conversation:', error);
      throw error;
    }
  }

  /**
   * Create a new group conversation. Creator becomes owner; other userIds are added as members.
   * Optional metadata is stored on the row (used to link a conversation to a group_trip via { trip_id }).
   */
  async createGroupConversation(
    title: string,
    memberIds: string[],
    metadata?: Record<string, any>
  ): Promise<Conversation> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Not authenticated');
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        is_direct: false,
        title: title.trim(),
        created_by: user.id,
        metadata: metadata ?? {},
      })
      .select()
      .single();

    if (convError) throw convError;

    const uniqueMemberIds = Array.from(new Set(memberIds.filter(id => id && id !== user.id)));
    const memberRows = [
      { conversation_id: conversation.id, user_id: user.id, role: 'owner' as const },
      ...uniqueMemberIds.map(id => ({
        conversation_id: conversation.id,
        user_id: id,
        role: 'member' as const,
      })),
    ];

    const { error: membersError } = await supabase
      .from('conversation_members')
      .insert(memberRows);

    if (membersError) throw membersError;

    return conversation;
  }

  /**
   * Idempotently add a user to a conversation. Safe to call repeatedly: if the user is already
   * a member, the upsert is a no-op (composite primary key on conversation_id+user_id absorbs duplicates).
   */
  async addConversationMember(
    conversationId: string,
    userId: string,
    role: 'member' | 'admin' = 'member'
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    const { error } = await supabase
      .from('conversation_members')
      .upsert(
        { conversation_id: conversationId, user_id: userId, role },
        { onConflict: 'conversation_id,user_id', ignoreDuplicates: true }
      );

    if (error) throw error;
  }

  /**
   * Idempotently remove a user from a conversation. No-op if they aren't a member.
   */
  async removeConversationMember(
    conversationId: string,
    userId: string
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    const { error } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    if (error) throw error;
  }

  /**
   * Find the group conversation linked to a surftrip via metadata.trip_id. Returns null if none exists.
   */
  async getConversationByTripId(tripId: string): Promise<Conversation | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('is_direct', false)
      .eq('metadata->>trip_id', tripId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching conversation by trip id:', error);
      return null;
    }
    return data;
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
   * Broadcast the read receipt on the conversation channel ONLY (no DB write).
   * Drives the sender's instant "Seen". Reuses the already-open per-conversation
   * channel and takes the caller's userId so it makes no auth round-trip on the
   * hot per-message path.
   */
  broadcastReadReceipt(conversationId: string, userId: string, lastReadAt: string): void {
    const channel = this.getChannel(conversationId);
    if (!channel) return;
    channel
      .send({ type: 'broadcast', event: 'read_receipt', payload: { userId, lastReadAt } })
      .catch((e: unknown) => console.warn('[messagingService] read_receipt broadcast failed:', e));
  }

  /**
   * Persist the read watermark to conversation_members. Durability only
   * (cold-load, multi-device, push badges) — safe to debounce/coalesce. One
   * UPDATE; does not recount unread.
   */
  async persistReadWatermark(
    conversationId: string,
    userId: string,
    messageId: string | undefined,
    lastReadAt: string
  ): Promise<void> {
    if (!isSupabaseConfigured()) return;
    try {
      const { error } = await supabase
        .from('conversation_members')
        .update({ last_read_message_id: messageId, last_read_at: lastReadAt })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
      if (error) throw error;
    } catch (error) {
      console.error('[messagingService] persistReadWatermark failed:', error);
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
   * Set or clear the mute state for the current user on a conversation.
   * Pass `null` to unmute. Merges into preferences JSONB so other keys are preserved.
   */
  async setMuteUntil(conversationId: string, mutedUntil: Date | null): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: existing, error: readErr } = await supabase
      .from('conversation_members')
      .select('preferences')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (readErr) throw readErr;

    const nextPreferences = {
      ...(existing?.preferences ?? {}),
      muted_until: mutedUntil ? mutedUntil.toISOString() : null,
    };

    const { error } = await supabase
      .from('conversation_members')
      .update({ preferences: nextPreferences })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id);
    if (error) throw error;
  }

  /**
   * Fetch the current user's mute state for a conversation.
   * Returns null if not muted, or if the stored expiry is in the past.
   */
  async getMuteUntil(conversationId: string): Promise<Date | null> {
    if (!isSupabaseConfigured()) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('conversation_members')
      .select('preferences')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error || !data) return null;

    return getMuteUntilFromMember(data as Pick<ConversationMember, 'preferences'>);
  }

  // --- Shadow-mode parity tracker (VERIFICATION ONLY; active only in 'shadow').
  // Records whether each NEW message arrived via postgres_changes ('pg') and/or
  // broadcast ('bc'), proving the broadcast transport reaches parity before we
  // ever cut over. Pure observation: it only counts + logs, never touches UI
  // state, callbacks, or message flow. A no-op in 'legacy' and 'broadcast'. ---
  private _shadowSeen = new Map<string, { first: 'pg' | 'bc'; t: number }>();
  private _shadowStats = { both: 0, pgOnly: 0, bcOnly: 0, bcFirst: 0 };
  private _shadowLastLog = 0;

  private recordShadowNewMessage(messageId: string, source: 'pg' | 'bc'): void {
    if (getRealtimeMode() !== 'shadow' || !messageId) return;
    const now = Date.now();
    const existing = this._shadowSeen.get(messageId);
    if (!existing) {
      this._shadowSeen.set(messageId, { first: source, t: now });
    } else if (existing.first !== source) {
      // Both transports delivered this message.
      this._shadowStats.both++;
      if (existing.first === 'bc') this._shadowStats.bcFirst++;
      this._shadowSeen.delete(messageId);
    }
    // Sweep entries older than 10s — only one transport ever delivered them.
    for (const [id, rec] of this._shadowSeen) {
      if (now - rec.t < 10000) continue;
      if (rec.first === 'pg') this._shadowStats.pgOnly++;
      else this._shadowStats.bcOnly++;
      this._shadowSeen.delete(id);
    }
    // Rolling summary at most every 30s.
    if (now - this._shadowLastLog > 30000) {
      this._shadowLastLog = now;
      const s = this._shadowStats;
      const total = s.both + s.pgOnly + s.bcOnly;
      const bcFirstPct = s.both ? Math.round((s.bcFirst / s.both) * 100) : 0;
      console.log(
        `[Realtime shadow parity] both=${s.both} pgOnly=${s.pgOnly} bcOnly=${s.bcOnly} ` +
        `bcFirst=${bcFirstPct}% (n=${total}) — cutover gate: bcOnly→0 and both≈total`
      );
    }
  }

  /**
   * Shared INSERT logic: optionally refetch the full row (when the realtime
   * payload is missing the type/client_id columns), enrich with sender info,
   * then fire onNewMessage. Used by BOTH the postgres_changes INSERT handler
   * and the broadcast new_message handler so they produce identical results.
   */
  private async handleIncomingInsert(
    rawMessage: Message,
    callbacks: MessageSubscriptionCallbacks
  ): Promise<void> {
    let newMessage = rawMessage;

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
          .select('id, conversation_id, sender_id, body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, audio_metadata, commitment_metadata, reply_to_message_id, reply_to_snapshot')
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

    if (callbacks.onNewMessage) {
      callbacks.onNewMessage(newMessage);
    }
  }

  /**
   * Shared UPDATE logic: always refetch the full row (UPDATE events are critical
   * for image_metadata populated after upload), enrich with sender info, then
   * fire onMessageUpdated. Used by BOTH the postgres_changes UPDATE handler and
   * the broadcast update_message handler so they produce identical results.
   */
  private async handleIncomingUpdate(
    rawMessage: Message,
    callbacks: MessageSubscriptionCallbacks
  ): Promise<void> {
    let updatedMessage = rawMessage;

    // CRITICAL: Always fetch full message for UPDATE events to ensure we have the latest image_metadata
    // UPDATE events are critical for image messages (when image_metadata is populated after upload)
    // This ensures cache always has complete data
    try {
      const { data: fullMessage, error } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, body, attachments, client_id, is_system, edited, deleted, created_at, updated_at, type, image_metadata, video_metadata, audio_metadata, commitment_metadata, reply_to_message_id, reply_to_snapshot')
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

    if (callbacks.onMessageUpdated) {
      callbacks.onMessageUpdated(updatedMessage);
    }
  }

  /**
   * Shared DELETE logic: fire onMessageDeleted with the message id. Used by BOTH
   * the postgres_changes DELETE handler and the broadcast delete_message handler.
   */
  private handleIncomingDelete(
    messageId: string,
    callbacks: MessageSubscriptionCallbacks
  ): void {
    if (callbacks.onMessageDeleted) {
      callbacks.onMessageDeleted(messageId);
    }
  }

  /**
   * Route a broadcast message payload ({ op, message }) from the DB trigger to
   * the same INSERT/UPDATE/DELETE helpers used by the postgres_changes path.
   * Only active in shadow/broadcast modes (broadcast listeners aren't registered
   * in legacy mode).
   */
  private handleBroadcastMessage(
    payload: { op?: 'INSERT' | 'UPDATE' | 'DELETE'; message?: Message } | undefined,
    callbacks: MessageSubscriptionCallbacks
  ): void {
    const op = payload?.op;
    const message = payload?.message;
    if (!op || !message) return;

    if (op === 'INSERT') {
      this.recordShadowNewMessage(message.id, 'bc');
      void this.handleIncomingInsert(message, callbacks);
    } else if (op === 'UPDATE') {
      void this.handleIncomingUpdate(message, callbacks);
    } else if (op === 'DELETE') {
      this.handleIncomingDelete(message.id, callbacks);
    }
  }

  /**
   * Subscribe to a user's inbox topic (private broadcast). The DB trigger emits
   * one `inbox_change` event per conversation the user belongs to whenever a
   * message changes. Maps each event to an intent via the pure mapper. This is a
   * standalone subscription (not wired into the provider here — see Task 8).
   */
  subscribeToUserInbox(userId: string, onInbox: (intent: InboxIntent) => void): () => void {
    const channel = supabase
      .channel(userInboxTopic(userId), { config: { private: true } })
      .on('broadcast', { event: 'inbox_change' }, ({ payload }) => {
        const intent = inboxEventToIntent(payload as InboxEvent);
        if (intent) onInbox(intent);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[MessagingService] user-inbox channel CHANNEL_ERROR for', userId);
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
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

    const realtimeMode = getRealtimeMode();

    // Message bindings (INSERT/UPDATE/DELETE on `messages`).
    // - legacy & shadow: register postgres_changes (authoritative).
    // - broadcast: skip postgres_changes; the broadcast listeners below carry messages.
    // The handler bodies delegate to shared helpers so the broadcast path produces
    // byte-for-byte identical enriched messages and fires the same callbacks.
    if (realtimeMode !== 'broadcast') {
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
            const newMessage = payload.new as Message;

            if (__DEV__) {
              console.log('[MessagingService] INSERT payload keys:', Object.keys(payload.new ?? {}));
            }

            this.recordShadowNewMessage(newMessage.id, 'pg');
            await this.handleIncomingInsert(newMessage, normalizedCallbacks);
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
            const updatedMessage = payload.new as Message;
            await this.handleIncomingUpdate(updatedMessage, normalizedCallbacks);
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
            this.handleIncomingDelete(deletedMessageId, normalizedCallbacks);
          }
        );
    }

    // Broadcast message bindings — the DB trigger emits new_message / update_message
    // / delete_message on the private conversation topic. Registered only in
    // shadow (alongside postgres_changes; provider-level dedup collapses the dup)
    // and broadcast (sole source). NOT registered in legacy mode.
    if (realtimeMode !== 'legacy') {
      channel
        .on('broadcast', { event: 'new_message' }, ({ payload }) => this.handleBroadcastMessage(payload, normalizedCallbacks))
        .on('broadcast', { event: 'update_message' }, ({ payload }) => this.handleBroadcastMessage(payload, normalizedCallbacks))
        .on('broadcast', { event: 'delete_message' }, ({ payload }) => this.handleBroadcastMessage(payload, normalizedCallbacks));
    }

    channel
      // Handle conversation_members.UPDATE — covers two distinct cases:
      //   1) last_read_at changes (read receipts), fires onReadReceiptUpdate
      //   2) role changes (promote / demote), fires onRoleChanged
      // We diff against payload.old so a read-receipt UPDATE doesn't spuriously
      // trigger the role callback and force a member refetch.
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_members',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { user_id: string; last_read_at: string | null; role: string | null };
          const prev = (payload.old ?? {}) as { role?: string | null };
          if (row?.user_id) {
            if (normalizedCallbacks.onReadReceiptUpdate) {
              normalizedCallbacks.onReadReceiptUpdate(row.user_id, row.last_read_at ?? null);
            }
            if (normalizedCallbacks.onRoleChanged && row.role !== undefined && prev.role !== row.role) {
              normalizedCallbacks.onRoleChanged(row.user_id, row.role ?? null);
            }
          }
        }
      )
      // Membership churn (joins / leaves / kicks). The chat thread itself shows
      // a system banner via the messages INSERT path; this event lets the
      // header / detail screen refresh the live member list.
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_members',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          normalizedCallbacks.onMembersChanged?.();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'conversation_members',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          normalizedCallbacks.onMembersChanged?.();
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
          const { userId, isTyping: rawIsTyping } = (payload.payload ?? {}) as {
            userId?: string;
            isTyping?: boolean;
          };
          // Ignore broadcasts without a userId (e.g. empty/system payloads) — destructuring
          // an undefined payload here would throw synchronously and surface as CHANNEL_ERROR.
          if (!userId) {
            return;
          }
          const isTyping = rawIsTyping === true;

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
      .subscribe((status, err) => {
        const errKey = `dm:${conversationId}`;
        if (status === 'SUBSCRIBED') {
          this.clearRealtimeError(errKey);
          console.log(`Subscribed to messages for conversation ${conversationId}`);
        } else if (status === 'CHANNEL_ERROR') {
          // Logged once per down-episode (warn, not error → no redbox storm). The 2nd
          // arg `err` carries Supabase's reason; channelState distinguishes a per-channel
          // failure from a dead socket. When the whole socket is down, every channel
          // hits this — so we suppress repeats until SUBSCRIBED.
          this.logRealtimeErrorOnce(
            errKey,
            `[MessagingService] DM channel ${conversationId} CHANNEL_ERROR: ` +
              `${err?.message ?? '(no error message)'} | channelState=${channel.state} ` +
              `(suppressing repeats until reconnect)`
          );
          this.activeChannels.delete(conversationId);
        } else if (status === 'TIMED_OUT' || status === 'CLOSED') {
          this.logRealtimeErrorOnce(
            errKey,
            `[MessagingService] DM channel ${conversationId} ${status}: ` +
              `${err?.message ?? '(no error message)'} | channelState=${channel.state}`
          );
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
  async startTyping(conversationId: string, userId?: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      // Prefer the caller-supplied (cached) userId so we don't make a GoTrue
      // auth.getUser() network round-trip on the typing hot path. Fall back to
      // a lookup only if no id was passed (keeps older callers working).
      const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
      if (!uid) return;

      const channel = this.getChannel(conversationId);
      if (!channel) return; // No channel until subscribeToMessages has run (e.g. DM screen open)

      // Server-side safety valve: discard keepalives arriving faster than 2s.
      // The sender already throttles to ~3s; this just caps abuse. WhatsApp uses
      // the same ~2s discard behind a ~3s client keepalive.
      const lastEvent = this.lastTypingEvent.get(conversationId) || 0;
      const now = Date.now();
      if (now - lastEvent < 2000) {
        return;
      }
      this.lastTypingEvent.set(conversationId, now);

      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: uid, isTyping: true },
      });
      if (__DEV__) {
        console.log('[MessagingService] Typing sent', { conversationId, userId: uid });
      }
    } catch (error) {
      console.error('Error sending typing indicator:', error);
    }
  }

  /**
   * Stop typing indicator. Uses the same channel as subscribeToMessages; never creates a second channel.
   */
  async stopTyping(conversationId: string, userId?: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      return;
    }

    try {
      // Same cached-id optimization as startTyping — avoid an auth round-trip.
      const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
      if (!uid) return;

      const channel = this.getChannel(conversationId);
      if (!channel) return;

      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: uid, isTyping: false },
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
   * Batched variant of subscribeToConversationListUpdates.
   *
   * Instead of one Realtime channel per conversation (≈3×N postgres_changes
   * bindings on a single websocket — which destabilizes the socket past ~50
   * conversations and cascades CHANNEL_ERROR across every channel, the failure
   * mode documented on subscribeToConversations), this opens a SMALL number of
   * channels using a `conversation_id=in.(...)` filter.
   *
   * - Supabase caps the `in` filter at 100 values, so ids are chunked at
   *   LIST_BATCH_MAX (<100).
   * - Each rebuild uses a unique topic (listBatchSeq) so tearing down the previous
   *   channel can't race a same-topic re-subscribe (binding-mismatch CHANNEL_ERROR).
   * - conversationId is derived from the changed row (not a closure), so handlers
   *   stay correct across every conversation a channel covers.
   *
   * Still a filtered subscription, so it keeps the reliable-delivery property that
   * the unfiltered conversations channel lacks (see subscribeToConversations notes).
   */
  subscribeToConversationListUpdatesBatch(
    conversationIds: string[],
    callbacks: {
      onNewMessage?: (conversationId: string, message: Message) => void;
      onMessageUpdated?: (conversationId: string, message: Message) => void;
      onMessageDeleted?: (conversationId: string, messageId: string) => void;
    }
  ): () => void {
    if (!isSupabaseConfigured()) {
      return () => {};
    }

    // Tear down any previous batch channels before rebuilding.
    this.teardownListBatchChannels();

    const LIST_BATCH_MAX = 90; // Supabase hard-caps the `in` filter at 100 values; stay under it.
    const uniqueIds = Array.from(new Set(conversationIds)).filter(Boolean);

    for (let i = 0; i < uniqueIds.length; i += LIST_BATCH_MAX) {
      const chunk = uniqueIds.slice(i, i + LIST_BATCH_MAX);
      const inFilter = `conversation_id=in.(${chunk.join(',')})`;
      const topic = `list:messages:batch:${++this.listBatchSeq}`;

      const channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: inFilter },
          (payload) => {
            const message = payload.new as Message;
            if (!message?.id || !message.conversation_id || !message.created_at) return;
            callbacks.onNewMessage?.(message.conversation_id, message);
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: inFilter },
          (payload) => {
            const message = payload.new as Message;
            if (!message?.id || !message.conversation_id) return;
            callbacks.onMessageUpdated?.(message.conversation_id, message);
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'messages', filter: inFilter },
          (payload) => {
            // DELETE payloads only carry replica-identity columns. The current
            // per-conv code already filters DELETE by conversation_id, so it is
            // available here; guard anyway and skip if absent (no regression — the
            // DM screen path handles deletes with its own conversationId).
            const old = payload.old as { id?: string; conversation_id?: string } | undefined;
            if (!old?.id || !old.conversation_id) return;
            callbacks.onMessageDeleted?.(old.conversation_id, old.id);
          }
        )
        .subscribe((status) => {
          if (__DEV__ && status !== 'SUBSCRIBED') {
            console.log(`[MessagingService] ${topic} status: ${status}`);
          }
        });

      this.listBatchChannels.push(channel);
    }

    const unsubscribe = () => {
      this.teardownListBatchChannels();
      this.listSubscriptions.delete('__list_batch__');
    };
    this.listSubscriptions.set('__list_batch__', unsubscribe);
    return unsubscribe;
  }

  private teardownListBatchChannels(): void {
    this.listBatchChannels.forEach((channel) => {
      try {
        supabase.removeChannel(channel);
      } catch (e) {
        console.warn('[MessagingService] Error removing list batch channel:', e);
      }
    });
    this.listBatchChannels = [];
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
        if (status === 'SUBSCRIBED') {
          this.clearRealtimeError('conversations_list');
          console.log('[MessagingService] ✅ Successfully subscribed to conversations_list channel');
          // Just connected/reconnected - trigger sync
          // This callback fires on initial connection and on reconnect
          normalizedCallbacks.onReconnect?.();
          // Legacy support
          if (typeof callbacks === 'function') {
            callbacks();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Logged once per down-episode (warn, not error). When the realtime socket
          // is down, this fires on every retry — suppress repeats until reconnect.
          this.logRealtimeErrorOnce(
            'conversations_list',
            `[MessagingService] conversations_list ${status} — realtime socket likely down ` +
              `(suppressing repeats until reconnect)`
          );
        } else if (status === 'CLOSED') {
          this.logRealtimeErrorOnce('conversations_list', '[MessagingService] conversations_list channel CLOSED');
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
  async getConversationsUpdatedSince(lastSync: number, restrictToConversationIds?: string[]): Promise<Conversation[]> {
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

      // Get conversations. Two modes:
      //   - watermark (default): updated_at > lastSync — used by reconnect catch-up.
      //   - restrictToConversationIds: fetch these EXACT conversations, bypassing the
      //     watermark. Used by the broadcast user-inbox path, where the event already
      //     names the conversation and the updated_at>lastSync compare races against
      //     the locally-tracked lastSync and wrongly returns nothing.
      let convQuery = supabase
        .from('conversations')
        .select('id, title, is_direct, metadata, created_by, created_at, updated_at')
        .in('id', conversationIds);
      if (restrictToConversationIds && restrictToConversationIds.length > 0) {
        convQuery = convQuery.in('id', restrictToConversationIds);
      } else {
        convQuery = convQuery.gt('updated_at', lastSyncDate);
      }
      const { data: conversations, error: conversationsError } = await convQuery
        .order('updated_at', { ascending: false });

      if (conversationsError) throw conversationsError;

      if (!conversations || conversations.length === 0) {
        return [];
      }

      // Reuse the SAME batched enrichment as getConversations: one RPC for last
      // messages (carrying image/video/audio/commitment metadata), one capped
      // unread query, and full member/other_user enrichment — no per-conversation
      // round-trips. Returns the full Conversation shape (not the old simplified one).
      return this.enrichConversations(conversations, user);
    } catch (error) {
      console.error('Error fetching conversations updated since:', error);
      throw error;
    }
  }

  /**
   * Get unread count for a conversation (authoritative calculation)
   * @deprecated No callers since WS3 enrichment refactor. Safe to remove after one release.
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

  /**
   * Set the current user's reaction on a message. Replaces any existing
   * reaction by this user (WhatsApp behavior — one reaction per user per message,
   * enforced by PK on (message_id, user_id)).
   */
  async setReaction(messageId: string, emoji: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('message_reactions')
      .upsert(
        {
          message_id: messageId,
          user_id: user.id,
          reaction: emoji,
          reacted_at: new Date().toISOString(),
        },
        { onConflict: 'message_id,user_id' },
      );
    if (error) throw error;
  }

  /**
   * Remove the current user's reaction from a message (no-op if none).
   */
  async removeReaction(messageId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user.id);
    if (error) throw error;
  }

  /**
   * Batch-fetch raw reaction rows for a list of message IDs.
   * Caller is responsible for aggregating with `aggregateReactions`.
   */
  async fetchReactionsForMessages(messageIds: string[]): Promise<MessageReaction[]> {
    if (!isSupabaseConfigured()) return [];
    if (messageIds.length === 0) return [];

    const { data, error } = await supabase
      .from('message_reactions')
      .select('message_id, user_id, reaction, reacted_at')
      .in('message_id', messageIds);
    if (error) {
      console.error('[messagingService] fetchReactionsForMessages failed', error);
      return [];
    }
    return (data || []) as MessageReaction[];
  }
}

/**
 * Group raw reaction rows for a single message into the UI-facing
 * AggregatedReaction[] shape. Pure helper, safe to call inside reducers.
 */
export function aggregateReactions(
  rows: MessageReaction[],
  currentUserId: string | null | undefined,
): AggregatedReaction[] {
  if (rows.length === 0) return [];
  const byEmoji = new Map<string, AggregatedReaction>();
  for (const row of rows) {
    const existing = byEmoji.get(row.reaction);
    if (existing) {
      existing.count += 1;
      existing.userIds.push(row.user_id);
      if (row.user_id === currentUserId) existing.hasMine = true;
    } else {
      byEmoji.set(row.reaction, {
        emoji: row.reaction,
        count: 1,
        userIds: [row.user_id],
        hasMine: row.user_id === currentUserId,
      });
    }
  }
  // Sort by count desc, then by emoji for stable order.
  return Array.from(byEmoji.values()).sort((a, b) =>
    b.count - a.count || a.emoji.localeCompare(b.emoji),
  );
}

/**
 * Read mute state from a loaded ConversationMember (or a row with `preferences`).
 * Returns null if not muted or if the stored expiry is already in the past,
 * so callers can treat "expired" identically to "not muted".
 */
export function getMuteUntilFromMember(
  member: Pick<ConversationMember, 'preferences'> | null | undefined,
): Date | null {
  const raw = member?.preferences?.muted_until;
  if (!raw || typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  if (parsed.getTime() <= Date.now()) return null;
  return parsed;
}

export const messagingService = new MessagingService();

