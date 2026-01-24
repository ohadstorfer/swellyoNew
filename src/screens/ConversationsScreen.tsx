import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Modal,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, G, ClipPath, Defs, Rect } from 'react-native-svg';
import { messagingService, Conversation } from '../services/messaging/messagingService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { authService } from '../services/auth/authService';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { UserSearchModal } from '../components/UserSearchModal';
import { DirectMessageScreen } from './DirectMessageScreen';
import { SwellyShaperScreen } from './SwellyShaperScreen';
import { SwellyoTeamWelcome } from './SwellyoTeamWelcome';
import { ProfileImage } from '../components/ProfileImage';
import { ConversationListSkeleton, HeaderSkeleton } from '../components/skeletons';
import { SKELETON_DELAY_MS } from '../constants/loading';
import { loadCachedUserProfile, saveCachedUserProfile } from '../utils/userProfileCache';

interface ConversationsScreenProps {
  onConversationPress?: (conversationId: string) => void;
  onSwellyPress?: () => void;
  onProfilePress?: () => void;
  onViewUserProfile?: (userId: string) => void;
  onSwellyShaperViewProfile?: () => void; // Callback for viewing profile from Swelly Shaper
}

type FilterType = 'all' | 'advisor' | 'seeker';

// Cache helper functions are now imported from '../utils/userProfileCache'

