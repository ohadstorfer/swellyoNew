import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  Modal,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { swellyServiceCopy, SwellyChatResponse } from '../services/swelly/swellyServiceCopy';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { MatchedUserCard } from '../components/MatchedUserCard';
import { messagingService } from '../services/messaging/messagingService';
import { MatchedUser, TripPlanningRequest } from '../types/tripPlanning';
import { analyticsService } from '../services/analytics/analyticsService';
import { ChatTextInput } from '../components/ChatTextInput';
import {
  queryFiltersToDisplayList,
  removeFilterFromRequestData,
  type FilterDisplayItem,
} from '../utils/tripPlanningFilters';

/** First question shown when starting or restarting trip planning (matches backend prompt). */
const TRIP_PLANNING_FIRST_QUESTION =
  "Yo! Let's Travel! I can connect you with like minded surfers or surf travelers who have experience in specific destinations you are curious about. So, what are you looking for?";

/** Follow-up when user taps "Continue Editing" after search summary. */
const CONTINUE_EDITING_FOLLOW_UP =
  "What would you like to change? Destination, filters, or vibe—tell me and we'll dial it in.";

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
  actionRow?: {
    requestData: any; // trip planning request for this match (for Add Filter / More)
    selectedAction: 'new_chat' | 'add_filter' | 'more' | null;
  };
  /** Backend message index (set on restore) for PATCH update-match-action */
  backendMessageIndex?: number;
  /** True when this is the search_summary bot message (shows "Review filters" button) */
  isSearchSummary?: boolean;
  /** Search/Edit block attached to this message (persisted and restored like actionRow) */
  searchSummaryBlock?: {
    requestData: any;
    searchSummary: string;
    selectedAction: 'search' | 'continue_editing' | null;
  };
  /** True when this is the "first question" message added after New Chat (filters should be cleared after this) */
  isRestartAfterNewChat?: boolean;
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
  const [pendingSingleCriterionMatches, setPendingSingleCriterionMatches] = useState<MatchedUser[] | null>(null);
  const [singleCriterionType, setSingleCriterionType] = useState<string | null>(null);
  const [pendingSearch, setPendingSearch] = useState<{ data: any; searchSummary: string } | null>(null);
  const [pendingSearchSelectedAction, setPendingSearchSelectedAction] = useState<'search' | 'continue_editing' | null>(null);
  const [lastMatchRequestData, setLastMatchRequestData] = useState<any | null>(null);
  const [lastMatchActionPressed, setLastMatchActionPressed] = useState<'new_chat' | 'add_filter' | 'more' | null>(null);
  const [existingFiltersForAdd, setExistingFiltersForAdd] = useState<{ data: any } | null>(null);
  const [filtersMenuVisible, setFiltersMenuVisible] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // Current filters source: existingFiltersForAdd (when adding filters), pendingSearch (after search_summary), or last match message (only after the last New Chat restart)
  const { currentRequestData, filterSourceMessage, filterSource } = useMemo(() => {
    if (existingFiltersForAdd?.data) {
      return { currentRequestData: existingFiltersForAdd.data, filterSourceMessage: null as Message | null, filterSource: 'existingFiltersForAdd' as const };
    }
    if (pendingSearch?.data) {
      return { currentRequestData: pendingSearch.data, filterSourceMessage: null as Message | null, filterSource: 'pendingSearch' as const };
    }
    const lastRestartIndex = messages.reduce((idx, m, i) => (m.isRestartAfterNewChat ? i : idx), -1);
    for (let i = messages.length - 1; i > lastRestartIndex; i--) {
      const msg = messages[i];
      if (msg.actionRow?.requestData) {
        return { currentRequestData: msg.actionRow.requestData, filterSourceMessage: msg, filterSource: 'message' as const };
      }
    }
    return { currentRequestData: null, filterSourceMessage: null, filterSource: null };
  }, [existingFiltersForAdd, messages, pendingSearch]);

  const filterDisplayList = useMemo(
    () => (currentRequestData ? queryFiltersToDisplayList(currentRequestData.queryFilters, currentRequestData) : []),
    [currentRequestData]
  );
  const filterCount = filterDisplayList.length;

  // Disable text input when Search/Edit buttons are shown and user hasn't chosen yet
  const awaitingSearchOrEditChoice = useMemo(
    () => messages.some(m => m.searchSummaryBlock != null && m.searchSummaryBlock.selectedAction == null),
    [messages]
  );

  // Animated conic-style border: rotation and glow on filter change
  const spinRef = useRef(new Animated.Value(0)).current;
  const glowRef = useRef(new Animated.Value(0)).current;
  // Border spin: continuous rotation (no iteration limit) so the gradient always sweeps
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spinRef, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: true,
      }),
      { resetBeforeIteration: true }
    );
    spinRef.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [spinRef]);
  const spin = spinRef.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const glowOpacity = glowRef.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const glowScale = glowRef.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const prevFilterCountRef = useRef(filterCount);
  useEffect(() => {
    if (prevFilterCountRef.current !== filterCount) {
      prevFilterCountRef.current = filterCount;
      Animated.sequence([
        Animated.timing(glowRef, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(glowRef, { toValue: 0, duration: 4700, useNativeDriver: true }),
      ]).start();
    }
  }, [filterCount, glowRef]);

  // Test API connection and initialize chat context on component mount
  useEffect(() => {
    const initializeChat = async () => {
      try {
        // Track swelly_chat_entered
        analyticsService.trackSwellyChatEntered();
        
        // Health check is best-effort: don't block init if it fails (e.g. CORS in local dev or edge not deployed)
        console.log('Testing API connection...');
        try {
          const health = await swellyServiceCopy.healthCheck();
          console.log('API health check successful:', health);
        } catch (healthErr) {
          console.warn('API health check failed (continuing anyway):', healthErr);
        }
        
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
                  ).catch(err => {
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

              for (let i = 0; i < history.messages.length; i++) {
                const msg = history.messages[i];
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
                    messageText = parsed.data?.search_summary ?? parsed.return_message ?? msg.content;
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
                  backendMessageIndex: i,
                };

                // Extract matched users and action row from message metadata (if present)
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
                    if (metadata.actionRow) {
                      restoredMessage.actionRow = {
                        requestData: metadata.actionRow.requestData ?? undefined,
                        selectedAction: metadata.actionRow.selectedAction ?? null,
                      };
                    }
                  }
                  const searchSummaryBlock = (msg as any).metadata?.searchSummaryBlock;
                  if (searchSummaryBlock && searchSummaryBlock.requestData != null) {
                    restoredMessage.isSearchSummary = true;
                    restoredMessage.searchSummaryBlock = {
                      requestData: searchSummaryBlock.requestData,
                      searchSummary: searchSummaryBlock.searchSummary ?? '',
                      selectedAction: searchSummaryBlock.selectedAction ?? null,
                    };
                  }
                }

                restoredMessages.push(restoredMessage);
              }

              // Restore pending search block from last assistant message that has searchSummaryBlock
              let lastSearchSummaryBlock: { requestData: any; searchSummary: string; selectedAction: 'search' | 'continue_editing' | null } | null = null;
              for (let i = history.messages.length - 1; i >= 0; i--) {
                const msg = history.messages[i];
                if (msg.role === 'assistant' && (msg as any).metadata?.searchSummaryBlock) {
                  const block = (msg as any).metadata.searchSummaryBlock;
                  if (block.requestData != null) {
                    lastSearchSummaryBlock = {
                      requestData: block.requestData,
                      searchSummary: block.searchSummary ?? '',
                      selectedAction: block.selectedAction ?? null,
                    };
                    break;
                  }
                }
              }
              if (lastSearchSummaryBlock) {
                setPendingSearch({
                  data: lastSearchSummaryBlock.requestData,
                  searchSummary: lastSearchSummaryBlock.searchSummary,
                });
                setPendingSearchSelectedAction(lastSearchSummaryBlock.selectedAction);
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

  const runFindMatches = async (currentChatId: string, tripPlanningData: any) => {
    if (!currentChatId) return;
    setIsLoading(true);
    const requestData = {
      destination_country: tripPlanningData.destination_country,
      area: tripPlanningData.area || null,
      budget: tripPlanningData.budget || null,
      destination_known: tripPlanningData.destination_known || false,
      purpose: tripPlanningData.purpose || { purpose_type: 'general_guidance', specific_topics: [] },
      non_negotiable_criteria: tripPlanningData.non_negotiable_criteria || null,
      user_context: tripPlanningData.user_context || null,
      queryFilters: tripPlanningData.queryFilters || null,
      filtersFromNonNegotiableStep: tripPlanningData.filtersFromNonNegotiableStep || false,
    };
    
    try {
      const { matches: matchedUsers } = await swellyServiceCopy.findMatchingUsersServer(currentChatId, tripPlanningData);
      console.log('Matched users found (server):', matchedUsers.length);
      const needsConfirmation = (matchedUsers as any).__needsConfirmation === true;
      const isSingleCriterion = (matchedUsers as any).__singleCriterion === true;
      if (needsConfirmation && isSingleCriterion && matchedUsers.length > 0) {
        setLastMatchRequestData(tripPlanningData);
        const criterionType = getSingleCriterionType(requestData);
        const confirmationMessage = generateSingleCriterionConfirmationMessage(criterionType || 'requirement', matchedUsers.length);
        const askMessage: Message = {
          id: (Date.now() + 3).toString(),
          text: confirmationMessage,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          isMatchedUsers: false,
        };
        setMessages(prev => [...prev, askMessage]);
        setPendingSingleCriterionMatches(matchedUsers);
        setSingleCriterionType(criterionType);
        setDestinationCountry(tripPlanningData.destination_country);
        setIsFinished(false);
        return;
      }
      if (matchedUsers.length > 0) {
        const matchesMessageText = `Found ${matchedUsers.length} awesome match${matchedUsers.length > 1 ? 'es' : ''} for you!`;
        const matchesDestination = tripPlanningData.destination_country || '';
        const newMatchMessageId = (Date.now() + 3).toString();
        setMessages(prev => {
          const filtered = prev.filter(msg => msg.text !== 'Finding the perfect surfers for you...');
          const matchesMessage: Message = {
            id: newMatchMessageId,
            text: matchesMessageText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            isMatchedUsers: true,
            matchedUsers: matchedUsers,
            destinationCountry: matchesDestination,
            actionRow: { requestData: tripPlanningData, selectedAction: null },
          };
          const updated = [...filtered, matchesMessage];
          const allMatchedUsers: MatchedUser[] = [];
          let latestDestination = matchesDestination;
          updated.forEach(msg => {
            if (msg.matchedUsers && msg.matchedUsers.length > 0) {
              allMatchedUsers.push(...msg.matchedUsers);
              if (msg.destinationCountry) latestDestination = msg.destinationCountry;
            }
          });
          if (onChatStateChange) setTimeout(() => onChatStateChange(currentChatId, allMatchedUsers, latestDestination), 0);
          if (currentChatId) {
            swellyServiceCopy.attachMatchedUsersToMessage(currentChatId, matchedUsers, matchesDestination, tripPlanningData).then(res => {
              if (res?.messageIndex != null) {
                setMessages(prevMsgs => prevMsgs.map(m => m.id === newMatchMessageId ? { ...m, backendMessageIndex: res!.messageIndex } : m));
              }
            }).catch(err =>
              console.error('[TripPlanningChatScreen] Failed to save exact matches to backend:', err));
          }
          return updated;
        });
        setMatchedUsers(matchedUsers);
        setDestinationCountry(matchesDestination);
        setLastMatchRequestData(null);
        setLastMatchActionPressed(null);
        analyticsService.trackSwellyListCreated(matchedUsers.length, requestData.purpose?.purpose_type || 'general_guidance');
      } else {
        analyticsService.trackSwellySearchFailed();
        const noMatchesText = 'No surfers match your criteria right now. Try adjusting your destination or filters.';
        setMessages(prev => {
          const filtered = prev.filter(msg => msg.text !== 'Finding the perfect surfers for you...');
          return [...filtered, {
            id: (Date.now() + 3).toString(),
            text: noMatchesText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          }];
        });
      }
    } catch (error) {
      console.error('Error finding matching users:', error);
      analyticsService.trackSwellySearchFailed('error');
      setMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        text: `Sorry, I couldn't find any matches for your search. Try adjusting your destination or preferences and search again.`,
        isUser: false,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

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
    setPendingSearch(null);
    setPendingSearchSelectedAction(null);

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
        const newMatchMessageId = (Date.now() + 1).toString();
        setMessages(prev => {
          const withUserMessage = [...prev, userMessage];
          const matchesMessage: Message = {
            id: newMatchMessageId,
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
            actionRow: { requestData: lastMatchRequestData ?? undefined, selectedAction: null },
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
            swellyServiceCopy.attachMatchedUsersToMessage(chatId, pendingSingleCriterionMatches, destinationCountry, lastMatchRequestData ?? undefined).then(res => {
              if (res?.messageIndex != null) {
                setMessages(prevMsgs => prevMsgs.map(m => m.id === newMatchMessageId ? { ...m, backendMessageIndex: res!.messageIndex } : m));
              }
            }).catch(err => {
              console.error('[TripPlanningChatScreen] Failed to save single criterion matches to backend:', err);
            });
          }
          
          return updated;
        });
        
        setLastMatchRequestData(null);
        setLastMatchActionPressed(null);
        // Keep global state for backward compatibility
        setMatchedUsers(pendingSingleCriterionMatches);
        
          // Track Swelly list created for single criterion matches
          analyticsService.trackSwellyListCreated(pendingSingleCriterionMatches.length, 'single_criterion');
          
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
    
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      let response: SwellyChatResponse;
      
      if (chatId) {
        // Continue existing chat
        console.log('Continuing chat with ID:', chatId);
        const continuePayload: { message: string; existing_query_filters?: any; adding_filters?: boolean; existing_destination_country?: string | null; existing_area?: string | null } = {
          message: userMessage.text,
        };
        if (existingFiltersForAdd?.data?.queryFilters != null) {
          continuePayload.existing_query_filters = existingFiltersForAdd.data.queryFilters;
          continuePayload.adding_filters = true;
          if (existingFiltersForAdd.data.destination_country != null) continuePayload.existing_destination_country = existingFiltersForAdd.data.destination_country;
          if (existingFiltersForAdd.data.area != null) continuePayload.existing_area = existingFiltersForAdd.data.area;
        }
        response = await swellyServiceCopy.continueTripPlanningConversation(chatId, continuePayload);
      } else {
        // This shouldn't happen since we initialize chat on mount, but fallback just in case
        console.log('Starting new chat (fallback)');
        response = await swellyServiceCopy.startTripPlanningConversation({
          message: userMessage.text,
        });
        console.log('New chat response:', response);
        setChatId(response.chat_id || null);
      }

      // If chat is finished, add search_summary as a normal message and show Search button
      if (response.is_finished && response.data) {
        setIsFinished(true);
        const summaryText = response.data?.search_summary ?? 'Ready to search with your current filters.';
        const searchSummary = response.data?.search_summary ?? '';
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: summaryText,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }),
          isSearchSummary: true,
          searchSummaryBlock: {
            requestData: response.data,
            searchSummary,
            selectedAction: null,
          },
        };
        setMessages(prev => [...prev, botMessage]);
        setPendingSearch({
          data: response.data,
          searchSummary,
        });
        setPendingSearchSelectedAction(null);
        if (chatId) {
          swellyServiceCopy.updateSearchSummaryBlock(chatId, response.data, searchSummary, null).catch(err =>
            console.warn('[TripPlanningChatScreen] Failed to persist search summary block:', err));
        }
      } else {
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
      }

      console.log('Response check:', { 
        is_finished: response.is_finished, 
        has_data: !!response.data,
        data: response.data 
      });

    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setExistingFiltersForAdd(null);
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
  }, [messages, isInitializing, isLoading, pendingSearch, lastMatchRequestData]);

  const handleSendMessage = async (userId: string) => {
    console.log('[TripPlanningChatScreen] handleSendMessage called with userId:', userId);
    console.log('[TripPlanningChatScreen] onStartConversation exists:', !!onStartConversation);
    
    if (onStartConversation) {
      console.log('[TripPlanningChatScreen] Calling onStartConversation');
      onStartConversation(userId);
    } else {
      console.warn('[TripPlanningChatScreen] onStartConversation not available, calling onChatComplete');
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

  const handleMatchAction = (messageId: string, action: 'new_chat' | 'add_filter' | 'more') => {
    let messageIndexForPatch: number | null = null;
    setMessages(prev => {
      const updated = prev.map(m =>
        m.id === messageId && m.actionRow
          ? { ...m, actionRow: { ...m.actionRow, selectedAction: action } }
          : m
      );
      const msg = updated.find(m => m.id === messageId);
      const requestData = msg?.actionRow?.requestData;
      messageIndexForPatch = msg?.backendMessageIndex ?? prev.findIndex(m => m.id === messageId);
      if (action === 'new_chat') {
        const firstQuestionMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: TRIP_PLANNING_FIRST_QUESTION,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          isRestartAfterNewChat: true,
        };
        return [...updated, firstQuestionMessage];
      }
      if (action === 'add_filter' && requestData != null) {
        setIsFinished(false);
        setExistingFiltersForAdd({ data: { ...requestData } });
        const addFilterBotMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: "Great! We can add some filters to your search. What would you like to add? For example: board type, surf level, destinations they've surfed, age, or country of origin.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        };
        return [...updated, addFilterBotMessage];
      }
      if (action === 'more' && chatId && requestData != null) {
        runFindMatches(chatId, requestData);
        return updated;
      }
      return updated;
    });
    if (action === 'new_chat') {
      setPendingSearch(null);
      setIsFinished(false);
      setExistingFiltersForAdd(null);
      setFiltersMenuVisible(false);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
    if (messageIndexForPatch != null && messageIndexForPatch >= 0 && chatId) {
      swellyServiceCopy.updateMatchActionSelection(chatId, messageIndexForPatch, action).catch(err =>
        console.warn('[TripPlanningChatScreen] Failed to persist action selection:', err));
    }
  };

  const handleRemoveFilter = (item: FilterDisplayItem) => {
    if (!currentRequestData) return;
    const nextRequestData = removeFilterFromRequestData(currentRequestData, item);
    if (filterSource === 'existingFiltersForAdd') {
      setExistingFiltersForAdd({ data: nextRequestData });
      return;
    }
    if (filterSource === 'pendingSearch' && pendingSearch) {
      setPendingSearch({ data: nextRequestData, searchSummary: pendingSearch.searchSummary ?? '' });
      return;
    }
    if (filterSource === 'message' && filterSourceMessage?.id) {
      setMessages(prev =>
        prev.map(m =>
          m.id === filterSourceMessage.id && m.actionRow
            ? { ...m, actionRow: { ...m.actionRow, requestData: nextRequestData } }
            : m
        )
      );
      const backendIndex = filterSourceMessage.backendMessageIndex;
      if (chatId != null && typeof backendIndex === 'number' && backendIndex >= 0) {
        swellyServiceCopy.updateMatchRequestData(chatId, backendIndex, nextRequestData).catch(err =>
          console.warn('[TripPlanningChatScreen] Failed to persist filter removal:', err));
      }
    }
  };

  const renderMessage = (message: Message) => {
    // If this message has matched users, render cards instead
    if (message.isMatchedUsers && message.matchedUsers && message.matchedUsers.length > 0) {
      const selectedAction = message.actionRow?.selectedAction ?? null;
      const requestData = message.actionRow?.requestData;
      const hasActionRow = requestData != null;
      const disabled = selectedAction !== null;
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

          {/* Per-message action row (New Chat, Add Filter, More Matches) */}
          {hasActionRow && (
            <View style={styles.actionButtonsRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={disabled}
                onPress={() => handleMatchAction(message.id, 'new_chat')}
                style={styles.actionButtonTouchable}
              >
                <LinearGradient
                  colors={['#05BCD3', '#DBCDBC']}
                  locations={[0, 0.7]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.searchButtonGradientOuter}
                >
                  <View style={[styles.actionButtonInner, selectedAction === 'new_chat' && styles.actionButtonInnerSelected]}>
                    <Text style={[styles.searchButtonTextSmall, selectedAction === 'new_chat' && styles.actionButtonTextSelected]}>New Chat</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={disabled}
                onPress={() => handleMatchAction(message.id, 'add_filter')}
                style={styles.actionButtonTouchable}
              >
                <LinearGradient
                  colors={['#05BCD3', '#DBCDBC']}
                  locations={[0, 0.7]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.searchButtonGradientOuter}
                >
                  <View style={[styles.actionButtonInner, selectedAction === 'add_filter' && styles.actionButtonInnerSelected]}>
                    <Text style={[styles.searchButtonTextSmall, selectedAction === 'add_filter' && styles.actionButtonTextSelected]}>Add Filter</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
              {(message.matchedUsers?.length ?? 0) >= 3 && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={disabled}
                  onPress={() => handleMatchAction(message.id, 'more')}
                  style={styles.actionButtonTouchable}
                >
                  <LinearGradient
                    colors={['#05BCD3', '#DBCDBC']}
                    locations={[0, 0.7]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.searchButtonGradientOuter}
                  >
                    <View style={[styles.actionButtonInner, selectedAction === 'more' && styles.actionButtonInnerSelected]}>
                      <Text style={[styles.searchButtonTextSmall, selectedAction === 'more' && styles.actionButtonTextSelected]}>3 More</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      );
    }

    // Regular message rendering
    const selectedSearchAction = message.searchSummaryBlock?.selectedAction ?? null;
    const hasSearchSummaryBlock = message.searchSummaryBlock != null;
    const searchDisabled = selectedSearchAction !== null || isLoading;

    return (
      <View key={message.id}>
        <View
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
              {!message.isUser && message.isSearchSummary && (
                <View style={styles.reviewFiltersRow}>
                  <TouchableOpacity
                    onPress={() => setFiltersMenuVisible(true)}
                    activeOpacity={0.8}
                    style={styles.reviewFiltersButton}
                  >
                    <Svg width={18} height={18} viewBox="0 -960 960 960" fill="#555">
                      <Path d="M440-120v-240h80v80h320v80H520v80h-80Zm-320-80v-80h240v80H120Zm160-160v-80H120v-80h160v-80h80v240h-80Zm160-80v-80h400v80H440Zm160-160v-240h80v80h160v80H680v80h-80Zm-480-80v-80h400v80H120Z" />
                    </Svg>
                    <Text style={styles.reviewFiltersButtonText}>Review filters</Text>
                  </TouchableOpacity>
                </View>
              )}
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

        {/* Per-message Search/Edit row (same location as message, persisted via searchSummaryBlock) */}
        {!message.isUser && hasSearchSummaryBlock && message.searchSummaryBlock && (
          <View style={styles.pendingSearchBlock}>
            <View style={[styles.searchButtonWrapper, styles.pendingSearchButtonsRow]}>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={searchDisabled}
                onPress={() => {
                  if (searchDisabled) return;
                  const block = message.searchSummaryBlock!;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === message.id && m.searchSummaryBlock
                        ? { ...m, searchSummaryBlock: { ...m.searchSummaryBlock!, selectedAction: 'continue_editing' as const } }
                        : m
                    )
                  );
                  const botMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    text: CONTINUE_EDITING_FOLLOW_UP,
                    isUser: false,
                    timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
                  };
                  setMessages(prev => [...prev, botMessage]);
                  if (chatId) {
                    swellyServiceCopy.updateSearchSummaryBlock(chatId, block.requestData, block.searchSummary, 'continue_editing', message.backendMessageIndex).catch(err =>
                      console.warn('[TripPlanningChatScreen] Failed to persist search summary selection:', err));
                  }
                  setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
                }}
                style={[styles.searchButtonTouchable, styles.pendingSearchButtonTouchable]}
              >
                <LinearGradient
                  colors={['#05BCD3', '#DBCDBC']}
                  locations={[0, 0.7]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.searchButtonGradientOuter}
                >
                  <View style={[styles.searchButtonInner, selectedSearchAction === 'continue_editing' && styles.actionButtonInnerSelected, styles.searchEditButtonContent]}>
                    <Svg width={16} height={16} viewBox="0 -960 960 960" fill={selectedSearchAction === 'continue_editing' ? '#0D7480' : '#222B30'}>
                      <Path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z" />
                    </Svg>
                    <Text style={[styles.searchButtonText, selectedSearchAction === 'continue_editing' && styles.actionButtonTextSelected]}>Edit</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={searchDisabled}
                onPress={() => {
                  if (!chatId || searchDisabled) return;
                  const block = message.searchSummaryBlock!;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === message.id && m.searchSummaryBlock
                        ? { ...m, searchSummaryBlock: { ...m.searchSummaryBlock!, selectedAction: 'search' as const } }
                        : m
                    )
                  );
                  runFindMatches(chatId, block.requestData);
                  swellyServiceCopy.updateSearchSummaryBlock(chatId, block.requestData, block.searchSummary, 'search', message.backendMessageIndex).catch(err =>
                    console.warn('[TripPlanningChatScreen] Failed to persist search summary selection:', err));
                }}
                style={[styles.searchButtonTouchable, styles.pendingSearchButtonTouchable]}
              >
                <LinearGradient
                  colors={['#05BCD3', '#DBCDBC']}
                  locations={[0, 0.7]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.searchButtonGradientOuter}
                >
                  <View style={[styles.searchButtonInner, selectedSearchAction === 'search' && styles.actionButtonInnerSelected, styles.searchEditButtonContent]}>
                    <Ionicons name="search" size={16} color={selectedSearchAction === 'search' ? '#0D7480' : '#222B30'} />
                    <Text style={[styles.searchButtonText, selectedSearchAction === 'search' && styles.actionButtonTextSelected]}>Search</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
            <Text style={styles.profileTagline}>Let's grow your surf travel community!</Text>
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
            disabled={isLoading || awaitingSearchOrEditChoice}
            placeholder="Type your message.."
            maxLength={500}
            primaryColor={colors.primary || '#B72DF2'}
            leftAccessory={
              <TouchableOpacity
                onPress={() => setFiltersMenuVisible(true)}
                activeOpacity={0.8}
                style={styles.filtersButtonOuter}
              >
                <Animated.View style={[styles.filtersButtonGlowWrap, { transform: [{ scale: glowScale }] }]}>
                  <View style={styles.filtersButtonBorderClip}>
                    <Animated.View
                      style={[
                        styles.filtersButtonGradientWrap,
                        {
                          transform: [{ rotate: spin }],
                          opacity: glowOpacity,
                        },
                      ]}
                    >
                      <LinearGradient
                        colors={['#7C3AED', '#A78BFA', '#C4B5FD', '#7C3AED', '#6D28D9']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </Animated.View>
                    <View style={styles.filtersButtonInner}>
                      {filterCount > 0 && (
                        <Text style={styles.filtersButtonCount}>{filterCount}</Text>
                      )}
                      <Svg width={28} height={28} viewBox="0 -960 960 960" fill="#222B30">
                        <Path d="M440-120v-240h80v80h320v80H520v80h-80Zm-320-80v-80h240v80H120Zm160-160v-80H120v-80h160v-80h80v240h-80Zm160-80v-80h400v80H440Zm160-160v-240h80v80h160v80H680v80h-80Zm-480-80v-80h400v80H120Z" />
                      </Svg>
                    </View>
                  </View>
                </Animated.View>
              </TouchableOpacity>
            }
          />
        </View>
      </KeyboardAvoidingView>

      {/* Filters menu overlay */}
      <Modal
        visible={filtersMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFiltersMenuVisible(false)}
      >
        <Pressable style={styles.filtersMenuBackdrop} onPress={() => setFiltersMenuVisible(false)}>
          <Pressable style={styles.filtersMenuCard} onPress={e => e.stopPropagation()}>
            <View style={styles.filtersMenuHeader}>
              <Text style={styles.filtersMenuTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFiltersMenuVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color="#222B30" />
              </TouchableOpacity>
            </View>
            {filterDisplayList.length === 0 ? (
              <Text style={styles.filtersMenuEmpty}>No filters applied</Text>
            ) : (
              <ScrollView style={styles.filtersMenuList} keyboardShouldPersistTaps="handled">
                {filterDisplayList.map(item => (
                  <View key={item.id} style={styles.filtersMenuItem}>
                    <Text style={styles.filtersMenuLabel} numberOfLines={1}>{item.label}</Text>
                    <TouchableOpacity
                      onPress={() => handleRemoveFilter(item)}
                      style={styles.filtersMenuRemove}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={22} color="#7B7B7B" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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
    alignItems: 'center',
    // Padding removed - let botMessageContainer handle padding
  },
  matchedUsersCards: {
    marginTop: 12,
    alignSelf: 'stretch',  // Take full width
    alignItems: 'center', 
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
    lineHeight: 22,
  },
  botMessageText: {
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
    marginTop: 6,
  },
  filtersButtonOuter: {
    alignSelf: 'flex-start',
    transform: [{ translateY: 6 }],
  },
  filtersButtonGlowWrap: {
    // Wrapper for glow scale animation
  },
  filtersButtonBorderClip: {
    overflow: 'hidden',
    borderRadius: 14,
    padding: 2,
  },
  filtersButtonGradientWrap: {
    position: 'absolute',
    width: '200%',
    height: '200%',
    left: '-50%',
    top: '-50%',
  },
  filtersButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 28,
  },
  filtersButtonCount: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '600',
    color: '#222B30',
    lineHeight: 28,
  },
  filtersButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#05BCD3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
  },
  attachButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filtersMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  filtersMenuCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    maxHeight: 320,
    paddingTop: 12,
    paddingBottom: 12,
  },
  filtersMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  filtersMenuTitle: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '600',
    color: '#222B30',
  },
  filtersMenuEmpty: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 14,
    color: '#7B7B7B',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  filtersMenuList: {
    maxHeight: 260,
  },
  filtersMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E4E4',
  },
  filtersMenuLabel: {
    flex: 1,
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 14,
    color: '#222B30',
    marginRight: 8,
  },
  filtersMenuRemove: {
    padding: 4,
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
  reviewFiltersRow: {
    marginTop: 8,
  },
  reviewFiltersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#999',
  },
  reviewFiltersButtonText: {
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : undefined,
  },
  pendingSearchBlock: {
    marginBottom: 4,
  },
  searchButtonWrapper: {
    marginTop: 12,
    alignItems: 'center',
    width: '100%',
  },
  pendingSearchButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    gap: 8,
  },
  pendingSearchButtonTouchable: {
    flex: 1,
  },
  searchButtonTouchable: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  searchButtonGradientOuter: {
    padding: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  searchButtonInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchEditButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchButtonText: {
    color: '#222B30',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : undefined,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 0,
    gap: 8,
  },
  actionButtonTouchable: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionButtonInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonInnerSelected: {
    backgroundColor: '#E0F2F7',
  },
  actionButtonTextSelected: {
    color: '#0D7480',
  },
  searchButtonTextSmall: {
    color: '#222B30',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : undefined,
  },
});
