import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Platform,
  Modal,
  Alert,
  Animated,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../config/supabase';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { usePostHog } from 'posthog-react-native';
import { messagingService, Conversation, getMuteUntilFromMember } from '../services/messaging/messagingService';
import { blockingService } from '../services/blocking/blockingService';
import { useMessaging } from '../context/MessagingProvider';
import { useUserProfile } from '../context/UserProfileContext';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { authService } from '../services/auth/authService';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { Images } from '../assets/images';
import { MainHeader } from '../components/MainHeader';
import { UserSearchModal } from '../components/UserSearchModal';
import { CreateSurftripModal } from '../components/surftrips/CreateSurftripModal';
import { TutorialOverlay, AnchorRect } from '../components/TutorialOverlay';
import { getSurftripHeroImagesByConversation } from '../services/surftrips/surftripsService';
import { getGroupTripHeroImagesByConversation } from '../services/trips/groupTripsService';
import { getStorageThumbUrl } from '../services/media/imageService';
import { analyticsService } from '../services/analytics/analyticsService';
import { DirectMessageScreen } from './DirectMessageScreen';
import { DirectGroupChat } from './DirectGroupChat';
import { SwellyShaperScreen } from './SwellyShaperScreen';
import { SwellyoTeamWelcome } from './SwellyoTeamWelcome';
import { ProfileImage } from '../components/ProfileImage';
import { ConversationListSkeleton } from '../components/skeletons';
import { pushRootCard } from '../navigation/navigationRef';
import { useTutorial } from '../context/TutorialContext';
import { ChatErrorBoundary } from '../components/chat/ChatErrorBoundary';

interface ConversationsScreenProps {
  onConversationPress?: (conversationId: string) => void;
  onSwellyPress?: () => void;
  onSwellyPressCopy?: () => void; // Dev mode: Navigate to TripPlanningChatScreenCopy
  onProfilePress?: () => void;
  onViewUserProfile?: (userId: string) => void;
  onSwellyShaperViewProfile?: () => void; // Callback for viewing profile from Swelly Shaper
  onSettingsPress?: () => void;
  onTripsPress?: () => void;
  onOpenTripDetail?: (tripId: string, focus?: import('../services/notifications/notificationsService').TripDetailFocus) => void;
  onOpenSurftripDetail?: (surftripId: string) => void;
  pendingNotificationConversationId?: string | null;
  onPendingNotificationHandled?: () => void;
  // True while a legacy full-screen overlay (own-profile, Swelly shaper,
  // conversation-loading, profile editor) covers the navigator. Gates the
  // welcome-guide tutorial so it doesn't fire under an overlay. Decoupled from
  // the active tab ON PURPOSE: tab focus is read via stackScreenFocused
  // (useIsFocused), so switching tabs no longer rebuilds the nav context and
  // re-renders every mounted root (the tab-switch lag fix).
  overlayActive?: boolean;
  // Native only: false while a DM / SurftripDetail card is pushed over the list
  // (a pushed card blurs the Lineup tab, so useIsFocused goes false). Web always
  // passes true. Together with !overlayActive this gives "list is frontmost".
  stackScreenFocused?: boolean;
}

type FilterType = 'all' | 'lineup' | 'trips';

// Cache helper functions are now imported from '../utils/userProfileCache'