// Three Dots Menu Icon Component
const ThreeDotsIcon: React.FC = () => {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
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

export default function ConversationsScreen({
  onConversationPress,
  onSwellyPress,
  onProfilePress,
  onViewUserProfile,
  onSwellyShaperViewProfile,
}: ConversationsScreenProps) {
  const { resetOnboarding, setCurrentStep, user: contextUser } = useOnboarding();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false); // Start as false to show conversations immediately
  const [conversationsLoaded, setConversationsLoaded] = useState(false); // Track if conversations have been loaded
  const [showSkeletons, setShowSkeletons] = useState(false); // Delayed skeleton display to avoid flicker
  const [userInfoLoading, setUserInfoLoading] = useState(false); // Track user info loading state
  const [filter, setFilter] = useState<FilterType>('all');
  // Initialize with cached user data from context for immediate display
  const [userName, setUserName] = useState(() => {
    if (contextUser?.nickname) return contextUser.nickname;
    if (contextUser?.email) return contextUser.email.split('@')[0];
    return 'User';
  });
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    return contextUser?.id?.toString() || null;
  });
  const [showMenu, setShowMenu] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<{
    id?: string; // Optional: undefined for pending conversations
    otherUserId: string; // Required: the user ID we're messaging
    otherUserName: string;
    otherUserAvatar: string | null;
    isDirect?: boolean;
  } | null>(null);
  const [showSwellyShaper, setShowSwellyShaper] = useState(false);
  const [showSwellyoTeamWelcome, setShowSwellyoTeamWelcome] = useState(false);

  // Update user info when context user changes (immediate sync)
  useEffect(() => {
    if (contextUser) {
      const newName = contextUser.nickname || (contextUser.email ? contextUser.email.split('@')[0] : 'User');
      setUserName(newName);
      const userId = contextUser.id?.toString() || null;
      setCurrentUserId(userId);
    }
  }, [contextUser]);

  useEffect(() => {
    loadConversations();
    
    // Load from cache first, then fetch if needed
    const initializeUserInfo = async () => {
      // Try to load from cache
      const cachedProfile = await loadCachedUserProfile();
      if (cachedProfile) {
        // Use cached data immediately
        setUserName(cachedProfile.name);
        setUserAvatar(cachedProfile.photo);
        if (cachedProfile.userId) {
          setCurrentUserId(cachedProfile.userId);
        }
        // Don't fetch from server if we have valid cache
        return;
      }
      
      // No cache or cache invalid - fetch from server
      await loadUserInfo();
    };
    
    initializeUserInfo();

    // Subscribe to conversation updates
    const unsubscribe = messagingService.subscribeToConversations(() => {
      loadConversations();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const loadUserInfo = async () => {
    // Only show skeleton if we don't have cached data
    const hasCachedData = contextUser?.nickname || contextUser?.email || userAvatar;
    if (!hasCachedData) {
      setUserInfoLoading(true);
    }
    
    try {
      // Fetch from server
      const user = await supabaseAuthService.getCurrentUser();
      if (user) {
        // Extract user data
        const newName = user.nickname || user.email.split('@')[0];
        const newPhoto = user.photo || null;
        const newUserId = user.id || null;
        
        // Update state
        if (newName !== userName) {
          setUserName(newName);
        }
        if (newUserId !== currentUserId) {
          setCurrentUserId(newUserId);
        }
        if (newPhoto !== userAvatar) {
          setUserAvatar(newPhoto);
        }
        
        // Save to cache for future visits
        if (newUserId) {
          await saveCachedUserProfile(newName, newPhoto, newUserId);
        }
      }
    } catch (error) {
      console.error('Error loading user info:', error);
      // Don't clear the cached data on error - keep showing what we have
    } finally {
      setUserInfoLoading(false);
    }
  };

  const loadConversations = async () => {
    try {
      // Delay showing skeletons to avoid flicker for fast loads
      const skeletonTimeout = setTimeout(() => {
        setShowSkeletons(true);
      }, SKELETON_DELAY_MS);
      
      setLoading(true);
      const convos = await messagingService.getConversations();
      
      clearTimeout(skeletonTimeout);
      setConversations(convos);
      setLoading(false);
      setShowSkeletons(false);
      setConversationsLoaded(true); // Mark as loaded after successful fetch
    } catch (error) {
      console.error('Error loading conversations:', error);
      setLoading(false);
      setShowSkeletons(false);
      setConversationsLoaded(true); // Mark as loaded even on error
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
        rendered_body: null,
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
        adv_role: null,
        joined_at: now.toISOString(),
        preferences: {},
        name: 'Swellyo Team',
        profile_image_url: undefined,
      },
      members: [],
    };
  };

  const getFilteredConversations = () => {
    let filtered = conversations;
    
    if (filter !== 'all' && currentUserId) {
      filtered = conversations.filter(conv => {
        // Skip welcome conversation for filters
        if (conv.metadata?.isWelcome) return false;
        
        // Find the current user's member record in this conversation
        const currentUserMember = conv.members?.find(member => member.user_id === currentUserId);
        
        if (!currentUserMember) return false;
        
        // "Get Adv" (advisor filter) = user is adv_seeker (seeking advice)
        if (filter === 'advisor') {
          return currentUserMember.adv_role === 'adv_seeker';
        }
        
        // "Give Adv" (seeker filter) = user is adv_giver (giving advice)
        if (filter === 'seeker') {
          return currentUserMember.adv_role === 'adv_giver';
        }
        
        return true;
      });
    }
    
    // Add welcome conversation only if:
    // 1. Conversations have been loaded
    // 2. No real conversations exist
    // 3. Filter is 'all' (welcome message doesn't apply to filtered views)
    if (conversationsLoaded && filtered.length === 0 && filter === 'all') {
      return [createWelcomeConversation()];
    }
    
    return filtered;
  };

  const getAdvisorCount = () => {
    if (!currentUserId) return 0;
    return conversations.filter(c => {
      const currentUserMember = c.members?.find(member => member.user_id === currentUserId);
      return currentUserMember?.adv_role === 'adv_seeker' && (c.unread_count || 0) > 0;
    }).length;
  };

  const getSeekerCount = () => {
    if (!currentUserId) return 0;
    return conversations.filter(c => {
      const currentUserMember = c.members?.find(member => member.user_id === currentUserId);
      return currentUserMember?.adv_role === 'adv_giver' && (c.unread_count || 0) > 0;
    }).length;
  };

  // Get total conversation counts (not just unread)
  const getTotalAdvisorCount = () => {
    if (!currentUserId) return 0;
    return conversations.filter(c => {
      const currentUserMember = c.members?.find(member => member.user_id === currentUserId);
      return currentUserMember?.adv_role === 'adv_seeker';
    }).length;
  };

  const getTotalSeekerCount = () => {
    if (!currentUserId) return 0;
    return conversations.filter(c => {
      const currentUserMember = c.members?.find(member => member.user_id === currentUserId);
      return currentUserMember?.adv_role === 'adv_giver';
    }).length;
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const getConversationType = (conv: Conversation): 'advisor' | 'seeker' | 'both' | null => {
    return conv.metadata?.type || null;
  };

  const handleUserSelect = async (userId: string) => {
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
    } catch (error) {
      console.error('Error starting conversation:', error);
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const handleBackFromChat = () => {
    setSelectedConversation(null);
    loadConversations();
  };

  const handleLogout = async () => {
    console.log('handleLogout called');
    try {
      setShowMenu(false);
      
      // Perform logout directly (for testing - can add confirmation back later)
      console.log('Starting logout process...');
      try {
        // Sign out from auth service
        console.log('Calling authService.signOut()...');
        await authService.signOut();
        console.log('Auth service sign out successful');
        
        // Reset onboarding state
        console.log('Calling resetOnboarding()...');
        await resetOnboarding();
        console.log('Reset onboarding successful');
        
        // Explicitly set step to -1 to go to WelcomeScreen (not OnboardingWelcomeScreen)
        setCurrentStep(-1);
        console.log('Navigated to WelcomeScreen');
        
        console.log('User logged out successfully');
      } catch (error) {
        console.error('Error during logout:', error);
        Alert.alert('Error', `Failed to logout: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      // Uncomment below to add confirmation dialog back:
      /*
      Alert.alert(
        'Logout',
        'Are you sure you want to logout?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => console.log('Logout cancelled'),
          },
          {
            text: 'Logout',
            style: 'destructive',
            onPress: async () => {
              console.log('Logout confirmed, starting logout process...');
              try {
                await authService.signOut();
                await resetOnboarding();
                console.log('User logged out successfully');
              } catch (error) {
                console.error('Error during logout:', error);
                Alert.alert('Error', `Failed to logout: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            },
          },
        ],
        { cancelable: true }
      );
      */
    } catch (error) {
      console.error('Error in handleLogout:', error);
    }
  };

  const renderFilterButton = (
    type: FilterType,
    label: string,
    count?: number,
    iconPath?: string,
    iconColor?: string,
    badgeColor?: string
  ) => {
    const isActive = filter === type;

    // Get icon path based on filter type
    let iconUrl: string | null = null;
    if (type === 'advisor') {
      iconUrl = getImageUrl('/Get adv icon.svg');
    } else if (type === 'seeker') {
      iconUrl = getImageUrl('/Give adv icon.svg');
    }

    return (
      <TouchableOpacity
        style={[
          styles.filterButton,
          isActive ? styles.filterButtonActive : styles.filterButtonInactive,
        ]}
        onPress={() => setFilter(type)}
      >
        {iconUrl && type !== 'all' && (
          <Image
            source={{ uri: iconUrl }}
            style={styles.filterIcon}
            resizeMode="contain"
          />
        )}
        <Text style={[
          styles.filterButtonText,
          Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
        ]}>{label}</Text>
        {count !== undefined && count > 0 && (
          <View style={[
            styles.filterBadge,
            { 
              backgroundColor: Platform.OS === 'web' && badgeColor
                ? (type === 'advisor' 
                    ? 'var(--Colors-Secondary-200, #BCAC99)'
                    : 'var(--Fill-secondary, #05BCD3)')
                : badgeColor || '#BCAC99'
            }
          ]}>
            <Text style={[
              styles.filterBadgeText,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]}>{count}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const handleConversationPress = (conv: Conversation) => {
    // Handle both direct messages and group chats
    if (conv.is_direct && conv.other_user) {
      // Direct message (2 users)
      setSelectedConversation({
        id: conv.id,
        otherUserId: conv.other_user.user_id || '',
        otherUserName: conv.other_user.name || 'User',
        otherUserAvatar: conv.other_user.profile_image_url || null,
        isDirect: true,
      });
    } else if (!conv.is_direct) {
      // Group chat - use title or fallback
      setSelectedConversation({
        id: conv.id,
        otherUserId: '', // Group chats don't have a single user ID
        otherUserName: conv.title || 'Group Chat',
        otherUserAvatar: null, // Group chats don't have a single avatar
        isDirect: false,
      });
    }
    // Also call the callback if provided
    onConversationPress?.(conv.id);
  };

  const renderWelcomeConversation = (conv: Conversation) => {
    const lastMessageText = conv.last_message?.body || '';
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
                source={{ uri: getImageUrl('/User Avatar 1.png') }}
                style={styles.welcomeAvatarImage}
                resizeMode="cover"
              />
            </View>
            {/* Second avatar - in front with negative margin for overlap */}
            <View style={[styles.welcomeAvatar, styles.welcomeAvatarFront]}>
              <Image
                source={{ uri: getImageUrl('/User Avatar 2.png') }}
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
            <Text style={[
              styles.lastMessage,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]} numberOfLines={1}>
              {lastMessageText}
            </Text>
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

    const conversationType = getConversationType(conv);
    const displayName = conv.is_direct
      ? conv.other_user?.name || 'Unknown User'
      : conv.title || 'Group Chat';
    const avatarUrl = conv.is_direct ? conv.other_user?.profile_image_url : null;
    const lastMessageText = conv.last_message?.body || '';
    const lastMessageTime = conv.last_message ? formatTime(conv.last_message.created_at) : '';
    const unreadCount = conv.unread_count || 0;

    // Get current user's adv_role in this conversation
    const currentUserMember = currentUserId 
      ? conv.members?.find(member => member.user_id === currentUserId)
      : null;
    const userAdvRole = currentUserMember?.adv_role;

    return (
      <TouchableOpacity
        key={conv.id}
        style={styles.conversationItem}
        onPress={() => handleConversationPress(conv)}
      >
        <View style={styles.conversationContent}>
          {/* Avatar with adv role icon */}
          <View style={styles.avatarContainer}>
            <ProfileImage
              imageUrl={avatarUrl}
              name={displayName}
              style={styles.avatar}
              showLoadingIndicator={false}
            />
            
            {/* Adv role icon badge */}
            {userAdvRole === 'adv_seeker' && (
              <View style={styles.advRoleBadgeGetAdv}>
                <View style={{ width: 10, height: 10, justifyContent: 'center', alignItems: 'center' }}>
                  <Svg width={10} height={10} viewBox="0 0 10 10" fill="none">
                    <G clipPath="url(#clip0_5183_5404)">
                      <Path
                        d="M3.74967 7.50004L0.833008 9.16671V2.50004L3.74967 0.833374M3.74967 7.50004L6.66634 9.16671M3.74967 7.50004V0.833374M6.66634 9.16671L9.16634 7.50004V0.833374L6.66634 2.50004M6.66634 9.16671V2.50004M6.66634 2.50004L3.74967 0.833374"
                        stroke="#FFFFFF"
                        strokeWidth="0.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </G>
                    <Defs>
                      <ClipPath id="clip0_5183_5404">
                        <Rect width={10} height={10} fill="white" />
                      </ClipPath>
                    </Defs>
                  </Svg>
                </View>
              </View>
            )}
            {userAdvRole === 'adv_giver' && (
              <View style={styles.advRoleBadgeGiveAdv}>
                <View style={{ width: 10, height: 10, justifyContent: 'center', alignItems: 'center' }}>
                  <Svg width={10} height={10} viewBox="0 0 10 10" fill="none">
                    <Path
                      d="M5.83366 5.19383C5.31969 5.49089 4.68102 5.49089 4.16704 5.19383M6.32181 6.17847C5.67094 5.5276 5.67094 4.47232 6.32181 3.82145C6.97269 3.17057 8.02796 3.17057 8.67884 3.82145C9.32971 4.47232 9.32971 5.5276 8.67884 6.17847C8.02797 6.82934 6.97269 6.82934 6.32181 6.17847ZM1.32181 6.17847C0.670941 5.5276 0.670941 4.47232 1.32181 3.82145C1.97269 3.17057 3.02796 3.17057 3.67884 3.82145C4.32971 4.47232 4.32971 5.52759 3.67884 6.17847C3.02797 6.82934 1.97269 6.82934 1.32181 6.17847Z"
                      stroke="#FFFFFF"
                      strokeWidth="0.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>
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
            <Text style={[
              styles.lastMessage,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]} numberOfLines={1}>
              {lastMessageText}
            </Text>
          </View>
        </View>

        {/* Time and unread badge */}
        <View style={styles.timeContainer}>
          {lastMessageTime ? (
            <Text style={[
              styles.timeText,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]}>{lastMessageTime}</Text>
          ) : null}
          {unreadCount > 0 ? (
            <View style={[
              styles.unreadBadge,
              userAdvRole === 'adv_giver' ? styles.unreadBadgeGiveAdv :
              userAdvRole === 'adv_seeker' ? styles.unreadBadgeGetAdv :
              styles.unreadBadgeDefault
            ]}>
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

  const renderSwellyConversation = () => {
    return (
      <TouchableOpacity
        style={styles.swellyContainer}
        onPress={onSwellyPress}
      >
        <View style={styles.conversationContent}>
          {/* Swelly avatar with ellipse design - matching ChatScreen */}
          <View style={styles.swellyAvatarContainer}>
            <View style={styles.swellyAvatarRing}>
              <Image
                source={{ uri: getImageUrl('/Ellipse 11.svg') }}
                style={styles.swellyEllipseBackground}
                resizeMode="contain"
              />
              <View style={styles.swellyAvatarImageContainer}>
                <Image
                  source={{ uri: getImageUrl('/Swelly avatar onboarding.png') }}
                  style={styles.swellyAvatarImage}
                  resizeMode="cover"
                />
              </View>
            </View>
          </View>

          {/* Text content */}
          <View style={styles.swellyTextContainer}>
            <Text style={styles.swellyName}>Swelly</Text>
            <Text style={[
              styles.swellyLastMessage,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]} numberOfLines={1}>
              Yo! Let's connect!
            </Text>
          </View>
        </View>

        {/* Time and unread badge */}
        {/* <View style={styles.swellyTimeContainer}>
          <Text style={[
            styles.swellyTimeText,
            Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
          ]}>15:20</Text>
          <View style={styles.swellyUnreadBadge}>
            <Text style={[
              styles.unreadBadgeText,
              Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
            ]}>2</Text>
          </View>
        </View> */}
      </TouchableOpacity>
    );
  };

  const filteredConversations = getFilteredConversations();

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

  // Early return for DirectMessageScreen - must come AFTER all hooks
  if (selectedConversation) {
    return (
      <DirectMessageScreen
        conversationId={selectedConversation.id} // May be undefined for pending conversations
        otherUserId={selectedConversation.otherUserId}
        otherUserName={selectedConversation.otherUserName}
        otherUserAvatar={selectedConversation.otherUserAvatar}
        isDirect={selectedConversation.isDirect ?? true}
        onBack={handleBackFromChat}
        onViewProfile={onViewUserProfile}
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

  return (
    <View style={styles.container}>
      {/* Header - Dark background */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.headerLeft}
          onPress={onProfilePress}
          activeOpacity={0.7}
        >
          {userInfoLoading && !contextUser?.nickname && !contextUser?.email ? (
            <HeaderSkeleton />
          ) : (
            <>
              <ProfileImage
                imageUrl={userAvatar}
                name={userName}
                style={styles.headerAvatar}
                showLoadingIndicator={false}
              />
              <Text style={styles.headerTitle}>Hello {userName}</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.headerButton}
          onPress={() => {
            console.log('Menu button pressed, showing menu');
            setShowMenu(true);
          }}
        >
          <ThreeDotsIcon />
        </TouchableOpacity>
        
        {/* Gradient border at bottom */}
        <LinearGradient
          colors={['#05BCD3', '#DBCDBC']}
          locations={[0, 0.7]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.headerGradientBorder}
        />
      </View>

      {/* Content area with light background and rounded corners - dark background visible around it */}
      <View style={styles.contentAreaWrapper}>
        <View style={styles.contentArea}>
        <View style={styles.contentInner}>
          {/* Search Bar */}
          <View style={styles.searchBarContainer}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={24} color="#7B7B7B" style={styles.searchIcon} />
              <Text style={styles.searchPlaceholder}>Search</Text>
            </View>
          </View>

          {/* Filter buttons */}
          <View style={styles.filterContainer}>
            {renderFilterButton('all', 'All')}
            {renderFilterButton('advisor', 'Get Adv', getTotalAdvisorCount(), undefined, '#333', '#BCAC99')}
            {renderFilterButton('seeker', 'Give Adv', getTotalSeekerCount(), undefined, '#333', '#05BCD3')}
          </View>

          {/* Conversations list */}
          <ScrollView
            style={styles.conversationsList}
            contentContainerStyle={styles.conversationsListContent}
            showsVerticalScrollIndicator={false}
          >
            {loading && showSkeletons ? (
              <ConversationListSkeleton count={5} />
            ) : (
              <>
                {filteredConversations.map(renderConversationItem)}
                
                {/* Welcome message instructional text - only show when welcome conversation is displayed */}
                {conversationsLoaded && conversations.length === 0 && filter === 'all' && (
                  <View style={styles.welcomeInstructionContainer}>
                    <Text style={[
                      styles.welcomeInstructionText,
                      Platform.OS === 'web' && { fontFamily: 'var(--Family-Body, Inter), sans-serif' } as any
                    ]}>
                      Let Swelly know where you are headed{'\n'}
                      for the next surf adventure!{'\n'}
                      {'\n'}
                      Get connected to travelers who have{'\n'}
                      deeper knowledge about the destination.{'\n'}
                      {'\n'}
                      Give and receive advice!
                    </Text>
                    <View style={styles.welcomeArrowContainer}>
                      <Ionicons name="arrow-down" size={24} color="#7B7B7B" />
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
      </View>

      {/* Swelly conversation card - positioned at bottom */}
      <View style={styles.swellyCardWrapper}>
        {renderSwellyConversation()}
      </View>

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
                {/* My Profile */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={(e) => {
                    e.stopPropagation();
                    console.log('My Profile menu item pressed');
                    setShowMenu(false);
                    if (onProfilePress) {
                      onProfilePress();
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="person-outline" size={20} color="#222B30" />
                  <Text style={styles.menuItemText}>My Profile</Text>
                </TouchableOpacity>

                {/* My Shaper */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={(e) => {
                    e.stopPropagation();
                    console.log('My Shaper menu item pressed');
                    setShowMenu(false);
                    setShowSwellyShaper(true);
                  }}
                  activeOpacity={0.7}
                >
                  <ShaperIcon />
                  <Text style={styles.menuItemText}>My Shaper</Text>
                </TouchableOpacity>

                {/* Swellyo Team Welcome - Testing */}
                {/* <TouchableOpacity
                  style={styles.menuItem}
                  onPress={(e) => {
                    e.stopPropagation();
                    console.log('Swellyo Team Welcome menu item pressed');
                    setShowMenu(false);
                    setShowSwellyoTeamWelcome(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chatbubbles-outline" size={20} color="#222B30" />
                  <Text style={styles.menuItemText}>Swellyo Team Welcome</Text>
                </TouchableOpacity> */}

                {/* Logout */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={(e) => {
                    e.stopPropagation();
                    console.log('Logout menu item pressed');
                    handleLogout();
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="arrow-forward-circle-outline" size={20} color="#222B30" />
                  <Text style={styles.menuItemText}>Logout</Text>
                </TouchableOpacity>
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
    </View>
  );
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
    paddingTop: 24,
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
    paddingTop: Platform.OS === 'web' ? 35 : 35,
    paddingBottom: 24,
    paddingHorizontal: 16,
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
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 0,
  },
  headerTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter-Bold',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    lineHeight: 28,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 48,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
    gap: 8,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 32,
    height: 46,
    borderWidth: 1,
    gap: 10,
  },
  filterButtonActive: {
    ...(Platform.OS === 'web' ? {
      backgroundColor: 'var(--Colors-Neutral-300, #EEE)',
      borderColor: 'var(--Colors-Neutral-400, #E4E4E4)',
    } : {
      backgroundColor: '#EEE',
      borderColor: '#E4E4E4',
    }),
  },
  filterButtonInactive: {
    ...(Platform.OS === 'web' ? {
      backgroundColor: 'var(--Surface-white, #FFF)',
      borderColor: 'var(--Colors-Neutral-400, #E4E4E4)',
    } : {
      backgroundColor: '#FFFFFF',
      borderColor: '#E4E4E4',
    }),
  },
  filterButtonText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
    color: '#000000',
  },
  filterIcon: {
    width: 24,
    height: 24,
  },
  filterBadge: {
    display: 'flex',
    width: 18,
    paddingVertical: 2,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    borderRadius: 999,
    // Background color is set inline via badgeColor prop
  },
  filterBadgeText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 14,
    color: '#FFF',
  },
  conversationsList: {
    flex: 1,
  },
  conversationsListContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 120, // Space for Swelly card at bottom
    gap: 0,
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
  advRoleBadgeGetAdv: {
    display: 'flex',
    width: 16,
    height: 16,
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    right: -2,
    bottom: 1,
    borderRadius: 12,
    borderWidth: 1,
    ...(Platform.OS === 'web' ? {
      borderColor: 'var(--Colors-Neutral-White, #FFF)',
      backgroundColor: 'var(--Colors-Secondary-200, #BCAC99)',
    } : {
      borderColor: '#FFF',
      backgroundColor: '#BCAC99',
    }),
  },
  advRoleBadgeGiveAdv: {
    display: 'flex',
    width: 16,
    height: 16,
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    right: -2,
    bottom: 1,
    borderRadius: 12,
    borderWidth: 1,
    ...(Platform.OS === 'web' ? {
      borderColor: 'var(--Colors-Neutral-White, #FFF)',
      backgroundColor: 'var(--Fill-secondary, #05BCD3)',
    } : {
      borderColor: '#FFF',
      backgroundColor: '#05BCD3',
    }),
  },
  advRoleIcon: {
    width: 10,
    height: 10,
    flexShrink: 0,
    aspectRatio: 1,
    alignSelf: 'center',
  },
  textContainer: {
    flex: 1,
    maxWidth: 246,
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
  },
  timeContainer: {
    alignItems: 'flex-end',
    gap: 4,
    width: 37,
    height: 39,
    justifyContent: 'flex-start',
  },
  timeText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
    color: '#212121',
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
  unreadBadgeGiveAdv: {
    ...(Platform.OS === 'web' ? {
      backgroundColor: 'var(--Colors-Primary-Solid-100, #05BCD3)',
    } : {
      backgroundColor: '#05BCD3',
    }),
  },
  unreadBadgeGetAdv: {
    ...(Platform.OS === 'web' ? {
      backgroundColor: 'var(--Colors-Secondary-200, #BCAC99)',
    } : {
      backgroundColor: '#BCAC99',
    }),
  },
  unreadBadgeText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 20,
    color: '#FFFFFF',
    // CSS variable applied via inline style on web
  },
  swellyCardWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 16,
    zIndex: 10,
  },
  swellyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: Platform.OS === 'web' 
      ? 'rgba(255, 255, 255, 0.08)' 
      : 'rgba(255, 255, 255, 0.06)',
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
    // resizeMode="contain" maintains the original aspect ratio
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any, // Maintain original aspect ratio
    }),
  },
  swellyAvatarImageContainer: {
    position: 'absolute',
    // Container for the avatar image, centered horizontally
    // Making it bigger: 75px width and height
    // Ellipse is 62px wide, so center 75px: (62 - 75) / 2 = -6.5px
    width: 75,
    height: 75,
    left: -6.1, 
    top: -5.1, 
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
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 22,
    color: '#333333',
    marginBottom: 0,
  },
  swellyLastMessage: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
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
    borderRadius: 12,
    minWidth: 200,
    shadowColor: '#000',
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
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
    lineHeight: 20,
    flex: 1,
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
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 18,
    color: '#7B7B7B',
    textAlign: 'center',
  },
  welcomeArrowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

