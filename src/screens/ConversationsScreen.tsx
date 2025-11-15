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
}

type FilterType = 'all' | 'advisor' | 'seeker';

export default function ConversationsScreen({
  onConversationPress,
  onSwellyPress,
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
    id: string;
    otherUserName: string;
    otherUserAvatar: string | null;
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
      // Create or get existing conversation with this user
      const conversation = await messagingService.createDirectConversation(userId);
      
      // Load the conversation details
      const conversations = await messagingService.getConversations();
      const foundConv = conversations.find(c => c.id === conversation.id);
      
      if (foundConv && foundConv.other_user) {
        setSelectedConversation({
          id: conversation.id,
          otherUserName: foundConv.other_user.name || 'User',
          otherUserAvatar: foundConv.other_user.profile_image_url || null,
        });
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
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
    iconColor?: string
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
        {iconName && (
          <Ionicons name={iconName as any} size={16} color={iconColor || '#05BCD3'} />
        )}
        <Text style={styles.filterButtonText}>{label}</Text>
        {count !== undefined && count > 0 && (
          <View style={styles.filterBadge}>
            <Text style={styles.filterBadgeText}>{count}</Text>
            <View
              style={[
                styles.filterBadgeDot,
                { backgroundColor: iconColor || '#05BCD3' },
              ]}
            />
          </View>
        )}
      </TouchableOpacity>
    );
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
        onPress={() => onConversationPress?.(conv.id)}
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
                <Ionicons name="send" size={8} color="#FFFFFF" />
              </View>
            )}
            {conversationType === 'seeker' && (
              <View style={[styles.typeBadge, styles.typeBadgeSeeker]}>
                <Ionicons name="send" size={8} color="#FFFFFF" style={{ transform: [{ rotate: '180deg' }] }} />
              </View>
            )}
            {conversationType === 'both' && (
              <>
                <View style={[styles.typeBadge, styles.typeBadgeAdvisor]}>
                  <Ionicons name="send" size={8} color="#FFFFFF" />
                </View>
                <View style={[styles.typeBadge, styles.typeBadgeSeeker, { left: 38 }]}>
                  <Ionicons name="send" size={8} color="#FFFFFF" style={{ transform: [{ rotate: '180deg' }] }} />
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
          {lastMessageTime && (
            <Text style={styles.timeText}>{lastMessageTime}</Text>
          )}
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
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
          {/* Swelly avatar */}
          <View style={styles.avatarContainer}>
            <Image
              source={{ uri: getImageUrl('/swelly/Swelly_PopOut_DarkBackground.png') }}
              style={styles.swellyAvatar}
              resizeMode="contain"
            />
          </View>

          {/* Text content */}
          <View style={styles.textContainer}>
            <Text style={styles.swellyName}>Swelly</Text>
            <Text style={styles.lastMessage} numberOfLines={1}>
              Did you see the new exhibit at the MAM?
            </Text>
          </View>
        </View>

        {/* Time and unread badge */}
        <View style={styles.timeContainer}>
          <Text style={styles.swellyTimeText}>15:20</Text>
          <View style={styles.swellyUnreadBadge}>
            <Text style={styles.unreadBadgeText}>2</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const filteredConversations = getFilteredConversations();

  if (selectedConversation) {
    return (
      <DirectMessageScreen
        conversationId={selectedConversation.id}
        otherUserName={selectedConversation.otherUserName}
        otherUserAvatar={selectedConversation.otherUserAvatar}
        onBack={handleBackFromChat}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
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
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => setShowSearchModal(true)}
          >
            <Ionicons name="search" size={24} color="#EEEEEE" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => {
              console.log('Menu button pressed, showing menu');
              setShowMenu(true);
            }}
          >
            <Ionicons name="ellipsis-vertical" size={24} color="#EEEEEE" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Phone status bar spacer */}
      <View style={styles.statusBarSpacer} />

      {/* Filter buttons */}
      <View style={styles.filterContainer}>
        {renderFilterButton('all', 'All')}
        {renderFilterButton('advisor', 'Advisor', getAdvisorCount(), 'send', '#05BCD3')}
        {renderFilterButton('seeker', 'Seeker', getSeekerCount(), 'send', '#FF5367')}
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

      {/* Swelly conversation (always visible at bottom) */}
      {renderSwellyConversation()}

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
    backgroundColor: '#FAFAFA',
  },
  header: {
    backgroundColor: '#212121',
    paddingTop: Platform.OS === 'web' ? 48 : 48,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginRight: 8,
  },
  headerTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    lineHeight: 24,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    width: 45,
    height: 45,
    borderRadius: 48,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBarSpacer: {
    height: 38,
    backgroundColor: '#212121',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 32,
    paddingVertical: 24,
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
    right: -2,
  },
  conversationsList: {
    flex: 1,
  },
  conversationsListContent: {
    paddingHorizontal: 16,
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
    gap: 8,
  },
  avatarContainer: {
    position: 'relative',
    width: 48,
    height: 48,
  },
  avatar: {
    width: 48,
    height: 48,
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
    width: 14,
    height: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    bottom: 0,
    left: 38,
  },
  typeBadgeAdvisor: {
    backgroundColor: '#05BCD3',
  },
  typeBadgeSeeker: {
    backgroundColor: '#FFB443',
  },
  textContainer: {
    flex: 1,
    gap: 8,
  },
  conversationName: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    color: '#000000',
  },
  lastMessage: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 20,
    color: '#868686',
  },
  timeContainer: {
    alignItems: 'flex-end',
    gap: 10,
    width: 37,
  },
  timeText: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 20,
    color: '#05BCD3',
    textAlign: 'right',
  },
  unreadBadge: {
    backgroundColor: '#05BCD3',
    borderRadius: 16,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 20,
    color: '#FFFFFF',
  },
  swellyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#B72DF2',
  },
  swellyAvatar: {
    width: 50,
    height: 55.255,
  },
  swellyName: {
    fontFamily: 'Montserrat-Bold',
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 22,
    color: '#B72DF2',
  },
  swellyTimeText: {
    fontFamily: 'Inter',
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

