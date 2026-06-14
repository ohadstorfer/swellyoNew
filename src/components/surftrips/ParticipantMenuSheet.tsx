import React from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../Text';
import { useSheetTransition } from '../../hooks/useSheetTransition';
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
  // Slide + swipe-to-dismiss (shared with every other bottom sheet). Called
  // before the early returns so hook order stays stable.
  const { mounted, backdropOpacity, translateY, onSheetLayout, panHandlers } =
    useSheetTransition(visible, onClose);

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
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, { opacity: backdropOpacity }]} />
        <Animated.View style={{ transform: [{ translateY }] }} onLayout={onSheetLayout}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handleZone} {...panHandlers}>
            <View style={styles.handle} />
          </View>
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
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dim: { backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  // Wider grab target around the thin handle bar for the swipe-down gesture.
  handleZone: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 6, marginTop: -6 },
  handle: {
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
