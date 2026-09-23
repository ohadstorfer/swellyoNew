/**
 * Mute / unmute one conversation for the current user.
 *
 * Shared by the chat's own menu (DirectGroupChat) and the trip page's ⋮ menu
 * (the trip Chat tab has no chat header, so its mute lives there).
 *
 * The mute state is read from MessagingProvider, so the label is right at once
 * with no fetch. A change is dispatched optimistically, saved, re-dispatched
 * after the server confirms (so a racing REPLACE_ALL / SYNC_FROM_SERVER cannot
 * undo it), written to the conversation-list cache, and rolled back on error.
 */
import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useMessaging } from '../context/MessagingProvider';
import { messagingService, getMuteUntilFromMember } from '../services/messaging/messagingService';
import {
  loadCachedConversationList,
  saveCachedConversationList,
} from '../services/messaging/conversationListCache';

export function useConversationMute(
  conversationId: string | null | undefined,
  userId: string | null | undefined,
) {
  const { conversations, dispatch } = useMessaging();

  const mutedUntil = useMemo(() => {
    if (!conversationId || !userId) return null;
    const conv = conversations.find(c => c.id === conversationId);
    const me = conv?.members?.find(m => m.user_id === userId);
    return getMuteUntilFromMember(me);
  }, [conversations, conversationId, userId]);

  const applyMute = useCallback(
    async (until: Date | null) => {
      if (!conversationId || !userId) return;
      const effective = until && until.getTime() > Date.now() ? until : null;
      const newMutedUntil = effective?.toISOString() ?? null;

      // Optimistic first, so the menu and the conversations list change at
      // once. UPDATE_MEMBER_PREFERENCES does NOT reorder the list.
      const currentConv = conversations.find(c => c.id === conversationId);
      const existingPrefs =
        currentConv?.members?.find(m => m.user_id === userId)?.preferences ?? {};
      const setPrefs = (preferences: any) =>
        dispatch({
          type: 'UPDATE_MEMBER_PREFERENCES',
          payload: { conversationId, userId, preferences },
        });
      setPrefs({ ...existingPrefs, muted_until: newMutedUntil });

      try {
        await messagingService.setMuteUntil(conversationId, until);
        setPrefs({ ...existingPrefs, muted_until: newMutedUntil });
        // Persist to the list cache, or a reload from cache would bring back
        // the old preferences.
        try {
          const cached = await loadCachedConversationList();
          if (cached) {
            const updated = cached.map(c =>
              c.id === conversationId
                ? {
                    ...c,
                    members: (c.members ?? []).map(m =>
                      m.user_id === userId
                        ? { ...m, preferences: { ...(m.preferences ?? {}), muted_until: newMutedUntil } }
                        : m,
                    ),
                  }
                : c,
            );
            await saveCachedConversationList(updated);
          }
        } catch (cacheErr) {
          console.warn('[useConversationMute] cache update after mute failed:', cacheErr);
        }
      } catch (err) {
        console.warn('[useConversationMute] setMuteUntil failed:', err);
        setPrefs(existingPrefs);
        Alert.alert('Error', 'Could not update mute settings. Please try again.');
      }
    },
    [conversationId, userId, conversations, dispatch],
  );

  return { mutedUntil, applyMute };
}
