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
import { useUserProfile } from '../context/UserProfileContext';
import { CurrencySheet } from '../components/settings/CurrencySheet';
import { CancellationPolicySheet } from '../components/settings/CancellationPolicySheet';
import { ConnectStripeCard } from '../components/trips/ConnectStripeCard';
import { isCurrencyCode, resolveViewerCurrency, type CurrencyCode } from '../utils/currency';
import { supabaseDatabaseService } from '../services/database/supabaseDatabaseService';
import {
  EMPTY_OPERATOR_SETTINGS,
  fetchIsOperator,
  fetchOperatorSettings,
  saveOperatorSettings,
  type OperatorSettings,
} from '../services/trips/operatorSettingsService';
import { PRESET_LABEL, summarise } from '../services/trips/cancellationPolicy';

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
  const [showCurrency, setShowCurrency] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // ── Operator settings ────────────────────────────────────────────────────
  // Only an account with surfers.operator = true sees any of this. The flag is
  // read from the server rather than the cached profile: an admin can turn it
  // on while the app is open, and a profile cached before the column existed
  // has no `operator` key at all.
  const [isOperator, setIsOperator] = useState(false);
  const [opSettings, setOpSettings] = useState<OperatorSettings>(EMPTY_OPERATOR_SETTINGS);
  const [showOpCurrency, setShowOpCurrency] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showStripe, setShowStripe] = useState(false);

  // Display currency. Stored on the profile so it follows the user to their
  // other devices, the same way Booking.com remembers the last currency used.
  const { profile, updateProfile } = useUserProfile();
  const storedCurrency: CurrencyCode | null = isCurrencyCode(profile?.display_currency)
    ? profile.display_currency
    : null;
  const effectiveCurrency = resolveViewerCurrency(profile?.country_from, storedCurrency);

  const handleSelectCurrency = (next: CurrencyCode | null) => {
    // Optimistic: prices across the app flip on the next render rather than
    // after a round trip. The write is display-only — nothing about money
    // depends on it — so a failure costs a re-tap, not a wrong charge.
    if (profile) updateProfile({ ...profile, display_currency: next });
    void supabaseDatabaseService.updateDisplayCurrency(next);
  };
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

  useEffect(() => {
    let alive = true;
    fetchIsOperator().then(async yes => {
      if (!alive || !yes) return;
      setIsOperator(true);
      // Only fetched once we know they are an operator — nobody else has a row
      // to read, and RLS would return nothing anyway.
      try {
        const s = await fetchOperatorSettings();
        if (alive) setOpSettings(s);
      } catch (e) {
        console.warn('[Settings] operator settings read failed:', e);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Both savers write through and re-render from the value the server accepted,
  // not from the draft — the database normalises custom rules (sorts them, and
  // clears them when the preset is not custom), so trusting the draft would
  // show a policy that is not the stored one.
  const handleOperatorCurrency = async (next: CurrencyCode | null) => {
    const before = opSettings;
    setOpSettings({ ...opSettings, defaultCurrency: next });
    try {
      await saveOperatorSettings({ defaultCurrency: next });
      setOpSettings(await fetchOperatorSettings());
    } catch (e: any) {
      setOpSettings(before);
      Alert.alert('Could not save', e?.message ?? 'Please try again.');
    }
  };

  const handleSavePolicy = async (next: OperatorSettings['policy']) => {
    await saveOperatorSettings({ policy: next });
    setOpSettings(await fetchOperatorSettings());
  };

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

          <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowCurrency(true)}>
            <Ionicons name="cash-outline" size={22} color="#333" style={styles.menuIcon} />
            <Text style={styles.menuRowText}>Currency</Text>
            <Text style={styles.menuRowValue}>
              {storedCurrency ? storedCurrency : `Auto (${effectiveCurrency})`}
            </Text>
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

          {/* Operator — only for accounts a Swellyo admin has turned on. These
              are DEFAULTS reused on every trip they create, not settings that
              change a trip already published. */}
          {isOperator && (
            <>
              <View style={styles.menuSectionDivider} />
              <Text style={styles.sectionTitle}>Operator</Text>

              <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowStripe(v => !v)}>
                <Ionicons name="card-outline" size={22} color="#333" style={styles.menuIcon} />
                <Text style={styles.menuRowText}>Payments (Stripe)</Text>
                <Ionicons
                  name={showStripe ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="#9A9A9A"
                />
              </TouchableOpacity>

              {/* Inline rather than a row with a value: the card already says
                  which of the six Connect states the account is in, and any
                  one-word summary of that would be a lie in at least two. */}
              {showStripe && (
                <View style={styles.operatorInset}>
                  <ConnectStripeCard />
                </View>
              )}

              <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowOpCurrency(true)}>
                <Ionicons name="pricetag-outline" size={22} color="#333" style={styles.menuIcon} />
                <Text style={styles.menuRowText}>Default price currency</Text>
                <Text style={styles.menuRowValue}>
                  {opSettings.defaultCurrency ?? `Auto (${effectiveCurrency})`}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.menuRow} activeOpacity={0.7} onPress={() => setShowPolicy(true)}>
                <Ionicons name="document-text-outline" size={22} color="#333" style={styles.menuIcon} />
                <Text style={styles.menuRowText}>Cancellation policy</Text>
                <Text style={styles.menuRowValue}>{PRESET_LABEL[opSettings.policy.preset]}</Text>
              </TouchableOpacity>

              <Text style={styles.operatorNote}>{summarise(opSettings.policy)}</Text>
            </>
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
      <CurrencySheet
        visible={showCurrency}
        onClose={() => setShowCurrency(false)}
        value={storedCurrency}
        country={profile?.country_from}
        onSelect={handleSelectCurrency}
      />
      {isOperator && (
        <>
          <CurrencySheet
            visible={showOpCurrency}
            onClose={() => setShowOpCurrency(false)}
            value={isCurrencyCode(opSettings.defaultCurrency) ? opSettings.defaultCurrency : null}
            country={profile?.country_from}
            onSelect={handleOperatorCurrency}
            title="Default price currency"
            subtitle="New trips start priced in this currency. You can change it on any trip."
            autoLabel="Follow my country"
          />
          <CancellationPolicySheet
            visible={showPolicy}
            onClose={() => setShowPolicy(false)}
            value={opSettings.policy}
            onSave={handleSavePolicy}
          />
        </>
      )}
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
  // Current value, right-aligned — the row states what it is set to without
  // making the user open the sheet to find out.
  menuRowValue: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#7B7B7B',
    lineHeight: 18,
  },
  linkText: {
    color: '#0788B0',
  },
  operatorInset: { paddingHorizontal: 4, paddingBottom: 8 },
  operatorNote: {
    paddingHorizontal: 4,
    paddingBottom: 4,
    fontSize: 12,
    lineHeight: 17,
    color: '#8A8A84',
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
