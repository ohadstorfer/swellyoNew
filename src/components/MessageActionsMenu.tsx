import React from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Platform } from 'react-native';
import { Text } from './Text';
import { colors, spacing } from '../styles/theme';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

interface MessageActionsMenuProps {
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean; // Whether message is within edit window
  canDelete: boolean; // Whether message can be deleted
  messagePosition: { x: number; y: number }; // Position for menu placement
}

export const MessageActionsMenu: React.FC<MessageActionsMenuProps> = ({
  visible,
  onClose,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
  messagePosition,
}) => {
  // Only log when visible to reduce noise
  if (visible) {
    console.log('[MessageActionsMenu] Render (visible)', { visible, canEdit, canDelete });
  }

  const handleEdit = () => {
    console.log('[MessageActionsMenu] handleEdit called');
    onEdit();
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

  // Google Material Design Edit Icon Component
  const EditIcon = ({ size = 20, color = colors.text }: { size?: number; color?: string }) => (
    <Svg height={size} viewBox="0 -960 960 960" width={size} fill={color}>
      <Path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z" />
    </Svg>
  );

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
          {canEdit && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleEdit}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>Edit</Text>
              <EditIcon size={20} color={colors.text} />
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
              <Ionicons name="trash" size={20} color="#FF3B30" />
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  deleteText: {
    color: '#FF3B30',
  },
});