// Three Dots Menu Icon Component
const ThreeDotsIcon: React.FC = () => {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 13C12.5523 13 13 12.5523 13 12C13 11.4477 12.5523 11 12 11C11.4477 11 11 11.4477 11 12C11 12.5523 11.4477 13 12 13Z"
        stroke="#7B7B7B"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 6C12.5523 6 13 5.55228 13 5C13 4.44772 12.5523 4 12 4C11.4477 4 11 4.44772 11 5C11 5.55228 11.4477 6 12 6Z"
        stroke="#7B7B7B"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 20C12.5523 20 13 19.5523 13 19C13 18.4477 12.5523 18 12 18C11.4477 18 11 18.4477 11 19C11 19.5523 11.4477 20 12 20Z"
        stroke="#7B7B7B"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

// Shaper Icon Component
const ShaperIcon: React.FC = () => {
  return (
    <Svg width={21} height={15} viewBox="0 0 23 16" fill="none">
      <Path
        d="M1.83027 5.10034L3.45076 4.69035M5.2741 14.5901L3.79351 14.9646M2.33857 4.97188L4.56295 4.40883C5.40001 4.19564 6.23241 4.82702 6.41427 5.80825L7.58009 12.1384C7.76196 13.1197 7.22335 14.0954 6.3863 14.3086L4.16191 14.8717M19.8725 5.10034L18.252 4.69035M16.4287 14.5901L17.9093 14.9646M19.3619 4.97188L17.1375 4.40883C16.3004 4.19564 15.468 4.82702 15.2862 5.80825L14.1203 12.1384C13.9385 13.1197 14.4771 14.0954 15.3141 14.3086L17.5385 14.8717M16.2072 4.44983C15.0869 3.35588 13.969 2.26194 12.8488 1.16799C12.8014 1.11437 12.0982 0.366304 10.7684 0.350217C9.38445 0.334129 8.6429 1.12778 8.60684 1.16799C7.48663 2.26194 6.36867 3.35588 5.24846 4.44983M7.35393 13.4859C7.57543 13.8686 7.91818 14.3086 8.4428 14.6749C9.26121 15.2461 10.1053 15.3472 10.5996 15.35H11.1055C11.4413 15.35 12.36 15.3035 13.2623 14.6749C13.7753 14.3168 14.1157 13.8877 14.3372 13.5078M1.57834 5.16433L2.33727 4.97214C3.17808 4.75922 4.00693 5.38562 4.18857 6.37125L5.35491 12.7003C5.53655 13.6859 5.00218 14.6575 4.16138 14.8705L3.40245 15.0626C2.56164 15.2756 1.73279 14.6492 1.55115 13.6635L0.384808 7.33449C0.203173 6.34886 0.737537 5.37725 1.57834 5.16433ZM18.2963 15.0636L17.5374 14.8714C16.6965 14.6585 16.1622 13.6869 16.3438 12.7013L17.5102 6.37222C17.6918 5.3866 18.5206 4.76019 19.3615 4.97311L20.1204 5.1653C20.9612 5.37822 21.4956 6.34983 21.3139 7.33546L20.1476 13.6645C19.9659 14.6501 19.1371 15.2765 18.2963 15.0636Z"
       stroke="#222B30"
        strokeWidth="1.1"
        strokeMiterlimit="10"
      />
    </Svg>
  );
};

// Swelly Ellipse Background Component
const SwellyEllipse: React.FC = () => {
  return (
    <Svg width={62} height={63} viewBox="0 0 62 63" fill="none">
      <Path
        d="M30.8242 0.75C47.4452 0.75 60.8984 14.4406 60.8984 31.3027C60.8983 48.1648 47.4451 61.8545 30.8242 61.8545C14.2034 61.8544 0.75014 48.1648 0.75 31.3027C0.75 14.4406 14.2033 0.750059 30.8242 0.75Z"
        fill="#D9D9D9"
        stroke="#B72DF2"
        strokeWidth="1.5"
      />
    </Svg>
  );
};

// Swelly Ellipse BOTTOM arc only — rendered ON TOP of the avatar image so the
// purple line at the bottom of the ring sits in front of the image (image
// bottom appears behind the line). The top arc stays behind the image
// (rendered by SwellyEllipse), so the head/hair pops above the purple line.
const SwellyEllipseStroke: React.FC = () => {
  return (
    <Svg width={62} height={63} viewBox="0 0 62 63" fill="none">
      <Path
        d="M60.8984 31.3027C60.8983 48.1648 47.4451 61.8545 30.8242 61.8545C14.2034 61.8544 0.75014 48.1648 0.75 31.3027"
        fill="none"
        stroke="#B72DF2"
        strokeWidth="1.5"
      />
    </Svg>
  );
};

export default function ConversationsScreen({
  onConversationPress,
  onSwellyPress,
  onSwellyPressCopy,
  onProfilePress,
  onViewUserProfile,
  onSwellyShaperViewProfile,
  onSettingsPress,
  onTripsPress,
  onOpenTripDetail,
  onOpenSurftripDetail,
  pendingNotificationConversationId,
  onPendingNotificationHandled,
  overlayActive = false,
  stackScreenFocused = true,
}: ConversationsScreenProps) {
  // Frontmost = the Lineup tab is focused (no card pushed over it) AND no legacy
  // overlay covers it. Previously threaded from AppContent as `isListFrontmost`,
  // which depended on activeTab and rebuilt the nav context on every tab switch
  // — re-rendering all three mounted roots. Derived locally now.
  const isListFrontmost = stackScreenFocused && !overlayActive;
  const insets = useSafeAreaInsets();
  const { resetOnboarding, setCurrentStep, setUser, setIsDemoUser, user: contextUser } = useOnboarding();
  const posthog = usePostHog();
  
  // Check if MVP mode is enabled
  const isMVPMode = process.env.EXPO_PUBLIC_MVP_MODE === 'true';
  // Check if dev mode is enabled
  const isDevMode = process.env.EXPO_PUBLIC_DEV_MODE === 'true';
  // Show Swelly Copy card: when LOCAL_MODE, __DEV__, or EXPO_PUBLIC_DEV_MODE is true (so it works in dev builds and deployed dev)
  const showSwellyCopyCard = (process.env.EXPO_PUBLIC_LOCAL_MODE === 'true' || __DEV__ || isDevMode) && !!onSwellyPressCopy;
  
  // Arrow animation for welcome instruction
  const arrowAnim = useRef(new Animated.Value(0)).current;
  
  
  // Use MessagingProvider for conversations state
  const { conversations: rawConversations, loading, refreshConversations, setCurrentConversationId, hasMoreConversations, isLoadingMoreConversations, loadMoreConversations } = useMessaging();

  // Logged-in user's surfer profile — loaded once at the provider level and
  // reused across navigations, so the header renders instantly on return.
  const { profile: myProfile, refresh: refreshMyProfile } = useUserProfile();

  // Every chat is a ChatCard on the root stack (nav migration B1) — one path
  // for list taps on every platform.
  const openConversation = (sel: {
    id?: string;
    otherUserId: string;
    otherUserName: string;
    otherUserAvatar: string | null;
    isDirect?: boolean;
    tripId?: string;
    surftripId?: string;
  }) => {
    if (sel.id) setCurrentConversationId(sel.id);
    pushRootCard('ChatCard', {
      conversationId: sel.id,
      otherUserId: sel.otherUserId,
      otherUserName: sel.otherUserName,
      otherUserAvatar: sel.otherUserAvatar,
      isDirect: sel.isDirect,
      tripId: sel.tripId,
      surftripId: sel.surftripId,
    });
  };

  // Filter out conversations with blocked users (both directions)
  const conversations = useMemo(() => {
    const blocked = blockingService.getAllHiddenIdsSet();
    if (blocked.size === 0) return rawConversations;
    return rawConversations.filter(c => {
      if (c.is_direct && c.other_user?.user_id) {
        return !blocked.has(c.other_user.user_id);
      }
      return true;
    });
  }, [rawConversations]);

  const [filter, setFilter] = useState<FilterType>('all');
  // Single source of truth for header display name (derived from context)
  const headerDisplayName = contextUser ? (contextUser.nickname?.split(' ')[0] || contextUser.email?.split('@')[0] || 'User') : 'User';
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    return contextUser?.id?.toString() || null;
  });
  const [showMenu, setShowMenu] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showCreateSurftripModal, setShowCreateSurftripModal] = useState(false);
  const [surftripsReloadKey, setSurftripsReloadKey] = useState(0);
  // Surftrip cover photos for group-chat avatars, keyed by conversation id.
  const [surftripHeroImages, setSurftripHeroImages] = useState<Record<string, string | null>>({});
  const [showSwellyShaper, setShowSwellyShaper] = useState(false);
  const [showSwellyoTeamWelcome, setShowSwellyoTeamWelcome] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const isLoggingOutRef = useRef(false);
  const scrollViewRef = useRef<FlatList<Conversation>>(null);
  const loadMoreDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Welcome guide now lives entirely inside Swelly chat; only the replay
  // button in the dev menu still touches this context here.
  const tutorial = useTutorial();

  // ── One-time "Surf Trips tab" coach-mark ────────────────────────────────
  // Fires once when the home screen is the front-most layer ("coast is
  // clear" — no DM/overlay/panel covering it), then never again. Marked
  // seen the moment it shows so an app-kill mid-tip can't re-fire it.
  const surftripsTabRef = useRef<any>(null);
  const [surftripsTabRect, setSurftripsTabRect] = useState<AnchorRect | null>(null);
  const [showSurftripsTip, setShowSurftripsTip] = useState(false);
  const surftripsTipFiredRef = useRef(false);

  useEffect(() => {
    if (surftripsTipFiredRef.current) return;
    if (isMVPMode) return;
    if (!tutorial.isHydrated || tutorial.surftripsTipSeen) return;
    if (!isListFrontmost || !stackScreenFocused) return;
    // Let the screen settle (post-onboarding overlays clearing, layout done),
    // then re-check it's still clear before showing.
    const timer = setTimeout(() => {
      if (
        surftripsTipFiredRef.current ||
        !isListFrontmost ||
        !stackScreenFocused ||
        tutorial.surftripsTipSeen
      ) return;
      surftripsTabRef.current?.measureInWindow?.(
        (x: number, y: number, width: number, height: number) => {
          if (surftripsTipFiredRef.current || width <= 0 || height <= 0) return;
          surftripsTipFiredRef.current = true;
          setSurftripsTabRect({ x, y, width, height });
          setShowSurftripsTip(true);
          tutorial.markSurftripsTipSeen();
        },
      );
    }, 900);
    return () => clearTimeout(timer);
  }, [isListFrontmost, stackScreenFocused, isMVPMode, tutorial.isHydrated, tutorial.surftripsTipSeen, tutorial.markSurftripsTipSeen]);

  // Refresh when the app returns from background so mute state (and other
  // server-side changes) from other devices propagate. Avoid useFocusEffect:
  // refreshing on every navigation focus causes a delayed REPLACE_ALL that
  // wipes scroll position after returning from a chat.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshConversations();
      }
    });
    return () => sub.remove();
  }, [refreshConversations]);

  // Update user info when context user changes (immediate sync); reset header when logged out
  useEffect(() => {
    if (contextUser) {
      const userId = contextUser.id?.toString() || null;
      setCurrentUserId(userId);
    } else {
      setUserAvatar(null);
      setCurrentUserId(null);
    }
  }, [contextUser]);

  // Identify user with PostHog early (especially important for MVP mode surveys)
  // This ensures the user's name is available before they interact with surveys
  useEffect(() => {
    if (currentUserId && isMVPMode) {
      // Get user properties for identification
      let userEmail = contextUser?.email;
      let displayName = contextUser?.nickname || headerDisplayName || 'User';
      
      // If we don't have email, try to fetch user data
      if (!userEmail && currentUserId) {
        supabaseAuthService.getCurrentUser()
          .then(user => {
            if (user) {
              userEmail = user.email;
              displayName = user.nickname || user.email?.split('@')[0] || 'User';
              
              // Identify with fetched data
              const userProperties = {
                $email: userEmail,
                $name: displayName,
                email: userEmail,
                name: displayName,
              };
              
              analyticsService.identify(currentUserId, userProperties);
              console.log('[ConversationsScreen] User identified with PostHog on mount:', currentUserId, userProperties);
            }
          })
          .catch(error => {
            console.error('[ConversationsScreen] Error fetching user data for PostHog identification:', error);
          });
      } else {
        // We have the data, identify immediately
        const userProperties = {
          $email: userEmail,
          $name: displayName,
          email: userEmail,
          name: displayName,
        };
        
        analyticsService.identify(currentUserId, userProperties);
        console.log('[ConversationsScreen] User identified with PostHog on mount:', currentUserId, userProperties);
      }
    }
  }, [currentUserId, isMVPMode, contextUser, headerDisplayName]);

  useEffect(() => {
    loadConversations();
  }, [contextUser?.id]);

  // Sync the header avatar/userId from the shared UserProfileContext.
  // The context handles caching + refresh, so this effect just mirrors state.
  useEffect(() => {
    if (myProfile) {
      setUserAvatar(myProfile.profile_image_url ?? null);
      setCurrentUserId(myProfile.user_id);
    }
  }, [myProfile]);


  // Arrow animation effect for welcome instruction
  useEffect(() => {
    // Create a smooth up and down animation with glow effect
    // Note: useNativeDriver: false is required for shadow effects
    const arrowAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: false, // Required for shadow effects
        }),
        Animated.timing(arrowAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: false, // Required for shadow effects
        }),
      ])
    );
    
    arrowAnimation.start();
    
    return () => {
      arrowAnimation.stop();
    };
  }, [arrowAnim]);


  // Conversations are now loaded by MessagingProvider
  // This function is kept for backward compatibility but just triggers refresh
  const loadConversations = async () => {
    try {
      await refreshConversations();
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  // Create fake "Swellyo Team" welcome conversation
  const createWelcomeConversation = (): Conversation => {
    const now = new Date();
    const welcomeTime = formatTime(now.toISOString());
    
    return {
      id: 'welcome-conversation-fake-id',
      title: 'Swellyo Team',
      is_direct: true,
      metadata: { type: null, isWelcome: true },
      created_by: 'system',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      last_message: {
        id: 'welcome-message-fake-id',
        conversation_id: 'welcome-conversation-fake-id',
        sender_id: 'swellyo-team',
        body: 'Welcome',
        attachments: [],
        is_system: false,
        edited: false,
        deleted: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        sender_name: 'Swellyo Team',
      },
      unread_count: 1,
      other_user: {
        conversation_id: 'welcome-conversation-fake-id',
        user_id: 'swellyo-team',
        role: 'member',
        joined_at: now.toISOString(),
        preferences: {},
        name: 'Swellyo Team',
        profile_image_url: undefined,
      },
      members: [],
    };
  };

  // A conversation is visible at all if it passes the base gating: group chats
  // (group trips) are gated to local mode while the feature is hidden; direct
  // chats require an enriched other_user.
  const isConversationVisible = (conv: Conversation) => {
    const isLocalMode = process.env.EXPO_PUBLIC_LOCAL_MODE === 'true';
    if (conv.is_direct === false) return isLocalMode && !!conv.title;
    return !!conv.other_user?.name;
  };

  const getFilteredConversations = () => {
    const filtered = conversations.filter(conv => {
      if (!isConversationVisible(conv)) return false;
      // Chip filter: "The lineup" = direct messages, "Trips" = group-trip
      // chats, "All" = both.
      if (filter === 'lineup') return conv.is_direct === true;
      if (filter === 'trips') return conv.is_direct === false;
      return true;
    });

    if (!loading && filtered.length === 0 && filter === 'all') {
      return [createWelcomeConversation()];
    }

    return filtered;
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((startOfToday.getTime() - startOfDay.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
    if (diffDays === 1) {
      return 'Yesterday';
    }
    if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    }
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    }
    return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
  };

  const handleUserSelect = async (userId: string) => {
    try {
      // Check if conversation already exists
      const result = await messagingService.getConversations(50, 0); // Fetch first page
      const conversations = result.conversations;
      const existingConv = conversations.find(conv => {
        if (conv.other_user && conv.other_user.user_id === userId) {
          return true;
        }
        return false;
      });
      
      if (existingConv && existingConv.other_user) {
        openConversation({
          id: existingConv.id,
          otherUserId: userId,
          otherUserName: existingConv.other_user.name || 'User',
          otherUserAvatar: existingConv.other_user.profile_image_url || null,
        });
      } else {
        // No conversation exists yet - create pending conversation
        const { supabaseDatabaseService } = await import('../services/database/supabaseDatabaseService');
        const surferData = await supabaseDatabaseService.getSurferByUserId(userId);
        openConversation({
          otherUserId: userId,
          otherUserName: surferData?.name || 'User',
          otherUserAvatar: surferData?.profile_image_url || null,
        });
      }
    } catch (error) {
      console.error('Error starting conversation:', error);
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const handleLogout = async () => {
    console.log('handleLogout called');
    
    // Prevent duplicate logout calls
    if (isLoggingOutRef.current) {
      console.log('Logout already in progress, ignoring duplicate call');
      return;
    }
    
    try {
      // Set loading state immediately
      isLoggingOutRef.current = true;
      setIsLoggingOut(true);
      setShowMenu(false);
      
      // Perform logout using centralized logout function
      console.log('Starting logout process...');
      const { performLogout } = await import('../utils/logout');
      const result = await performLogout({
        resetOnboarding,
        setUser,
        setCurrentStep,
        setIsDemoUser,
      });
      
      if (result.success) {
        console.log('User logged out successfully');
      } else {
        console.error('Error during logout:', result.error);
        Alert.alert('Error', `Failed to logout: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error in handleLogout:', error);
    } finally {
      // Reset loading state
      isLoggingOutRef.current = false;
      setIsLoggingOut(false);
    }
  };

  const handleSwitchAccount = async () => {
    setShowMenu(false);

    try {
      // Suppress auth guard from navigating to welcome during the switch
      const { setIsSwitchingAccount } = require('../hooks/useAuthGuard');
      setIsSwitchingAccount(true);

      if (Platform.OS !== 'web') {
        // Sign out Google cache so the account picker shows
        try {
          const { GoogleSignin } = require('@react-native-google-signin/google-signin');
          await GoogleSignin.signOut();
        } catch (e) { /* ignore */ }

        // Show Google account picker immediately
        const { GoogleSignin } = require('@react-native-google-signin/google-signin');
        await GoogleSignin.hasPlayServices();
        const result = await GoogleSignin.signIn();
        const idToken = result?.data?.idToken;
        if (!idToken) throw new Error('No ID token');

        // Replace Supabase session with the new account (no sign-out needed)
        const { supabase } = require('../config/supabase');
        const { data: sessionData, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (error) throw error;

        // Update app user context
        const { convertSupabaseUserToAppUser } = require('../utils/userConversion');
        const appUser = await convertSupabaseUserToAppUser(sessionData.session.user);
        setUser(appUser);
        console.log('Switched to account:', appUser.email);
      } else {
        // On web: sign out Supabase session first (so signInWithGoogle doesn't short-circuit
        // on existing session), then redirect to Google OAuth with prompt=select_account
        const { supabase } = require('../config/supabase');
        await supabase.auth.signOut();
        // Now call sign-in which will redirect to Google with account picker
        const { supabaseAuthService } = require('../services/auth/supabaseAuthService');
        await supabaseAuthService.signInWithGoogle();
      }
    } catch (error: any) {
      if (error?.message?.includes('cancelled') || error?.code === '12501' || error?.code === 'SIGN_IN_CANCELLED') {
        console.log('Account switch cancelled by user');
      } else {
        console.error('Error in handleSwitchAccount:', error);
      }
    } finally {
      const { setIsSwitchingAccount } = require('../hooks/useAuthGuard');
      setIsSwitchingAccount(false);
    }
  };

  const renderFilterButton = (type: FilterType, label: string, dotColor?: string) => {
    const isActive = filter === type;

    return (
      <TouchableOpacity
        ref={type === 'trips' ? surftripsTabRef : undefined}
        onLayout={
          type === 'trips'
            ? () =>
                surftripsTabRef.current?.measureInWindow?.(
                  (x: number, y: number, width: number, height: number) => {
                    if (width > 0 && height > 0) {
                      setSurftripsTabRect({ x, y, width, height });
                    }
                  },
                )
            : undefined
        }
        style={[
          styles.filterButton,
          isActive ? styles.filterButtonActive : styles.filterButtonInactive,
        ]}
        onPress={() => setFilter(type)}
      >
        {dotColor && <View style={[styles.filterDot, { backgroundColor: dotColor }]} />}
        <Text style={[
          styles.filterButtonText,
          isActive && styles.filterButtonTextActive,
          Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
        ]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const handleConversationPress = (conv: Conversation) => {
    // Handle both direct messages and group chats
    if (conv.is_direct && conv.other_user) {
      openConversation({
        id: conv.id,
        otherUserId: conv.other_user.user_id || '',
        otherUserName: conv.other_user.name || 'User',
        otherUserAvatar: conv.other_user.profile_image_url || null,
        isDirect: true,
      });
    } else if (!conv.is_direct) {
      const linkedTripId = typeof conv.metadata?.trip_id === 'string' ? conv.metadata.trip_id : undefined;
      const linkedSurftripId = typeof conv.metadata?.surftrip_id === 'string' ? conv.metadata.surftrip_id : undefined;
      openConversation({
        id: conv.id,
        otherUserId: '',
        otherUserName: conv.title || 'Group Chat',
        otherUserAvatar: surftripHeroImages[conv.id] ?? null,
        isDirect: false,
        tripId: linkedTripId,
        surftripId: linkedSurftripId,
      });
    }
    // Also call the callback if provided
    onConversationPress?.(conv.id);
  };

  // Handle push notification tap — open the target conversation
  useEffect(() => {
    if (!pendingNotificationConversationId || conversations.length === 0) return;
    const conv = conversations.find(c => c.id === pendingNotificationConversationId);
    if (conv) {
      handleConversationPress(conv);
    }
    onPendingNotificationHandled?.();
  }, [pendingNotificationConversationId, conversations]);

  // Load cover photos for group conversations, used as the group-chat avatar.
  // Two sources: surftrip_groups (old feature, keyed by conversation_id) and
  // group_trips (new feature, resolved via conversations.metadata.trip_id).
  useEffect(() => {
    const groupConvs = rawConversations.filter(c => !c.is_direct);
    if (groupConvs.length === 0) {
      setSurftripHeroImages({});
      return;
    }
    const surftripIds = groupConvs.map(c => c.id);
    const groupTripItems = groupConvs
      .filter(c => !!c.metadata?.trip_id)
      .map(c => ({ conversationId: c.id, tripId: c.metadata.trip_id as string }));
    let cancelled = false;
    Promise.all([
      getSurftripHeroImagesByConversation(surftripIds),
      getGroupTripHeroImagesByConversation(groupTripItems),
    ])
      .then(([surftripMap, groupTripMap]) => {
        if (cancelled) return;
        const merged: Record<string, string | null> = { ...surftripMap };
        // A group-trip hero wins when present.
        for (const [convId, url] of Object.entries(groupTripMap)) {
          if (url) merged[convId] = url;
        }
        setSurftripHeroImages(merged);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rawConversations]);

  const renderWelcomeConversation = (conv: Conversation) => {
    // Check if last message is an image or video
    const isLastMessageImage = conv.last_message?.type === 'image' || !!conv.last_message?.image_metadata;
    const isLastMessageVideo = conv.last_message?.type === 'video' || !!(conv.last_message as any)?.video_metadata;
    const isLastMessageAudio = conv.last_message?.type === 'audio' || !!(conv.last_message as any)?.audio_metadata;
    const lastMessageTime = conv.last_message ? formatTime(conv.last_message.created_at) : '';
    const unreadCount = conv.unread_count || 0;

    return (
      <TouchableOpacity
        key={conv.id}
        style={styles.conversationItem}
        onPress={() => {
          // Navigate to Swellyo Team Welcome screen
          setShowSwellyoTeamWelcome(true);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.conversationContent}>
          {/* Two overlapping avatars for Swellyo Team - matching Figma design */}
          <View style={styles.welcomeAvatarContainer}>
            {/* First avatar - behind */}
            <View style={[styles.welcomeAvatar, styles.welcomeAvatarBack]}>
              <Image
                source={Images.userAvatar1}
                style={styles.welcomeAvatarImage}
                resizeMode="cover"
              />
            </View>
            {/* Second avatar - in front with negative margin for overlap */}
            <View style={[styles.welcomeAvatar, styles.welcomeAvatarFront]}>
              <Image
                source={Images.userAvatar2}
                style={styles.welcomeAvatarImage}
                resizeMode="cover"
              />
            </View>
          </View>

          {/* Text content */}
          <View style={styles.textContainer}>
            <Text style={[
              styles.conversationName,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]} numberOfLines={1}>
              Swellyo Team
            </Text>
            {conv.last_message?.deleted ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <View style={{ opacity: 0.6 }}>
                  <Svg height={14} viewBox="0 -960 960 960" width={14} fill="#333333">
                    <Path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z" />
                  </Svg>
                </View>
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  This message was deleted
                </Text>
              </View>
            ) : isLastMessageImage ? (
              <View style={styles.imageMessagePreview}>
                <Ionicons name="image-outline" size={14} color="#7B7B7B" style={styles.imageIcon} />
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  Image
                </Text>
              </View>
            ) : isLastMessageVideo ? (
              <View style={styles.imageMessagePreview}>
                <Ionicons name="videocam-outline" size={14} color="#7B7B7B" style={styles.imageIcon} />
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  Video
                </Text>
              </View>
            ) : isLastMessageAudio ? (
              <View style={styles.imageMessagePreview}>
                <Ionicons name="mic-outline" size={14} color="#7B7B7B" style={styles.imageIcon} />
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  Voice message
                </Text>
              </View>
            ) : (
              <Text style={[
                styles.lastMessage,
                Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
              ]} numberOfLines={1}>
                {conv.last_message?.body || 'You got a new match!'}
              </Text>
            )}
          </View>
        </View>

        {/* Time and unread badge - cyan color for welcome */}
        <View style={styles.timeContainer}>
          {lastMessageTime ? (
            <Text style={[
              styles.welcomeTimeText,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]}>{lastMessageTime}</Text>
          ) : null}
          {unreadCount > 0 ? (
            <View style={styles.welcomeUnreadBadge}>
              <Text style={[
                styles.unreadBadgeText,
                Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
              ]}>{unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const renderConversationItem = (conv: Conversation) => {
    // Skip rendering welcome conversation here - it's handled separately
    if (conv.metadata?.isWelcome) {
      return renderWelcomeConversation(conv);
    }

    const displayName = conv.is_direct
      ? conv.other_user?.name || 'Unknown User'
      : conv.title || 'Group Chat';
    const avatarUrl = conv.is_direct ? conv.other_user?.profile_image_url : null;
    // Group chats: cover photo as avatar, served from the pre-generated static
    // thumbnail (image-thumbnails bucket) via getStorageThumbUrl.
    const groupHeroThumb = !conv.is_direct
      ? getStorageThumbUrl(surftripHeroImages[conv.id], 144)
      : null;

    // Check if last message is an image or video
    const isLastMessageImage = conv.last_message?.type === 'image' || !!conv.last_message?.image_metadata;
    const isLastMessageVideo = conv.last_message?.type === 'video' || !!(conv.last_message as any)?.video_metadata;
    const isLastMessageAudio = conv.last_message?.type === 'audio' || !!(conv.last_message as any)?.audio_metadata;
    const isLastMessageCommitment = conv.last_message?.type === 'commitment_request';
    const isLastMessageMine = conv.last_message?.sender_id === currentUserId;

    // WhatsApp-style: in group chats, prefix the last-message preview with who sent it.
    // Skipped for 1:1 DMs and for system messages ("X joined the group").
    // last_message from the conversations RPC has no sender_name, so resolve the
    // name from the enriched members list (falls back to no prefix if unknown).
    const lastSenderMember = conv.members?.find(m => m.user_id === conv.last_message?.sender_id);
    const lastSenderName = lastSenderMember?.name && lastSenderMember.name !== 'Unknown'
      ? lastSenderMember.name.trim().split(/\s+/)[0]
      : undefined;
    const showSenderPrefix = !conv.is_direct && !!conv.last_message && !conv.last_message?.is_system;
    const senderPrefix = showSenderPrefix
      ? (isLastMessageMine ? 'You: ' : (lastSenderName ? `${lastSenderName}: ` : ''))
      : '';

    const lastMessageTime = conv.last_message ? formatTime(conv.last_message.created_at) : '';
    const unreadCount = conv.unread_count || 0;
    const meMember = conv.members?.find(m => m.user_id === currentUserId);
    const isMuted = getMuteUntilFromMember(meMember) !== null;

    return (
      <View
        key={conv.id}
        collapsable={false}
      >
      <TouchableOpacity
        testID={`conversation-row-${conv.id}`}
        style={styles.conversationItem}
        onPress={() => handleConversationPress(conv)}
        activeOpacity={0.2}
      >
        <View style={styles.conversationContent}>
          {/* Avatar with adv role icon */}
          <View style={styles.avatarContainer}>
            {conv.is_direct ? (
              <ProfileImage
                imageUrl={avatarUrl}
                name={displayName}
                style={styles.avatar}
                showLoadingIndicator={false}
              />
            ) : groupHeroThumb ? (
              <ProfileImage
                imageUrl={groupHeroThumb}
                name={displayName}
                style={styles.avatar}
                showLoadingIndicator={false}
              />
            ) : (
              <View style={[styles.avatar, styles.groupAvatar]}>
                <Ionicons name="people" size={22} color="#FFFFFF" />
              </View>
            )}

          </View>

          {/* Text content */}
          <View style={styles.textContainer}>
            <Text style={[
              styles.conversationName,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]} numberOfLines={1}>
              {displayName}
            </Text>
            {conv.last_message?.deleted ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ opacity: 0.6 }}>
                  <Svg height={14} viewBox="0 -960 960 960" width={14} fill="#333333">
                    <Path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z" />
                  </Svg>
                </View>
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  This message was deleted
                </Text>
              </View>
            ) : isLastMessageImage ? (
              <View style={styles.imageMessagePreview}>
                {senderPrefix ? (
                  <Text style={[
                    styles.lastMessage,
                    Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                  ]} numberOfLines={1}>{senderPrefix}</Text>
                ) : null}
                <Ionicons name="image-outline" size={14} color="#7B7B7B" style={styles.imageIcon} />
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  Image
                </Text>
              </View>
            ) : isLastMessageVideo ? (
              <View style={styles.imageMessagePreview}>
                {senderPrefix ? (
                  <Text style={[
                    styles.lastMessage,
                    Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                  ]} numberOfLines={1}>{senderPrefix}</Text>
                ) : null}
                <Ionicons name="videocam-outline" size={14} color="#7B7B7B" style={styles.imageIcon} />
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  Video
                </Text>
              </View>
            ) : isLastMessageAudio ? (
              <View style={styles.imageMessagePreview}>
                {senderPrefix ? (
                  <Text style={[
                    styles.lastMessage,
                    Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                  ]} numberOfLines={1}>{senderPrefix}</Text>
                ) : null}
                <Ionicons name="mic-outline" size={14} color="#7B7B7B" style={styles.imageIcon} />
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  Voice message
                </Text>
              </View>
            ) : isLastMessageCommitment ? (
              <View style={styles.imageMessagePreview}>
                <Ionicons name="checkmark-circle-outline" size={14} color="#7B7B7B" style={styles.imageIcon} />
                <Text style={[
                  styles.lastMessage,
                  Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                ]} numberOfLines={1}>
                  {isLastMessageMine ? 'You requested to be Committed' : 'Requested to be Committed'}
                </Text>
              </View>
            ) : (
              <Text style={[
                styles.lastMessage,
                Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
              ]} numberOfLines={1}>
                {conv.last_message?.body
                  ? `${senderPrefix}${conv.last_message.body}`
                  : 'You got a new match!'}
              </Text>
            )}
          </View>
        </View>

        {/* Time, mute icon, unread badge */}
        <View style={styles.timeContainer}>
          {lastMessageTime ? (
            <Text style={[
              styles.timeText,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]}>{lastMessageTime}</Text>
          ) : null}
          {(isMuted || unreadCount > 0) ? (
            <View style={styles.timeMetaRow}>
              {isMuted ? (
                <Ionicons name="notifications-off" size={14} color="#7B7B7B" />
              ) : null}
              {unreadCount > 0 ? (
                <View style={[styles.unreadBadge, styles.unreadBadgeDefault]}>
                  <Text style={[
                    styles.unreadBadgeText,
                    Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                  ]}>{unreadCount}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
      </View>
    );
  };

  // Swelly is now a floating circular avatar button (see styles.swellyFloating)
  // anchored bottom-right above the nav bar — no longer a card in the list.

  // Memoized so a re-render that does NOT change the conversation data (e.g. the
  // tab-focus toggle on every Lineup switch) reuses the same array instead of
  // re-filtering. Feeds the FlatList below (stable identity → no full re-render).
  const filteredConversations = useMemo(
    () => getFilteredConversations(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, filter, loading],
  );
  // FlatList renderItem. Virtualized: only the ~10 visible rows render instead of
  // mounting all ~50+ (hundreds of native views) at once — that bulk native draw
  // on tab activation was what froze the bottom-bar pill animation mid-slide.
  // Stable across a focus toggle (deps are data-only), so switching tabs doesn't
  // re-run rows. Stale-closure-safe: currentUserId/surftripHeroImages are in the
  // deps; the row handlers (openConversation, onConversationPress) are stable.
  const renderConversationRow = useCallback(
    ({ item }: { item: Conversation }) => renderConversationItem(item),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, surftripHeroImages],
  );
  const keyExtractorConv = useCallback(
    (item: Conversation, index: number) => item.id ?? `conv-${index}`,
    [],
  );
  // Count of visible group-trip chats, surfaced as "Trips (N)" on the chip.
  const tripsCount = conversations.filter(
    c => c.is_direct === false && isConversationVisible(c),
  ).length;

  // Set body and html background color on web to ensure dark background is visible
  // This hook MUST be called before any early returns to follow Rules of Hooks
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const originalBodyBg = document.body.style.backgroundColor;
      const originalHtmlBg = document.documentElement.style.backgroundColor;
      document.body.style.backgroundColor = '#212121';
      document.documentElement.style.backgroundColor = '#212121';
      return () => {
        document.body.style.backgroundColor = originalBodyBg;
        document.documentElement.style.backgroundColor = originalHtmlBg;
      };
    }
  }, []);

  // Early return for SwellyoTeamWelcome - must come BEFORE other screens
  if (showSwellyoTeamWelcome) {
    return (
      <SwellyoTeamWelcome
        onBack={() => {
          setShowSwellyoTeamWelcome(false);
        }}
        onDropInWithSwelly={() => {
          // Navigate back to conversations screen (homepage)
          setShowSwellyoTeamWelcome(false);
        }}
      />
    );
  }

  // Early return for SwellyShaperScreen - must come BEFORE DirectMessageScreen
  if (showSwellyShaper) {
    console.log('[ConversationsScreen] Rendering SwellyShaperScreen');
    console.log('[ConversationsScreen] onSwellyShaperViewProfile exists:', !!onSwellyShaperViewProfile);
    return (
      <SwellyShaperScreen
        onBack={() => {
          setShowSwellyShaper(false);
          loadConversations(); // Refresh conversations in case profile was updated
        }}
        onViewProfile={onSwellyShaperViewProfile}
      />
    );
  }

  // (Chats render as ChatCard routes on the root stack now — the old
  // selectedConversation early-return is gone; nav migration B1.)

  const Container = Platform.OS === 'web' ? View : SafeAreaView;

  const content = (
    <ChatErrorBoundary>
    <Container style={styles.container} {...(Platform.OS !== 'web' && { edges: ['top'] as const })}>
      {/* Header - Dark background */}
      {/* Shared dark header (see MainHeader). Greeting + dev kebab are the
          Lineup-specific slots; the gradient hairline is the Lineup's. */}
      <MainHeader
        testID="conversations-profile-button"
        userId={currentUserId}
        bottomBorder
        spaceBelow={24}
        title={
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitleMain}>The Lineup</Text>
            <Text style={styles.headerTitleSub}>Yo {headerDisplayName}!</Text>
          </View>
        }
        rightActions={
          process.env.EXPO_PUBLIC_LOCAL_MODE === 'true' ? (
            <TouchableOpacity
              testID="conversations-menu-button"
              style={styles.headerButton}
              onPress={() => setShowMenu(true)}
            >
              <ThreeDotsIcon />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* Content area with light background and rounded corners - dark background visible around it */}
      <View style={styles.contentAreaWrapper}>
        <View style={styles.contentArea}>
        <View style={styles.contentInner}>
          {/* Search Bar */}
          {/* <View style={styles.searchBarContainer}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={24} color="#7B7B7B" style={styles.searchIcon} />
              <Text style={styles.searchPlaceholder}>Search</Text>
            </View>
          </View> */}

          {/* Filter buttons */}
          <View style={styles.filterContainer}>
            {renderFilterButton('all', 'All')}
            {renderFilterButton('lineup', 'The lineup', '#BCAC99')}
            {renderFilterButton('trips', tripsCount > 0 ? `Trips (${tripsCount})` : 'Trips', '#05BCD3')}
          </View>

          {/* Conversations list — virtualized FlatList (was a ScrollView that
              rendered every row at once; that bulk native draw on tab activation
              froze the bottom-bar animation). */}
          <FlatList
            ref={scrollViewRef}
            style={styles.conversationsList}
            contentContainerStyle={styles.conversationsListContent}
            showsVerticalScrollIndicator={false}
            data={loading ? [] : filteredConversations}
            keyExtractor={keyExtractorConv}
            renderItem={renderConversationRow}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={9}
            removeClippedSubviews
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (hasMoreConversations && !isLoadingMoreConversations && !loading) {
                if (loadMoreDebounceRef.current) {
                  clearTimeout(loadMoreDebounceRef.current);
                }
                loadMoreDebounceRef.current = setTimeout(() => {
                  loadMoreConversations();
                }, 300);
              }
            }}
            ListEmptyComponent={loading ? <ConversationListSkeleton count={5} /> : null}
            ListFooterComponent={
              <>
                {/* Loading indicator for pagination */}
                {isLoadingMoreConversations && (
                  <View style={styles.loadMoreContainer}>
                    <ActivityIndicator size="small" color="#A0A0A0" />
                    <Text style={styles.loadMoreText}>Loading more conversations...</Text>
                  </View>
                )}

                {/* Welcome message instructional text - only show when welcome conversation is displayed, or in dev mode for testing */}
                {!loading && (conversations.length === 0 || isDevMode) && filter === 'all' && (
                  <View style={styles.welcomeInstructionContainer}>
                    <Animated.Text
                      style={[
                        styles.welcomeInstructionText,
                        Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any,
                        {
                          shadowColor: '#9D4EDD',
                          shadowOffset: { width: 0, height: 0 },
                          shadowOpacity: arrowAnim.interpolate({
                            inputRange: [0, 0.5, 1],
                            outputRange: [0.2, 0.4, 0.2],
                          }),
                          shadowRadius: 6,
                          ...(Platform.OS === 'web' && {
                            // Web-specific shadow for better glow effect
                            textShadow: arrowAnim.interpolate({
                              inputRange: [0, 0.5, 1],
                              outputRange: [
                                '0 0 6px rgba(157, 78, 221, 0.2)',
                                '0 0 12px rgba(157, 78, 221, 0.4)',
                                '0 0 6px rgba(157, 78, 221, 0.2)',
                              ],
                            }) as any,
                          }),
                        },
                      ]}
                    >
                      Connect with surfers who match your {'\n'}
                      style, experience, and travel interests. {'\n'}
                      {'\n'}
                      Looking for advice about a destination? {'\n'}
                      Swelly can introduce you to surfers{'\n'}
                      who know it best.
                      {'\n'}
                      Just ask Swelly!
                    </Animated.Text>
                    <Animated.View
                      style={[
                        styles.welcomeArrowContainer,
                        {
                          transform: [
                            {
                              translateY: arrowAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, 8],
                              }),
                            },
                          ],
                          shadowColor: '#9D4EDD',
                          shadowOffset: { width: 5, height: 5 },
                          shadowOpacity: arrowAnim.interpolate({
                            inputRange: [0, 0.8, 1],
                            outputRange: [0.5, 0.8, 0.5],
                          }),
                          shadowRadius: 18,
                          ...(Platform.OS === 'web' && {
                            // Web-specific shadow for better glow effect
                            boxShadow: arrowAnim.interpolate({
                              inputRange: [0, 0.5, 1],
                              outputRange: [
                                '0 0 20px rgba(157, 78, 221, 0.3)',
                                '0 0 40px rgba(157, 78, 221, 0.6)',
                                '0 0 20px rgba(157, 78, 221, 0.3)',
                              ],
                            }) as any,
                          }),
                        },
                      ]}
                    >
                      <Ionicons name="arrow-down" size={40} color="#333333" />
                    </Animated.View>
                  </View>
                )}
              </>
            }
          />
        </View>
      </View>
      </View>

      {/* Swelly floating button is rendered in the nav layer (FloatingTabBar in
          RootNavigator) so it sits ABOVE the bottom-nav frost instead of behind
          it. See styles.swellyFloating there. */}

      {/* One-time "Surf Trips tab" coach-mark */}
      <TutorialOverlay
        visible={showSurftripsTip}
        step={1}
        total={1}
        title="Surf Trips"
        body="Create and join group surf trips with fellow surfers — right from this tab."
        ctaLabel="Got it!"
        onPressCta={() => setShowSurftripsTip(false)}
        anchorRect={surftripsTabRect}
        arrowDirection="up"
        enterDelay={150}
      />

      {/* Menu Modal */}
      {showMenu && (
        <Modal
          visible={showMenu}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            console.log('Modal onRequestClose called');
            setShowMenu(false);
          }}
        >
          <TouchableOpacity
            style={styles.menuOverlay}
            activeOpacity={1}
            onPress={() => {
              console.log('Overlay pressed, closing menu');
              setShowMenu(false);
            }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => {
                e.stopPropagation();
              }}
            >
              <View style={styles.menuContainer}>
                {/* Dev-only shortcuts (LOCAL_MODE). The account actions that
                    used to live here — My Profile, New Chat, Setting, Switch
                    account, Logout — moved to Settings / the Profile tab. */}
                {/* Trips — local mode only */}
                {process.env.EXPO_PUBLIC_LOCAL_MODE === 'true' && (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      if (onTripsPress) onTripsPress();
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="airplane-outline" size={20} color="#222B30" />
                    <Text style={styles.menuItemText}>Trips</Text>
                  </TouchableOpacity>
                )}

                {/* New surftrip — local mode only while feature is gated */}
                {process.env.EXPO_PUBLIC_LOCAL_MODE === 'true' && (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      setShowCreateSurftripModal(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="people-outline" size={20} color="#222B30" />
                    <Text style={styles.menuItemText}>New Surf Trip</Text>
                  </TouchableOpacity>
                )}

                {/* Replay welcome guide — local mode only. Clears the
                    completed flag so the guide fires again the next time the
                    user enters Swelly chat. */}
                {process.env.EXPO_PUBLIC_LOCAL_MODE === 'true' && (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={async (e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      // 1. Clear local state + AS + DB. resetForReplay now
                      //    awaits the DB clear so the column is verified NULL
                      //    before we move on.
                      await tutorial.resetForReplay();
                      // 2. Refresh the local profile so the reconciliation
                      //    effect sees welcome_guide_seen_at=NULL and isSeen
                      //    stays false. Without this, the cached profile
                      //    object still has the backfill timestamp and
                      //    reconciliation can flip isSeen back to true.
                      try {
                        await refreshMyProfile();
                      } catch (err) {
                        console.warn('[ReplayGuide] profile refresh failed:', err);
                      }
                      // 3. Open Swelly chat — its auto-trigger fires with
                      //    isSeen=false.
                      onSwellyPress?.();
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="sparkles-outline" size={20} color="#B72DF2" />
                    <Text style={styles.menuItemText}>Replay welcome guide</Text>
                  </TouchableOpacity>
                )}

                {/* Replay surftrips tip — local mode only. Re-opens the
                    one-time "Surf Trips tab" coach-mark right away. */}
                {process.env.EXPO_PUBLIC_LOCAL_MODE === 'true' && (
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      // Measure after the menu modal closes, then show the tip.
                      setTimeout(() => {
                        surftripsTabRef.current?.measureInWindow?.(
                          (x: number, y: number, width: number, height: number) => {
                            if (width > 0 && height > 0) {
                              setSurftripsTabRect({ x, y, width, height });
                            }
                            setShowSurftripsTip(true);
                          },
                        );
                      }, 50);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="boat-outline" size={20} color="#B72DF2" />
                    <Text style={styles.menuItemText}>Replay surftrips tip</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* User Search Modal */}
      <UserSearchModal
        visible={showSearchModal}
        onClose={() => setShowSearchModal(false)}
        onUserSelect={handleUserSelect}
      />

      {/* Create Surftrip Modal — replaces the old group-chat creation flow */}
      <CreateSurftripModal
        visible={showCreateSurftripModal}
        currentUserId={currentUserId}
        onClose={() => setShowCreateSurftripModal(false)}
        onCreated={(group) => {
          setShowCreateSurftripModal(false);
          setSurftripsReloadKey(k => k + 1);
          pushRootCard('SurftripCard', { groupId: group.id });
        }}
      />

      {/* Logout Loading Overlay */}
      {isLoggingOut && (
        <Modal
          visible={isLoggingOut}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {}} // Prevent closing during logout
        >
          <View style={styles.logoutLoadingOverlay}>
            <View style={styles.logoutLoadingContainer}>
              <ActivityIndicator size="large" color="#05BCD3" />
              <Text style={styles.logoutLoadingText}>Logging out...</Text>
            </View>
          </View>
        </Modal>
      )}

    </Container>
    </ChatErrorBoundary>
  );

  // On native, wrap in a View with the dark background so it extends below the safe area
  if (Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
        {content}
      </View>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#212121',
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' && {
      position: 'fixed' as any,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }),
  },
  contentAreaWrapper: {
    flex: 1,
    backgroundColor: '#212121', // Dark background visible around content area
  },
  contentArea: {
    flex: 1,
    backgroundColor: '#FAFAFA',
    overflow: 'hidden',
  },
  contentInner: {
    flex: 1,
    paddingTop: 0,
    paddingBottom: 32,
  },
  searchBarContainer: {
    paddingHorizontal: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D5D7DA',
    borderRadius: 32,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
  },
  searchIcon: {
    marginRight: 0,
  },
  searchPlaceholder: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 18,
    color: '#A7B8C2',
  },
  header: {
    backgroundColor: '#212121',
    // The notch/status-bar space (~44px in the Figma frame) is handled by the
    // SafeAreaView top edge above; here we set comfortable in-header spacing
    // and a taller min-height per the new header spec (min-height 120).
    paddingTop: Platform.OS === 'web' ? 44 : 12,
    paddingBottom: 20,
    paddingHorizontal: 16,
    minHeight: Platform.OS === 'web' ? 120 : 84,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
  },
  headerGradientBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerAvatarBorder: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 0,
  },
  headerTitleContainer: {
    flexDirection: 'column' as const,
    justifyContent: 'center',
  },
  headerTitleMain: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat-Bold',
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    lineHeight: 24,
  },
  headerTitleSub: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter-Regular',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#FFFFFF',
    lineHeight: 18,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 40,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
    gap: 11,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  filterButtonActive: {
    backgroundColor: '#212121',
    borderColor: '#212121',
  },
  filterButtonInactive: {
    backgroundColor: '#F7F7F7',
    borderColor: '#EEEEEE',
  },
  filterButtonText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
    color: '#333333',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
  },
  filterDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  conversationsList: {
    flex: 1,
  },
  conversationsListContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 120, // Space for Swelly card at bottom
    gap: 0,
  },
  loadMoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  loadMoreText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 13,
    fontWeight: '400',
    color: '#A0A0A0',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  conversationContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 16,
  },
  avatarContainer: {
    position: 'relative',
    backgroundColor: 'gray',
    borderRadius: 36,
    width: 52,
    height: 52,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 40,
  },
  groupAvatar: {
    backgroundColor: '#5E6B73',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholder: {
    backgroundColor: '#E4E4E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    fontWeight: 'bold',
    color: '#7B7B7B',
  },
  textContainer: {
    flex: 1,
    flexShrink: 1,
    gap: 8,
  },
  conversationName: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter-SemiBold',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    color: '#333333',
  },
  lastMessage: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 15,
    color: '#A0A0A0',
    textAlign: 'left' ,
  },
  imageMessagePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  imageIcon: {
    marginRight: 4,
  },
  timeContainer: {
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 50,
    justifyContent: 'flex-start',
    flexShrink: 0,
  },
  timeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
    color: 'rgba(60, 60, 60, 0.5)',
    textAlign: 'right',
    // CSS variable applied via inline style on web
  },
  unreadBadge: {
    borderRadius: 16,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeDefault: {
    backgroundColor: '#05BCD3',
  },
  unreadBadgeText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 20,
    color: '#FFFFFF',
    // CSS variable applied via inline style on web
  },
  swellyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: Platform.OS === 'web'
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(250, 250, 250, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#B72DF2',
    minHeight: 104,
    width: '90%', 
    shadowColor: '#B72DF2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.24,
    shadowRadius: 14,
    elevation: 5,
    ...(Platform.OS === 'web' && {
      backdropFilter: 'blur(20px) saturate(195%)',
      WebkitBackdropFilter: 'blur(20px) saturate(195%)',
    } as any),
  },
  swellyContainerDev: {
    marginTop: 8,
    opacity: 0.8,
    borderColor: '#FFA500',
  },
  swellyAvatarContainer: {
    width: 62,
    height: 68,
    aspectRatio: 62 / 68,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    zIndex: 1,
  },
  swellyAvatarRing: {
    width: '100%',
    height: '100%',
    borderRadius: 31,
    overflow: 'visible', // Changed to 'visible' to show full ellipse border
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1, // Ensure ring is above other elements
  },
  swellyEllipseBackground: {
    position: 'absolute',
    // Make it slightly larger to ensure border is fully visible
    width: '105%', // Slightly larger to show full border
    height: '105%', // Slightly larger to show full border
    top: '-2.5%', // Offset to center the larger size
    left: '-2.5%', // Offset to center the larger size
    zIndex: 0, // Behind the avatar image
    alignItems: 'center',
    justifyContent: 'center',
  },
  swellyEllipseForeground: {
    position: 'absolute',
    // Same geometry as swellyEllipseBackground so the stroke aligns perfectly
    // with the gray ellipse behind. Rendered on top (zIndex 2) so the purple
    // ring sits in front of the avatar image — bottom of image goes behind
    // the line, while the top still pokes above it.
    width: '105%',
    height: '105%',
    top: '-2.5%',
    left: '-2.5%',
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swellyAvatarImageContainer: {
    position: 'absolute',
    // Container for the avatar image, centered horizontally
    // Making it bigger: 75px width and height
    // Ellipse is 62px wide, so center 75px: (62 - 75) / 2 = -6.5px
    width: 75,
    height: 75,
    left: -6.1,
    top: -7,
    overflow: 'hidden',
    zIndex: 1,
  },
  swellyAvatarImage: {
    // Image dimensions: 75px width and height
    width: 75,
    height: 75,
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
      backgroundRepeat: 'no-repeat' as any,
    }),
  },
  swellyTextContainer: {
    flex: 1,
    gap: 0,
  },
  swellyName: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat-Bold',
    fontSize: 20,
    fontWeight: 'bold',
    lineHeight: 26,
    color: '#333333',
    marginBottom: 0,
  },
  swellyLastMessage: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    color: '#333333',
    // CSS variable applied via inline style on web
  },
  swellyTimeContainer: {
    alignItems: 'flex-end',
    gap: 10,
    width: 37,
    justifyContent: 'flex-start',
  },
  swellyTimeText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 20,
    color: '#B72DF2',
    textAlign: 'right',
    // CSS variable applied via inline style on web
  },
  swellyUnreadBadge: {
    backgroundColor: '#B72DF2',
    borderRadius: 16,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: Platform.OS === 'web' ? 120 : 80,
    paddingRight: 16,
  },
  menuContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    minWidth: 203,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
    overflow: 'hidden',
    zIndex: 1000,
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
    gap: 8,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#D5D7DA',
    marginHorizontal: 0,
  },
  menuItemIcon: {
    width: 20,
    height: 20,
  },
  menuItemText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    fontWeight: '400',
    color: '#222B30',
    lineHeight: 18,
    flex: 1,
  },
  menuItemDisabled: {
    opacity: 0.5,
  },
  logoutLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000,
    elevation: 10000,
  },
  logoutLoadingContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    minWidth: 300,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 12,
  },
  logoutLoadingText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '500',
    color: '#222B30',
    marginTop: 16,
    textAlign: 'center',
  },
  // Welcome conversation styles - matching Figma design
  welcomeAvatarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 0,
    paddingRight: 16,
    position: 'relative',
  },
  welcomeAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
  welcomeAvatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
    }),
  },
  welcomeAvatarBack: {
    marginRight: -16, // Negative margin for overlap
    zIndex: 1,
  },
  welcomeAvatarFront: {
    marginRight: -16, // Negative margin for overlap (or 0 if last)
    zIndex: 2,
  },
  welcomeTimeText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
    color: '#05BCD3',
    textAlign: 'right',
  },
  welcomeUnreadBadge: {
    borderRadius: 16,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#05BCD3',
  },
  welcomeInstructionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 10,
  },
  welcomeInstructionText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 19,
    color: '#333333',
    textAlign: 'center',
  },
  welcomeArrowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    // Purple glow will be applied via shadowColor in animated style
  },
});

