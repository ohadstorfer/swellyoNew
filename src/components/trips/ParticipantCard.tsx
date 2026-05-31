import React from 'react';
import { View, Text, StyleSheet, Image, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ParticipantProfile } from '../../services/trips/groupTripsService';

interface ParticipantCardProps {
  participant: ParticipantProfile & { role?: 'host' | 'member'; committed?: boolean };
  rightSlot?: React.ReactNode;
  onRemove?: (userId: string) => void;
  isMe?: boolean;
  /** Tap on the avatar/info area opens the participant's profile. */
  onPress?: (userId: string) => void;
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
  isMe,
  onPress,
}) => {
  const { user_id, name, age, profile_image_url, surfboard_type, surf_level_category, role, committed } =
    participant;

  const board = formatBoard(surfboard_type);
  const level = formatLevel(surf_level_category);
  const detailLine = [age != null ? `${age} yo` : null, level, board].filter(Boolean).join(' · ');

  const TappableArea: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    onPress ? (
      <TouchableOpacity
        style={styles.tappableArea}
        onPress={() => onPress(user_id)}
        activeOpacity={0.6}
        accessibilityLabel={`Open ${name || 'participant'}'s profile`}
      >
        {children}
      </TouchableOpacity>
    ) : (
      <View style={styles.tappableArea}>{children}</View>
    );

  return (
    <View style={styles.row}>
      <TappableArea>
        <View style={styles.avatarWrap}>
          {profile_image_url ? (
            <Image source={{ uri: profile_image_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitial}>{(name || 'U').charAt(0).toUpperCase()}</Text>
            </View>
          )}
          {committed && (
            <View
              style={styles.committedBadge}
              accessibilityLabel={`${name || 'Participant'} is committed to this trip`}
            >
              <Ionicons name="checkmark" size={11} color="#FFFFFF" />
            </View>
          )}
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {name || 'User'}
              {isMe ? <Text style={styles.youTag}>  (You)</Text> : null}
            </Text>
            {role === 'host' && (
              <View style={styles.adminPill}>
                <Text style={styles.adminPillText}>Admin</Text>
              </View>
            )}
          </View>
          {!!detailLine && (
            <Text style={styles.detail} numberOfLines={1}>
              {detailLine}
            </Text>
          )}
        </View>
      </TappableArea>

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
  },
  tappableArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  avatarWrap: { position: 'relative', marginRight: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F2F2F2',
  },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A8DDE0' },
  avatarInitial: { color: '#FFFFFF', fontWeight: '700', fontSize: 18 },
  committedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#34C759',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
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
  adminPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#E6F4F8',
    borderRadius: 4,
  },
  adminPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0788B0',
    letterSpacing: 0.2,
  },
  detail: {
    fontSize: 13,
    color: '#7B7B7B',
    marginTop: 2,
    ...(Platform.OS === 'web' ? { fontFamily: 'Inter, sans-serif' } : {}),
  },
  right: { marginLeft: 8 },
  removeBtn: { marginLeft: 8, padding: 4 },
});

export default ParticipantCard;
