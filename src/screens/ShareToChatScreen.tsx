/**
 * ShareToChatScreen — "Send to…" picker for OS-level shares.
 *
 * Reached two ways:
 *  - Android: always (ACTION_SEND launches MainActivity in-process)
 *  - iOS: when the share extension fell back to opening the app (media, expired
 *    token, empty recents cache, unparseable vCard)
 *
 * It consumes the PendingShare that AppContent staged, sends through the
 * existing messagingService paths — no new send logic — then swaps itself for
 * the ChatCard so the user lands inside the conversation they just sent to.
 *
 * Media never sends from here: it hands off to the chat composer's existing
 * preview state (caption + Send), reusing the upload-first pipeline untouched.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { useNavigation, StackActions } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';

import { useMessaging } from '../context/MessagingProvider';
import { consumePendingShare, type PendingShare } from '../services/shareIntake';
import { messagingService, type Conversation } from '../services/messaging/messagingService';
import { getStorageThumbUrl } from '../services/media/imageService';
import { showErrorAlert } from '../utils/friendlyError';
import { ff, fs } from '../theme/fonts';

const ACCENT = '#05BCD3';
const TEXT = '#222B30';
const MUTED = '#7B7B7B';
const HAIRLINE = '#ECECEC';

function previewLine(share: PendingShare): string {
  switch (share.kind) {
    case 'contact':
      return `Contact · ${share.contact.display_name}`;
    case 'url':
      return share.url;
    case 'text':
      return share.text;
    case 'media': {
      const n = share.files.length;
      const isVideo = share.files[0]?.mimeType?.startsWith('video/');
      if (n > 1) return `${n} photos`;
      return isVideo ? 'Video' : 'Photo';
    }
  }
}

function titleOf(c: Conversation): string {
  if (c.is_direct) return c.other_user?.name || 'Chat';
  return c.title || c.metadata?.title || 'Group';
}

function avatarOf(c: Conversation): string | null {
  const raw = c.is_direct ? c.other_user?.profile_image_url : c.metadata?.image_url;
  return getStorageThumbUrl(raw, 96);
}

export function ShareToChatScreen() {
  const navigation = useNavigation<any>();
  const { conversations } = useMessaging();

  // Consume once, on first render. A second mount (or a double deep-link) finds
  // nothing and backs out rather than re-sending.
  const [share] = useState<PendingShare | null>(() => consumePendingShare());
  const [query, setQuery] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    if (!share) navigation.goBack();
  }, [share, navigation]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(c => titleOf(c).toLowerCase().includes(q));
  }, [conversations, query]);

  const openChat = (c: Conversation, sharedMedia?: { uri: string; mimeType: string; kind: 'image' | 'video' }) => {
    navigation.dispatch(
      StackActions.replace('ChatCard', {
        conversationId: c.id,
        otherUserId: c.other_user?.user_id ?? '',
        otherUserName: titleOf(c),
        otherUserAvatar: c.other_user?.profile_image_url ?? null,
        isDirect: !!c.is_direct,
        sharedMedia,
      }),
    );
  };

  const sendTo = async (c: Conversation) => {
    if (!share || sendingTo || sentRef.current) return;

    if (share.kind === 'media') {
      const first = share.files[0];
      sentRef.current = true;
      openChat(c, {
        uri: first.uri,
        mimeType: first.mimeType,
        kind: first.mimeType.startsWith('video/') ? 'video' : 'image',
      });
      return;
    }

    setSendingTo(c.id);
    try {
      if (share.kind === 'contact') {
        await messagingService.createContactMessageWithMetadata(
          c.id,
          share.contact,
          Crypto.randomUUID(),
        );
      } else {
        const body = share.kind === 'url' ? share.url : share.text;
        await messagingService.sendMessage(c.id, body, [], 'text', Crypto.randomUUID());
      }
      sentRef.current = true;
      openChat(c);
    } catch (e) {
      showErrorAlert('Could not share', e, 'Please try again.');
      setSendingTo(null);
    }
  };

  if (!share) return null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Share to</Text>
        <View style={styles.cancel} />
      </View>

      <View style={styles.previewRow}>
        <Ionicons
          name={
            share.kind === 'contact'
              ? 'person-circle-outline'
              : share.kind === 'media'
                ? 'image-outline'
                : 'link-outline'
          }
          size={16}
          color={MUTED}
        />
        <Text style={styles.previewText} numberOfLines={2}>
          {previewLine(share)}
        </Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={MUTED} />
        <TextInput
          style={styles.search}
          placeholder="Search chats"
          placeholderTextColor={MUTED}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={c => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={filtered.length === 0 && styles.emptyWrap}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {conversations.length === 0 ? 'No chats yet.' : 'No chats match that search.'}
          </Text>
        }
        renderItem={({ item }) => {
          const busy = sendingTo === item.id;
          const avatar = avatarOf(item);
          return (
            <Pressable
              onPress={() => sendTo(item)}
              disabled={!!sendingTo}
              // Instant press feedback — the row is the button.
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              android_ripple={{ color: '#00000010' }}
            >
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons
                    name={item.is_direct ? 'person' : 'people'}
                    size={18}
                    color="#FFFFFF"
                  />
                </View>
              )}
              <Text style={styles.rowTitle} numberOfLines={1}>
                {titleOf(item)}
              </Text>
              {busy ? (
                <ActivityIndicator size="small" color={ACCENT} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={MUTED} />
              )}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancel: { minWidth: 64 },
  cancelText: { fontFamily: ff('Inter', '400'), fontSize: fs(16), color: ACCENT },
  headerTitle: { fontFamily: ff('Inter', '600'), fontSize: fs(17), color: TEXT },
  // Pressed feedback: subtle, instant. Nothing here is seen often enough to animate.
  pressed: { opacity: 0.6 },

  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  previewText: { flex: 1, fontFamily: ff('Inter', '400'), fontSize: fs(13), color: MUTED },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F4F5F6',
  },
  search: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: fs(15),
    color: TEXT,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
    padding: 0,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#D9D9D9' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#B0B7BC' },
  rowTitle: { flex: 1, fontFamily: ff('Inter', '500'), fontSize: fs(16), color: TEXT },

  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: ff('Inter', '400'), fontSize: fs(15), color: MUTED },
});

export default ShareToChatScreen;
