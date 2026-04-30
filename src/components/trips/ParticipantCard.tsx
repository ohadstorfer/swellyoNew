import React from 'react';
import { View, Text, StyleSheet, Image, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ParticipantProfile } from '../../services/trips/groupTripsService';

interface ParticipantCardProps {
  participant: ParticipantProfile & { role?: 'host' | 'member' };
  rightSlot?: React.ReactNode;
  /**
   * When provided, renders a kebab/remove button. Used by hosts to expel a member.
   * Not shown for the host card itself — the parent decides who to wire the callback for.
   */
  onRemove?: (userId: string) => void;
}

const formatBoard = (board: string | null): string | null => {
  if (!board) return null;
  return board.replace(/_/g, ' ');
};

const formatLevel = (level: string | null): string | null => {
  if (!level) return null;
  return level.charAt(0).toUpperCase() + level.slice(1);
};

export const ParticipantCard: React.FC<ParticipantCardProps> = ({
  participant,
  rightSlot,
  onRemove,
}) => {
  const { user_id, name, age, profile_image_url, surfboard_type, surf_level_category, role } =
    participant;

  const board = formatBoard(surfboard_type);
  const level = formatLevel(surf_level_category);

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
        {role === 'host' && (
          <View style={styles.hostBadge}>
            <Ionicons name="star" size={10} color="#FFFFFF" />
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name || 'User'}
          {role === 'host' ? <Text style={styles.hostLabel}>  · Host</Text> : null}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {[age != null ? `${age} yo` : null, level, board].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {rightSlot ? <View style={styles.right}>{rightSlot}</View> : null}

      {onRemove ? (
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={() => onRemove(user_id)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={`Remove ${name || 'participant'}`}
        >
          <Ionicons name="close-circle-outline" size={22} color="#C0392B" />
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
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EEE',
    marginBottom: 8,
  },
  avatarWrap: { position: 'relative', marginRight: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F2F2F2',
  },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A8DDE0' },
  avatarInitial: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  hostBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#B72DF2',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  info: { flex: 1, minWidth: 0 },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222B30',
    marginBottom: 2,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  hostLabel: { color: '#B72DF2', fontWeight: '500', fontSize: 12 },
  detail: {
    fontSize: 12,
    color: '#7B7B7B',
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  right: { marginLeft: 8 },
  removeBtn: { marginLeft: 8, padding: 4 },
});

export default ParticipantCard;
