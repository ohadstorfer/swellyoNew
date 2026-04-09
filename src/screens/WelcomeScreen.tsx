import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
  Alert,
  Image,
  Text as RNText,
  Animated,
  Linking,
  ScrollView,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { BackgroundVideo } from '../components/BackgroundVideo';
import { colors, spacing } from '../styles/theme';
import { authService } from '../services/auth/authService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { isSupabaseConfigured } from '../config/supabase';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { useIsMobile, responsiveWidth } from '../utils/responsive';
import { ONBOARDING_WELCOME_IMAGE_URLS } from './OnboardingWelcomeScreen';
import { calculateAgeFromDOB, dateToISOString } from '../utils/ageCalculation';
import { ageGateService } from '../services/ageGate/ageGateService';

interface WelcomeScreenProps {
  onGetStarted: () => void;
  onDemoChat?: () => void | Promise<void>;
  onSkipDemo?: () => void | Promise<void>;
  isCheckingAuth?: boolean;
}

// Google logo path from public/welcome page folder
const GOOGLE_LOGO_PATH = '/welcome page/Google logo.svg';

// Native SVG imports for Google icon (only loaded on native platforms)
let GoogSvg: any, GoogPath: any, GoogRect: any, GoogDefs: any, GoogClipPath: any, GoogG: any;
if (Platform.OS !== 'web') {
  const RNSvg = require('react-native-svg');
  GoogSvg = RNSvg.Svg;
  GoogPath = RNSvg.Path;
  GoogRect = RNSvg.Rect;
  GoogDefs = RNSvg.Defs;
  GoogClipPath = RNSvg.ClipPath;
  GoogG = RNSvg.G;
}

// Native inline SVG for the Google logo
const NativeGoogleIcon: React.FC = () => (
  <GoogSvg width={24} height={24} viewBox="0 0 19 19" fill="none" style={{ marginRight: 15 }}>
    <GoogDefs>
      <GoogClipPath id="clip0">
        <GoogRect width="18.1739" height="19" rx="9.08696" fill="white" />
      </GoogClipPath>
    </GoogDefs>
    <GoogG clipPath="url(#clip0)">
      <GoogPath d="M18.174 9.71046C18.174 8.93159 18.1121 8.36322 17.9782 7.7738H9.27246V11.2892H14.3825C14.2796 12.1629 13.7232 13.4786 12.4869 14.3626L12.4695 14.4803L15.2221 16.6588L15.4128 16.6783C17.1643 15.0258 18.174 12.5944 18.174 9.71046Z" fill="#4285F4" />
      <GoogPath d="M9.27238 18.9729C11.7759 18.9729 13.8776 18.1308 15.4128 16.6783L12.4868 14.3627C11.7038 14.9205 10.6529 15.31 9.27238 15.31C6.82036 15.31 4.73924 13.6575 3.99738 11.3735L3.88864 11.383L1.02644 13.6459L0.989014 13.7522C2.51379 16.8467 5.64581 18.9729 9.27238 18.9729Z" fill="#34A853" />
      <GoogPath d="M3.9974 11.3736C3.80165 10.7842 3.68836 10.1526 3.68836 9.50004C3.68836 8.84742 3.80165 8.21592 3.9871 7.62651L3.98191 7.50098L1.08385 5.20166L0.989033 5.24774C0.360597 6.53185 0 7.97386 0 9.50004C0 11.0262 0.360597 12.4682 0.989033 13.7523L3.9974 11.3736Z" fill="#FBBC05" />
      <GoogPath d="M9.27238 3.68991C11.0135 3.68991 12.188 4.45826 12.8577 5.10036L15.4746 2.49004C13.8674 0.963864 11.7759 0.0270996 9.27238 0.0270996C5.64581 0.0270996 2.51379 2.15321 0.989014 5.24766L3.98708 7.62643C4.73924 5.34242 6.82036 3.68991 9.27238 3.68991Z" fill="#EB4335" />
    </GoogG>
  </GoogSvg>
);

// Google Icon Component with fallback
const GoogleIcon: React.FC = () => {
  // On native, use inline SVG directly
  if (Platform.OS !== 'web') {
    return <NativeGoogleIcon />;
  }

  const [imageError, setImageError] = React.useState(false);

  // Get the Google logo URL using the image utility for proper platform handling
  const googleLogoUrl = React.useMemo(() => getImageUrl(GOOGLE_LOGO_PATH), []);

  if (imageError) {
    // Fallback: Simple "G" text
    return (
      <View style={styles.googleIconFallback}>
        <RNText style={styles.googleIconText}>G</RNText>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: googleLogoUrl }}
      style={styles.googleIcon}
      resizeMode="contain"
      onError={(error) => {
        console.warn('Failed to load Google icon, using fallback:', error);
        setImageError(true);
      }}
    />
  );
};

