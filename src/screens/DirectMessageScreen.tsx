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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { messagingService, Message } from '../services/messaging/messagingService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';

interface DirectMessageScreenProps {
  conversationId: string;
  otherUserName: string;
  otherUserAvatar: string | null;
  onBack?: () => void;
}

export const DirectMessageScreen: React.FC<DirectMessageScreenProps> = ({
  conversationId,
  otherUserName,
  otherUserAvatar,
  onBack,
}) => {
  // Debug: Log avatar URL
  useEffect(() => {
    console.log('DirectMessageScreen - otherUserAvatar:', otherUserAvatar);
    console.log('DirectMessageScreen - otherUserName:', otherUserName);
  }, [otherUserAvatar, otherUserName]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMessages, setIsFetchingMessages] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

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

    loadMessages();

    // Mark conversation as read
    messagingService.markAsRead(conversationId).catch(err => {
      console.error('Error marking as read:', err);
    });

    // Subscribe to new messages
    const unsubscribe = messagingService.subscribeToMessages(
      conversationId,
      (newMessage) => {
        // Check if message already exists (avoid duplicates)
        setMessages((prev) => {
          const exists = prev.some(msg => msg.id === newMessage.id);
          if (exists) {
            return prev;
          }
          return [...prev, newMessage];
        });
        messagingService.markAsRead(conversationId, newMessage.id).catch(err => {
          console.error('Error marking message as read:', err);
        });
        setTimeout(() => scrollToBottom(), 100);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [conversationId]);

  const loadMessages = async () => {
    try {
      setIsFetchingMessages(true);
      const msgs = await messagingService.getMessages(conversationId);
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
    
    // Optimistic update: Add message immediately to UI
    const optimisticMessage: Message = {
      id: tempId,
      conversation_id: conversationId,
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
      // Send message to server
      const sentMessage = await messagingService.sendMessage(conversationId, messageText);
      
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
    
    return (
      <View
        key={message.id}
        style={[
          styles.messageContainer,
          isOwnMessage ? styles.userMessageContainer : styles.botMessageContainer,
        ]}
      >
        {/* Show other user's avatar for received messages */}
        {!isOwnMessage && (
          <View style={styles.messageAvatarContainer}>
            {otherUserAvatar ? (
              <Image
                source={{ uri: otherUserAvatar }}
                style={styles.messageAvatar}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.messageAvatar, styles.messageAvatarPlaceholder]}>
                <Text style={styles.messageAvatarPlaceholderText}>
                  {otherUserName.charAt(0).toUpperCase()}
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
          <View style={styles.messageTextContainer}>
            <Text style={isOwnMessage ? styles.userMessageText : styles.botMessageText}>
              {message.body || ''}
            </Text>
          </View>
          <View style={styles.timestampContainer}>
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
            
            <View style={styles.avatar}>
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
            </View>
          </View>
          
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{otherUserName}</Text>
            <Text style={styles.profileTagline}>Online</Text>
          </View>
          
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
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {isFetchingMessages ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.brandTeal} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No messages yet. Say hi! 👋</Text>
            </View>
          ) : (
            messages.map(renderMessage)
          )}
          {isLoading && (
            <View style={[styles.messageContainer, styles.botMessageContainer]}>
              <View style={[styles.messageBubble, styles.botMessageBubble]}>
                <Text style={styles.botMessageText}>Sending...</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input Area */}
        <View style={styles.inputWrapper}>
          <View style={styles.attachButtonWrapper}>
            <TouchableOpacity style={styles.attachButton}>
              <Ionicons name="add" size={28} color="#222B30" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.inputContainer}>
            <View style={styles.inputInnerContainer}>
              <TextInput
                style={styles.textInput}
                placeholder="Type your message.."
                placeholderTextColor="#7B7B7B"
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={500}
                onSubmitEditing={sendMessage}
                returnKeyType="send"
                blurOnSubmit={false}
                onKeyPress={(e) => {
                  if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !(e.nativeEvent as any).shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
            </View>
            
            <TouchableOpacity 
              style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
              onPress={sendMessage}
              disabled={!inputText.trim() || isLoading}
            >
              <Ionicons name="mic" size={24} color="#FFFFFF" />
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
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingLeft: 16,
    paddingRight: 48,
    marginBottom: 16,
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
    borderTopLeftRadius: 2,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
    }),
  },
  messageTextContainer: {
    marginBottom: 10,
  },
  userMessageText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 16,
  },
  botMessageText: {
    color: '#333333',
    fontSize: 16,
    fontWeight: '500',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 16,
  },
  timestampContainer: {
    alignItems: 'flex-start',
  },
  timestamp: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20,
  },
  userTimestamp: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  botTimestamp: {
    color: 'rgba(123, 123, 123, 0.5)',
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
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 7,
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
  },
  textInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: '#333333',
    maxHeight: 100,
    padding: 0,
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
