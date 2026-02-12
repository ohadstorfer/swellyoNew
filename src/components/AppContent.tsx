import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Alert, Platform, View } from 'react-native';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { OnboardingWelcomeScreen } from '../screens/OnboardingWelcomeScreen';
import { OnboardingStep1Screen, OnboardingData } from '../screens/OnboardingStep1Screen';
import { OnboardingStep2Screen } from '../screens/OnboardingStep2Screen';
import { OnboardingStep3Screen } from '../screens/OnboardingStep3Screen';
import { OnboardingStep4Screen } from '../screens/OnboardingStep4Screen';
import { LoadingScreen } from '../screens/LoadingScreen';
import { OnboardingChatScreen } from '../screens/ChatScreen';
import { TripPlanningChatScreen } from '../screens/TripPlanningChatScreen';
import { TripPlanningChatScreen as TripPlanningChatScreenCopy } from '../screens/TripPlanningChatScreenCopy';
import ConversationsScreen from '../screens/ConversationsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { DirectMessageScreen } from '../screens/DirectMessageScreen';
import { SwellyShaperScreen } from '../screens/SwellyShaperScreen';
import { messagingService } from '../services/messaging/messagingService';
import { useOnboarding } from '../context/OnboardingContext';
import { analyticsService } from '../services/analytics/analyticsService';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { preloadVideosForBoardType, getVideoPreloadStatus, waitForVideoReady, preloadLoadingVideo, getLoadingVideoUrl } from '../services/media/videoPreloadService';
import { getSurfLevelVideoFromStorage } from '../services/media/videoService';

// Helper to get first video URL for a board type
const getFirstVideoUrlForBoardType = (boardType: number): string | null => {
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
  };

  const getBoardFolder = (boardType: number): string => {
    const folderMap: { [key: number]: string } = { 0: 'shortboard', 1: 'midlength', 2: 'longboard', 3: 'softtop' };
    return folderMap[boardType] || 'shortboard';
  };

  const boardVideos = BOARD_VIDEO_DEFINITIONS[boardType];
  if (!boardVideos || boardVideos.length === 0) {
    return null;
  }

  const boardFolder = getBoardFolder(boardType);
  const firstVideo = boardVideos[0];
  return getSurfLevelVideoFromStorage(`${boardFolder}/${firstVideo.videoFileName}`);
};

