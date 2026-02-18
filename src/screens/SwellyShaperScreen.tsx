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
  ImageBackground,
  Animated,
} from 'react-native';
import { TextInput as PaperTextInput } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { swellyShaperService } from '../services/swelly/swellyShaperService';
import { getImageUrl } from '../services/media/imageService';
import { UserProfileCard } from '../components/UserProfileCard';
import { supabaseDatabaseService, SupabaseSurfer } from '../services/database/supabaseDatabaseService';
import { supabase } from '../config/supabase';
import { MessageListSkeleton } from '../components/skeletons';
import { SKELETON_DELAY_MS } from '../constants/loading';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  showProfileCard?: boolean; // Flag to show profile card after this message
}

interface SwellyShaperScreenProps {
  onBack: () => void;
  onViewProfile?: () => void; // Callback when user wants to view profile
}

const SWELLY_SHAPER_CHAT_ID_KEY = '@swellyo_swelly_shaper_chat_id';

export const SwellyShaperScreen: React.FC<SwellyShaperScreenProps> = ({ onBack, onViewProfile }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showSkeletons, setShowSkeletons] = useState(false); // Delayed skeleton display to avoid flicker
  const [inputHeight, setInputHeight] = useState(25); // Initial height for one line
  const [profileData, setProfileData] = useState<SupabaseSurfer | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const textInputRef = useRef<any>(null);

  // Load chat_id from storage and profile data on mount
  useEffect(() => {
    const initializeChat = async () => {
      try {
        // Load saved chat_id
        const savedChatId = await AsyncStorage.getItem(SWELLY_SHAPER_CHAT_ID_KEY);
        const initialMessages: Message[] = [];
        
        // Always add static welcome message - this is just UI, not part of the conversation
        initialMessages.push({
          id: 'welcome',
          text: "Let's shape that profile! Let me know what you would like to edit!",
          isUser: false,
          timestamp: new Date().toISOString(),
        });

        if (savedChatId) {
          // Restore chat_id to service
          (swellyShaperService as any).chatId = savedChatId;
          
          try {
            // Load chat history from database
            const historyResponse = await swellyShaperService.getChatHistory(savedChatId) as any;
            if (historyResponse.messages && Array.isArray(historyResponse.messages)) {
              // Convert OpenAI format messages to UI Message format
              // Skip system messages and the initial user message if it's the welcome
              historyResponse.messages.forEach((msg: any, index: number) => {
                if (msg.role === 'system') return; // Skip system messages
                
                // Skip the first user message if it's the welcome message
                if (index === 1 && msg.role === 'user' && 
                    (msg.content.includes("Let's shape") || msg.content.includes("welcome"))) {
                  return;
                }
                
                // Extract text content - assistant messages may be JSON, extract return_message
                let textContent = msg.content;
                if (msg.role === 'assistant') {
                  try {
                    // Try to parse as JSON to extract return_message
                    const parsed = JSON.parse(msg.content);
                    if (parsed.return_message) {
                      textContent = parsed.return_message;
                    }
                  } catch (e) {
                    // If not JSON, use content as-is
                    textContent = msg.content;
                  }
                }
                
                // Convert to Message format
                const message: Message = {
                  id: `history-${index}-${Date.now()}`,
                  text: textContent,
                  isUser: msg.role === 'user',
                  timestamp: new Date().toISOString(),
                };
                
                initialMessages.push(message);
              });
              
              console.log('[SwellyShaperScreen] Loaded chat history:', initialMessages.length, 'messages');
            }
          } catch (historyError) {
            console.error('[SwellyShaperScreen] Error loading chat history:', historyError);
            // Continue with just welcome message if history load fails
          }
        } else {
          // Reset chat to start fresh
          swellyShaperService.resetChat();
        }

        // Load current user's profile data
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const surferData = await supabaseDatabaseService.getSurferByUserId(user.id);
          setProfileData(surferData);
        }

        setMessages(initialMessages);
      } catch (error) {
        console.error('Error initializing chat:', error);
        swellyShaperService.resetChat();
        // Set static welcome message even on error
        setMessages([{
          id: 'welcome',
          text: "Let's shape that profile! Let me know what you would like to edit!",
          isUser: false,
          timestamp: new Date().toISOString(),
        }]);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeChat();
  }, []);

  // Delay showing skeletons to avoid flicker for fast loads
  useEffect(() => {
    if (isInitializing) {
      const skeletonTimeout = setTimeout(() => {
        setShowSkeletons(true);
      }, SKELETON_DELAY_MS);

      return () => {
        clearTimeout(skeletonTimeout);
      };
    } else {
      setShowSkeletons(false);
    }
  }, [isInitializing]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage = inputText.trim();
    setInputText('');
    setInputHeight(25); // Reset input height to initial size after sending
    
    // Add user message
    const userMsg: Message = {
      id: Date.now().toString(),
      text: userMessage,
      isUser: true,
      timestamp: new Date().toISOString(),
    };
    
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Process message and get response
      const response = await swellyShaperService.processMessage(userMessage);
      
      // Save chat_id to AsyncStorage if we have one
      const chatId = (swellyShaperService as any).chatId;
      if (chatId) {
        await AsyncStorage.setItem(SWELLY_SHAPER_CHAT_ID_KEY, chatId);
      }
      
      // Reload profile data if profile was updated (before adding message to prevent typing indicator)
      if (response.updatedFields && response.updatedFields.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const surferData = await supabaseDatabaseService.getSurferByUserId(user.id);
          setProfileData(surferData);
        }
      }

      // Set loading to false BEFORE adding message to prevent typing indicator flash
      setIsLoading(false);

      // Add bot response
      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        text: response.message,
        isUser: false,
        timestamp: new Date().toISOString(),
        showProfileCard: response.updatedFields && response.updatedFields.length > 0, // Show card if profile was updated
      };
      
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      console.error('Error processing message:', error);
      setIsLoading(false); // Set loading to false on error too
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        text: "Sorry, I encountered an error. Please try again.",
        isUser: false,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Typing animation component
  const TypingIndicator = () => {
    const dot1 = useRef(new Animated.Value(0)).current;
    const dot2 = useRef(new Animated.Value(0)).current;
    const dot3 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
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
    }, []);

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
      <View style={styles.typingContainer}>
        <Animated.View style={[styles.typingDot, { opacity: opacity1 }]} />
        <Animated.View style={[styles.typingDot, { opacity: opacity2 }]} />
        <Animated.View style={[styles.typingDot, { opacity: opacity3 }]} />
      </View>
    );
  };

  const renderMessage = (message: Message) => {
    // Check if this is the welcome message
    const isWelcomeMessage = message.id === 'welcome';

    if (isWelcomeMessage) {
      // Welcome message with profile image on the right - always shows static text
      return (
        <View key={message.id} style={styles.botMessageContainer}>
          <View style={styles.botMessageBubble}>
            <Text style={styles.botMessageText}>Let's shape that profile! Let me know what you would like to edit!</Text>
            <View style={styles.botMessageImageContainer}>
              <Image
                source={{ uri: getImageUrl('/Swelly Shaper.png') }}
                style={styles.botMessageImage}
                resizeMode="cover"
              />
            </View>
          </View>
        </View>
      );
    }

    // Regular message rendering - match ChatScreen style
    return (
      <React.Fragment key={message.id}>
        <View
          style={[
            styles.messageContainer,
            message.isUser ? styles.userMessageContainer : styles.normalBotMessageContainer,
          ]}
        >
          <View
            style={[
              styles.messageBubble,
              message.isUser ? styles.userMessageBubble : styles.normalBotMessageBubble,
            ]}
          >
            <View style={styles.messageTextContainer}>
              <Text style={message.isUser ? styles.userMessageText : styles.normalBotMessageText}>
                {message.text}
              </Text>
            </View>
            <View style={styles.timestampContainer}>
              <Text style={[
                styles.timestamp,
                message.isUser ? styles.userTimestamp : styles.botTimestamp,
              ]}>
                {formatTime(message.timestamp)}
              </Text>
            </View>
          </View>
        </View>
        {/* Show UserProfileCard after successful profile update - rendered separately to not affect message layout */}
        {message.showProfileCard && profileData && (
          <View style={styles.profileCardContainer}>
            <UserProfileCard 
              profileData={profileData}
              onPress={() => {
                console.log('[SwellyShaperScreen] View Profile button pressed');
                console.log('[SwellyShaperScreen] onViewProfile exists:', !!onViewProfile);
                console.log('[SwellyShaperScreen] onViewProfile type:', typeof onViewProfile);
                // Navigate to profile screen
                if (onViewProfile) {
                  console.log('[SwellyShaperScreen] Calling onViewProfile()');
                  onViewProfile();
                } else {
                  console.log('[SwellyShaperScreen] onViewProfile not provided, calling onBack()');
                  // Fallback to onBack if onViewProfile not provided
                  onBack();
                }
              }}
            />
          </View>
        )}
      </React.Fragment>
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
              <View style={styles.avatarRing}>
                <Image
                  source={{ uri: getImageUrl('/Ellipse 11.svg') }}
                  style={styles.ellipseBackground}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.avatarImageContainer}>
                <View style={styles.avatarImageWrapper}>
                  <Image
                    source={{ uri: getImageUrl('/Swelly Shaper.png') }}
                    style={styles.avatarImage}
                    resizeMode="cover"
                  />
                </View>
              </View>
            </View>
          </View>
          
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>Swelly Shaper</Text>
            <Text style={styles.profileTagline}>New shape, new you! Let's edit that profile!</Text>
          </View>
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
            {isInitializing && showSkeletons ? (
              <MessageListSkeleton count={5} />
            ) : (
              <>
                {messages.map(renderMessage)}
                {isLoading && (
                  <View style={[styles.messageContainer, styles.normalBotMessageContainer]}>
                    <View style={[styles.messageBubble, styles.normalBotMessageBubble]}>
                      <View style={styles.messageTextContainer}>
                        <TypingIndicator />
                      </View>
                    </View>
                  </View>
                )}
              </>
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
                onSubmitEditing={() => {
                  // On native: Send button on keyboard sends message
                  if (Platform.OS !== 'web') {
                    handleSend();
                  }
                }}
                returnKeyType="send" // Show "Send" button on native keyboards
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
                  // Best practice: Enter sends, Shift+Enter creates new line
                  if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter') {
                    const isShiftPressed = (e.nativeEvent as any).shiftKey;
                    
                    if (!isShiftPressed) {
                      // Enter without Shift: send message
                      e.preventDefault();
                      handleSend();
                    }
                    // Shift+Enter: allow new line (default behavior, don't prevent)
                  }
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
                    minHeight: 25.
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
                onPress={handleSend}
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerContainer: {
    backgroundColor: colors.white,
    paddingTop: 44,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  backButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 62,
    height: 68,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden', // Clip everything to container bounds
  },
  avatarRing: {
    position: 'absolute',
    // Based on Figma: inset-[9.88%_2.7%_2.47%_2.7%]
    // This defines the visible ellipse area within the container
    top: '9.88%',
    left: '2.7%',
    right: '2.7%',
    bottom: '2.47%',
    borderRadius: 31,
    overflow: 'visible',
    zIndex: 0,
  },
  ellipseBackground: {
    position: 'absolute',
    // Based on Figma: inset-[-2.52%_-2.56%] means the ellipse extends beyond the ring container
    width: '105.04%', // 100% + (2.52% * 2)
    height: '105.04%',
    top: '-2.52%',
    left: '-2.56%',
    zIndex: 0,
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any,
    }),
  },
  avatarImageContainer: {
    position: 'absolute',
    // Based on Figma mask-size-[59.78px_67.42px] - this is the actual visible ellipse size
    // This container clips the image to only show within the ellipse bounds
    width: 59.78, // Based on Figma mask-size
    height: 67.42, // Based on Figma mask-size
    // Center it within the avatar container to match the ellipse position
    left: (62 - 59.78) / 2, // Center horizontally
    top: (68 - 67.42) / 2, // Center vertically
    // Clip to ellipse shape - this ensures image is only visible inside the ellipse
    borderRadius: 31,
    overflow: 'hidden',
    zIndex: 1,
  },
  avatarImageWrapper: {
    // Wrapper to position the larger image correctly
    position: 'absolute',
    width: 162,
    height: 143,
    // Position based on Figma mask-position: [26.26px_12.278px]
    // This offsets the image to show the correct part of the character
    left: -26.26,
    top: -12.278,
  },
  avatarImage: {
    width: 162,
    height: 143,
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
    }),
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : undefined,
    lineHeight: 24,
    color: '#333333',
    marginBottom: 2,
  },
  profileTagline: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 15,
    color: '#868686',
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
  },
  messagesContent: {
    paddingTop: 12,
    paddingHorizontal: 0,
    paddingBottom: 16,
    alignItems: 'center',
    gap: 16,
  },
  botMessageContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  botMessageBubble: {
    width: 361,
    backgroundColor: 'rgba(202, 162, 223, 0.10)',
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 32,
    paddingLeft: 24,
    paddingRight: 8,
    overflow: 'visible',
    // Flexbox properties matching CSS
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    
  },
  botMessageText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 15,
    color: '#333333',
    alignSelf: 'center',
    flex: 1,
  },
  botMessageImageContainer: {
    alignSelf: 'flex-end',
    width: 90,
    height: 79,
    flexShrink: 0,
    ...(Platform.OS === 'web' && {
      aspectRatio: '90/79' as any,
    }),
    overflow: 'hidden',
    borderRadius: 8,
  },
  botMessageImage: {
    width: 90,
    height: 79,
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
    }),
  },
  messageContainer: {
    marginBottom: 4,
  },
  userMessageContainer: {
    display: 'flex',
    paddingTop: 0,
    paddingRight: 16,
    paddingBottom: 0,
    paddingLeft: 48,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 10,
    alignSelf: 'stretch',
  },
  userMessageBubble: {
    backgroundColor: '#B72DF2',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 2, // Pointy edge on the right
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  normalBotMessageContainer: {
    display: 'flex',
    paddingTop: 0,
    paddingRight: 48,
    paddingBottom: 0,
    paddingLeft: 16,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    alignSelf: 'stretch',
  },
  messageBubble: {
    maxWidth: 268,
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 16,
    flexDirection: 'column',
  },
  normalBotMessageBubble: {
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
    gap: 10,
  },
  userMessageText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
  },
  normalBotMessageText: {
    color: '#333333',
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
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
  profileCardContainer: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    marginLeft: 20, // 10px gap from left side
    marginRight: 20, // 10px gap from right side
    alignSelf: 'stretch', // Ensure it stretches to full width minus margins
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 228,
    pointerEvents: 'none',
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
    paddingVertical: 4,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333333',
  },
});
