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
  const { resetOnboarding } = useOnboarding();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [userName, setUserName] = useState('User');
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<{
    id?: string; // Optional: undefined for pending conversations
    otherUserId: string; // Required: the user ID we're messaging
    otherUserName: string;
    otherUserAvatar: string | null;
    isDirect?: boolean;
  } | null>(null);

  useEffect(() => {
    loadConversations();
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
      const user = await supabaseAuthService.getCurrentUser();
      if (user) {
        setUserName(user.nickname || user.email.split('@')[0]);
        if (user.photo) {
          setUserAvatar(user.photo);
        }
      }
    } catch (error) {
      console.error('Error loading user info:', error);
    }
  };

  const loadConversations = async () => {
    try {
      setLoading(true);
      const convos = await messagingService.getConversations();
      setConversations(convos);
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredConversations = () => {
    if (filter === 'all') return conversations;
    
    return conversations.filter(conv => {
      const type = conv.metadata?.type;
      if (filter === 'advisor') return type === 'advisor';
      if (filter === 'seeker') return type === 'seeker';
      return true;
    });
  };

  const getAdvisorCount = () => {
    return conversations.filter(c => c.metadata?.type === 'advisor' && (c.unread_count || 0) > 0).length;
  };

  const getSeekerCount = () => {
    return conversations.filter(c => c.metadata?.type === 'seeker' && (c.unread_count || 0) > 0).length;
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
    iconName?: string,
    iconColor?: string,
    badgeColor?: string
  ) => {
    const isActive = filter === type;

    return (
      <TouchableOpacity
        style={[
          styles.filterButton,
          isActive ? styles.filterButtonActive : styles.filterButtonInactive,
        ]}
        onPress={() => setFilter(type)}
      >
        {iconName && type !== 'all' && (
          <Ionicons 
            name={iconName as any} 
            size={24} 
            color={iconColor || '#333'} 
            style={iconName === 'send' && type === 'seeker' ? { transform: [{ rotate: '180deg' }] } : undefined}
          />
        )}
        <Text style={styles.filterButtonText}>{label}</Text>
        {count !== undefined && count > 0 && (
          <View style={[styles.filterBadge, { backgroundColor: badgeColor || '#BCAC99' }]}>
            <Text style={styles.filterBadgeText}>{count}</Text>
            <View
              style={[
                styles.filterBadgeDot,
                { backgroundColor: '#FF5367' },
              ]}
            />
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

    return (
      <TouchableOpacity
        key={conv.id}
        style={styles.conversationItem}
        onPress={() => handleConversationPress(conv)}
      >
        <View style={styles.conversationContent}>
          {/* Avatar with type badges */}
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
            
            {/* Type badges */}
            {conversationType === 'advisor' && (
              <View style={[styles.typeBadge, styles.typeBadgeAdvisor]}>
                <Ionicons name="send" size={10} color="#FFFFFF" />
              </View>
            )}
            {conversationType === 'seeker' && (
              <View style={[styles.typeBadge, styles.typeBadgeSeeker]}>
                <Ionicons name="send" size={10} color="#FFFFFF" style={{ transform: [{ rotate: '180deg' }] }} />
              </View>
            )}
            {conversationType === 'both' && (
              <>
                <View style={[styles.typeBadge, styles.typeBadgeAdvisor]}>
                  <Ionicons name="send" size={10} color="#FFFFFF" />
                </View>
                <View style={[styles.typeBadge, styles.typeBadgeSeeker, { left: 36 }]}>
                  <Ionicons name="send" size={10} color="#FFFFFF" style={{ transform: [{ rotate: '180deg' }] }} />
                </View>
              </>
            )}
          </View>

          {/* Text content */}
          <View style={styles.textContainer}>
            <Text style={styles.conversationName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.lastMessage} numberOfLines={1}>
              {lastMessageText}
            </Text>
          </View>
        </View>

        {/* Time and unread badge */}
        <View style={styles.timeContainer}>
          {lastMessageTime ? (
            <Text style={styles.timeText}>{lastMessageTime}</Text>
          ) : null}
          {unreadCount > 0 ? (
            <View style={[
              styles.unreadBadge,
              conversationType === 'advisor' ? styles.unreadBadgeAdvisor :
              conversationType === 'seeker' ? styles.unreadBadgeSeeker :
              styles.unreadBadgeDefault
            ]}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
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
          {/* Swelly avatar with border */}
          <View style={styles.swellyAvatarContainer}>
            <View style={styles.swellyAvatarBorder}>
              <Image
                source={{ uri: getImageUrl('/Swelly avatar.png') }}
                style={styles.swellyAvatar}
                resizeMode="cover"
              />
            </View>
          </View>

          {/* Text content */}
          <View style={styles.swellyTextContainer}>
            <Text style={styles.swellyName}>Swelly</Text>
            <Text style={styles.swellyLastMessage} numberOfLines={1}>
              Did you see the new exhibit at the MAM?
            </Text>
          </View>
        </View>

        {/* Time and unread badge */}
        <View style={styles.swellyTimeContainer}>
          <Text style={styles.swellyTimeText}>15:20</Text>
          <View style={styles.swellyUnreadBadge}>
            <Text style={styles.unreadBadgeText}>2</Text>
          </View>
        </View>
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
            {renderFilterButton('advisor', 'Get Adv', getAdvisorCount(), 'send', '#333', '#BCAC99')}
            {renderFilterButton('seeker', 'Give Adv', getSeekerCount(), 'send', '#333', '#05BCD3')}
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
    paddingBottom: 8,
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
    paddingTop: Platform.OS === 'web' ? 62 : 62,
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
    lineHeight: 24,
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
    height: 36,
    borderWidth: 1,
    gap: 10,
    minWidth: 60,
  },
  filterButtonActive: {
    backgroundColor: '#EEEEEE',
    borderColor: '#E4E4E4',
  },
  filterButtonInactive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E4E4E4',
  },
  filterButtonText: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
    color: '#000000',
  },
  filterBadge: {
    backgroundColor: '#E4E4E4',
    borderRadius: 2,
    paddingHorizontal: 2,
    paddingVertical: 2,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterBadgeText: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 9,
    color: '#7B7B7B',
  },
  filterBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    position: 'absolute',
    top: -2,
    left: 8,
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
  typeBadge: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    top: 35,
    left: 36,
    padding: 2,
  },
  typeBadgeAdvisor: {
    backgroundColor: '#05BCD3',
  },
  typeBadgeSeeker: {
    backgroundColor: '#BCAC99',
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
  unreadBadgeAdvisor: {
    backgroundColor: '#05BCD3',
  },
  unreadBadgeSeeker: {
    backgroundColor: '#BCAC99',
  },
  unreadBadgeText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 20,
    color: '#FFFFFF',
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
    backgroundColor: '#FFFFFF',
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
  },
  swellyAvatarContainer: {
    width: 62,
    height: 68,
    marginRight: 8,
    position: 'relative',
  },
  swellyAvatarBorder: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: '#B72DF2',
    overflow: 'hidden',
    backgroundColor: '#D9D9D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swellyAvatar: {
    width: '100%',
    height: '100%',
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

