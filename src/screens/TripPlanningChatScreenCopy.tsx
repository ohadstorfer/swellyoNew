import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
  Image,
  ImageBackground,
  Animated,
  Easing,
  Pressable,
  PanResponder,
  Modal,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { isExpoGo } from '../utils/keyboardAvoidingView';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, Stop, LinearGradient as SvgLinearGradient, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { swellyServiceCopy, SwellyChatResponse, UIMessage, type SwellyService as SwellyServiceType } from '../services/swelly/swellyServiceCopy';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { Images } from '../assets/images';
import { MatchedUsersCarousel } from '../components/MatchedUsersCarousel';
import { messagingService } from '../services/messaging/messagingService';
import { MatchedUser, TripPlanningRequest } from '../types/tripPlanning';
import { analyticsService } from '../services/analytics/analyticsService';
import { ChatTextInput, ChatTextInputRef } from '../components/ChatTextInput';
import { ReportAISheet } from '../components/ReportAISheet';
import { blockingService } from '../services/blocking/blockingService';
import {
  queryFiltersToDisplayList,
  removeFilterFromRequestData,
  type FilterDisplayItem,
} from '../utils/tripPlanningFilters';
import { useChatKeyboardScroll } from '../hooks/useChatKeyboardScroll';
import { useTutorial } from '../context/TutorialContext';
import { TutorialOverlay, type AnchorRect } from '../components/TutorialOverlay';
import { useKeyboardVisible, useKeyboardHeight } from '../hooks/useKeyboardVisible';

/** Split filter label into prefix and value for chip display (e.g. "Origin – Israel" -> prefix "Origin", value "Israel"). */
function getLabelParts(label: string): { prefix: string; value: string } | null {
  const sep1 = ' – ';
  const sep2 = ' in ';
  if (label.includes(sep1)) {
    const i = label.lastIndexOf(sep1);
    return { prefix: label.slice(0, i).trim(), value: label.slice(i + sep1.length).trim() };
  }
  if (label.includes(sep2)) {
    const i = label.lastIndexOf(sep2);
    return { prefix: label.slice(0, i).trim(), value: label.slice(i + sep2.length).trim() };
  }
  return null;
}

/** First question shown when starting or restarting trip planning (matches backend prompt). */
const TRIP_PLANNING_FIRST_QUESTION =
  "Yo! Let’s get you connected with some other surf travelers! So, what are we looking for today?";

/** Second initial message shown after typing animation delay. */
const TRIP_PLANNING_SECOND_MESSAGE =
  "I can connect you to surfers based on surf lvl, board type, age, origin country, and any destination they’ve surfed at.";

/** True if we have at least one filter required for find-matches (matches backend validation). */
function hasSearchableFilters(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  const dest = data.destination_country != null ? String(data.destination_country).trim() : '';
  if (dest !== '') return true;
  const q = data.queryFilters;
  if (!q || typeof q !== 'object') return false;
  if (q.country_from && Array.isArray(q.country_from) && q.country_from.length > 0) return true;
  if (q.surfboard_type && Array.isArray(q.surfboard_type) && q.surfboard_type.length > 0) return true;
  if (q.surf_level_category != null) return true;
  if (typeof q.age_min === 'number') return true;
  if (typeof q.age_max === 'number') return true;
  return false;
}



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
  /** Total matching count from server for this match block (used for "3 More" visibility) */
  matchTotalCount?: number;
  /** Backend message index (set on restore) for PATCH update-match-action */
  backendMessageIndex?: number;
  /** True when this is the search_summary bot message (shows "Review filters" button) */
  isSearchSummary?: boolean;

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
  /** Optional: override the swelly service instance (e.g. to target a different edge function). */
  service?: SwellyServiceType;
  /** Optional: onboarding matches to display before starting a new conversation. */
  onboardingMatches?: import('../services/matching/onboardingMatchingService').OnboardingMatch[];
}

