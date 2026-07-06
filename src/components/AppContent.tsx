// ⚠ NAV MIGRATION IN PROGRESS (branch nav-migration — see task_plan.md + docs/nav-migration/).
// Do NOT add new showX boolean flags or origin-tracking back flags here.
// New screens go through the navigator (navigation.push). Routing changes: talk to Eyal first.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Alert, AppState, Keyboard, Linking, Platform, Pressable, StyleSheet, View, TouchableOpacity, Text as RNText } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { OnboardingWelcomeScreen } from '../screens/OnboardingWelcomeScreen';
import { OnboardingStep1Screen, OnboardingData } from '../screens/OnboardingStep1Screen';
import { OnboardingStep2Screen } from '../screens/OnboardingStep2Screen';
import { OnboardingStep3Screen } from '../screens/OnboardingStep3Screen';
import { OnboardingStep4Screen } from '../screens/OnboardingStep4Screen';
import { OnboardingStep4DestinationsScreen } from '../screens/OnboardingStep4DestinationsScreen';
import { OnboardingStep5BudgetScreen } from '../screens/OnboardingStep5BudgetScreen';
import { OnboardingStep6LifestyleScreen } from '../screens/OnboardingStep6LifestyleScreen';
import { OnboardingVideoUploadScreen } from '../screens/OnboardingVideoUploadScreen';
import { OnboardingScaffold } from './onboarding/OnboardingScaffold';
// TripPlanningChatScreen (Swelly) renders as the SwellyChat card in RootNavigator now.
import RootNavigator from '../navigation/RootNavigator';
import { pushRootCard, navigationRef } from '../navigation/navigationRef';
import { MainNavProvider, type MainNavContextValue } from '../navigation/MainNavContext';
import { useTripsBottomNavControl, type NavKey } from './trips/TripsBottomNav';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SwellyShaperScreen } from '../screens/SwellyShaperScreen';
import { ConversationLoadingScreen } from '../components/ConversationLoadingScreen';
import { JoinDecisionOverlay } from '../components/trips/joinRequest/JoinDecisionOverlay';
import { JoinDeclinedOverlay } from '../components/trips/joinRequest/JoinDeclinedOverlay';
import {
  listUnseenJoinDecisions,
  markJoinDecisionSeen,
  destinationLabel,
  exploreFeed,
  type UnseenJoinDecision,
} from '../services/trips/groupTripsService';
import { supabase } from '../config/supabase';
import { queryClient } from '../lib/queryClient';
import { tripsKeys, EMPTY_EXPLORE_FILTER_KEY } from '../hooks/trips/useTripQueries';
import { fetchTripCore } from '../hooks/trips/useTripDetail';
import { userTripsTopic } from '../services/trips/tripsRealtime';

// How many of the first Explore trips to warm the DETAIL for on app entry, so
// opening one of them is instant before the user scrolls. Critical query only.
const EXPLORE_DETAIL_PREFETCH_COUNT = 3;
import { ProfileEditPanel } from './ProfileEditPanel/ProfileEditPanel';
import { InAppBannerHost } from './notifications/InAppBannerHost';
import { useUserProfile } from '../context/UserProfileContext';
import { useTutorial } from '../context/TutorialContext';
import { messagingService } from '../services/messaging/messagingService';
import { acceptSurftripInvite } from '../services/surftrips/surftripsService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { useOnboarding } from '../context/OnboardingContext';
import { analyticsService } from '../services/analytics/analyticsService';
import { logEvent } from '../services/analytics/eventLogger';
import Constants from 'expo-constants';

const APP_OPENED_THROTTLE_MS = 30 * 60 * 1000; // 30 minutes
const APP_OPENED_STORAGE_KEY_PREFIX = 'last_app_open_logged_'; // suffix is the user id so different users on the same device don't block each other
import { useAuthGuard } from '../hooks/useAuthGuard';
import { friendlyErrorMessage } from '../utils/friendlyError';
import { isFirstVideoReadyForBoardType } from '../services/media/videoPreloadService';
import { STEP_WELCOME, STEP_ONBOARDING_WELCOME } from '../constants/onboardingSteps';
import { ageGateService } from '../services/ageGate/ageGateService';
import { swellyServiceCopy } from '../services/swelly/swellyServiceCopy';
import { pushNotificationService } from '../services/notifications/pushNotificationService';
import {
  tripFocusForNotification,
  isNotificationsScreenOpen,
  type TripDetailFocus,
} from '../services/notifications/notificationsService';
import { syncDeviceTimezone } from '../services/notifications/deviceTimezone';
import { startNotificationsHub } from '../services/notifications/notificationsRealtimeHub';
import { startBellBannerSource } from '../services/notifications/bellBannerSource';
import { useMessaging } from '../context/MessagingProvider';

