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
  Animated,
} from 'react-native';
import { TextInput as PaperTextInput } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { swellyService, SwellyChatResponse } from '../services/swelly/swellyService';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { MatchedUserCard } from '../components/MatchedUserCard';
import { messagingService } from '../services/messaging/messagingService';
import { findMatchingUsers } from '../services/matching/matchingService';
import { findMatchingUsersV3 } from '../services/matching/matchingServiceV3';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { MatchedUser, TripPlanningRequest } from '../types/tripPlanning';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  isMatchedUsers?: boolean; // Flag to indicate this message should render matched user cards
}

/**
 * Generate question for partial matches - ask user if they want to see them
 */
function generatePartialMatchQuestion(
  matchedUsers: MatchedUser[], 
  request: TripPlanningRequest, 
  quality: NonNullable<MatchedUser['matchQuality']>
): string {
  const firstMatch = matchedUsers[0];
  const differenceParts: string[] = [];

  // Build description of what was found vs what was requested
  if (quality.differences.age) {
    const { requested, found } = quality.differences.age;
    const requestedStr = Array.isArray(requested) 
      ? `${requested[0]}-${requested[1]} years old`
      : `${requested} years old`;
    differenceParts.push(`no ${requestedStr} surfers (found ${found} years old instead)`);
  }
  if (quality.differences.country_from) {
    const { requested, found } = quality.differences.country_from;
    differenceParts.push(`no surfers from ${requested.join(' or ')} (found ${found} instead)`);
  }
  if (quality.differences.surfboard_type) {
    const { requested, found } = quality.differences.surfboard_type;
    differenceParts.push(`no ${requested.join(' or ')} surfers (found ${found} instead)`);
  }
  if (quality.differences.area) {
    const { requested, found } = quality.differences.area;
    differenceParts.push(`no surfers who surfed in ${requested} (found ${found || 'other areas'} instead)`);
  }

  // Build the question message
  let message = "Bro, I couldn't find exactly what you're looking for";
  if (differenceParts.length > 0) {
    message += ` (${differenceParts.join(', ')})`;
  }
  
  // Add what we DID find
  const foundParts: string[] = [];
  if (firstMatch.country_from && quality.matchedCriteria.country_from) {
    foundParts.push(`from ${firstMatch.country_from}`);
  }
  if (firstMatch.age && quality.matchedCriteria.age) {
    foundParts.push(`${firstMatch.age} years old`);
  }
  if (firstMatch.surfboard_type && quality.matchedCriteria.surfboard_type) {
    foundParts.push(`uses a ${firstMatch.surfboard_type}`);
  }
  if (request.destination_country && quality.matchedCriteria.destination_country) {
    foundParts.push(`surfed in ${request.destination_country}`);
  }

  if (foundParts.length > 0) {
    message += `, but I did find ${foundParts.join(', ')}`;
    if (matchedUsers.length > 1) {
      message += ` (${matchedUsers.length} options)`;
    }
  }

  message += ". Would you like me to send them to you, or do you want to change your request?";

  return message;
}

interface TripPlanningChatScreenProps {
  onChatComplete?: () => void;
  onViewUserProfile?: (userId: string, fromTripPlanningChat?: boolean) => void;
  onStartConversation?: (userId: string) => void;
  // Props for persisting trip planning state
  persistedChatId?: string | null;
  persistedMatchedUsers?: any[];
  persistedDestination?: string;
  onChatStateChange?: (chatId: string | null, matchedUsers: any[], destination: string) => void;
}

