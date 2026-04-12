import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { blockingService } from '../services/blocking/blockingService';

const greenSuccessImg = require('../assets/icons/green-success.png');

function ReportConfirmation({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.container}>
      <View style={styles.topArea}>
        <TouchableOpacity style={styles.backButton} onPress={onDone} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#333" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.mainCard}>
        <View style={styles.divider} />

        <View style={styles.confirmationContent}>
          <View style={styles.confirmationTextBlock}>
            <Text style={styles.confirmationTitle}>Report received</Text>
            <Text style={styles.confirmationMessage}>
              {"We'll review this case shortly.\nThey won't know you reported them."}
            </Text>
          </View>
          <Image source={greenSuccessImg} style={styles.successImage} resizeMode="contain" />
        </View>

        <View style={[styles.bottomButtonContainer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <TouchableOpacity
            style={styles.reportButton}
            onPress={onDone}
            activeOpacity={0.7}
          >
            <Text style={styles.reportButtonText}>Return to Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const REASONS = [
  'Spam or scam',
  'Harassment or bullying',
  'Inappropriate content',
  'Fake profile',
  'Other',
];

interface ReportUserScreenProps {
  reportedUserId: string;
  reportedUserName: string;
  onBack: () => void;
  onReturnHome: () => void;
  onBlocked?: () => void;
}

async function sendUserReport(reportedUserId: string, reportedUserName: string, reason: string, alsoBlocked: boolean): Promise<void> {
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
      details: `Reason: ${reason}`,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Request failed (${response.status})`);
  }
}

export function ReportUserScreen({ reportedUserId, reportedUserName, onBack, onReturnHome, onBlocked }: ReportUserScreenProps) {
  const insets = useSafeAreaInsets();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [blockUser, setBlockUser] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleReport = async () => {
    if (!selectedReason || isSending) return;
    setIsSending(true);
    try {
      await sendUserReport(reportedUserId, reportedUserName, selectedReason, blockUser);
      if (blockUser) {
        await blockingService.blockUser(reportedUserId);
      }
    } catch (error) {
      console.error('[ReportUserScreen] Error:', error);
    }
    setIsSending(false);
    setShowConfirmation(true);
  };

  const handleDone = () => {
    if (blockUser && onBlocked) {
      onBlocked();
    } else {
      onReturnHome();
    }
  };

  if (showConfirmation) {
    return <ReportConfirmation onDone={handleDone} />;
  }

  return (
    <View style={styles.container}>
      {/* Top area with back button */}
      <View style={styles.topArea}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#333" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      {/* White card */}
      <View style={styles.mainCard}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContentInner}>
          {/* Report section */}
          <View style={styles.sectionContent}>
            <Text style={styles.sectionTitle}>Report this user</Text>

            <View style={styles.descriptionRow}>
              <Text style={styles.descriptionText}>
                We may review recent messages in this chat to understand what happened. Don't worry they won't know you reported them.
              </Text>
            </View>

            {/* Dropdown */}
            <TouchableOpacity
              style={styles.dropdown}
              onPress={() => setDropdownOpen(!dropdownOpen)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dropdownText, selectedReason && styles.dropdownTextSelected]}>
                {selectedReason || 'Why are you reporting this user?'}
              </Text>
              <Ionicons
                name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={24}
                color="#7B7B7B"
              />
            </TouchableOpacity>

            {/* Dropdown options */}
            {dropdownOpen && (
              <View style={styles.dropdownOptions}>
                {REASONS.map((reason) => (
                  <TouchableOpacity
                    key={reason}
                    style={[
                      styles.dropdownOption,
                      selectedReason === reason && styles.dropdownOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedReason(reason);
                      setDropdownOpen(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.dropdownOptionText,
                      selectedReason === reason && styles.dropdownOptionTextSelected,
                    ]}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Block user section */}
          <View style={styles.divider} />

          <View style={styles.sectionContent}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setBlockUser(!blockUser)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, blockUser && styles.checkboxChecked]}>
                {blockUser && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
              </View>
              <Text style={styles.sectionTitle}>Block user</Text>
            </TouchableOpacity>

            <View style={styles.descriptionRow}>
              <Text style={styles.descriptionText}>
                They won't be able to contact you or see your profile anymore.
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Bottom button area */}
        <View style={[styles.bottomButtonContainer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <TouchableOpacity
            style={[styles.reportButton, !selectedReason && styles.reportButtonDisabled]}
            onPress={handleReport}
            activeOpacity={0.7}
            disabled={!selectedReason || isSending}
          >
            {isSending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.reportButtonText}>Report User</Text>
            )}
          </TouchableOpacity>
          {!selectedReason && (
            <Text style={styles.helperText}>Please choose a reason before reporting</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  topArea: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 50,
    paddingBottom: 16,
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
    fontSize: 12,
    fontWeight: '400',
    color: '#333',
    lineHeight: 15,
  },
  mainCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  scrollContentInner: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  divider: {
    height: 1,
    backgroundColor: '#E3E3E3',
  },
  sectionContent: {
    paddingVertical: 24,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    lineHeight: 24,
  },
  descriptionRow: {
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
  },
  descriptionText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400',
    color: '#333',
    lineHeight: 18,
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400',
    color: '#333',
    lineHeight: 18,
  },
  dropdownOptionTextSelected: {
    fontWeight: '600',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  bottomButtonContainer: {
    paddingHorizontal: 10,
    paddingBottom: 24,
    paddingTop: 16,
    gap: 16,
    alignItems: 'center',
  },
  reportButton: {
    backgroundColor: '#212121',
    borderRadius: 12,
    height: 56,
    width: '100%',
    maxWidth: 341,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  reportButtonDisabled: {
    opacity: 0.4,
  },
  reportButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 24,
  },
  helperText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400',
    color: '#333',
    lineHeight: 15,
    textAlign: 'center',
  },
  confirmationContent: {
    flex: 1,
    paddingVertical: 24,
    alignItems: 'center',
  },
  successImage: {
    width: 251,
    height: 251,
    marginTop: 40,
  },
  confirmationTextBlock: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    alignItems: 'center',
  },
  confirmationTitle: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
    lineHeight: 32,
    textAlign: 'center',
  },
  confirmationMessage: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400',
    color: '#333',
    lineHeight: 22,
    textAlign: 'center',
  },
});
