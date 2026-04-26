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
  Dimensions,
  Pressable,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { isExpoGo } from '../utils/keyboardAvoidingView';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { swellyService, SwellyChatResponse } from '../services/swelly/swellyService';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl, getLifestyleImageBucketUrlForFilename, getLifestyleImageFromPexels } from '../services/media/imageService';
import { Images } from '../assets/images';
import { supabase, isSupabaseConfigured } from '../config/supabase';
import { supabaseDatabaseService } from '../services/database/supabaseDatabaseService';
import { analyticsService } from '../services/analytics/analyticsService';
import { DestinationCardsCarouselCopy } from '../components/DestinationCardsCarouselCopy';
import { BudgetCardsCarousel, type BudgetOption } from '../components/BudgetCardsCarousel';
import { ChatTextInput, ChatTextInputRef } from '../components/ChatTextInput';
import { ReportAISheet } from '../components/ReportAISheet';
import { useChatKeyboardScroll } from '../hooks/useChatKeyboardScroll';
import { useKeyboardVisible, useKeyboardHeight } from '../hooks/useKeyboardVisible';

// Resolve image URLs once at module level to avoid heavy manifest inspection +
// console.log spam on every render (getImageUrl does extensive Constants lookups).
const ELLIPSE_IMAGE_URI = getImageUrl('/Ellipse 11.svg');
const AVATAR_IMAGE_URI = Images.swellyAvatar;
const CHAT_BG_IMAGE_URI = Images.chatBackground;

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  isMatchedUsers?: boolean; // Flag to indicate this message should render matched user cards
  ui_hints?: {
    show_destination_cards?: boolean;
    destinations?: string[];
    show_budget_buttons?: boolean;
  };
}


// TypingIndicator defined outside the main component to prevent Animated value
// leaks from unmount/remount cycles on every parent re-render.
const TypingIndicator = React.memo(() => {
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
  }, [dot1, dot2, dot3]);

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
});

interface OnboardingChatScreenProps {
  onChatComplete?: () => void;
}

