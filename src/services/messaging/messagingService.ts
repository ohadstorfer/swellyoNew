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
   */
  async getConversations(): Promise<Conversation[]> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
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

      // Get conversation details
      const { data: conversations, error: conversationsError } = await supabase
        .from('conversations')
        .select('*')
        .in('id', conversationIds)
        .order('updated_at', { ascending: false });

      if (conversationsError) throw conversationsError;

      // Enrich each conversation with last message, unread count, and members
      const enrichedConversations = await Promise.all(
        (conversations || []).map(async (conv) => {
          // Get last message
          const { data: lastMessageData } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conv.id)
            .eq('deleted', false)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Get unread count
          const { data: memberData } = await supabase
            .from('conversation_members')
            .select('last_read_message_id, last_read_at')
            .eq('conversation_id', conv.id)
            .eq('user_id', user.id)
            .maybeSingle();

          let unreadCount = 0;
          if (memberData && lastMessageData) {
            const { count } = await supabase
              .from('messages')
              .select('*', { count: 'exact', head: true })
              .eq('conversation_id', conv.id)
              .eq('deleted', false)
              .gt('created_at', memberData.last_read_at || new Date(0).toISOString());
            unreadCount = count || 0;
          }

          // Get all members
          const { data: membersData } = await supabase
            .from('conversation_members')
            .select(`
              *,
              users:user_id (
                id,
                email
              ),
              surfers:user_id (
                name,
                profile_image_url
              )
            `)
            .eq('conversation_id', conv.id);

          // For direct conversations, find the other user
          let otherUser: ConversationMember | undefined;
          if (conv.is_direct && membersData) {
            const otherMember = membersData.find(m => m.user_id !== user.id);
            if (otherMember) {
              otherUser = {
                ...otherMember,
                name: (otherMember as any).surfers?.name || (otherMember as any).users?.email,
                profile_image_url: (otherMember as any).surfers?.profile_image_url,
                email: (otherMember as any).users?.email,
              };
            }
          }

          return {
            ...conv,
            last_message: lastMessageData || undefined,
            unread_count: unreadCount,
            other_user: otherUser,
            members: membersData?.map(m => ({
              ...m,
              name: (m as any).surfers?.name || (m as any).users?.email,
              profile_image_url: (m as any).surfers?.profile_image_url,
              email: (m as any).users?.email,
            })),
          };
        })
      );

      return enrichedConversations;
    } catch (error) {
      console.error('Error fetching conversations:', error);
      throw error;
    }
  }

  /**
   * Get messages for a specific conversation
   */
  async getMessages(conversationId: string, limit: number = 50): Promise<Message[]> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }

    try {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          surfers:sender_id (
            name,
            profile_image_url
          )
        `)
        .eq('conversation_id', conversationId)
        .eq('deleted', false)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) throw error;

      return (data || []).map(msg => ({
        ...msg,
        sender_name: (msg as any).surfers?.name,
        sender_avatar: (msg as any).surfers?.profile_image_url,
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if a direct conversation already exists
      const { data: existingConversations } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (existingConversations) {
        for (const { conversation_id } of existingConversations) {
          const { data: members } = await supabase
            .from('conversation_members')
            .select('user_id')
            .eq('conversation_id', conversation_id);

          if (members && members.length === 2) {
            const userIds = members.map(m => m.user_id).sort();
            const targetUserIds = [user.id, otherUserId].sort();
            if (JSON.stringify(userIds) === JSON.stringify(targetUserIds)) {
              // Found existing conversation
              const { data: conv } = await supabase
                .from('conversations')
                .select('*')
                .eq('id', conversation_id)
                .single();
              return conv;
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
      throw new Error('Supabase is not configured');
    }

    const subscription = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          callback(payload.new as Message);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
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

