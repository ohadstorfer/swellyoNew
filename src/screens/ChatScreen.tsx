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
import { colors, spacing, typography, borderRadius } from '../styles/theme';
import { swellyService, SwellyChatResponse } from '../services/swelly/swellyService';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { supabaseDatabaseService } from '../services/database/supabaseDatabaseService';
import { messagingService } from '../services/messaging/messagingService';
import { analyticsService } from '../services/analytics/analyticsService';
import { DestinationCardsCarousel } from '../components/DestinationCardsCarousel';
import { BudgetButtonSelector } from '../components/BudgetButtonSelector';
import { ChatTextInput } from '../components/ChatTextInput';

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
  const scrollViewRef = useRef<ScrollView>(null);
  
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
  
  // State for budget buttons
  const [showBudgetButtons, setShowBudgetButtons] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<'budget' | 'mid' | 'high' | null>(null);
  const [budgetSubmitted, setBudgetSubmitted] = useState(false);
  const [budgetButtonsMessageId, setBudgetButtonsMessageId] = useState<string | null>(null);

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
        
        // Onboarding: Send initial context message using actual onboarding data
        console.log('Initializing onboarding chat with user profile data...');
        console.log('Form data:', formData);
        
        // Use initializeWithProfile to build context from onboarding data
        // This will use the actual data collected during onboarding steps 1-4
        const response = await swellyService.initializeWithProfile({
          nickname: formData.nickname,
          age: formData.age,
          boardType: formData.boardType,
          surfLevel: formData.surfLevel,
          travelExperience: formData.travelExperience,
        });
        
        console.log('Chat initialized with response:', response);
        const newChatId = response.chat_id || null;
        setChatId(newChatId);
        
        // Set the first message from Swelly's response
        const firstMessage: Message = {
          id: '1',
          text: response.return_message,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
          }),
        };
        
        // Handle UI hints from initial response
        if (response.ui_hints) {
          firstMessage.ui_hints = response.ui_hints;
          if (response.ui_hints.show_destination_cards && response.ui_hints.destinations) {
            setShowDestinationCards(true);
            setDestinationList(response.ui_hints.destinations);
            setDestinationCardsMessageId(firstMessage.id);
          }
          if (response.ui_hints.show_budget_buttons) {
            setShowBudgetButtons(true);
            setBudgetButtonsMessageId(firstMessage.id);
          }
        }
        
        setMessages([firstMessage]);
        
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
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
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
        
        // Handle destination cards
        if (response.ui_hints.show_destination_cards && response.ui_hints.destinations) {
          setShowDestinationCards(true);
          setDestinationList(response.ui_hints.destinations);
          setDestinationCardsMessageId(botMessage.id);
        } else {
          setShowDestinationCards(false);
        }
        
        // Handle budget buttons
        if (response.ui_hints.show_budget_buttons) {
          setShowBudgetButtons(true);
          setBudgetButtonsMessageId(botMessage.id);
        } else {
          setShowBudgetButtons(false);
        }
      } else {
        // Reset UI hints if not present
        setShowDestinationCards(false);
        setShowBudgetButtons(false);
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
        
        // Save Swelly conversation results to surfers table
        try {
          console.log('Saving Swelly conversation results to database:', response.data);
          await supabaseDatabaseService.saveSurfer({
            onboardingSummaryText: response.data.onboarding_summary_text,
            destinationsArray: response.data.destinations_array,
            travelType: response.data.travel_type,
            travelBuddies: response.data.travel_buddies,
            lifestyleKeywords: response.data.lifestyle_keywords,
            isDemoUser: isDemoUser, // Pass demo user flag from context
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
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isInitializing, isLoading]);

  // Reset input height when text is cleared
  useEffect(() => {
    if (!inputText.trim()) {
      setInputHeight(25); // Reset to single line height
    }
  }, [inputText]);


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
          if (response.ui_hints.show_budget_buttons) {
            setShowBudgetButtons(true);
            setBudgetButtonsMessageId(botMessage.id);
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
  const handleBudgetSelect = async (budget: 'budget' | 'mid' | 'high') => {
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
        }
        
        setMessages(prev => [...prev, botMessage]);
        
        // Handle completion if finished
        if (response.is_finished && response.data) {
          setIsFinished(true);
          
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
              isDemoUser: isDemoUser,
            });
            console.log('Swelly conversation results saved successfully');
          } catch (error) {
            console.error('Error saving Swelly conversation results:', error);
          }
          
          // Navigate to profile screen after a short delay
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

  const renderMessage = (message: Message) => {
    // Regular message rendering
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
        
        {/* Render destination cards carousel if this is the message that originally requested them */}
        {!message.isUser && 
         message.id === destinationCardsMessageId && 
         destinationList.length > 0 && (
          <View style={styles.uiComponentContainer}>
            <DestinationCardsCarousel
              destinations={destinationsSubmitted ? submittedDestinationData.map(d => d.destination) : destinationList}
              onSubmit={handleDestinationSubmit}
              isReadOnly={destinationsSubmitted}
              initialData={destinationsSubmitted ? submittedDestinationData : undefined}
            />
          </View>
        )}
        
        {/* Render budget buttons if this is the message that originally requested them */}
        {!message.isUser && 
         message.id === budgetButtonsMessageId && (
          <View style={styles.uiComponentContainer}>
            <BudgetButtonSelector 
              onSelect={handleBudgetSelect}
              isReadOnly={budgetSubmitted}
              initialSelection={budgetSubmitted && selectedBudget ? selectedBudget : undefined}
            />
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
                // Go back to onboarding step 4
                setCurrentStep(4);
              }}
            >
              <Ionicons name="chevron-back" size={24} color="#222B30" />
            </TouchableOpacity>
            
            <View style={styles.avatar}>
              {/* Ellipse 11 background with purple ring and gray fill */}
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
    paddingBottom: 12,
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
});