export const OnboardingChatScreen: React.FC<OnboardingChatScreenProps> = ({ 
  onChatComplete,
}) => {
  const { setCurrentStep, formData, isDemoUser } = useOnboarding();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const [isFinished, setIsFinished] = useState(false);
  const [onboardingStartTime] = useState<number>(Date.now()); // Track when onboarding chat started
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const androidKeyboardHeight = useKeyboardHeight();
  // Keyboard sync via Reanimated worklets — same pattern as DirectMessageScreen.
  const { height: kbHeight, progress: kbProgress } = useReanimatedKeyboardAnimation();
  const animatedKeyboardPadding = useAnimatedStyle(() => ({
    paddingBottom: -kbHeight.value,
  }));
  const composerRestPadding = Math.max(insets.bottom, 24);
  const animatedComposerPadding = useAnimatedStyle(() => ({
    paddingBottom: composerRestPadding * (1 - kbProgress.value),
  }));
  const flatListRef = useRef<FlatList<Message>>(null);
  const chatInputRef = useRef<ChatTextInputRef>(null);
  const { handleScroll, handleLayout, scrollToBottom: keyboardScrollToBottom } = useChatKeyboardScroll(flatListRef, { inverted: true });

  const chatInitializedRef = useRef(false);
  
  // State for destination cards
  const [showDestinationCards, setShowDestinationCards] = useState(false);
  const [destinationList, setDestinationList] = useState<string[]>([]);
  const [destinationsSubmitted, setDestinationsSubmitted] = useState(false);
  const [submittedDestinationData, setSubmittedDestinationData] = useState<Array<{
    destination: string;
    areas: string[];
    timeInDays: number;
    timeInText: string;
  }>>([]);
  const [destinationCardsMessageId, setDestinationCardsMessageId] = useState<string | null>(null);
  const [pendingDestinationUiHints, setPendingDestinationUiHints] = useState<{
    messageId: string;
    destinations: string[];
  } | null>(null);
  
  // State for budget cards carousel
  const [showBudgetButtons, setShowBudgetButtons] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<BudgetOption | null>(null);
  const [budgetSubmitted, setBudgetSubmitted] = useState(false);
  const [budgetButtonsMessageId, setBudgetButtonsMessageId] = useState<string | null>(null);
  const [pendingBudgetUiHints, setPendingBudgetUiHints] = useState<{
    messageId: string;
  } | null>(null);

  // AI report state
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  const [reportMessageText, setReportMessageText] = useState('');
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const [reportMessageTimestamp, setReportMessageTimestamp] = useState('');
  const [reportMessageX, setReportMessageX] = useState<number | null>(null);
  const [reportMessageY, setReportMessageY] = useState<number | null>(null);
  const messageBubbleRefs = useRef<Record<string, View | null>>({});

  // Initial welcome: show typing bubble after 1s, then second message after 2s more
  const [showInitialTypingBubble, setShowInitialTypingBubble] = useState(false);
  const initialTypingTimeout1Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTypingTimeout2Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isUiDelayLoading, setIsUiDelayLoading] = useState(false);

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

  // Keep a ref to formData so the init effect can read the latest value without
  // re-running every time the context updates formData.
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Test API connection and initialize chat context on component mount (once only)
  useEffect(() => {
    if (chatInitializedRef.current) return;
    chatInitializedRef.current = true;

    let timeout1: ReturnType<typeof setTimeout> | null = null;
    let timeout2: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const initializeChat = async () => {
      try {
        console.log('Testing API connection...');
        const health = await swellyService.healthCheck();
        if (cancelled) return;
        console.log('API health check successful:', health);

        const fd = formDataRef.current;
        console.log('Initializing onboarding chat with user profile data...');
        console.log('Form data:', fd);

        const response = await swellyService.initializeWithProfile({
          nickname: fd.nickname,
          age: fd.age,
          boardType: fd.boardType,
          surfLevel: fd.surfLevel,
          travelExperience: fd.travelExperience,
        });
        if (cancelled) return;

        console.log('Chat initialized with response:', response);
        const newChatId = response.chat_id || null;
        setChatId(newChatId);

        const nickname = fd.nickname || 'Jake';
        const firstMessage: Message = {
          id: '1',
          text: `Yo ${nickname}! Swelly here! Stoked to have you in the community 🌊! Time to get your profile as dialed as your favorite board!`,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
        };
        setMessages([firstMessage]);
        setIsInitializing(false);

        // After 1s show typing bubble; after 3s total hide it and append second message
        timeout1 = setTimeout(() => {
          if (cancelled) return;
          setShowInitialTypingBubble(true);
        }, 1000);
        initialTypingTimeout1Ref.current = timeout1;

        timeout2 = setTimeout(() => {
          if (cancelled) return;
          setShowInitialTypingBubble(false);
          const secondMessage: Message = {
            id: '2',
            text: "Let's start with destinations, what are the TOP 3 you know best? They don't have to be surf trips, just places you've surfed and spent some time at.",
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }),
          };
          setMessages(prev => [...prev, secondMessage]);
        }, 3000);
        initialTypingTimeout2Ref.current = timeout2;
      } catch (error) {
        if (cancelled) return;
        console.error('API health check or chat initialization failed:', error);
        Alert.alert(
          'Connection Error',
          'Cannot connect to the backend server. Please check your internet connection and try again.',
          [{ text: 'OK' }]
        );
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    initializeChat();
    return () => {
      cancelled = true;
      if (timeout1) clearTimeout(timeout1);
      if (timeout2) clearTimeout(timeout2);
    };
  }, []); // Run once on mount

  /**
   * Save onboarding result with server-provided lifestyle image filenames,
   * then enrich any missing keywords via Pexels fallback.
   */
  const saveOnboardingResultAndEnrichImages = async (
    data: NonNullable<SwellyChatResponse['data']>,
    isDemoUser: boolean
  ): Promise<void> => {
    const lifestyle_keywords = data.lifestyle_keywords || [];
    const lifestyle_keyword_images = data.lifestyle_keyword_images || {};

    // Build URLs from server-provided filenames
    const imageUrls: Record<string, string> = {};
    const missingKeywords: string[] = [];

    for (const keyword of lifestyle_keywords) {
      const filename = lifestyle_keyword_images[keyword];
      if (filename && typeof filename === 'string') {
        const url = getLifestyleImageBucketUrlForFilename(filename);
        if (url) {
          imageUrls[keyword] = url;
          continue;
        }
      }
      missingKeywords.push(keyword);
    }

    // Save core data with whatever URLs we have
    await supabaseDatabaseService.saveSurfer({
      onboardingSummaryText: data.onboarding_summary_text,
      destinationsArray: data.destinations_array,
      travelType: data.travel_type,
      travelBuddies: data.travel_buddies,
      lifestyleKeywords: data.lifestyle_keywords,
      lifestyleImageUrls: Object.keys(imageUrls).length ? imageUrls : null,
      finishedOnboarding: true,
      isDemoUser,
    });
    console.log('Swelly conversation results saved successfully');

    // Resolve missing keywords via Pexels (fallback)
    if (missingKeywords.length === 0) return;
    try {
      const results = await Promise.allSettled(
        missingKeywords.map(async (keyword: string) => {
          const url = await getLifestyleImageFromPexels(keyword);
          return { keyword, url };
        })
      );
      const fullMap: Record<string, string> = { ...imageUrls };
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.url) {
          fullMap[result.value.keyword] = result.value.url;
        }
      }
      if (Object.keys(fullMap).length > Object.keys(imageUrls).length) {
        await supabaseDatabaseService.updateSurferLifestyleImageUrls(fullMap);
      }
      console.log('Lifestyle image URLs enriched and saved');
    } catch (err) {
      console.warn('Lifestyle image enrichment failed:', err);
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
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    chatInputRef.current?.focus();
    setIsLoading(true);

    try {
      let response: SwellyChatResponse;
      
      if (chatId) {
        // Continue existing chat
        console.log('Continuing chat with ID:', chatId);
        response = await swellyService.continueConversation(chatId, {
          message: userMessage.text,
        });
      } else {
        // This shouldn't happen since we initialize chat on mount, but fallback just in case
        console.log('Starting new chat (fallback)');
        response = await swellyService.startNewConversation({
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

      // Handle UI hints from response
      if (response.ui_hints) {
        botMessage.ui_hints = response.ui_hints;

        // Queue destination cards to show after a short typing delay
        setPendingDestinationUiHints(null);
        if (response.ui_hints.show_destination_cards && response.ui_hints.destinations?.length) {
          setPendingDestinationUiHints({
            messageId: botMessage.id,
            destinations: response.ui_hints.destinations,
          });
        } else {
          setShowDestinationCards(false);
        }

        // Queue budget buttons to show after a short typing delay
        setPendingBudgetUiHints(null);
        if (response.ui_hints.show_budget_buttons) {
          setPendingBudgetUiHints({
            messageId: botMessage.id,
          });
        } else {
          setShowBudgetButtons(false);
        }
      } else {
        // Reset UI hints if not present
        setShowDestinationCards(false);
        setShowBudgetButtons(false);
        setPendingDestinationUiHints(null);
        setPendingBudgetUiHints(null);
      }

      setMessages(prev => [...prev, botMessage]);

      // If chat is finished, handle completion (onboarding only)
      console.log('Response check:', { 
        is_finished: response.is_finished, 
        has_data: !!response.data,
        data: response.data 
      });
      
      if (response.is_finished && response.data) {
        setIsFinished(true);
        
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
        
        try {
          await saveOnboardingResultAndEnrichImages(response.data, isDemoUser);
          if (isSupabaseConfigured() && response.data.destinations_array?.length) {
            supabase.functions
              .invoke('geocode-user-destinations', {
                body: { destinations_array: response.data.destinations_array },
              })
              .catch((err) => console.warn('Geocode destinations failed:', err));
          }
        } catch (error) {
          console.error('Error saving Swelly conversation results:', error);
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
              summaryText: response.data.surf_trip_plan.summary_text,
            });
            console.log('Surf trip plan saved successfully');
          } catch (error) {
            console.error('Error saving surf trip plan:', error);
            // Don't block the UI if saving fails, but log the error
          }
        }
        
        // Navigate to profile screen after a short delay (onboarding only)
        console.log('[OnboardingChatScreen] Chat finished, preparing to complete onboarding...', {
          onboardingStartTime: new Date(onboardingStartTime).toISOString(),
          currentTime: new Date().toISOString(),
          elapsedSeconds: (Date.now() - onboardingStartTime) / 1000,
        });
        
        setTimeout(() => {
          // Calculate duration and track onboarding_step2_completed
          const durationSeconds = (Date.now() - onboardingStartTime) / 1000;
          console.log('[OnboardingChatScreen] Tracking onboarding_step2_completed...', {
            durationSeconds: Math.round(durationSeconds),
            timestamp: new Date().toISOString(),
          });
          
          analyticsService.trackOnboardingStep2Completed(durationSeconds);
          
          // Mark onboarding as complete and navigate to profile
          console.log('[OnboardingChatScreen] Calling onChatComplete callback...');
          onChatComplete?.();
        }, 1500);
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
      keyboardScrollToBottom();
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isInitializing, isLoading, showInitialTypingBubble]);

  // Delay rendering of destination/budget cards to show typing indicator first
  useEffect(() => {
    if (!pendingDestinationUiHints && !pendingBudgetUiHints) {
      return;
    }

    setIsUiDelayLoading(true);

    const timeoutId = setTimeout(() => {
      if (pendingDestinationUiHints) {
        Keyboard.dismiss();
        setShowDestinationCards(true);
        setDestinationList(pendingDestinationUiHints.destinations);
        setDestinationCardsMessageId(pendingDestinationUiHints.messageId);
        setPendingDestinationUiHints(null);
      }

      if (pendingBudgetUiHints) {
        Keyboard.dismiss();
        setShowBudgetButtons(true);
        setBudgetButtonsMessageId(pendingBudgetUiHints.messageId);
        setPendingBudgetUiHints(null);
      }

      // After cards are rendered, delay scroll so React has time to layout the new content
      setTimeout(() => scrollToBottom(), 300);

      setIsUiDelayLoading(false);
    }, 3000);

    return () => {
      clearTimeout(timeoutId);
      setIsUiDelayLoading(false);
    };
  }, [pendingDestinationUiHints, pendingBudgetUiHints]);

  // Handler for destination card submission
  const handleDestinationSubmit = async (allDestinationsData: Array<{
    destination: string;
    areas: string[];
    timeInDays: number;
    timeInText: string;
  }>) => {
    // Send all destination data to backend
    const destinationsData = allDestinationsData.map(dest => {
      // Parse destination to extract country/state
      // For now, we'll send the destination name and let the backend parse it
      // The backend will need to handle parsing "USA (California)" format
      return {
        destination_name: dest.destination,
        area: dest.areas,
        time_in_days: dest.timeInDays,
        time_in_text: dest.timeInText,
      };
    });
    
    // Send structured data to backend
    const messageToSend = JSON.stringify({
      destinations_data: destinationsData,
    });
    
    // Mark destinations as submitted and store data for read-only display
    setDestinationsSubmitted(true);
    setSubmittedDestinationData(allDestinationsData);
    
    // Send message to backend
    if (chatId) {
      setIsLoading(true);
      try {
        const response = await swellyService.continueConversation(chatId, {
          message: messageToSend,
        });
        
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
        
        if (response.ui_hints) {
          botMessage.ui_hints = response.ui_hints;
          // Queue budget buttons to show after a short typing delay
          setPendingBudgetUiHints(null);
          if (response.ui_hints.show_budget_buttons) {
            setPendingBudgetUiHints({
              messageId: botMessage.id,
            });
          } else {
            setShowBudgetButtons(false);
          }
        }
        
        setMessages(prev => [...prev, botMessage]);
      } catch (error) {
        console.error('Error sending destination data:', error);
        Alert.alert('Error', 'Failed to send destination data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Handler for budget selection
  const handleBudgetSelect = async (budget: BudgetOption) => {
    setSelectedBudget(budget);
    setBudgetSubmitted(true);
    
    // Send budget selection to backend
    const messageToSend = JSON.stringify({
      travel_type: budget,
    });
    
    if (chatId) {
      setIsLoading(true);
      try {
        const response = await swellyService.continueConversation(chatId, {
          message: messageToSend,
        });
        
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
        
        if (response.ui_hints) {
          botMessage.ui_hints = response.ui_hints;
          // Queue destination/budget UI hints to show after a short typing delay
          setPendingDestinationUiHints(null);
          if (response.ui_hints.show_destination_cards && response.ui_hints.destinations?.length) {
            setPendingDestinationUiHints({
              messageId: botMessage.id,
              destinations: response.ui_hints.destinations,
            });
          } else {
            setShowDestinationCards(false);
          }

          setPendingBudgetUiHints(null);
          if (response.ui_hints.show_budget_buttons) {
            setPendingBudgetUiHints({
              messageId: botMessage.id,
            });
          } else {
            setShowBudgetButtons(false);
          }
        }
        
        setMessages(prev => [...prev, botMessage]);
        
        // Handle completion if finished
        if (response.is_finished && response.data) {
          setIsFinished(true);
          
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
          
          try {
            await saveOnboardingResultAndEnrichImages(response.data, isDemoUser);
            if (isSupabaseConfigured() && response.data.destinations_array?.length) {
              supabase.functions
                .invoke('geocode-user-destinations', {
                  body: { destinations_array: response.data.destinations_array },
                })
                .catch((err) => console.warn('Geocode destinations failed:', err));
            }
          } catch (error) {
            console.error('Error saving Swelly conversation results:', error);
          }
          
          setTimeout(() => {
            const durationSeconds = (Date.now() - onboardingStartTime) / 1000;
            analyticsService.trackOnboardingStep2Completed(durationSeconds);
            onChatComplete?.();
          }, 1500);
        }
      } catch (error) {
        console.error('Error sending budget selection:', error);
        Alert.alert('Error', 'Failed to send budget selection. Please try again.');
      } finally {
        setIsLoading(false);
      }
    }
  };

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
    // Regular message rendering
    const isSelected = reportSheetVisible && reportMessageId === message.id;
    const bubbleContent = (
      <View
        ref={(r) => { if (!message.isUser) messageBubbleRefs.current[message.id] = r; }}
        style={[
          styles.messageBubble,
          message.isUser ? styles.userMessageBubble : styles.botMessageBubble,
        ]}
      >
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            justifyContent: message.isUser ? 'flex-end' : 'flex-start',
          }}
        >
          <Text style={message.isUser ? styles.userMessageText : styles.botMessageText}>
            {message.text}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginLeft: 6,
            }}
          >
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
        
        {/* Render destination cards carousel if this is the message that originally requested them */}
        {!message.isUser && 
         message.id === destinationCardsMessageId && 
         destinationList.length > 0 && (
          <View style={styles.uiComponentContainer}>
            <View style={styles.destinationCarouselFullWidth}>
              <DestinationCardsCarouselCopy
                destinations={destinationsSubmitted ? submittedDestinationData.map(d => d.destination) : destinationList}
                onSubmit={handleDestinationSubmit}
                isReadOnly={destinationsSubmitted}
                initialData={destinationsSubmitted ? submittedDestinationData : undefined}
                fullWidth
                onInputFocus={scrollToBottom}
              />
            </View>
        </View>
        )}
        
        {/* Render budget cards carousel if this is the message that originally requested them */}
        {!message.isUser && 
         message.id === budgetButtonsMessageId && (
          <View style={styles.uiComponentContainer}>
            <View style={styles.destinationCarouselFullWidth}>
              <BudgetCardsCarousel
                onSelect={handleBudgetSelect}
                isReadOnly={budgetSubmitted}
                initialSelection={budgetSubmitted && selectedBudget ? selectedBudget : undefined}
              />
            </View>
          </View>
        )}
      </View>
    );
  };

  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const renderItem = useCallback(({ item }: { item: Message }) => {
    return renderMessage(item);
  }, [messages, destinationCardsMessageId, destinationList, destinationsSubmitted, budgetButtonsMessageId, budgetSubmitted, selectedBudget, reportSheetVisible, reportMessageId]);

  const listHeaderComponent = useMemo(() => {
    if (!isLoading && !isInitializing && !showInitialTypingBubble && !isUiDelayLoading) return null;
    return (
      <View style={[styles.messageContainer, styles.botMessageContainer]}>
        <View style={[styles.messageBubble, styles.botMessageBubble]}>
          <View style={styles.messageTextContainer}>
            <TypingIndicator />
          </View>
        </View>
      </View>
    );
  }, [isLoading, isInitializing, showInitialTypingBubble, isUiDelayLoading]);

  return (
    <>
    <SafeAreaView style={[styles.container, { backgroundColor: colors.white }]} edges={['top']}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                // Go back to onboarding step 4
                setCurrentStep(4);
              }}
            >
              <Ionicons name="chevron-back" size={24} color="#222B30" />
            </TouchableOpacity>
            
            <View style={styles.avatar}>
              {/* Ellipse 11 background with purple ring and gray fill */}
              <View style={styles.avatarRing}>
                {Platform.OS === 'web' ? (
                  <Image
                    source={{ uri: ELLIPSE_IMAGE_URI }}
                    style={styles.ellipseBackground}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.ellipseBackgroundNative} />
                )}
                <View style={styles.avatarImageContainer}>
                  <Image
                    source={AVATAR_IMAGE_URI}
                    style={styles.avatarImage}
                    resizeMode="cover"
                  />
                </View>
              </View>
            </View>
          </View>
          
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>Swelly</Text>
            <Text style={styles.profileTagline}>Let’s grow your surf travel community! </Text>
          </View>
          
          {/* <TouchableOpacity style={styles.menuButton}>
            <Ionicons name="ellipsis-vertical" size={24} color="#222B30" />
          </TouchableOpacity> */}
        </View>
        
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPercentage}%` }]} />
        </View>
      </View>

      {/* Chat Messages */}
      <View style={styles.chatContainer}>
        <ImageBackground
          source={CHAT_BG_IMAGE_URI}
          style={[styles.backgroundImage, { pointerEvents: 'none' }]}
          resizeMode="cover"
        />
        <Reanimated.View style={[styles.chatContent, animatedKeyboardPadding]}>
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
            nestedScrollEnabled
            directionalLockEnabled
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onLayout={handleLayout}
            ListHeaderComponent={listHeaderComponent}
            initialNumToRender={50}
            maxToRenderPerBatch={50}
            windowSize={21}
          />

          {/* Input Area */}
          <Reanimated.View style={[styles.inputWrapper, animatedComposerPadding]}>
            <ChatTextInput
              ref={chatInputRef}
              value={inputText}
              onChangeText={setInputText}
              onSend={sendMessage}
              disabled={isLoading || isInitializing || (showDestinationCards && !destinationsSubmitted) || (showBudgetButtons && !budgetSubmitted)}
              placeholder="Type your message.."
              maxLength={500}
              primaryColor="#B72DF2"
              leftAccessory={
                <TouchableOpacity style={styles.attachButton}>
                  <Ionicons name="add" size={28} color="#222B30" />
                </TouchableOpacity>
              }
            />
          </Reanimated.View>
        </Reanimated.View>
      </View>
      <ReportAISheet
        visible={reportSheetVisible}
        messageText={reportMessageText}
        messageTimestamp={reportMessageTimestamp}
        messageX={reportMessageX}
        messageY={reportMessageY}
        chatType="onboarding"
        onClose={() => { setReportSheetVisible(false); setReportMessageId(null); setReportMessageX(null); setReportMessageY(null); }}
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
    paddingTop: Platform.OS === 'web' ? 40 : 0,
    paddingBottom: 8,
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
    // Ensure proper spacing and prevent overlap
    minWidth: 24 + 8 + 62, // backButton width + margin + avatar width
  },
  backButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8, // Increased margin to ensure clear separation
    zIndex: 0, // Lower z-index than avatar to prevent overlap
  },
  avatar: {
    width: 62,
    height: 68,
    aspectRatio: 62 / 68,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1, // Higher z-index to ensure avatar is above back button
  },
  avatarRing: {
    width: '100%',
    height: '100%',
    borderRadius: 31,
    overflow: 'visible', // Changed to 'visible' to show full ellipse border
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1, // Ensure ring is above back button
  },
  ellipseBackground: {
    position: 'absolute',
    // Make it slightly larger to ensure border is fully visible
    width: '105%', // Slightly larger to show full border
    height: '105%', // Slightly larger to show full border
    top: '-2.5%', // Offset to center the larger size
    left: '-2.5%', // Offset to center the larger size
    zIndex: 0, // Behind the avatar image
    // resizeMode="contain" maintains the original aspect ratio
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any, // Maintain original aspect ratio
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
    // Container for the avatar image, centered horizontally
    // Making it bigger: 75px width and height
    // Ellipse is 62px wide, so center 75px: (62 - 75) / 2 = -6.5px
    width: 75,
    height: 75,
    left: -6.1, 
    top: -5.1, 
    overflow: 'hidden',
    zIndex: 1, 
  },
  avatarImage: {
    // Image dimensions: 64px width, 69.33px height, aspect-ratio 12/13
    width: 75,
    height: 75 , // 69.33px
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
      // aspectRatio: '12/13' as any,
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
  chatContent: {
    flex: 1,
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
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
  messageContainer: {
    marginBottom: 0,
  },
  userMessageContainer: {
    alignItems: 'flex-end',
    paddingLeft: 48,
    paddingRight: 0,
  },
  botMessageContainer: {
    alignItems: 'flex-start',
    paddingLeft: 0,
    paddingRight: 16,
  },
  messageBubble: {
    maxWidth: '85%',
    paddingTop: 8,
    paddingBottom: 6,
    paddingHorizontal: 10,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
    ...(Platform.OS === 'web' && {
      boxShadow: '0px 0px 20px rgba(0, 0, 0, 0.08)',
    }),
  },
  messageTextContainer: {
    marginBottom: 0,
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
    paddingBottom: Platform.OS === 'android' ? 50 : 35, 
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
  uiComponentContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: 0,
    paddingBottom: spacing.xs,
  },
  destinationCarouselFullWidth: {
    marginHorizontal: -(spacing.md * 2),
    width: Dimensions.get('window').width,
    paddingHorizontal: 0,
  },
  hiddenMessage: {
    opacity: 0,
  },
});