export const TripPlanningChatScreen: React.FC<TripPlanningChatScreenProps> = ({ 
  onChatComplete,
  onViewUserProfile,
  onStartConversation,
  persistedChatId,
  persistedMatchedUsers,
  persistedDestination,
  onChatStateChange,
}) => {
  const { formData } = useOnboarding();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [chatId, setChatId] = useState<string | null>(persistedChatId || null);
  const [isFinished, setIsFinished] = useState(false);
  const [matchedUsers, setMatchedUsers] = useState<any[]>(persistedMatchedUsers || []);
  const [destinationCountry, setDestinationCountry] = useState<string>(persistedDestination || '');
  const [pendingPartialMatches, setPendingPartialMatches] = useState<MatchedUser[] | null>(null);
  const [inputHeight, setInputHeight] = useState(25);
  const scrollViewRef = useRef<ScrollView>(null);
  const textInputRef = useRef<any>(null);

  // Test API connection and initialize chat context on component mount
  useEffect(() => {
    const initializeChat = async () => {
      try {
        console.log('Testing API connection...');
        const health = await swellyService.healthCheck();
        console.log('API health check successful:', health);
        
        // If we have a persisted chatId, restore the conversation
        if (persistedChatId) {
          console.log('Restoring trip planning conversation from chatId:', persistedChatId);
          try {
            const history = await swellyService.getTripPlanningHistory(persistedChatId);
            console.log('Restored history:', history);
            
            if (history && history.messages && history.messages.length > 0) {
              // Convert backend messages to UI format
              const restoredMessages: Message[] = [];
              let messageId = 1;
              
              for (const msg of history.messages) {
                // Skip system messages
                if (msg.role === 'system') continue;
                
                // Parse assistant messages that might be JSON
                let messageText = msg.content;
                if (msg.role === 'assistant') {
                  try {
                    const parsed = JSON.parse(msg.content);
                    messageText = parsed.return_message || msg.content;
                  } catch {
                    // Not JSON, use as-is
                  }
                }
                
                restoredMessages.push({
                  id: String(messageId++),
                  text: messageText,
                  isUser: msg.role === 'user',
                  timestamp: new Date().toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                  }),
                });
              }
              
              // If we have persisted matched users, add the matched users message
              if (persistedMatchedUsers && persistedMatchedUsers.length > 0) {
                restoredMessages.push({
                  id: String(messageId++),
                  text: `Found ${persistedMatchedUsers.length} awesome match${persistedMatchedUsers.length > 1 ? 'es' : ''} for you!`,
                  isUser: false,
                  timestamp: new Date().toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                  }),
                  isMatchedUsers: true,
                });
                setIsFinished(true);
              }
              
              setMessages(restoredMessages);
              setIsInitializing(false);
              return; // Exit early, we've restored the conversation
            }
          } catch (restoreError) {
            console.error('Failed to restore trip planning conversation:', restoreError);
            // Fall through to start a new conversation
          }
        }
        
        // Start new conversation
        console.log('Initializing surfer connection conversation...');
        
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
          ? `Hi! ${contextParts.join(', ')}. I'm looking to connect with surfers.`
          : 'Hi! I\'m looking to connect with surfers.';
        
        const response = await swellyService.startTripPlanningConversation({
          message: contextMessage,
        });
        
        console.log('Chat initialized with response:', response);
        const newChatId = response.chat_id || null;
        setChatId(newChatId);
        
        // Notify parent of new chatId
        if (onChatStateChange) {
          onChatStateChange(newChatId, [], '');
        }
        
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
  }, [formData]); // Re-run if formData changes

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
    
    // Check if user wants to see pending partial matches
    if (pendingPartialMatches && pendingPartialMatches.length > 0) {
      const userText = userMessage.text.toLowerCase();
      const wantsToSee = userText.includes('yes') || 
                        userText.includes('send') || 
                        userText.includes('show') || 
                        userText.includes('sure') ||
                        userText.includes('ok') ||
                        userText.includes('okay') ||
                        userText.includes('yeah');
      
      if (wantsToSee) {
        // User confirmed - show the partial matches
        setMessages(prev => [...prev, userMessage]);
        setInputText('');
        const matchesMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `Here are ${pendingPartialMatches.length} option${pendingPartialMatches.length > 1 ? 's' : ''} that best match what you're looking for:`,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
          }),
          isMatchedUsers: true,
        };
        setMessages(prev => [...prev, matchesMessage]);
        setMatchedUsers(pendingPartialMatches);
        setPendingPartialMatches(null);
        
        if (onChatStateChange) {
          onChatStateChange(chatId, pendingPartialMatches, destinationCountry);
        }
        return; // Don't process this as a normal message
      } else if (userText.includes('no') || userText.includes('change') || userText.includes('different')) {
        // User wants to change request - clear pending matches and continue normal flow
        setPendingPartialMatches(null);
        setMatchedUsers([]);
      }
    }
    
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      let response: SwellyChatResponse;
      
      if (chatId) {
        // Continue existing chat
        console.log('Continuing chat with ID:', chatId);
        response = await swellyService.continueTripPlanningConversation(chatId, {
          message: userMessage.text,
        });
      } else {
        // This shouldn't happen since we initialize chat on mount, but fallback just in case
        console.log('Starting new chat (fallback)');
        response = await swellyService.startTripPlanningConversation({
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

      // If chat is finished, handle completion
      console.log('Response check:', { 
        is_finished: response.is_finished, 
        has_data: !!response.data,
        data: response.data 
      });
      
      if (response.is_finished && response.data) {
        setIsFinished(true);
        
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
            queryFilters: response.data.queryFilters || null,
            filtersFromNonNegotiableStep: response.data.filtersFromNonNegotiableStep || false,
          };
          console.log('Request data being passed to findMatchingUsers:', JSON.stringify(requestData, null, 2));
          console.log('queryFilters in request:', requestData.queryFilters);
          
          // Use V3 matching algorithm (can be toggled via environment variable or feature flag)
          const useV3Matching = process.env.EXPO_PUBLIC_USE_V3_MATCHING === 'true';
          const matchedUsers = useV3Matching
            ? await findMatchingUsersV3(requestData, currentUser.id)
            : await findMatchingUsers(requestData, currentUser.id);
          
          console.log('Matched users found:', matchedUsers.length, matchedUsers);
          console.log('Filters from non-negotiable step:', response.data.filtersFromNonNegotiableStep);
          
          // Check if matches are exact or partial
          const hasMatchQuality = matchedUsers.some(u => u.matchQuality);
          const hasExactMatches = hasMatchQuality 
            ? matchedUsers.some(u => u.matchQuality?.exactMatch === true)
            : true; // If no quality data, assume exact matches
          const hasPartialMatches = matchedUsers.length > 0 && hasMatchQuality && !hasExactMatches;
          
          // Display matched users
          if (matchedUsers.length > 0) {
            if (hasExactMatches || !hasMatchQuality) {
              // Exact matches - show immediately
              const matchesMessage: Message = {
                id: (Date.now() + 3).toString(),
                text: `Found ${matchedUsers.length} awesome match${matchedUsers.length > 1 ? 'es' : ''} for you!`,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: false 
                }),
                isMatchedUsers: true,
              };
              setMessages(prev => [...prev, matchesMessage]);
              
              // Store matched users and destination for rendering cards
              setMatchedUsers(matchedUsers);
              setDestinationCountry(response.data.destination_country);
              
              // Notify parent to persist state for when user returns
              if (onChatStateChange) {
                onChatStateChange(chatId, matchedUsers, response.data.destination_country);
              }
            } else if (hasPartialMatches) {
              // Partial matches - ask user first
              const firstMatch = matchedUsers[0];
              const quality = firstMatch.matchQuality;
              if (quality) {
                const partialMessage = generatePartialMatchQuestion(matchedUsers, requestData, quality);
                const askMessage: Message = {
                  id: (Date.now() + 3).toString(),
                  text: partialMessage,
                  isUser: false,
                  timestamp: new Date().toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                  }),
                  isMatchedUsers: false,
                };
                setMessages(prev => [...prev, askMessage]);
                
                // Store partial matches temporarily (will show if user confirms)
                setPendingPartialMatches(matchedUsers);
                setDestinationCountry(response.data.destination_country);
              }
            }
          } else {
            // No matches found
            const noMatchesMessage: Message = {
              id: (Date.now() + 3).toString(),
              text: response.data.filtersFromNonNegotiableStep
                ? "Sorry, I couldn't find any surfers that match all your criteria. Would you like to relax some of those requirements?"
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
      setInputHeight(25);
    }
  }, [inputText]);

  const handleSendMessage = async (userId: string) => {
    if (onStartConversation) {
      onStartConversation(userId);
    } else {
      onChatComplete?.();
    }
  };

  const handleViewProfile = (userId: string) => {
    if (onViewUserProfile) {
      // Pass true to indicate this profile view came from trip planning chat
      onViewUserProfile(userId, true);
    } else {
      Alert.alert('Profile', `View profile for user: ${userId}`);
    }
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
                onChatComplete?.();
              }}
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
                <View style={styles.avatarImageContainer}>
                  <Image
                    source={{ uri: getImageUrl('/Swelly avatar onboarding.png') }}
                    style={styles.avatarImage}
                    resizeMode="cover"
                  />
                </View>
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
                  <View style={styles.messageTextContainer}>
                    <TypingIndicator />
                  </View>
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
          
          <View style={[
            styles.inputContainer,
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
                onSubmitEditing={undefined}
                returnKeyType="default"
                blurOnSubmit={false}
                onContentSizeChange={(event: any) => {
                  const { height } = event.nativeEvent.contentSize;
                  if (!height || height < 0) return;
                  const calculatedHeight = Math.max(25, Math.ceil(height));
                  const cappedHeight = Math.min(calculatedHeight, 120);
                  if (Math.abs(cappedHeight - inputHeight) >= 1) {
                    setInputHeight(cappedHeight);
                  }
                }}
                onKeyPress={(e: any) => {
                  if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter') {
                    const isShiftPressed = (e.nativeEvent as any).shiftKey;
                    if (!isShiftPressed) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }
                }}
                scrollEnabled={inputHeight >= 120}
                textAlignVertical={inputHeight <= 25 ? "center" : "top"}
                style={[
                  styles.paperTextInput,
                  { 
                    height: inputHeight,
                    maxHeight: 120,
                    ...(inputHeight <= 25 && {
                      paddingTop: 5,
                    }),
                  }
                ]}
                contentStyle={[
                  styles.paperTextInputContent,
                  {
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
    minWidth: 24 + 8 + 62,
  },
  backButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    zIndex: 0,
  },
  avatar: {
    width: 62,
    height: 68,
    aspectRatio: 62 / 68,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  avatarRing: {
    width: '100%',
    height: '100%',
    borderRadius: 31,
    overflow: 'visible',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  ellipseBackground: {
    position: 'absolute',
    width: '105%',
    height: '105%',
    top: '-2.5%',
    left: '-2.5%',
    zIndex: 0,
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any,
    }),
  },
  avatarImageContainer: {
    position: 'absolute',
    width: 75,
    height: 75,
    left: -6.1, 
    top: -5.1, 
    overflow: 'hidden',
    zIndex: 1, 
  },
  avatarImage: {
    width: 75,
    height: 75,
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
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
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 48,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 32,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
      transition: 'min-height 0.2s ease' as any,
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
    justifyContent: 'center',
    minHeight: 25,
    position: 'relative',
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
    lineHeight: 22,
    minHeight: 25,
    textAlign: 'left',
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      resize: 'none' as any,
      overflow: 'auto' as any,
      textAlign: 'left' as any,
    }),
  },
  paperTextInputContent: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    margin: 0,
    minHeight: 25,
    fontSize: 18,
    lineHeight: 22,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    textAlign: 'left',
    ...(Platform.OS === 'web' && {
      outline: 'none' as any,
      textAlign: 'left' as any,
    }),
  },
  sendButtonWrapper: {
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

