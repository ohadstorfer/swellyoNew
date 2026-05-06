import React from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import type { EnrichedSurftripMember, SurftripRole } from '../../types/surftrips';

interface ParticipantMenuSheetProps {
  visible: boolean;
  participant: EnrichedSurftripMember | null;
  viewerRole: SurftripRole | null;
  onClose: () => void;
  onPromoteToAdmin: (userId: string) => void;
  onDemoteToMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
}

export const ParticipantMenuSheet: React.FC<ParticipantMenuSheetProps> = ({
  visible,
  participant,
  viewerRole,
  onClose,
  onPromoteToAdmin,
  onDemoteToMember,
  onRemoveMember,
}) => {
  if (!participant) return null;

  const isHostViewer = viewerRole === 'host';
  const isAdminViewer = viewerRole === 'admin';
  const targetRole = participant.role;

  const canPromote = isHostViewer && targetRole === 'member';
  const canDemote = isHostViewer && targetRole === 'admin';
  const canRemove =
    (isHostViewer && targetRole !== 'host') ||
    (isAdminViewer && targetRole === 'member');

  const items: Array<{ key: string; label: string; icon: string; danger?: boolean; onPress: () => void }> = [];
  if (canPromote) {
    items.push({
      key: 'promote',
      label: 'Make admin',
      icon: 'shield-checkmark-outline',
      onPress: () => {
        onPromoteToAdmin(participant.user_id);
        onClose();
      },
    });
  }
  if (canDemote) {
    items.push({
      key: 'demote',
      label: 'Remove admin',
      icon: 'shield-outline',
      onPress: () => {
        onDemoteToMember(participant.user_id);
        onClose();
      },
    });
  }
  if (canRemove) {
    items.push({
      key: 'remove',
      label: 'Remove from group',
      icon: 'person-remove-outline',
      danger: true,
      onPress: () => {
        onRemoveMember(participant.user_id);
        onClose();
      },
    });
  }

  if (items.length === 0) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title} numberOfLines={1}>{participant.name || 'User'}</Text>
          {items.map(item => (
            <TouchableOpacity
              key={item.key}
              style={styles.item}
              onPress={item.onPress}
              activeOpacity={0.7}
            >
              <Ionicons
                name={item.icon as any}
                size={20}
                color={item.danger ? '#C0392B' : '#222B30'}
              />
              <Text style={[styles.itemLabel, item.danger && styles.danger]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.item, styles.cancel]} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E1E1E1',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7B7B7B',
    textAlign: 'center',
    paddingVertical: 6,
    marginBottom: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EEE',
  },
  itemLabel: { fontSize: 15, color: '#222B30' },
  danger: { color: '#C0392B' },
  cancel: { justifyContent: 'center' },
  cancelLabel: { fontSize: 15, fontWeight: '600', color: '#7B7B7B', textAlign: 'center', flex: 1 },
});
