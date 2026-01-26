import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider, PostHogSurveyProvider } from 'posthog-react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OnboardingProvider } from './src/context/OnboardingContext';
import { AppContent } from './src/components/AppContent';
import { analyticsService } from './src/services/analytics/analyticsService';

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';

export default function App() {
  useEffect(() => {
    // Initialize PostHog analytics (instance-based for tracking)
    analyticsService.initialize();
  }, []);

  return (
    <NavigationContainer independent={true}>
      <PostHogProvider
        apiKey={POSTHOG_API_KEY}
        options={{
          host: POSTHOG_HOST,
          enableSessionReplay: true,
          captureAppLifecycleEvents: true,
          captureDeepLinks: true,
          enableNativeNavigationTracking: false, // Disable navigation tracking to prevent useNavigationState errors
          debug: __DEV__, // Enable debug mode in development
        }}
      >
        <PostHogSurveyProvider>
          <OnboardingProvider>
            <AppContent />
            <StatusBar style="light" />
          </OnboardingProvider>
        </PostHogSurveyProvider>
      </PostHogProvider>
    </NavigationContainer>
  );
}
