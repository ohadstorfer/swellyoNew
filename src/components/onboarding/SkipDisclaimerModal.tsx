import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Text } from '../Text';
import { colors } from '../../styles/theme';

interface Props {
  visible: boolean;
  /** Shown bold in the card. Defaults to "Sure you want to skip?". */
  title?: string;
  /** Body copy explaining why this field matters. */
  message: string;
  /** Confirm-skip button label. Defaults to "Skip anyway". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Go back". */
  cancelLabel?: string;
  onConfirmSkip: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modal shown when the user taps "Skip" on a step that has
 * matching-relevant data. Explains the consequence in plain English; not a
 * blocker — the user can still skip.
 *
 * GestureHandlerRootView wrap is required for Android Modals so any future
 * gestures inside the card actually fire (see memory `feedback_android_modal_gesture_handler_root`).
 */
export const SkipDisclaimerModal: React.FC<Props> = ({
  visible,
  title = 'Sure you want to skip?',
  message,
  confirmLabel = 'Skip anyway',
  cancelLabel = 'Go back',
  onConfirmSkip,
  onCancel,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={styles.card} pointerEvents="box-none">
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirmButton]}
              onPress={onConfirmSkip}
              activeOpacity={0.7}
            >
              <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 20,
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: colors.textPrimary || '#212121',
    textAlign: 'center',
    marginBottom: 8,
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: '#7B7B7B',
    textAlign: 'center',
    marginBottom: 20,
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F5F5F5',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#212121',
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  confirmButton: {
    backgroundColor: '#212121',
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
});

export default SkipDisclaimerModal;
