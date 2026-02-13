import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  ImageBackground,
  Alert,
  Animated,
} from 'react-native';
import { TextInput as PaperTextInput } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { messagingService, Message } from '../services/messaging/messagingService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { getImageUrl } from '../services/media/imageService';
import { supabase } from '../config/supabase';
import { ProfileImage } from '../components/ProfileImage';
import { MessageListSkeleton } from '../components/skeletons';
import { SKELETON_DELAY_MS } from '../constants/loading';
import { analyticsService } from '../services/analytics/analyticsService';
import { chatHistoryCache } from '../services/messaging/chatHistoryCache';
import { MessageActionsMenu } from '../components/MessageActionsMenu';
import { useMessaging } from '../context/MessagingProvider';

interface DirectMessageScreenProps {
  conversationId?: string; // Optional: undefined for pending conversations (will be created on first message)
  otherUserId: string; // Required: the user ID we're messaging
  otherUserName: string;
  otherUserAvatar: string | null;
  isDirect?: boolean; // true for direct messages (2 users), false for group chats
  fromTripPlanning?: boolean; // true if conversation was created from trip planning recommendations
  onBack?: () => void;
  onConversationCreated?: (conversationId: string) => void; // Callback when conversation is created
  onViewProfile?: (userId: string) => void; // Callback when avatar or name is clicked
}

