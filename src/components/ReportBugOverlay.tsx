import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Animated,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';

interface ReportBugOverlayProps {
  visible: boolean;
  onClose: () => void;
}

async function sendBugReport(description: string): Promise<void> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Supabase not configured');

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || anonKey;

  const { data: { user } } = await supabase.auth.getUser();
  const userEmail = user?.email || 'Unknown';
  const userName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Unknown';

  const response = await fetch(`${supabaseUrl}/functions/v1/report-bug`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userName,
      userEmail,
      description,
      platform: Platform.OS,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Request failed (${response.status})`);
  }
}

export function ReportBugOverlay({ visible, onClose }: ReportBugOverlayProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const confirmFade = useRef(new Animated.Value(0)).current;
  const confirmScale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (visible) {
      setText('');
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

  const handleSend = async () => {
    if (!text.trim() || isSending) return;
    setIsSending(true);
    try {
      await sendBugReport(text.trim());
    } catch (error) {
      console.error('[ReportBugOverlay] Error:', error);
    }
    setIsSending(false);

    // Fade out form, show confirmation
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
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.bugIconCircle}>
                  <Ionicons name="bug-outline" size={22} color="#0788B0" />
                </View>
                <TouchableOpacity onPress={handleClose} style={styles.closeButton} activeOpacity={0.7}>
                  <Ionicons name="close" size={22} color="#333" />
                </TouchableOpacity>
              </View>

              <Text style={styles.title}>Report a bug</Text>
              <Text style={styles.subtitle}>Tell us what went wrong and we'll look into it</Text>

              {/* Text input */}
              <TextInput
                style={styles.textInput}
                placeholder="Describe the issue..."
                placeholderTextColor="#999"
                value={text}
                onChangeText={setText}
                multiline
                textAlignVertical="top"
                maxLength={2000}
              />

              {/* Send button */}
              <TouchableOpacity
                style={[styles.sendButton, (!text.trim() || isSending) && styles.sendButtonDisabled]}
                onPress={handleSend}
                activeOpacity={0.7}
                disabled={!text.trim() || isSending}
              >
                {isSending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.sendButtonText}>Send</Text>
                )}
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
        ) : (
          <Animated.View style={[styles.backdrop, { opacity: confirmFade }]}>
            <Animated.View style={[styles.confirmCard, { transform: [{ scale: confirmScale }] }]}>
              <View style={styles.confirmIconCircle}>
                <Ionicons name="checkmark" size={36} color="#FFFFFF" />
              </View>
              <Text style={styles.confirmTitle}>Bug report sent</Text>
              <Text style={styles.confirmMessage}>
                Thanks for helping us improve Swellyo! We'll look into this.
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
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 400,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  bugIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E6F4F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: 4,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#999',
    lineHeight: 20,
    marginBottom: 20,
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
    paddingTop: 14,
    paddingBottom: 14,
    minHeight: 120,
    maxHeight: 200,
    marginBottom: 20,
  },
  sendButton: {
    backgroundColor: '#0788B0',
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    lineHeight: 22,
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
