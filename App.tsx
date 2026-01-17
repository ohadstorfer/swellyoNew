import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { OnboardingProvider } from './src/context/OnboardingContext';
import { AppContent } from './src/components/AppContent';
import { analyticsService } from './src/services/analytics/analyticsService';

export default function App() {
  useEffect(() => {
    // Initialize PostHog analytics
    analyticsService.initialize();
  }, []);

  return (
    <OnboardingProvider>
      <AppContent />
      <StatusBar style="light" />
    </OnboardingProvider>
  );
}
