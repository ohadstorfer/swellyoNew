import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Alert, Platform, View, TouchableOpacity, Text as RNText } from 'react-native';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { OnboardingWelcomeScreen } from '../screens/OnboardingWelcomeScreen';
import { OnboardingStep1Screen, OnboardingData } from '../screens/OnboardingStep1Screen';
import { OnboardingStep2Screen } from '../screens/OnboardingStep2Screen';
import { OnboardingStep3Screen } from '../screens/OnboardingStep3Screen';
import { OnboardingStep4Screen } from '../screens/OnboardingStep4Screen';
import { OnboardingVideoUploadScreen } from '../screens/OnboardingVideoUploadScreen';
import { LoadingScreen } from '../screens/LoadingScreen';
import { OnboardingChatScreen } from '../screens/ChatScreen';
import { TripPlanningChatScreen } from '../screens/TripPlanningChatScreen';
import { TripPlanningChatScreen as TripPlanningChatScreenCopy } from '../screens/TripPlanningChatScreenCopy';
import ConversationsScreen from '../screens/ConversationsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { DirectMessageScreen } from '../screens/DirectMessageScreen';
import { SwellyShaperScreen } from '../screens/SwellyShaperScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ConversationLoadingScreen } from '../components/ConversationLoadingScreen';
import { WelcomeToLineupOverlay } from '../components/WelcomeToLineupOverlay';
import { messagingService } from '../services/messaging/messagingService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { useOnboarding } from '../context/OnboardingContext';
import { analyticsService } from '../services/analytics/analyticsService';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { isFirstVideoReadyForBoardType, getVideoPreloadStatus, waitForVideoReady, preloadLoadingVideo, getLoadingVideoUrl } from '../services/media/videoPreloadService';
import { STEP_WELCOME } from '../constants/onboardingSteps';
import { swellyServiceCopy, swellyServiceCopyCopy } from '../services/swelly/swellyServiceCopy';
import { findAndConnectMatches, OnboardingMatchResult } from '../services/matching/onboardingMatchingService';
import { pushNotificationService } from '../services/notifications/pushNotificationService';
import { useMessaging } from '../context/MessagingProvider';

