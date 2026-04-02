import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';

const REPORT_REASONS = [
  'Inappropriate content',
  'Harmful suggestion',
  'Offensive',
  'Other',
];

interface ReportAISheetProps {
  visible: boolean;
  messageText: string;
  chatType: 'onboarding' | 'matching';
  onClose: () => void;
  onReported?: () => void;
}

async function sendAIReport(messageText: string, reason: string, chatType: string): Promise<void> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Supabase not configured');

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || anonKey;

  const { data: { user } } = await supabase.auth.getUser();
  const userEmail = user?.email || 'Unknown';
  const userName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Unknown';

  const response = await fetch(`${supabaseUrl}/functions/v1/report-ai-response`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userName,
      userEmail,
      reason,
      messageText: messageText.substring(0, 1000),
      chatType,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Request failed (${response.status})`);
  }
}

export function ReportAISheet({ visible, messageText, chatType, onClose, onReported }: ReportAISheetProps) {
  const slideAnim = useRef(new Animated.Value(300)).current;
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const confirmFade = useRef(new Animated.Value(0)).current;
  const confirmScale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(300);
      setShowConfirmation(false);
      setIsSending(false);
      confirmFade.setValue(0);
      confirmScale.setValue(0.9);
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleReport = async (reason: string) => {
    setIsSending(true);
    try {
      await sendAIReport(messageText, reason, chatType);
    } catch (error) {
      console.error('[ReportAISheet] Error sending report:', error);
    }
    setIsSending(false);
    onReported?.();

    // Slide sheet down, then show confirmation
    Animated.timing(slideAnim, {
      toValue: 300,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowConfirmation(true);
      Animated.parallel([
        Animated.timing(confirmFade, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(confirmScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
      ]).start();
    });
  };

  const handleClose = () => {
    Animated.timing(slideAnim, {
      toValue: 300,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const handleConfirmationClose = () => {
    Animated.timing(confirmFade, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowConfirmation(false);
      onClose();
    });
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none">
      {!showConfirmation ? (
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Animated.View
            style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
            onStartShouldSetResponder={() => true}
          >
            {/* Drag handle */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* Title */}
            <Text style={styles.title}>Report AI response</Text>

            {/* Options */}
            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={styles.option}
                onPress={() => handleReport(reason)}
                activeOpacity={0.6}
                disabled={isSending}
              >
                <Text style={[styles.optionText, isSending && { opacity: 0.5 }]}>{reason}</Text>
              </TouchableOpacity>
            ))}

            {isSending && (
              <View style={styles.sendingRow}>
                <ActivityIndicator size="small" color="#B72DF2" />
                <Text style={styles.sendingText}>Sending report...</Text>
              </View>
            )}

            {/* Bottom spacing for safe area */}
            <View style={styles.bottomSpacer} />
          </Animated.View>
        </Pressable>
      ) : (
        <Animated.View style={[styles.confirmBackdrop, { opacity: confirmFade }]}>
          <Animated.View style={[styles.confirmCard, { transform: [{ scale: confirmScale }] }]}>
            <View style={styles.confirmIconCircle}>
              <Ionicons name="checkmark" size={36} color="#FFFFFF" />
            </View>
            <Text style={styles.confirmTitle}>Report sent</Text>
            <Text style={styles.confirmMessage}>
              Thanks for letting us know. We'll review this AI response and take action if needed.
            </Text>
            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirmationClose} activeOpacity={0.7}>
              <Text style={styles.confirmButtonText}>Got it</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D0D0D0',
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
    marginBottom: 8,
  },
  option: {
    paddingVertical: 16,
  },
  optionText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 15,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 20,
  },
  sendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  sendingText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    color: '#7B7B7B',
  },
  bottomSpacer: {
    height: Platform.OS === 'web' ? 24 : 40,
  },
  // Confirmation overlay
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
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
  confirmIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#B72DF2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  confirmTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 12,
  },
  confirmMessage: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#666',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 28,
  },
  confirmButton: {
    backgroundColor: '#B72DF2',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  confirmButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    lineHeight: 22,
  },
});
