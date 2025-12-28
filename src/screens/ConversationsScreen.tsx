import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
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

interface ConversationsScreenProps {
  onConversationPress?: (conversationId: string) => void;
  onSwellyPress?: () => void;
  onProfilePress?: () => void;
  onViewUserProfile?: (userId: string) => void;
}

type FilterType = 'all' | 'advisor' | 'seeker';

export default function ConversationsScreen({
  onConversationPress,
  onSwellyPress,
  onProfilePress,
  onViewUserProfile,
}: ConversationsScreenProps) {
  const { resetOnboarding, user: contextUser } = useOnboarding();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false); // Start as false to show conversations immediately
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
    // Load user info in background (non-blocking)
    // UI already shows cached data from context, so this is just a refresh
    loadUserInfo();

    // Subscribe to conversation updates
    const unsubscribe = messagingService.subscribeToConversations(() => {
      loadConversations();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const loadUserInfo = async () => {
    try {
      // Update from server in the background (optimistic update)
      // The UI already shows cached data from context, so this is just a refresh
      const user = await supabaseAuthService.getCurrentUser();
      if (user) {
        // Only update if values have changed to avoid unnecessary re-renders
        const newName = user.nickname || user.email.split('@')[0];
        if (newName !== userName) {
          setUserName(newName);
        }
        if (user.id !== currentUserId) {
          setCurrentUserId(user.id);
        }
        if (user.photo !== userAvatar) {
          setUserAvatar(user.photo || null);
        }
      }
    } catch (error) {
      console.error('Error loading user info:', error);
      // Don't clear the cached data on error - keep showing what we have
    }
  };

  const loadConversations = async () => {
    try {
      // Don't set loading to true immediately - show cached conversations first
      // This allows names to appear immediately if we have cached data
      const convos = await messagingService.getConversations();
      setConversations(convos);
      setLoading(false);
    } catch (error) {
      console.error('Error loading conversations:', error);
      setLoading(false);
    }
  };

  const getFilteredConversations = () => {
    if (filter === 'all') return conversations;
    
    if (!currentUserId) return conversations;
    
    return conversations.filter(conv => {
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
        
        // Reset onboarding state (this will navigate to WelcomeScreen)
        console.log('Calling resetOnboarding()...');
        await resetOnboarding();
        console.log('Reset onboarding successful');
        
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
          type === 'all' && styles.filterButtonAll,
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

  const renderConversationItem = (conv: Conversation) => {
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
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarPlaceholderText}>
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            
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
          {userAvatar ? (
            <Image source={{ uri: userAvatar }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarPlaceholderText}>
                {userName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.headerTitle}>Hello {userName}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.headerButton}
          onPress={() => {
            console.log('Menu button pressed, showing menu');
            setShowMenu(true);
          }}
        >
          <Ionicons name="ellipsis-vertical" size={24} color="#7B7B7B" />
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
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#05BCD3" />
              </View>
            ) : (
              <>
                {filteredConversations.map(renderConversationItem)}
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
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={(e) => {
                    e.stopPropagation();
                    console.log('Logout menu item pressed');
                    handleLogout();
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="log-out-outline" size={20} color="#222B30" />
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
  filterButtonAll: {
    width: 60,
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
    width: 361,
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
    borderRadius: 16,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
    overflow: 'hidden',
    zIndex: 1000,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  menuItemText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '400',
    color: '#222B30',
    lineHeight: 15,
  },
});