// Apple Icon Component
const APPLE_SVG_PATH = "M14.94 10.567c-.024-2.543 2.073-3.765 2.166-3.823-1.178-1.724-3.014-1.96-3.667-1.988-1.561-.158-3.048.92-3.84.92-.792 0-2.016-.896-3.312-.872-1.704.025-3.276.99-4.152 2.517-1.77 3.072-.453 7.625 1.273 10.117.843 1.22 1.849 2.59 3.17 2.54 1.272-.05 1.753-.823 3.29-.823 1.537 0 1.97.823 3.312.797 1.368-.025 2.232-1.242 3.072-2.465.968-1.414 1.367-2.783 1.391-2.855-.03-.013-2.67-1.024-2.696-4.065h-.007zM12.372 3.14C13.072 2.29 13.54 1.118 13.41 0c-.97.04-2.146.647-2.842 1.462-.625.724-1.172 1.88-1.025 2.99 1.082.085 2.186-.55 2.829-1.312z";

const AppleIcon: React.FC = () => {
  if (Platform.OS === 'web') {
    // Web: use inline SVG via dangerouslySetInnerHTML workaround
    return (
      <View style={{ width: 24, height: 24, marginRight: 15 }}>
        {/* @ts-ignore */}
        <svg width="24" height="24" viewBox="0 0 17 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d={APPLE_SVG_PATH} fill="white" />
        </svg>
      </View>
    );
  }
  const RNSvg = require('react-native-svg');
  const Svg = RNSvg.Svg;
  const Path = RNSvg.Path;
  return (
    <Svg width={24} height={24} viewBox="0 0 17 20" fill="none" style={{ marginRight: 15 }}>
      <Path d={APPLE_SVG_PATH} fill="white" />
    </Svg>
  );
};

// Checkbox Icon Component
const CheckboxIcon: React.FC<{ checked: boolean }> = ({ checked }) => {
  if (checked) {
    return (
      <View style={welcomeStyles.checkboxChecked}>
        <RNText style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700', lineHeight: 18 }}>✓</RNText>
      </View>
    );
  }
  return <View style={welcomeStyles.checkboxUnchecked} />;
};