export const DirectMessageScreen: React.FC<DirectMessageScreenProps> = ({
  conversationId,
  otherUserId,
  otherUserName,
  otherUserAvatar,
  isDirect = true, // Default to direct message (2 users)
  fromTripPlanning = false, // Default to false (not from trip planning)
  onBack,
  onConversationCreated,
  onViewProfile,
}) => {
  // Get markAsRead and setCurrentConversationId from MessagingProvider
  const { markAsRead, setCurrentConversationId: setMessagingCurrentConversationId } = useMessaging();
  
  // Debug: Log props immediately on every render (synchronous)
  console.log('[DirectMessageScreen] === COMPONENT RENDER ===');
  console.log('[DirectMessageScreen] onViewProfile exists:', !!onViewProfile);
  console.log('[DirectMessageScreen] onViewProfile type:', typeof onViewProfile);
  console.log('[DirectMessageScreen] onViewProfile:', onViewProfile);
  console.log('[DirectMessageScreen] onBack exists:', !!onBack);
  console.log('[DirectMessageScreen] otherUserId:', otherUserId);
  
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(conversationId);
  
  // Debug: Log props on mount and when they change
  useEffect(() => {
    console.log('[DirectMessageScreen] useEffect - Component mounted/updated with props:');
    console.log('[DirectMessageScreen] useEffect - onViewProfile exists:', !!onViewProfile);
    console.log('[DirectMessageScreen] useEffect - onViewProfile type:', typeof onViewProfile);
    console.log('[DirectMessageScreen] useEffect - onViewProfile value:', onViewProfile);
  }, [otherUserId, otherUserName, otherUserAvatar, onViewProfile, onBack]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [isFetchingMessages, setIsFetchingMessages] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUserAdvRole, setOtherUserAdvRole] = useState<'adv_giver' | 'adv_seeker' | null>(null);
  const [inputHeight, setInputHeight] = useState(25); // Initial height for one line
  const [showSkeletons, setShowSkeletons] = useState(false);
  const [hasTrackedFirstMessage, setHasTrackedFirstMessage] = useState(false);
  const [hasTrackedFirstReply, setHasTrackedFirstReply] = useState(false);
  const [firstMessageSentTime, setFirstMessageSentTime] = useState<number | null>(null);
  const [isTyping, setIsTyping] = useState(false); // Typing indicator state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const scrollViewRef = useRef<ScrollView>(null);
  const textInputRef = useRef<any>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingDebounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Get current user ID
    const getCurrentUser = async () => {
      try {
        const user = await supabaseAuthService.getCurrentUser();
        if (user) {
          setCurrentUserId(user.id);
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    };
    getCurrentUser();

    // Delay skeleton display to prevent flicker for fast loads
    // Only show skeletons if we're fetching AND we don't have any messages yet
    if (isFetchingMessages && messages.length === 0) {
      // Show skeletons immediately if fetching and no messages (don't wait for timer)
      // This prevents showing empty message while loading
      setShowSkeletons(true);
      
      // But also set up timer to handle fast loads (though we show immediately)
    const skeletonTimer = setTimeout(() => {
        // Keep skeletons visible if still fetching
        if (isFetchingMessages && messages.length === 0) {
        setShowSkeletons(true);
      }
    }, SKELETON_DELAY_MS);

    return () => clearTimeout(skeletonTimer);
    } else {
      // If we have messages or not fetching, don't show skeletons
      setShowSkeletons(false);
    }
  }, [isFetchingMessages, messages.length]);

  useEffect(() => {
    // Only load messages and subscribe if conversation exists
    if (currentConversationId) {
      loadMessages();

      // Set current conversation in MessagingProvider (use renamed function to avoid conflict)
      setMessagingCurrentConversationId(currentConversationId);
      
      // Mark conversation as read
      markAsRead(currentConversationId).catch(err => {
        console.error('Error marking as read:', err);
      });

      // Subscribe to messages with unified subscription (INSERT, UPDATE, DELETE, typing)
      const unsubscribe = messagingService.subscribeToMessages(
        currentConversationId,
        {
          onNewMessage: (newMessage) => {
            // Track first reply received (only once, and only if message is from other user)
            if (!hasTrackedFirstReply && newMessage.sender_id !== currentUserId && currentUserId) {
              const timeToReplyMinutes = firstMessageSentTime 
                ? (Date.now() - firstMessageSentTime) / (1000 * 60)
                : undefined;
              analyticsService.trackReplyReceived(timeToReplyMinutes, currentConversationId);
              setHasTrackedFirstReply(true);
            }
        
            // Check if message already exists (avoid duplicates)
            setMessages((prev) => {
              const exists = prev.some(msg => msg.id === newMessage.id);
              if (exists) {
                return prev;
              }
              const updated = [...prev, newMessage];
              // Update cache
              chatHistoryCache.saveMessages(currentConversationId, updated).catch(err => {
                console.error('Error updating cache:', err);
              });
              return updated;
            });
            markAsRead(currentConversationId).catch(err => {
              console.error('Error marking message as read:', err);
            });
            setTimeout(() => scrollToBottom(), 100);
          },
          onMessageUpdated: (updatedMessage) => {
            // Handle message edit
            setMessages((prev) => {
              const updated = prev.map(msg => 
                msg.id === updatedMessage.id ? updatedMessage : msg
              );
              // Update cache
              chatHistoryCache.updateMessage(currentConversationId, updatedMessage.id, updatedMessage).catch(err => {
                console.error('Error updating message in cache:', err);
              });
              return updated;
            });
          },
          onMessageDeleted: (messageId) => {
            // Handle message deletion
            setMessages((prev) => {
              const updated = prev.filter(msg => msg.id !== messageId);
              // Update cache
              chatHistoryCache.updateMessage(currentConversationId, messageId, null).catch(err => {
                console.error('Error updating deleted message in cache:', err);
              });
              return updated;
            });
          },
          onTyping: (userId, isTyping) => {
            // Only show typing indicator for other user
            if (userId !== currentUserId) {
              setIsTyping(isTyping);
            }
          },
        }
      );

      return () => {
        unsubscribe();
        setIsTyping(false);
        // Clean up typing indicators
        if (typingDebounceRef.current) {
          clearTimeout(typingDebounceRef.current);
          typingDebounceRef.current = null;
        }
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
        messagingService.stopTyping(currentConversationId).catch(() => {});
      };
    } else {
      // No conversation yet - clear messages and stop loading
      setMessages([]);
      setIsFetchingMessages(false);
      setShowSkeletons(false);
      setIsTyping(false);
      // Clear current conversation in MessagingProvider
      setMessagingCurrentConversationId(null);
    }
    
    // Cleanup: Clear current conversation when component unmounts or conversation changes
    return () => {
      if (currentConversationId) {
        setMessagingCurrentConversationId(null);
      }
    };
  }, [currentConversationId, currentUserId, markAsRead, setMessagingCurrentConversationId]);

  const loadOtherUserAdvRole = async () => {
    if (!currentConversationId || !otherUserId) return;
    
    try {
      const { data, error } = await supabase
        .from('conversation_members')
        .select('adv_role')
        .eq('conversation_id', currentConversationId)
        .eq('user_id', otherUserId)
        .single();
      
      if (error) {
        console.error('Error fetching other user adv_role:', error);
        return;
      }
      
      if (data && (data.adv_role === 'adv_giver' || data.adv_role === 'adv_seeker')) {
        setOtherUserAdvRole(data.adv_role);
      }
    } catch (error) {
      console.error('Error loading other user adv_role:', error);
    }
  };

  const loadMessages = async () => {
    if (!currentConversationId) {
      setMessages([]);
      setIsFetchingMessages(false);
      return;
    }
    
    // If we already have messages (e.g., optimistic message after first send),
    // don't show skeletons - just load in the background
    const hasExistingMessages = messages.length > 0;
    
    try {
      setIsFetchingMessages(true);
      // Only show skeletons if we don't have existing messages
      if (!hasExistingMessages) {
        setShowSkeletons(false); // Reset skeleton state - timer will set it if needed
      } else {
        // We have messages, so don't show skeletons at all
        setShowSkeletons(false);
      }

      // Load from cache first (instant display)
      const cachedMessages = await chatHistoryCache.loadCachedMessages(currentConversationId);
      if (cachedMessages && cachedMessages.length > 0) {
        setMessages(cachedMessages);
        // Load other user's adv_role
        await loadOtherUserAdvRole();
        // Scroll to bottom after messages load
        setTimeout(() => scrollToBottom(), 200);
      }

      // Then sync with server in background (incremental sync)
      const lastMessageId = await chatHistoryCache.getLastMessageId(currentConversationId);
      const serverMessages = await messagingService.getMessages(
        currentConversationId,
        50,
        lastMessageId || undefined
      );

      if (serverMessages.length > 0) {
        // Merge with cached messages
        const merged = chatHistoryCache.mergeMessages(cachedMessages || [], serverMessages);
        setMessages(merged);
        // Save to cache
        await chatHistoryCache.saveMessages(currentConversationId, merged);
      } else if (!cachedMessages || cachedMessages.length === 0) {
        // No cache and no new messages, fetch all
        const allMessages = await messagingService.getMessages(currentConversationId, 30);
        setMessages(allMessages);
        await chatHistoryCache.saveMessages(currentConversationId, allMessages);
      }

      // Load other user's adv_role
      await loadOtherUserAdvRole();
      // Scroll to bottom after messages load
      setTimeout(() => scrollToBottom(), 200);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setIsFetchingMessages(false);
      setShowSkeletons(false);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading || !currentUserId) return;

    const messageText = inputText.trim();
    const tempId = `temp-${Date.now()}`;
    
    // 1. Show message immediately (optimistic) - BEFORE conversation creation
    const tempConversationId = currentConversationId || `temp-conv-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      conversation_id: tempConversationId,
      sender_id: currentUserId,
      body: messageText,
      rendered_body: null,
      attachments: [],
      is_system: false,
      edited: false,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setInputText('');
    
    // Scroll to bottom immediately
    setTimeout(() => scrollToBottom(), 50);
    
    // 2. Create conversation if needed (still blocking, but message already visible)
    let targetConversationId = currentConversationId;
    
    if (!targetConversationId) {
      try {
        setIsLoading(true);
        setLoadingMessage('');
        
        // Progressive feedback: Show messages at different intervals
        const feedbackTimeout = setTimeout(() => {
          setLoadingMessage('This is taking longer than usual...');
        }, 5000);
        
        // Final timeout after 30 seconds (generous for DB operations)
        const finalTimeout = setTimeout(() => {
          clearTimeout(feedbackTimeout);
          throw new Error('Connection timeout. Please check your internet connection and try again.');
        }, 30000);
        
        try {
          const conversation = await messagingService.createDirectConversation(otherUserId, fromTripPlanning);
          
          // Clear timeouts if successful
          clearTimeout(feedbackTimeout);
          clearTimeout(finalTimeout);
          setLoadingMessage('');
          
          targetConversationId = conversation.id;
          setCurrentConversationId(targetConversationId);
          
          // Update optimistic message with real conversation ID
          setMessages((prev) => prev.map(msg => 
            msg.id === tempId 
              ? { ...msg, conversation_id: targetConversationId }
              : msg
          ));
          
          // Set in MessagingProvider
          setMessagingCurrentConversationId(targetConversationId);
          
          // Load other user's adv_role for the new conversation
          await loadOtherUserAdvRole();
          
          // Notify parent component that conversation was created
          if (onConversationCreated) {
            onConversationCreated(targetConversationId);
          }
        } catch (error) {
          // Clear timeouts on error
          clearTimeout(feedbackTimeout);
          clearTimeout(finalTimeout);
          throw error;
        }
      } catch (error: any) {
        console.error('Error creating conversation:', error);
        const errorMessage = error?.message || 'Failed to create conversation. Please try again.';
        // Remove optimistic message on error
        setMessages((prev) => prev.filter(msg => msg.id !== tempId));
        setInputText(messageText); // Restore input text
        Alert.alert('Error', errorMessage);
        setIsLoading(false);
        setLoadingMessage('');
        return;
      }
    }
    
    setIsLoading(true);

    // 3. Send message to server (replace optimistic message with real one)
    try {
      // At this point, targetConversationId should always be defined
      if (!targetConversationId) {
        throw new Error('Conversation ID is required to send message');
      }
      
      // Send message to server
      const sentMessage = await messagingService.sendMessage(targetConversationId, messageText);
      
      // Track first message sent (only if this is a new conversation and we haven't tracked it yet)
      if (!hasTrackedFirstMessage && !conversationId) {
        analyticsService.trackFirstMessageSent(targetConversationId);
        setHasTrackedFirstMessage(true);
        setFirstMessageSentTime(Date.now());
      }
      
      // Replace optimistic message with real message from server
      setMessages((prev) => {
        const filtered = prev.filter(msg => msg.id !== tempId);
        // Check if message already exists (from subscription)
        const exists = filtered.some(msg => msg.id === sentMessage.id);
        const updated = exists ? filtered : [...filtered, sentMessage];
        // Update cache
        chatHistoryCache.saveMessages(targetConversationId, updated).catch(err => {
          console.error('Error updating cache:', err);
        });
        return updated;
      });
      
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter(msg => msg.id !== tempId));
      setInputText(messageText); // Restore input text
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    // Use requestAnimationFrame for better timing
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  };

  // Handle typing indicator (debounced)
  useEffect(() => {
    if (!currentConversationId || !inputText.trim()) {
      // Clear typing indicator when input is empty
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = null;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      messagingService.stopTyping(currentConversationId!).catch(() => {});
      return;
    }

    // Debounce: send typing indicator after 300ms of inactivity
    if (typingDebounceRef.current) {
      clearTimeout(typingDebounceRef.current);
    }

    typingDebounceRef.current = setTimeout(() => {
      if (currentConversationId && inputText.trim()) {
        messagingService.startTyping(currentConversationId).catch(() => {});
      }
    }, 300);

    // Clear typing indicator after 3 seconds of no typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      if (currentConversationId) {
        messagingService.stopTyping(currentConversationId).catch(() => {});
      }
    }, 3000);

    return () => {
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [inputText, currentConversationId]);

  // Handle message edit
  const handleEditMessage = async (messageId: string, newBody: string) => {
    if (!currentConversationId || !newBody.trim()) return;

    try {
      // Optimistic update
      setMessages((prev) => {
        const updated = prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, body: newBody, edited: true, updated_at: new Date().toISOString() }
            : msg
        );
        chatHistoryCache.updateMessage(currentConversationId, messageId, updated.find(m => m.id === messageId) || null).catch(() => {});
        return updated;
      });

      const updatedMessage = await messagingService.editMessage(currentConversationId, messageId, newBody);
      
      // Update with server response
      setMessages((prev) => {
        const updated = prev.map(msg => 
          msg.id === messageId ? updatedMessage : msg
        );
        chatHistoryCache.updateMessage(currentConversationId, messageId, updatedMessage).catch(() => {});
        return updated;
      });

      setEditingMessageId(null);
      setEditingText('');
    } catch (error: any) {
      console.error('Error editing message:', error);
      Alert.alert('Error', error?.message || 'Failed to edit message');
      // Rollback optimistic update
      loadMessages();
    }
  };

  // Handle message delete
  const handleDeleteMessage = async (messageId: string) => {
    if (!currentConversationId) return;

    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Optimistic update
              setMessages((prev) => {
                const updated = prev.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, deleted: true, body: null }
                    : msg
                );
                chatHistoryCache.updateMessage(currentConversationId, messageId, null).catch(() => {});
                return updated;
              });

              await messagingService.deleteMessage(currentConversationId, messageId);
            } catch (error: any) {
              console.error('Error deleting message:', error);
              Alert.alert('Error', error?.message || 'Failed to delete message');
              // Rollback optimistic update
              loadMessages();
            }
          },
        },
      ]
    );
  };

  // Handle long press on message
  const handleMessageLongPress = (message: Message, event: any) => {
    if (!currentUserId || message.sender_id !== currentUserId) return;
    if (message.deleted) return;

    const { pageX, pageY } = event.nativeEvent;
    setSelectedMessage(message);
    setEditingText(message.body || ''); // Initialize edit text
    setMenuPosition({ x: pageX, y: pageY });
    setMenuVisible(true);
  };

  // Check if message can be edited (within 15 minutes)
  const canEditMessage = (message: Message): boolean => {
    if (!currentUserId || message.sender_id !== currentUserId) return false;
    if (message.deleted) return false;
    
    const messageAge = Date.now() - new Date(message.created_at).getTime();
    const fifteenMinutes = 15 * 60 * 1000;
    return messageAge <= fifteenMinutes;
  };

  // Typing Indicator Component
  const TypingIndicator = () => {
    const dot1 = useRef(new Animated.Value(0)).current;
    const dot2 = useRef(new Animated.Value(0)).current;
    const dot3 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (!isTyping) return;

      const animateDot = (dot: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(dot, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
          ])
        );
      };

      const animations = [
        animateDot(dot1, 0),
        animateDot(dot2, 200),
        animateDot(dot3, 400),
      ];

      animations.forEach(anim => anim.start());

      return () => {
        animations.forEach(anim => anim.stop());
      };
    }, [isTyping]);

    if (!isTyping) return null;

    const opacity1 = dot1.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    });

    const opacity2 = dot2.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    });

    const opacity3 = dot3.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    });

    return (
      <View style={[styles.messageContainer, styles.botMessageContainer]}>
        <View style={[styles.messageBubble, styles.botMessageBubble]}>
          <View style={styles.typingContainer}>
            <Animated.View style={[styles.typingDot, { opacity: opacity1 }]} />
            <Animated.View style={[styles.typingDot, { opacity: opacity2 }]} />
            <Animated.View style={[styles.typingDot, { opacity: opacity3 }]} />
          </View>
        </View>
      </View>
    );
  };

  // Reset input height when text is cleared
  useEffect(() => {
    if (!inputText.trim()) {
      setInputHeight(25); // Reset to single line height
    }
  }, [inputText]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0 && !isFetchingMessages) {
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [messages.length, isFetchingMessages]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const renderMessage = (message: Message) => {
    // Don't render message until we have all required variables
    if (!currentUserId) {
      return null; // Can't determine if message is own or received
    }
    
    const isOwnMessage = message.sender_id === currentUserId;
    const isEditing = editingMessageId === message.id;
    const canEdit = canEditMessage(message);
    
    // For group chats, show avatar for received messages
    // For direct messages (2 users), don't show avatar since it's always the same person
    const showAvatar = !isOwnMessage && !isDirect && (message.sender_name || message.sender_avatar);
    const senderName = message.sender_name || message.sender?.name || otherUserName;
    const senderAvatar = message.sender_avatar || message.sender?.avatar || otherUserAvatar;
    
    return (
      <TouchableOpacity
        key={message.id}
        activeOpacity={0.7}
        onLongPress={(e) => handleMessageLongPress(message, e)}
        style={[
          styles.messageContainer,
          isOwnMessage ? styles.userMessageContainer : [
            styles.botMessageContainer,
            isDirect && styles.botMessageContainerDirect, // Less padding for direct messages (no avatar)
          ],
        ]}
      >
        {/* Show avatar only for group chats (not direct messages) */}
        {showAvatar && (
          <View style={styles.messageAvatarContainer}>
            {senderAvatar ? (
              <Image
                source={{ uri: senderAvatar }}
                style={styles.messageAvatar}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.messageAvatar, styles.messageAvatarPlaceholder]}>
                <Text style={styles.messageAvatarPlaceholderText}>
                  {senderName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        )}
        
        <View
          style={[
            styles.messageBubble,
            isOwnMessage 
              ? styles.userMessageBubble 
              : [
                  styles.botMessageBubble,
                  otherUserAdvRole === 'adv_giver' && styles.botMessageBubbleGiveAdv,
                  otherUserAdvRole === 'adv_seeker' && styles.botMessageBubbleGetAdv,
                ],
          ]}
        >
          {/* Message text container with gap */}
          <View style={styles.messageTextContainer}>
            {isEditing ? (
              <View style={styles.editContainer}>
                <PaperTextInput
                  value={editingText}
                  onChangeText={setEditingText}
                  multiline
                  style={styles.editInput}
                  autoFocus
                />
                <View style={styles.editActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingMessageId(null);
                      setEditingText('');
                    }}
                    style={styles.editButton}
                  >
                    <Text style={styles.editButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleEditMessage(message.id, editingText)}
                    style={[styles.editButton, styles.editButtonSave]}
                  >
                    <Text style={[styles.editButtonText, styles.editButtonTextSave]}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : message.deleted ? (
              <Text style={[
                isOwnMessage ? styles.userMessageText : styles.botMessageText,
                styles.deletedMessageText,
              ]}>
                This message was deleted
              </Text>
            ) : (
              <Text style={[
                isOwnMessage ? styles.userMessageText : styles.botMessageText,
                !isOwnMessage && otherUserAdvRole === 'adv_giver' && styles.botMessageTextGiveAdv,
                !isOwnMessage && otherUserAdvRole === 'adv_seeker' && styles.botMessageTextGetAdv,
              ]}>
                {message.body || ''}
              </Text>
            )}
            {message.edited && !message.deleted && (
              <Text style={styles.editedBadge}>(edited)</Text>
            )}
          </View>
          
          {/* Timestamp container with rounded corners (Figma design) */}
          <View style={[
            styles.timestampContainer,
            isOwnMessage ? styles.userTimestampContainer : styles.botTimestampContainer,
          ]}>
            <Text style={[
              styles.timestamp,
              isOwnMessage ? styles.userTimestamp : styles.botTimestamp,
            ]}>
              {formatTime(message.created_at)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={onBack}
            >
              <Ionicons name="chevron-back" size={24} color="#222B30" />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.avatar}
              onPress={() => {
                console.log('[DirectMessageScreen] Avatar pressed, otherUserId:', otherUserId);
                console.log('[DirectMessageScreen] onViewProfile exists:', !!onViewProfile);
                if (onViewProfile) {
                  console.log('[DirectMessageScreen] Calling onViewProfile with userId:', otherUserId);
                  onViewProfile(otherUserId);
                } else {
                  console.warn('[DirectMessageScreen] onViewProfile is not provided!');
                }
              }}
              activeOpacity={0.7}
            >
              <ProfileImage
                imageUrl={otherUserAvatar}
                name={otherUserName}
                style={styles.avatarImage}
                showLoadingIndicator={false}
              />
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity 
            style={styles.profileInfo}
            onPress={() => {
              console.log('[DirectMessageScreen] Profile info (name) pressed, otherUserId:', otherUserId);
              console.log('[DirectMessageScreen] onViewProfile exists:', !!onViewProfile);
              if (onViewProfile) {
                console.log('[DirectMessageScreen] Calling onViewProfile with userId:', otherUserId);
                onViewProfile(otherUserId);
              } else {
                console.warn('[DirectMessageScreen] onViewProfile is not provided!');
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.profileName}>{otherUserName}</Text>
            <Text style={styles.profileTagline}>Online</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.menuButton}>
            <Ionicons name="ellipsis-vertical" size={24} color="#222B30" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Chat Messages */}
      <KeyboardAvoidingView 
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ImageBackground
          source={{ uri: getImageUrl('/chat background.png') }}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
          {!isFetchingMessages && currentConversationId && messages.length === 0 ? (
            // Show skeletons if fetching and no messages
            // If showSkeletons is false (timer hasn't fired), show skeletons anyway to avoid showing empty message
            <MessageListSkeleton count={5} />
          ) : messages.length === 0 && !isFetchingMessages ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {currentConversationId 
                  ? 'No messages yet. Say hi! 👋' 
                  : 'Start the conversation by sending a message!'}
              </Text>
            </View>
          ) : (
            <>
              {messages
                .map(renderMessage)
                .filter(msg => msg !== null) // Filter out null messages (when variables not ready)
              }
              <TypingIndicator />
            </>
          )}
          {/* {isLoading && (
            <View style={[styles.messageContainer, styles.botMessageContainer]}>
              <View style={[styles.messageBubble, styles.botMessageBubble]}>
                <Text style={styles.botMessageText}>
                  {loadingMessage || (currentConversationId ? 'Sending...' : 'Creating conversation...')}
                </Text>
              </View>
            </View>
          )} */}
          </ScrollView>
        </ImageBackground>

        {/* Input Area */}
        <View style={styles.inputWrapper}>
          <View style={styles.attachButtonWrapper}>
            <TouchableOpacity style={styles.attachButton}>
              <Ionicons name="add" size={28} color="#222B30" />
            </TouchableOpacity>
          </View>
          
          <View style={[
            styles.inputContainer,
            // Dynamically adjust container height based on input height
            // Container height = inputHeight + vertical padding (8px top + 8px bottom = 16px)
            // Minimum 48px for single line
            { minHeight: Math.max(48, inputHeight + 16) }
          ]}>
            <View style={styles.inputInnerContainer}>
              <PaperTextInput
                ref={textInputRef}
                mode="flat"
                value={inputText}
                onChangeText={setInputText}
                placeholder="Type your message.."
                multiline={true}
                maxLength={500}
                onSubmitEditing={undefined} // Disable default submit on Enter (we handle it manually)
                returnKeyType="default" // Always default to allow multiline
                blurOnSubmit={false}
                onContentSizeChange={(event: any) => {
                  // Best practice: Smooth expansion based on actual content size
                  const { height } = event.nativeEvent.contentSize;
                  
                  if (!height || height < 0) return; // Guard against invalid values
                  
                  // Calculate proper height:
                  // - Minimum: 34px (single line with proper line height)
                  // - Maximum: 120px (~6 lines, approximately 5-6 lines of text)
                  // - Use content height if it's larger than minimum
                  const calculatedHeight = Math.max(25, Math.ceil(height));
                  const cappedHeight = Math.min(calculatedHeight, 120);
                  
                  // Only update if height actually changed (prevents unnecessary re-renders)
                  // Use a small threshold to avoid jittery updates
                  if (Math.abs(cappedHeight - inputHeight) >= 1) {
                    setInputHeight(cappedHeight);
                  }
                }}
                onKeyPress={(e: any) => {
                  // On web: Enter sends, Shift+Enter creates new line
                  // On native: Enter always creates new line (no send on Enter)
                  if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter') {
                    const isShiftPressed = (e.nativeEvent as any).shiftKey;
                    
                    if (!isShiftPressed) {
                      // Enter without Shift: send message (web only)
                      e.preventDefault();
                      sendMessage();
                    }
                    // Shift+Enter: allow new line (default behavior, don't prevent)
                  }
                  // On native: Enter key always creates new line (default behavior)
                }}
                // Enable scrolling only when we've reached max height
                scrollEnabled={inputHeight >= 120}
                // Center text vertically for single line, top for multiline
                textAlignVertical={inputHeight <= 25 ? "center" : "top"}
                style={[
                  styles.paperTextInput,
                  { 
                    // Dynamic height: starts at 34px, expands up to 120px
                    height: inputHeight,
                    maxHeight: 120,
                    // Center placeholder vertically for single line
                    ...(inputHeight <= 25 && {
                      paddingTop: 5,// Center based on line height (22px)
                      // paddingBottom: (34 - 22) / 2,
                    }),
                  }
                ]}
                contentStyle={[
                  styles.paperTextInputContent,
                  {
                    // Ensure content has proper padding and alignment
                    paddingTop: 0,
                    paddingBottom: 0,
                    minHeight: 25,
                  }
                ]}
                underlineColor="transparent"
                activeUnderlineColor="transparent"
                selectionColor={colors.primary || '#B72DF2'}
                placeholderTextColor="#7B7B7B"
                textColor="#333333"
                theme={{
                  colors: {
                    primary: colors.primary || '#B72DF2',
                    text: '#333333',
                    placeholder: '#7B7B7B',
                    background: 'transparent',
                  },
                }}
              />
            </View>
            
            <View style={styles.sendButtonWrapper}>
              <TouchableOpacity 
                style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
                onPress={sendMessage}
                disabled={!inputText.trim() || isLoading}
              >
                <Ionicons 
                  name={inputText.trim() ? "arrow-up" : "mic"} 
                  size={20} 
                  color="#FFFFFF" 
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Message Actions Menu */}
      <MessageActionsMenu
        visible={menuVisible}
        onClose={() => {
          setMenuVisible(false);
          setSelectedMessage(null);
        }}
        onEdit={() => {
          if (selectedMessage && canEditMessage(selectedMessage)) {
            setEditingMessageId(selectedMessage.id);
            setEditingText(selectedMessage.body || '');
          }
        }}
        onDelete={() => {
          if (selectedMessage) {
            handleDeleteMessage(selectedMessage.id);
          }
        }}
        canEdit={selectedMessage ? canEditMessage(selectedMessage) : false}
        messagePosition={menuPosition}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  headerContainer: {
    backgroundColor: colors.white,
    paddingTop: 48,
    paddingBottom: spacing.md,
    paddingHorizontal: 0,
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  backButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 5,
  },
  avatar: {
    width: 48,
    height: 52,
    aspectRatio: 12 / 13,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#D3D3D3', // Fallback background
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
    }),
  },
  avatarPlaceholder: {
    backgroundColor: '#D3D3D3',
    justifyContent: 'center',
    alignItems: 'center',
    width: 48,
    height: 52,
    borderRadius: 24,
  },
  avatarPlaceholderText: {
    color: colors.white,
    fontSize: 20,
    fontWeight: 'bold',
  },
  profileInfo: {
    flex: 1,
    width: 246,
    marginRight: spacing.sm,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : undefined,
    lineHeight: 32,
    color: '#333333',
    marginBottom: 4,
  },
  profileTagline: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20,
    color: '#868686',
  },
  menuButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatContainer: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  messagesList: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  messagesContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#7B7B7B',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  messageContainer: {
    // marginBottom handled by userMessageContainer and botMessageContainer
  },
  userMessageContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end', // Received messages on RIGHT side
    alignItems: 'flex-end',
    paddingLeft: 48,
    paddingRight: 16, 
    marginBottom: 16,
  },
  botMessageContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start', 
    alignItems: 'flex-end',
    paddingLeft: 0,
    paddingRight: 60,
    marginBottom: 16,
  },
  botMessageContainerDirect: {
    // For direct messages (no avatar), reduce right padding
    paddingRight: 16, // Keep same padding since we removed avatar
  },
  messageAvatarContainer: {
    marginRight: 8,
    marginBottom: 0,
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  messageAvatarPlaceholder: {
    backgroundColor: '#D3D3D3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageAvatarPlaceholderText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  messageBubble: {
    maxWidth: 268,
    flexDirection: 'column',
  },
  userMessageBubble: {
    maxWidth: 268,
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 8,
    paddingLeft: 16,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF', // White background for outbound messages
    
    borderTopLeftRadius: 16, // 16px 2px 16px 16px
    borderTopRightRadius: 2,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  botMessageBubble: {
    backgroundColor: colors.white, // Default, will be overridden by adv_role styles
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-end', // Align to right for received messages
    borderTopLeftRadius: 16, // 16px 16px 2px 16px (pointy corner at bottom left)
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 2, // Pointy corner at bottom left
    borderBottomRightRadius: 16,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  botMessageBubbleGiveAdv: {
    backgroundColor: '#DBCDBC', // adv_giver color
  },
  botMessageBubbleGetAdv: {
    backgroundColor: '#05BCD3', // adv_seeker color
  },
  messageTextContainer: {
    marginBottom: 10, // Gap between text and timestamp (Figma: gap-[10px])
    width: '100%',
  },
  userMessageText: {
    color: '#333333', // Dark text on white background for outbound messages
    fontSize: 16,
    fontWeight: '500',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 16,
  },
  botMessageText: {
    color: '#333333', // Figma: text-[color:var(--text\/primary,#333333)]
    fontSize: 16, // Figma: text-[length:var(--size\/xs,16px)]
    fontWeight: '500', // Figma: font-medium
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 16, // Figma: leading-[normal]
  },
  botMessageTextGiveAdv: {
    color: '#333333', // Dark text on #DBCDBC (beige) background for adv_giver
  },
  botMessageTextGetAdv: {
    color: '#FFFFFF', // White text on #05BCD3 (teal) background for adv_seeker
  },
  timestampContainer: {
    alignItems: 'flex-start', // Default, will be overridden for user messages
    width: '100%',
  },
  userTimestampContainer: {
    alignItems: 'flex-start', // Align timestamp to left for outbound messages (on left side)
  },
  botTimestampContainer: {
    alignItems: 'flex-end', // Align timestamp to right for received messages (on right side)
  },
  timestamp: {
    fontSize: 14, // Figma: text-[length:var(--size\/xxs,14px)]
    fontWeight: '400', // Figma: font-normal
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20, // Figma: leading-[20px]
  },
  userTimestamp: {
    color: 'rgba(123, 123, 123, 0.5)', // Dark timestamp on white background for outbound messages
  },
  botTimestamp: {
    color: '#FFFFFF', // White timestamp for received messages
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingBottom: 35,
    paddingTop: 0,
  },
  attachButtonWrapper: {
    paddingBottom: 15,
    marginRight: 8,
  },
  attachButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center', // Center align items vertically to prevent send button from affecting line height
    backgroundColor: colors.white,
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
    // Dynamic minHeight: 48px for single line (34px text + 14px padding)
    // Will expand as inputHeight grows
    minHeight: 48,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 32,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
      transition: 'min-height 0.2s ease' as any, // Smooth height transitions
    }),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  inputInnerContainer: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 0,
    // Center content vertically for single line, flex-start for multiline
    justifyContent: 'center',
    minHeight: 25, // Minimum single line height
    position: 'relative',
    // Ensure proper alignment for placeholder
    alignSelf: 'stretch',
  },
  paperTextInput: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22, // Line height for proper text spacing
    minHeight: 25, // Single line minimum
    textAlign: 'left', // Ensure text aligns to left
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      resize: 'none' as any, // Prevent manual resizing on web
      overflow: 'auto' as any, // Allow scrolling when content exceeds max height
      textAlign: 'left' as any, // Left align text on web
    }),
  },
  paperTextInputContent: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    minHeight: 25, // Single line minimum
    fontSize: 18,
    lineHeight: 22, // Consistent line height
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    textAlign: 'left', // Left align text
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      textAlign: 'left' as any, // Left align text on web
    }),
  },
  sendButtonWrapper: {
    // Isolate send button to prevent it from affecting input line height
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButton: {
    width: 35,
    height: 35,
    borderRadius: 48,
    backgroundColor: '#B72DF2',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333333',
  },
  editContainer: {
    width: '100%',
  },
  editInput: {
    backgroundColor: 'transparent',
    padding: 0,
    margin: 0,
    fontSize: 16,
    minHeight: 40,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  editButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.textSecondary,
  },
  editButtonSave: {
    backgroundColor: colors.primary || '#B72DF2',
    borderColor: colors.primary || '#B72DF2',
  },
  editButtonText: {
    fontSize: 14,
    color: colors.text,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  editButtonTextSave: {
    color: colors.white,
  },
  editedBadge: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  deletedMessageText: {
    fontStyle: 'italic',
    opacity: 0.6,
  },
});
