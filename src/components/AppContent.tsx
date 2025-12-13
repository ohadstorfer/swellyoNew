import React, { useState } from 'react';
import { Alert } from 'react-native';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { OnboardingStep1Screen, OnboardingData } from '../screens/OnboardingStep1Screen';
import { OnboardingStep2Screen } from '../screens/OnboardingStep2Screen';
import { OnboardingStep3Screen } from '../screens/OnboardingStep3Screen';
import { OnboardingStep4Screen } from '../screens/OnboardingStep4Screen';
import { LoadingScreen } from '../screens/LoadingScreen';
import { ChatScreen } from '../screens/ChatScreen';
import ConversationsScreen from '../screens/ConversationsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { DirectMessageScreen } from '../screens/DirectMessageScreen';
import { messagingService } from '../services/messaging/messagingService';
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

  const [showProfile, setShowProfile] = useState(false);
  const [showTripPlanningChat, setShowTripPlanningChat] = useState(false);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<{
    id?: string; // Optional: undefined for pending conversations
    otherUserId: string; // Required: the user ID we're messaging
    otherUserName: string;
    otherUserAvatar: string | null;
  } | null>(null);

  const handleChatComplete = () => {
    // Mark onboarding as complete and navigate to profile
    markOnboardingComplete();
    setShowProfile(true);
  };

  const handleProfileBack = () => {
    // Navigate back - restore trip planning chat if it was open
    setShowProfile(false);
    setViewingUserId(null);
    // If we were in trip planning chat before viewing profile, restore it
    // This is handled by the user navigating back to conversations and clicking Swelly again
  };

  const handleConversationPress = (conversationId: string) => {
    // ConversationsScreen handles navigation internally via selectedConversation state
    // This callback is kept for potential future use (e.g., analytics)
    console.log('Conversation pressed:', conversationId);
  };

  const handleSwellyPress = () => {
    // Navigate to Swelly trip planning chat from conversations page
    setShowTripPlanningChat(true);
  };

  const handleTripPlanningChatBack = () => {
    // Navigate back to conversations from trip planning chat
    setShowTripPlanningChat(false);
  };

  const handleProfilePress = () => {
    // Navigate to profile page from conversations page
    setShowProfile(true);
    setViewingUserId(null); // View own profile
  };

  const handleViewUserProfile = (userId: string) => {
    console.log('[AppContent] handleViewUserProfile called with userId:', userId);
    // Navigate to another user's profile
    // Close trip planning chat if open
    setShowTripPlanningChat(false);
    // Close conversation to show profile screen
    console.log('[AppContent] Closing conversation, setting selectedConversation to null');
    setSelectedConversation(null);
    console.log('[AppContent] Setting viewingUserId to:', userId);
    setViewingUserId(userId);
    console.log('[AppContent] Setting showProfile to true');
    setShowProfile(true);
    console.log('[AppContent] handleViewUserProfile completed');
  };

  const handleStartConversation = async (userId: string) => {
    try {
      // Check if conversation already exists
      const conversations = await messagingService.getConversations();
      const existingConv = conversations.find(conv => {
        if (conv.other_user && conv.other_user.user_id === userId) {
          return true;
        }
        return false;
      });
      
      if (existingConv && existingConv.other_user) {
        // Conversation exists, use it
        setSelectedConversation({
          id: existingConv.id,
          otherUserId: userId,
          otherUserName: existingConv.other_user.name || 'User',
          otherUserAvatar: existingConv.other_user.profile_image_url || null,
        });
      } else {
        // No conversation exists yet - create pending conversation
        // Get user details for display
        const { supabaseDatabaseService } = await import('../services/database/supabaseDatabaseService');
        const surferData = await supabaseDatabaseService.getSurferByUserId(userId);
        
        setSelectedConversation({
          // No id - this is a pending conversation
          otherUserId: userId,
          otherUserName: surferData?.name || 'User',
          otherUserAvatar: surferData?.profile_image_url || null,
        });
      }
      setShowTripPlanningChat(false); // Close chat to show conversation
    } catch (error) {
      console.error('Error starting conversation:', error);
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const handleBackFromChat = () => {
    setSelectedConversation(null);
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
    console.log('[AppContent] Rendering check - showProfile:', showProfile, 'viewingUserId:', viewingUserId);
    console.log('[AppContent] Rendering check - selectedConversation:', selectedConversation ? 'exists' : 'null');
    console.log('[AppContent] Rendering check - showTripPlanningChat:', showTripPlanningChat);
    
    // Show profile screen if requested (check before conversation)
    if (showProfile) {
      console.log('[AppContent] Rendering ProfileScreen for userId:', viewingUserId);
      return (
        <ProfileScreen 
          onBack={handleProfileBack}
          userId={viewingUserId ?? undefined}
          onMessage={handleStartConversation}
        />
      );
    }
    
    // Show direct message screen if conversation is selected
    if (selectedConversation) {
      console.log('[AppContent] Rendering DirectMessageScreen');
      console.log('[AppContent] handleViewUserProfile function exists:', !!handleViewUserProfile);
      console.log('[AppContent] handleViewUserProfile type:', typeof handleViewUserProfile);
      console.log('[AppContent] Passing onViewProfile prop:', handleViewUserProfile);
      return (
        <DirectMessageScreen
          conversationId={selectedConversation.id} // May be undefined for pending conversations
          otherUserId={selectedConversation.otherUserId}
          otherUserName={selectedConversation.otherUserName}
          otherUserAvatar={selectedConversation.otherUserAvatar}
          isDirect={true}
          onBack={handleBackFromChat}
          onViewProfile={handleViewUserProfile}
          onConversationCreated={(conversationId) => {
            // Update selectedConversation with the created conversation ID
            setSelectedConversation({
              ...selectedConversation,
              id: conversationId,
            });
          }}
        />
      );
    }
    
    // Show trip planning chat if requested
    if (showTripPlanningChat) {
      return (
        <ChatScreen 
          onChatComplete={handleTripPlanningChatBack} 
          conversationType="trip-planning"
          onViewUserProfile={handleViewUserProfile}
          onStartConversation={handleStartConversation}
        />
      );
    }
    
    return (
      <ConversationsScreen
        onConversationPress={handleConversationPress}
        onSwellyPress={handleSwellyPress}
        onProfilePress={handleProfilePress}
        onViewUserProfile={handleViewUserProfile}
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
  // Determine conversation type: if onboarding is complete, it's trip planning
  if (currentStep === 5) {
    const conversationType = isComplete ? 'trip-planning' : 'onboarding';
    return (
      <ChatScreen 
        onChatComplete={handleChatComplete} 
        conversationType={conversationType}
        onViewUserProfile={handleViewUserProfile}
        onStartConversation={handleStartConversation}
      />
    );
  }

  // Show welcome screen by default (step 0, before onboarding)
  return <WelcomeScreen onGetStarted={handleGetStarted} onDemoChat={handleDemoChat} />;
};