export const AppContent: React.FC = () => {
  const { currentStep, formData, setCurrentStep, updateFormData, saveStepToSupabase, isComplete, markOnboardingComplete, isDemoUser, setIsDemoUser, setUser, resetOnboarding, user, isRestoringSession, isLoaded: isOnboardingLoaded, completionCheckedForUserId } = useOnboarding();
  const onboardingCheckedForCurrentUser = user !== null && completionCheckedForUserId === user.id;
  const { setSeenFromProfile: setTutorialSeenFromProfile, setSurftripsTipSeenFromProfile } = useTutorial();
  
  // Initialize auth guard - this will automatically redirect unauthenticated users
  useAuthGuard();
  const [isSavingStep1, setIsSavingStep1] = useState(false);
  const [isSavingStep2, setIsSavingStep2] = useState(false);
  const [showVideoUploadStep, setShowVideoUploadStep] = useState(false);
  const [isSavingStep3, setIsSavingStep3] = useState(false);
  const [isSavingStep4, setIsSavingStep4] = useState(false);
  const [isSavingStep5, setIsSavingStep5] = useState(false);
  const [isSavingStep6, setIsSavingStep6] = useState(false);
  const [isSavingStep7, setIsSavingStep7] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [showAgeBlockOverlay, setShowAgeBlockOverlay] = useState(false);
  const authCheckStartTime = useRef<number>(Date.now());
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minLoadingDuration = 0; // No artificial delay — branded loading shows during session restoration
  
  // Refs to prevent race conditions from multiple rapid clicks
  const isNavigatingRef = useRef(false);
  const isLoggingOutRef = useRef(false);

  // Push notification: pending conversation to open from notification tap
  const [pendingNotificationConversationId, setPendingNotificationConversationId] = useState<string | null>(null);
  // Chat-notification tap → open the chat as a ROOT card (covers any tab).
  // Held here until the conversation is loaded/enriched, then consumed by the
  // effect below — mirrors the requestedTripCard queue pattern.
  const [pendingChatNotification, setPendingChatNotification] = useState<string | null>(null);
  // Programmatic trip-card open (push taps, invites, join decisions, chat
  // headers) — consumed mount-safely inside the navigator, which pushes a
  // TripDetail card. Replaces the old pendingTripDetailId state machine.
  const [requestedTripCard, setRequestedTripCard] = useState<{
    tripId: string;
    focus?: TripDetailFocus | null;
  } | null>(null);
  const { getCurrentConversationId, conversations: messagingConversations, refreshConversations } = useMessaging();
  
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

  // Check age gate device flag on mount
  useEffect(() => {
    ageGateService.checkBlocked().then(({ blocked }) => {
      if (blocked) setShowAgeBlockOverlay(true);
    });
  }, []);

  // ----- Surftrip invite link handling (native only) -----
  // URL format: `https://swellyo-invite.netlify.app/?surftrip=<groupId>&t=<token>`.
  // That domain is served by a separate static site that does AASA hosting +
  // store redirect — the Expo web bundle never sees these URLs. All processing
  // is native: Linking listener → AsyncStorage persistence → post-auth resolver.
  const [pendingInviteGroupId, setPendingInviteGroupId] = useState<string | null>(null);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const inviteResolverRef = useRef(false);
  // Group-trip invite link (tokenless): `?grouptrip=<tripId>`. Opens the trip
  // detail, where the recipient can request to join.
  const [pendingTripInviteId, setPendingTripInviteId] = useState<string | null>(null);
  const tripInviteResolverRef = useRef(false);

  const parseInviteFromUrl = useCallback((url: string | null) => {
    if (!url) return;
    try {
      const q = url.indexOf('?');
      if (q < 0) return;
      const params = new URLSearchParams(url.substring(q + 1));
      const sid = params.get('surftrip');
      const token = params.get('t');
      const gtid = params.get('grouptrip');
      if (sid) setPendingInviteGroupId(sid);
      if (token) setPendingInviteToken(token);
      if (gtid) setPendingTripInviteId(gtid);
    } catch (e) {
      console.warn('[AppContent] invite URL parse failed:', e);
    }
  }, []);

  // Native: getInitialURL on cold start + 'url' event for warm start.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    Linking.getInitialURL()
      .then(initial => {
        if (active) parseInviteFromUrl(initial);
      })
      .catch(err => console.warn('[AppContent] getInitialURL failed:', err));

    const sub = Linking.addEventListener('url', ({ url }) => {
      parseInviteFromUrl(url);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [parseInviteFromUrl]);

  // Hydrate any persisted pending invite from a previous session (e.g. user
  // tapped link, app cold-booted, signup flow began, then was killed).
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem('pendingSurftripInvite')
      .then(raw => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.groupId && !pendingInviteGroupId) setPendingInviteGroupId(parsed.groupId);
          if (parsed?.token && !pendingInviteToken) setPendingInviteToken(parsed.token);
        } catch {
          // ignore
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []); // run once on mount

  // While we're waiting for auth/onboarding, persist the pending invite so it
  // survives a cold restart through the signup flow.
  useEffect(() => {
    if (!pendingInviteGroupId && !pendingInviteToken) return;
    const payload = JSON.stringify({
      groupId: pendingInviteGroupId,
      token: pendingInviteToken,
    });
    AsyncStorage.setItem('pendingSurftripInvite', payload).catch(() => {});
  }, [pendingInviteGroupId, pendingInviteToken]);

  // Post-auth resolver: once the user is signed in and onboarded, accept the
  // invite. Web is excluded — the landing screen handles web exclusively.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (inviteResolverRef.current) return;
    if (!pendingInviteToken && !pendingInviteGroupId) return;
    if (user === null) return;
    if (!isComplete && !isDemoUser) return;

    inviteResolverRef.current = true;
    (async () => {
      try {
        if (pendingInviteToken) {
          const result = await acceptSurftripInvite(pendingInviteToken);
          if (result.outcome === 'joined' || result.outcome === 'already_member') {
            pushRootCard('ChatCard', {
              conversationId: result.conversation_id,
              otherUserId: '',
              otherUserName: '',
              otherUserAvatar: null,
              isDirect: false,
              surftripId: result.group_id,
            });
          } else if (result.outcome === 'open_detail') {
            pushRootCard('SurftripCard', { groupId: result.group_id });
          } else if (result.outcome === 'group_full') {
            Alert.alert('Surftrip is full', 'This group has reached its member limit.');
          } else {
            Alert.alert('Invite invalid', 'This invite link is no longer valid.');
          }
        } else if (pendingInviteGroupId) {
          // Tokenless legacy link — just open the detail screen.
          pushRootCard('SurftripCard', { groupId: pendingInviteGroupId });
        }
      } catch (e: any) {
        console.warn('[AppContent] acceptSurftripInvite failed:', e);
        Alert.alert('Could not open invite', friendlyErrorMessage(e, 'Please try again.'));
      } finally {
        setPendingInviteGroupId(null);
        setPendingInviteToken(null);
        AsyncStorage.removeItem('pendingSurftripInvite').catch(() => {});
        inviteResolverRef.current = false;
      }
    })();
  }, [pendingInviteToken, pendingInviteGroupId, user, isComplete, isDemoUser]);

  // ----- Group-trip invite link (native only) -----
  // Hydrate persisted pending group-trip invite (cold-boot through signup).
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem('pendingGroupTripInvite')
      .then(raw => {
        if (cancelled || !raw) return;
        if (!pendingTripInviteId) setPendingTripInviteId(raw);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []); // run once on mount

  useEffect(() => {
    if (!pendingTripInviteId) return;
    AsyncStorage.setItem('pendingGroupTripInvite', pendingTripInviteId).catch(() => {});
  }, [pendingTripInviteId]);

  // Post-auth resolver: open the shared trip's detail once signed in + onboarded.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (tripInviteResolverRef.current) return;
    if (!pendingTripInviteId) return;
    if (user === null) return;
    if (!isComplete && !isDemoUser) return;

    tripInviteResolverRef.current = true;
    try {
      openTripCard(pendingTripInviteId);
    } finally {
      setPendingTripInviteId(null);
      AsyncStorage.removeItem('pendingGroupTripInvite').catch(() => {});
      tripInviteResolverRef.current = false;
    }
    // openTripCard is stable (useCallback []) and declared later in the
    // component — putting it in this dep array would evaluate it during
    // render, before initialization (TDZ crash). Safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTripInviteId, user, isComplete, isDemoUser]);

  // Validate session whenever a user is signed in (regardless of onboarding
  // completion). This unblocks mid-onboarding users who would otherwise be
  // stuck on the spinning welcome screen because hasValidatedSession was
  // gated on isComplete.
  useEffect(() => {
    if (user !== null && !isDemoUser && !isRestoringSession &&
        !sessionValidationRef.current && isSupabaseConfigured === true) {
      sessionValidationRef.current = true;

      const validateSession = async () => {
        try {
          const { supabase } = await import('../config/supabase');
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();

          if (sessionError || !session) {
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

          setHasValidatedSession(true);

          // Log app_opened (throttled per-user per 30min) — fire and forget.
          // Key is per-user so different users on the same device don't block each other.
          try {
            if (user?.id) {
              const storageKey = `${APP_OPENED_STORAGE_KEY_PREFIX}${user.id}`;
              const last = await AsyncStorage.getItem(storageKey);
              const now = Date.now();
              if (!last || now - parseInt(last, 10) > APP_OPENED_THROTTLE_MS) {
                logEvent('app_opened', {
                  userId: user.id,
                  properties: {
                    platform: Platform.OS,
                    app_version: Constants.expoConfig?.version ?? null,
                  },
                });
                await AsyncStorage.setItem(storageKey, String(now));
              }
            }
          } catch (err) {
            console.warn('[AppContent] app_opened logging failed (non-blocking):', err);
          }
        } catch (error) {
          console.error('[AppContent] Error validating session:', error);
          setHasValidatedSession(true);
        } finally {
          sessionValidationRef.current = false;
        }
      };

      validateSession();
    } else if (user === null) {
      setHasValidatedSession(false);
      sessionValidationRef.current = false;
    } else if (isSupabaseConfigured === false) {
      setHasValidatedSession(true);
    }
  }, [user, isDemoUser, isRestoringSession, isSupabaseConfigured, resetOnboarding, setUser, setCurrentStep, setIsDemoUser]);

  // Recover from inconsistent state: signed-in user with currentStep stuck at
  // STEP_WELCOME (-1) and onboarding not complete. Gated on isOnboardingLoaded
  // so we wait for the DB-backed isComplete check to finish — otherwise
  // already-onboarded users briefly flash OnboardingWelcomeScreen on cold
  // start before isComplete flips to true.
  useEffect(() => {
    if (
      !isRestoringSession &&
      onboardingCheckedForCurrentUser &&
      user !== null &&
      !isDemoUser &&
      !isComplete &&
      currentStep === STEP_WELCOME
    ) {
      console.log('[AppContent] Signed-in user at STEP_WELCOME, resuming onboarding');
      setCurrentStep(STEP_ONBOARDING_WELCOME);
    }
  }, [user, isDemoUser, isComplete, currentStep, isRestoringSession, onboardingCheckedForCurrentUser, setCurrentStep]);
  
  // Set up push notification handlers (foreground suppression + tap navigation)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    pushNotificationService.setupNotificationHandlers(
      getCurrentConversationId,
      (payload) => {
        // Every group-trip push (queue dispatcher + legacy trip_join_request)
        // carries tripId — deep-link to that trip, landing on the tab/section
        // that matches the notification type (stage/decision refine it).
        if (payload.tripId) {
          openTripCard(
            payload.tripId,
            tripFocusForNotification(payload.type, {
              stage: payload.stage,
              decision: payload.decision,
            })
          );
          return;
        }
        // Chat-message pushes carry conversationId instead. Queue a ROOT
        // ChatCard (consumed below once the conversation data is loaded) —
        // same race-proof pattern as trip notifications. The old path pushed
        // the chat inside the Lineup tab's nested stack, which on cold start
        // left it hidden behind the initial Trips tab.
        if (payload.conversationId) {
          setPendingChatNotification(payload.conversationId);
        }
      },
      isNotificationsScreenOpen
    );
    // openTripCard intentionally omitted — see TDZ note on the invite resolver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCurrentConversationId]);

  // Consume a chat-notification tap once everything it needs is actually
  // ready. Each guard returns WITHOUT consuming, so the effect simply retries
  // on the next conversations update — nothing is silently dropped (the
  // cold-start failure mode of the old requestTab/nested-stack path).
  useEffect(() => {
    if (!pendingChatNotification) return;
    const conv = messagingConversations.find(c => c.id === pendingChatNotification);
    if (!conv) return; // conversations still loading
    if (conv.is_direct && !conv.other_user) return; // DM not enriched yet
    if (!navigationRef.isReady()) return; // navigator not mounted yet
    setPendingChatNotification(null);
    pushRootCard('ChatCard', {
      conversationId: conv.id,
      otherUserId: conv.is_direct ? conv.other_user?.user_id ?? '' : '',
      otherUserName: conv.is_direct ? conv.other_user?.name ?? 'User' : conv.title ?? 'Group Chat',
      otherUserAvatar: conv.is_direct ? conv.other_user?.profile_image_url ?? null : null,
      isDirect: conv.is_direct,
      tripId: !conv.is_direct && typeof conv.metadata?.trip_id === 'string' ? conv.metadata.trip_id : undefined,
      surftripId: !conv.is_direct && typeof conv.metadata?.surftrip_id === 'string' ? conv.metadata.surftrip_id : undefined,
    });
    // Land the tab UNDER the card on the chat list, so backing out of the
    // chat ends up there (mirrors openTripCard's land-on-Trips behavior).
    requestTab('lineup');
    // requestTab is a stable useCallback([]) declared later — TDZ-safe at
    // effect time, same pattern as openTripCard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChatNotification, messagingConversations]);

  // Start the shared notifications realtime hub + the bell→banner bridge so
  // bell events show an in-app banner within ~1s (instead of waiting on the
  // push queue cron). Hub stop happens ONLY via the logout registry — do not
  // stop it here, only the source listener detaches on cleanup/user change.
  useEffect(() => {
    if (Platform.OS === 'web' || !user?.id) return;
    startNotificationsHub(user.id);
    const stopSource = startBellBannerSource(user.id, openTripCard);
    return stopSource;
    // openTripCard is a stable useCallback([]) — safe to omit (matches the
    // existing TDZ-note pattern of the setupNotificationHandlers effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
      logEvent('onboarding_step_1', { userId: user?.id });

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

      // Promote the device-local DOB (set on welcome screen) into the DB now,
      // so by step 4 the surfers row is the source of truth.
      const { ageGateService } = await import('../services/ageGate/ageGateService');
      const dobFromDevice = await ageGateService.getDOB();

      // Save Step 2 data to Supabase (surf level) using onboarding service
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep2(data.boardType!, data.surfLevel!, dobFromDevice ?? undefined);

      logEvent('onboarding_step_2', { userId: user?.id });

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

      logEvent('onboarding_step_3', { userId: user?.id });

      setCurrentStep(4); // Go to step 4 (destinations — renumbered from old profile step)
    } catch (error) {
      console.error('Error in Step 3 Next:', error);
      // Still allow navigation even if save fails
      setCurrentStep(4);
    } finally {
      setIsSavingStep3(false);
    }
  };

  const handleStep4Next = async (data: OnboardingData) => {
    if (isSavingStep4) return;
    console.log('Step 4 next (destinations) called with data:', data);
    setIsSavingStep4(true);
    try {
      updateFormData(data);
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep4Destinations(data.destinations_array || []);
      logEvent('onboarding_step_4', { userId: user?.id });
      setCurrentStep(5);
    } catch (error) {
      console.error('Error in Step 4 (destinations) Next:', error);
      // Don't silently advance — the user's destinations live in local
      // AsyncStorage but never reached the server. Surface it and let them
      // retry, while still offering a way out so a network blip can't trap
      // them mid-onboarding.
      Alert.alert(
        "Couldn't save your destinations",
        'Your destinations are saved on this device but not yet synced to your profile. Check your connection and try again.',
        [
          { text: 'Retry', onPress: () => handleStep4Next(data) },
          { text: 'Continue anyway', style: 'cancel', onPress: () => setCurrentStep(5) },
        ],
      );
    } finally {
      setIsSavingStep4(false);
    }
  };

  const handleStep5Next = async (data: OnboardingData) => {
    if (isSavingStep5) return;
    console.log('Step 5 next (budget) called with data:', data);
    setIsSavingStep5(true);
    try {
      updateFormData(data);
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      if (data.travel_type) {
        await onboardingService.saveStep5Budget(data.travel_type);
      }
      logEvent('onboarding_step_5', { userId: user?.id });
      setCurrentStep(6);
    } catch (error) {
      console.error('Error in Step 5 (budget) Next:', error);
      setCurrentStep(6);
    } finally {
      setIsSavingStep5(false);
    }
  };

  const handleStep6Next = async (data: OnboardingData) => {
    if (isSavingStep6) return;
    console.log('Step 6 next (lifestyle) called with data:', data);
    setIsSavingStep6(true);
    try {
      updateFormData(data);
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep6Lifestyle(
        data.lifestyle_keywords || [],
        data.lifestyle_image_urls || {},
      );
      logEvent('onboarding_step_6', { userId: user?.id });
      setCurrentStep(7);
    } catch (error) {
      console.error('Error in Step 6 (lifestyle) Next:', error);
      setCurrentStep(7);
    } finally {
      setIsSavingStep6(false);
    }
  };

  const handleStep7Next = async (data: OnboardingData) => {
    if (isSavingStep7) return; // Prevent multiple clicks

    console.log('Step 7 (profile) next called with data:', data);
    setIsSavingStep7(true);

    try {
      updateFormData(data);

      // Save complete onboarding data to Supabase (all profile details) using onboarding service
      const { onboardingService } = await import('../services/onboarding/onboardingService');
      await onboardingService.saveStep4({
        nickname: data.nickname,
        userEmail: data.userEmail,
        location: data.location,
        age: data.age,
        dateOfBirth: data.dateOfBirth,
        profilePicture: data.profilePicture,
        pronouns: data.pronouns,
        boardType: data.boardType,
        surfLevel: data.surfLevel,
        travelExperience: data.travelExperience,
        isDemoUser: isDemoUser, // Pass demo user flag
        homeBreakPlaceId: data.homeBreakPlaceId,
        homeBreakFull: data.homeBreakFull,
        homeBreakShort: data.homeBreakShort,
        homeBreakLocality: data.homeBreakLocality,
        homeBreakCountry: data.homeBreakCountry,
        homeBreakLat: data.homeBreakLat,
        homeBreakLng: data.homeBreakLng,
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

      logEvent('onboarding_step_7', { userId: user?.id });

      // Skip LoadingScreen + Swelly onboarding chat — go straight to profile.
      // Order matters: set showProfile + flag BEFORE markOnboardingComplete so
      // the "isComplete && !showProfile → home" branch doesn't redirect us.
      setProfileFromOnboardingChat(true);
      setShowProfile(true);
      await markOnboardingComplete();
      logEvent('onboarding_finalized', { userId: user?.id });
      // Refresh the user profile now that saveStep4 created the surfers row.
      // Before this refresh, useUserProfile's initial fetch ran when the
      // surfers row didn't exist yet (returned PGRST116 / null), so the local
      // profile would stay null and the tutorial reconciliation effect would
      // bail. Refreshing ensures welcome_guide_seen_at gets read from the
      // freshly-inserted row (defaults to NULL → isSeen=false → tutorial
      // fires on first Swelly chat open).
      refreshUserProfile().catch(err =>
        console.warn('[AppContent] post-onboarding profile refresh failed:', err),
      );
    } catch (error) {
      console.error('Error in Step 7 (profile) Next:', error);
      // Still navigate to profile even if save failed — local form data is in
      // AsyncStorage and the user can fix from the profile edit panel.
      setProfileFromOnboardingChat(true);
      setShowProfile(true);
      await markOnboardingComplete();
      refreshUserProfile().catch(err =>
        console.warn('[AppContent] post-onboarding profile refresh failed:', err),
      );
    } finally {
      setIsSavingStep7(false);
    }
  };

  const [showProfile, setShowProfile] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const { profile: currentUserSurfer, refresh: refreshUserProfile } = useUserProfile();

  // Reconcile the tutorial "seen" flag with the DB once the profile loads.
  // AsyncStorage hydrates instantly on app start (fast-path cache) but the DB
  // is the source of truth — a user who saw the guide on another device
  // shouldn't see it again here. Reciprocal: a fresh user whose AS cache
  // somehow says "seen" gets corrected back to NULL → trigger fires.
  useEffect(() => {
    if (!currentUserSurfer) {
      console.log('[Tutorial reconcile] no profile yet, skip');
      return;
    }
    const seen = currentUserSurfer.welcome_guide_seen_at != null;
    console.log('[Tutorial reconcile] profile loaded', {
      user_id: currentUserSurfer.user_id,
      welcome_guide_seen_at: currentUserSurfer.welcome_guide_seen_at,
      derivedSeen: seen,
    });
    setTutorialSeenFromProfile(seen);
  }, [currentUserSurfer?.welcome_guide_seen_at, currentUserSurfer?.user_id, setTutorialSeenFromProfile]);

  // Same reconciliation for the one-time "Surf Trips tab" coach-mark flag.
  useEffect(() => {
    if (!currentUserSurfer) return;
    setSurftripsTipSeenFromProfile(currentUserSurfer.surftrips_tip_seen_at != null);
  }, [currentUserSurfer?.surftrips_tip_seen_at, currentUserSurfer?.user_id, setSurftripsTipSeenFromProfile]);
  // Swelly chat is a CARD on the root stack now (nav migration B2). The old
  // display:'none' keep-alive layers are gone — the stack keeps covered cards
  // mounted, and conversation state is persisted here (tripPlanningChatId &
  // friends) so a re-opened card is warm.
  const [showSwellyShaper, setShowSwellyShaper] = useState(false);
  // Settings is a CARD now (gear icon on own profile + Lineup menu) — B3.
  // showTrips is GONE — Trips is a tab root inside RootNavigator (Phase 1).
  // The ONE floating bottom nav, persistent above Lineup / Trips / Profile —
  // it never remounts on page switches, so the pill animation plays across
  // them. Screens pipe scroll events into this shared control.
  const bottomNavControl = useTripsBottomNavControl();
  // --- Tab navigator bridge (nav migration Phase 1) ----------------------
  // The 3 roots live in RootNavigator now. activeTab mirrors the navigator
  // state for the legacy reads that still branch on "which page is showing"
  // (deleted in Phase 5). requestedTab is the mount-safe programmatic switch:
  // set here, consumed by the tab bar adapter once the navigator exists.
  // activeTab/prevTab are REFS, not state, on purpose: nothing in AppContent's
  // render reads the active tab anymore (the navigator owns it via react-
  // navigation), so a setState here would re-render this giant root component on
  // EVERY tab switch for nothing — that was the ~200ms first-frame delay left
  // after the context fix. prevTabRef feeds the Profile back button (return to
  // the tab you came from).
  const activeTabRef = useRef<NavKey>('lineup');
  const prevTabRef = useRef<NavKey>('lineup');
  const [requestedTab, setRequestedTab] = useState<NavKey | null>(null);
  // Programmatic "take the user to tab X" (deep links, join decisions,
  // chat→trip taps).
  const requestTab = useCallback((tab: NavKey) => {
    setRequestedTab(tab);
  }, []);
  // Open a trip as a card: land on the Trips tab (so back from the card ends
  // up there) and push the TripDetail card on the root stack.
  const openTripCard = useCallback((tripId: string, focus?: TripDetailFocus | null) => {
    setRequestedTab('trips');
    setRequestedTripCard({ tripId, focus: focus ?? null });
  }, []);
  const handleRequestedTripCardConsumed = useCallback(() => setRequestedTripCard(null), []);
  const handleTabChange = useCallback((tab: NavKey) => {
    // Ref-only: update bookkeeping without re-rendering AppContent.
    if (activeTabRef.current !== tab) {
      prevTabRef.current = activeTabRef.current;
      activeTabRef.current = tab;
    }
  }, []);
  const handleRequestedTabConsumed = useCallback(() => setRequestedTab(null), []);
  // Surftrip detail + all chats are root-stack CARDS now (nav migration B1).
  // The legacy ProfileScreen overlay is OWN-PROFILE ONLY now (post-onboarding
  // + SwellyShaper flows) — other users' profiles are ProfileCard routes.
  const [profileFromOnboardingChat, setProfileFromOnboardingChat] = useState(false); // Track if profile was opened right after Swelly onboarding chat (special header)

  // Trip planning chat state - persisted between navigations
  const [tripPlanningChatId, setTripPlanningChatId] = useState<string | null>(null);
  const [tripPlanningMatchedUsers, setTripPlanningMatchedUsers] = useState<any[]>([]);
  const [tripPlanningDestination, setTripPlanningDestination] = useState<string>('');
  
  // State for conversation loading screen
  const [showConversationLoading, setShowConversationLoading] = useState(false);
  const [pendingConversation, setPendingConversation] = useState<{
    otherUserId: string;
    otherUserName: string;
    otherUserAvatar: string | null;
    conversationId?: string;
  } | null>(null);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('User');
  // Queue of unseen host decisions on the user's join requests. We pop the
  // front item as the active overlay; closing it advances to the next one.
  const [joinDecisionQueue, setJoinDecisionQueue] = useState<UnseenJoinDecision[]>([]);
  const joinDecisionsFetchedForUserRef = useRef<string | null>(null);

  // Fetch unseen host decisions once per signed-in user. Runs after auth is
  // validated. The overlay itself is gated on whether the queue is non-empty
  // and the user is in the main app (not onboarding/welcome).
  useEffect(() => {
    const userId = user?.id ? String(user.id) : null;
    if (!userId) {
      joinDecisionsFetchedForUserRef.current = null;
      setJoinDecisionQueue([]);
      return;
    }
    if (joinDecisionsFetchedForUserRef.current === userId) return;
    joinDecisionsFetchedForUserRef.current = userId;
    listUnseenJoinDecisions(userId)
      .then((rows) => setJoinDecisionQueue(rows))
      .catch((err) => {
        console.warn('[AppContent] listUnseenJoinDecisions failed:', err);
        setJoinDecisionQueue([]);
      });
  }, [user?.id]);

  // Live listener — if the host approves/declines while the user is in the app,
  // the overlay fires immediately instead of waiting for the next cold open.
  // Deduped by request_id against the queue so the boot fetch + live event can
  // race without showing twice.
  // Private per-user Broadcast topic fed by the broadcast_trip_change DB
  // trigger (replaces the per-user postgres_changes listener, which cost an
  // RLS evaluation per event per subscriber with every signed-in user holding
  // one open).
  useEffect(() => {
    const userId = user?.id ? String(user.id) : null;
    if (!userId) return;
    const channel = supabase
      .channel(userTripsTopic(userId), { config: { private: true } })
      .on(
        'broadcast',
        { event: 'join_request_changed' },
        async ({ payload }: any) => {
          if (payload?.op !== 'UPDATE') return; // decisions are status UPDATEs
          const row = payload?.request as Record<string, unknown> | undefined;
          if (!row) return;
          const status = row.status;
          if (status !== 'approved' && status !== 'declined') return;
          const requestId = row.id as string;
          const tripId = row.trip_id as string;

          // The decision changed this user's standing on the trip — bust every
          // cached view of it so the My Trips buckets and an already-open
          // detail screen refetch. Must run before the seen_decision_at guard:
          // the cache is stale either way, the overlay is what's deduped.
          queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
          queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });

          if (row.seen_decision_at) return; // host or another tab already marked

          const { data: trip } = await supabase
            .from('group_trips')
            .select('id, host_id, title, hero_image_url, start_date, end_date, destination:group_trip_destinations(name, short_label, country)')
            .eq('id', tripId)
            .maybeSingle();
          if (!trip) return;

          const decision: UnseenJoinDecision = {
            request_id: requestId,
            status: status as 'approved' | 'declined',
            decided_at: (row.reviewed_at as string | null) ?? null,
            trip: {
              id: (trip as any).id,
              title: (trip as any).title ?? null,
              hero_image_url: (trip as any).hero_image_url ?? '',
              destination_label: destinationLabel(
                Array.isArray((trip as any).destination)
                  ? (trip as any).destination[0]
                  : (trip as any).destination,
              ),
              start_date: (trip as any).start_date ?? null,
              end_date: (trip as any).end_date ?? null,
              host_id: (trip as any).host_id ?? null,
            },
          };

          setJoinDecisionQueue((prev) => {
            if (prev.some((d) => d.request_id === decision.request_id)) return prev;
            return [...prev, decision];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const activeJoinDecision = joinDecisionQueue[0] ?? null;

  const advanceJoinDecisionQueue = useCallback((decision: UnseenJoinDecision) => {
    // Mark seen server-side (RPC); pop from local queue regardless of whether
    // the RPC succeeded (it's idempotent and the worst case is the overlay
    // re-appears next session, which is acceptable).
    markJoinDecisionSeen(decision.request_id).catch(() => undefined);
    setJoinDecisionQueue((prev) => prev.filter((d) => d.request_id !== decision.request_id));
  }, []);

  const handleJoinDecisionPrimary = useCallback(
    (decision: UnseenJoinDecision) => {
      advanceJoinDecisionQueue(decision);
      if (decision.status === 'approved') {
        // Open this specific trip's card — landing on the commit pill, the
        // new member's next step (same focus as the notification).
        openTripCard(decision.trip.id, 'commit');
      } else {
        // Declined → land on the trips/explore list.
        requestTab('trips');
      }
    },
    [advanceJoinDecisionQueue, requestTab, openTripCard]
  );

  const handleJoinDecisionDismiss = useCallback(
    (decision: UnseenJoinDecision) => {
      advanceJoinDecisionQueue(decision);
    },
    [advanceJoinDecisionQueue]
  );

  const handleProfileBack = () => {
    console.log('[AppContent] handleProfileBack called');

    // Navigate back to conversations/home (homepage)
    console.log('[AppContent] Navigating to conversations/home');
    setShowProfile(false);
    setProfileFromOnboardingChat(false); // Reset so next profile open uses normal header
  };

  const handleSaveAndGoToConversations = useCallback(() => {
    // "Got it!" on the post-onboarding profile: go to the homepage.
    handleProfileBack();
  }, []);


  const handleSwellyShaperBack = () => {
    // Navigate back from Swelly Shaper to profile
    setShowSwellyShaper(false);
    setShowProfile(true);
  };

  const handleSwellyShaperViewProfile = () => {
    console.log('[AppContent] handleSwellyShaperViewProfile called');
    console.log('[AppContent] Current state - showSwellyShaper:', showSwellyShaper, 'showProfile:', showProfile);
    // Navigate from Swelly Shaper to profile - set flag so user sees Edit/Save header and can save or go back to Swelly Shaper
    setProfileFromOnboardingChat(true);
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

  // Stable identity — the Swelly screen receives this through context; a
  // fresh lambda every render risks effect re-fires inside the screen.
  const handleSwellyChatStateChange = useCallback(
    (chatId: string | null, matchedUsers: any[], destination: string) => {
      setTripPlanningChatId(chatId);
      setTripPlanningMatchedUsers(matchedUsers);
      setTripPlanningDestination(destination);
    },
    []
  );

  const handleSwellyPress = () => {
    pushRootCard('SwellyChat', { service: 'copy' });
  };

  const handleSwellyPressCopy = async () => {
    // Dev card: uses swelly-trip-planning-copy-copy edge
    await restoreLatestChatIfNeeded();
    pushRootCard('SwellyChat', { service: 'copy-copy' });
  };

  const handleProfilePress = () => {
    // Own profile is a tab root now — switch tabs instead of opening the overlay.
    requestTab('profile');
  };

  const handleViewUserProfile = (userId: string) => {
    console.log('[AppContent] handleViewUserProfile called with userId:', userId);
    // Navigate to another user's profile

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
    
    // Other-user profiles are CARDS (nav migration B3) — they stack above
    // whatever chat/trip/Swelly card opened them; back pops to it.
    pushRootCard('ProfileCard', { userId });
    console.log('[AppContent] handleViewUserProfile completed');
  };

  const handleOpenGroupChat = useCallback((params: {
    conversationId: string;
    title: string;
    heroImageUrl?: string | null;
    tripId?: string;
  }) => {
    // Trip group chats are cards — the trip card stays underneath.
    pushRootCard('ChatCard', {
      conversationId: params.conversationId,
      otherUserId: '',
      otherUserName: params.title,
      otherUserAvatar: params.heroImageUrl ?? null,
      isDirect: false,
      tripId: params.tripId,
    });
  }, []);

  const handleOpenTripDetailFromChat = useCallback(
    (tripId: string, focus?: TripDetailFocus) => {
      // Mid-stack open (chat header tap): push ON TOP of the chat card —
      // back returns to the chat. Do NOT switch the tab underneath:
      // switching tabs pops every card above HomeTabs, which destroyed the
      // chat the user came from. openTripCard (with its tab switch) is for
      // DEEP LINKS only, where there's no stack context to preserve.
      pushRootCard('TripDetail', { tripId, focus: focus ?? null });
    },
    []
  );

  // Taps from inside a TripDetail card: the ProfileCard stacks above the trip
  // card, back pops to it. Plain function (not useCallback) so it never holds
  // a stale handleViewUserProfile.
  const handleViewUserProfileFromTrip = (userId: string, _fromTripId: string) => {
    handleViewUserProfile(userId);
  };

  const handleOpenSurftripDetail = useCallback((groupId: string) => {
    pushRootCard('SurftripCard', { groupId });
  }, []);

  // Re-entrancy guard for the conversation-start flow: a frozen UI can queue
  // several taps that all fire when it unblocks (this caused 6 concurrent
  // createDirectConversation calls + 6 heavy refreshes that locked the thread).
  // Shared with the welcome-overlay "Connect" button below — both open a DM.
  const startConvoGuardRef = useRef(0);

  const handleStartConversation = async (userId: string, otherUserName?: string, otherUserAvatar?: string | null) => {
    const nowTs = Date.now();
    if (nowTs - startConvoGuardRef.current < 1500) {
      console.log('[AppContent] handleStartConversation ignored — rapid repeat tap');
      return;
    }
    startConvoGuardRef.current = nowTs;
    console.log('[AppContent] ========== handleStartConversation START ==========');
    console.log('[AppContent] handleStartConversation called with userId:', userId);
    console.log('[AppContent] Current state - showConversationLoading:', showConversationLoading);
    console.log('[AppContent] Current state - pendingConversation:', pendingConversation);

    try {
      // Check if conversation already exists using in-memory context (already loaded)
      console.log('[AppContent] Checking if conversation exists for userId:', userId);
      const existingConv = messagingConversations.find(conv =>
        conv.other_user && conv.other_user.user_id === userId
      );
      
      console.log('[AppContent] Conversation exists:', !!existingConv);
      
      if (existingConv && existingConv.other_user) {
        // Conversation exists, open the chat card immediately (no loading screen)
        console.log('[AppContent] ✓ Conversation exists, pushing chat card');
        pushRootCard('ChatCard', {
          conversationId: existingConv.id,
          otherUserId: userId,
          otherUserName: existingConv.other_user.name || 'User',
          otherUserAvatar: existingConv.other_user.profile_image_url || null,
          isDirect: true,
        });
      } else {
        // No conversation exists yet — use data passed from ProfileScreen (already loaded)
        console.log('[AppContent] ✗ No conversation exists, showing loading screen');

        console.log('[AppContent] Setting pending conversation...');
        setPendingConversation({
          otherUserId: userId,
          otherUserName: otherUserName || 'User',
          otherUserAvatar: otherUserAvatar || null,
        });
        console.log('[AppContent] pendingConversation state updated');
        // Show the loading screen in the same render cycle that closes the
        // profile — without this, ProfileScreen unmounts first, the render
        // cascade falls through to ConversationsStack (home flash) and then
        // TripPlanningChatScreen remounts with its enter animation, all before
        // the match animation finally appears. Setting both state updates
        // synchronously batches them so ConversationLoadingScreen wins the
        // overlay slot the same frame Profile closes.
        setShowConversationLoading(true);
        console.log('[AppContent] ✓ showConversationLoading set to true');
      }

      // Close the legacy profile overlay if it's the caller (post-onboarding
      // flow); card-origin calls leave state untouched (no spurious re-render).
      if (showProfile) {
        setShowProfile(false);
      }
      
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
    
    // After loading screen completes, open the chat card.
    if (pendingConversation) {
      const params = {
        conversationId: pendingConversation.conversationId,
        otherUserId: pendingConversation.otherUserId,
        otherUserName: pendingConversation.otherUserName,
        otherUserAvatar: pendingConversation.otherUserAvatar,
        isDirect: true as const,
      };
      // Z-ORDER: the loading overlay renders ABOVE the navigator. Commit its
      // unmount FIRST, then push — otherwise the card slides in invisibly
      // behind the overlay for a frame (the navigation dispatch reaches the
      // native layer before React commits the overlay removal).
      setShowConversationLoading(false);
      setPendingConversation(null);
      setTimeout(() => pushRootCard('ChatCard', params), 0);
    } else {
      console.warn('[AppContent] handleConversationLoadingComplete called but no pendingConversation');
    }
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
    setCurrentStep(3); // Destinations back to travel experience
  };

  const handleStep5Back = () => {
    setCurrentStep(4); // Budget back to destinations
  };

  const handleStep6Back = () => {
    setCurrentStep(5); // Lifestyle back to budget
  };

  const handleStep7Back = () => {
    setCurrentStep(6); // Profile back to lifestyle (renumbered from step-3-back)
  };


  // If onboarding is complete AND user is authenticated, show conversations screen as home page
  // This check must come FIRST before any step checks
  // CRITICAL: Must check user !== null to prevent showing conversations screen after logout
  // Also validate that session exists (unless Supabase not configured or demo user)
  // Don't show if we're currently validating (wait for validation to complete)
  const shouldShowConversations = isComplete && user !== null &&
    !sessionValidationRef.current && // Don't show while validating
    (isDemoUser || isSupabaseConfigured === false || hasValidatedSession); // Show if demo user, Supabase not configured, or session validated

  // Reset the tab mirror when leaving the main app (logout) — the navigator
  // unmounts with this branch and remounts fresh on Lineup at next login.
  useEffect(() => {
    if (!shouldShowConversations) {
      activeTabRef.current = 'lineup';
      prevTabRef.current = 'lineup';
      setRequestedTab(null);
    }
  }, [shouldShowConversations]);

  // Register for push notifications once user reaches home screen
  useEffect(() => {
    if (shouldShowConversations) {
      pushNotificationService.registerForPushNotifications().catch(err =>
        console.warn('[AppContent] Push registration failed (non-blocking):', err)
      );
    }
  }, [shouldShowConversations]);

  // Keep the user's device timezone synced (powers per-user quiet hours for notifications).
  useEffect(() => {
    const uid = (user as any)?.id;
    if (!shouldShowConversations || !uid) return;
    syncDeviceTimezone(uid);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') syncDeviceTimezone(uid); });
    return () => sub.remove();
  }, [shouldShowConversations, user]);

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

  // Warm the Explore cache the moment the user reaches the main app, so opening
  // Trips paints instantly instead of waiting on a cold fetch. Fire-and-forget,
  // once per app session. (We prefetch trips first — that's what paints — then
  // the meta so avatars are warm too.) `shouldShowConversations` is the same
  // "in main app" signal used by the effect above.
  const exploreWarmedRef = useRef(false);
  useEffect(() => {
    if (!shouldShowConversations || exploreWarmedRef.current) return;
    exploreWarmedRef.current = true;
    const userId = user?.id ? user.id.toString() : null;
    queryClient
      .prefetchInfiniteQuery({
        // Must match useExploreTrips' no-filter key so the first mount consumes
        // this warmed cache instead of re-fetching (the hook reads from
        // exploreFiltered(EMPTY_EXPLORE_FILTER_KEY), not the bare `explore` prefix).
        queryKey: tripsKeys.exploreFiltered(EMPTY_EXPLORE_FILTER_KEY),
        queryFn: ({ pageParam, signal }: any) =>
          exploreFeed(11, pageParam?.created_at ?? null, pageParam?.id ?? null, pageParam?.participant_count ?? null, signal), // 11 = EXPLORE_PAGE_LIMIT(10) + 1 probe row, matches useExploreTrips
        initialPageParam: null,
      })
      .then(() => {
        // Also warm the DETAIL of the first few trips so opening one of them is
        // instant before the user scrolls. Critical query only (trip + members +
        // my request), gated on a known userId — a userId-less prefetch would
        // cache a detail with myRequest=null that the real open would consume.
        if (!userId) return;
        const data = queryClient.getQueryData<{ pages: Array<Array<{ id: string }>> }>(tripsKeys.exploreFiltered(EMPTY_EXPLORE_FILTER_KEY));
        const firstTrips = (data?.pages?.flat() ?? []).slice(0, EXPLORE_DETAIL_PREFETCH_COUNT);
        for (const t of firstTrips) {
          if (!t?.id) continue;
          queryClient.prefetchQuery({
            queryKey: tripsKeys.detail(t.id),
            queryFn: ({ signal }) => fetchTripCore(t.id, userId, signal),
          });
        }
      })
      .catch(() => { /* best-effort */ });
  }, [shouldShowConversations]);

  // Age block overlay — shown when device flag is set (underage user)
  const handleAgeBlockOK = async () => {
    setShowAgeBlockOverlay(false);
    try {
      await supabaseAuthService.signOut();
    } catch {}
    resetOnboarding();
    setUser(null);
    setCurrentStep(STEP_WELCOME);
  };

  // Hidden recovery: 3-second long-press on the modal text clears the
  // device-local age-gate block. Lets a supervised tester retry without
  // reinstalling the app.
  const handleAgeBlockSecretUnblock = async () => {
    await ageGateService.clearBlock();
    setShowAgeBlockOverlay(false);
  };

  // ---- Main-app nav context (computed unconditionally — hooks must run on
  // every render, so this lives ABOVE the conditional returns below even
  // though it is only consumed by the main-app branch). ----

  // NOTE: the old `isListFrontmost` (activeTab === 'lineup' && !overlays) used to
  // be computed here and threaded into lineupProps. Because it changed on every
  // Lineup-involving tab switch and is a dependency of the mainNavValue memo, it
  // rebuilt the whole nav context and re-rendered all three mounted roots — the
  // tab-switch lag. ConversationsScreen now derives "frontmost" itself from
  // useIsFocused (stackScreenFocused) + the overlay flag below, which is stable
  // across tab switches.

  // The floating bottom nav lives INSIDE the tab navigator (custom tabBar).
  // Cards cover it natively; this list is the legacy overlays that render ABOVE
  // the navigator and would otherwise float over the bar.
  const barSuppressed =
    showConversationLoading ||
    showSwellyShaper ||
    showProfile ||
    showProfileEditor;

  // Dev-only perf watchdog. SILENT when healthy — only logs when the JS thread
  // actually freezes (a 2s timer that fires >1s late = the thread was blocked).
  // Quiet Metro = the app is genuinely fine. A "⚠️ PERF" line = a REAL foreground
  // stall, with how long it blocked + open realtime channel count for context.
  //
  // Critically: iOS suspends JS timers while the app is backgrounded / the phone
  // is locked, so a plain timer-drift check reports huge FAKE "freezes" (e.g.
  // 28s) that are really just you switching apps. We track AppState and skip the
  // warning whenever the app was anything but 'active' across the interval — so a
  // ⚠️ line means a genuine on-screen freeze, not a suspended timer.
  useEffect(() => {
    if (!__DEV__) return;
    let last = Date.now();
    let leftActive = false;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') leftActive = true;
    });
    const id = setInterval(() => {
      const now = Date.now();
      const lag = now - last - 2000;
      last = now;
      const wasBackgrounded = leftActive || AppState.currentState !== 'active';
      leftActive = AppState.currentState !== 'active';
      if (lag > 1000 && !wasBackgrounded) {
        let channels = 0;
        try { channels = supabase.getChannels().length; } catch { /* noop */ }
        console.log(`⚠️ PERF: JS thread blocked ${Math.round(lag)}ms (realtime channels: ${channels})`);
      }
    }, 2000);
    return () => { sub.remove(); clearInterval(id); };
  }, []);
  //
  // Several of the handlers above are plain (non-useCallback) functions that
  // legitimately read live state, so their identities change every render.
  // Feeding them straight into the context would rebuild mainNavValue on every
  // AppContent re-render (messaging events, scroll, etc.) and re-render the
  // entire mounted screen tree — the root cause of the freeze. The latest-ref
  // pattern gives the context STABLE callback identities while each call still
  // runs the freshest implementation (no stale closures, no behavior change).
  const liveHandlersRef = useRef({
    handleViewUserProfile,
    handleViewUserProfileFromTrip,
    handleStartConversation,
    handleConversationPress,
    handleSwellyPress,
    handleSwellyPressCopy,
    handleProfilePress,
    handleSwellyShaperViewProfile,
  });
  liveHandlersRef.current = {
    handleViewUserProfile,
    handleViewUserProfileFromTrip,
    handleStartConversation,
    handleConversationPress,
    handleSwellyPress,
    handleSwellyPressCopy,
    handleProfilePress,
    handleSwellyShaperViewProfile,
  };
  const stableHandlers = useMemo(
    () => ({
      onViewUserProfile: (userId: string) =>
        liveHandlersRef.current.handleViewUserProfile(userId),
      onViewUserProfileFromTrip: (userId: string, fromTripId: string) =>
        liveHandlersRef.current.handleViewUserProfileFromTrip(userId, fromTripId),
      onStartConversation: (
        userId: string,
        otherUserName?: string,
        otherUserAvatar?: string | null
      ) =>
        liveHandlersRef.current.handleStartConversation(
          userId,
          otherUserName,
          otherUserAvatar
        ),
      onConversationPress: (conversationId: string) =>
        liveHandlersRef.current.handleConversationPress(conversationId),
      onSwellyPress: () => liveHandlersRef.current.handleSwellyPress(),
      onSwellyPressCopy: () => liveHandlersRef.current.handleSwellyPressCopy(),
      onProfilePress: () => liveHandlersRef.current.handleProfilePress(),
      onSwellyShaperViewProfile: () =>
        liveHandlersRef.current.handleSwellyShaperViewProfile(),
    }),
    []
  );

  // Everything the three tab roots need from AppContent travels through this
  // context (navigator screens must be stable module-level components, so direct
  // prop threading is no longer possible). Memoized: only rebuilds when a value
  // a child actually consumes changes — NOT on every unrelated re-render.
  const mainNavValue: MainNavContextValue = useMemo(() => ({
    navControl: bottomNavControl,
    barSuppressed,
    onTabChange: handleTabChange,
    requestedTab,
    onRequestedTabConsumed: handleRequestedTabConsumed,
    requestedTripCard,
    onRequestedTripCardConsumed: handleRequestedTripCardConsumed,
    tripCard: {
      onOpenGroupChat: handleOpenGroupChat,
      onViewUserProfile: stableHandlers.onViewUserProfileFromTrip,
    },
    chatCard: {
      onViewProfile: stableHandlers.onViewUserProfile,
      onOpenTripDetail: handleOpenTripDetailFromChat,
      onOpenSurftripDetail: handleOpenSurftripDetail,
    },
    profileCard: {
      onMessage: stableHandlers.onStartConversation,
    },
    settings: {
      userName: currentUserName,
      userAvatar: currentUserAvatar,
      userEmail: user?.email,
    },
    swellyChat: {
      persistedChatId: tripPlanningChatId,
      persistedMatchedUsers: tripPlanningMatchedUsers,
      persistedDestination: tripPlanningDestination,
      onChatStateChange: handleSwellyChatStateChange,
      onViewUserProfile: stableHandlers.onViewUserProfile,
      onStartConversation: stableHandlers.onStartConversation,
    },
    lineupProps: {
      // Overlay state only (NOT the active tab). barSuppressed is stable across
      // tab switches, so this no longer rebuilds the context on every switch.
      overlayActive: barSuppressed,
      onConversationPress: stableHandlers.onConversationPress,
      onSwellyPress: stableHandlers.onSwellyPress,
      onSwellyPressCopy: stableHandlers.onSwellyPressCopy,
      onProfilePress: stableHandlers.onProfilePress,
      onSettingsPress: () => pushRootCard('Settings', undefined),
      onTripsPress: () => requestTab('trips'),
      onOpenTripDetail: handleOpenTripDetailFromChat,
      onOpenSurftripDetail: handleOpenSurftripDetail,
      onViewUserProfile: stableHandlers.onViewUserProfile,
      onSwellyShaperViewProfile: stableHandlers.onSwellyShaperViewProfile,
      pendingNotificationConversationId,
      onPendingNotificationHandled: () => setPendingNotificationConversationId(null),
    },
    tripsProps: {
      onBack: () => requestTab('lineup'),
    },
    profileProps: {
      onBack: () => requestTab(prevTabRef.current),
      onMessage: stableHandlers.onStartConversation,
      onEdit: () => setShowProfileEditor(true),
      onSettings: () => pushRootCard('Settings', undefined),
      // Tab root: snaps into place (no slide-in) and never animates itself
      // off-screen — it stays mounted, so a slide-out would park it there.
      noTransition: true,
      swipeBackDisabled: true,
    },
  }), [
    bottomNavControl,
    barSuppressed,
    handleTabChange,
    requestedTab,
    handleRequestedTabConsumed,
    requestedTripCard,
    handleRequestedTripCardConsumed,
    handleOpenGroupChat,
    handleOpenTripDetailFromChat,
    handleOpenSurftripDetail,
    handleSwellyChatStateChange,
    stableHandlers,
    currentUserName,
    currentUserAvatar,
    user?.email,
    tripPlanningChatId,
    tripPlanningMatchedUsers,
    tripPlanningDestination,
    pendingNotificationConversationId,
    requestTab,
  ]);

  if (showAgeBlockOverlay) {
    return (
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 28, maxWidth: 340, width: '100%', alignItems: 'center' }}>
          <Pressable onLongPress={handleAgeBlockSecretUnblock} delayLongPress={3000}>
            <RNText style={{ fontSize: 17, lineHeight: 25, textAlign: 'center', color: '#333', marginBottom: 24, fontWeight: '500' }}>
              We're sorry, but you are not eligible to use Swellyo as you are under the permitted age for using our app.
            </RNText>
          </Pressable>
          <TouchableOpacity
            onPress={handleAgeBlockOK}
            style={{ backgroundColor: '#333', borderRadius: 24, paddingVertical: 14, paddingHorizontal: 48 }}
            activeOpacity={0.8}
          >
            <RNText style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>OK</RNText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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

    // Determine which overlay screen (if any) should cover the navigator.
    // Remaining legacy overlays: Settings, SwellyShaper, Profile, the
    // conversation-loading animation. Priority order preserved.
    let activeOverlay: React.ReactNode = null;
    if (showSwellyShaper) {
      console.log('[AppContent] Rendering SwellyShaperScreen');
      console.log('[AppContent] Passing onViewProfile:', typeof handleSwellyShaperViewProfile);
      activeOverlay = (
        <SwellyShaperScreen
          onBack={handleSwellyShaperBack}
          onViewProfile={handleSwellyShaperViewProfile}
        />
      );
    } else if (showProfile) {
      console.log('[AppContent] Rendering ProfileScreen (own profile overlay)');
      activeOverlay = (
        <ProfileScreen
          onBack={handleProfileBack}
          onMessage={handleStartConversation}
          fromOnboardingChat={profileFromOnboardingChat}
          onSaveAndGoToConversations={handleSaveAndGoToConversations}
          onEdit={() => {
            setShowProfileEditor(true);
          }}
        />
      );
    } else if (showConversationLoading && pendingConversation) {
      console.log('[AppContent] ✓ Rendering ConversationLoadingScreen');
      console.log('[AppContent] Loading screen props - currentUserAvatar:', !!currentUserAvatar, 'currentUserName:', currentUserName);
      console.log('[AppContent] Loading screen props - otherUserAvatar:', !!pendingConversation.otherUserAvatar, 'otherUserName:', pendingConversation.otherUserName);
      activeOverlay = (
        <ConversationLoadingScreen
          currentUserAvatar={currentUserAvatar}
          currentUserName={currentUserName}
          otherUserAvatar={pendingConversation.otherUserAvatar}
          otherUserName={pendingConversation.otherUserName}
          onComplete={handleConversationLoadingComplete}
        />
      );
    }
    // Chats (DMs, group chats, surftrip chats) and Swelly are all CARDS on
    // the root stack now — no overlay branches for them.

    return (
      <MainNavProvider value={mainNavValue}>
      <View style={styles.fill}>
        {/* The tab navigator (Lineup / Trips / Profile + floating bottom nav)
            is the always-mounted base layer; visited tabs stay mounted so
            scroll positions and realtime subscriptions persist. Overlays
            below still cover it absolutely, exactly as before. */}
        <View style={styles.fill}>
          <RootNavigator />
        </View>
        {/* Swelly chat is the SwellyChat CARD in RootNavigator now (nav
            migration B2) — the display:'none' keep-alive layers are gone. */}
        {activeOverlay && <View style={StyleSheet.absoluteFill}>{activeOverlay}</View>}
        <InAppBannerHost />
        {/* The floating bottom nav renders INSIDE RootNavigator as the
            custom tabBar (one persistent instance — pill animation plays
            across tab switches). barSuppressed hides it under overlays. */}
        <ProfileEditPanel
          visible={showProfileEditor}
          onClose={() => setShowProfileEditor(false)}
          surfer={currentUserSurfer}
        />
        {activeJoinDecision?.status === 'declined' ? (
          <JoinDeclinedOverlay
            visible={!!activeJoinDecision}
            decision={activeJoinDecision}
            onPrimaryAction={handleJoinDecisionPrimary}
            onDismiss={handleJoinDecisionDismiss}
            onMessageAdmin={(d) => {
              advanceJoinDecisionQueue(d);
              if (d.trip.host_id) {
                handleStartConversation(d.trip.host_id, d.trip.host_name ?? undefined, d.trip.host_avatar ?? null);
              }
            }}
          />
        ) : (
          <JoinDecisionOverlay
            visible={!!activeJoinDecision}
            decision={activeJoinDecision}
            onPrimaryAction={handleJoinDecisionPrimary}
            onDismiss={handleJoinDecisionDismiss}
          />
        )}
      </View>
      </MainNavProvider>
    );
  }

  // Back from the welcome step (step 0) logs the user out and returns to login.
  const handleWelcomeBack = async () => {
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
  };

  // Steps 0–7 (incl. the step-2 video-upload sub-state) — rendered through the shared
  // OnboardingScaffold so the header + Next button stay fixed and content slides
  // between them. Returning the same <OnboardingScaffold> element across these steps
  // keeps it mounted so the animations run.
  // Step 0 — the onboarding welcome splash ("Yo! Let's Travel."). Full-bleed
  // (torn-paper photos to the screen edges + its own CTA), so it renders on its
  // own rather than through the OnboardingScaffold chrome that wraps steps 1–7.
  if (currentStep === 0) {
    return (
      <OnboardingWelcomeScreen
        onNext={() => setCurrentStep(1)}
        onBack={handleWelcomeBack}
      />
    );
  }

  if (currentStep >= 1 && currentStep <= 7) {
    const loadingByStep: Record<number, boolean> = {
      0: false,
      1: isSavingStep1,
      2: showVideoUploadStep ? false : isSavingStep2, // video upload has no blocking save
      3: isSavingStep3,
      4: isSavingStep4,
      5: isSavingStep5,
      6: isSavingStep6,
      7: isSavingStep7,
    };
    return (
      <OnboardingScaffold
        currentStep={currentStep}
        showVideoUploadStep={showVideoUploadStep}
        isLoading={loadingByStep[currentStep] ?? false}
        renderStepContent={(key) => {
          // 'welcome' (step 0) is rendered full-bleed above, not through the scaffold.
          if (key === 'step1') {
            return (
              <OnboardingStep1Screen
                onNext={handleStep1Next}
                onBack={handleStep1Back}
                initialData={formData}
                updateFormData={updateFormData}
              />
            );
          }
          if (key === 'videoUpload') {
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
          if (key === 'step2') {
            return (
              <OnboardingStep2Screen
                onNext={handleStep2Next}
                onBack={handleStep2Back}
                initialData={formData}
                updateFormData={updateFormData}
              />
            );
          }
          if (key === 'step3') {
            return (
              <OnboardingStep3Screen
                onNext={handleStep3Next}
                onBack={handleStep3Back}
                initialData={formData}
                updateFormData={updateFormData}
              />
            );
          }
          if (key === 'step4') {
            return (
              <OnboardingStep4DestinationsScreen
                onNext={handleStep4Next}
                onBack={handleStep4Back}
                initialData={formData}
                updateFormData={updateFormData}
              />
            );
          }
          if (key === 'step5') {
            return (
              <OnboardingStep5BudgetScreen
                onNext={handleStep5Next}
                onBack={handleStep5Back}
                initialData={formData}
                updateFormData={updateFormData}
              />
            );
          }
          if (key === 'step6') {
            return (
              <OnboardingStep6LifestyleScreen
                onNext={handleStep6Next}
                onBack={handleStep6Back}
                initialData={formData}
                updateFormData={updateFormData}
              />
            );
          }
          if (key === 'step7') {
            return (
              <OnboardingStep4Screen
                onNext={handleStep7Next}
                onBack={handleStep7Back}
                initialData={formData}
                updateFormData={updateFormData}
                isLoading={isSavingStep7}
                onAgeBlocked={() => setShowAgeBlockOverlay(true)}
              />
            );
          }
          return null;
        }}
      />
    );
  }

  // Show welcome screen by default (before onboarding starts, when currentStep is STEP_WELCOME or not 0-5)
  // Note: currentStep === 0 shows OnboardingWelcomeScreen (handled above)
  // This handles: initial load, or when user hasn't started onboarding yet
  // Auth guard ensures unauthenticated users are redirected here
  // Demo buttons always passed; WelcomeScreen controls visibility via showDemoByDefault
  // or a secret long-press gesture on the logo (for testers on production).
  const showDemoByDefault = isDevMode || isLocalMode;
  // Closes the window between isRestoringSession=false and hasValidatedSession=true:
  // if we have a restored user but useAuthGuard hasn't validated the session yet,
  // keep the branded loading UI up so the login buttons don't flash before redirect.
  const isAuthResolving =
    isCheckingAuth ||
    (user !== null && !hasValidatedSession && !isDemoUser && isSupabaseConfigured !== false) ||
    // Keep spinner up until we've checked finished_onboarding from the DB for
    // THIS specific user. Without this gate, a fresh sign-in flashes
    // OnboardingWelcomeScreen before the DB check resolves.
    (user !== null && !isDemoUser && !onboardingCheckedForCurrentUser);
  return (
    <WelcomeScreen
      onGetStarted={handleGetStarted}
      onDemoChat={handleDemoChat}
      onSkipDemo={handleSkipDemo}
      isCheckingAuth={isAuthResolving}
      showDemoByDefault={showDemoByDefault}
    />
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
});