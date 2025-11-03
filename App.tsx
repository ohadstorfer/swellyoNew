import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { OnboardingProvider } from './src/context/OnboardingContext';
import { AppContent } from './src/components/AppContent';

export default function App() {
  return (
    <OnboardingProvider>
      <AppContent />
      <StatusBar style="light" />
    </OnboardingProvider>
  );
}