export const TripPlanningChatScreen: React.FC<TripPlanningChatScreenProps> = ({
  onChatComplete,
  onViewUserProfile,
  onStartConversation,
  persistedChatId,
  persistedMatchedUsers,
  persistedDestination,
  onChatStateChange,
  service,
  onboardingMatches,
}) => {
  const svc = service ?? swellyServiceCopy;
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
  const [awaitingSearchDecision, setAwaitingSearchDecision] = useState(false);
  const [searchBtnSize, setSearchBtnSize] = useState({ w: 0, h: 0 });
  const [lastMatchRequestData, setLastMatchRequestData] = useState<any | null>(null);
  const [lastMatchActionPressed, setLastMatchActionPressed] = useState<'new_chat' | 'add_filter' | 'more' | null>(null);
  const [existingFiltersForAdd, setExistingFiltersForAdd] = useState<{ data: any } | null>(null);
  const [filtersMenuVisible, setFiltersMenuVisible] = useState(false);
  const [isAwaitingFilterRemovalResponse, setAwaitingFilterRemovalResponse] = useState(false);

  // ——— Welcome Guide (tutorial overlay) ———
  const tutorial = useTutorial();
  const filtersButtonRef = useRef<View>(null);
  const filtersChipsRowRef = useRef<View>(null);
  const [filtersButtonRect, setFiltersButtonRect] = useState<AnchorRect | null>(null);
  const [filtersChipsRect, setFiltersChipsRect] = useState<AnchorRect | null>(null);

  const measureFiltersButton = () => {
    filtersButtonRef.current?.measureInWindow?.((x, y, width, height) => {
      setFiltersButtonRect({ x, y, width, height });
    });
  };
  const measureFiltersChips = () => {
    filtersChipsRowRef.current?.measureInWindow?.((x, y, width, height) => {
      setFiltersChipsRect({ x, y, width, height });
    });
  };

  // Show step 3 tooltip only after the 2 welcome messages have been sent.
  const showTutorialStep3 = tutorial.currentStep === 3 && !isInitializing && messages.length >= 2;

  useEffect(() => {
    if (showTutorialStep3) {
      Keyboard.dismiss();
      const t = setTimeout(measureFiltersButton, 120);
      return () => clearTimeout(t);
    }
  }, [showTutorialStep3]);

  useEffect(() => {
    if (tutorial.currentStep === 4 && filtersMenuVisible) {
      const t = setTimeout(measureFiltersChips, 120);
      return () => clearTimeout(t);
    }
  }, [tutorial.currentStep, filtersMenuVisible]);

  // AI report state
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  const [reportMessageText, setReportMessageText] = useState('');
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const [reportMessageTimestamp, setReportMessageTimestamp] = useState('');
  const [reportMessageY, setReportMessageY] = useState<number | null>(null);
  const [reportMessageX, setReportMessageX] = useState<number | null>(null);
  const messageBubbleRefs = useRef<Record<string, View | null>>({});
  const [messageIdsUnblockedByFilterDeletion, setMessageIdsUnblockedByFilterDeletion] = useState<Record<string, true>>({});
  const [trashHoverProgress, setTrashHoverProgress] = useState(0);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const androidKeyboardHeight = useKeyboardHeight();
  // Keyboard sync via Reanimated worklets — same pattern as DirectMessageScreen.
  const { height: kbHeight, progress: kbProgress } = useReanimatedKeyboardAnimation();
  const animatedKeyboardPadding = useAnimatedStyle(() => ({
    paddingBottom: -kbHeight.value,
  }));
  const composerRestPadding = Math.max(insets.bottom, 16);
  const animatedComposerPadding = useAnimatedStyle(() => ({
    paddingBottom: composerRestPadding * (1 - kbProgress.value),
  }));
  const flatListRef = useRef<FlatList<Message>>(null);
  const chatInputRef = useRef<ChatTextInputRef>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { handleScroll, handleLayout, scrollToBottom } = useChatKeyboardScroll(flatListRef, { inverted: true });

  // Drag-to-delete: ghost chip position and dragged item
  const [dragState, setDragState] = useState<{
    item: FilterDisplayItem;
    ghostX: number;
    ghostY: number;
    chipX: number;
    chipY: number;
    touchOffsetX?: number;
    touchOffsetY?: number;
  } | null>(null);
  const trashZoneBounds = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const trashZoneRef = useRef<View | null>(null);
  const cardBoundsRef = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });
  const filtersMenuCardRef = useRef<View | null>(null);
  const chipRefsMap = useRef<Record<string, View | null>>({});
  const dragStateRef = useRef<{
    item: FilterDisplayItem;
    ghostX: number;
    ghostY: number;
    chipX: number;
    chipY: number;
    touchOffsetX?: number;
    touchOffsetY?: number;
  } | null>(null);
  const trashProgressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);
  useEffect(() => {
    if (!filtersMenuVisible) {
      setDragState(null);
      setTrashHoverProgress(0);
      trashProgressAnim.setValue(0);
    }
  }, [filtersMenuVisible, trashProgressAnim]);

  const filterMenuAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (filtersMenuVisible) {
      filterMenuAnim.setValue(0);
      Animated.timing(filterMenuAnim, {
        toValue: 1,
        duration: 350,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    } else {
      filterMenuAnim.setValue(0);
    }
  }, [filtersMenuVisible, filterMenuAnim]);

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

  // Mock filter chips shown during the welcome guide's step 4 when there are no real filters.
  const TUTORIAL_MOCK_CHIPS = useMemo(
    () => [
      { id: '__tutorial_chip_1__', label: 'surfed: Hawaii' },
      { id: '__tutorial_chip_2__', label: 'Origin: United States' },
      { id: '__tutorial_chip_3__', label: 'Age: 20-40' },
    ],
    []
  );

  // During step 4 (with no real filters) show the mock count + badge to match the Figma.
  const isTutorialMockVisible = filterCount === 0 && tutorial.currentStep === 4;
  const displayFilterCount = isTutorialMockVisible ? TUTORIAL_MOCK_CHIPS.length : filterCount;

  const hasUnresolvedActionRow = useMemo(
    () =>
      messages.some(
        (m) =>
          m.isMatchedUsers &&
          m.actionRow?.requestData != null &&
          m.actionRow?.selectedAction == null &&
          !messageIdsUnblockedByFilterDeletion[m.id]
      ),
    [messages, messageIdsUnblockedByFilterDeletion]
  );

  // Ref to the message id that is currently blocking the input (so we can unblock it when filter removal succeeds from pendingSearch context)
  const unresolvedActionRowMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    const lastRestartIndex = messages.reduce((idx, m, i) => (m.isRestartAfterNewChat ? i : idx), -1);
    let id: string | null = null;
    for (let i = messages.length - 1; i > lastRestartIndex; i--) {
      const m = messages[i];
      if (m.isMatchedUsers && m.actionRow?.requestData != null && m.actionRow?.selectedAction == null && !messageIdsUnblockedByFilterDeletion[m.id]) {
        id = m.id;
        break;
      }
    }
    unresolvedActionRowMessageIdRef.current = id;
  }, [messages, messageIdsUnblockedByFilterDeletion]);

  // Scroll to bottom whenever messages change (new message, restore, cards, buttons)
  useEffect(() => {
    if (!isInitializing && messages.length > 0) {
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [messages]);

  // Test API connection and initialize chat context on component mount
  useEffect(() => {
    const initializeChat = async () => {
      try {
        // Track swelly_chat_entered (fire-and-forget)
        analyticsService.trackSwellyChatEntered();

        // Health check: fire-and-forget, never blocks init
        svc.healthCheck().then(h => console.log('API health check ok:', h)).catch(e => console.warn('API health check failed:', e));

        // If no persisted chatId, try to fetch the latest one from the backend
        let chatIdToRestore = persistedChatId;
        if (!chatIdToRestore) {
          try {
            const latest = await svc.getLatestTripPlanningChat();
            if (latest?.chat_id) {
              const chatDate = latest.updated_at ? new Date(latest.updated_at) : null;
              const oneWeekAgo = new Date();
              oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
              if (!chatDate || chatDate >= oneWeekAgo) {
                chatIdToRestore = latest.chat_id;
                setChatId(latest.chat_id);
                if (onChatStateChange) onChatStateChange(latest.chat_id, [], '');
              }
            }
          } catch (e) {
            console.warn('Failed to fetch latest chat, starting new:', e);
          }
        }

        // If we have a chatId to restore, restore the conversation
        if (chatIdToRestore) {
          console.log('Restoring trip planning conversation from chatId:', chatIdToRestore);

          // AsyncStorage migration: fire-and-forget in background, never blocks restore
          (async () => {
            try {
              const { loadMatchedUsers } = await import('../utils/tripPlanningStorage');
              const storedMatchedUsers = await loadMatchedUsers(chatIdToRestore);
              if (storedMatchedUsers && storedMatchedUsers.length > 0) {
                console.log('[TripPlanningChatScreen] Migrating AsyncStorage data in background:', storedMatchedUsers.length, 'entries');
                await Promise.all(
                  storedMatchedUsers
                    .filter(s => s.matchedUsers && s.matchedUsers.length > 0)
                    .map(s => svc.attachMatchedUsersToMessage(chatIdToRestore!, s.matchedUsers, s.destinationCountry).catch(() => {}))
                );
                const { clearMatchedUsers } = await import('../utils/tripPlanningStorage');
                await clearMatchedUsers(chatIdToRestore!);
                console.log('[TripPlanningChatScreen] Background migration complete');
              }
            } catch (e) {
              console.warn('[TripPlanningChatScreen] Background migration failed (non-critical):', e);
            }
          })();

          try {
            // Try UI messages first (new ordered format), fall back to legacy restore
            const uiMessages = await svc.getUIMessages(chatIdToRestore);

            if (uiMessages && uiMessages.length > 0) {
              console.log('[TripPlanningChatScreen] Restoring from ui_messages:', uiMessages.length, 'entries');

              const restoredMessages: Message[] = uiMessages.map((ui: UIMessage) => {
                const isMatch = ui.type === 'match_results' || ui.type === 'no_matches';
                const ts = (() => {
                  try {
                    return new Date(ui.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                  } catch {
                    return ui.timestamp;
                  }
                })();
                return {
                  id: ui.id,
                  text: ui.text,
                  isUser: ui.is_user,
                  timestamp: ts,
                  isMatchedUsers: isMatch || undefined,
                  matchedUsers: ui.matched_users,
                  destinationCountry: ui.destination_country,
                  actionRow: ui.action_row ? { requestData: ui.action_row.request_data, selectedAction: ui.action_row.selected_action } : undefined,
                  matchTotalCount: ui.match_total_count,
                  backendMessageIndex: ui.backend_message_index,
                  isSearchSummary: ui.is_search_summary || ui.type === 'search_summary' || ui.type === 'filter_removal_ack' || undefined,
                  isRestartAfterNewChat: ui.is_restart_after_new_chat || ui.type === 'new_chat_restart' || undefined,
                } as Message;
              });

              // Restore pending search from last search_summary UI message
              for (let i = uiMessages.length - 1; i >= 0; i--) {
                const ui = uiMessages[i];
                if (ui.search_summary_block?.request_data != null) {
                  setPendingSearch({
                    data: ui.search_summary_block.request_data,
                    searchSummary: ui.search_summary_block.search_summary ?? '',
                  });
                  if (ui.search_summary_block.selected_action == null) {
                    setAwaitingSearchDecision(true);
                  }
                  break;
                }
              }

              // Restore existingFiltersForAdd from last add_filter_prompt (if not superseded)
              for (let i = uiMessages.length - 1; i >= 0; i--) {
                const ui = uiMessages[i];
                if (ui.type === 'add_filter_prompt') {
                  // Check if there's a later restart or match
                  const hasLater = uiMessages.slice(i + 1).some(
                    (u: UIMessage) => u.type === 'new_chat_restart' || u.type === 'match_results'
                  );
                  if (!hasLater) {
                    // Find the preceding match message's action_row for existing filters
                    for (let j = i - 1; j >= 0; j--) {
                      if (uiMessages[j].action_row?.request_data) {
                        setExistingFiltersForAdd({ data: uiMessages[j].action_row!.request_data });
                        setIsFinished(false);
                        break;
                      }
                    }
                  }
                  break;
                }
              }

              // Check if any messages have matched users
              const hasMatchedUsers = restoredMessages.some(msg => msg.isMatchedUsers && msg.matchedUsers && msg.matchedUsers.length > 0);
              if (hasMatchedUsers) {
                setIsFinished(true);
              }

              // Sync parent state
              if (onChatStateChange) {
                const allRestoredMatchedUsers: any[] = [];
                let latestRestoredDestination = '';
                for (const msg of restoredMessages) {
                  if (msg.isMatchedUsers && msg.matchedUsers && msg.matchedUsers.length > 0) {
                    allRestoredMatchedUsers.push(...msg.matchedUsers);
                    if (msg.destinationCountry) {
                      latestRestoredDestination = msg.destinationCountry;
                    }
                  }
                }
                onChatStateChange(chatIdToRestore, allRestoredMatchedUsers, latestRestoredDestination);
              }

              setMessages(restoredMessages);
              setIsInitializing(false);
              return;
            }

            // Fallback: legacy restore from GPT messages + metadata
            console.log('[TripPlanningChatScreen] No ui_messages found, falling back to legacy restore');
            const history = await svc.getTripPlanningHistory(chatIdToRestore);
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
                    const summary = parsed.data?.search_summary;
                    const hasSummary = summary != null && String(summary).trim() !== '';
                    messageText = hasSummary ? summary : (parsed.return_message ?? msg.content);
                    if (messageText == null || String(messageText).trim() === '') {
                      messageText = msg.content;
                    }
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

                if (msg.role === 'assistant') {
                  const metadata = (msg as any).metadata;
                  const searchSummaryBlock = metadata?.searchSummaryBlock;
                  const hasMatchedUsers = metadata?.matchedUsers && metadata.matchedUsers.length > 0;
                  const hasSearchSummary = searchSummaryBlock && searchSummaryBlock.requestData != null;

                  if (hasMatchedUsers) {
                    if (hasSearchSummary) {
                      restoredMessage.isSearchSummary = true;
                    }
                    const matchCount = metadata.matchedUsers.length;
                    const matchesMessage: Message = {
                      id: String(messageId++),
                      text: `Found ${matchCount} awesome match${matchCount > 1 ? 'es' : ''} for you!`,
                      isUser: false,
                      timestamp: restoredMessage.timestamp,
                      isMatchedUsers: true,
                      matchedUsers: metadata.matchedUsers,
                      destinationCountry: metadata.destinationCountry,
                      actionRow: metadata.actionRow ? {
                        requestData: metadata.actionRow.requestData ?? undefined,
                        selectedAction: metadata.actionRow.selectedAction ?? null,
                      } : undefined,
                      matchTotalCount: metadata.totalCount,
                      backendMessageIndex: i,
                    };
                    restoredMessages.push(restoredMessage);
                    restoredMessages.push(matchesMessage);
                    continue;
                  }

                  if (hasSearchSummary) {
                    restoredMessage.isSearchSummary = true;
                  }
                  if (metadata?.isRestartAfterNewChat) {
                    restoredMessage.isRestartAfterNewChat = true;
                  }
                }

                restoredMessages.push(restoredMessage);
              }

              // Restore pending search from last assistant message that has searchSummaryBlock
              for (let i = history.messages.length - 1; i >= 0; i--) {
                const msg = history.messages[i];
                if (msg.role === 'assistant' && (msg as any).metadata?.searchSummaryBlock) {
                  const block = (msg as any).metadata.searchSummaryBlock;
                  if (block.requestData != null) {
                    setPendingSearch({
                      data: block.requestData,
                      searchSummary: block.searchSummary ?? '',
                    });
                    if (block.selectedAction == null) {
                      setAwaitingSearchDecision(true);
                    }
                    break;
                  }
                }
              }

              // Restore existingFiltersForAdd from last add-filter prompt
              for (let i = history.messages.length - 1; i >= 0; i--) {
                const meta = (history.messages[i] as any).metadata;
                if (meta?.isAddFilterPrompt && meta?.existingFiltersData) {
                  const hasLaterRestart = history.messages.slice(i + 1).some(
                    (m: any) => m.metadata?.isRestartAfterNewChat
                  );
                  const hasLaterMatch = history.messages.slice(i + 1).some(
                    (m: any) => m.metadata?.matchedUsers?.length > 0
                  );
                  if (!hasLaterRestart && !hasLaterMatch) {
                    setExistingFiltersForAdd({ data: meta.existingFiltersData });
                    setIsFinished(false);
                  }
                  break;
                }
              }

              console.log('[TripPlanningChatScreen] Restored', restoredMessages.length, 'messages (legacy), skippedInitialContext:', skippedInitialContext);

              const hasMatchedUsers = restoredMessages.some(msg => msg.isMatchedUsers && msg.matchedUsers && msg.matchedUsers.length > 0);
              if (hasMatchedUsers) {
                setIsFinished(true);
              }

              if (onChatStateChange) {
                const allRestoredMatchedUsers: any[] = [];
                let latestRestoredDestination = '';
                for (const msg of restoredMessages) {
                  if (msg.isMatchedUsers && msg.matchedUsers && msg.matchedUsers.length > 0) {
                    allRestoredMatchedUsers.push(...msg.matchedUsers);
                    if (msg.destinationCountry) {
                      latestRestoredDestination = msg.destinationCountry;
                    }
                  }
                }
                onChatStateChange(chatIdToRestore, allRestoredMatchedUsers, latestRestoredDestination);
              }

              setMessages(restoredMessages);
              setIsInitializing(false);
              return;
            }
          } catch (restoreError) {
            console.error('Failed to restore trip planning conversation:', restoreError);
            // Fall through to start a new conversation
          }
        }
        
        // Start new conversation — show the fixed first message instantly, create backend chat in background
        console.log('Initializing surfer connection conversation...');

        const nowTs = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

        if (onboardingMatches && onboardingMatches.length > 0) {
          // Coming from WelcomeToLineupOverlay: show onboarding matches first, then start conversation
          const matchedUsersForDisplay = onboardingMatches.map(m => ({
            user_id: m.user_id,
            name: m.name || 'User',
            age: m.age ?? undefined,
            country_from: m.country_from ?? undefined,
            profile_image_url: m.profile_image_url ?? undefined,
            match_score: m.total_score,
          }));

          const matchMessage: Message = {
            id: 'onboarding-matches',
            text: `Found ${onboardingMatches.length} awesome match${onboardingMatches.length > 1 ? 'es' : ''} for you!`,
            isUser: false,
            timestamp: nowTs,
            isMatchedUsers: true,
            matchedUsers: matchedUsersForDisplay,
            destinationCountry: '',
            // No actionRow → display-only cards, no action buttons
          };

          Keyboard.dismiss();
          setMessages([matchMessage]);
          setIsInitializing(false);
          setIsLoading(true); // Show typing indicator
          setTimeout(() => scrollToBottom(), 100);

          // After 2 seconds, show the greeting + info message
          setTimeout(() => {
            setIsLoading(false);
            setMessages(prev => [
              ...prev,
              {
                id: 'greeting',
                text: TRIP_PLANNING_FIRST_QUESTION,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
              },
              {
                id: 'info',
                text: TRIP_PLANNING_SECOND_MESSAGE,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
              },
            ]);
            setTimeout(() => scrollToBottom(), 100);
          }, 2000);
        } else {
          // Normal new chat: show first message immediately, then second after typing delay
          setMessages([
            {
              id: '1',
              text: TRIP_PLANNING_FIRST_QUESTION,
              isUser: false,
              timestamp: nowTs,
            }
          ]);
          setIsInitializing(false);
          setIsLoading(true);
          setTimeout(() => {
            setIsLoading(false);
            setMessages(prev => [
              ...prev,
              {
                id: 'info',
                text: TRIP_PLANNING_SECOND_MESSAGE,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
              },
            ]);
            setTimeout(() => scrollToBottom(), 100);
          }, 2000);
        }

        // Create the backend chat in background
        const contextMessage = "Hi! I'm looking to connect with surfers.";

        svc.startTripPlanningConversation({ message: contextMessage }).then(response => {
          console.log('Chat initialized with response:', response);
          const newChatId = response.chat_id || null;
          setChatId(newChatId);
          if (onChatStateChange) onChatStateChange(newChatId, [], '');
          // Update message with backend index once available
          const backendMessageIndex = typeof response.message_index === 'number' && response.message_index >= 0 ? response.message_index : undefined;
          if (backendMessageIndex !== undefined) {
            setMessages(prev => prev.map(m => m.id === '1' ? { ...m, backendMessageIndex } : m));
          }
        }).catch(error => {
          console.error('Backend chat creation failed:', error);
          Alert.alert('Connection Error', 'Cannot connect to the backend server. Please check your internet connection and try again.', [{ text: 'OK' }]);
        });
        return; // isInitializing already set to false above

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

  const startLoadingWithTimeout = () => {
    setIsLoading(true);
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    loadingTimeoutRef.current = setTimeout(() => {
      console.warn('[TripPlanningChatScreen] Loading timeout reached (30s), forcing isLoading=false');
      setIsLoading(false);
    }, 30000);
  };

  const stopLoading = () => {
    setIsLoading(false);
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  };

  const runFindMatches = async (currentChatId: string, tripPlanningData: any, excludePrevious: boolean = false) => {
    if (!currentChatId) return;
    startLoadingWithTimeout();
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
      const { matches: rawMatches, totalCount, messageIndex: backendMsgIndex } = await svc.findMatchingUsersServer(currentChatId, tripPlanningData, excludePrevious);
      // Filter out blocked users from match results (both directions)
      const blockedSet = blockingService.getAllHiddenIdsSet();
      const matchedUsers = blockedSet.size > 0 ? rawMatches.filter(u => !blockedSet.has(u.user_id)) : rawMatches;
      console.log('Matched users found (server):', matchedUsers.length, 'totalCount:', totalCount, 'filtered:', rawMatches.length - matchedUsers.length);
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
        Keyboard.dismiss();
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
            matchTotalCount: totalCount,
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
          return updated;
        });
        if (backendMsgIndex != null) {
          setMessages(prevMsgs => prevMsgs.map(m => m.id === newMatchMessageId ? { ...m, backendMessageIndex: backendMsgIndex } : m));
        }
        setMatchedUsers(matchedUsers);
        setDestinationCountry(matchesDestination);
        setLastMatchRequestData(null);
        setLastMatchActionPressed(null);
        analyticsService.trackSwellyListCreated(matchedUsers.length, requestData.purpose?.purpose_type || 'general_guidance');
      } else {
        analyticsService.trackSwellySearchFailed();
        const noMatchesText = 'No surfers match your criteria right now. Try adjusting your destination or filters.';
        const matchesDestination = tripPlanningData.destination_country || '';
        const newNoMatchMessageId = (Date.now() + 3).toString();
        setMessages(prev => {
          const filtered = prev.filter(msg => msg.text !== 'Finding the perfect surfers for you...');
          const noMatchesMessage: Message = {
            id: newNoMatchMessageId,
            text: noMatchesText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            isMatchedUsers: false,
            matchedUsers: [],
            destinationCountry: matchesDestination,
            matchTotalCount: 0,
          };
          const updated = [...filtered, noMatchesMessage];
          return updated;
        });
        if (backendMsgIndex != null) {
          setMessages(prevMsgs => prevMsgs.map(m => m.id === newNoMatchMessageId ? { ...m, backendMessageIndex: backendMsgIndex } : m));
        }
        setLastMatchRequestData(null);
        setLastMatchActionPressed(null);
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
      stopLoading();
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
    setAwaitingSearchDecision(false);

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
        Keyboard.dismiss();
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
          
          // Match metadata already saved by find-matches endpoint
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
    chatInputRef.current?.focus();
    scrollToBottom();
    startLoadingWithTimeout();

    try {
      let response: SwellyChatResponse;

      if (chatId) {
        // Continue existing chat
        const continuePayload: { message: string; existing_query_filters?: any; adding_filters?: boolean; existing_destination_country?: string | null; existing_area?: string | null } = {
          message: userMessage.text,
        };
        const dataWithFilters = existingFiltersForAdd?.data ?? (awaitingSearchDecision && pendingSearch?.data ? pendingSearch?.data : null);
        if (dataWithFilters) {
          continuePayload.existing_query_filters = dataWithFilters.queryFilters ?? null;
          continuePayload.adding_filters = true;
          continuePayload.existing_destination_country = dataWithFilters.destination_country ?? null;
          continuePayload.existing_area = dataWithFilters.area ?? null;
        }
        const hasExistingFilters = continuePayload.existing_query_filters != null;
        const efKeys = hasExistingFilters && typeof continuePayload.existing_query_filters === 'object' ? Object.keys(continuePayload.existing_query_filters).join(',') : 'n/a';
        console.log('[continue] chatId=', chatId, 'message=', (userMessage.text || '').slice(0, 40), 'hasExistingQueryFilters=', hasExistingFilters, 'existing_query_filters keys=[' + efKeys + ']');
        response = await svc.continueTripPlanningConversation(chatId, continuePayload);
      } else {
        // This shouldn't happen since we initialize chat on mount, but fallback just in case
        console.log('Starting new chat (fallback)');
        response = await svc.startTripPlanningConversation({
          message: userMessage.text,
        });
        console.log('New chat response:', response);
        setChatId(response.chat_id || null);
      }

      const hasNextAction = (response.data as any)?.next_action != null;
      const hasSearchSummary = response.data?.search_summary != null && String(response.data.search_summary).trim() !== '';

      // When awaiting a search decision and user sends a message, handle it here
      if (awaitingSearchDecision && pendingSearch) {
        // Keep pendingSearch in sync with server-merged filters so subsequent "search" uses correct data
        if (response.data != null) {
          setPendingSearch({
            data: response.data,
            searchSummary: pendingSearch.searchSummary ?? (response.data as any)?.search_summary ?? '',
          });
          if (existingFiltersForAdd) {
            setExistingFiltersForAdd({ data: response.data });
          }
        }
        const msgLower = (userMessage.text || '').trim().toLowerCase();
        const userWantsSearch = /\b(send|search|go|yes|yep|yeah|sure|do it|perfect|looks good|sounds good|go ahead|let'?s\s*(go|search|do)|ready|find)\b/i.test(msgLower) && !/\b(change|edit|modify|tweak|update|remove|add|different|instead|wait|hold on|actually)\b/i.test(msgLower);
        const nextAction = (response.data as any)?.next_action;
        const effectiveSearch = nextAction === 'search' || (nextAction == null && userWantsSearch);
        if (effectiveSearch) {
          if (chatId) {
            const dataToSearch = response.data != null ? response.data : pendingSearch.data;
            if (hasSearchableFilters(dataToSearch)) {
              await runFindMatches(chatId, dataToSearch);
            } else {
              const noFilterMsg: Message = {
                id: (Date.now() + 1).toString(),
                text: "Add at least one filter (destination, origin, surf level, or board type) so I can search.",
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
              };
              setMessages(prev => [...prev, noFilterMsg]);
            }
          }
        } else {
          // Show the bot's response (e.g. updated summary after filter edit)
          const backendMessageIndex = typeof response.message_index === 'number' && response.message_index >= 0 ? response.message_index : undefined;
          const botMessage: Message = {
            id: (Date.now() + 1).toString(),
            text: hasSearchSummary ? response.data.search_summary : response.return_message,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            isSearchSummary: hasSearchSummary,
            ...(backendMessageIndex !== undefined && { backendMessageIndex }),
          };
          setMessages(prev => [...prev, botMessage]);
          if (hasSearchSummary) {
            setAwaitingSearchDecision(true);
          }
        }
      } else if (response.is_finished && response.data && !hasNextAction && !awaitingSearchDecision) {
        if (hasSearchableFilters(response.data)) {
          // First time seeing search_summary — show as text and wait for user decision
          setIsFinished(true);
          const summaryText = response.data?.search_summary ?? 'Ready to search with your current filters.';
          const searchSummary = response.data?.search_summary ?? '';
          const backendMessageIndex = typeof response.message_index === 'number' && response.message_index >= 0 ? response.message_index : undefined;
          const botMessage: Message = {
            id: (Date.now() + 1).toString(),
            text: summaryText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            isSearchSummary: true,
            ...(backendMessageIndex !== undefined && { backendMessageIndex }),
          };
          setMessages(prev => [...prev, botMessage]);
          setPendingSearch({ data: response.data, searchSummary });
          setAwaitingSearchDecision(true);
        } else {
          // No filters: show return_message only, do not enter search-or-edit mode
          const backendMessageIndex = typeof response.message_index === 'number' && response.message_index >= 0 ? response.message_index : undefined;
          const botMessage: Message = {
            id: (Date.now() + 1).toString(),
            text: response.return_message ?? 'Add at least one filter (destination, origin, surf level, or board type) so I can search.',
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            ...(backendMessageIndex !== undefined && { backendMessageIndex }),
          };
          setMessages(prev => [...prev, botMessage]);
        }
      } else if (hasNextAction && (response.data as any)?.next_action === 'search') {
        // Backend explicitly told us to search
        if (chatId && response.data) {
          if (hasSearchableFilters(response.data)) {
            await runFindMatches(chatId, response.data);
          } else {
            const noFilterMsg: Message = {
              id: (Date.now() + 1).toString(),
              text: "Add at least one filter (destination, origin, surf level, or board type) so I can search.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            };
            setMessages(prev => [...prev, noFilterMsg]);
          }
        }
      } else {
        const backendMessageIndex = typeof response.message_index === 'number' && response.message_index >= 0 ? response.message_index : undefined;
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: response.return_message,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          ...(backendMessageIndex !== undefined && { backendMessageIndex }),
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
      if (!awaitingSearchDecision) {
        setExistingFiltersForAdd(null);
      }
      stopLoading();
    }
  };

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
    // Pre-generate ID for synthetic message so we can reference it in the .then() callback
    const syntheticMessageId = (action === 'new_chat' || action === 'add_filter')
      ? (Date.now() + 1).toString()
      : null;
    setMessages(prev => {
      const updated = prev.map(m => {
        if (m.id === messageId && m.actionRow) {
          return { ...m, actionRow: { ...m.actionRow, selectedAction: action } };
        }
        // Auto-resolve any other unresolved action rows (stale from previous match batches)
        if (m.isMatchedUsers && m.actionRow && m.actionRow.selectedAction == null) {
          return { ...m, actionRow: { ...m.actionRow, selectedAction: 'more' } };
        }
        return m;
      });
      const msg = updated.find(m => m.id === messageId);
      const requestData = msg?.actionRow?.requestData;
      const backendIdx = msg?.backendMessageIndex;
      messageIndexForPatch = typeof backendIdx === 'number' && backendIdx >= 0 ? backendIdx : null;
      if (messageIndexForPatch == null && (msg?.actionRow != null || msg?.isMatchedUsers)) {
        console.warn('[TripPlanningChatScreen] handleMatchAction: missing backendMessageIndex for message', messageId, '- PATCH will be skipped');
      }
      if (action === 'new_chat') {
        const firstQuestionMessage: Message = {
          id: syntheticMessageId!,
          text: TRIP_PLANNING_FIRST_QUESTION,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          isRestartAfterNewChat: true,
        };
        // Show typing indicator then append second message after 2s
        setIsLoading(true);
        setTimeout(() => {
          setIsLoading(false);
          setMessages(prev => [
            ...prev,
            {
              id: (Date.now() + 2).toString(),
              text: TRIP_PLANNING_SECOND_MESSAGE,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            },
          ]);
          setTimeout(() => scrollToBottom(), 100);
        }, 2000);
        return [...updated, firstQuestionMessage];
      }
      if (action === 'add_filter' && requestData != null) {
        setIsFinished(false);
        setExistingFiltersForAdd({ data: { ...requestData } });
        const addFilterBotMessage: Message = {
          id: syntheticMessageId!,
          text: "Great! We can add some filters to your search. What would you like to add? For example: board type, surf level, destinations they've surfed, age, or country of origin.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        };
        return [...updated, addFilterBotMessage];
      }
      if (action === 'more' && chatId && requestData != null) {
        runFindMatches(chatId, requestData, true).catch(() => stopLoading());
        return updated;
      }
      return updated;
    });
    if (action === 'new_chat') {
      setPendingSearch(null);
      setAwaitingSearchDecision(false);
      setIsFinished(false);
      setExistingFiltersForAdd(null);
      setFiltersMenuVisible(false);
      scrollToBottom();
    }
    if (messageIndexForPatch != null && messageIndexForPatch >= 0 && chatId) {
      svc.updateMatchActionSelection(chatId, messageIndexForPatch, action)
        .then(result => {
          if (result?.appendedMessageIndex != null && syntheticMessageId) {
            setMessages(prev => prev.map(m =>
              m.id === syntheticMessageId && m.backendMessageIndex == null
                ? { ...m, backendMessageIndex: result.appendedMessageIndex }
                : m
            ));
          }
        })
        .catch(err => console.warn('[TripPlanningChatScreen] Failed to persist action selection:', err));
    }
  };

  const handleStartNewChat = async () => {
    setShowNewChatModal(false);
    // Reset all conversation state
    setMessages([]);
    startLoadingWithTimeout();
    setIsInitializing(true);
    setIsFinished(false);
    setMatchedUsers([]);
    setDestinationCountry('');
    setPendingSingleCriterionMatches(null);
    setSingleCriterionType(null);
    setPendingSearch(null);
    setAwaitingSearchDecision(false);
    setLastMatchRequestData(null);
    setLastMatchActionPressed(null);
    setExistingFiltersForAdd(null);
    setFiltersMenuVisible(false);
    setAwaitingFilterRemovalResponse(false);
    setMessageIdsUnblockedByFilterDeletion({});

    try {
      // Build context message same as initial mount
      const contextMessage = "Hi! I'm looking to connect with surfers.";

      const response = await svc.startTripPlanningConversation({ message: contextMessage });
      const newChatId = response.chat_id || null;
      setChatId(newChatId);

      if (onChatStateChange) {
        onChatStateChange(newChatId, [], '');
      }

      const backendMessageIndex = typeof response.message_index === 'number' && response.message_index >= 0 ? response.message_index : undefined;
      setMessages([{
        id: Date.now().toString(),
        text: response.return_message,
        isUser: false,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        ...(backendMessageIndex !== undefined && { backendMessageIndex }),
      }]);
      // Show typing indicator then append second message after 2s
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 2).toString(),
            text: TRIP_PLANNING_SECOND_MESSAGE,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          },
        ]);
        setTimeout(() => scrollToBottom(), 100);
      }, 2000);
    } catch (error) {
      console.error('Failed to start new chat:', error);
      setMessages([{
        id: Date.now().toString(),
        text: TRIP_PLANNING_FIRST_QUESTION,
        isUser: false,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      }]);
      // Show typing indicator then append second message after 2s
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 2).toString(),
            text: TRIP_PLANNING_SECOND_MESSAGE,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          },
        ]);
        setTimeout(() => scrollToBottom(), 100);
      }, 2000);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleRemoveFilter = (item: FilterDisplayItem) => {
    if (!currentRequestData) return;
    const nextRequestData = removeFilterFromRequestData(currentRequestData, item);
    const qfKeys = nextRequestData?.queryFilters && typeof nextRequestData.queryFilters === 'object' ? Object.keys(nextRequestData.queryFilters).join(',') : 'n/a';
    console.log('[filter-removal] filterSource=', filterSource, 'removedLabel=', item.label, 'nextRequestData.queryFilters keys=[' + qfKeys + '] destination_country=', nextRequestData?.destination_country);
    if (filterSource === 'existingFiltersForAdd') {
      setExistingFiltersForAdd({ data: nextRequestData });
      return;
    }
    if (filterSource === 'pendingSearch' && pendingSearch) {
      setPendingSearch({ data: nextRequestData, searchSummary: pendingSearch.searchSummary ?? '' });
      const matchMessageId = unresolvedActionRowMessageIdRef.current;
      if (matchMessageId) {
        setMessages(prev =>
          prev.map(m =>
            m.id === matchMessageId && m.actionRow
              ? { ...m, actionRow: { ...m.actionRow, requestData: nextRequestData } }
              : m
          )
        );
      }
      if (chatId) {
        setFiltersMenuVisible(false);
        setAwaitingFilterRemovalResponse(true);
        console.log('[filter-removal] calling acknowledgeFilterRemoval context=pending_search chatId=', chatId);
        svc.acknowledgeFilterRemoval(chatId, {
          requestData: nextRequestData,
          removedFilterLabel: item.label,
          context: 'pending_search',
        }).then(res => {
          setAwaitingFilterRemovalResponse(false);
          if (res.success) {
            const idToUnblock = unresolvedActionRowMessageIdRef.current;
            if (idToUnblock) setMessageIdsUnblockedByFilterDeletion(prev => ({ ...prev, [idToUnblock]: true }));
            if (res.newMessage) {
              setMessages(prev => [...prev, { ...res.newMessage!, id: res.newMessage!.id, text: res.newMessage!.text, isUser: false, timestamp: res.newMessage!.timestamp }]);
              scrollToBottom();
            }
          }
        }).catch(() => setAwaitingFilterRemovalResponse(false));
      }
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
        setFiltersMenuVisible(false);
        setAwaitingFilterRemovalResponse(true);
        console.log('[filter-removal] calling acknowledgeFilterRemoval context=message chatId=', chatId, 'messageIndex=', backendIndex);
        svc.updateMatchRequestData(chatId, backendIndex, nextRequestData).catch(err =>
          console.warn('[TripPlanningChatScreen] Failed to persist filter removal:', err));
        svc.acknowledgeFilterRemoval(chatId, {
          messageIndex: backendIndex,
          requestData: nextRequestData,
          removedFilterLabel: item.label,
          context: 'message',
        }).then(res => {
          setAwaitingFilterRemovalResponse(false);
          if (res.success) {
            setMessageIdsUnblockedByFilterDeletion(prev => ({ ...prev, [filterSourceMessage.id]: true }));
            if (res.newMessage) {
              setMessages(prev => [...prev, { ...res.newMessage!, id: res.newMessage!.id, text: res.newMessage!.text, isUser: false, timestamp: res.newMessage!.timestamp }]);
              scrollToBottom();
            }
          }
        }).catch(() => setAwaitingFilterRemovalResponse(false));
      } else {
        console.warn('[filter-removal] NOT calling backend: context=message but backendMessageIndex missing or invalid', { backendIndex, chatId: chatId != null });
        setMessageIdsUnblockedByFilterDeletion(prev => ({ ...prev, [filterSourceMessage.id]: true }));
      }
    }
  };

  const chipPanResponders = useMemo(() => {
    const map: Record<string, ReturnType<typeof PanResponder.create>> = {};
    filterDisplayList.forEach(item => {
      map[item.id] = PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 8 || Math.abs(g.dx) > 8,
        onPanResponderGrant: (evt) => {
          const chipRef = chipRefsMap.current[item.id];
          const cardRef = filtersMenuCardRef.current;
          const native = evt.nativeEvent as { pageX?: number; pageY?: number; locationX?: number; locationY?: number };
          const offsetX = native.locationX ?? 0;
          const offsetY = native.locationY ?? 0;
          const setGhost = (cx: number, cy: number) => {
            const fingerX = cx + offsetX;
            const fingerY = cy + offsetY;
            setDragState({ item, ghostX: fingerX, ghostY: fingerY, chipX: cx, chipY: cy, touchOffsetX: offsetX, touchOffsetY: offsetY });
          };
          const updateCardThenSet = (cx: number, cy: number) => {
            if (cardRef && typeof (cardRef as any).measureInWindow === 'function') {
              (cardRef as any).measureInWindow((cardX: number, cardY: number, width?: number, height?: number) => {
                cardBoundsRef.current = { x: cardX, y: cardY, width: width ?? 0, height: height ?? 0 };
                setGhost(cx, cy);
              });
            } else {
              setGhost(cx, cy);
            }
          };
          if (chipRef && typeof (chipRef as any).measureInWindow === 'function') {
            (chipRef as any).measureInWindow((x: number, y: number) => {
              updateCardThenSet(x, y);
            });
          } else if (typeof native.pageX === 'number' && typeof native.pageY === 'number') {
            updateCardThenSet(native.pageX - offsetX, native.pageY - offsetY);
          }
        },
        onPanResponderMove: (_, g) => {
          const CHIP_WIDTH = 150;
          const CHIP_HEIGHT = 40;
          setDragState(prev => {
            if (!prev || prev.item.id !== item.id) return prev;
            let chipLeft = prev.ghostX + g.dx - (prev.touchOffsetX ?? 0);
            let chipTop = prev.ghostY + g.dy - (prev.touchOffsetY ?? 0);
            const card = cardBoundsRef.current;
            if (card.width > 0 && card.height > 0) {
              const minX = card.x;
              const maxX = card.x + card.width - CHIP_WIDTH;
              const minY = card.y;
              const maxY = card.y + card.height - CHIP_HEIGHT;
              chipLeft = Math.max(minX, Math.min(maxX, chipLeft));
              chipTop = Math.max(minY, Math.min(maxY, chipTop));
            }
            const ghostX = chipLeft + (prev.touchOffsetX ?? 0);
            const ghostY = chipTop + (prev.touchOffsetY ?? 0);
            const ghostCenterX = chipLeft + 60;
            const ghostCenterY = chipTop + 18;
            const tb = trashZoneBounds.current;
            let progress = 0;
            if (tb) {
              const trashCenterY = tb.y + tb.height / 2;
              const progressStartY = tb.y - 250;
              if (ghostCenterY >= trashCenterY) {
                progress = 1;
              } else if (ghostCenterY > progressStartY) {
                progress = Math.max(0, Math.min(1, (ghostCenterY - progressStartY) / (trashCenterY - progressStartY)));
              }
            }
            setTrashHoverProgress(progress);
            trashProgressAnim.setValue(progress);
            return { ...prev, ghostX, ghostY };
          });
        },
        onPanResponderRelease: () => {
          const prev = dragStateRef.current;
          setTrashHoverProgress(0);
          Animated.timing(trashProgressAnim, {
            toValue: 0,
            duration: 250,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }).start();
          setDragState(null);
          if (!prev || prev.item.id !== item.id) return;
          const tb = trashZoneBounds.current;
          const chipLeft = prev.ghostX - (prev.touchOffsetX ?? 0);
          const chipTop = prev.ghostY - (prev.touchOffsetY ?? 0);
          const ghostCenterX = chipLeft + 60;
          const ghostCenterY = chipTop + 18;
          if (tb && ghostCenterX >= tb.x && ghostCenterX <= tb.x + tb.width && ghostCenterY >= tb.y && ghostCenterY <= tb.y + tb.height) {
            handleRemoveFilter(prev.item);
          }
        },
      });
    });
    return map;
  }, [filterDisplayList, handleRemoveFilter]);

  const handleLongPressMessage = (message: Message) => {
    if (message.isUser) return;
    const ref = messageBubbleRefs.current[message.id];
    if (ref) {
      ref.measureInWindow((x, y, _w, _h) => {
        setReportMessageX(x);
        setReportMessageY(y);
        setReportMessageText(message.text);
        setReportMessageTimestamp(message.timestamp);
        setReportMessageId(message.id);
        setReportSheetVisible(true);
      });
    } else {
      setReportMessageText(message.text);
      setReportMessageTimestamp(message.timestamp);
      setReportMessageId(message.id);
      setReportSheetVisible(true);
    }
  };

  const renderMessage = (message: Message) => {
    // Match-result message (has action row; matchedUsers can be empty for no-matches)
    if (message.isMatchedUsers && Array.isArray(message.matchedUsers) && message.matchedUsers.length > 0) {
      const selectedAction = message.actionRow?.selectedAction ?? null;
      const requestData = message.actionRow?.requestData;
      const hasActionRow = requestData != null;
      const disabled = selectedAction !== null;
      const isSelectedMatch = reportSheetVisible && reportMessageId === message.id;
      return (
        <View style={isSelectedMatch ? styles.hiddenMessage : undefined}>
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
          
          {/* Render matched user cards carousel (only when there are matches, filtered for blocked) */}
          {(() => {
            const blocked = blockingService.getAllHiddenIdsSet();
            const filteredUsers = blocked.size > 0
              ? message.matchedUsers.filter(u => !blocked.has(u.user_id))
              : message.matchedUsers;
            return filteredUsers.length > 0 ? (
              <MatchedUsersCarousel
                users={filteredUsers}
                onViewProfile={handleViewProfile}
              />
            ) : null;
          })()}

          {/* Per-message action row (New Chat, Filters, More Matches) */}
          {hasActionRow && (
            <View style={styles.actionButtonsRow}>
              {/* New Chat button — hidden for now
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={disabled}
                onPress={() => handleMatchAction(message.id, 'new_chat')}
                style={[styles.actionButtonNew, selectedAction === 'new_chat' && styles.actionButtonInnerSelected]}
              >
                <Svg width={20} height={20} viewBox="0 0 22 22" fill="none">
                  <Path d="M9.16602 3.33344H5.66602C4.26588 3.33344 3.56582 3.33344 3.03104 3.60593C2.56063 3.84561 2.17818 4.22806 1.9385 4.69847C1.66602 5.23324 1.66602 5.93331 1.66602 7.33344V14.3334C1.66602 15.7336 1.66602 16.4336 1.9385 16.9684C2.17818 17.4388 2.56063 17.8213 3.03104 18.061C3.56582 18.3334 4.26588 18.3334 5.66602 18.3334H12.666C14.0661 18.3334 14.7662 18.3334 15.301 18.061C15.7714 17.8213 16.1538 17.4388 16.3935 16.9684C16.666 16.4336 16.666 15.7336 16.666 14.3334V10.8334M6.66599 13.3334H8.06145C8.4691 13.3334 8.67292 13.3334 8.86474 13.2874C9.0348 13.2466 9.19737 13.1792 9.34649 13.0878C9.51468 12.9848 9.65881 12.8406 9.94706 12.5524L17.916 4.58344C18.6064 3.89309 18.6064 2.7738 17.916 2.08344C17.2257 1.39309 16.1064 1.39308 15.416 2.08344L7.44704 10.0524C7.15879 10.3406 7.01466 10.4848 6.91159 10.653C6.82021 10.8021 6.75287 10.9647 6.71204 11.1347C6.66599 11.3265 6.66599 11.5304 6.66599 11.938V13.3334Z" stroke="#222222" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Text style={[styles.actionButtonTextNew, selectedAction === 'new_chat' && styles.actionButtonTextSelected]}>New Chat</Text>
              </TouchableOpacity>
              */}
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={disabled}
                onPress={() => handleMatchAction(message.id, 'add_filter')}
                style={[styles.actionButtonNew, selectedAction === 'add_filter' && styles.actionButtonInnerSelected]}
              >
                <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                  <Path d="M2 4H14M4 8H12M6 12H10" stroke="#333333" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Text style={[styles.actionButtonTextNew, selectedAction === 'add_filter' && styles.actionButtonTextSelected]}>Filters</Text>
              </TouchableOpacity>
              {((message.matchTotalCount ?? message.matchedUsers?.length ?? 0) > 3) && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={disabled}
                  onPress={() => handleMatchAction(message.id, 'more')}
                  style={[styles.actionButtonNew, selectedAction === 'more' && styles.actionButtonInnerSelected]}
                >
                  <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                    <Path d="M10.667 14V12.667C10.667 11.96 10.386 11.281 9.886 10.781C9.386 10.281 8.707 10 8 10H4C3.293 10 2.614 10.281 2.114 10.781C1.614 11.281 1.333 11.96 1.333 12.667V14" stroke="#333333" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M6 7.333C7.473 7.333 8.667 6.14 8.667 4.667C8.667 3.194 7.473 2 6 2C4.527 2 3.333 3.194 3.333 4.667C3.333 6.14 4.527 7.333 6 7.333Z" stroke="#333333" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M14.667 14V12.667C14.667 12.088 14.477 11.525 14.125 11.067C13.774 10.609 13.281 10.281 12.727 10.133" stroke="#333333" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M10.727 2.133C11.281 2.281 11.774 2.609 12.125 3.067C12.477 3.525 12.667 4.088 12.667 4.667C12.667 5.245 12.477 5.808 12.125 6.267C11.774 6.725 11.281 7.052 10.727 7.2" stroke="#333333" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={[styles.actionButtonTextNew, selectedAction === 'more' && styles.actionButtonTextSelected]}>3 More</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      );
    }

    // Regular message rendering
    const bubbleContent = (
      <View
        ref={(r) => { if (!message.isUser) messageBubbleRefs.current[message.id] = r; }}
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
    );

    const isSelected = reportSheetVisible && reportMessageId === message.id;

    return (
      <View style={isSelected ? styles.hiddenMessage : undefined}>
        <View
          style={[
            styles.messageContainer,
            message.isUser ? styles.userMessageContainer : styles.botMessageContainer,
          ]}
        >
          {message.isUser ? bubbleContent : (
            <Pressable onLongPress={() => handleLongPressMessage(message)} delayLongPress={400}>
              {bubbleContent}
            </Pressable>
          )}
        </View>
        {!message.isUser && message.isSearchSummary && (
          <View style={styles.reviewFiltersRow}>
            <TouchableOpacity
              onPress={() => {
                if (chatId && pendingSearch) {
                  setAwaitingSearchDecision(false);
                  runFindMatches(chatId, pendingSearch.data);
                }
              }}
              activeOpacity={0.8}
              style={styles.searchNowButtonOuter}
            >
              <View
                style={styles.searchNowButtonInner}
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  if (width !== searchBtnSize.w || height !== searchBtnSize.h) {
                    setSearchBtnSize({ w: width, h: height });
                  }
                }}
              >
                {/* SVG gradient border — stroke only, no fill, so nothing bleeds through */}
                {searchBtnSize.w > 0 && (
                  <Svg
                    style={{ position: 'absolute', top: 0, left: 0 }}
                    width={searchBtnSize.w}
                    height={searchBtnSize.h}
                    pointerEvents="none"
                  >
                    <Defs>
                      <SvgLinearGradient id="searchBorderGrad" x1="0" y1="0" x2={searchBtnSize.w} y2="0" gradientUnits="userSpaceOnUse">
                        <Stop stopColor="#B72DF2" />
                        <Stop offset="1" stopColor="#FF5367" />
                      </SvgLinearGradient>
                    </Defs>
                    <Rect x={0.5} y={0.5} width={searchBtnSize.w - 1} height={searchBtnSize.h - 1} rx={23.5} ry={23.5} stroke="url(#searchBorderGrad)" strokeWidth={1} fill="none" />
                  </Svg>
                )}
                <Svg width={15} height={15} viewBox="0 0 15 15" fill="none">
                  <Path d="M2.16667 13.8333V10.5M2.16667 3.83333V0.5M0.5 2.16667H3.83333M0.5 12.1667H3.83333M7.83333 1.16667L6.67721 4.17257C6.48921 4.66139 6.3952 4.9058 6.24902 5.11139C6.11946 5.2936 5.96026 5.45279 5.77806 5.58235C5.57247 5.72854 5.32806 5.82254 4.83924 6.01055L1.83333 7.16667L4.83924 8.32278C5.32806 8.51079 5.57247 8.6048 5.77806 8.75098C5.96027 8.88054 6.11946 9.03973 6.24902 9.22194C6.3952 9.42753 6.48921 9.67194 6.67722 10.1608L7.83333 13.1667L8.98945 10.1608C9.17746 9.67194 9.27146 9.42753 9.41765 9.22194C9.54721 9.03973 9.7064 8.88054 9.88861 8.75098C10.0942 8.6048 10.3386 8.51079 10.8274 8.32278L13.8333 7.16667L10.8274 6.01055C10.3386 5.82254 10.0942 5.72854 9.88861 5.58235C9.7064 5.45279 9.54721 5.2936 9.41765 5.11139C9.27146 4.9058 9.17746 4.66139 8.98945 4.17257L7.83333 1.16667Z" stroke="url(#searchGradient)" strokeLinecap="round" strokeLinejoin="round" />
                  <Defs>
                    <SvgLinearGradient id="searchGradient" x1="0.5" y1="7.16667" x2="13.8333" y2="7.16667" gradientUnits="userSpaceOnUse">
                      <Stop stopColor="#B72DF2" />
                      <Stop offset="1" stopColor="#FF5367" />
                    </SvgLinearGradient>
                  </Defs>
                </Svg>
                <Text style={styles.searchNowButtonText}>Search</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setFiltersMenuVisible(true)}
              activeOpacity={0.8}
              style={styles.reviewFiltersButton}
            >
              <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                <Path d="M2 5.3335L10 5.3335M10 5.3335C10 6.43807 10.8954 7.3335 12 7.3335C13.1046 7.3335 14 6.43807 14 5.3335C14 4.22893 13.1046 3.3335 12 3.3335C10.8954 3.3335 10 4.22893 10 5.3335ZM6 10.6668L14 10.6668M6 10.6668C6 11.7714 5.10457 12.6668 4 12.6668C2.89543 12.6668 2 11.7714 2 10.6668C2 9.56226 2.89543 8.66683 4 8.66683C5.10457 8.66683 6 9.56226 6 10.6668Z" stroke="#333333" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={styles.reviewFiltersButtonText}>Review filters</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const renderItem = useCallback(({ item }: { item: Message }) => {
    return renderMessage(item);
  }, [messages, matchedUsers, filtersMenuVisible, pendingSearch, chatId, searchBtnSize, filterDisplayList, reportSheetVisible, reportMessageId]);

  const listHeaderComponent = useMemo(() => {
    if (!isLoading && !isInitializing && !isAwaitingFilterRemovalResponse) return null;
    return (
      <View style={[styles.messageContainer, styles.botMessageContainer]}>
        <View style={[styles.messageBubble, styles.botMessageBubble]}>
          <View style={styles.messageTextContainer}>
            <TypingIndicator />
          </View>
        </View>
      </View>
    );
  }, [isLoading, isInitializing, isAwaitingFilterRemovalResponse]);

  return (
    <>
    <SafeAreaView style={styles.container} edges={['top']}>
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
                {Platform.OS === 'web' ? (
                  <Image
                    source={{ uri: getImageUrl('/Ellipse 11.svg') }}
                    style={styles.ellipseBackground}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.ellipseBackgroundNative} />
                )}
                <View style={styles.avatarImageContainer}>
                  <Image
                    source={Images.swellyAvatar}
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
          
          <TouchableOpacity style={styles.editButton} onPress={() => setShowNewChatModal(true)}>
            <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
              <Path d="M8 2.26777H4.5C3.09987 2.26777 2.3998 2.26777 1.86502 2.54025C1.39462 2.77994 1.01217 3.16239 0.772484 3.63279C0.5 4.16757 0.5 4.86764 0.5 6.26777V13.2678C0.5 14.6679 0.5 15.368 0.772484 15.9027C1.01217 16.3731 1.39462 16.7556 1.86502 16.9953C2.3998 17.2678 3.09987 17.2678 4.5 17.2678H11.5C12.9001 17.2678 13.6002 17.2678 14.135 16.9953C14.6054 16.7556 14.9878 16.3731 15.2275 15.9027C15.5 15.368 15.5 14.6679 15.5 13.2678V9.76777M5.49998 12.2678H6.89543C7.30308 12.2678 7.50691 12.2678 7.69872 12.2217C7.86878 12.1809 8.03135 12.1135 8.18047 12.0222C8.34867 11.9191 8.4928 11.775 8.78105 11.4867L16.75 3.51777C17.4404 2.82741 17.4404 1.70812 16.75 1.01777C16.0596 0.327412 14.9404 0.327411 14.25 1.01777L6.28103 8.98672C5.99277 9.27497 5.84865 9.4191 5.74558 9.58729C5.6542 9.73641 5.58686 9.89899 5.54603 10.069C5.49998 10.2609 5.49998 10.4647 5.49998 10.8723V12.2678Z" stroke="#7B7B7B" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>

      {/* Chat Messages */}
      <Reanimated.View style={[styles.chatContainer, animatedKeyboardPadding]}>
        <ImageBackground
          source={Images.chatBackground}
          style={styles.backgroundImage}
          resizeMode="cover"
        >
          <FlatList
            ref={flatListRef}
            data={invertedMessages}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            extraData={reportMessageId}
            inverted
            style={styles.messagesList}
            contentContainerStyle={[styles.messagesContent, { flexGrow: 1, justifyContent: 'flex-end' }]}
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onLayout={handleLayout}
            ListHeaderComponent={listHeaderComponent}
            initialNumToRender={50}
            maxToRenderPerBatch={50}
            windowSize={21}
            keyboardShouldPersistTaps="handled"
          />
        </ImageBackground>

        {/* Floating filters button: 7px from top (below header), 14px from right */}
        <View
          ref={filtersButtonRef}
          style={styles.filtersButtonFloating}
          pointerEvents="box-none"
          onLayout={measureFiltersButton}
          collapsable={false}
        >
          <TouchableOpacity
            onPress={() => setFiltersMenuVisible(true)}
            activeOpacity={1}
            style={styles.filtersButtonPill}
          >
            {filterCount > 0 && (
              <View style={styles.filtersButtonCountWrap}>
                <View style={styles.filtersButtonRedDot} />
                <Text style={styles.filtersButtonCountText}>{filterCount}</Text>
              </View>
            )}
            <Ionicons name="options-outline" size={24} color="#333" />
          </TouchableOpacity>
        </View>

        {/* Input Area */}
        <Reanimated.View style={[styles.inputWrapper, animatedComposerPadding]}>
          <ChatTextInput
            ref={chatInputRef}
            value={inputText}
            onChangeText={setInputText}
            onSend={sendMessage}
            disabled={isLoading || hasUnresolvedActionRow || isAwaitingFilterRemovalResponse}
            placeholder={hasUnresolvedActionRow ? 'Choose an option above to continue' : 'Type your message..'}
            maxLength={500}
            primaryColor="#B72DF2"
          />
        </Reanimated.View>

        {/* Filter dialog: full conversation area, gradient + blur, chips at top */}
        {filtersMenuVisible && (
          <Animated.View
            style={[
              styles.filtersOverlay,
              {
                transform: [
                  {
                    translateY: filterMenuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents="box-none"
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setFiltersMenuVisible(false)} />
            <View
              style={[
                StyleSheet.absoluteFill,
                Platform.OS === 'web' && ({ backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' } as any),
              ]}
              pointerEvents="none"
            />
            <LinearGradient
              colors={[
                'rgba(247,247,247,0)',
                'rgba(247,247,247,0)',
                `rgba(255,255,255,${0.9 + 0.1 * trashHoverProgress})`,
              ]}
              locations={[0, 0.1596, 0.9553]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0.5, y: 1 }}
              end={{ x: 0.5, y: 0 }}
              pointerEvents="none"
            />
            <View
              ref={filtersMenuCardRef}
              style={styles.filtersOverlayContent}
              onLayout={() => {
                filtersMenuCardRef.current?.measureInWindow?.((x: number, y: number, width?: number, height?: number) => {
                  cardBoundsRef.current = { x, y, width: width ?? 0, height: height ?? 0 };
                });
              }}
              pointerEvents="box-none"
            >
              <View style={styles.filtersOverlayTop}>
                <View
                  ref={filtersChipsRowRef}
                  style={styles.filtersChipsRow}
                  onLayout={measureFiltersChips}
                  collapsable={false}
                >
                  {filterDisplayList.length === 0 && tutorial.currentStep === 4 ? (
                    TUTORIAL_MOCK_CHIPS.map(item => {
                      const parts = getLabelParts(item.label);
                      return (
                        <View key={item.id} style={styles.filterChip}>
                          <View style={styles.filterChipRemove}>
                            <Ionicons name="close" size={18} color="#7B7B7B" />
                          </View>
                          <Text style={styles.filterChipLabel} numberOfLines={1}>
                            {parts ? (
                              <>
                                <Text style={styles.filterChipPrefix}>{parts.prefix}: </Text>
                                <Text style={styles.filterChipValue}>{parts.value}</Text>
                              </>
                            ) : (
                              item.label
                            )}
                          </Text>
                        </View>
                      );
                    })
                  ) : filterDisplayList.length === 0 ? (
                    <View style={styles.filtersEmptyCard}>
                      <Text style={styles.filtersEmptyCardText}>
                        You can filter and search for other users based on - surf lvl, board type, age, origin country, and any destination they've been to.
                      </Text>
                    </View>
                  ) : (
                    filterDisplayList.map(item => {
                      const parts = getLabelParts(item.label);
                      const pan = chipPanResponders[item.id];
                      return (
                        <View
                          key={item.id}
                          ref={r => { chipRefsMap.current[item.id] = r; }}
                          style={[styles.filterChip, dragState?.item.id === item.id && styles.filterChipDragging]}
                          {...(pan?.panHandlers ?? {})}
                        >
                          <TouchableOpacity
                            onPress={() => handleRemoveFilter(item)}
                            style={styles.filterChipRemove}
                            hitSlop={8}
                          >
                            <Ionicons name="close" size={18} color="#7B7B7B" />
                          </TouchableOpacity>
                          <Text style={styles.filterChipLabel} numberOfLines={1}>
                            {parts ? (
                              <>
                                <Text style={styles.filterChipPrefix}>{parts.prefix}: </Text>
                                <Text style={styles.filterChipValue}>{parts.value}</Text>
                              </>
                            ) : (
                              item.label
                            )}
                          </Text>
                        </View>
                      );
                    })
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => setFiltersMenuVisible(false)}
                  activeOpacity={1}
                  style={[styles.filtersButtonPill, styles.filtersOverlayClose]}
                  hitSlop={12}
                >
                  {displayFilterCount > 0 && (
                    <View style={styles.filtersButtonCountWrap}>
                      <View style={styles.filtersButtonRedDot} />
                      <Text style={styles.filtersButtonCountText}>{displayFilterCount}</Text>
                    </View>
                  )}
                  <Ionicons name="options-outline" size={24} color="#333" />
                </TouchableOpacity>
              </View>
              <View style={styles.filtersOverlaySpacer} pointerEvents="none" />
              <View
                ref={trashZoneRef}
                style={styles.filtersDragZone}
                onLayout={() => {
                  trashZoneRef.current?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
                    trashZoneBounds.current = { x, y, width, height };
                  });
                }}
              >
                <Text style={styles.filtersDragZoneText}>Drag to Delete</Text>
                <Animated.View
                  style={[
                    styles.filtersDragZoneTrash,
                    {
                      backgroundColor: trashProgressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.60)'],
                      }),
                      transform: [
                        {
                          scale: trashProgressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.1],
                          }),
                        },
                      ],
                    },
                  ]}
                  collapsable={false}
                >
                  <Svg width={48} height={48} viewBox="0 0 48 48" fill="none">
                    <Path
                      d="M8 9H41M38.5 9L37.0974 30.0386C36.887 33.1951 36.7818 34.7733 36.1 35.97C35.4998 37.0236 34.5945 37.8706 33.5033 38.3994C32.2639 39 30.6822 39 27.5187 39H21.4813C18.3178 39 16.7361 39 15.4967 38.3994C14.4055 37.8706 13.5002 37.0236 12.9 35.97C12.2182 34.7733 12.113 33.1951 11.9026 30.0386L10.5 9"
                      stroke="#212121"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <Path
                      d="M25.3594 28.965H28.2324C29.4803 28.965 30.1043 28.965 30.4586 28.6999C30.7674 28.4688 30.9635 28.1143 30.997 27.7265C31.0353 27.2818 30.71 26.742 30.0593 25.6624L29.3923 24.5558M20.7632 23.2705L19.3215 25.6624C18.6708 26.742 18.3455 27.2818 18.3838 27.7265C18.4173 28.1143 18.6134 28.4688 18.9222 28.6999C19.2765 28.965 19.9005 28.965 21.1484 28.965H22.3488M27.9613 22.1816L26.5172 19.7858C25.9132 18.7837 25.6112 18.2827 25.2224 18.1118C24.883 17.9627 24.4978 17.9627 24.1584 18.1118C23.7696 18.2827 23.4676 18.7837 22.8636 19.7858L22.1813 20.9178M28.7046 19.4683L27.97 22.2482L25.2282 21.5033M18 23.944L20.7418 23.1991L21.4764 25.979M27.032 31L25.0249 28.965L27.032 26.93"
                      stroke="#212121"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </Animated.View>
              </View>
              {dragState && (
                <View
                  style={[
                    styles.filterChip,
                    styles.filterChipGhost,
                    {
                      position: 'absolute',
                      left: dragState.ghostX - (dragState.touchOffsetX ?? 0) - cardBoundsRef.current.x,
                      top: dragState.ghostY - (dragState.touchOffsetY ?? 0) - cardBoundsRef.current.y,
                    },
                  ]}
                  pointerEvents="none"
                >
                  <Text style={styles.filterChipLabel} numberOfLines={1}>
                    {(() => {
                      const parts = getLabelParts(dragState.item.label);
                      return parts ? (
                        <>
                          <Text style={styles.filterChipPrefix}>{parts.prefix}: </Text>
                          <Text style={styles.filterChipValue}>{parts.value}</Text>
                        </>
                      ) : (
                        dragState.item.label
                      );
                    })()}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        )}
      </Reanimated.View>
      {/* New Chat Confirmation Modal */}
      <Modal
        visible={showNewChatModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNewChatModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowNewChatModal(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {/* Top row: trash icon + close button */}
            <View style={styles.modalTopRow}>
              <View style={styles.modalTrashIcon}>
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <Path d="M16 6V5.2C16 4.0799 16 3.51984 15.782 3.09202C15.5903 2.71569 15.2843 2.40973 14.908 2.21799C14.4802 2 13.9201 2 12.8 2H11.2C10.0799 2 9.51984 2 9.09202 2.21799C8.71569 2.40973 8.40973 2.71569 8.21799 3.09202C8 3.51984 8 4.0799 8 5.2V6M10 11.5V16.5M14 11.5V16.5M3 6H21M19 6V17.2C19 18.8802 19 19.7202 18.673 20.362C18.3854 20.9265 17.9265 21.3854 17.362 21.673C16.7202 22 15.8802 22 14.2 22H9.8C8.11984 22 7.27976 22 6.63803 21.673C6.07354 21.3854 5.6146 20.9265 5.32698 20.362C5 19.7202 5 18.8802 5 17.2V6" stroke="#D92D20" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowNewChatModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {/* Swelly avatar bubble */}
            <View style={styles.modalAvatarBubble}>
              <Image
                source={Images.swellyAvatar}
                style={styles.modalAvatarImage}
                resizeMode="cover"
              />
            </View>

            {/* Title */}
            <Text style={styles.modalTitle}>Start a new chat?</Text>

            {/* Description */}
            <Text style={styles.modalDescription}>
              Starting a new chat will permanently delete your current conversation with Swelly and all the progress within it.{'\n'}This action cannot be undone.
            </Text>

            {/* Buttons */}
            <View style={styles.modalButtonRow}>
              <TouchableOpacity style={styles.modalKeepButton} onPress={() => setShowNewChatModal(false)}>
                <Text style={styles.modalKeepButtonText}>Keep this chat</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalStartButton} onPress={handleStartNewChat}>
                <Text style={styles.modalStartButtonText}>Start new chat</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <ReportAISheet
        visible={reportSheetVisible}
        messageText={reportMessageText}
        messageTimestamp={reportMessageTimestamp}
        messageX={reportMessageX}
        messageY={reportMessageY}
        chatType="matching"
        onClose={() => { setReportSheetVisible(false); setReportMessageId(null); setReportMessageY(null); setReportMessageX(null); }}
      />

      {/* Welcome Guide — single overlay that swaps content between step 3 & 4 */}
      <TutorialOverlay
        visible={showTutorialStep3 || (tutorial.currentStep === 4 && filtersMenuVisible)}
        step={tutorial.currentStep === 4 ? 4 : 3}
        total={4}
        title={tutorial.currentStep === 4 ? 'Filters Review' : "Swelly's Chat"}
        body={
          tutorial.currentStep === 4
            ? 'Review the active filters of your search, and delete the irrelevant ones by Drag-&-Drop'
            : "Talk to Swelly and filter users based on what you're looking for"
        }
        ctaLabel={tutorial.currentStep === 4 ? 'Done' : 'Next'}
        onPressCta={() => {
          if (tutorial.currentStep === 4) {
            tutorial.complete();
          } else {
            setFiltersMenuVisible(true);
            tutorial.advance();
          }
        }}
        anchorRect={tutorial.currentStep === 4 ? filtersChipsRect : filtersButtonRect}
        arrowDirection="up"
        arrowGap={tutorial.currentStep === 4 ? 14 : 6}
        cardGap={tutorial.currentStep === 4 ? 8 : 2}
      />
    </SafeAreaView>
    </>
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
  ellipseBackgroundNative: {
    position: 'absolute',
    width: '105%',
    height: '98%',
    left: '-2.5%',
    zIndex: 0,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: '#B72DF2',
    backgroundColor: '#E0E0E0',
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
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    lineHeight: 24,
    color: '#333333',
    marginBottom: 2,
  },
  profileTagline: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 15,
    color: '#868686',
  },
  editButton: {
    width: 44,
    height: 44,
    borderRadius: 102,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatContainer: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  messageTextContainer: {
    marginBottom: 10,
    gap: 10,
  },
  userMessageText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
  },
  botMessageText: {
    color: '#333333',
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
  },
  timestampContainer: {
    alignItems: 'flex-start',
  },
  timestamp: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
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
    paddingBottom: Platform.OS === 'android' ? 0 : 0,
    paddingTop: 0,
  },
  attachButtonWrapper: {
    paddingBottom: 15,
    marginRight: 8,
    marginTop: 6,
  },
  filtersButtonFloating: {
    position: 'absolute',
    top: 7,
    right: 14,
    zIndex: 10,
  },
  filtersButtonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#e4e4e4',
    borderRadius: 18,
    paddingVertical: 4,
    paddingTop: 6,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  filtersButtonCountWrap: {
    position: 'relative',
    paddingHorizontal: 4,
    paddingVertical: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filtersButtonRedDot: {
    position: 'absolute',
    top: 0,
    left: 13,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#E53935',
  },
  filtersButtonCountText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '400',
    color: '#333',
    lineHeight: 22,
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
  filtersOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    flex: 1,
  },
  filtersOverlayContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  filtersOverlayTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingRight: 8,
  },
  filtersOverlayClose: {
    padding: 8,
    marginLeft: 8,
  },
  filtersOverlaySpacer: {
    flex: 1,
  },
  filtersEmptyCard: {
    width: '100%',
    paddingTop: 6,
    paddingBottom: 4,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  filtersEmptyCardText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 13,
    lineHeight: 18,
    color: '#7B7B7B',
    textAlign: 'left',
  },
  filtersChipsRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
    gap: 6,
  },
  filterChipRemove: {
    padding: 2,
  },
  filterChipLabel: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 14,
    color: '#222B30',
    maxWidth: 200,
  },
  filterChipPrefix: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 14,
    color: '#222B30',
    fontWeight: '400',
  },
  filterChipValue: {
    fontWeight: '700',
  },
  filterChipDragging: {
    opacity: 0,
  },
  filterChipGhost: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  filtersDragZone: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    minHeight: 100,
    marginTop: 8,
  },
  filtersDragZoneText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontSize: 14,
    color: '#7B7B7B',
    marginBottom: 12,
  },
  filtersDragZoneTrash: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: '#333',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  reviewFiltersButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    paddingHorizontal: 21,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: Platform.OS === 'android' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.20)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 3,
    overflow: 'hidden',
  },
  reviewFiltersButtonText: {
    fontSize: 14,
    color: '#333333',
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
  },
  searchNowButtonOuter: {
    flex: 1,
    position: 'relative' as const,
  },
  searchNowButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    paddingHorizontal: 21,
    borderRadius: 32,
    backgroundColor: Platform.OS === 'android' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.20)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 3,
  },
  searchNowButtonText: {
    fontSize: 14,
    color: '#333333',
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
  },
  searchButtonWrapper: {
    marginTop: 12,
    alignItems: 'center',
    width: '100%',
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

  searchButtonText: {
    color: '#222B30',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 0,
    gap: 6,
  },
  actionButtonNew: {
    flex: 1,
    height: 42,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
  },
  actionButtonTextNew: {
    color: '#222B30',
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 0,
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
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
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
  },
  // New Chat Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalContent: {
    backgroundColor: colors.white,
    borderRadius: 24,
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
    width: '100%',
    alignItems: 'center',
  },
  modalTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  modalTrashIcon: {
    width: 48,
    height: 48,
    borderRadius: 28,
    backgroundColor: '#FEE4E2',
    borderWidth: 8,
    borderColor: '#FEF3F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseButton: {
    padding: 10,
    borderRadius: 8,
  },
  modalAvatarBubble: {
    width: 79,
    height: 86,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: '#B72DF2',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(183, 45, 242, 0.24)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 14,
      },
      android: { elevation: 4 },
    }),
  },
  modalAvatarImage: {
    width: 75,
    height: 82,
    borderRadius: 37,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    lineHeight: 32,
    color: '#333',
    marginBottom: 16,
  },
  modalDescription: {
    fontSize: 18,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
    color: '#A0A0A0',
    textAlign: 'center',
    marginBottom: 32,
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 13,
    width: '100%',
  },
  modalKeepButton: {
    flex: 1,
    backgroundColor: '#EEEEEE',
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalKeepButtonText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
    color: '#333',
  },
  modalStartButton: {
    flex: 1,
    backgroundColor: '#00A2B6',
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalStartButtonText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 22,
    color: colors.white,
  },
  hiddenMessage: {
    opacity: 0,
  },
});
