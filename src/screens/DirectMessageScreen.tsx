import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  ImageBackground,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { messagingService, Message } from '../services/messaging/messagingService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { getImageUrl } from '../services/media/imageService';

interface DirectMessageScreenProps {
  conversationId?: string; // Optional: undefined for pending conversations (will be created on first message)
  otherUserId: string; // Required: the user ID we're messaging
  otherUserName: string;
  otherUserAvatar: string | null;
  isDirect?: boolean; // true for direct messages (2 users), false for group chats
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
  const [inputHeight, setInputHeight] = useState(34); // Initial height for one line
  const scrollViewRef = useRef<ScrollView>(null);
  const textInputRef = useRef<TextInput>(null);

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

    // Only load messages and subscribe if conversation exists
    if (currentConversationId) {
      loadMessages();

      // Mark conversation as read
      messagingService.markAsRead(currentConversationId).catch(err => {
        console.error('Error marking as read:', err);
      });

      // Subscribe to new messages
      const unsubscribe = messagingService.subscribeToMessages(
        currentConversationId,
        (newMessage) => {
          // Check if message already exists (avoid duplicates)
          setMessages((prev) => {
            const exists = prev.some(msg => msg.id === newMessage.id);
            if (exists) {
              return prev;
            }
            return [...prev, newMessage];
          });
          messagingService.markAsRead(currentConversationId, newMessage.id).catch(err => {
            console.error('Error marking message as read:', err);
          });
          setTimeout(() => scrollToBottom(), 100);
        }
      );

      return () => {
        unsubscribe();
      };
    } else {
      // No conversation yet - clear messages and stop loading
      setMessages([]);
      setIsFetchingMessages(false);
    }
  }, [currentConversationId]);

  const loadMessages = async () => {
    if (!currentConversationId) {
      setMessages([]);
      setIsFetchingMessages(false);
      return;
    }
    
    try {
      setIsFetchingMessages(true);
      const msgs = await messagingService.getMessages(currentConversationId);
      setMessages(msgs);
      // Scroll to bottom after messages load
      setTimeout(() => scrollToBottom(), 200);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setIsFetchingMessages(false);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading || !currentUserId) return;

    const messageText = inputText.trim();
    const tempId = `temp-${Date.now()}`;
    
    // Determine conversation ID - create if it doesn't exist
    let targetConversationId = currentConversationId;
    
    if (!targetConversationId) {
      // Create conversation on first message (WhatsApp-like behavior)
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
          
          // Notify parent component that conversation was created
          if (onConversationCreated) {
            onConversationCreated(targetConversationId);
          }
          
          // Subscribe to messages for the new conversation
          const unsubscribe = messagingService.subscribeToMessages(
            targetConversationId,
            (newMessage) => {
              setMessages((prev) => {
                const exists = prev.some(msg => msg.id === newMessage.id);
                if (exists) {
                  return prev;
                }
                return [...prev, newMessage];
              });
              if (targetConversationId) {
                messagingService.markAsRead(targetConversationId, newMessage.id).catch(err => {
                  console.error('Error marking message as read:', err);
                });
              }
              setTimeout(() => scrollToBottom(), 100);
            }
          );
          
          // Store unsubscribe function (we'll need to clean it up on unmount)
          // For now, we'll let it run - the component will handle cleanup
        } catch (error) {
          // Clear timeouts on error
          clearTimeout(feedbackTimeout);
          clearTimeout(finalTimeout);
          throw error;
        }
      } catch (error: any) {
        console.error('Error creating conversation:', error);
        const errorMessage = error?.message || 'Failed to create conversation. Please try again.';
        Alert.alert('Error', errorMessage);
        setIsLoading(false);
        setLoadingMessage('');
        return;
      }
    }
    
    // Optimistic update: Add message immediately to UI
    const optimisticMessage: Message = {
      id: tempId,
      conversation_id: targetConversationId,
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
    setIsLoading(true);
    
    // Scroll to bottom immediately
    setTimeout(() => scrollToBottom(), 50);

    try {
      // At this point, targetConversationId should always be defined
      if (!targetConversationId) {
        throw new Error('Conversation ID is required to send message');
      }
      
      // Send message to server
      const sentMessage = await messagingService.sendMessage(targetConversationId, messageText);
      
      // Replace optimistic message with real message from server
      setMessages((prev) => {
        const filtered = prev.filter(msg => msg.id !== tempId);
        // Check if message already exists (from subscription)
        const exists = filtered.some(msg => msg.id === sentMessage.id);
        if (exists) {
          return filtered;
        }
        return [...filtered, sentMessage];
      });
      
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter(msg => msg.id !== tempId));
      setInputText(messageText); // Restore input text
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

  // Reset input height when text is cleared
  useEffect(() => {
    if (!inputText.trim()) {
      setInputHeight(34);
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
    const isOwnMessage = currentUserId && message.sender_id === currentUserId;
    
    // For group chats, show avatar for received messages
    // For direct messages (2 users), don't show avatar since it's always the same person
    const showAvatar = !isOwnMessage && !isDirect && (message.sender_name || message.sender_avatar);
    const senderName = message.sender_name || message.sender?.name || otherUserName;
    const senderAvatar = message.sender_avatar || message.sender?.avatar || otherUserAvatar;
    
    return (
      <View
        key={message.id}
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
            isOwnMessage ? styles.userMessageBubble : styles.botMessageBubble,
          ]}
        >
          {/* Message text container with gap */}
          <View style={styles.messageTextContainer}>
            <Text style={isOwnMessage ? styles.userMessageText : styles.botMessageText}>
              {message.body || ''}
            </Text>
          </View>
          
          {/* Timestamp container with rounded corners (Figma design) */}
          <View style={[
            styles.timestampContainer,
            !isOwnMessage && styles.botTimestampContainer,
          ]}>
            <Text style={[
              styles.timestamp,
              isOwnMessage ? styles.userTimestamp : styles.botTimestamp,
            ]}>
              {formatTime(message.created_at)}
            </Text>
          </View>
        </View>
      </View>
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
              {otherUserAvatar && otherUserAvatar.trim() !== '' ? (
                <Image
                  source={{ uri: otherUserAvatar }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                  onError={(error) => {
                    console.error('Error loading avatar image:', error, 'URL:', otherUserAvatar);
                  }}
                  onLoad={() => {
                    console.log('Avatar image loaded successfully:', otherUserAvatar);
                  }}
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarPlaceholderText}>
                    {otherUserName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
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
          {isFetchingMessages && currentConversationId ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.brandTeal} />
              <Text style={styles.loadingText}>Loading messages...</Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {currentConversationId 
                  ? 'No messages yet. Say hi! 👋' 
                  : 'Start the conversation by sending a message!'}
              </Text>
            </View>
          ) : (
            messages.map(renderMessage)
          )}
          {isLoading && (
            <View style={[styles.messageContainer, styles.botMessageContainer]}>
              <View style={[styles.messageBubble, styles.botMessageBubble]}>
                <Text style={styles.botMessageText}>
                  {loadingMessage || (currentConversationId ? 'Sending...' : 'Creating conversation...')}
                </Text>
              </View>
            </View>
          )}
          </ScrollView>
        </ImageBackground>

        {/* Input Area */}
        <View style={styles.inputWrapper}>
          <View style={styles.attachButtonWrapper}>
            <TouchableOpacity style={styles.attachButton}>
              <Ionicons name="add" size={28} color="#222B30" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.inputContainer}>
            <View style={styles.inputInnerContainer}>
              {!inputText && (
                <Text style={[
                  styles.placeholderText,
                  inputHeight <= 34 ? styles.placeholderCentered : styles.placeholderTop
                ]}>
                  Type your message..
                </Text>
              )}
              <TextInput
                ref={textInputRef}
                style={[styles.textInput, { height: Math.max(34, Math.min(inputHeight, 120)) }]}
                placeholder=""
                placeholderTextColor="#7B7B7B"
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={500}
                onSubmitEditing={sendMessage}
                returnKeyType="send"
                blurOnSubmit={false}
                onContentSizeChange={(event) => {
                  const { height } = event.nativeEvent.contentSize;
                  // Set height, but cap at max (120px for ~6 lines)
                  setInputHeight(Math.min(height, 120));
                }}
                onKeyPress={(e) => {
                  if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !(e.nativeEvent as any).shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                scrollEnabled={inputHeight >= 120}
                textAlignVertical="top"
              />
            </View>
            
            <TouchableOpacity 
              style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
              onPress={sendMessage}
              disabled={!inputText.trim() || isLoading}
            >
              <Ionicons 
                name={inputText.trim() ? "arrow-up" : "mic"} 
                size={24} 
                color="#FFFFFF" 
              />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
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
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingLeft: 60,
    paddingRight: 0,
    marginBottom: 16,
  },
  botMessageContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingLeft: 16, // Default padding for group chats (with avatar)
    paddingRight: 48,
    marginBottom: 16,
  },
  botMessageContainerDirect: {
    // For direct messages (no avatar), reduce left padding
    paddingLeft: 16, // Keep same padding since we removed avatar
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
    alignItems: 'flex-end',
    backgroundColor: '#B72DF2',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 2,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  botMessageBubble: {
    backgroundColor: colors.white,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    borderTopLeftRadius: 4, // Figma: rounded-tl-[4px]
    borderTopRightRadius: 16, // Figma: rounded-tr-[16px]
    borderBottomLeftRadius: 16, // Figma: rounded-bl-[16px]
    borderBottomRightRadius: 16, // Figma: rounded-br-[16px]
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
    }),
  },
  messageTextContainer: {
    marginBottom: 10, // Gap between text and timestamp (Figma: gap-[10px])
    width: '100%',
  },
  userMessageText: {
    color: '#FFFFFF',
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
  timestampContainer: {
    alignItems: 'flex-start',
    width: '100%',
  },
  botTimestampContainer: {
    // Figma: rounded-bl-[16px] rounded-br-[16px] rounded-tl-[4px] rounded-tr-[16px]
    // The timestamp container itself doesn't need rounded corners since it's inside the bubble
    // But we ensure proper alignment
  },
  timestamp: {
    fontSize: 14, // Figma: text-[length:var(--size\/xxs,14px)]
    fontWeight: '400', // Figma: font-normal
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20, // Figma: leading-[20px]
  },
  userTimestamp: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  botTimestamp: {
    color: 'rgba(123, 123, 123, 0.5)', // Figma: text-[color:var(--text\/secondary,#7b7b7b)] opacity-50
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
    alignItems: 'flex-end',
    backgroundColor: colors.white,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    minHeight: 48, // Ensure consistent height
    borderTopLeftRadius: 20,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 32,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
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
    justifyContent: 'flex-start',
    minHeight: 34, // Ensure minimum height for proper centering
    position: 'relative',
  },
  placeholderText: {
    position: 'absolute',
    left: 8,
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: '#7B7B7B',
    pointerEvents: 'none',
    zIndex: 1,
  },
  placeholderCentered: {
    top: '50%',
    transform: [{ translateY: -11 }], // Half of lineHeight (22/2)
  },
  placeholderTop: {
    top: 8,
  },
  textInput: {
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22, // Slightly larger for better readability
    color: '#333333',
    padding: 0,
    margin: 0,
    textAlignVertical: 'top',
    includeFontPadding: false,
    ...(Platform.OS === 'web' && {
      // @ts-ignore - web-specific CSS properties
      overflow: 'auto' as any,
      resize: 'none' as any,
    }),
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 48,
    backgroundColor: '#B72DF2',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
