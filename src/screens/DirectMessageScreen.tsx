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
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMessages, setIsFetchingMessages] = useState(true);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadMessages();

    // Mark conversation as read
    messagingService.markAsRead(conversationId);

    // Subscribe to new messages
    const unsubscribe = messagingService.subscribeToMessages(
      conversationId,
      (newMessage) => {
        setMessages((prev) => [...prev, newMessage]);
        messagingService.markAsRead(conversationId, newMessage.id);
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
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setIsFetchingMessages(false);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const messageText = inputText.trim();
    setInputText('');
    setIsLoading(true);

    try {
      await messagingService.sendMessage(conversationId, messageText);
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('Error sending message:', error);
      setInputText(messageText);
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.textDark} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            {otherUserAvatar ? (
              <Image source={{ uri: otherUserAvatar }} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarPlaceholderText}>
                  {otherUserName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.headerName}>{otherUserName}</Text>
          </View>

          <View style={styles.headerRight} />
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={scrollToBottom}
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
            messages.map((message) => {
              const isOwnMessage = message.sender_id !== conversationId;
              return (
                <View
                  key={message.id}
                  style={[
                    styles.messageWrapper,
                    isOwnMessage ? styles.ownMessageWrapper : styles.otherMessageWrapper,
                  ]}
                >
                  {!isOwnMessage && otherUserAvatar && (
                    <Image source={{ uri: otherUserAvatar }} style={styles.messageAvatar} />
                  )}
                  {!isOwnMessage && !otherUserAvatar && (
                    <View style={[styles.messageAvatar, styles.avatarPlaceholder]}>
                      <Text style={styles.avatarPlaceholderTextSmall}>
                        {otherUserName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}

                  <View
                    style={[
                      styles.messageBubble,
                      isOwnMessage ? styles.ownMessage : styles.otherMessage,
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        isOwnMessage ? styles.ownMessageText : styles.otherMessageText,
                      ]}
                    >
                      {message.body}
                    </Text>
                    <Text
                      style={[
                        styles.timeText,
                        isOwnMessage ? styles.ownTimeText : styles.otherTimeText,
                      ]}
                    >
                      {formatTime(message.created_at)}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Input */}
        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="Type a message..."
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              placeholderTextColor={colors.textSecondary}
            />
            <TouchableOpacity
              onPress={sendMessage}
              disabled={!inputText.trim() || isLoading}
              style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons name="send" size={20} color={colors.white} />
              )}
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
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.backgroundGray,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.md,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: spacing.sm,
  },
  headerName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textDark,
  },
  headerRight: {
    width: 40,
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  messagesContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexGrow: 1,
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
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    alignItems: 'flex-end',
  },
  ownMessageWrapper: {
    justifyContent: 'flex-end',
  },
  otherMessageWrapper: {
    justifyContent: 'flex-start',
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: spacing.sm,
  },
  avatarPlaceholder: {
    backgroundColor: colors.brandTeal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarPlaceholderText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  avatarPlaceholderTextSmall: {
    color: colors.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  messageBubble: {
    maxWidth: '75%',
    borderRadius: borderRadius.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ownMessage: {
    backgroundColor: colors.brandTeal,
    borderBottomRightRadius: 4,
  },
  otherMessage: {
    backgroundColor: colors.backgroundMedium,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    ...typography.body,
    marginBottom: 2,
  },
  ownMessageText: {
    color: colors.white,
  },
  otherMessageText: {
    color: colors.textDark,
  },
  timeText: {
    fontSize: 10,
    marginTop: 2,
  },
  ownTimeText: {
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'right',
  },
  otherTimeText: {
    color: colors.textSecondary,
  },
  inputContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.backgroundGray,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.backgroundGray,
    borderRadius: borderRadius.large,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textDark,
    maxHeight: 100,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandTeal,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
