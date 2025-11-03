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
} from 'react-native';
import { Text } from '../components/Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { ChatService, ChatResponse } from '../utils/chatService';
import { useOnboarding } from '../context/OnboardingContext';

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
        <Text style={message.isUser ? styles.userMessageText : styles.botMessageText}>
          {message.text}
        </Text>
        <Text style={styles.timestamp}>{message.timestamp}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => {
            setCurrentStep(3); // Go back to onboarding step 3
            if (Platform.OS === 'web') {
              window.location.href = '/'; // Navigate to main app
            }
          }}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>S</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>Swelly</Text>
            <Text style={styles.profileTagline}>Ride the waves, we handle the rest</Text>
            <View style={styles.progressBar}>
              <View style={styles.progressFill} />
            </View>
          </View>
        </View>
        
        <TouchableOpacity style={styles.menuButton}>
          <Text style={styles.menuIcon}>⋮</Text>
        </TouchableOpacity>
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
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.attachButton}>
            <Text style={styles.attachIcon}>+</Text>
          </TouchableOpacity>
          
          <TextInput
            style={styles.textInput}
            placeholder="Type your message.."
            placeholderTextColor="#999"
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
          
          <TouchableOpacity 
            style={styles.sendButton}
            onPress={sendMessage}
            disabled={!inputText.trim() || isLoading}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
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
  header: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomLeftRadius: borderRadius.medium,
    borderBottomRightRadius: borderRadius.medium,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  backButton: {
    marginRight: spacing.sm,
  },
  backIcon: {
    fontSize: 20,
    color: colors.black,
  },
  profileSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  avatarText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#8B5CF6',
    marginBottom: 2,
  },
  profileTagline: {
    fontSize: 12,
    color: '#999',
    marginBottom: spacing.xs,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#E5E5E5',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: '30%',
    backgroundColor: '#8B5CF6',
  },
  menuButton: {
    marginLeft: spacing.sm,
  },
  menuIcon: {
    fontSize: 18,
    color: colors.black,
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
    marginBottom: spacing.md,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
  },
  botMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: spacing.md,
    borderRadius: borderRadius.medium,
    position: 'relative',
  },
  userMessageBubble: {
    backgroundColor: '#8B5CF6',
    borderBottomRightRadius: 4,
  },
  botMessageBubble: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#8B5CF6',
    borderBottomLeftRadius: 4,
  },
  userMessageText: {
    color: colors.white,
    fontSize: 16,
    lineHeight: 22,
  },
  botMessageText: {
    color: colors.textDark,
    fontSize: 16,
    lineHeight: 22,
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  attachButton: {
    marginRight: spacing.sm,
    padding: spacing.sm,
  },
  attachIcon: {
    fontSize: 20,
    color: colors.black,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F8F8F8',
    borderRadius: borderRadius.large,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    maxHeight: 100,
    marginRight: spacing.sm,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendIcon: {
    fontSize: 18,
    color: colors.white,
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
