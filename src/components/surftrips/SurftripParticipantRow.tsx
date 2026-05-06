import React from 'react';
import { View, StyleSheet, Image, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import type { EnrichedSurftripMember } from '../../types/surftrips';

interface SurftripParticipantRowProps {
  participant: EnrichedSurftripMember;
  onMenuPress?: (participant: EnrichedSurftripMember) => void;
  isMe?: boolean;
}

const formatBoard = (board: string | null): string | null =>
  board ? board.replace(/_/g, ' ') : null;
const formatLevel = (level: string | null): string | null =>
  level ? level.charAt(0).toUpperCase() + level.slice(1) : null;

export const SurftripParticipantRow: React.FC<SurftripParticipantRowProps> = ({
  participant,
  onMenuPress,
  isMe,
}) => {
  const { name, age, profile_image_url, surfboard_type, surf_level_category, role } = participant;
  const board = formatBoard(surfboard_type);
  const level = formatLevel(surf_level_category);
  const roleLabel = role === 'host' ? 'Host' : role === 'admin' ? 'Admin' : null;
  const detailLine = [age != null ? `${age} yo` : null, level, board].filter(Boolean).join(' · ');

  return (
    <View style={styles.row}>
      <View style={styles.avatarWrap}>
        {profile_image_url ? (
          <Image source={{ uri: profile_image_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial}>{(name || 'U').charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {name || 'User'}
            {isMe ? <Text style={styles.youTag}>  You</Text> : null}
          </Text>
          {roleLabel ? (
            <View style={styles.rolePill}>
              <Text style={styles.rolePillText}>{roleLabel}</Text>
            </View>
          ) : null}
        </View>
        {!!detailLine && (
          <Text style={styles.detail} numberOfLines={1}>
            {detailLine}
          </Text>
        )}
      </View>

      {onMenuPress ? (
        <TouchableOpacity
          style={styles.kebab}
          onPress={() => onMenuPress(participant)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={`Manage ${name || 'member'}`}
        >
          <Ionicons name="ellipsis-vertical" size={18} color="#7B7B7B" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  avatarWrap: { marginRight: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F2F2F2' },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A8DDE0' },
  avatarInitial: { color: '#FFFFFF', fontWeight: '700', fontSize: 18 },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222B30',
    flexShrink: 1,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  youTag: { color: '#7B7B7B', fontWeight: '500', fontSize: 13 },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#E6F4F8',
    borderRadius: 4,
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0788B0',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  detail: {
    fontSize: 13,
    color: '#7B7B7B',
    marginTop: 2,
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  kebab: { marginLeft: 8, padding: 4 },
});
