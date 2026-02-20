import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  ImageBackground,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
// COPY VERSION - Uses server-side matching
import { swellyServiceCopy, SwellyChatResponse } from '../services/swelly/swellyServiceCopy';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { MatchedUserCard } from '../components/MatchedUserCard';
import { messagingService } from '../services/messaging/messagingService';
// NOTE: Not using client-side matching services - using server-side instead
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { MatchedUser, TripPlanningRequest } from '../types/tripPlanning';
import { analyticsService } from '../services/analytics/analyticsService';
import { ChatTextInput } from '../components/ChatTextInput';

/**
 * Count how many criteria are requested (helper function for UI)
 */
function countRequestedCriteria(request: TripPlanningRequest): number {
  let count = 0;
  
  if ((request.queryFilters?.country_from && request.queryFilters.country_from.length > 0) || 
      (request.non_negotiable_criteria?.country_from && request.non_negotiable_criteria.country_from.length > 0)) {
    count++;
  }
  if ((request.queryFilters?.surfboard_type && request.queryFilters.surfboard_type.length > 0) || 
      (request.non_negotiable_criteria?.surfboard_type && request.non_negotiable_criteria.surfboard_type.length > 0)) {
    count++;
  }
  if (request.non_negotiable_criteria?.age_range || 
      (request.queryFilters?.age_min !== undefined && request.queryFilters?.age_max !== undefined)) {
    count++;
  }
  if (request.non_negotiable_criteria?.surf_level_min !== undefined || 
      request.queryFilters?.surf_level_min !== undefined) {
    count++;
  }
  if (request.destination_country) {
    count++;
  }
  if (request.area) {
    count++;
  }
  
  return count;
}

/**
 * Extract previously matched user IDs from conversation messages
 * @param messages - Array of messages in the conversation
 * @returns Array of unique user IDs that have already been matched
 */
function getPreviouslyMatchedUserIds(messages: Message[]): string[] {
  const matchedUserIds = new Set<string>();
  
  for (const message of messages) {
    // Check if this message has matched users
    if (message.isMatchedUsers && message.matchedUsers && Array.isArray(message.matchedUsers)) {
      for (const matchedUser of message.matchedUsers) {
        if (matchedUser.user_id) {
          matchedUserIds.add(matchedUser.user_id);
        }
      }
    }
  }
  
  const result = Array.from(matchedUserIds);
  console.log('[getPreviouslyMatchedUserIds] Found', result.length, 'previously matched user IDs');
  return result;
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  isMatchedUsers?: boolean; // Flag to indicate this message should render matched user cards
  matchedUsers?: MatchedUser[]; // Store matched users with the message
  destinationCountry?: string; // Store destination country with the message
}

/**
 * Generate confirmation message for single criterion matches
 */
function generateSingleCriterionConfirmationMessage(criterionType: string, matchCount: number): string {
  const criterionNames: { [key: string]: string } = {
    'age': 'age requirement',
    'country': 'country requirement',
    'surfboard_type': 'board type requirement',
    'surf_level': 'surf level requirement',
    'destination_country': 'destination requirement',
    'area': 'area requirement',
  };
  
  const criterionName = criterionNames[criterionType] || 'requirement';
  const suggestions = criterionType === 'age' 
    ? 'country, board type, or surf level'
    : criterionType === 'country'
    ? 'board type, surf level, or age'
    : criterionType === 'surfboard_type'
    ? 'country, surf level, or age'
    : 'country, board type, or age';
  
  return `I found ${matchCount} surfer${matchCount !== 1 ? 's' : ''} matching your ${criterionName}. Would you like to add more criteria (like ${suggestions}) to get better matches, or should I show you these results now?`;
}

/**
 * Determine which criterion type was requested from the request data
 */
