// Centered modal "reminder" overlay for the create-trip wizard.
// Matches Figma node 12648:3975 — dark scrim, white rounded card (radius 24),
// Montserrat title, grey Inter body, full-width dark dismiss button.
//
// Used to nudge the host that the audience choices describe the GROUP they want
// to travel with, not the host's own ability — so an advanced surfer doesn't
// just pick "Advanced" and lock everyone else out.

import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  Platform,
} from 'react-native';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  scrim: 'rgba(0, 0, 0, 0.5)',
  surface: '#FFFFFF',
  ink: '#333333',
  body: '#7B7B7B',
  white: '#FFFFFF',
};

export interface WizardInfoOverlayProps {
  visible: boolean;
  title: string;
  /** Body copy. Use "\n\n" for a paragraph break. */
  message: string;
  buttonLabel?: string;
  onDismiss: () => void;
}

export const WizardInfoOverlay: React.FC<WizardInfoOverlayProps> = ({
  visible,
  title,
  message,
  buttonLabel = 'Got it',
  onDismiss,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.scrim}>
        <View style={styles.card}>
          <View style={styles.messageContainer}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
            activeOpacity={0.85}
            onPress={onDismiss}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{buttonLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: C.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.surface,
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 24,
    gap: 32,
  },
  messageContainer: {
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
    color: C.ink,
    textAlign: 'center',
  },
  message: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
    color: C.body,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  button: {
    backgroundColor: C.ink,
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontFamily: FONT_INTER,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: C.white,
    textAlign: 'center',
  },
});

export default WizardInfoOverlay;