export const AppContent: React.FC = () => {
  const { currentStep, formData, setCurrentStep, updateFormData, saveStepToSupabase, isComplete, markOnboardingComplete, isDemoUser, setIsDemoUser, setUser, resetOnboarding, user, isRestoringSession } = useOnboarding();
  
  // Initialize auth guard - this will automatically redirect unauthenticated users
  useAuthGuard();
  const [showLoading, setShowLoading] = useState(false);
  const [isSavingStep1, setIsSavingStep1] = useState(false);
  const [isSavingStep2, setIsSavingStep2] = useState(false);
  const [showVideoUploadStep, setShowVideoUploadStep] = useState(false);
  const [isSavingStep3, setIsSavingStep3] = useState(false);
  const [isSavingStep4, setIsSavingStep4] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const authCheckStartTime = useRef<number>(Date.now());
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minLoadingDuration = 0; // No artificial delay — branded loading shows during session restoration
  
  // Refs to prevent race conditions from multiple rapid clicks
  const isNavigatingRef = useRef(false);
  const isLoggingOutRef = useRef(false);

  // Push notification: pending conversation to open from notification tap
  const [pendingNotificationConversationId, setPendingNotificationConversationId] = useState<string | null>(null);
  const { getCurrentConversationId } = useMessaging();
  
  // State to track session validation
  const [hasValidatedSession, setHasValidatedSession] = useState(false);
  const [isSupabaseConfigured, setIsSupabaseConfigured] = useState<boolean | null>(null);
  const sessionValidationRef = useRef(false);
  
  // Check if Supabase is configured on mount
  useEffect(() => {
    const checkSupabaseConfig = async () => {
      try {
        const { isSupabaseConfigured: checkConfig } = await import('../config/supabase');
        setIsSupabaseConfigured(checkConfig());
      } catch (error) {
        console.error('[AppContent] Error checking Supabase config:', error);
        setIsSupabaseConfigured(false);
      }
    };
    checkSupabaseConfig();
  }, []);
  
  // Validate session before showing ConversationsScreen
  useEffect(() => {
    // Only validate if onboarding is complete, user exists, not demo user, not already validating, and Supabase is configured
    if (isComplete && user !== null && !isDemoUser && !isRestoringSession && 
        !sessionValidationRef.current && isSupabaseConfigured === true) {
      sessionValidationRef.current = true;
      
      // Check if there's actually a valid Supabase session
      const validateSession = async () => {
        try {
          const { supabase } = await import('../config/supabase');
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError || !session) {
            // User exists in context but no valid session - trigger logout
            console.log('[AppContent] User in context but no valid session - triggering logout');
            const { performLogout } = await import('../utils/logout');
            await performLogout({
              resetOnboarding,
              setUser,
              setCurrentStep,
              setIsDemoUser,
            });
            return;
          }
          
          // Session is valid
          setHasValidatedSession(true);
        } catch (error) {
          console.error('[AppContent] Error validating session:', error);
          // On error, allow rendering (auth guard will handle it)
          setHasValidatedSession(true);
        } finally {
          sessionValidationRef.current = false;
        }
      };
      
      validateSession();
    } else if (user === null || !isComplete) {
      // Reset validation state when user logs out or onboarding not complete
      setHasValidatedSession(false);
      sessionValidationRef.current = false;
    } else if (isSupabaseConfigured === false) {
      // Supabase not configured - no need to validate, allow rendering
      setHasValidatedSession(true);
    }
  }, [isComplete, user, isDemoUser, isRestoringSession, isSupabaseConfigured, resetOnboarding, setUser, setCurrentStep, setIsDemoUser]);
  
  // Set up push notification handlers (foreground suppression + tap navigation)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    pushNotificationService.setupNotificationHandlers(
      getCurrentConversationId,
      (conversationId) => setPendingNotificationConversationId(conversationId)
    );
  }, [getCurrentConversationId]);

  // Preload loading video when arriving at step 4 (not after submitting)
  // This reduces loading time after step 4 submission
  useEffect(() => {
    if (currentStep === 4) {
      if (__DEV__) {
        console.log('[AppContent] Arrived at step 4, preloading loading video...');
      }
      
      // Start preloading loading video in background (non-blocking)
      preloadLoadingVideo('high')
        .then(result => {
          if (__DEV__) {
            console.log(`[AppContent] Loading video preload completed while on step 4: ready=${result.ready}`);
          }
        })
        .catch(err => {
          console.warn('[AppContent] Loading video preload failed (non-blocking):', err);
        });
    }
  }, [currentStep]);
  
  // Check if MVP and dev modes are enabled
  const isMVPMode = process.env.EXPO_PUBLIC_MVP_MODE === 'true';
  const isDevMode = process.env.EXPO_PUBLIC_DEV_MODE === 'true';
  const isLocalMode = process.env.EXPO_PUBLIC_LOCAL_MODE === 'true';

  // Helper function to stop checking auth after minimum duration
  const stopCheckingAuth = useCallback(() => {
    // If already scheduled, don't schedule again
    if (stopTimeoutRef.current !== null) {
      return;
    }
    
    const elapsed = Date.now() - authCheckStartTime.current;
    const remaining = Math.max(0, minLoadingDuration - elapsed);
    
    if (remaining > 0) {
      // Wait for remaining time to meet minimum duration
      stopTimeoutRef.current = setTimeout(() => {
        setIsCheckingAuth(false);
        stopTimeoutRef.current = null;
      }, remaining);
    } else {
      // Minimum duration already met, stop immediately
      setIsCheckingAuth(false);
      stopTimeoutRef.current = null;
    }
  }, [minLoadingDuration]);

  // Check for OAuth return indicators before rendering WelcomeScreen
  useEffect(() => {
    authCheckStartTime.current = Date.now();
    
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      // Not web, no OAuth return possible
      stopCheckingAuth();
      return;
    }

    // Check for OAuth return indicators (PKCE flow returns ?code= in query params)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
      // OAuth return detected - keep checking, let WelcomeScreen's checkAuthState handle it
      // The user effect below will stop checking when user is set (with minimum duration)
      // Also set a maximum timeout in case auth fails
      const maxTimeout = setTimeout(() => {
        // If user is still null after max delay, stop checking (auth might have failed)
        stopCheckingAuth();
      }, 5000); // 5 seconds max, but will respect minimum 3 seconds
      
      return () => {
        clearTimeout(maxTimeout);
      };
    } else {
      // No OAuth return - allow WelcomeScreen's checkAuthState to run briefly
      // Then stop checking after minimum duration
      stopCheckingAuth();
    }
  }, [stopCheckingAuth]);

  // Stop checking when user is set (but ensure minimum duration)
  useEffect(() => {
    if (user !== null) {
      stopCheckingAuth();
    }
  }, [user, stopCheckingAuth]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (stopTimeoutRef.current !== null) {
        clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }
    };
  }, []);

  // Identify user with PostHog when user is set
  useEffect(() => {
    if (user && user.id) {
      const userId = user.id.toString();
      const userProperties = {
        $email: user.email,
        $name: user.nickname || user.email?.split('@')[0] || 'User',
        email: user.email,
        name: user.nickname || user.email?.split('@')[0] || 'User',
      };
      
      analyticsService.identify(userId, userProperties);
      console.log('[AppContent] User identified with PostHog:', userId, userProperties);
    }
  }, [user]);

  const handleGetStarted = () => {
    setCurrentStep(0); // Go to onboarding welcome/explanation screen first
  };

  const handleDemoChat = async () => {
    try {
      // Clear any cached onboarding data from localStorage first
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.default.removeItem('@swellyo_onboarding');
      
      // Clear formData immediately to prevent cached data from being used
      updateFormData({
        nickname: '',
        userEmail: '',
        location: '',
        age: 0,
        boardType: -1, // No board selected by default - will show Short Board (index 0)
        surfLevel: 0,
        travelExperience: 0,
        profilePicture: undefined,
        pronouns: undefined,
      });
      
      // Create demo user and authenticate
      const { supabaseAuthService } = await import('../services/auth/supabaseAuthService');
      const demoUser = await supabaseAuthService.createDemoUser();
      
      // Set demo user in context
      setUser({
        id: demoUser.id,
        email: demoUser.email,
        nickname: demoUser.nickname,
        googleId: demoUser.googleId || demoUser.id,
        createdAt: demoUser.createdAt,
        updatedAt: demoUser.updatedAt,
      });
      
      // Mark as demo user
      setIsDemoUser(true);
      
      // Ensure formData is still cleared (in case it was set during user creation)
      updateFormData({
        nickname: '',
        userEmail: '',
        location: '',
        age: 0,
        boardType: -1, // No board selected by default
        surfLevel: 0,
        travelExperience: 0,
        profilePicture: undefined,
        pronouns: undefined,
      });
      
      // Start onboarding process - go to explanation screen first
      setCurrentStep(0);
    } catch (error: any) {
      console.error('Error creating demo user:', error);
      Alert.alert('Error', 'Failed to create demo user. Please try again.');
    }
  };

  const handleSkipDemo = async () => {
    try {
      // 1. Clear cached onboarding data
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.default.removeItem('@swellyo_onboarding');

      // 2. Create demo user
      const { supabaseAuthService } = await import('../services/auth/supabaseAuthService');
      const demoUser = await supabaseAuthService.createDemoUser();

      // 3. Set user in context
      setUser({
        id: demoUser.id,
        email: demoUser.email,
        nickname: demoUser.nickname,
        googleId: demoUser.googleId || demoUser.id,
        createdAt: demoUser.createdAt,
        updatedAt: demoUser.updatedAt,
      });
      setIsDemoUser(true);

      // 4. Save steps 1-4 data (creates users + surfers rows)
      const { supabaseDatabaseService } = await import('../services/database/supabaseDatabaseService');
      await supabaseDatabaseService.saveOnboardingData({
        nickname: `Demo Surfer ${Math.floor(10000 + Math.random() * 90000)}`,
        age: 25,
        pronouns: 'Bro',
        location: 'Israel',
        boardType: 0,        // shortboard
        surfLevel: 2,        // 0-indexed → DB stores 3 → "Snapping" / "advanced"
        travelExperience: 10,
        isDemoUser: true,
      });

      // 5. Save step 5 (Swelly chat) data
      await supabaseDatabaseService.saveSurfer({
        destinationsArray: [
          { country: 'Indonesia', area: ['Bali'], time_in_days: 14, time_in_text: '2 weeks' },
          { country: 'United States', area: ['Hawaii'], time_in_days: 14, time_in_text: '2 weeks' },
          { country: 'El Salvador', area: [], time_in_days: 14, time_in_text: '2 weeks' },
        ],
        travelBuddies: 'solo',
        travelType: 'budget',
        lifestyleKeywords: ['yoga', 'gym'],
        finishedOnboarding: true,
        isDemoUser: true,
      });

      // 6. Update local form data
      updateFormData({
        nickname: `Demo Surfer ${Math.floor(10000 + Math.random() * 90000)}`,
        boardType: 0,
        surfLevel: 2,
        travelExperience: 10,
        pronouns: 'Bro',
      });

      // 7. Navigate to profile (MUST be before markOnboardingComplete to prevent race condition)
      setProfileFromOnboardingChat(true);
      setShowProfile(true);

      // 8. Mark onboarding complete
      await markOnboardingComplete();
    } catch (error: any) {
      console.error('Error in skip demo:', error);
      Alert.alert('Error', 'Failed to create demo profile. Please try again.');
    }
  };

  const handleStep1Next = async (data: OnboardingData) => {
    if (isSavingStep1) return; // Prevent multiple clicks

    const t0 = Date.now();
    console.log(`[AppContent] Step 1 Next pressed, boardType=${data.boardType}`);
    setIsSavingStep1(true);

    try {
      updateFormData(data);

      // Save Step 1 data to Supabase — fire and forget, don't block navigation
      import('../services/onboarding/onboardingService').then(({ onboardingService }) =>
        onboardingService.saveStep1(data.boardType)
          .then(() => console.log(`[AppContent] Supabase save done (+${Date.now() - t0}ms)`))
          .catch(err => console.warn('[AppContent] Step 1 save failed (non-blocking):', err))
      );

      // Track onboarding step 1 completion
      analyticsService.trackOnboardingStep1Completed();

      // Soft Top (id: 3) skips step 2 and goes directly to step 3
      if (data.boardType === 3) {
        updateFormData({ surfLevel: 0 });
        setCurrentStep(3);
      } else {
        // Navigate immediately — headless player warms AVPlayer's cache in background.
        // Step 2's player benefits from useCaching; thumbnail stays until readyToPlay.
        const firstReady = isFirstVideoReadyForBoardType(data.boardType);
        console.log(`[AppContent] Navigating to step 2, cache warm=${firstReady} (+${Date.now() - t0}ms)`);
        setCurrentStep(2);
      }
    } catch (error) {
      console.error('Error in Step 1 Next:', error);
      // Still allow navigation even if save fails
      if (data.boardType === 3) {
        updateFormData({ surfLevel: 0 });
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
      
      setShowVideoUploadStep(true); // Show video upload mid-step
    } catch (error) {
      console.error('Error in Step 2 Next:', error);
      // Still allow navigation even if save fails
      setShowVideoUploadStep(true);
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
        isDemoUser: isDemoUser, // Pass demo user flag
      });
      
      // Update PostHog with the new name if user exists
      if (user && user.id) {
        const userId = user.id.toString();
        const userProperties = {
          $email: data.userEmail,
          $name: data.nickname || data.userEmail?.split('@')[0] || 'User',
          email: data.userEmail,
          name: data.nickname || data.userEmail?.split('@')[0] || 'User',
        };
        analyticsService.identify(userId, userProperties);
        console.log('[AppContent] User name updated in PostHog:', userId, userProperties);
      }
      
      // Check if loading video is already preloaded (should be, since we preload on step 4 arrival)
      const loadingVideoUrl = getLoadingVideoUrl();
      const preloadStatus = getVideoPreloadStatus(loadingVideoUrl);
      
      if (preloadStatus?.ready) {
        // Video is ready, navigate immediately
        if (__DEV__) {
          console.log('[AppContent] Loading video is preloaded and ready, navigating to loading screen immediately');
        }
        setShowLoading(true);
      } else {
        // Video not ready yet (should be rare if preload started on step 4 arrival)
        // Wait briefly (up to 2 seconds) for preload to complete, then navigate anyway
        if (__DEV__) {
          console.log('[AppContent] Loading video not ready yet, waiting briefly before navigating...');
        }
        
        const preloadReady = await waitForVideoReady(loadingVideoUrl, 2000);
        
        if (preloadReady) {
          if (__DEV__) {
            console.log('[AppContent] Loading video became ready, navigating to loading screen');
          }
          setShowLoading(true);
        } else {
          // Timeout reached, navigate anyway (graceful degradation)
          if (__DEV__) {
            console.warn('[AppContent] Navigating to loading screen (video will load normally)');
          }
          setShowLoading(true);
        }
      }
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
    // Start tracking onboarding abandonment (12 min timer)
    analyticsService.startOnboardingAbandonTracking();
    // Register for push notifications (non-blocking)
    pushNotificationService.registerForPushNotifications().catch(err =>
      console.warn('[AppContent] Push registration failed (non-blocking):', err)
    );
  };

  const [showProfile, setShowProfile] = useState(false);
  const [showTripPlanningChat, setShowTripPlanningChat] = useState(false);
  const [showTripPlanningChatCopy, setShowTripPlanningChatCopy] = useState(false);
  const [showSwellyShaper, setShowSwellyShaper] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [profileFromSwellyShaper, setProfileFromSwellyShaper] = useState(false); // Track if profile was opened from Swelly Shaper
  const [profileFromTripPlanningChat, setProfileFromTripPlanningChat] = useState(false); // Track if profile was opened from trip planning chat
  const [profileFromOnboardingChat, setProfileFromOnboardingChat] = useState(false); // Track if profile was opened right after Swelly onboarding chat (special header)
  const [profileFromWelcomeOverlay, setProfileFromWelcomeOverlay] = useState(false); // Track if profile was opened from WelcomeToLineupOverlay

  // Trip planning chat state - persisted between navigations
  const [tripPlanningChatId, setTripPlanningChatId] = useState<string | null>(null);
  const [tripPlanningMatchedUsers, setTripPlanningMatchedUsers] = useState<any[]>([]);
  const [tripPlanningDestination, setTripPlanningDestination] = useState<string>('');
  
  const [selectedConversation, setSelectedConversation] = useState<{
    id?: string; // Optional: undefined for pending conversations
    otherUserId: string; // Required: the user ID we're messaging
    otherUserName: string;
    otherUserAvatar: string | null;
    fromTripPlanning?: boolean; // If true, conversation was created from trip planning recommendations
    fromTripPlanningCopy?: boolean; // If true, conversation was created from the Copy variant of trip planning
    fromWelcomeOverlay?: boolean; // If true, conversation was created from WelcomeToLineupOverlay
  } | null>(null);
  
  // State for conversation loading screen
  const [showConversationLoading, setShowConversationLoading] = useState(false);
  const [pendingConversation, setPendingConversation] = useState<{
    otherUserId: string;
    otherUserName: string;
    otherUserAvatar: string | null;
    fromTripPlanning: boolean;
    fromTripPlanningCopy?: boolean;
    fromWelcomeOverlay?: boolean;
    conversationId?: string;
  } | null>(null);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('User');
  const [showWelcomeToLineupOverlay, setShowWelcomeToLineupOverlay] = useState(false);
  const [onboardingMatchResult, setOnboardingMatchResult] = useState<OnboardingMatchResult | null>(null);
  const [pendingOnboardingMatches, setPendingOnboardingMatches] = useState<OnboardingMatchResult['matches'] | null>(null);

  const handleChatComplete = async () => {
    console.log('[AppContent] handleChatComplete called');
    
    // Set showProfile and from-onboarding flag FIRST to prevent race condition
    setProfileFromOnboardingChat(true); // Show special header (Swelly Shaper left, Save right)
    setShowProfile(true);
    console.log('[AppContent] Navigating to profile screen (from onboarding chat)');
    
    // Mark onboarding as complete AFTER setting showProfile
    // This ensures showProfile is true when isComplete becomes true, preventing blocking logic from redirecting
    await markOnboardingComplete();
    console.log('[AppContent] Onboarding marked as complete');
    
    // Note: onboarding_step2_completed is already tracked in ChatScreen.tsx with duration
    // This duplicate call is removed to avoid double tracking
  };

  const handleProfileBack = () => {
    console.log('[AppContent] handleProfileBack called');
    console.log('[AppContent] profileFromTripPlanningChat:', profileFromTripPlanningChat);

    // Clear any selected conversation to prevent it from showing when profile closes
    setSelectedConversation(null);

    // If profile was opened from WelcomeToLineupOverlay, return to overlay
    if (profileFromWelcomeOverlay) {
      console.log('[AppContent] Returning to WelcomeToLineupOverlay');
      setShowProfile(false);
      setViewingUserId(null);
      setProfileFromWelcomeOverlay(false);
      // showWelcomeToLineupOverlay is still true, so overlay will re-appear
      return;
    }

    // If profile was opened from trip planning chat, return to chat
    if (profileFromTripPlanningChat) {
      console.log('[AppContent] Returning to trip planning chat');
      setShowProfile(false);
      setViewingUserId(null);
      setProfileFromTripPlanningChat(false); // Reset flag
      setShowTripPlanningChat(true); // Return to chat
      return;
    }

    // Otherwise, navigate back to conversations/home (homepage)
    console.log('[AppContent] Navigating to conversations/home');
    setShowProfile(false);
    setViewingUserId(null);
    setProfileFromSwellyShaper(false); // Reset flag if it was set
    setProfileFromOnboardingChat(false); // Reset so next profile open uses normal header
  };

  const handleSaveAndGoToConversations = useCallback(() => {
    handleProfileBack();

    // Find top 3 matches, create conversations, and store result for the overlay
    findAndConnectMatches()
      .then((result) => {
        if (result && result.match_count > 0) {
          console.log(`[AppContent] Created ${result.match_count} match conversations`);
          setOnboardingMatchResult(result);
          setShowWelcomeToLineupOverlay(true);
        }
      })
      .catch((err) => {
        console.warn('[AppContent] Matching failed (non-blocking):', err);
      });
  }, []);


  const handleSwellyShaperBack = () => {
    // Navigate back from Swelly Shaper to profile
    // Set flag so back button knows to return to Swelly Shaper
    setProfileFromSwellyShaper(true);
    setShowSwellyShaper(false);
    setShowProfile(true);
  };

  const handleSwellyShaperViewProfile = () => {
    console.log('[AppContent] handleSwellyShaperViewProfile called');
    console.log('[AppContent] Current state - showSwellyShaper:', showSwellyShaper, 'showProfile:', showProfile);
    // Navigate from Swelly Shaper to profile - set flag so user sees Edit/Save header and can save or go back to Swelly Shaper
    setProfileFromOnboardingChat(true);
    setViewingUserId(null); // Ensure viewing own profile
    setShowSwellyShaper(false);
    setShowProfile(true);
    console.log('[AppContent] After state update - should show profile now');
  };

  const handleConversationPress = (conversationId: string) => {
    // ConversationsScreen handles navigation internally via selectedConversation state
    // This callback is kept for potential future use (e.g., analytics)
    console.log('Conversation pressed:', conversationId);
  };

  const restoreLatestChatIfNeeded = async () => {
    if (tripPlanningChatId) return; // Already have a chat
    try {
      const latest = await swellyServiceCopy.getLatestTripPlanningChat();
      if (latest?.chat_id) {
        // Don't restore chats older than 1 week
        if (latest.updated_at) {
          const chatDate = new Date(latest.updated_at);
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          if (chatDate < oneWeekAgo) {
            return;
          }
        }
        setTripPlanningChatId(latest.chat_id);
      }
    } catch (e) {
      console.error('Failed to fetch latest trip planning chat:', e);
    }
  };

  // Track which service instance the copy screen should use
  const [activeCopyService, setActiveCopyService] = useState<'copy' | 'copy-copy'>('copy');

  const handleSwellyPress = () => {
    setActiveCopyService('copy');
    setShowTripPlanningChatCopy(true);
  };

  const handleSwellyPressCopy = async () => {
    // Dev card: uses swelly-trip-planning-copy-copy edge
    await restoreLatestChatIfNeeded();
    setActiveCopyService('copy-copy');
    setShowTripPlanningChatCopy(true);
  };

  const handleTripPlanningChatBack = () => {
    // Navigate back to conversations from trip planning chat
    setShowTripPlanningChat(false);
  };

  const handleProfilePress = () => {
    // Navigate to profile page from conversations page
    // Reset flag since this is normal navigation (not from Swelly Shaper)
    setProfileFromSwellyShaper(false);
    setShowProfile(true);
    setViewingUserId(null); // View own profile
  };

  const handleViewUserProfile = (userId: string, fromTripPlanningChat?: boolean) => {
    console.log('[AppContent] handleViewUserProfile called with userId:', userId, 'fromTripPlanningChat:', fromTripPlanningChat);
    // Navigate to another user's profile
    // Reset flags
    setProfileFromSwellyShaper(false);
    setProfileFromTripPlanningChat(fromTripPlanningChat || false);
    
    // If coming from trip planning chat, don't close it - we'll return to it on back
    if (!fromTripPlanningChat) {
      // Close trip planning chat if open (only if not coming from it)
      setShowTripPlanningChat(false);
    }
    
    // Preload surf level video early (non-blocking) before navigation
    const preloadUserProfileVideo = async (targetUserId: string) => {
      try {
        const { supabaseDatabaseService } = await import('../services/database/supabaseDatabaseService');
        const surferData = await supabaseDatabaseService.getSurferByUserId(targetUserId);
        
        if (surferData) {
          // Calculate surf level video URL using same logic as ProfileScreen
          const mapBoardTypeToNumber = (boardType: string): number => {
            const boardTypeLower = boardType.toLowerCase();
            if (boardTypeLower === 'shortboard') return 0;
            if (boardTypeLower === 'midlength' || boardTypeLower === 'mid_length') return 1;
            if (boardTypeLower === 'longboard') return 2;
            if (boardTypeLower === 'softtop' || boardTypeLower === 'soft_top') return 3;
            return 0; // Default to shortboard
          };
          
          const getBoardFolder = (boardType: number): string => {
            const folderMap: { [key: number]: string } = {
              0: 'shortboard',
              1: 'midlength',
              2: 'longboard',
              3: 'softtop',
            };
            return folderMap[boardType] || 'shortboard';
          };
          
          const BOARD_VIDEO_DEFINITIONS: { [boardType: number]: Array<{ name: string; videoFileName: string; thumbnailFileName: string }> } = {
            0: [
              { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
              { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
              { name: 'Snapping', videoFileName: 'Snapping.mp4', thumbnailFileName: 'Snapping thumbnail.PNG' },
              { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
            ],
            1: [
              { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
              { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
              { name: 'Carving Turns', videoFileName: 'Carving Turns.mp4', thumbnailFileName: 'Carving Turns thumbnail.PNG' },
              { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
            ],
            2: [
              { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
              { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
              { name: 'Cross Stepping', videoFileName: 'CrossStepping.mp4', thumbnailFileName: 'CrossStepping thumbnail.PNG' },
              { name: 'Hanging Toes', videoFileName: 'Hanging Toes.mp4', thumbnailFileName: 'Hanging Toes thumbnail.PNG' },
            ],
            3: [
              { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
            ],
          };
          
          const boardType = surferData.surfboard_type || 'shortboard';
          const surfLevel = surferData.surf_level || 1;
          const boardTypeNum = mapBoardTypeToNumber(boardType);
          const boardVideos = BOARD_VIDEO_DEFINITIONS[boardTypeNum];
          
          if (boardVideos && boardVideos.length > 0) {
            // Convert database surf level (1-5) to app level (0-4)
            const appLevel = surfLevel - 1;
            
            // Clamp to valid range
            const videoIndex = Math.max(0, Math.min(appLevel, boardVideos.length - 1));
            const video = boardVideos[videoIndex];
            
            if (video) {
              const boardFolder = getBoardFolder(boardTypeNum);
              const { getSurfLevelVideoFromStorage } = await import('../services/media/videoService');
              const defaultVideoUrl = getSurfLevelVideoFromStorage(`${boardFolder}/${video.videoFileName}`);
              
              if (defaultVideoUrl) {
                const { preloadVideo } = await import('../services/media/videoPreloadService');
                preloadVideo(defaultVideoUrl, 'high')
                  .then(result => {
                    if (__DEV__) {
                      console.log(`[AppContent] Preloaded surf level video for user ${targetUserId}: ready=${result.ready}`);
                    }
                  })
                  .catch(err => {
                    console.warn('[AppContent] Surf level video preload failed:', err);
                  });
              }
            }
          }
        }
      } catch (error) {
        console.warn('[AppContent] Error preloading user profile video:', error);
      }
    };
    
    // Start preload immediately (non-blocking)
    preloadUserProfileVideo(userId);
    
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
    console.log('[AppContent] ========== handleStartConversation START ==========');
    console.log('[AppContent] handleStartConversation called with userId:', userId);
    console.log('[AppContent] Current state - showTripPlanningChat:', showTripPlanningChat);
    console.log('[AppContent] Current state - profileFromTripPlanningChat:', profileFromTripPlanningChat);
    console.log('[AppContent] Current state - showConversationLoading:', showConversationLoading);
    console.log('[AppContent] Current state - pendingConversation:', pendingConversation);
    console.log('[AppContent] Current state - selectedConversation:', selectedConversation);
    
    try {
      // Check if we're in trip planning chat context (either from profile or directly from chat)
      const isFromTripPlanning = profileFromTripPlanningChat || showTripPlanningChat || false;
      console.log('[AppContent] isFromTripPlanning determined as:', isFromTripPlanning, '(profileFromTripPlanningChat:', profileFromTripPlanningChat, ', showTripPlanningChat:', showTripPlanningChat, ')');
      
      // Check if conversation already exists
      console.log('[AppContent] Checking if conversation exists for userId:', userId);
      const result = await messagingService.getConversations(50, 0); // Fetch first page
      const conversations = result.conversations;
      const existingConv = conversations.find(conv => {
        if (conv.other_user && conv.other_user.user_id === userId) {
          return true;
        }
        return false;
      });
      
      console.log('[AppContent] Conversation exists:', !!existingConv);
      
      if (existingConv && existingConv.other_user) {
        // Conversation exists, use it immediately (no loading screen)
        console.log('[AppContent] ✓ Conversation exists, navigating directly to conversation');
        console.log('[AppContent] Conversation ID:', existingConv.id);
        console.log('[AppContent] Other user name:', existingConv.other_user.name);
        setSelectedConversation({
          id: existingConv.id,
          otherUserId: userId,
          otherUserName: existingConv.other_user.name || 'User',
          otherUserAvatar: existingConv.other_user.profile_image_url || null,
          fromTripPlanning: isFromTripPlanning,
          fromTripPlanningCopy: isFromTripPlanning && showTripPlanningChatCopy,
        });
        console.log('[AppContent] selectedConversation state updated');
      } else {
        // No conversation exists yet - get user details for display
        console.log('[AppContent] ✗ No conversation exists, fetching user data');
        const { supabaseDatabaseService } = await import('../services/database/supabaseDatabaseService');
        const surferData = await supabaseDatabaseService.getSurferByUserId(userId);
        console.log('[AppContent] Fetched surfer data:', surferData?.name || 'Unknown');
        console.log('[AppContent] Surfer avatar:', !!surferData?.profile_image_url);
        
        // Show loading screen for all new conversations
        console.log('[AppContent] ✓ Preparing to show loading screen for new conversation');
        // Load current user data for loading screen
        try {
          console.log('[AppContent] Loading current user data for loading screen');
          const currentUser = await supabaseAuthService.getCurrentUser();
          if (currentUser) {
            console.log('[AppContent] Current user loaded:', currentUser.nickname || currentUser.email);
            setCurrentUserAvatar(currentUser.photo || null);
            setCurrentUserName(currentUser.nickname || currentUser.email?.split('@')[0] || 'User');
          } else {
            console.warn('[AppContent] No current user found');
          }
        } catch (error) {
          console.error('[AppContent] Error loading current user data:', error);
        }

        console.log('[AppContent] Setting pending conversation...');
        setPendingConversation({
          otherUserId: userId,
          otherUserName: surferData?.name || 'User',
          otherUserAvatar: surferData?.profile_image_url || null,
          fromTripPlanning: isFromTripPlanning,
          fromTripPlanningCopy: isFromTripPlanning && showTripPlanningChatCopy,
          fromWelcomeOverlay: profileFromWelcomeOverlay || false,
        });
        console.log('[AppContent] pendingConversation state updated');
        console.log('[AppContent] Setting showConversationLoading to true...');
        setShowConversationLoading(true);
        console.log('[AppContent] ✓ showConversationLoading set to true');

        // Create conversation immediately in background (same as WelcomeToLineupOverlay connect flow)
        if (profileFromWelcomeOverlay) {
          messagingService.createDirectConversation(userId, false).then((conversation) => {
            console.log('[AppContent] Conversation created/found for welcome overlay profile connect:', conversation.id);
            setPendingConversation(prev => prev ? { ...prev, conversationId: conversation.id } : null);
          }).catch((error) => {
            console.error('[AppContent] Error creating conversation from profile:', error);
          });
        }
      }
      
      // If profile was opened from the WelcomeToLineupOverlay, dismiss the overlay
      if (profileFromWelcomeOverlay) {
        setShowWelcomeToLineupOverlay(false);
        setProfileFromWelcomeOverlay(false);
      }

      // Close profile screen to show conversation
      console.log('[AppContent] Closing profile screen...');
      setShowProfile(false);
      setViewingUserId(null);
      console.log('[AppContent] Profile screen closed');
      
      // Note: We keep showTripPlanningChat true so back button works correctly
      // The loading screen will be rendered on top due to rendering order
      
      console.log('[AppContent] ========== handleStartConversation COMPLETE ==========');
      console.log('[AppContent] Final state - showConversationLoading:', showConversationLoading);
      console.log('[AppContent] Final state - pendingConversation:', pendingConversation ? 'exists' : 'null');
    } catch (error) {
      console.error('[AppContent] Error starting conversation:', error);
      Alert.alert('Error', 'Failed to start conversation');
    }
  };
  
  const handleConversationLoadingComplete = () => {
    console.log('[AppContent] handleConversationLoadingComplete called');
    console.log('[AppContent] pendingConversation:', pendingConversation);
    
    // After loading screen completes, navigate to conversation
    if (pendingConversation) {
      console.log('[AppContent] Navigating to conversation after loading screen');
      setSelectedConversation({
        id: pendingConversation.conversationId,
        otherUserId: pendingConversation.otherUserId,
        otherUserName: pendingConversation.otherUserName,
        otherUserAvatar: pendingConversation.otherUserAvatar,
        fromTripPlanning: pendingConversation.fromTripPlanning,
        fromTripPlanningCopy: pendingConversation.fromTripPlanningCopy,
        fromWelcomeOverlay: pendingConversation.fromWelcomeOverlay,
      });
      setShowConversationLoading(false);
      setPendingConversation(null);
      console.log('[AppContent] Navigation complete, loading screen hidden');
    } else {
      console.warn('[AppContent] handleConversationLoadingComplete called but no pendingConversation');
    }
  };

  const handleBackFromChat = () => {
    // If user came from trip planning, return there
    if (selectedConversation?.fromTripPlanning) {
      const goBackToCopy = selectedConversation?.fromTripPlanningCopy;
      setSelectedConversation(null);
      if (goBackToCopy) {
        setShowTripPlanningChatCopy(true);
      } else {
        setShowTripPlanningChat(true);
      }
      // Reset profile flag since we're going back to trip planning
      setProfileFromTripPlanningChat(false);
    } else {
      setSelectedConversation(null);
    }
  };

  const handleLoadingBack = () => {
    setShowLoading(false);
    setCurrentStep(4); // Go back to step 4
  };

  const handleStep1Back = () => {
    // Prevent multiple simultaneous navigation calls
    if (isNavigatingRef.current) {
      if (__DEV__) {
        console.log('[AppContent] Navigation already in progress, ignoring back button click');
      }
      return;
    }
    
    isNavigatingRef.current = true;
    
    try {
      if (__DEV__) {
        console.log('[AppContent] Step 1 back button clicked, navigating to step 0');
      }
      
      // Navigate immediately (synchronous)
      setCurrentStep(0);
    } catch (error) {
      console.error('[AppContent] Error navigating back from step 1:', error);
      // Retry navigation after a short delay
      setTimeout(() => {
        try {
          setCurrentStep(0);
        } catch (retryError) {
          console.error('[AppContent] Retry navigation also failed:', retryError);
        }
      }, 100);
    } finally {
      // Reset flag after a delay to allow state updates to propagate
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 500);
    }
  };

  const handleStep2Back = () => {
    setCurrentStep(1); // Go back to step 1
  };

  const handleVideoUploadSkip = () => {
    setShowVideoUploadStep(false);
    setCurrentStep(3);
  };

  const handleVideoUploadNext = () => {
    setShowVideoUploadStep(false);
    setCurrentStep(3);
  };

  const handleVideoUploadBack = () => {
    setShowVideoUploadStep(false);
    // currentStep is still 2, so it shows step 2 screen
  };

  const handleStep3Back = () => {
    // If Soft Top (id: 3) was selected, go back to step 1 (since step 2 was skipped)
    if (formData.boardType === 3) {
      setCurrentStep(1); // Go back to step 1
    } else {
      setCurrentStep(2);
      setShowVideoUploadStep(true); // Go back to video upload screen
    }
  };

  const handleStep4Back = () => {
    setCurrentStep(3); // Go back to step 3
  };


  // If onboarding is complete AND user is authenticated, show conversations screen as home page
  // This check must come FIRST before any step checks
  // CRITICAL: Must check user !== null to prevent showing conversations screen after logout
  // Also validate that session exists (unless Supabase not configured or demo user)
  // Don't show if we're currently validating (wait for validation to complete)
  const shouldShowConversations = isComplete && user !== null &&
    !sessionValidationRef.current && // Don't show while validating
    (isDemoUser || isSupabaseConfigured === false || hasValidatedSession); // Show if demo user, Supabase not configured, or session validated

  // Load current user profile data (name + avatar) when entering main app
  useEffect(() => {
    if (shouldShowConversations && (currentUserName === 'User' || !currentUserAvatar)) {
      supabaseAuthService.getCurrentUser().then((currentUser) => {
        if (currentUser) {
          setCurrentUserAvatar(currentUser.photo || null);
          setCurrentUserName(currentUser.nickname || currentUser.email?.split('@')[0] || 'User');
        }
      }).catch(() => {});
    }
  }, [shouldShowConversations]);

  // Wait for session restoration to complete before rendering
  // This prevents premature redirects before we know if user has a valid session
  if (isRestoringSession) {
    // Show the branded loading experience (background video + spinning logo)
    // instead of a white screen while restoring the session
    return (
      <WelcomeScreen
        onGetStarted={handleGetStarted}
        isCheckingAuth={true}
      />
    );
  }

  // Note: Removed premature WelcomeScreen redirect check
  // The auth guard now handles all authentication redirects after session restoration completes

  if (shouldShowConversations) {
    console.log('[AppContent] Rendering check - showProfile:', showProfile, 'viewingUserId:', viewingUserId);
    console.log('[AppContent] Rendering check - selectedConversation:', selectedConversation ? 'exists' : 'null');
    console.log('[AppContent] Rendering check - showTripPlanningChat:', showTripPlanningChat);
    
    // Show Settings screen if requested
    if (showSettings) {
      return (
        <SettingsScreen
          onBack={() => setShowSettings(false)}
          userName={currentUserName}
          userAvatar={currentUserAvatar}
          userEmail={user?.email}
        />
      );
    }

    // Show Swelly Shaper screen if requested (check before profile)
    if (showSwellyShaper) {
      console.log('[AppContent] Rendering SwellyShaperScreen');
      console.log('[AppContent] Passing onViewProfile:', typeof handleSwellyShaperViewProfile);
      return (
        <SwellyShaperScreen 
          onBack={handleSwellyShaperBack}
          onViewProfile={handleSwellyShaperViewProfile}
        />
      );
    }

    // Show profile screen if requested (check before conversation)
    if (showProfile) {
      console.log('[AppContent] Rendering ProfileScreen for userId:', viewingUserId);
      console.log('[AppContent] profileFromSwellyShaper flag:', profileFromSwellyShaper);
      
      return (
        <ProfileScreen 
          onBack={handleProfileBack}
          userId={viewingUserId ?? undefined}
          onMessage={handleStartConversation}
          fromOnboardingChat={profileFromOnboardingChat}
          onSaveAndGoToConversations={handleSaveAndGoToConversations}
          onEdit={() => {
            // When clicking edit (from onboarding profile), open Swelly Shaper without resetting fromOnboardingChat
            setShowProfile(false);
            setShowSwellyShaper(true);
          }}
        />
      );
    }
    
    // Show conversation loading screen if pending conversation from trip planning
    // This check MUST come before trip planning chat check to ensure it renders on top
    console.log('[AppContent] Rendering check - showConversationLoading:', showConversationLoading, 'pendingConversation:', !!pendingConversation);
    if (showConversationLoading && pendingConversation) {
      console.log('[AppContent] ✓ Rendering ConversationLoadingScreen');
      console.log('[AppContent] Loading screen props - currentUserAvatar:', !!currentUserAvatar, 'currentUserName:', currentUserName);
      console.log('[AppContent] Loading screen props - otherUserAvatar:', !!pendingConversation.otherUserAvatar, 'otherUserName:', pendingConversation.otherUserName);
      return (
        <ConversationLoadingScreen
          currentUserAvatar={currentUserAvatar}
          currentUserName={currentUserName}
          otherUserAvatar={pendingConversation.otherUserAvatar}
          otherUserName={pendingConversation.otherUserName}
          onComplete={handleConversationLoadingComplete}
        />
      );
    } else {
      console.log('[AppContent] ✗ NOT rendering ConversationLoadingScreen - showConversationLoading:', showConversationLoading, 'pendingConversation:', !!pendingConversation);
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
          fromTripPlanning={selectedConversation.fromTripPlanning || false}
          onBack={handleBackFromChat}
          onViewProfile={handleViewUserProfile}
          onConversationCreated={(conversationId) => {
            // Update selectedConversation with the created conversation ID
            // Preserve fromTripPlanning flag
            setSelectedConversation({
              ...selectedConversation,
              id: conversationId,
              fromTripPlanning: selectedConversation?.fromTripPlanning || false,
            });
          }}
        />
      );
    }
    
    // Show trip planning chat copy (dev mode) if requested
    if (showTripPlanningChatCopy) {
      return (
        <TripPlanningChatScreenCopy
          onChatComplete={() => { setShowTripPlanningChatCopy(false); setShowTripPlanningChat(false); setPendingOnboardingMatches(null); }}
          onViewUserProfile={handleViewUserProfile}
          onStartConversation={handleStartConversation}
          persistedChatId={tripPlanningChatId}
          persistedMatchedUsers={tripPlanningMatchedUsers}
          persistedDestination={tripPlanningDestination}
          onChatStateChange={(chatId: string | null, matchedUsers: any[], destination: string) => {
            setTripPlanningChatId(chatId);
            setTripPlanningMatchedUsers(matchedUsers);
            setTripPlanningDestination(destination);
          }}
          service={activeCopyService === 'copy-copy' ? swellyServiceCopyCopy : swellyServiceCopy}
          onboardingMatches={pendingOnboardingMatches || undefined}
        />
      );
    }
    
    // Show trip planning chat if requested
    if (showTripPlanningChat) {
      return (
        <TripPlanningChatScreen 
          onChatComplete={handleTripPlanningChatBack} 
          onViewUserProfile={handleViewUserProfile}
          onStartConversation={handleStartConversation}
          persistedChatId={tripPlanningChatId}
          persistedMatchedUsers={tripPlanningMatchedUsers}
          persistedDestination={tripPlanningDestination}
          onChatStateChange={(chatId: string | null, matchedUsers: any[], destination: string) => {
            setTripPlanningChatId(chatId);
            setTripPlanningMatchedUsers(matchedUsers);
            setTripPlanningDestination(destination);
          }}
        />
      );
    }
    
    return (
      <>
        <ConversationsScreen
          onConversationPress={handleConversationPress}
          onSwellyPress={handleSwellyPress}
          onSwellyPressCopy={handleSwellyPressCopy}
          onProfilePress={handleProfilePress}
          onSettingsPress={() => setShowSettings(true)}
          onViewUserProfile={handleViewUserProfile}
          onSwellyShaperViewProfile={handleSwellyShaperViewProfile}
          pendingNotificationConversationId={pendingNotificationConversationId}
          onPendingNotificationHandled={() => setPendingNotificationConversationId(null)}
        />
        {process.env.EXPO_PUBLIC_LOCAL_MODE === 'true' && (
          <TouchableOpacity
            style={{ position: 'absolute', top: 60, right: 10, backgroundColor: '#333', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, zIndex: 999, opacity: 0.7, display: 'none' }}
            onPress={async () => {
              try {
                const { conversations } = await messagingService.getConversations(3, 0);
                const matches = conversations
                  .filter(c => c.other_user)
                  .slice(0, 3)
                  .map(c => ({
                    user_id: c.other_user!.user_id,
                    conversation_id: c.id,
                    total_score: 90,
                    name: c.other_user!.name || 'User',
                    age: null,
                    country_from: null,
                    profile_image_url: c.other_user!.profile_image_url || null,
                    scores: { age: 0, country: 0, surf_level: 0, board_type: 0 },
                  }));
                setOnboardingMatchResult({ matches, match_count: matches.length, swelly_chat_id: null });
                setShowWelcomeToLineupOverlay(true);
              } catch (err) {
                console.warn('[Debug] Failed to load conversations:', err);
              }
            }}
          >
            <RNText style={{ color: '#fff', fontSize: 11 }}>Debug Overlay</RNText>
          </TouchableOpacity>
        )}
        <WelcomeToLineupOverlay
          visible={showWelcomeToLineupOverlay && onboardingMatchResult != null && onboardingMatchResult.match_count > 0}
          matches={onboardingMatchResult?.matches || []}
          onClose={() => setShowWelcomeToLineupOverlay(false)}
          onConnect={(match) => {
            setShowWelcomeToLineupOverlay(false);
            // Show loading screen immediately
            setPendingConversation({
              otherUserId: match.user_id,
              otherUserName: match.name || 'User',
              otherUserAvatar: match.profile_image_url || null,
              fromTripPlanning: false,
              fromWelcomeOverlay: true,
            });
            setShowConversationLoading(true);
            // Create conversation and load current user data in background (animation takes ~4.6s)
            messagingService.createDirectConversation(match.user_id, false).then((conversation) => {
              console.log('[AppContent] Conversation created/found for welcome overlay match:', conversation.id);
              // Update pendingConversation with the real conversation ID
              setPendingConversation(prev => prev ? { ...prev, conversationId: conversation.id } : null);
            }).catch((error) => {
              console.error('[AppContent] Error creating conversation:', error);
            });
            supabaseAuthService.getCurrentUser().then((currentUser) => {
              if (currentUser) {
                setCurrentUserAvatar(currentUser.photo || null);
                setCurrentUserName(currentUser.nickname || currentUser.email?.split('@')[0] || 'User');
              }
            }).catch((error) => {
              console.error('[AppContent] Error loading current user data:', error);
            });
          }}
          onViewProfile={(userId) => {
            // Keep overlay state so it re-appears on back
            setProfileFromWelcomeOverlay(true);
            handleViewUserProfile(userId);
          }}
          onMoreMatches={() => {
            setShowWelcomeToLineupOverlay(false);
            setPendingOnboardingMatches(onboardingMatchResult?.matches || null);
            setTripPlanningChatId(null); // Start fresh chat, not restore
            setShowTripPlanningChatCopy(true);
          }}
        />
      </>
    );
  }

  // Show onboarding welcome/explanation screen if we're on step 0
  if (currentStep === 0) {
    return (
      <OnboardingWelcomeScreen
        onNext={() => {
          setCurrentStep(1);
        }}
        updateFormData={updateFormData}
        onBack={async () => {
          // Prevent multiple simultaneous logout calls
          if (isLoggingOutRef.current) {
            if (__DEV__) {
              console.log('[AppContent] Logout already in progress, ignoring back button click');
            }
            return;
          }
          
          isLoggingOutRef.current = true;
          
          try {
            console.log('[AppContent] Logging out user before going back to welcome screen...');
            
            // Navigate immediately (synchronous) before async operations
            // This ensures UI updates immediately even if logout takes time
            setCurrentStep(STEP_WELCOME);
            setUser(null);
            setIsDemoUser(false);
            
            // Then perform logout operations in background (non-blocking)
            const { performLogout } = await import('../utils/logout');
            const result = await performLogout({
              resetOnboarding,
              setUser: () => {}, // Already set above
              setCurrentStep: () => {}, // Already set above
              setIsDemoUser: () => {}, // Already set above
            });
            
            // Reset onboarding state (non-blocking)
            try {
              await resetOnboarding();
            } catch (resetError) {
              console.error('[AppContent] Error resetting onboarding:', resetError);
            }
            
            if (!result.success) {
              console.error('[AppContent] Error during logout:', result.error);
              // Navigation already happened above, so we're good
            }
          } catch (error) {
            console.error('[AppContent] Error in logout handler:', error);
            // Ensure navigation happened even if there's an error
            try {
              setCurrentStep(STEP_WELCOME);
              setUser(null);
              setIsDemoUser(false);
            } catch (navError) {
              console.error('[AppContent] Error setting navigation state:', navError);
              // Retry after delay
              setTimeout(() => {
                try {
                  setCurrentStep(STEP_WELCOME);
                  setUser(null);
                  setIsDemoUser(false);
                } catch (retryError) {
                  console.error('[AppContent] Retry navigation also failed:', retryError);
                }
              }, 100);
            }
          } finally {
            // Reset flag after a delay to allow state updates to propagate
            setTimeout(() => {
              isLoggingOutRef.current = false;
            }, 1000);
          }
        }}
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
    if (showVideoUploadStep) {
      return (
        <OnboardingVideoUploadScreen
          onNext={handleVideoUploadNext}
          onSkip={handleVideoUploadSkip}
          onBack={handleVideoUploadBack}
          boardType={formData.boardType!}
          surfLevel={formData.surfLevel!}
          userId={user?.id || ''}
        />
      );
    }
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

  // Show onboarding chat screen if we're on step 5 (Swelly chat). Service uses copy edge when LOCAL_MODE.
  if (currentStep === 5) {
    return (
      <OnboardingChatScreen
        onChatComplete={handleChatComplete}
      />
    );
  }

  // Show welcome screen by default (before onboarding starts, when currentStep is STEP_WELCOME or not 0-5)
  // Note: currentStep === 0 shows OnboardingWelcomeScreen (handled above)
  // This handles: initial load, or when user hasn't started onboarding yet
  // Auth guard ensures unauthenticated users are redirected here
  // Demo button visible only when EXPO_PUBLIC_DEV_MODE is true
  const showDemoButton = isDevMode || isLocalMode;
  return (
    <WelcomeScreen
      onGetStarted={handleGetStarted}
      onDemoChat={showDemoButton ? handleDemoChat : undefined}
      onSkipDemo={showDemoButton ? handleSkipDemo : undefined}
      isCheckingAuth={isCheckingAuth}
    />
  );
};