export const AppContent: React.FC = () => {
  const { currentStep, formData, setCurrentStep, updateFormData, saveStepToSupabase, isComplete, markOnboardingComplete, isDemoUser, setIsDemoUser, setUser, resetOnboarding, user, isRestoringSession } = useOnboarding();
  
  // Initialize auth guard - this will automatically redirect unauthenticated users
  useAuthGuard();
  const [showLoading, setShowLoading] = useState(false);
  const [isSavingStep1, setIsSavingStep1] = useState(false);
  const [isSavingStep2, setIsSavingStep2] = useState(false);
  const [isSavingStep3, setIsSavingStep3] = useState(false);
  const [isSavingStep4, setIsSavingStep4] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const authCheckStartTime = useRef<number>(Date.now());
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minLoadingDuration = 3000; // 3 seconds minimum
  
  // Refs to prevent race conditions from multiple rapid clicks
  const isNavigatingRef = useRef(false);
  const isLoggingOutRef = useRef(false);
  
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
  
  // Check if MVP mode is enabled
  const isMVPMode = process.env.EXPO_PUBLIC_MVP_MODE === 'true';

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

    // Check for OAuth return indicators
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = hashParams.get('access_token');
    const code = urlParams.get('code');

    if (accessToken || code) {
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

  // Check for conversation deep link from email (query parameter)
  useEffect(() => {
    // Only run on web platform
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    // Only proceed if user is logged in and onboarding is complete
    if (!user || !isComplete || isRestoringSession) {
      return;
    }

    // Parse query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const conversationId = urlParams.get('conversation');

    // If no conversation parameter, nothing to do
    if (!conversationId) {
      return;
    }

    // Load and open conversation
    const loadAndOpenConversation = async () => {
      try {
        // Load all conversations
        const conversations = await messagingService.getConversations();
        
        // Find the conversation matching the ID
        const conversation = conversations.find(conv => conv.id === conversationId);
        
        if (!conversation) {
          // Conversation not found or user doesn't have access - silently ignore
          console.log('[AppContent] Conversation not found or no access:', conversationId);
          // Clean up URL anyway
          window.history.replaceState({}, document.title, window.location.pathname);
          return;
        }

        // Check if it's a direct conversation and has other_user data
        if (!conversation.is_direct || !conversation.other_user) {
          console.log('[AppContent] Conversation is not direct or missing other_user data');
          window.history.replaceState({}, document.title, window.location.pathname);
          return;
        }

        // Extract other_user information
        const otherUser = conversation.other_user;
        
        // Set selected conversation to open it
        setSelectedConversation({
          id: conversation.id,
          otherUserId: otherUser.user_id,
          otherUserName: otherUser.name || 'User',
          otherUserAvatar: otherUser.profile_image_url || null,
          fromTripPlanning: false,
        });

        // Clean up the URL parameter
        window.history.replaceState({}, document.title, window.location.pathname);
        
        console.log('[AppContent] Opened conversation from deep link:', conversationId);
      } catch (error) {
        console.error('[AppContent] Error loading conversation from deep link:', error);
        // Clean up URL on error
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    loadAndOpenConversation();
  }, [user, isComplete, isRestoringSession]);

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
        id: parseInt(demoUser.id.replace(/-/g, '').substring(0, 15), 16) || Date.now(),
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

  const handleStep1Next = async (data: OnboardingData) => {
    if (isSavingStep1) return; // Prevent multiple clicks
    
    console.log('Step 1 next called with data:', data);
    setIsSavingStep1(true);
    
    try {
      updateFormData(data);
      
      // Save Step 1 data to Supabase (board type) using onboarding service
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep1(data.boardType);
      
      // Track onboarding step 1 completion
      analyticsService.trackOnboardingStep1Completed();
      
      // Soft Top (id: 3) skips step 2 and goes directly to step 3
      if (data.boardType === 3) {
        // Set a default surf level for Soft Top (level 3 as specified)
        updateFormData({ surfLevel: 3 });
        setCurrentStep(3); // Go directly to step 3 (travel experience)
      } else {
        // For board types with videos, ensure first video is preloaded before navigation
        const firstVideoUrl = getFirstVideoUrlForBoardType(data.boardType);
        
        if (firstVideoUrl) {
          // Check if first video is already preloaded
          const preloadStatus = getVideoPreloadStatus(firstVideoUrl);
          
          if (preloadStatus?.ready) {
            // Video is ready, navigate immediately
            if (__DEV__) {
              console.log('[AppContent] First video is preloaded and ready, navigating to step 2');
            }
            setCurrentStep(2);
          } else {
            // Wait for first video to be ready (up to 6 seconds with progressive checking)
            if (__DEV__) {
              console.log('[AppContent] Waiting for first video preload before navigating...');
            }
            
            // Best Practice: Progressive timeout checking (don't wait for full timeout)
            let checkCount = 0;
            const maxChecks = 12; // 6 seconds / 500ms = 12 checks
            const checkInterval = 500; // Check every 500ms
            
            const preloadReady = await new Promise<boolean>((resolve) => {
              const startTime = Date.now();
              
              const checkPreload = () => {
                checkCount++;
                const status = getVideoPreloadStatus(firstVideoUrl);
                const elapsed = Date.now() - startTime;
                
                if (status?.ready) {
                  if (__DEV__) {
                    console.log(`[AppContent] First video became ready after ${elapsed}ms (${checkCount} checks), navigating to step 2`);
                  }
                  resolve(true);
                  return;
                }
                
                // Progressive feedback (Best Practice: Don't block UI)
                if (checkCount === 4 && elapsed < 2000) {
                  if (__DEV__) {
                    console.log('[AppContent] Still waiting for preload (2s elapsed)...');
                  }
                } else if (checkCount === 8 && elapsed < 4000) {
                  if (__DEV__) {
                    console.log('[AppContent] Still waiting for preload (4s elapsed)...');
                  }
                }
                
                // Check if timeout reached
                if (elapsed >= 6000 || checkCount >= maxChecks) {
                  if (__DEV__) {
                    console.warn(`[AppContent] First video preload timeout after ${elapsed}ms (${checkCount} checks), navigating anyway (graceful degradation)`);
                    if (status) {
                      console.warn(`[AppContent] Preload status: ready=${status.ready}, readyState=${status.readyState}, error=${status.error?.message}`);
                    }
                  }
                  resolve(false);
                  return;
                }
                
                // Continue checking
                setTimeout(checkPreload, checkInterval);
              };
              
              // Start checking immediately
              checkPreload();
            });
            
            if (preloadReady) {
              if (__DEV__) {
                console.log('[AppContent] First video is ready, navigating to step 2');
              }
              setCurrentStep(2);
            } else {
              // Timeout reached, navigate anyway (graceful degradation)
              if (__DEV__) {
                console.warn('[AppContent] Navigating to step 2 despite preload timeout (video will load normally)');
              }
              setCurrentStep(2);
            }
          }
          
          // Start preloading remaining videos in background (non-blocking)
          preloadVideosForBoardType(data.boardType, 'high')
            .then(result => {
              if (__DEV__) {
                console.log(`[AppContent] Background preload completed: ${result.readyCount}/${result.totalCount} videos ready`);
              }
            })
            .catch(err => {
              console.warn('[AppContent] Video preload failed (non-blocking):', err);
            });
        } else {
          // No videos for this board type, navigate immediately
          setCurrentStep(2);
        }
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
  };

  const [showProfile, setShowProfile] = useState(false);
  const [showTripPlanningChat, setShowTripPlanningChat] = useState(false);
  const [showTripPlanningChatCopy, setShowTripPlanningChatCopy] = useState(false);
  const [showSwellyShaper, setShowSwellyShaper] = useState(false);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [profileFromSwellyShaper, setProfileFromSwellyShaper] = useState(false); // Track if profile was opened from Swelly Shaper
  const [profileFromTripPlanningChat, setProfileFromTripPlanningChat] = useState(false); // Track if profile was opened from trip planning chat
  
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
  } | null>(null);

  const handleChatComplete = async () => {
    console.log('[AppContent] handleChatComplete called');
    
    // Set showProfile FIRST to prevent race condition
    // Navigate to profile
    setShowProfile(true);
    console.log('[AppContent] Navigating to profile screen');
    
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
  };

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
    // Navigate from Swelly Shaper to profile
    // Back button will always go to homepage (conversations screen)
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

  const handleSwellyPress = () => {
    // Navigate to Swelly trip planning chat from conversations page
    setShowTripPlanningChat(true);
  };

  const handleSwellyPressCopy = () => {
    // Navigate to Swelly trip planning chat copy (dev mode) from conversations page
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
          fromTripPlanning: profileFromTripPlanningChat || true, // Preserve trip planning flag if coming from there
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
          fromTripPlanning: profileFromTripPlanningChat || true, // Preserve trip planning flag if coming from there
        });
      }
      
      // Close profile screen to show conversation
      setShowProfile(false);
      setViewingUserId(null);
      
      // Close trip planning chat if it was open (only if not preserving the flag)
      // Actually, we should keep trip planning chat state so back button works correctly
      // Don't close it here - let the conversation's back button handle navigation
      // setShowTripPlanningChat(false); // Removed - preserve trip planning chat state
    } catch (error) {
      console.error('Error starting conversation:', error);
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const handleBackFromChat = () => {
    // If user came from trip planning, return there
    if (selectedConversation?.fromTripPlanning) {
      setSelectedConversation(null);
      setShowTripPlanningChat(true);
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


  // Wait for session restoration to complete before rendering
  // This prevents premature redirects before we know if user has a valid session
  if (isRestoringSession) {
    console.log('[AppContent] Waiting for session restoration...');
    // Show a minimal loading state instead of null to prevent white screen
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' }}>
        {/* Minimal loading indicator - prevents white screen */}
      </View>
    );
  }

  // Note: Removed premature WelcomeScreen redirect check
  // The auth guard now handles all authentication redirects after session restoration completes

  // If onboarding is complete AND user is authenticated, show conversations screen as home page
  // This check must come FIRST before any step checks
  // CRITICAL: Must check user !== null to prevent showing conversations screen after logout
  // Also validate that session exists (unless Supabase not configured or demo user)
  // Don't show if we're currently validating (wait for validation to complete)
  const shouldShowConversations = isComplete && user !== null && 
    !sessionValidationRef.current && // Don't show while validating
    (isDemoUser || isSupabaseConfigured === false || hasValidatedSession); // Show if demo user, Supabase not configured, or session validated
  
  if (shouldShowConversations) {
    console.log('[AppContent] Rendering check - showProfile:', showProfile, 'viewingUserId:', viewingUserId);
    console.log('[AppContent] Rendering check - selectedConversation:', selectedConversation ? 'exists' : 'null');
    console.log('[AppContent] Rendering check - showTripPlanningChat:', showTripPlanningChat);
    
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
          onEdit={() => {
            // When clicking edit, preserve the flag if it was already set
            // (user came from Swelly Shaper), so they can navigate back
            setShowProfile(false);
            setShowSwellyShaper(true);
          }}
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
          onChatComplete={() => setShowTripPlanningChatCopy(false)} 
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
      <ConversationsScreen
        onConversationPress={handleConversationPress}
        onSwellyPress={handleSwellyPress}
        onSwellyPressCopy={handleSwellyPressCopy}
        onProfilePress={handleProfilePress}
        onViewUserProfile={handleViewUserProfile}
        onSwellyShaperViewProfile={handleSwellyShaperViewProfile}
      />
    );
  }

  // Show onboarding welcome/explanation screen if we're on step 0
  if (currentStep === 0) {
    return (
      <OnboardingWelcomeScreen
        onNext={() => {
          setCurrentStep(1);
        }}
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
            setCurrentStep(-1);
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
              setCurrentStep(-1);
              setUser(null);
              setIsDemoUser(false);
            } catch (navError) {
              console.error('[AppContent] Error setting navigation state:', navError);
              // Retry after delay
              setTimeout(() => {
                try {
                  setCurrentStep(-1);
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

  // Show onboarding chat screen if we're on step 5 (Swelly chat)
  if (currentStep === 5) {
    return (
      <OnboardingChatScreen 
        onChatComplete={handleChatComplete} 
      />
    );
  }

  // Show welcome screen by default (before onboarding starts, when currentStep is -1 or not 0-5)
  // Note: currentStep === 0 shows OnboardingWelcomeScreen (handled above)
  // This handles: initial load, or when user hasn't started onboarding yet
  // Auth guard ensures unauthenticated users are redirected here
  return <WelcomeScreen onGetStarted={handleGetStarted} onDemoChat={handleDemoChat} isCheckingAuth={isCheckingAuth} />;
};