import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  ScrollView,
  Animated,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ProfileImage } from '../components/ProfileImage';
import { DeleteAccountScreen } from './DeleteAccountScreen';
import { PrivacyPreferencesScreen } from './PrivacyPreferencesScreen';
import { ReportBugOverlay } from '../components/ReportBugOverlay';

// Settings menu icons
const iconPrivacyPreferences = require('../assets/icons/privacy-preferences.png');
const iconTermsOfService = require('../assets/icons/terms-of-service.png');
const iconPrivacyPolicy = require('../assets/icons/privacy-policy.png');
const iconAboutUs = require('../assets/icons/about-us.png');
const iconReportBug = require('../assets/icons/report-bug.png');
const iconDeleteAccount = require('../assets/icons/delete-account.png');

interface SettingsScreenProps {
  onBack: () => void;
  userName: string;
  userAvatar: string | null;
  userEmail?: string;
}

export function SettingsScreen({ onBack, userName, userAvatar, userEmail }: SettingsScreenProps) {
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showPrivacyPreferences, setShowPrivacyPreferences] = useState(false);
  const [showReportBug, setShowReportBug] = useState(false);
  const slideAnim = useRef(new Animated.Value(600)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, []);

  if (showPrivacyPreferences) {
    return (
      <PrivacyPreferencesScreen
        onBack={() => setShowPrivacyPreferences(false)}
      />
    );
  }

  if (showDeleteAccount) {
    return (
      <DeleteAccountScreen
        onBack={() => setShowDeleteAccount(false)}
        userName={userName}
        userEmail={userEmail}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Back button - floating on top */}
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={18} color="#333" />
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>

      {/* Profile image - floating above the white card */}
      <Animated.View style={[styles.profileImageWrapper, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.avatarBorder}>
          <ProfileImage
            imageUrl={userAvatar}
            name={userName}
            style={styles.avatar}
            showLoadingIndicator={false}
          />
        </View>
      </Animated.View>

      {/* White bottom card */}
      <Animated.View style={[styles.bottomCard, { transform: [{ translateY: slideAnim }] }]}>
        {/* Spacer for the avatar overlap */}
        <View style={styles.avatarSpacer} />

        {/* User name */}
        <View style={styles.nameContainer}>
          <Text style={styles.userName}>{userName}</Text>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Settings section */}
        <ScrollView style={styles.settingsList} contentContainerStyle={styles.settingsListContent}>
          <Text style={styles.sectionTitle}>Settings</Text>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowPrivacyPreferences(true)}>
            <Image source={iconPrivacyPreferences} style={styles.menuIcon} resizeMode="contain" />
            <Text style={styles.menuRowText}>Privacy preferences</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => Linking.openURL('https://www.swellyo.com/terms-and-conditions')}>
            <Image source={iconTermsOfService} style={styles.menuIcon} resizeMode="contain" />
            <Text style={[styles.menuRowText, styles.linkText]}>Terms of service</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => Linking.openURL('https://www.swellyo.com/privacy-policy')}>
            <Image source={iconPrivacyPolicy} style={styles.menuIcon} resizeMode="contain" />
            <Text style={[styles.menuRowText, styles.linkText]}>Privacy policy</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => Linking.openURL('https://www.swellyo.com/about')}>
            <Image source={iconAboutUs} style={styles.menuIcon} resizeMode="contain" />
            <Text style={[styles.menuRowText, styles.linkText]}>About us</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowReportBug(true)}>
            <Image source={iconReportBug} style={styles.menuIcon} resizeMode="contain" />
            <Text style={styles.menuRowText}>Report bug</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowDeleteAccount(true)}>
            <Image source={iconDeleteAccount} style={styles.menuIcon} resizeMode="contain" />
            <Text style={styles.menuRowText}>Delete account</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
      <ReportBugOverlay visible={showReportBug} onClose={() => setShowReportBug(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
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
    position: 'absolute',
    top: 54,
    left: 16,
    zIndex: 10,
  },
  backButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 15,
  },
  profileImageWrapper: {
    position: 'absolute',
    top: 88,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  avatarBorder: {
    width: 101,
    height: 101,
    borderRadius: 80,
    borderWidth: 6,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
  avatar: {
    width: '100%' as any,
    height: '100%' as any,
    borderRadius: 80,
  },
  avatarPlaceholder: {
    backgroundColor: '#C8D6DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 139,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  avatarSpacer: {
    height: 58,
  },
  nameContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400' as const,
    color: '#333',
    lineHeight: 22,
  },
  divider: {
    height: 1,
    backgroundColor: '#E3E3E3',
    marginTop: 24,
  },
  settingsList: {
    flex: 1,
  },
  settingsListContent: {
    paddingTop: 24,
    paddingBottom: 24,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#333',
    lineHeight: 24,
    marginBottom: 8,
  },
  menuIcon: {
    width: 24,
    height: 24,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
  },
  menuRowText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#222B30',
    lineHeight: 18,
    flex: 1,
  },
  linkText: {
    color: '#0788B0',
  },
});
