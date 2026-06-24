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
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ProfileImage } from '../components/ProfileImage';
import { DeleteAccountScreen } from './DeleteAccountScreen';
import { PrivacyPreferencesScreen } from './PrivacyPreferencesScreen';
import { AnalyticsDashboardScreen } from './AnalyticsDashboardScreen';
import { ReportBugOverlay } from '../components/ReportBugOverlay';
import { isCurrentUserAdmin } from '../services/analytics/analyticsDashboardService';
import { useOnboarding } from '../context/OnboardingContext';

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
  const insets = useSafeAreaInsets();
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showPrivacyPreferences, setShowPrivacyPreferences] = useState(false);
  const [showReportBug, setShowReportBug] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const { resetOnboarding, setCurrentStep, setUser, setIsDemoUser } = useOnboarding();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const isLoggingOutRef = useRef(false);
  const slideAnim = useRef(new Animated.Value(600)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    isCurrentUserAdmin().then(setIsAdmin);
  }, []);

  // Account actions — moved here from the old Lineup header 3-dots menu.
  const handleLogout = async () => {
    if (isLoggingOutRef.current) return;
    try {
      isLoggingOutRef.current = true;
      setIsLoggingOut(true);
      const { performLogout } = await import('../utils/logout');
      const result = await performLogout({
        resetOnboarding,
        setUser,
        setCurrentStep,
        setIsDemoUser,
      });
      if (!result.success) {
        Alert.alert('Error', `Failed to logout: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error in handleLogout:', error);
    } finally {
      isLoggingOutRef.current = false;
      setIsLoggingOut(false);
    }
  };

  const handleSwitchAccount = async () => {
    try {
      // Suppress the auth guard from bouncing to welcome mid-switch.
      const { setIsSwitchingAccount } = require('../hooks/useAuthGuard');
      setIsSwitchingAccount(true);

      if (Platform.OS !== 'web') {
        // Clear the Google cache so the account picker shows.
        try {
          const { GoogleSignin } = require('@react-native-google-signin/google-signin');
          await GoogleSignin.signOut();
        } catch (e) { /* ignore */ }

        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        await GoogleSignin.hasPlayServices();
        const result = await GoogleSignin.signIn();
        const idToken = result?.data?.idToken;
        if (!idToken) throw new Error('No ID token');

        const { supabase } = require('../config/supabase');
        const { data: sessionData, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (error) throw error;

        const { convertSupabaseUserToAppUser } = require('../utils/userConversion');
        const appUser = await convertSupabaseUserToAppUser(sessionData.session.user);
        setUser(appUser);
        // Return to the app on the freshly-switched account.
        onBack();
      } else {
        // Web: sign out first so signInWithGoogle doesn't short-circuit, then
        // redirect to Google with the account picker.
        const { supabase } = require('../config/supabase');
        await supabase.auth.signOut();
        const { supabaseAuthService } = require('../services/auth/supabaseAuthService');
        await supabaseAuthService.signInWithGoogle();
      }
    } catch (error: any) {
      if (error?.message?.includes('cancelled') || error?.code === '12501' || error?.code === 'SIGN_IN_CANCELLED') {
        // user cancelled the picker — no-op
      } else {
        console.error('Error in handleSwitchAccount:', error);
      }
    } finally {
      const { setIsSwitchingAccount } = require('../hooks/useAuthGuard');
      setIsSwitchingAccount(false);
    }
  };

  if (showAnalytics) {
    return <AnalyticsDashboardScreen onBack={() => setShowAnalytics(false)} />;
  }

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
      <Animated.View style={[styles.bottomCard, { transform: [{ translateY: slideAnim }], paddingBottom: Math.max(insets.bottom, 24) }]}>
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

          {isAdmin && (
            <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowAnalytics(true)}>
              <Ionicons name="stats-chart-outline" size={22} color="#333" style={styles.menuIcon} />
              <Text style={styles.menuRowText}>Analytics (admin)</Text>
            </TouchableOpacity>
          )}

          {/* Account actions — moved here from the old Lineup header menu */}
          <View style={styles.menuSectionDivider} />

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={handleSwitchAccount}>
            <Ionicons name="swap-horizontal-outline" size={22} color="#333" style={styles.menuIcon} />
            <Text style={styles.menuRowText}>Switch account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuRow, isLoggingOut && styles.menuRowDisabled]}
            activeOpacity={0.7}
            onPress={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? (
              <ActivityIndicator size="small" color="#E5484D" style={styles.menuIcon} />
            ) : (
              <Ionicons name="log-out-outline" size={22} color="#E5484D" style={styles.menuIcon} />
            )}
            <Text style={[styles.menuRowText, styles.logoutText]}>Log out</Text>
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
  menuSectionDivider: {
    height: 1,
    backgroundColor: '#E3E3E3',
    marginVertical: 8,
  },
  menuRowDisabled: {
    opacity: 0.6,
  },
  logoutText: {
    color: '#E5484D',
  },
});
