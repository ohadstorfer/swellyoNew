import React, { useEffect } from 'react';
import { Platform, I18nManager, AppState, Text as RNText, TextInput as RNTextInput } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider, PostHogSurveyProvider } from 'posthog-react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './src/navigation/navigationRef';
import { OnboardingProvider } from './src/context/OnboardingContext';
import { UserProfileProvider } from './src/context/UserProfileContext';
import { MessagingProvider } from './src/context/MessagingProvider';
import { TutorialProvider } from './src/context/TutorialContext';
import { AppContent } from './src/components/AppContent';
import { analyticsService } from './src/services/analytics/analyticsService';
import { PostHogErrorBoundary } from './src/components/PostHogErrorBoundary';
import { registerLogoutHandlers } from './src/utils/registerLogoutHandlers';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { queryClient } from './src/lib/queryClient';
import { useAppFonts } from './src/theme/fonts';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

// Sentry's native modules (mobile replay, native crash) aren't available in Expo Go.
const isExpoGo = Constants.appOwnership === 'expo';

Sentry.init({
  dsn: 'https://d30db011c45bc9d24085d007b27321ee@o4511498427170816.ingest.us.sentry.io/4511498431365120',

  // Don't send dev errors to Sentry (saves free-tier quota, keeps the dashboard to real
  // users). Flip EXPO_PUBLIC_SENTRY_DEBUG=true to force reporting on the simulator/Expo Go
  // when you actually want to test Sentry there.
  enabled: !__DEV__ || process.env.EXPO_PUBLIC_SENTRY_DEBUG === 'true',

  // Don't attach IP/cookies/PII by default (privacy / GDPR). Set true if you need richer context.
  sendDefaultPii: false,

  // Enable Logs
  enableLogs: true,

  // Record a replay only when an error happens — no blanket session recording (cost/data).
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1,

  // Known-harmless noise — never actionable. Drop before it counts against quota.
  // Add app-specific noise here only once real Sentry data shows a clear, harmless pattern.
  ignoreErrors: [
    /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
    // In Expo Go, native modules (ExpoUpdates, etc.) are absent, so libraries throw
    // "Cannot find native module 'X'". This never happens in real builds — pure Expo Go
    // noise. Filtered ONLY in Expo Go so a truly-missing native module in a production
    // build still surfaces.
    ...(isExpoGo ? [/Cannot find native module/] : []),
  ],

  // mobileReplayIntegration is a native module — skip in Expo Go and on web (no-op there).
  integrations: isExpoGo || Platform.OS === 'web' ? [] : [Sentry.mobileReplayIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

// KeyboardProvider requires native code — skip in Expo Go (isExpoGo defined above)
const MaybeKeyboardProvider = isExpoGo
  ? ({ children }: { children: React.ReactNode }) => <>{children}</>
  : require('react-native-keyboard-controller').KeyboardProvider;

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';
const isMVPMode = process.env.EXPO_PUBLIC_MVP_MODE === 'true';

// Force LTR layout — app is English-only
if (I18nManager.isRTL) {
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
}

// Lock text to the design's pixel sizes: by default RN multiplies every
// fontSize by the OS "text size" accessibility setting, so on a device with
// Larger Text ON, EVERY label renders bigger than Figma (which is at 1.0).
// Disabling it app-wide makes Figma px == rendered px. Tradeoff: Dynamic Type
// no longer enlarges text for low-vision users — revisit with a capped
// maxFontSizeMultiplier if accessibility becomes a requirement.
(RNText as any).defaultProps = (RNText as any).defaultProps || {};
(RNText as any).defaultProps.allowFontScaling = false;
(RNTextInput as any).defaultProps = (RNTextInput as any).defaultProps || {};
(RNTextInput as any).defaultProps.allowFontScaling = false;

export default Sentry.wrap(function App() {
  // Load Inter + Montserrat before rendering so native shows the real typefaces
  // (not the system-font fallback). Fail-open: if loading errors, render anyway
  // with the system font (same as before). Web never blocks (browser has fonts).
  const [fontsLoaded, fontError] = useAppFonts();
  const fontsReady = Platform.OS === 'web' || fontsLoaded || !!fontError;

  useEffect(() => {
    // Initialize PostHog analytics (instance-based for tracking)
    analyticsService.initialize();
    registerLogoutHandlers();
  }, []);

  // react-query has no "window focus" in RN, so wire its focusManager to
  // AppState — queries can revalidate when the app returns from background.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', status => {
      focusManager.setFocused(status === 'active');
    });
    return () => sub.remove();
  }, []);

  // Hold render until fonts are ready (native only) to avoid a system-font flash.
  if (!fontsReady) return null;

  // The provider tree is rendered ONCE and never restructured at runtime.
  // PREVIOUSLY this whole subtree was duplicated and swapped when an
  // `isNavigationReady` flag flipped (to delay mounting PostHogProvider). That
  // swap changed the tree shape, so React unmounted and FULLY REMOUNTED every
  // provider + AppContent — re-running DB init, session restoration, conversation
  // loads, presence and the welcome video all over again, mid-boot. That double/
  // triple boot pegged the JS thread for tens of seconds (hot phone, nothing
  // loads). PostHog autocapture is already off (captureScreens/native tracking
  // false), so it never needed the gate — mount it unconditionally and keep the
  // tree stable. isMVPMode is a constant, so its branch never swaps at runtime.
  const appTree = (
    <OnboardingProvider>
      <UserProfileProvider>
        <MessagingProvider>
          <TutorialProvider>
            <AppContent />
            <StatusBar style="light" />
          </TutorialProvider>
        </MessagingProvider>
      </UserProfileProvider>
    </OnboardingProvider>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <MaybeKeyboardProvider>
    <SafeAreaProvider>
    <NavigationContainer independent={true} ref={navigationRef}>
      <PostHogErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <PostHogProvider
            apiKey={POSTHOG_API_KEY}
            autocapture={{ captureScreens: false }}
            options={{
              host: POSTHOG_HOST,
              enableSessionReplay: Platform.OS === 'web',
              captureAppLifecycleEvents: true,
              captureDeepLinks: true,
              enableNativeNavigationTracking: false, // Disable navigation tracking to prevent useNavigationState errors
              debug: __DEV__, // Enable debug mode in development
            }}
          >
            {isMVPMode ? (
              <PostHogSurveyProvider>{appTree}</PostHogSurveyProvider>
            ) : (
              appTree
            )}
          </PostHogProvider>
        </QueryClientProvider>
      </PostHogErrorBoundary>
    </NavigationContainer>
    </SafeAreaProvider>
    </MaybeKeyboardProvider>
    </GestureHandlerRootView>
  );
});
