import React from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Platform } from 'react-native';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { Ionicons } from '@expo/vector-icons';

interface MessageActionsMenuProps {
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy?: () => void;
  onReply?: () => void;
  canEdit: boolean; // Whether message is within edit window
  canDelete: boolean; // Whether message can be deleted
  canCopy?: boolean; // Whether message has text that can be copied
  canReply?: boolean; // Whether the message can be replied to
  messagePosition: { x: number; y: number }; // Position for menu placement
}

export const MessageActionsMenu: React.FC<MessageActionsMenuProps> = ({
  visible,
  onClose,
  onEdit,
  onDelete,
  onCopy,
  onReply,
  canEdit,
  canDelete,
  canCopy,
  canReply,
  messagePosition,
}) => {
  // Only log when visible to reduce noise
  if (visible) {
    console.log('[MessageActionsMenu] Render (visible)', { visible, canEdit, canDelete, canCopy, canReply });
  }

  const handleReply = () => {
    console.log('[MessageActionsMenu] handleReply called');
    if (onReply) onReply();
    onClose();
  };

  const handleEdit = () => {
    console.log('[MessageActionsMenu] handleEdit called');
    onEdit();
    onClose();
  };

  const handleCopy = () => {
    console.log('[MessageActionsMenu] handleCopy called');
    if (onCopy) onCopy();
    onClose();
  };

  const handleDelete = () => {
    console.log('[MessageActionsMenu] handleDelete called', { canDelete });
    // Don't close menu immediately - let the delete handler manage it
    // The menu will close after user confirms/cancels the delete dialog
    try {
      console.log('[MessageActionsMenu] Calling onDelete callback');
      onDelete();
      console.log('[MessageActionsMenu] onDelete callback executed');
    } catch (error) {
      console.error('[MessageActionsMenu] Error in onDelete callback:', error);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={(e) => {
            // Prevent overlay from closing when clicking inside menu
            // On web, stopPropagation prevents the event from bubbling to the overlay
            if (Platform.OS === 'web' && e && typeof e.stopPropagation === 'function') {
              e.stopPropagation();
            }
          }}
          style={[
            styles.menu,
            {
              top: messagePosition.y - 100, // Position above the message
              left: messagePosition.x > 200 ? messagePosition.x - 150 : messagePosition.x,
            },
          ]}
        >
          {canReply && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleReply}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Reply</Text>
              <Ionicons name="arrow-undo-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          )}

          {canEdit && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleEdit}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Edit</Text>
              <Ionicons name="create-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          )}

          {canCopy && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleCopy}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Copy</Text>
              <Ionicons name="copy-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          )}

          {canDelete && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                console.log('[MessageActionsMenu] Delete button onPress triggered - START');
                console.log('[MessageActionsMenu] About to call handleDelete');
                handleDelete();
                console.log('[MessageActionsMenu] Delete button onPress - END');
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.menuItemText, styles.deleteText]}>Delete</Text>
              <Ionicons name="trash-outline" size={20} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  menu: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingVertical: spacing.xs,
    minWidth: 150,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  menuItemText: {
    fontSize: 16,
    color: colors.text,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  deleteText: {
    color: '#FF3B30',
  },
});


