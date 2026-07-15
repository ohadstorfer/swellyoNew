import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { blockingService } from '../services/blocking/blockingService';
import {
  sendUserReport,
  REPORT_REASONS,
  ReportedMessageContext,
} from '../screens/ReportUserScreen';
import { BottomSheetShell } from './BottomSheetShell';

const greenSuccessImg = require('../assets/icons/green-success.png');

interface ReportMessageSheetProps {
  visible: boolean;
  reportedUserId: string;
  reportedUserName: string;
  reportedMessage: ReportedMessageContext | null;
  onClose: () => void;
  /** Called after a successful report when the user also chose to block. */
  onBlocked?: () => void;
}

/**
 * Bottom-sheet version of the "report this message" flow. The sheet itself rides
 * the shared BottomSheetShell (scrim fades, sheet slides, swipe-to-dismiss); the
 * post-submit confirmation is a separate centered card with its own fade.
 * Reuses ReportUserScreen's network call so the payload stays identical.
 */
export function ReportMessageSheet({
  visible,
  reportedUserId,
  reportedUserName,
  reportedMessage,
  onClose,
  onBlocked,
}: ReportMessageSheetProps) {
  const insets = useSafeAreaInsets();
  const confirmFade = useRef(new Animated.Value(0)).current;
  const confirmScale = useRef(new Animated.Value(0.9)).current;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [blockUser, setBlockUser] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    if (visible) {
      // Reset everything each time the sheet opens.
      confirmFade.setValue(0);
      confirmScale.setValue(0.9);
      setDropdownOpen(false);
      setSelectedReason(null);
      setBlockUser(false);
      setIsSending(false);
      setShowConfirmation(false);
    }
  }, [visible]);

  const handleReport = async () => {
    if (!selectedReason || isSending) return;
    setIsSending(true);
    try {
      await sendUserReport(reportedUserId, reportedUserName, selectedReason, blockUser, reportedMessage ?? undefined);
      if (blockUser) {
        await blockingService.blockUser(reportedUserId);
      }
    } catch (error) {
      console.error('[ReportMessageSheet] Error:', error);
    }
    setIsSending(false);

    // Flip to confirmation: the shell slides the sheet away (visible goes false),
    // and the confirmation card fades in.
    setShowConfirmation(true);
    Animated.parallel([
      Animated.timing(confirmFade, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(confirmScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
  };

  const handleConfirmationClose = () => {
    Animated.timing(confirmFade, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowConfirmation(false);
      if (blockUser && onBlocked) onBlocked();
      else onClose();
    });
  };

  return (
    <>
      <BottomSheetShell
        visible={visible && !showConfirmation}
        onClose={onClose}
        backdropColor="rgba(33, 33, 33, 0.6)"
      >
        {({ panHandlers }) => (
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            {/* Drag handle — swipe down to dismiss */}
            <View style={styles.handleContainer} {...panHandlers}>
              <View style={styles.handle} />
            </View>

            <Text style={styles.title}>Report this message</Text>
            <Text style={styles.description}>
              We may review this message and the surrounding chat to understand what happened. Don't worry, they won't know you reported them.
            </Text>

            {/* Reason dropdown */}
            <TouchableOpacity
              style={styles.dropdown}
              onPress={() => setDropdownOpen(!dropdownOpen)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dropdownText, selectedReason && styles.dropdownTextSelected]}>
                {selectedReason || 'Why are you reporting this message?'}
              </Text>
              <Ionicons name={dropdownOpen ? 'chevron-up' : 'chevron-down'} size={24} color="#7B7B7B" />
            </TouchableOpacity>

            {dropdownOpen && (
              <View style={styles.dropdownOptions}>
                {REPORT_REASONS.map((reason) => (
                  <TouchableOpacity
                    key={reason}
                    style={[styles.dropdownOption, selectedReason === reason && styles.dropdownOptionSelected]}
                    onPress={() => {
                      setSelectedReason(reason);
                      setDropdownOpen(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dropdownOptionText, selectedReason === reason && styles.dropdownOptionTextSelected]}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.divider} />

            {/* Block user */}
            <TouchableOpacity style={styles.checkboxRow} onPress={() => setBlockUser(!blockUser)} activeOpacity={0.7}>
              <View style={[styles.checkbox, blockUser && styles.checkboxChecked]}>
                {blockUser && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
              </View>
              <Text style={styles.blockTitle}>Block user</Text>
            </TouchableOpacity>
            <Text style={styles.blockDescription}>
              They won't be able to contact you or see your profile anymore.
            </Text>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.reportButton, !selectedReason && styles.reportButtonDisabled]}
              onPress={handleReport}
              activeOpacity={0.7}
              disabled={!selectedReason || isSending}
            >
              {isSending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.reportButtonText}>Report Message</Text>
              )}
            </TouchableOpacity>
            {!selectedReason && <Text style={styles.helperText}>Please choose a reason before reporting</Text>}
          </View>
        )}
      </BottomSheetShell>

      {showConfirmation && (
        <Animated.View style={[styles.confirmBackdrop, { opacity: confirmFade }]}>
          <Animated.View style={[styles.confirmCard, { transform: [{ scale: confirmScale }] }]}>
            <Text style={styles.confirmTitle}>Report received</Text>
            <Text style={styles.confirmMessage}>
              {"We'll review this case shortly.\nThey won't know you reported them."}
            </Text>
            <Image source={greenSuccessImg} style={styles.successImage} resizeMode="contain" />
            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirmationClose} activeOpacity={0.7}>
              <Text style={styles.confirmButtonText}>{blockUser ? 'Done' : 'Back to chat'}</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}
    </>
  );
}

const FONT = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_HEADING = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D0D0D0',
  },
  title: {
    fontFamily: FONT_HEADING,
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    lineHeight: 24,
    marginBottom: 8,
  },
  description: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: '#333',
    lineHeight: 18,
    marginBottom: 16,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    height: 56,
    paddingHorizontal: 16,
    gap: 8,
  },
  dropdownText: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: '#7B7B7B',
    lineHeight: 18,
  },
  dropdownTextSelected: {
    color: '#333',
  },
  dropdownOptions: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden',
  },
  dropdownOption: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  dropdownOptionSelected: {
    backgroundColor: '#F7F7F7',
  },
  dropdownOptionText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: '#333',
    lineHeight: 18,
  },
  dropdownOptionTextSelected: {
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#E3E3E3',
    marginVertical: 20,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#212121',
    borderColor: '#212121',
  },
  blockTitle: {
    fontFamily: FONT_HEADING,
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    lineHeight: 24,
  },
  blockDescription: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '400',
    color: '#333',
    lineHeight: 18,
    marginBottom: 24,
  },
  reportButton: {
    backgroundColor: '#212121',
    borderRadius: 12,
    height: 56,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  reportButtonDisabled: {
    opacity: 0.4,
  },
  reportButtonText: {
    fontFamily: FONT_HEADING,
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 24,
  },
  helperText: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '400',
    color: '#333',
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 12,
  },
  // Confirmation overlay
  confirmBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    zIndex: 20,
  },
  confirmCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  confirmTitle: {
    fontFamily: FONT_HEADING,
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    lineHeight: 32,
    textAlign: 'center',
    marginBottom: 8,
  },
  confirmMessage: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '400',
    color: '#333',
    lineHeight: 22,
    textAlign: 'center',
  },
  successImage: {
    width: 180,
    height: 180,
    marginVertical: 16,
  },
  confirmButton: {
    backgroundColor: '#212121',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  confirmButtonText: {
    fontFamily: FONT_HEADING,
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 22,
  },
});
