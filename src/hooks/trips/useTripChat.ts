/**
 * The trip's group chat, as seen by the current user — for the Chat tab on the
 * trip page (docs/specs/trip-chat-tab.md).
 *
 * The server keeps `conversation_members` in sync with hosts, travelers and
 * chat staff (migration 20260923…_trip_chat_membership_sync). So the client
 * does not work out who belongs in the chat: it reads the user's own member
 * row and trusts it.
 *
 *   - no row            → not in the chat (the screen may still offer the tab
 *                          to a host / member, and create the chat lazily)
 *   - row, left_at null → active
 *   - row, left_at set  → departed: read-only history up to left_at
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../config/supabase';
import { messagingService } from '../../services/messaging/messagingService';
import { tripsKeys } from './useTripQueries';

export type TripChatMembership = {
  conversationId: string | null;
  /** The user has a member row (active or departed). */
  isMember: boolean;
  /** Set when they left or were removed. */
  leftAt: string | null;
};

const NONE: TripChatMembership = { conversationId: null, isMember: false, leftAt: null };

async function fetchTripChatMembership(tripId: string): Promise<TripChatMembership> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return NONE;

  // RLS only returns the conversation to someone with a member row (active or
  // departed), so a null here also means "not in it".
  const conv = await messagingService.getConversationByTripId(tripId);
  if (!conv) return NONE;

  // `*` rather than naming left_at: a build that lands before the migration
  // must still read the row, just without the column.
  const { data: member, error } = await supabase
    .from('conversation_members')
    .select('*')
    .eq('conversation_id', conv.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  return {
    conversationId: conv.id,
    isMember: !!member,
    leftAt: (member as { left_at?: string | null } | null)?.left_at ?? null,
  };
}

export function useTripChatMembership(tripId: string, enabled = true) {
  return useQuery({
    queryKey: tripsKeys.chatMembership(tripId),
    queryFn: () => fetchTripChatMembership(tripId),
    enabled: !!tripId && enabled,
    staleTime: 60 * 1000,
  });
}

/**
 * Return the trip's conversation id, creating the chat if the trip predates
 * trip chats. The server RPC creates it once and adds every current host,
 * active traveler and chat staff member. It also finds a chat the caller is
 * not (yet) a member of, which the old client path could not see and so
 * created a duplicate.
 */
export async function ensureTripConversation(tripId: string, title: string): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_trip_conversation', { p_trip_id: tripId });
  if (!error && data) return data as string;

  // Only for a database that does not have the RPC yet (PGRST202: function not
  // found). Any other error is real and must surface.
  if (error && error.code !== 'PGRST202') throw error;
  const existing = await messagingService.getConversationByTripId(tripId);
  if (existing) return existing.id;
  const conv = await messagingService.createGroupConversation(title, [], { trip_id: tripId });
  return conv.id;
}
