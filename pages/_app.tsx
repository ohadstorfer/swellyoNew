import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { OnboardingProvider } from '../src/context/OnboardingContext';
import { AppContent } from '../src/components/AppContent';

function MyApp({ Component, pageProps }: any) {
  // If it's the swelly_chat page, render it directly
  if (Component.name === 'SwellyChatPage') {
    return <Component {...pageProps} />;
  }
  
  // For all other routes, render the main app
  return (
    <OnboardingProvider>
      <AppContent />
      <StatusBar style="light" />
    </OnboardingProvider>
  );
}

export default MyApp;
