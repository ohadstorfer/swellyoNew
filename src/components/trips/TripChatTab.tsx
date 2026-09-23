// The trip page's Chat tab body (docs/specs/trip-chat-tab.md, req 6-10, 14).
//
// Fills everything under the trip's header + tab bar with the group chat.
// Mounted only while the tab is active: leaving the tab unmounts the chat,
// exactly like popping the old chat card did. chatHistoryCache makes coming
// back instant.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { DirectGroupChat } from '../../screens/DirectGroupChat';
import { useMessaging } from '../../context/MessagingProvider';
import { ensureTripConversation, type TripChatMembership } from '../../hooks/trips/useTripChat';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { messageOutbox } from '../../services/messaging/messageOutbox';
import type { TripChatParams } from '../../navigation/navigationRef';
import { ff } from '../../theme/fonts';

interface Props {
  tripId: string;
  title: string;
  heroImageUrl: string | null;
  membership: TripChatMembership | undefined;
  /** Left or removed: history up to `left_at`, no composer. */
  readOnly: boolean;
  chat?: TripChatParams | null;
  searchRequestKey?: number;
  onSearchActiveChange?: (active: boolean) => void;
  onViewProfile?: (userId: string) => void;
  onBack?: () => void;
}

export const TripChatTab: React.FC<Props> = ({
  tripId,
  title,
  heroImageUrl,
  membership,
  readOnly,
  chat,
  searchRequestKey,
  onSearchActiveChange,
  onViewProfile,
  onBack,
}) => {
  const queryClient = useQueryClient();
  const { setCurrentConversationId } = useMessaging();

  // A member row means the server already put them in the chat. Without one
  // (a trip older than trip chats, or a host the old client never added), ask
  // the server to find or create it — it adds everyone who belongs.
  const knownId = membership?.isMember ? membership.conversationId : null;
  const [ensuredId, setEnsuredId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const conversationId = knownId ?? ensuredId;

  const ensure = useCallback(async () => {
    setError(false);
    try {
      const id = await ensureTripConversation(tripId, title || 'Surftrip');
      setEnsuredId(id);
      queryClient.invalidateQueries({ queryKey: tripsKeys.chatMembership(tripId) });
    } catch (e) {
      console.warn('[TripChatTab] could not open the trip chat', e);
      setError(true);
    }
  }, [tripId, title, queryClient]);

  useEffect(() => {
    // Departed users never create anything — they only read what exists.
    if (knownId || ensuredId || readOnly) return;
    ensure();
  }, [knownId, ensuredId, readOnly, ensure]);

  // Messages typed just before they were removed can never be sent now. Drop
  // them instead of letting the outbox retry forever.
  useEffect(() => {
    if (!readOnly || !conversationId) return;
    messageOutbox.dropConversation(conversationId).catch(() => {});
  }, [readOnly, conversationId]);

  // Suppress unread counts and in-app banners only while the chat is really on
  // screen — same pattern as ChatCardScreen in RootNavigator.
  useEffect(() => {
    if (!conversationId) return;
    setCurrentConversationId(conversationId);
    return () => setCurrentConversationId(null);
  }, [conversationId, setCurrentConversationId]);

  if (!conversationId) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.errorText}>Could not open the chat.</Text>
            <TouchableOpacity style={styles.retry} onPress={ensure} activeOpacity={0.8}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ActivityIndicator color="#7B7B7B" />
        )}
      </View>
    );
  }

  return (
    <DirectGroupChat
      embedded
      conversationId={conversationId}
      otherUserId=""
      otherUserName={title || 'Surftrip'}
      otherUserAvatar={heroImageUrl}
      isDirect={false}
      tripId={tripId}
      readOnly={readOnly}
      targetMessageId={chat?.targetMessageId}
      sharedMedia={readOnly ? undefined : chat?.sharedMedia}
      reviewCommitment={chat?.reviewCommitment}
      searchRequestKey={searchRequestKey}
      onSearchActiveChange={onSearchActiveChange}
      onViewProfile={onViewProfile}
      onBack={onBack}
    />
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
    backgroundColor: '#F5F5F5',
  },
  errorText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 18,
    color: '#7B7B7B',
    textAlign: 'center',
  },
  retry: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#212121',
  },
  retryText: {
    fontFamily: ff('Inter', '700'),
    ...(Platform.OS === 'web' ? { fontWeight: '700' as const } : null),
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
  },
});

export default TripChatTab;
