import React from 'react';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { OnboardingStep1Screen, OnboardingData } from '../screens/OnboardingStep1Screen';
import { OnboardingStep2Screen } from '../screens/OnboardingStep2Screen';
import { OnboardingStep3Screen } from '../screens/OnboardingStep3Screen';
import { ChatScreen } from '../screens/ChatScreen';
import { useOnboarding } from '../context/OnboardingContext';

export const AppContent: React.FC = () => {
  const { currentStep, formData, setCurrentStep, updateFormData } = useOnboarding();

  const handleGetStarted = () => {
    setCurrentStep(1);
  };

  const handleDemoChat = () => {
    setCurrentStep(1); // Go directly to chat screen
  };

  const handleStep1Next = (data: OnboardingData) => {
    console.log('Step 1 next called with data:', data);
    updateFormData(data);
    setCurrentStep(2); // Go to step 2 (surf level selection)
  };

  const handleStep2Next = (data: OnboardingData) => {
    console.log('Step 2 next called with data:', data);
    updateFormData(data);
    setCurrentStep(3); // Go to step 3 (travel experience)
  };

  const handleStep3Next = (data: OnboardingData) => {
    console.log('Step 3 next called with data:', data);
    updateFormData(data);
    setCurrentStep(4); // Go to step 4 (chat screen)
  };

  const handleStep1Back = () => {
    setCurrentStep(0); // Go back to welcome screen
  };

  const handleStep2Back = () => {
    setCurrentStep(1); // Go back to step 1
  };

  const handleStep3Back = () => {
    setCurrentStep(2); // Go back to step 2
  };

  // Show onboarding step 1 if we're on step 1
  if (currentStep === 1) {
    console.log('Rendering OnboardingStep1Screen with initialData:', formData);
    return (
      <OnboardingStep1Screen
        onNext={handleStep1Next}
        onBack={handleStep1Back}
        initialData={formData}
        updateFormData={updateFormData}
      />
    );
  }

  // Show onboarding step 2 if we're on step 2
  if (currentStep === 2) {
    console.log('Rendering OnboardingStep2Screen with initialData:', formData);
    return (
      <OnboardingStep2Screen
        onNext={handleStep2Next}
        onBack={handleStep2Back}
        initialData={formData}
        updateFormData={updateFormData}
      />
    );
  }

  // Show onboarding step 3 if we're on step 3
  if (currentStep === 3) {
    console.log('Rendering OnboardingStep3Screen with initialData:', formData);
    return (
      <OnboardingStep3Screen
        onNext={handleStep3Next}
        onBack={handleStep3Back}
        initialData={formData}
        updateFormData={updateFormData}
      />
    );
  }

  // Show chat screen if we're on step 4
  if (currentStep === 4) {
    return <ChatScreen />;
  }

  // Show welcome screen by default (step 0)
  return <WelcomeScreen onGetStarted={handleGetStarted} onDemoChat={handleDemoChat} />;
};