function getSingleCriterionType(request: TripPlanningRequest): string | null {
  if ((request.queryFilters?.country_from && request.queryFilters.country_from.length > 0) || 
      (request.non_negotiable_criteria?.country_from && request.non_negotiable_criteria.country_from.length > 0)) {
    return 'country';
  }
  if ((request.queryFilters?.surfboard_type && request.queryFilters.surfboard_type.length > 0) || 
      (request.non_negotiable_criteria?.surfboard_type && request.non_negotiable_criteria.surfboard_type.length > 0)) {
    return 'surfboard_type';
  }
  if (request.non_negotiable_criteria?.age_range || 
      (request.queryFilters?.age_min !== undefined && request.queryFilters?.age_max !== undefined)) {
    return 'age';
  }
  if (request.non_negotiable_criteria?.surf_level_min !== undefined || 
      request.queryFilters?.surf_level_min !== undefined) {
    return 'surf_level';
  }
  if (request.destination_country) {
    return 'destination_country';
  }
  if (request.area) {
    return 'area';
  }
  return null;
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
  const [pendingSingleCriterionMatches, setPendingSingleCriterionMatches] = useState<MatchedUser[] | null>(null);
  const [singleCriterionType, setSingleCriterionType] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Test API connection and initialize chat context on component mount
  useEffect(() => {
    const initializeChat = async () => {
      try {
        // Track swelly_chat_entered
        analyticsService.trackSwellyChatEntered();
        
        console.log('Testing API connection...');
        const health = await swellyServiceCopy.healthCheck();
        console.log('API health check successful:', health);
        
        // If we have a persisted chatId, restore the conversation
        if (persistedChatId) {
          console.log('Restoring trip planning conversation from chatId:', persistedChatId);
          
          // Optional: Migrate existing AsyncStorage data to backend (one-time migration)
          try {
            const { loadMatchedUsers } = await import('../utils/tripPlanningStorage');
            const storedMatchedUsers = await loadMatchedUsers(persistedChatId);
            if (storedMatchedUsers && storedMatchedUsers.length > 0) {
              console.log('[TripPlanningChatScreen] Found AsyncStorage data to migrate:', storedMatchedUsers.length, 'entries');
              // Migrate each stored match group to backend
              for (const stored of storedMatchedUsers) {
                if (stored.matchedUsers && stored.matchedUsers.length > 0) {
                  await swellyServiceCopy.attachMatchedUsersToMessage(
                    persistedChatId,
                    stored.matchedUsers,
                    stored.destinationCountry
                  ).catch((err: unknown) => {
                    console.warn('[TripPlanningChatScreen] Failed to migrate match group to backend:', err);
                  });
                }
              }
              // Clear AsyncStorage after successful migration
              const { clearMatchedUsers } = await import('../utils/tripPlanningStorage');
              await clearMatchedUsers(persistedChatId);
              console.log('[TripPlanningChatScreen] Migration complete, AsyncStorage cleared');
            }
          } catch (migrationError) {
            // Migration is optional - don't block if it fails
            console.warn('[TripPlanningChatScreen] Migration check failed (non-critical):', migrationError);
          }
          
          try {
            const history = await swellyServiceCopy.getTripPlanningHistory(persistedChatId);
            console.log('Restored history:', history);
            
            if (history && history.messages && history.messages.length > 0) {
              // Convert backend messages to UI format
              const restoredMessages: Message[] = [];
              let messageId = 1;
              let skippedInitialContext = false;
              
              for (const msg of history.messages) {
                // Skip system messages
                if (msg.role === 'system') continue;
                
                // Skip initial context message (it's just for backend context, not for display)
                if (msg.role === 'user' && (
                  msg.content.includes("I'm looking to connect with surfers") ||
                  (msg.content.toLowerCase().startsWith("hi!") && msg.content.includes("surfing"))
                )) {
                  skippedInitialContext = true;
                  console.log('[TripPlanningChatScreen] Skipping initial context message:', msg.content.substring(0, 50));
                  continue;
                }
                
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
                
                const messageIdStr = String(messageId++);
                const restoredMessage: Message = {
                  id: messageIdStr,
                  text: messageText,
                  isUser: msg.role === 'user',
                  timestamp: new Date().toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                  }),
                };
                
                // Extract matched users from message metadata (if present)
                if (msg.role === 'assistant') {
                  // Debug: Check if message has any metadata
                  if ((msg as any).metadata) {
                    console.log('[TripPlanningChatScreen] Assistant message has metadata:', {
                      hasMatchedUsers: !!(msg as any).metadata.matchedUsers,
                      matchedUsersCount: (msg as any).metadata.matchedUsers?.length || 0,
                      destinationCountry: (msg as any).metadata.destinationCountry,
                      messageTextPreview: messageText.substring(0, 50)
                    });
                  } else {
                    console.log('[TripPlanningChatScreen] Assistant message has no metadata, messageTextPreview:', messageText.substring(0, 50));
                  }
                  
                  if ((msg as any).metadata?.matchedUsers) {
                    const metadata = (msg as any).metadata;
                    console.log('[TripPlanningChatScreen] Found matched users in message metadata - count:', metadata.matchedUsers.length);
                    console.log('[TripPlanningChatScreen] Message text preview:', messageText.substring(0, 50));
                    restoredMessage.isMatchedUsers = true;
                    restoredMessage.matchedUsers = metadata.matchedUsers;
                    restoredMessage.destinationCountry = metadata.destinationCountry;
                  }
                }
                
                restoredMessages.push(restoredMessage);
              }
              
              console.log('[TripPlanningChatScreen] Restored', restoredMessages.length, 'messages, skippedInitialContext:', skippedInitialContext);
              
              // Check if any messages have matched users to determine if finished
              const hasMatchedUsers = restoredMessages.some(msg => msg.isMatchedUsers && msg.matchedUsers && msg.matchedUsers.length > 0);
              if (hasMatchedUsers) {
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
        
        const response = await swellyServiceCopy.startTripPlanningConversation({
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
    
    // Check if user wants to see pending single criterion matches
    if (pendingSingleCriterionMatches && pendingSingleCriterionMatches.length > 0) {
      const userText = userMessage.text.toLowerCase();
      const wantsToSee = userText.includes('yes') || 
                        userText.includes('show') || 
                        userText.includes('send') ||
                        userText.includes('sure') ||
                        userText.includes('ok') ||
                        userText.includes('okay') ||
                        userText.includes('yeah') ||
                        userText.includes('now');
      
      if (wantsToSee) {
        // User confirmed - show the single criterion matches
        const singleCriterionMessageText = `Found ${pendingSingleCriterionMatches.length} awesome match${pendingSingleCriterionMatches.length > 1 ? 'es' : ''} for you!`;
        
        setMessages(prev => {
          const withUserMessage = [...prev, userMessage];
          const matchesMessage: Message = {
            id: (Date.now() + 1).toString(),
            text: singleCriterionMessageText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { 
              hour: '2-digit', 
              minute: '2-digit',
              hour12: false 
            }),
            isMatchedUsers: true,
            matchedUsers: pendingSingleCriterionMatches,
            destinationCountry: destinationCountry,
          };
          const updated = [...withUserMessage, matchesMessage];
          
          // Aggregate all matched users for onChatStateChange
          const allMatchedUsers: MatchedUser[] = [];
          let latestDestination = destinationCountry;
          
          updated.forEach(msg => {
            if (msg.matchedUsers && msg.matchedUsers.length > 0) {
              allMatchedUsers.push(...msg.matchedUsers);
              if (msg.destinationCountry) {
                latestDestination = msg.destinationCountry;
              }
            }
          });
          
          // Notify parent with all matched users
          if (onChatStateChange) {
            setTimeout(() => {
              onChatStateChange(chatId, allMatchedUsers, latestDestination);
            }, 0);
          }
          
          // Save matched users to backend
          if (chatId) {
            console.log('[TripPlanningChatScreen] Saving single criterion matches - matchedUsersCount:', pendingSingleCriterionMatches.length);
            swellyServiceCopy.attachMatchedUsersToMessage(chatId, pendingSingleCriterionMatches, destinationCountry).catch((err: unknown) => {
              console.error('[TripPlanningChatScreen] Failed to save single criterion matches to backend:', err);
            });
          }
          
          return updated;
        });
        
        // Keep global state for backward compatibility
        setMatchedUsers(pendingSingleCriterionMatches);
        
          // Track Swelly list created for single criterion matches
          analyticsService.trackSwellyListCreated(pendingSingleCriterionMatches.length, 'single_criterion');
          
          // Add filter decision message after matches are displayed
          setMessages(prev => {
            const filterDecisionMessage: Message = {
              id: (Date.now() + 2).toString(),
              text: "Would you like to keep your current filters or clear them and start fresh?",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
              }),
            };
            return [...prev, filterDecisionMessage];
          });
          
          setPendingSingleCriterionMatches(null);
          setSingleCriterionType(null);
          return; // Don't process this as a normal message
      } else if (userText.includes('no') || userText.includes('add') || userText.includes('more')) {
        // User wants to add more criteria - clear pending matches and continue normal flow
        setPendingSingleCriterionMatches(null);
        setSingleCriterionType(null);
        setMatchedUsers([]);
      }
    }
    
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
        const partialMatchesMessageText = `Here are ${pendingPartialMatches.length} option${pendingPartialMatches.length > 1 ? 's' : ''} that best match what you're looking for:`;
        
        setMessages(prev => {
          const withUserMessage = [...prev, userMessage];
          
          // Find the message that contains the partial matches and update it
          const updated = withUserMessage.map((msg) => {
            // Find the message that has the pending partial matches stored
            if (msg.matchedUsers && 
                msg.matchedUsers.length === pendingPartialMatches.length &&
                msg.matchedUsers[0]?.user_id === pendingPartialMatches[0]?.user_id) {
              // Update this message to show the matches
              return {
                ...msg,
                text: partialMatchesMessageText,
                isMatchedUsers: true,
                matchedUsers: pendingPartialMatches,
                destinationCountry: msg.destinationCountry || destinationCountry,
              };
            }
            return msg;
          });
          
          // If we couldn't find the message, create a new one (fallback)
          const foundMessage = updated.some(msg => msg.isMatchedUsers && msg.matchedUsers && msg.matchedUsers.length === pendingPartialMatches.length);
          if (!foundMessage) {
            updated.push({
              id: (Date.now() + 1).toString(),
              text: partialMatchesMessageText,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
              }),
              isMatchedUsers: true,
              matchedUsers: pendingPartialMatches,
              destinationCountry: destinationCountry,
            });
          }
          
          // Aggregate all matched users for onChatStateChange
          const allMatchedUsers: MatchedUser[] = [];
          let latestDestination = destinationCountry;
          
          updated.forEach(msg => {
            if (msg.matchedUsers && msg.matchedUsers.length > 0) {
              allMatchedUsers.push(...msg.matchedUsers);
              if (msg.destinationCountry) {
                latestDestination = msg.destinationCountry;
              }
            }
          });
          
          // Notify parent with all matched users (use setTimeout to avoid state update issues)
          if (onChatStateChange) {
            setTimeout(() => {
              onChatStateChange(chatId, allMatchedUsers, latestDestination);
            }, 0);
          }
          
          // Save matched users to backend
          if (chatId) {
            console.log('[TripPlanningChatScreen] Saving partial matches - matchedUsersCount:', pendingPartialMatches.length);
            swellyServiceCopy.attachMatchedUsersToMessage(chatId, pendingPartialMatches, destinationCountry).catch((err: unknown) => {
              console.error('[TripPlanningChatScreen] Failed to save partial matches to backend:', err);
            });
          }
          
          return updated;
        });
        
        // Keep global state for backward compatibility
        setMatchedUsers(pendingPartialMatches);
        
          // Track Swelly list created for partial matches
          analyticsService.trackSwellyListCreated(pendingPartialMatches.length, 'partial_match');
          
          // Add filter decision message after matches are displayed
          setMessages(prev => {
            const filterDecisionMessage: Message = {
              id: (Date.now() + 2).toString(),
              text: "Would you like to keep your current filters or clear them and start fresh?",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
              }),
            };
            return [...prev, filterDecisionMessage];
          });
          
          setPendingPartialMatches(null);
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
        response = await swellyServiceCopy.continueTripPlanningConversation(chatId, {
          message: userMessage.text,
        });
      } else {
        // This shouldn't happen since we initialize chat on mount, but fallback just in case
        console.log('Starting new chat (fallback)');
        response = await swellyServiceCopy.startTripPlanningConversation({
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
          
          // SERVER-SIDE MATCHING: Call the new server-side matching endpoint
          console.log('[TripPlanningChatScreenCopy] Using server-side matching');
          if (!chatId) {
            throw new Error('Chat ID is required for server-side matching');
          }
          const matchingResponse = await swellyServiceCopy.findMatchesServer(chatId, requestData);
          const matchedUsers = matchingResponse.matches;
          console.log('[TripPlanningChatScreenCopy] Server-side matching returned', matchedUsers.length, 'matches');
          
          console.log('Matched users found:', matchedUsers.length, matchedUsers);
          console.log('Filters from non-negotiable step:', response.data.filtersFromNonNegotiableStep);
          
          // Check if this is a single criterion request that needs confirmation
          const needsConfirmation = (matchedUsers as any).__needsConfirmation === true;
          const isSingleCriterion = (matchedUsers as any).__singleCriterion === true;
          
          if (needsConfirmation && isSingleCriterion && matchedUsers.length > 0) {
            // Single criterion request - ask user if they want to add more criteria
            const criterionType = getSingleCriterionType(requestData);
            const confirmationMessage = generateSingleCriterionConfirmationMessage(
              criterionType || 'requirement',
              matchedUsers.length
            );
            
            const askMessage: Message = {
              id: (Date.now() + 3).toString(),
              text: confirmationMessage,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
              }),
              isMatchedUsers: false,
            };
            setMessages(prev => [...prev, askMessage]);
            
            // Store matches temporarily (will show if user confirms)
            setPendingSingleCriterionMatches(matchedUsers);
            setSingleCriterionType(criterionType);
            setDestinationCountry(response.data.destination_country);
            
            // Don't finish the chat - allow user to respond
            setIsFinished(false);
            setIsLoading(false);
            return;
          }
          
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
              // Remove the "Finding..." message and add the results message
              const matchesMessageText = `Found ${matchedUsers.length} awesome match${matchedUsers.length > 1 ? 'es' : ''} for you!`;
              const matchesDestination = response.data.destination_country || '';
              
              setMessages(prev => {
                // Filter out the "Finding the perfect surfers..." message
                const filtered = prev.filter(msg => msg.text !== 'Finding the perfect surfers for you...');
                const matchesMessage: Message = {
                  id: (Date.now() + 3).toString(),
                  text: matchesMessageText,
                  isUser: false,
                  timestamp: new Date().toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                  }),
                  isMatchedUsers: true,
                  matchedUsers: matchedUsers, // Store matched users with the message
                  destinationCountry: matchesDestination, // Store destination with the message
                };
                const updated = [...filtered, matchesMessage];
                
                // Aggregate all matched users from all messages (including the new one)
                const allMatchedUsers: MatchedUser[] = [];
                let latestDestination = matchesDestination;
                
                updated.forEach(msg => {
                  if (msg.matchedUsers && msg.matchedUsers.length > 0) {
                    allMatchedUsers.push(...msg.matchedUsers);
                    if (msg.destinationCountry) {
                      latestDestination = msg.destinationCountry;
                    }
                  }
                });
                
                // Notify parent with all matched users (call after state update)
                if (onChatStateChange) {
                  setTimeout(() => {
                    onChatStateChange(chatId, allMatchedUsers, latestDestination);
                  }, 0);
                }
                
                // Save matched users to backend
                if (chatId) {
                  console.log('[TripPlanningChatScreen] Saving exact matches - matchedUsersCount:', matchedUsers.length);
                  swellyServiceCopy.attachMatchedUsersToMessage(chatId, matchedUsers, matchesDestination).catch((err: unknown) => {
                    console.error('[TripPlanningChatScreen] Failed to save exact matches to backend:', err);
                  });
                }
                
                return updated;
              });
              
              // Keep global state for backward compatibility (can be removed later)
              setMatchedUsers(matchedUsers);
              setDestinationCountry(matchesDestination);
              
              // Track Swelly list created
              const intentType = requestData.purpose?.purpose_type || 'general_guidance';
              analyticsService.trackSwellyListCreated(matchedUsers.length, intentType);
              
              // Add filter decision message after matches are displayed
              setMessages(prev => {
                const filterDecisionMessage: Message = {
                  id: (Date.now() + 4).toString(),
                  text: "Would you like to keep your current filters or clear them and start fresh?",
                  isUser: false,
                  timestamp: new Date().toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                  }),
                };
                return [...prev, filterDecisionMessage];
              });
            } else if (hasPartialMatches) {
              // Partial matches - ask user first
              const firstMatch = matchedUsers[0];
              const quality = firstMatch.matchQuality;
              if (quality) {
                const partialMessage = generatePartialMatchQuestion(matchedUsers, requestData, quality);
                // Remove the "Finding..." message and add the partial match question
                setMessages(prev => {
                  const filtered = prev.filter(msg => msg.text !== 'Finding the perfect surfers for you...');
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
                    // Store matched users in the message for when user confirms
                    matchedUsers: matchedUsers,
                    destinationCountry: response.data.destination_country || '',
                  };
                  return [...filtered, askMessage];
                });
                
                // Store partial matches temporarily (will show if user confirms)
                setPendingPartialMatches(matchedUsers);
                setDestinationCountry(response.data.destination_country || '');
              }
            }
          } else {
            // No matches found - analyze why and generate helpful message
            analyticsService.trackSwellySearchFailed();
            
            // Import and use the analysis function
            const { analyzeNoMatchesReason } = await import('../services/matching/matchingService');
            
            // Get rejected matches and destination-filtered surfers from the result (if available)
            const rejectedMatches = (matchedUsers as any).__rejectedMatches || [];
            const destinationFilteredSurfers = (matchedUsers as any).__destinationFilteredSurfers || [];
            const passedOtherFiltersCount = (matchedUsers as any).__passedOtherFilters || 0;
            const mustHaveKeywordsFilteredOut = (matchedUsers as any).__mustHaveKeywordsFilteredOut || false;
            const mustHaveKeywords = (matchedUsers as any).__mustHaveKeywords || [];
            
            // Count criteria to provide better error messages
            const criteriaCount = countRequestedCriteria(requestData);
            
            console.log('[TripPlanningChatScreen] No matches found. Analyzing reason...', {
              rejectedMatchesCount: rejectedMatches.length,
              destinationFilteredSurfersCount: destinationFilteredSurfers.length,
              passedOtherFiltersCount,
              hasDestinationFiltered: !!destinationFilteredSurfers.length,
              mustHaveKeywordsFilteredOut,
              mustHaveKeywords,
              criteriaCount,
            });
            
            const explanation = analyzeNoMatchesReason(
              requestData, 
              rejectedMatches,
              destinationFilteredSurfers,
              passedOtherFiltersCount,
              mustHaveKeywordsFilteredOut,
              mustHaveKeywords
            );
            
            console.log('[TripPlanningChatScreen] Generated explanation:', explanation);
            
            // Remove the "Finding..." message and add the error explanation
            setMessages(prev => {
              const filtered = prev.filter(msg => msg.text !== 'Finding the perfect surfers for you...');
              const noMatchesMessage: Message = {
                id: (Date.now() + 3).toString(),
                text: explanation,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit',
                  hour12: false 
                }),
              };
              return [...filtered, noMatchesMessage];
            });
          }
        } catch (error) {
          console.error('Error finding matching users:', error);
          console.error('Error details:', error);
          
          // Track swelly_search_failed
          analyticsService.trackSwellySearchFailed('error');
          
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
    // Note: profile_view_clicked is tracked in MatchedUserCard to avoid duplication
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
    if (message.isMatchedUsers && message.matchedUsers && message.matchedUsers.length > 0) {
      return (
        <View key={message.id}>
          <View style={[
            styles.messageContainer,
            styles.botMessageContainer,
          ]}>
            <View style={[
              styles.messageBubble,
              styles.botMessageBubble,
            ]}>
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
          
          {/* Render matched user cards */}
          <View style={styles.matchedUsersCards}>
            {message.matchedUsers.map((user) => (
              <MatchedUserCard
                key={user.user_id}
                user={user}
                destinationCountry={message.destinationCountry || destinationCountry}
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
            <Text style={styles.profileTagline}>Let’s grow your surf travel community!</Text>
          </View>
          
          {/* <TouchableOpacity style={styles.menuButton}>
            <Ionicons name="ellipsis-vertical" size={24} color="#222B30" />
          </TouchableOpacity> */}
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
          <ChatTextInput
            value={inputText}
            onChangeText={setInputText}
            onSend={sendMessage}
            disabled={isLoading}
            placeholder="Type your message.."
            maxLength={500}
            primaryColor={colors.primary || '#B72DF2'}
            leftAccessory={
              <TouchableOpacity style={styles.attachButton}>
                <Ionicons name="add" size={28} color="#222B30" />
              </TouchableOpacity>
            }
          />
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
    paddingBottom: 0,
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
    // Padding removed - let botMessageContainer handle padding
  },
  matchedUsersCards: {
    marginTop: 12,
    marginLeft: 16, // Match botMessageContainer paddingLeft
    marginRight: 48, // Match botMessageContainer paddingRight
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

