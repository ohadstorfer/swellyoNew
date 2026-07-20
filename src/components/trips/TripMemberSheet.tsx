// WhatsApp-style member action sheet for the Trip Members screen.
// Renders options only; the parent owns confirmation dialogs + RPC calls.
//   Any viewer:              View profile · Message
//   Host viewer, other row:  + Set as admin / Remove as admin, + Remove from trip
// "host" in the DB is shown as "admin" to users (matches AdminBadgeIcon).
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '../BottomSheetShell';
import { SheetOptionRow } from '../sheets/SheetOptionRow';
import Thumb from '../Thumb';
import { Image } from 'expo-image';
import { Images } from '../../assets/images';
import { ff } from '../../theme/fonts';
import type { EnrichedParticipant } from '../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  member: EnrichedParticipant | null;
  viewerIsHost: boolean;
  isSelf: boolean;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onMessage: (userId: string, name?: string, avatar?: string | null) => void;
  onSetAdmin: (member: EnrichedParticipant) => void;
  onRemoveAdmin: (member: EnrichedParticipant) => void;
  onRemove: (member: EnrichedParticipant) => void;
}

const joinedAgo = (iso: string | null): string => {
  if (!iso) return '';
  const day = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (day <= 0) return 'Joined today';
  if (day < 7) return `Joined ${day} day${day === 1 ? '' : 's'} ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `Joined ${wk} week${wk === 1 ? '' : 's'} ago`;
  const mo = Math.floor(day / 30);
  return `Joined ${mo} month${mo === 1 ? '' : 's'} ago`;
};

export function TripMemberSheet({
  visible, member, viewerIsHost, isSelf, onClose,
  onViewProfile, onMessage, onSetAdmin, onRemoveAdmin, onRemove,
}: Props) {
  const insets = useSafeAreaInsets();
  const m = member;
  // Close first, then run the action, so the confirm Alert sits above nothing.
  const wrap = (fn: () => void) => () => { onClose(); fn(); };
  const canManage = viewerIsHost && !isSelf && !!m;

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
        {m ? (
          <>
            <View style={styles.header}>
              {m.profile_image_url ? (
                <Thumb uri={m.profile_image_url} size={128} style={styles.avatar} contentFit="cover" cachePolicy="memory-disk" />
              ) : (
                <Image source={Images.defaultAvatar} style={styles.avatar} contentFit="cover" />
              )}
              <Text style={styles.name} numberOfLines={1}>{m.name ?? 'User'}</Text>
              <Text style={styles.sub} numberOfLines={1}>{joinedAgo(m.joined_at)}</Text>
            </View>

            <View style={styles.group}>
              <SheetOptionRow icon="person-outline" label="View profile" onPress={wrap(() => onViewProfile(m.user_id))} />
              <SheetOptionRow icon="chatbubble-outline" label="Message" onPress={wrap(() => onMessage(m.user_id, m.name ?? undefined, m.profile_image_url))} />
              {canManage && m.role === 'member' ? (
                <SheetOptionRow icon="shield-checkmark-outline" label="Set as admin" onPress={wrap(() => onSetAdmin(m))} />
              ) : null}
              {canManage && m.role === 'host' ? (
                <SheetOptionRow icon="shield-outline" label="Remove as admin" onPress={wrap(() => onRemoveAdmin(m))} />
              ) : null}
              {canManage ? (
                <SheetOptionRow icon="person-remove-outline" label="Remove from trip" danger onPress={wrap(() => onRemove(m))} />
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 24 },
  header: { alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  name: { fontFamily: ff('Montserrat', '700'), fontSize: 18, color: '#212121', marginTop: 12, includeFontPadding: false },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 4, includeFontPadding: false },
  group: { marginTop: 4 },
});
