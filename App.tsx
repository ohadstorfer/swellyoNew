import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider, PostHogSurveyProvider } from 'posthog-react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OnboardingProvider } from './src/context/OnboardingContext';
import { MessagingProvider } from './src/context/MessagingProvider';
import { AppContent } from './src/components/AppContent';
import { analyticsService } from './src/services/analytics/analyticsService';
import { PostHogErrorBoundary } from './src/components/PostHogErrorBoundary';
import { registerLogoutHandlers } from './src/utils/registerLogoutHandlers';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';
const isMVPMode = process.env.EXPO_PUBLIC_MVP_MODE === 'true';

export default function App() {
  const [isNavigationReady, setIsNavigationReady] = useState(false);

  useEffect(() => {
    // Initialize PostHog analytics (instance-based for tracking)
    analyticsService.initialize();
    registerLogoutHandlers();
  }, []);

  const handleNavigationReady = () => {
    setIsNavigationReady(true);
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
    <NavigationContainer independent={true} onReady={handleNavigationReady}>
      <PostHogErrorBoundary>
        {isNavigationReady ? (
          <PostHogProvider
            apiKey={POSTHOG_API_KEY}
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
              <PostHogSurveyProvider>
                <OnboardingProvider>
                  <MessagingProvider>
                    <AppContent />
                    <StatusBar style="light" />
                  </MessagingProvider>
                </OnboardingProvider>
              </PostHogSurveyProvider>
            ) : (
              <OnboardingProvider>
                <MessagingProvider>
                  <AppContent />
                  <StatusBar style="light" />
                </MessagingProvider>
              </OnboardingProvider>
            )}
          </PostHogProvider>
        ) : (
          <OnboardingProvider>
            <MessagingProvider>
              <AppContent />
              <StatusBar style="light" />
            </MessagingProvider>
          </OnboardingProvider>
        )}
      </PostHogErrorBoundary>
    </NavigationContainer>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
