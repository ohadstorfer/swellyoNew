import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  ScrollView,
  ActivityIndicator,
  Animated,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Images } from '../assets/images';
import { supabase } from '../config/supabase';

const REASONS = [
  "I don't use Swellyo anymore",
  "I'm not interested",
  "Something else",
  "No reason",
];

const SURFER_IMAGE = Images.deleteAccountSurfer;

interface DeleteAccountScreenProps {
  onBack: () => void;
  userName: string;
  userEmail?: string;
}

async function sendDeleteNotification(userName: string, userEmail: string, reason: string): Promise<void> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Supabase not configured');

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || anonKey;
  const userId = session?.user?.id;

  const response = await fetch(`${supabaseUrl}/functions/v1/delete-account-notification`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userName, userEmail, reason, userId }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Request failed (${response.status})`);
  }
}

export function DeleteAccountScreen({ onBack, userName, userEmail }: DeleteAccountScreenProps) {
  const insets = useSafeAreaInsets();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [showAreYouSure, setShowAreYouSure] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const areYouSureFade = useRef(new Animated.Value(0)).current;
  const areYouSureScale = useRef(new Animated.Value(0.9)).current;
  const overlayFade = useRef(new Animated.Value(0)).current;
  const overlayScale = useRef(new Animated.Value(0.9)).current;

  const displayName = userName && userName !== 'User' ? userName : 'there';
  const isDeleteEnabled = selectedReason !== null && !isDeleting;

  const handleSelectReason = (reason: string) => {
    setSelectedReason(reason);
    setDropdownOpen(false);
  };

  const handleDelete = () => {
    if (!selectedReason) return;
    // Show "are you sure?" dialog
    setShowAreYouSure(true);
    areYouSureFade.setValue(0);
    areYouSureScale.setValue(0.9);
    Animated.parallel([
      Animated.timing(areYouSureFade, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(areYouSureScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
  };

  const handleCancelAreYouSure = () => {
    Animated.timing(areYouSureFade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setShowAreYouSure(false);
    });
  };

  const handleConfirmDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      await sendDeleteNotification(
        userName || 'Unknown',
        userEmail || 'No email provided',
        selectedReason!,
      );
    } catch (error) {
      console.error('[DeleteAccountScreen] Error sending notification:', error);
    }
    setIsDeleting(false);

    // Hide "are you sure", show "request received"
    Animated.timing(areYouSureFade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setShowAreYouSure(false);
      setShowConfirmation(true);
      overlayFade.setValue(0);
      overlayScale.setValue(0.9);
      Animated.parallel([
        Animated.timing(overlayFade, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(overlayScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
      ]).start();
    });
  };

  const handleConfirmationClose = () => {
    Animated.timing(overlayFade, { toValue: 0, duration: 200, useNativeDriver: true }).start(async () => {
      setShowConfirmation(false);
      const { performLogout } = await import('../utils/logout');
      await performLogout({});
    });
  };

  return (
    <View style={styles.container}>
      {/* Back button */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#333" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Divider */}
        <View style={styles.divider} />

        {/* Title */}
        <Text style={styles.title}>Delete my account</Text>

        {/* Farewell message */}
        <View style={styles.messageContainer}>
          <Text style={styles.messageText}>
            {`Hey ${displayName}, are you sure you want to leave? 🤙\nWe'll miss surfing with you.\n\nOnce you confirm, we'll start deleting your account.\nIt will be permanently removed within 30 days.`}
          </Text>
        </View>

        {/* Dropdown */}
        <View style={[styles.dropdownWrapper, { zIndex: 10 }]}>
          <TouchableOpacity
            style={[
              styles.dropdownButton,
              dropdownOpen && styles.dropdownButtonActive,
              selectedReason && !dropdownOpen && styles.dropdownButtonSelected,
            ]}
            onPress={() => setDropdownOpen(!dropdownOpen)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.dropdownButtonText,
                selectedReason ? styles.dropdownButtonTextSelected : styles.dropdownButtonTextPlaceholder,
              ]}
            >
              {selectedReason || 'Why are you leaving?'}
            </Text>
            <Ionicons
              name={dropdownOpen ? 'chevron-down' : 'chevron-forward'}
              size={20}
              color={dropdownOpen ? '#7B7B7B' : '#333'}
            />
          </TouchableOpacity>

          {dropdownOpen && (
            <View style={styles.dropdownList}>
              {REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason}
                  style={styles.dropdownItem}
                  onPress={() => handleSelectReason(reason)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dropdownItemText}>{reason}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sad surfer illustration - positioned absolutely so dropdown doesn't push it */}
      <View style={styles.illustrationContainer} pointerEvents="none">
        <Image
          source={SURFER_IMAGE}
          style={styles.illustration}
          resizeMode="contain"
        />
      </View>

      {/* Bottom area - fixed */}
      <View style={[styles.bottomArea, { paddingBottom: Math.max(insets.bottom, 32) }]}>
        <TouchableOpacity
          style={[styles.deleteButton, !isDeleteEnabled && styles.deleteButtonDisabled]}
          onPress={handleDelete}
          activeOpacity={isDeleteEnabled ? 0.7 : 1}
          disabled={!isDeleteEnabled}
        >
          {isDeleting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.deleteButtonText}>Delete</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.hintText}>
          {isDeleteEnabled
            ? 'This action cannot be undone'
            : 'Please choose a reason before deleting your account'}
        </Text>
      </View>

      {/* "Are you sure?" overlay */}
      <Modal visible={showAreYouSure} transparent animationType="none">
        <Animated.View style={[styles.overlayBackdrop, { opacity: areYouSureFade }]}>
          <Animated.View style={[styles.areYouSureCard, { transform: [{ scale: areYouSureScale }] }]}>
            {/* Trash icon */}
            <View style={styles.trashIconCircle}>
              <Ionicons name="trash-outline" size={24} color="#FB3748" />
            </View>

            {/* Close button */}
            <TouchableOpacity style={styles.areYouSureClose} onPress={handleCancelAreYouSure} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color="#333" />
            </TouchableOpacity>

            <Text style={styles.areYouSureTitle}>Delete this account?</Text>
            <Text style={styles.areYouSureMessage}>
              Your account will be permanently deleted{'\n'}within 30 days
            </Text>

            <View style={styles.areYouSureButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancelAreYouSure} activeOpacity={0.7}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDeleteButton, isDeleting && { opacity: 0.7 }]}
                onPress={handleConfirmDelete}
                activeOpacity={0.7}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.confirmDeleteButtonText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* Confirmation overlay */}
      <Modal visible={showConfirmation} transparent animationType="none">
        <Animated.View style={[styles.overlayBackdrop, { opacity: overlayFade }]}>
          <Animated.View style={[styles.overlayCard, { transform: [{ scale: overlayScale }] }]}>
            <View style={styles.overlayIconCircle}>
              <Ionicons name="checkmark" size={36} color="#FFFFFF" />
            </View>
            <Text style={styles.overlayTitle}>Request received</Text>
            <Text style={styles.overlayMessage}>
              {`We've received your request to delete your account. It will be permanently removed within 30 days.\n\nIf you change your mind, just log back in and we'll cancel the process. 🤙`}
            </Text>
            <TouchableOpacity style={styles.overlayButton} onPress={handleConfirmationClose} activeOpacity={0.7}>
              <Text style={styles.overlayButtonText}>Got it</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topBar: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE',
    borderRadius: 48,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 10,
    height: 40,
    minWidth: 70,
  },
  backButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 15,
  },
  scrollView: {
    flex: 1,
    zIndex: 2,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#E3E3E3',
    marginBottom: 24,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
    marginBottom: 8,
  },
  messageContainer: {
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
  },
  messageText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 18,
  },
  dropdownWrapper: {
    marginTop: 8,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    height: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dropdownButtonActive: {
    backgroundColor: '#F7F7F7',
    borderColor: '#0788B0',
  },
  dropdownButtonSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#CFCFCF',
  },
  dropdownButtonText: {
    flex: 1,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    lineHeight: 18,
  },
  dropdownButtonTextPlaceholder: {
    color: '#7B7B7B',
  },
  dropdownButtonTextSelected: {
    color: '#222B30',
  },
  dropdownList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  dropdownItem: {
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
  },
  dropdownItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#222B30',
    lineHeight: 18,
  },
  illustrationContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 120,
    alignItems: 'center',
    zIndex: 1,
  },
  illustration: {
    width: 217,
    height: 325,
  },
  bottomArea: {
    paddingHorizontal: 26,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'web' ? 24 : 32,
    gap: 16,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    zIndex: 2,
  },
  deleteButton: {
    backgroundColor: '#FB3748',
    borderRadius: 28,
    paddingVertical: 16,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  deleteButtonDisabled: {
    opacity: 0.4,
  },
  deleteButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    lineHeight: 24,
    textAlign: 'center',
  },
  hintText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 15,
    textAlign: 'center',
  },
  // "Are you sure?" dialog
  areYouSureCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  trashIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFEBEE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  areYouSureClose: {
    position: 'absolute',
    top: 20,
    right: 20,
    padding: 4,
  },
  areYouSureTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
    marginBottom: 8,
  },
  areYouSureMessage: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#999',
    lineHeight: 20,
    marginBottom: 24,
  },
  areYouSureButtons: {
    flexDirection: 'row',
    gap: 12,
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
  confirmDeleteButton: {
    flex: 1,
    backgroundColor: '#D32F2F',
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  confirmDeleteButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    lineHeight: 20,
  },
  // Confirmation overlay
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  overlayCard: {
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
  overlayIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#0788B0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  overlayTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 12,
  },
  overlayMessage: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#666',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 28,
  },
  overlayButton: {
    backgroundColor: '#0788B0',
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  overlayButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    lineHeight: 22,
  },
});
