import React, { useState } from 'react';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { OnboardingStep1Screen, OnboardingData } from '../screens/OnboardingStep1Screen';
import { OnboardingStep2Screen } from '../screens/OnboardingStep2Screen';
import { OnboardingStep3Screen } from '../screens/OnboardingStep3Screen';
import { OnboardingStep4Screen } from '../screens/OnboardingStep4Screen';
import { LoadingScreen } from '../screens/LoadingScreen';
import { ChatScreen } from '../screens/ChatScreen';
import ConversationsScreen from '../screens/ConversationsScreen';
import { useOnboarding } from '../context/OnboardingContext';

export const AppContent: React.FC = () => {
  const { currentStep, formData, setCurrentStep, updateFormData, saveStepToSupabase, isComplete, markOnboardingComplete } = useOnboarding();
  const [showLoading, setShowLoading] = useState(false);
  const [isSavingStep1, setIsSavingStep1] = useState(false);
  const [isSavingStep2, setIsSavingStep2] = useState(false);
  const [isSavingStep3, setIsSavingStep3] = useState(false);
  const [isSavingStep4, setIsSavingStep4] = useState(false);

  const handleGetStarted = () => {
    setCurrentStep(1);
  };

  const handleDemoChat = () => {
    setCurrentStep(1); // Go directly to chat screen
  };

  const handleStep1Next = async (data: OnboardingData) => {
    if (isSavingStep1) return; // Prevent multiple clicks
    
    console.log('Step 1 next called with data:', data);
    setIsSavingStep1(true);
    
    try {
      updateFormData(data);
      
      // Save Step 1 data to Supabase (board type) using onboarding service
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep1(data.boardType);
      
      // Soft Top (id: 3) skips step 2 and goes directly to step 3
      if (data.boardType === 3) {
        // Set a default surf level for Soft Top (level 3 as specified)
        updateFormData({ surfLevel: 3 });
        setCurrentStep(3); // Go directly to step 3 (travel experience)
      } else {
        setCurrentStep(2); // Go to step 2 (surf level selection)
      }
    } catch (error) {
      console.error('Error in Step 1 Next:', error);
      // Still allow navigation even if save fails
      if (data.boardType === 3) {
        updateFormData({ surfLevel: 3 });
        setCurrentStep(3);
      } else {
        setCurrentStep(2);
      }
    } finally {
      setIsSavingStep1(false);
    }
  };

  const handleStep2Next = async (data: OnboardingData) => {
    if (isSavingStep2) return; // Prevent multiple clicks
    
    console.log('Step 2 next called with data:', data);
    setIsSavingStep2(true);
    
    try {
      updateFormData(data);
      
      // Save Step 2 data to Supabase (surf level) using onboarding service
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep2(data.boardType!, data.surfLevel!);
      
      setCurrentStep(3); // Go to step 3 (travel experience)
    } catch (error) {
      console.error('Error in Step 2 Next:', error);
      // Still allow navigation even if save fails
      setCurrentStep(3);
    } finally {
      setIsSavingStep2(false);
    }
  };

  const handleStep3Next = async (data: OnboardingData) => {
    if (isSavingStep3) return; // Prevent multiple clicks
    
    console.log('Step 3 next called with data:', data);
    setIsSavingStep3(true);
    
    try {
      updateFormData(data);
      
      // Save Step 3 data to Supabase (travel experience) using onboarding service
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep3(data.boardType!, data.surfLevel!, data.travelExperience!);
      
      setCurrentStep(4); // Go to step 4 (profile details)
    } catch (error) {
      console.error('Error in Step 3 Next:', error);
      // Still allow navigation even if save fails
      setCurrentStep(4);
    } finally {
      setIsSavingStep3(false);
    }
  };

  const handleStep4Next = async (data: OnboardingData) => {
    if (isSavingStep4) return; // Prevent multiple clicks
    
    console.log('Step 4 next called with data:', data);
    setIsSavingStep4(true);
    
    try {
      updateFormData(data);
      
      // Save complete onboarding data to Supabase (all profile details) using onboarding service
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep4({
        nickname: data.nickname,
        userEmail: data.userEmail,
        location: data.location,
        age: data.age,
        profilePicture: data.profilePicture,
        pronouns: data.pronouns,
        boardType: data.boardType,
        surfLevel: data.surfLevel,
        travelExperience: data.travelExperience,
      });
      
      setShowLoading(true); // Show loading screen
    } catch (error) {
      console.error('Error in Step 4 Next:', error);
      // Still allow navigation even if save fails
      setShowLoading(true);
    } finally {
      setIsSavingStep4(false);
    }
  };

  const handleLoadingComplete = () => {
    setShowLoading(false);
    setCurrentStep(5); // Go to step 5 (Swelly chat screen)
  };

  const handleChatComplete = () => {
    // Mark onboarding as complete and show conversations as home page
    markOnboardingComplete();
    setCurrentStep(0); // Reset step to 0, but isComplete will show home
  };

  const handleConversationPress = (conversationId: string) => {
    // ConversationsScreen handles navigation internally via selectedConversation state
    // This callback is kept for potential future use (e.g., analytics)
    console.log('Conversation pressed:', conversationId);
  };

  const handleSwellyPress = () => {
    // Navigate to Swelly chat from conversations page
    setCurrentStep(5); // Show Swelly chat
  };

  const handleLoadingBack = () => {
    setShowLoading(false);
    setCurrentStep(4); // Go back to step 4
  };

  const handleStep1Back = () => {
    setCurrentStep(0); // Go back to welcome screen
  };

  const handleStep2Back = () => {
    setCurrentStep(1); // Go back to step 1
  };

  const handleStep3Back = () => {
    // If Soft Top (id: 3) was selected, go back to step 1 (since step 2 was skipped)
    if (formData.boardType === 3) {
      setCurrentStep(1); // Go back to step 1
    } else {
      setCurrentStep(2); // Go back to step 2
    }
  };

  const handleStep4Back = () => {
    setCurrentStep(3); // Go back to step 3
  };

  // If onboarding is complete, show conversations screen as home page (regardless of currentStep)
  // This check must come FIRST before any step checks
  if (isComplete) {
    return (
      <ConversationsScreen
        onConversationPress={handleConversationPress}
        onSwellyPress={handleSwellyPress}
      />
    );
  }

  // Show onboarding step 1 if we're on step 1
  if (currentStep === 1) {
    console.log('Rendering OnboardingStep1Screen with initialData:', formData);
    return (
      <OnboardingStep1Screen
        onNext={handleStep1Next}
        onBack={handleStep1Back}
        initialData={formData}
        updateFormData={updateFormData}
        isLoading={isSavingStep1}
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
        isLoading={isSavingStep2}
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
        isLoading={isSavingStep3}
      />
    );
  }

  // Show loading screen if triggered
  if (showLoading) {
    return (
      <LoadingScreen
        onComplete={handleLoadingComplete}
        onBack={handleLoadingBack}
      />
    );
  }

  // Show onboarding step 4 if we're on step 4
  if (currentStep === 4) {
    console.log('Rendering OnboardingStep4Screen with initialData:', formData);
    return (
      <OnboardingStep4Screen
        onNext={handleStep4Next}
        onBack={handleStep4Back}
        initialData={formData}
        updateFormData={updateFormData}
        isLoading={isSavingStep4}
      />
    );
  }

  // Show chat screen if we're on step 5 (Swelly chat)
  if (currentStep === 5) {
    return <ChatScreen onChatComplete={handleChatComplete} />;
  }

  // Show welcome screen by default (step 0, before onboarding)
  return <WelcomeScreen onGetStarted={handleGetStarted} onDemoChat={handleDemoChat} />;
};