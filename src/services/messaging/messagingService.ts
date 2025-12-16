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

// Message interface
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body?: string;
  rendered_body?: any;
  attachments: any[];
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

class MessagingService {
  /**
   * Get all conversations for the current user
   * OPTIMIZED: Batches all queries to avoid N+1 problem
   */
  async getConversations(): Promise<Conversation[]> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // Ensure we have a valid session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        console.error('Session error in getConversations:', sessionError);
        throw new Error('Not authenticated. Please sign in again.');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

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

      // OPTIMIZATION 1: Get conversation details with specific columns
      const { data: conversations, error: conversationsError } = await supabase
        .from('conversations')
        .select('id, title, is_direct, metadata, created_by, created_at, updated_at')
        .in('id', conversationIds)
        .order('updated_at', { ascending: false });

      if (conversationsError) throw conversationsError;

      if (!conversations || conversations.length === 0) {
        return [];
      }

      // OPTIMIZATION 2: Batch fetch all last messages in parallel using a single query per conversation
      // (Supabase doesn't support window functions easily, so we'll use a more efficient approach)
      const lastMessagesPromises = conversations.map(conv =>
        supabase
          .from('messages')
          .select('id, conversation_id, sender_id, body, rendered_body, attachments, is_system, edited, deleted, created_at, updated_at')
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

      // OPTIMIZATION 3: Batch fetch all member data for all conversations
      const { data: allMembersData, error: allMembersError } = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id, role, joined_at, last_read_message_id, last_read_at, preferences')
        .in('conversation_id', conversationIds);

      if (allMembersError) {
        console.error('Error fetching all members:', allMembersError);
      }

      // Group members by conversation
      const membersByConversation = new Map<string, typeof allMembersData>();
      (allMembersData || []).forEach(member => {
        if (!membersByConversation.has(member.conversation_id)) {
          membersByConversation.set(member.conversation_id, []);
        }
        membersByConversation.get(member.conversation_id)!.push(member);
      });

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

      // OPTIMIZATION 5: Batch calculate unread counts for all conversations
      const unreadCountPromises = conversations.map(conv => {
        const lastReadAt = userReadMap.get(conv.id) || new Date(0).toISOString();
        const lastMessage = lastMessagesMap.get(conv.id);
        if (!lastMessage) return Promise.resolve(0);
        
        return supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .eq('deleted', false)
          .gt('created_at', lastReadAt)
          .then(result => result.count || 0);
      });
      const unreadCounts = await Promise.all(unreadCountPromises);
      const unreadCountMap = new Map<string, number>();
      conversations.forEach((conv, index) => {
        unreadCountMap.set(conv.id, unreadCounts[index]);
      });

      // OPTIMIZATION 6: Batch fetch all unique user IDs and get their data in bulk
      const allUserIds = new Set<string>();
      (allMembersData || []).forEach(member => {
        allUserIds.add(member.user_id);
      });

      // Batch fetch users
      const userIdsArray = Array.from(allUserIds);
      const { data: usersData } = await supabase
        .from('users')
        .select('id, email')
        .in('id', userIdsArray);

      // Batch fetch surfers
      const { data: surfersData } = await supabase
        .from('surfers')
        .select('user_id, name, profile_image_url')
        .in('user_id', userIdsArray);

      // Create lookup maps
      const usersMap = new Map((usersData || []).map(u => [u.id, u]));
      const surfersMap = new Map((surfersData || []).map(s => [s.user_id, s]));

      // OPTIMIZATION 7: Enrich members using the lookup maps (no additional queries)
      const enrichedMembersByConv = new Map<string, ConversationMember[]>();
      membersByConversation.forEach((members, convId) => {
        const enriched = members.map(member => {
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
          other_user: otherUser,
          members: enrichedMembers,
        };
      });

      return enrichedConversations;
    } catch (error) {
      console.error('Error fetching conversations:', error);
      throw error;
    }
  }

  /**
   * Get messages for a specific conversation
   * OPTIMIZED: Uses specific column selects instead of *
   */
  async getMessages(conversationId: string, limit: number = 50): Promise<Message[]> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      // OPTIMIZATION: Fetch only needed columns instead of *
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, body, rendered_body, attachments, is_system, edited, deleted, created_at, updated_at')
        .eq('conversation_id', conversationId)
        .eq('deleted', false)
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
      console.error('Error fetching messages:', error);
      throw error;
    }
  }

  /**
   * Send a message in a conversation
   */
  async sendMessage(conversationId: string, body: string, attachments: any[] = []): Promise<Message> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          body,
          attachments,
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
   * Create a new direct conversation with another user
   */
  async createDirectConversation(otherUserId: string): Promise<Conversation> {
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
        throw new Error('Not authenticated. Please sign in again.');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
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
      if (!user) throw new Error('Not authenticated');

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
   * Subscribe to new messages in a conversation
   */
  subscribeToMessages(conversationId: string, callback: (message: Message) => void) {
    if (!isSupabaseConfigured()) {
      console.warn('Supabase is not configured, subscription will not work');
      return () => {}; // Return no-op unsubscribe function
    }

    const channel = supabase
      .channel(`messages:${conversationId}`)
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
          
          callback(newMessage);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to messages for conversation ${conversationId}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`Error subscribing to messages for conversation ${conversationId}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }

  /**
   * Subscribe to conversation updates (for the conversations list)
   */
  subscribeToConversations(callback: () => void) {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    const subscription = supabase
      .channel('conversations_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        () => {
          callback();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        () => {
          callback();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }
}

export const messagingService = new MessagingService();