const TERMS_URL = 'https://www.swellyo.com/terms-of-service';
const PRIVACY_URL = 'https://www.swellyo.com/privacy-policy';
const AGE_PICKER_ITEM_HEIGHT = 50;

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onGetStarted, onDemoChat, onSkipDemo, isCheckingAuth = false }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [isSkipDemoLoading, setIsSkipDemoLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isAgeBlocked, setIsAgeBlocked] = useState(false);
  const [showAgeSheet, setShowAgeSheet] = useState(false);
  const [ageSheetError, setAgeSheetError] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<'google' | 'apple' | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const { setUser, updateFormData, checkOnboardingStatus } = useOnboarding();
  
  // Use responsive hook for accurate mobile detection
  const isMobile = useIsMobile();
  
  // Calculate responsive button width
  const buttonWidth = responsiveWidth(90, 280, 320, 0);

  // Spinning animation for logo when checking auth
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isCheckingAuth) {
      // Start spinning animation
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      // Stop spinning animation
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
    }
  }, [isCheckingAuth, spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Check age gate on mount
  useEffect(() => {
    ageGateService.checkBlocked().then(({ blocked }) => {
      if (blocked) setIsAgeBlocked(true);
    });
  }, []);

  // Age verification scroll picker state
  const ITEM_HEIGHT = AGE_PICKER_ITEM_HEIGHT;
  const currentYear = new Date().getFullYear();
  const defaultDate = new Date(currentYear - 18, 0, 1);
  const [pickerDate, setPickerDate] = useState<Date>(defaultDate);
  const monthScrollRef = useRef<ScrollView>(null);
  const dayScrollRef = useRef<ScrollView>(null);
  const yearScrollRef = useRef<ScrollView>(null);
  const isSnapping = useRef(false);
  const monthScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dayScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yearScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();

  const snapToItem = (ref: React.RefObject<ScrollView | null>, index: number) => {
    if (ref.current) {
      isSnapping.current = true;
      ref.current.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
      setTimeout(() => { isSnapping.current = false; }, 350);
    }
  };

  const openAgeSheet = (provider: 'google' | 'apple') => {
    setPendingProvider(provider);
    setAgeSheetError(false);
    setPickerDate(defaultDate);
    setShowAgeSheet(true);
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(sheetAnim, { toValue: 1, tension: 65, friction: 11, useNativeDriver: true }),
    ]).start();
    // Scroll to default position after sheet opens
    setTimeout(() => {
      const monthIndex = defaultDate.getMonth();
      const dayIndex = defaultDate.getDate() - 1;
      const yearIndex = defaultDate.getFullYear() - (currentYear - 120);
      isSnapping.current = true;
      monthScrollRef.current?.scrollTo({ y: monthIndex * ITEM_HEIGHT, animated: false });
      dayScrollRef.current?.scrollTo({ y: dayIndex * ITEM_HEIGHT, animated: false });
      yearScrollRef.current?.scrollTo({ y: yearIndex * ITEM_HEIGHT, animated: false });
      setTimeout(() => { isSnapping.current = false; }, 100);
    }, 300);
  };

  const closeAgeSheet = () => {
    Animated.parallel([
      Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setShowAgeSheet(false);
      setPendingProvider(null);
    });
  };

  const [isVerifying, setIsVerifying] = useState(false);

  const handleAgeVerifyContinue = async () => {
    if (isVerifying) return;
    setIsVerifying(true);

    const dob = dateToISOString(pickerDate);
    const age = calculateAgeFromDOB(dob);
    const provider = pendingProvider;

    if (age !== null && age >= 18) {
      // Store DOB for later use in onboarding step 4
      await ageGateService.setDOB(dob);
      closeAgeSheet();
      // Proceed with sign-in after sheet closes
      setTimeout(() => {
        setIsVerifying(false);
        if (provider === 'google') {
          handleGoogleSignIn(true);
        } else if (provider === 'apple') {
          handleAppleSignIn(true);
        }
      }, 250);
    } else {
      // Underage — block
      await ageGateService.setBlocked(dob);
      setAgeSheetError(true);
      setIsAgeBlocked(true);
      setIsVerifying(false);
    }
  };

  const handleScrollEnd = (
    ref: React.RefObject<ScrollView | null>,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    type: 'month' | 'day' | 'year',
    offsetY: number,
  ) => {
    if (isSnapping.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const index = Math.round(offsetY / ITEM_HEIGHT);
      snapToItem(ref, index);
      setPickerDate(prev => {
        const newDate = new Date(prev);
        if (type === 'month') {
          newDate.setMonth(index);
          const maxDay = getDaysInMonth(index, newDate.getFullYear());
          if (newDate.getDate() > maxDay) newDate.setDate(maxDay);
        } else if (type === 'day') {
          newDate.setDate(index + 1);
        } else {
          newDate.setFullYear((currentYear - 120) + index);
          const maxDay = getDaysInMonth(newDate.getMonth(), (currentYear - 120) + index);
          if (newDate.getDate() > maxDay) newDate.setDate(maxDay);
        }
        return newDate;
      });
    }, 80);
  };

  useEffect(() => {
    // Load Montserrat font from Google Fonts for web
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Check if font is already loaded
      if (!document.querySelector('link[href*="fonts.googleapis.com/css2?family=Montserrat"]')) {
        const link = document.createElement('link');
        link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
    }

    // Check for OAuth return only - OnboardingContext now handles general session restoration
    const checkAuthState = async () => {
      // Check if we're returning from OAuth (for Supabase web flow)
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
        // PKCE flow: detectSessionInUrl exchanges the ?code= param automatically.
        const urlParams = new URLSearchParams(window.location.search);
        const hasOAuthReturn = urlParams.get('code');

        if (hasOAuthReturn && isSupabaseConfigured()) {
          console.log('Detected Supabase OAuth return (PKCE), processing session...');
          try {
            setIsLoading(true);
            // With PKCE + detectSessionInUrl, the Supabase client already exchanged
            // the code for a session. getUser() validates against the Supabase server.
            const { supabase } = await import('../config/supabase');
            const { data: { user: rawSupabaseUser }, error } = await supabase.auth.getUser();

            if (error || !rawSupabaseUser) {
              console.error('Failed to get user from OAuth session:', error);
              throw new Error('Failed to get user from session');
            }

            console.log('Supabase OAuth return successful, converting user:', rawSupabaseUser.id);

            // Convert Supabase user to app user format using utility
            const { convertSupabaseUserToAppUser } = await import('../utils/userConversion');
            const legacyUser = convertSupabaseUserToAppUser(rawSupabaseUser);

            setUser(legacyUser);
            updateFormData({
              nickname: legacyUser.nickname,
              userEmail: legacyUser.email,
            });

            // Identify user with PostHog after OAuth return
            const { analyticsService } = await import('../services/analytics/analyticsService');
            const userId = legacyUser.id.toString();
            const userProperties = {
              $email: legacyUser.email,
              $name: legacyUser.nickname || legacyUser.email?.split('@')[0] || 'User',
              email: legacyUser.email,
              name: legacyUser.nickname || legacyUser.email?.split('@')[0] || 'User',
            };
            analyticsService.identify(userId, userProperties);
            console.log('[WelcomeScreen] User identified with PostHog after OAuth return:', userId);

            // Clean up the URL (both query params and hash)
            window.history.replaceState({}, document.title, window.location.pathname);

            // Check if user has finished onboarding before navigating
            const hasFinishedOnboarding = await checkOnboardingStatus();
            if (!hasFinishedOnboarding) {
              ONBOARDING_WELCOME_IMAGE_URLS.forEach(url => Image.prefetch(url).catch(() => {}));
              onGetStarted();
            }
            // If hasFinishedOnboarding is true, isComplete will be set and AppContent will show homepage
            return;
          } catch (error: any) {
            console.error('Supabase OAuth return error:', error);
            // Clean up the URL even on error
            window.history.replaceState({}, document.title, window.location.pathname);
          } finally {
            setIsLoading(false);
          }
        }

        // Check for legacy OAuth return (code in query params)
        const legacyUrlParams = new URLSearchParams(window.location.search);
        const code = legacyUrlParams.get('code');
        
        if (code && !isSupabaseConfigured()) {
          console.log('Detected legacy OAuth return with code, processing...');
          try {
            setIsLoading(true);
            const user = await authService.signInWithGoogle();
            console.log('Legacy OAuth return successful, setting user:', user);
            setUser(user);
            
            // Set default nickname and email in form data
            updateFormData({
              nickname: user.nickname,
              userEmail: user.email,
            });
            
            // Identify user with PostHog after legacy OAuth return
            const { analyticsService } = await import('../services/analytics/analyticsService');
            const userId = user.id.toString();
            const userProperties = {
              $email: user.email,
              $name: user.nickname || user.email?.split('@')[0] || 'User',
              email: user.email,
              name: user.nickname || user.email?.split('@')[0] || 'User',
            };
            analyticsService.identify(userId, userProperties);
            console.log('[WelcomeScreen] User identified with PostHog after legacy OAuth return:', userId);
            
            onGetStarted();
          } catch (error: any) {
            console.error('Legacy OAuth return error:', error);
            Alert.alert(
              'Sign In Failed',
              error.message || 'An error occurred during sign in. Please try again.',
              [{ text: 'OK' }]
            );
          } finally {
            setIsLoading(false);
          }
          return;
        }
      }

      // Initialize Google Sign-In (no-op for expo-auth-session, but kept for compatibility)
      const initGoogleSignIn = async () => {
        try {
          console.log('Initializing Google Sign-In...');
          await authService.configure();
          console.log('Google Sign-In configured successfully');
        } catch (error) {
          console.error('Failed to configure Google Sign-In:', error);
        }
      };

      initGoogleSignIn();
    };

    checkAuthState();
  }, [setUser, onGetStarted, updateFormData]);

  const handleGoogleSignIn = async (ageVerified = false) => {
    if (!ageVerified) {
      openAgeSheet('google');
      return;
    }
    console.log('Google Sign-In button pressed');
    let redirectTimeout: ReturnType<typeof setTimeout> | null = null;
    
    try {
      setIsLoading(true);
      
      // Supabase automatically replaces the existing session on new sign-in,
      // so no pre-login signOut is needed.
      console.log('Starting Google Sign-In process...');
      
      // Store current URL to detect if redirect happens
      const currentUrlBeforeRedirect = Platform.OS === 'web' && typeof window !== 'undefined' 
        ? window.location.href 
        : null;
      
      // Set a timeout to detect if redirect doesn't happen (e.g., blocked by browser)
      // This prevents the UI from being stuck in loading state
      // Increased timeout to 3 seconds to account for slower redirects
      if (Platform.OS === 'web') {
        redirectTimeout = setTimeout(() => {
          // Only check if we're still on the same page if loading state is still active
          // (If redirect worked, we'd be on Google's page or back with OAuth params)
          if (isLoading && currentUrlBeforeRedirect && typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const isOAuthReturn = urlParams.get('code');
            
            // Only show error if we're definitely still on the same page AND not in OAuth return
            // AND loading state is still active (meaning redirect didn't happen)
            const currentUrl = window.location.href;
            const isStillOnSamePage = currentUrl === currentUrlBeforeRedirect || 
                                     currentUrl.startsWith(window.location.origin + window.location.pathname);
            
            if (!isOAuthReturn && isStillOnSamePage && isLoading) {
              console.warn('OAuth redirect appears to have been blocked - still on same page after timeout');
              setIsLoading(false);
              Alert.alert(
                'Redirect Blocked',
                'The redirect to Google sign-in was blocked or failed.\n\n' +
                'Please check:\n' +
                '• Your browser allows redirects for this site\n' +
                '• Popup blockers are disabled\n' +
                '• Try clicking the button again\n\n' +
                'If the problem persists, check your browser console for more details.',
                [{ text: 'OK' }]
              );
            }
          }
        }, 3000); // 3 second timeout - allows time for redirect to process
      }
      
      if (Platform.OS === 'web') {
        console.log('Using Auth Service for web');
        
        try {
          const user = await authService.signInWithGoogle();
          
          // Clear timeout if sign-in completes without redirect (existing session or OAuth return)
          if (redirectTimeout) {
            clearTimeout(redirectTimeout);
          }
          
          console.log('Google Sign-In successful, setting user:', user);
          setUser(user);
          
          // Set default nickname and email in form data
          updateFormData({
            nickname: user.nickname,
            userEmail: user.email,
          });
          
          // Identify user with PostHog after Google sign-in (web)
          const { analyticsService } = await import('../services/analytics/analyticsService');
          const userId = user.id.toString();
          const userProperties = {
            $email: user.email,
            $name: user.nickname || user.email?.split('@')[0] || 'User',
            email: user.email,
            name: user.nickname || user.email?.split('@')[0] || 'User',
          };
          analyticsService.identify(userId, userProperties);
          console.log('[WelcomeScreen] User identified with PostHog after Google sign-in (web):', userId);
          
          // Check if user has finished onboarding before navigating
          const hasFinishedOnboarding = await checkOnboardingStatus();
          if (!hasFinishedOnboarding) {
            ONBOARDING_WELCOME_IMAGE_URLS.forEach(url => Image.prefetch(url).catch(() => {}));
            onGetStarted(); // Only navigate to onboarding if not complete
          }
          // If complete, don't call onGetStarted() - AppContent will show ConversationsScreen
        } catch (error: any) {
          // Clear timeout on error
          if (redirectTimeout) {
            clearTimeout(redirectTimeout);
          }
          setIsLoading(false);
          
          // Check for specific redirect block error
          if (error?.message && error.message.includes('Redirect to Google OAuth was blocked')) {
            console.error('Google Sign-In redirect blocked:', error);
            Alert.alert(
              'Redirect Blocked',
              'The redirect to Google sign-in was blocked by your browser.\n\n' +
              'Please:\n' +
              '• Allow redirects for this site\n' +
              '• Disable popup blockers\n' +
              '• Check browser security settings\n\n' +
              'Then try again.',
              [{ text: 'OK' }]
            );
          } else if (error?.message && !error.message.includes('redirect')) {
            // Don't show error if it's a redirect (page will navigate away)
            console.error('Google Sign-In error:', error);
            Alert.alert('Sign-In Error', error.message || 'Failed to sign in with Google. Please try again.');
          }
        }
      } else {
        // Clear timeout for mobile (not needed)
        if (redirectTimeout) {
          clearTimeout(redirectTimeout);
        }
        
        console.log('Using mobile Google OAuth flow');
        const user = await authService.signInWithGoogle();
        console.log('Google Sign-In successful, setting user:', user);
        setUser(user);
        
        // Set default nickname and email in form data
        updateFormData({
          nickname: user.nickname,
          userEmail: user.email,
        });
        
        // Identify user with PostHog after Google sign-in (mobile)
        const { analyticsService } = await import('../services/analytics/analyticsService');
        const userId = user.id.toString();
        const userProperties = {
          $email: user.email,
          $name: user.nickname || user.email?.split('@')[0] || 'User',
          email: user.email,
          name: user.nickname || user.email?.split('@')[0] || 'User',
        };
        analyticsService.identify(userId, userProperties);
        console.log('[WelcomeScreen] User identified with PostHog after Google sign-in (mobile):', userId);
        
        // Check if user has finished onboarding before navigating
        const hasFinishedOnboarding = await checkOnboardingStatus();
        if (!hasFinishedOnboarding) {
          ONBOARDING_WELCOME_IMAGE_URLS.forEach(url => Image.prefetch(url).catch(() => {}));
          onGetStarted(); // Only navigate to onboarding if not complete
        }
        // If complete, don't call onGetStarted() - AppContent will show ConversationsScreen
      }
    } catch (error: any) {
      // Clear timeout on error
      if (redirectTimeout) {
        clearTimeout(redirectTimeout);
      }
      
      console.error('Google Sign-In Error:', error);
      const errorMessage = error?.message || 'An error occurred during sign in. Please try again.';
      
      // Check if it's a database error and provide specific guidance
      if (errorMessage.includes('Database error') || errorMessage.includes('Database Error')) {
        Alert.alert(
          'Database Error During Sign-In',
          'There was an error creating your user account in the database.\n\n' +
          'This usually happens when:\n' +
          '• A database trigger is failing\n' +
          '• Required fields are missing\n' +
          '• Row Level Security policies are blocking the operation\n\n' +
          'Please contact support or check your Supabase database configuration.',
          [{ text: 'OK' }]
        );
      } else if (errorMessage.includes('server_error')) {
        Alert.alert(
          'Sign In Configuration Error',
          'There seems to be a configuration issue with Google sign-in.\n\n' +
          'Please check:\n' +
          '• Supabase redirect URLs are configured correctly\n' +
          '• Google OAuth is properly set up in Supabase\n' +
          '• The redirect URL matches your current domain\n\n' +
          'If you\'re a developer, check the Supabase dashboard settings.',
          [{ text: 'OK' }]
        );
      } else if (errorMessage.includes('access_denied')) {
        Alert.alert(
          'Sign In Cancelled',
          'You cancelled the sign-in process. Please try again when ready.',
          [{ text: 'OK' }]
        );
      } else if (errorMessage.includes('Redirect to Google OAuth was blocked')) {
        Alert.alert(
          'Redirect Blocked',
          'The redirect to Google sign-in was blocked by your browser.\n\n' +
          'Please:\n' +
          '• Allow redirects for this site\n' +
          '• Disable popup blockers\n' +
          '• Check browser security settings\n\n' +
          'Then try again.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Sign In Failed',
          errorMessage,
          [{ text: 'OK' }]
        );
      }
    } finally {
      // Only clear loading if timeout hasn't already cleared it
      // (timeout will clear it if redirect doesn't happen)
      if (redirectTimeout) {
        clearTimeout(redirectTimeout);
      }
      setIsLoading(false);
    }
  };

  const handleLogin = () => {
    // TODO: Navigate to login screen
    console.log('Login pressed');
  };

  const handleDemoChat = async () => {
    if (!onDemoChat || isDemoLoading) return;
    
    try {
      setIsDemoLoading(true);
      // Call the demo chat handler (it's async and will navigate to onboarding)
      await onDemoChat();
    } catch (error: any) {
      console.error('Error in demo chat:', error);
      Alert.alert('Error', 'Failed to start demo. Please try again.');
      setIsDemoLoading(false);
    }
    // Note: We don't set isDemoLoading to false here because navigation happens
    // The component will unmount when navigating to onboarding
  };

  const handleSkipDemo = async () => {
    if (!onSkipDemo || isSkipDemoLoading) return;

    try {
      setIsSkipDemoLoading(true);
      await onSkipDemo();
    } catch (error: any) {
      console.error('Error in skip demo:', error);
      Alert.alert('Error', 'Failed to create demo profile. Please try again.');
      setIsSkipDemoLoading(false);
    }
  };


  console.log('WelcomeScreen rendering - Platform:', Platform.OS);
  
  const handleAppleSignIn = (ageVerified = false) => {
    if (!ageVerified) {
      openAgeSheet('apple');
      return;
    }
    // Mockup — Apple Sign In not yet implemented
    Alert.alert('Coming Soon', 'Apple Sign In will be available soon.');
  };

  return (
    <View style={styles.container}>
      {/* Background Video */}
      <BackgroundVideo />

      {/* Gradient Overlay */}
      <LinearGradient
        colors={['transparent', 'transparent', 'rgba(0,0,0,0.29)']}
        locations={[0, 0.18721, 0.75469]}
        style={styles.gradientOverlay}
      />

        {/* Content */}
        <View style={styles.content}>
          {/* Centered logo and tagline */}
          <View style={styles.topContent}>
            {/* Logo - only icon spins, text stays static */}
            <Logo
              size={112}
              iconWrapperStyle={isCheckingAuth ? { transform: [{ rotate: spin }] } : undefined}
            />

            {/* Tagline */}
            <RNText style={styles.tagline}>
            Connect | Travel | Surf | Share
            </RNText>
          </View>

          {/* Bottom section with buttons */}
          {!isCheckingAuth && (
          <View style={styles.bottomContent}>
            {/* Login Buttons */}
            <View style={welcomeStyles.buttonsContainer}>
              {/* Apple Sign In Button */}
              <TouchableOpacity
                onPress={() => handleAppleSignIn()}
                disabled={!agreedToTerms || isLoading || isAgeBlocked}
                style={[welcomeStyles.appleButton, (!agreedToTerms || isLoading || isAgeBlocked) && styles.buttonDisabled]}
                activeOpacity={0.8}
              >
                <View style={styles.buttonContent}>
                  <AppleIcon />
                  <RNText style={welcomeStyles.appleButtonText} numberOfLines={1}>
                    Log In with Apple
                  </RNText>
                </View>
              </TouchableOpacity>

              {/* Google Sign In Button */}
              <TouchableOpacity
                onPress={() => handleGoogleSignIn()}
                disabled={!agreedToTerms || isLoading || isAgeBlocked}
                style={[welcomeStyles.googleButton, (!agreedToTerms || isLoading || isAgeBlocked) && styles.buttonDisabled]}
                activeOpacity={0.8}
              >
                <View style={styles.buttonContent}>
                  <GoogleIcon />
                  <RNText style={welcomeStyles.googleButtonText} numberOfLines={1}>
                    {isLoading ? "Signing in..." : "Log In with Google"}
                  </RNText>
                </View>
              </TouchableOpacity>
            </View>

            {/* Terms & Privacy Card */}
            <View style={welcomeStyles.termsCard}>
              <TouchableOpacity
                style={welcomeStyles.checkboxRow}
                onPress={() => setAgreedToTerms(!agreedToTerms)}
                activeOpacity={0.7}
              >
                <CheckboxIcon checked={agreedToTerms} />
                <RNText style={welcomeStyles.termsText}>
                  I agree to the{' '}
                  <RNText
                    style={welcomeStyles.termsLink}
                    onPress={() => Linking.openURL(TERMS_URL)}
                  >
                    Terms of Service
                  </RNText>
                  {' '}and{' '}
                  <RNText
                    style={welcomeStyles.termsLink}
                    onPress={() => Linking.openURL(PRIVACY_URL)}
                  >
                    Privacy Policy
                  </RNText>
                </RNText>
              </TouchableOpacity>

              {/* OpenAI Disclaimer */}
              <View style={welcomeStyles.disclaimerRow}>
                <View style={welcomeStyles.infoIcon}>
                  <RNText style={welcomeStyles.infoIconText}>i</RNText>
                </View>
                <RNText style={welcomeStyles.disclaimerText}>
                  Swellyo uses OpenAI to power our surf partner matching and profile creation.
                </RNText>
              </View>
            </View>

            {/* Demo Chat Button */}
            {onDemoChat && (
              <TouchableOpacity
                onPress={handleDemoChat}
                disabled={isDemoLoading || isLoading}
                style={[
                  welcomeStyles.appleButton,
                  { backgroundColor: '#8B5CF6', marginTop: 12 },
                  (isDemoLoading || isLoading) && styles.buttonDisabled
                ]}
                activeOpacity={0.8}
              >
                <RNText style={welcomeStyles.appleButtonText} numberOfLines={1}>
                  {isDemoLoading ? "Loading..." : "Demo"}
                </RNText>
              </TouchableOpacity>
            )}

            {/* Skip Demo Button - creates full demo profile and goes straight to profile */}
            {onSkipDemo && (
              <TouchableOpacity
                onPress={handleSkipDemo}
                disabled={isSkipDemoLoading || isLoading}
                style={[
                  welcomeStyles.appleButton,
                  { backgroundColor: '#F59E0B', marginTop: 12 },
                  (isSkipDemoLoading || isLoading) && styles.buttonDisabled
                ]}
                activeOpacity={0.8}
              >
                <RNText style={welcomeStyles.appleButtonText} numberOfLines={1}>
                  {isSkipDemoLoading ? "Loading..." : "Skip Demo"}
                </RNText>
              </TouchableOpacity>
            )}
          </View>
          )}
        </View>

      {/* Age Verification Bottom Sheet */}
      {showAgeSheet && (
        <>
          <TouchableWithoutFeedback onPress={ageSheetError ? closeAgeSheet : undefined}>
            <Animated.View style={[ageStyles.overlay, { opacity: overlayAnim }]} />
          </TouchableWithoutFeedback>
          <Animated.View
            style={[
              ageStyles.sheet,
              {
                transform: [{
                  translateY: sheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [600, 0],
                  }),
                }],
              },
            ]}
          >
            <View style={ageStyles.sheetHandle} />

            {/* Title */}
            {ageSheetError ? (
              <RNText style={ageStyles.sheetTitleError}>
                Sorry, but you are not eligible to use Swellyo at this time.
              </RNText>
            ) : (
              <>
                <RNText style={ageStyles.sheetTitle}>Age verification</RNText>
                <RNText style={ageStyles.sheetSubtitle}>Please enter your date of birth.</RNText>
              </>
            )}

            <View style={ageStyles.sheetDivider} />

            {/* Date Picker */}
            <RNText style={ageStyles.pickerLabel}>What's your date of birth?</RNText>

            <View style={ageStyles.pickerContainer}>
              {/* Month */}
              <View style={ageStyles.pickerColumn}>
                <ScrollView
                  ref={monthScrollRef}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={ITEM_HEIGHT}
                  decelerationRate="fast"
                  scrollEnabled={!ageSheetError}
                  onScroll={(e) => handleScrollEnd(monthScrollRef, monthScrollTimer, 'month', e.nativeEvent.contentOffset.y)}
                  scrollEventThrottle={16}
                  contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
                >
                  {MONTHS.map((m, i) => (
                    <View key={m} style={ageStyles.pickerItem}>
                      <RNText style={[ageStyles.pickerItemText, i === pickerDate.getMonth() && ageStyles.pickerItemSelected]}>{m}</RNText>
                    </View>
                  ))}
                </ScrollView>
              </View>

              {/* Day */}
              <View style={ageStyles.pickerColumn}>
                <ScrollView
                  ref={dayScrollRef}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={ITEM_HEIGHT}
                  decelerationRate="fast"
                  scrollEnabled={!ageSheetError}
                  onScroll={(e) => handleScrollEnd(dayScrollRef, dayScrollTimer, 'day', e.nativeEvent.contentOffset.y)}
                  scrollEventThrottle={16}
                  contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
                >
                  {Array.from({ length: getDaysInMonth(pickerDate.getMonth(), pickerDate.getFullYear()) }, (_, i) => (
                    <View key={i} style={ageStyles.pickerItem}>
                      <RNText style={[ageStyles.pickerItemText, i === pickerDate.getDate() - 1 && ageStyles.pickerItemSelected]}>{i + 1}</RNText>
                    </View>
                  ))}
                </ScrollView>
              </View>

              {/* Year */}
              <View style={ageStyles.pickerColumn}>
                <ScrollView
                  ref={yearScrollRef}
                  showsVerticalScrollIndicator={false}
                  snapToInterval={ITEM_HEIGHT}
                  decelerationRate="fast"
                  scrollEnabled={!ageSheetError}
                  onScroll={(e) => handleScrollEnd(yearScrollRef, yearScrollTimer, 'year', e.nativeEvent.contentOffset.y)}
                  scrollEventThrottle={16}
                  contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
                >
                  {Array.from({ length: 121 }, (_, i) => {
                    const y = (currentYear - 120) + i;
                    return (
                      <View key={y} style={ageStyles.pickerItem}>
                        <RNText style={[ageStyles.pickerItemText, y === pickerDate.getFullYear() && ageStyles.pickerItemSelected]}>{y}</RNText>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Center highlight */}
              <View style={ageStyles.pickerHighlight} pointerEvents="none" />
            </View>

            {/* Continue Button */}
            <TouchableOpacity
              style={ageStyles.continueButton}
              activeOpacity={0.8}
              onPress={ageSheetError ? closeAgeSheet : handleAgeVerifyContinue}
            >
              <RNText style={ageStyles.continueButtonText}>Continue</RNText>
            </TouchableOpacity>
          </Animated.View>
        </>
      )}
    </View>
  );
};

const ageStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    zIndex: 50,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    zIndex: 60,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D9D9D9',
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    lineHeight: 24,
  },
  sheetTitleError: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '700',
    color: '#E53935',
    lineHeight: 24,
    textAlign: 'center',
  },
  sheetSubtitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400',
    color: '#333',
    lineHeight: 18,
    marginTop: 4,
  },
  sheetDivider: {
    height: 1,
    backgroundColor: '#E3E3E3',
    marginVertical: 20,
  },
  pickerLabel: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
  },
  pickerContainer: {
    flexDirection: 'row',
    height: AGE_PICKER_ITEM_HEIGHT * 5,
    overflow: 'hidden',
    marginBottom: 24,
  },
  pickerColumn: {
    flex: 1,
  },
  pickerItem: {
    height: AGE_PICKER_ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400',
    color: '#AAAAAA',
    lineHeight: 22,
  },
  pickerItemSelected: {
    color: '#333',
    fontWeight: '700',
    fontSize: 18,
  },
  pickerHighlight: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: AGE_PICKER_ITEM_HEIGHT * 2,
    height: AGE_PICKER_ITEM_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E3E3E3',
    backgroundColor: 'transparent',
  },
  continueButton: {
    backgroundColor: '#222B30',
    borderRadius: 16,
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
  },
  continueButtonText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 20,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    zIndex: 1,
    position: 'relative',
    justifyContent: 'space-between',
  },
  topContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxxxl,
  },
  bottomContent: {
    paddingBottom: 63,
    alignItems: 'center',
    width: '100%',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 0, // No bottom margin - spacing is handled by tagline margin
  },
  tagline: {
    marginTop: 10, // Gap from Figma (10px gap between logo and slogan container)
    color: colors.white,
    textAlign: 'center',
    // Montserrat Bold (700) - Family/Headings from Figma
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontWeight: '700', // Montserrat Bold
    fontSize: 16, // H-5: 16px
    lineHeight: 24, // H-5: 24px line height
  },
  buttonContainer: {
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.xl,
  },
  getStartedButton: {
    // Width is set dynamically via inline style using responsiveWidth
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#d8dadc',
    borderRadius: 28,
    paddingVertical: 17,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
  },
  googleIcon: {
    width: 24,
    height: 24,
    marginRight: 15,
    flexShrink: 0,
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any,
      display: 'block' as any,
    }),
  },
  googleIconFallback: {
    width: 24,
    height: 24,
    marginRight: 15,
    flexShrink: 0,
    backgroundColor: '#4285F4',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  getStartedButtonText: {
    textAlign: 'center',
    color: '#000',
    fontSize: 16,
    fontWeight: '600', // Inter SemiBold
    lineHeight: 20, // 1.25 * 16 = 20
    fontFamily: Platform.OS === 'ios' ? 'Inter-SemiBold' : Platform.OS === 'android' ? 'sans-serif-medium' : Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    flexShrink: 0,
  },
  googleSignInButton: {
    width: '90%',
    maxWidth: 320,
    height: 50,
    paddingBottom: spacing.md,
  },
  loginContainer: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  loginText: {
    textAlign: 'center',
    color: colors.white,
  },
  loginLink: {
    color: colors.white,
    textDecorationLine: 'underline',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  demoButton: {
    backgroundColor: '#8B5CF6',
    marginTop: spacing.sm,
  },
});

const welcomeStyles = StyleSheet.create({
  buttonsContainer: {
    width: 346,
    alignSelf: 'center',
    gap: 16,
  },
  appleButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    height: 54,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  appleButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 24,
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 54,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  googleButtonText: {
    color: '#7b7b7b',
    fontSize: 20,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 24,
  },
  termsCard: {
    width: 346,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 16,
    marginTop: 16,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkboxUnchecked: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    backgroundColor: 'transparent',
  },
  checkboxChecked: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: '#0788B0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  termsText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '400',
    lineHeight: 22,
  },
  termsLink: {
    color: '#FFFFFF',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  infoIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoIconText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    fontWeight: '700',
    fontStyle: 'italic',
    marginTop: -1,
  },
  disclaimerText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '400',
    lineHeight: 22,
  },
});