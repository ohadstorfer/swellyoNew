import React from 'react';
import { ChatScreen } from '../src/screens/ChatScreen';
import { OnboardingProvider } from '../src/context/OnboardingContext';

export default function SwellyChatPage() {
  return (
    <OnboardingProvider>
      <ChatScreen />
    </OnboardingProvider>
  );
}
