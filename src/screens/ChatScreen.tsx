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
  ImageBackground,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { swellyService, SwellyChatResponse } from '../services/swelly/swellyService';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { supabaseDatabaseService } from '../services/database/supabaseDatabaseService';
import { MatchedUserCard } from '../components/MatchedUserCard';
import { messagingService } from '../services/messaging/messagingService';
import { findMatchingUsers } from '../services/matching/matchingService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  isMatchedUsers?: boolean; // Flag to indicate this message should render matched user cards
}



interface ChatScreenProps {
  onChatComplete?: () => void;
  conversationType?: 'onboarding' | 'trip-planning';
  onViewUserProfile?: (userId: string) => void;
  onStartConversation?: (userId: string) => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({ 
  onChatComplete,
  conversationType = 'onboarding',
  onViewUserProfile,
  onStartConversation,
}) => {
  const { setCurrentStep, formData } = useOnboarding();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  // Removed userProfile state - no longer rendering profile in chat
  const [isFinished, setIsFinished] = useState(false);
  const [inputHeight, setInputHeight] = useState(34); // Initial height for one line
  const [matchedUsers, setMatchedUsers] = useState<any[]>([]); // Store matched users for rendering cards
  const [destinationCountry, setDestinationCountry] = useState<string>(''); // Store destination for cards
  const scrollViewRef = useRef<ScrollView>(null);
  const textInputRef = useRef<TextInput>(null);

  // Calculate progress based on conversation length
  // Estimate: typical conversation is 6-10 message pairs (12-20 messages total)
  // Progress increases with each message exchange
  const calculateProgress = () => {
    if (isFinished) return 100; // Full progress when chat is complete
    
    const totalMessages = messages.length;
    // Estimate max messages for a typical conversation (can be adjusted)
    const estimatedMaxMessages = 20;
    
    // Progress starts at 5% (initial message) and increases with each message
    const baseProgress = 5;
    const progressPerMessage = (95 / estimatedMaxMessages); // Remaining 95% distributed
    
    const progress = Math.min(100, baseProgress + (totalMessages * progressPerMessage));
    return progress;
  };

  const progressPercentage = calculateProgress();

  // Test API connection and initialize chat context on component mount
  useEffect(() => {
    const initializeChat = async () => {
      try {
        console.log('Testing API connection...');
        const health = await swellyService.healthCheck();
        console.log('API health check successful:', health);
        
        let response: SwellyChatResponse;
        
        if (conversationType === 'trip-planning') {
          // Trip planning: Start with context about user's profile
          console.log('Initializing trip planning conversation...');
          
          // Build context message from user's profile
          const contextParts: string[] = [];
          if (formData.nickname) contextParts.push(`I'm ${formData.nickname}`);
          if (formData.age) contextParts.push(`${formData.age} years old`);
          if (formData.location) contextParts.push(`from ${formData.location}`);
          
          const boardTypeNames: { [key: number]: string } = {
            0: 'shortboard',
            1: 'midlength',
            2: 'longboard',
            3: 'soft top',
          };
          if (formData.boardType !== undefined) {
            contextParts.push(`surfing ${boardTypeNames[formData.boardType] || 'surfboard'}`);
          }
          
          if (formData.surfLevel !== undefined) {
            const levelNames = ['beginner', 'beginner-intermediate', 'intermediate', 'intermediate-advanced', 'advanced'];
            contextParts.push(`${levelNames[formData.surfLevel] || 'intermediate'} level`);
          }
          
          const contextMessage = contextParts.length > 0
            ? `Hi! ${contextParts.join(', ')}. I want to plan a new surf trip.`
            : 'Hi! I want to plan a new surf trip.';
          
          response = await swellyService.startTripPlanningConversation({
            message: contextMessage,
          });
        } else {
          // Onboarding: Send initial context message using actual onboarding data
          console.log('Initializing onboarding chat with user profile data...');
        console.log('Form data:', formData);
        
        // Use initializeWithProfile to build context from onboarding data
        // This will use the actual data collected during onboarding steps 1-4
          response = await swellyService.initializeWithProfile({
          nickname: formData.nickname,
          age: formData.age,
          boardType: formData.boardType,
          surfLevel: formData.surfLevel,
          travelExperience: formData.travelExperience,
        });
        }
        
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
  }, [formData, conversationType]); // Re-run if formData or conversationType changes

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
      let response: SwellyChatResponse;
      
      if (chatId) {
        // Continue existing chat
        console.log('Continuing chat with ID:', chatId);
        if (conversationType === 'trip-planning') {
          response = await swellyService.continueTripPlanningConversation(chatId, {
            message: userMessage.text,
          });
        } else {
        response = await swellyService.continueConversation(chatId, {
          message: userMessage.text,
        });
        }
      } else {
        // This shouldn't happen since we initialize chat on mount, but fallback just in case
        console.log('Starting new chat (fallback)');
        if (conversationType === 'trip-planning') {
          response = await swellyService.startTripPlanningConversation({
            message: userMessage.text,
          });
        } else {
        response = await swellyService.startNewConversation({
          message: userMessage.text,
        });
        }
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

      // If chat is finished, handle completion based on conversation type
      console.log('Response check:', { 
        is_finished: response.is_finished, 
        has_data: !!response.data,
        data: response.data 
      });
      
      if (response.is_finished && response.data) {
        setIsFinished(true);
        
        if (conversationType === 'trip-planning') {
          // Trip planning: Trigger matching algorithm
          try {
            // Get current user ID
            const currentUser = await supabaseAuthService.getCurrentUser();
            if (!currentUser || !currentUser.id) {
              throw new Error('User not authenticated');
            }
            
            // Show "finding matches..." message
            const findingMatchesMessage: Message = {
              id: (Date.now() + 2).toString(),
              text: 'Finding the perfect surfers for you...',
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
              }),
            };
            setMessages(prev => [...prev, findingMatchesMessage]);
            
            // Find matching users
            console.log('Finding matches with data:', response.data);
            console.log('Query filters from response:', response.data.queryFilters);
            const requestData = {
              destination_country: response.data.destination_country,
              area: response.data.area || null,
              budget: response.data.budget || null,
              destination_known: response.data.destination_known || false,
              purpose: response.data.purpose || {
                purpose_type: 'general_guidance',
                specific_topics: [],
              },
              non_negotiable_criteria: response.data.non_negotiable_criteria || null,
              user_context: response.data.user_context || null,
              queryFilters: response.data.queryFilters || null, // Pass AI-extracted query filters
              filtersFromNonNegotiableStep: response.data.filtersFromNonNegotiableStep || false, // Track if filters came from non-negotiable step
            };
            console.log('Request data being passed to findMatchingUsers:', JSON.stringify(requestData, null, 2));
            console.log('queryFilters in request:', requestData.queryFilters);
            const matchedUsers = await findMatchingUsers(requestData, currentUser.id);
            
            console.log('Matched users found:', matchedUsers.length, matchedUsers);
            console.log('Filters from non-negotiable step:', response.data.filtersFromNonNegotiableStep);
            
            // Display matched users
            if (matchedUsers.length > 0) {
              const matchesMessage: Message = {
                id: (Date.now() + 3).toString(),
                text: `Found ${matchedUsers.length} awesome match${matchedUsers.length > 1 ? 'es' : ''} for you!`,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: false 
                }),
                isMatchedUsers: true, // Flag to indicate this message has cards
              };
              setMessages(prev => [...prev, matchesMessage]);
              
              // Store matched users and destination for rendering cards
              setMatchedUsers(matchedUsers);
              setDestinationCountry(response.data.destination_country);
            } else {
              // Different message based on whether filters came from non-negotiable step
              const noMatchesMessage: Message = {
                id: (Date.now() + 3).toString(),
                text: response.data.filtersFromNonNegotiableStep
                  ? "Sorry, I couldn't find any surfers that match all your non-negotiable criteria. Would you like to relax some of those requirements?"
                  : "Hmm, couldn't find any perfect matches right now, but don't worry! More surfers are joining every day. Check back soon!",
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: false 
                }),
              };
              setMessages(prev => [...prev, noMatchesMessage]);
            }
          } catch (error) {
            console.error('Error finding matching users:', error);
            console.error('Error details:', error);
            const errorMessage: Message = {
              id: (Date.now() + 2).toString(),
              text: `Sorry, there was an error finding matches: ${error instanceof Error ? error.message : String(error)}. Please try again later.`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
              }),
            };
            setMessages(prev => [...prev, errorMessage]);
          }
        } else {
          // Onboarding: Save user profile and Swelly conversation results to database
          // Show "creating profile..." message
          const creatingProfileMessage: Message = {
            id: (Date.now() + 2).toString(),
            text: 'Creating your profile...',
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              hour12: false 
            }),
          };
          setMessages(prev => [...prev, creatingProfileMessage]);
        
        // Save Swelly conversation results to surfers table
        try {
          console.log('Saving Swelly conversation results to database:', response.data);
          await supabaseDatabaseService.saveSurfer({
            onboardingSummaryText: response.data.onboarding_summary_text,
            destinationsArray: response.data.destinations_array,
            travelType: response.data.travel_type,
            travelBuddies: response.data.travel_buddies,
            lifestyleKeywords: response.data.lifestyle_keywords,
            waveTypeKeywords: response.data.wave_type_keywords,
          });
          console.log('Swelly conversation results saved successfully');
        } catch (error) {
          console.error('Error saving Swelly conversation results:', error);
          // Don't block the UI if saving fails, but log the error
        }

        // Save surf trip plan to surf_trip_plans table if provided
        if (response.data.surf_trip_plan) {
          try {
            console.log('Saving surf trip plan to database:', response.data.surf_trip_plan);
            await supabaseDatabaseService.saveSurfTripPlan({
              destinations: response.data.surf_trip_plan.destinations,
              timeInDays: response.data.surf_trip_plan.time_in_days,
              travelType: response.data.travel_type,
              travelBuddies: response.data.travel_buddies,
              lifestyleKeywords: response.data.lifestyle_keywords,
              waveTypeKeywords: response.data.wave_type_keywords,
              summaryText: response.data.surf_trip_plan.summary_text,
            });
            console.log('Surf trip plan saved successfully');
          } catch (error) {
            console.error('Error saving surf trip plan:', error);
            // Don't block the UI if saving fails, but log the error
          }
        }
        
          // Navigate to profile screen after a short delay (onboarding only)
        setTimeout(() => {
            // Mark onboarding as complete and navigate to profile
            onChatComplete?.();
          }, 1500);
        }
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
  }, [messages, isInitializing, isLoading]);

  // Reset input height when text is cleared
  useEffect(() => {
    if (!inputText.trim()) {
      setInputHeight(34);
    }
  }, [inputText]);


  const handleSendMessage = async (userId: string) => {
    // Navigate to conversation (conversation will be created when first message is sent)
    if (onStartConversation) {
      onStartConversation(userId);
    } else {
      // Fallback: navigate back to conversations
      onChatComplete?.();
    }
  };

  const handleViewProfile = (userId: string) => {
    if (onViewUserProfile) {
      onViewUserProfile(userId);
    } else {
      // Fallback: show alert or navigate
      Alert.alert('Profile', `View profile for user: ${userId}`);
    }
  };

  const renderMessage = (message: Message) => {
    // If this message has matched users, render cards instead
    if (message.isMatchedUsers && matchedUsers.length > 0) {
      return (
        <View key={message.id} style={styles.matchedUsersContainer}>
          <View style={styles.messageContainer}>
            <View style={styles.botMessageContainer}>
              <View style={styles.botMessageBubble}>
                <View style={styles.messageTextContainer}>
                  <Text style={styles.botMessageText}>
                    {message.text}
                  </Text>
        </View>
                <View style={styles.timestampContainer}>
                  <Text style={styles.botTimestamp}>
                    {message.timestamp}
        </Text>
                </View>
              </View>
            </View>
          </View>
          
          {/* Render matched user cards */}
          <View style={styles.matchedUsersCards}>
            {matchedUsers.map((user) => (
              <MatchedUserCard
                key={user.user_id}
                user={user}
                destinationCountry={destinationCountry}
                onSendMessage={handleSendMessage}
                onViewProfile={handleViewProfile}
              />
            ))}
      </View>
    </View>
  );
    }

    // Regular message rendering
    return (
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
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => {
                // If onChatComplete is provided, it means we're in post-onboarding mode
                if (onChatComplete) {
                  onChatComplete(); // Go to conversations list
                } else {
                  setCurrentStep(4); // Go back to onboarding step 4
                  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
                    window.location.href = '/'; // Navigate to main app
                  }
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
          <View style={[styles.progressFill, { width: `${progressPercentage}%` }]} />
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
          {messages.map(renderMessage)}
          {(isLoading || isInitializing) && (
            <View style={[styles.messageContainer, styles.botMessageContainer]}>
              <View style={[styles.messageBubble, styles.botMessageBubble]}>
                <Text style={styles.botMessageText}>Swelly is typing...</Text>
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
    paddingTop: 40,
    paddingBottom: 16,
    paddingHorizontal: 0,
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: spacing.md,
    marginBottom: 12,
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
    width: 62,
    height: 68,
    aspectRatio: 62 / 68,
    borderRadius: 31,
    overflow: 'hidden',
    // backgroundColor: '#D3D3D3', // lightgray fallback
    position: 'relative',
  },
  avatarImageContainer: {
    position: 'absolute',
    width: 62 * 1.52147, // 152.147% of 62px
    height: 68 * 1.08344, // 108.344% of 68px
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
    backgroundColor: '#B72DF2',
    borderRadius: 8,
    ...(Platform.OS === 'web' && {
      // @ts-ignore - web-specific CSS property
      transition: 'width 0.3s ease',
    }),
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
    gap: 16,
  },
  matchedUsersContainer: {
    marginBottom: 16,
    paddingHorizontal: spacing.md,
  },
  matchedUsersCards: {
    marginTop: 12,
    gap: 16,
  },
  messageContainer: {
    marginBottom: 4,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
    paddingLeft: 48,
    paddingRight: 16,
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 2, // Pointy edge on the right
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
    gap: 10,
  },
  userMessageText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 18,
  },
  botMessageText: {
    color: '#333333',
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 18,
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

