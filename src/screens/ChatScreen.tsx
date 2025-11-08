import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { ChatService, ChatResponse } from '../utils/chatService';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../utils/imageUtils';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
}

interface UserProfile {
  destinations: string;
  travel_style: string;
  surf_pref: string;
  extras: string;
}


export const ChatScreen: React.FC = () => {
  const { setCurrentStep } = useOnboarding();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Test API connection and initialize chat context on component mount
  useEffect(() => {
    const initializeChat = async () => {
      try {
        console.log('Testing API connection...');
        const health = await ChatService.healthCheck();
        console.log('API health check successful:', health);
        
        // Send initial context message (hidden from UI)
        console.log('Initializing chat with context...');
        const response = await ChatService.startNewChat({
          message: "Context: Matan Rabi, age 26, shortboarder, intermediate level surfer, 13 surf trips"
        });
        
        console.log('Chat initialized with response:', response);
        setChatId(response.chat_id || null);
        
        // Set the first message from Swelly's response
        setMessages([
          {
            id: '1',
            text: response.return_message,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              hour12: false 
            }),
          }
        ]);
        
      } catch (error) {
        console.error('API health check or chat initialization failed:', error);
        Alert.alert(
          'Connection Error',
          'Cannot connect to the backend server. Please check your internet connection and try again.',
          [{ text: 'OK' }]
        );
      } finally {
        setIsInitializing(false);
      }
    };
    
    initializeChat();
  }, []);

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputText.trim(),
      isUser: true,
      timestamp: new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      }),
    };

    console.log('Sending message:', userMessage.text);
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      let response: ChatResponse;
      
      if (chatId) {
        // Continue existing chat
        console.log('Continuing chat with ID:', chatId);
        response = await ChatService.continueChat(chatId, {
          message: userMessage.text,
        });
      } else {
        // This shouldn't happen since we initialize chat on mount, but fallback just in case
        console.log('Starting new chat (fallback)');
        response = await ChatService.startNewChat({
          message: userMessage.text,
        });
        console.log('New chat response:', response);
        setChatId(response.chat_id || null);
      }

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: response.return_message,
        isUser: false,
        timestamp: new Date().toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        }),
      };

      setMessages(prev => [...prev, botMessage]);

      // If chat is finished, save user profile and show completion message
      if (response.is_finished && response.data) {
        setUserProfile(response.data);
        setTimeout(() => {
          Alert.alert(
            'Chat Complete!',
            'Thanks for sharing your info! Swelly has everything he needs to help you plan your next surf trip.',
            [{ text: 'Awesome!', style: 'default' }]
          );
        }, 1000);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, userProfile, isInitializing, isLoading]);

  const renderUserProfile = (profile: UserProfile) => (
    <View key="user-profile" style={[styles.messageContainer, styles.botMessageContainer]}>
      <View style={[styles.messageBubble, styles.botMessageBubble, styles.profileBubble]}>
        <Text style={styles.profileTitle}>🏄‍♂️ Your Surf Profile</Text>
        <View style={styles.profileSection}>
          <Text style={styles.profileLabel}>📍 Destinations:</Text>
          <Text style={styles.profileValue}>{profile.destinations}</Text>
        </View>
        <View style={styles.profileSection}>
          <Text style={styles.profileLabel}>✈️ Travel Style:</Text>
          <Text style={styles.profileValue}>{profile.travel_style}</Text>
        </View>
        <View style={styles.profileSection}>
          <Text style={styles.profileLabel}>🌊 Surf Preferences:</Text>
          <Text style={styles.profileValue}>{profile.surf_pref}</Text>
        </View>
        <View style={styles.profileSection}>
          <Text style={styles.profileLabel}>🎯 Extras:</Text>
          <Text style={styles.profileValue}>{profile.extras}</Text>
        </View>
        <Text style={styles.profileFooter}>
          {/* Perfect! Now I can help you find the best surf spots and plan your next adventure! 🤙 */}
          Perfect! Now let's get you connected with other surfers to help you plan your next adventure! 🤙
        </Text>
      </View>
    </View>
  );

  const renderMessage = (message: Message) => (
    <View
      key={message.id}
      style={[
        styles.messageContainer,
        message.isUser ? styles.userMessageContainer : styles.botMessageContainer,
      ]}
    >
      <View
        style={[
          styles.messageBubble,
          message.isUser ? styles.userMessageBubble : styles.botMessageBubble,
        ]}
      >
        <View style={styles.messageTextContainer}>
          <Text style={message.isUser ? styles.userMessageText : styles.botMessageText}>
            {message.text}
          </Text>
        </View>
        <View style={styles.timestampContainer}>
          <Text style={[
            styles.timestamp,
            message.isUser ? styles.userTimestamp : styles.botTimestamp,
          ]}>
            {message.timestamp}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => {
                setCurrentStep(4); // Go back to onboarding step 4
                if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
                  window.location.href = '/'; // Navigate to main app
                }
              }}
            >
              <Ionicons name="chevron-back" size={24} color="#222B30" />
            </TouchableOpacity>
            
            <View style={styles.avatar}>
              <View style={styles.avatarImageContainer}>
                <Image
                  source={{ uri: getImageUrl('/Swelly avatar.png') }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              </View>
            </View>
          </View>
          
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>Swelly</Text>
            <Text style={styles.profileTagline}>Join the global surf travel community!</Text>
          </View>
          
          <TouchableOpacity style={styles.menuButton}>
            <Ionicons name="ellipsis-vertical" size={24} color="#222B30" />
          </TouchableOpacity>
        </View>
        
        <View style={styles.progressBar}>
          <View style={styles.progressFill} />
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
          {messages.map(renderMessage)}
          {userProfile && renderUserProfile(userProfile)}
          {(isLoading || isInitializing) && (
            <View style={[styles.messageContainer, styles.botMessageContainer]}>
              <View style={[styles.messageBubble, styles.botMessageBubble]}>
                <Text style={styles.botMessageText}>Swelly is typing...</Text>
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
    // backgroundColor: '#D3D3D3', // lightgray fallback
    position: 'relative',
  },
  avatarImageContainer: {
    position: 'absolute',
    width: 48 * 1.52147, // 152.147% of 48px
    height: 52 * 1.08344, // 108.344% of 52px
    left: -10.983,
    top: 0,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
      objectPosition: '0px 0px' as any,
      backgroundRepeat: 'no-repeat' as any,
    }),
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
  progressBar: {
    height: 4,
    width: 237,
    backgroundColor: '#BDBDBD',
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: 47,
    backgroundColor: '#B72DF2',
    borderRadius: 8,
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
  messageContainer: {
    marginBottom: 16,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
    paddingLeft: 16,
    paddingRight: 48,
  },
  botMessageContainer: {
    alignItems: 'flex-start',
    paddingLeft: 16,
    paddingRight: 48,
  },
  messageBubble: {
    maxWidth: 268,
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 16,
    flexDirection: 'column',
  },
  userMessageBubble: {
    backgroundColor: '#B72DF2',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 16,
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
  profileBubble: {
    backgroundColor: '#F0F8FF',
    borderColor: '#8B5CF6',
    borderWidth: 2,
    maxWidth: '90%',
  },
  profileTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#8B5CF6',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  profileLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B5CF6',
    marginBottom: 2,
  },
  profileValue: {
    fontSize: 14,
    color: colors.textDark,
    lineHeight: 20,
    paddingLeft: spacing.sm,
  },
  profileFooter: {
    fontSize: 14,
    color: '#8B5CF6',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
});
