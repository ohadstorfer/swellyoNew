import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
  Modal,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { blockingService } from '../services/blocking/blockingService';

interface ReportUserOverlayProps {
  visible: boolean;
  reportedUserId: string;
  reportedUserName: string;
  onClose: () => void;
  onBlocked?: () => void;
}

async function sendUserReport(reportedUserId: string, reportedUserName: string, alsoBlocked: boolean, details: string): Promise<void> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Supabase not configured');

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || anonKey;

  const { data: { user } } = await supabase.auth.getUser();
  const reporterEmail = user?.email || 'Unknown';
  const reporterName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Unknown';

  const response = await fetch(`${supabaseUrl}/functions/v1/report-user`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reporterName,
      reporterEmail,
      reportedName: reportedUserName,
      reportedId: reportedUserId,
      alsoBlocked,
      details: details || '',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Request failed (${response.status})`);
  }
}

export function ReportUserOverlay({ visible, reportedUserId, reportedUserName, onClose, onBlocked }: ReportUserOverlayProps) {
  const [blockChecked, setBlockChecked] = useState(false);
  const [details, setDetails] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const confirmFade = useRef(new Animated.Value(0)).current;
  const confirmScale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      setBlockChecked(false);
      setDetails('');
      setShowConfirmation(false);
      setIsSending(false);
      fade.setValue(0);
      scale.setValue(0.9);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const handleReport = async () => {
    if (isSending) return;
    setIsSending(true);

    try {
      await sendUserReport(reportedUserId, reportedUserName, blockChecked, details);
      if (blockChecked) {
        await blockingService.blockUser(reportedUserId);
      }
    } catch (error) {
      console.error('[ReportUserOverlay] Error:', error);
    }
    setIsSending(false);

    // If block was checked, trigger onBlocked callback
    if (blockChecked && onBlocked) {
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        onBlocked();
      });
      return;
    }

    // Show confirmation
    Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setShowConfirmation(true);
      confirmFade.setValue(0);
      confirmScale.setValue(0.9);
      Animated.parallel([
        Animated.timing(confirmFade, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(confirmScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
      ]).start();
    });
  };

  const handleClose = () => {
    const activeFade = showConfirmation ? confirmFade : fade;
    Animated.timing(activeFade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setShowConfirmation(false);
      onClose();
    });
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {!showConfirmation ? (
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
            {/* Icon */}
            <View style={styles.iconContainer}>
              <Ionicons name="thumbs-down-outline" size={32} color="#333" />
            </View>

            {/* Title */}
            <Text style={styles.title}>Report this user</Text>

            {/* Description */}
            <Text style={styles.description}>
              We may review recent messages in this chat to understand what happened. Don't worry they won't know you reported them.
            </Text>

            {/* Details input */}
            <TextInput
              style={styles.textInput}
              placeholder="Tell us more (optional)"
              placeholderTextColor="#999"
              value={details}
              onChangeText={setDetails}
              multiline
              textAlignVertical="top"
              maxLength={1000}
            />

            {/* Block checkbox */}
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setBlockChecked(!blockChecked)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, blockChecked && styles.checkboxChecked]}>
                {blockChecked && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
              </View>
              <View style={styles.checkboxTextContainer}>
                <Text style={styles.checkboxLabel}>Block user</Text>
                <Text style={styles.checkboxSubtext}>They won't be able to contact you or see your profile anymore.</Text>
              </View>
            </TouchableOpacity>

            {/* Buttons */}
            <View style={styles.buttons}>
              <TouchableOpacity style={styles.cancelButton} onPress={handleClose} activeOpacity={0.7}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportButton, isSending && { opacity: 0.7 }]}
                onPress={handleReport}
                activeOpacity={0.7}
                disabled={isSending}
              >
                {isSending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.reportButtonText}>Report</Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.backdrop, { opacity: confirmFade }]}>
          <Animated.View style={[styles.confirmCard, { transform: [{ scale: confirmScale }] }]}>
            <View style={styles.confirmIconCircle}>
              <Ionicons name="checkmark" size={36} color="#FFFFFF" />
            </View>
            <Text style={styles.confirmTitle}>Report sent</Text>
            <Text style={styles.confirmMessage}>
              Thanks for letting us know. We'll review this and take action if needed.
            </Text>
            <TouchableOpacity style={styles.confirmButton} onPress={handleClose} activeOpacity={0.7}>
              <Text style={styles.confirmButtonText}>Got it</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#999',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  textInput: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
    backgroundColor: '#F7F7F7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E3E3E3',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 80,
    maxHeight: 150,
    alignSelf: 'stretch',
    marginBottom: 20,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    gap: 12,
    marginBottom: 24,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#CFCFCF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#0788B0',
    borderColor: '#0788B0',
  },
  checkboxTextContainer: {
    flex: 1,
  },
  checkboxLabel: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#333',
    lineHeight: 20,
  },
  checkboxSubtext: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    fontWeight: '400' as const,
    color: '#999',
    lineHeight: 18,
    marginTop: 2,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'stretch',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 15,
    fontWeight: '500' as const,
    color: '#333',
    lineHeight: 20,
  },
  reportButton: {
    flex: 1,
    backgroundColor: '#0788B0',
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  reportButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    lineHeight: 20,
  },
  // Confirmation
  confirmCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
  },
  confirmIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#0788B0',
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
    backgroundColor: '#0788B0',
    borderRadius: 28,
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
