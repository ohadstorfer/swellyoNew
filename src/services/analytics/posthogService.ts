import PostHog from 'posthog-react-native';
import { Platform } from 'react-native';

// PostHog configuration
const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';

let isInitialized = false;

/**
 * Initialize PostHog
 */
export const initializePostHog = async () => {
  if (isInitialized || !POSTHOG_API_KEY) {
    console.log('[PostHog] Already initialized or API key missing');
    return;
  }

  try {
    await PostHog.initAsync(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      enableSessionReplay: true, // Enable session replay for onboarding_abandoned analysis
      captureApplicationLifecycleEvents: false, // We'll track these manually
      captureDeepLinks: false,
      debug: __DEV__, // Enable debug mode in development
    });
    
    isInitialized = true;
    console.log('[PostHog] Initialized successfully');
  } catch (error) {
    console.error('[PostHog] Initialization failed:', error);
  }
};

/**
 * Identify a user
 */
export const identifyUser = (userId: string, properties?: Record<string, any>) => {
  if (!isInitialized) return;
  
  try {
    PostHog.identify(userId, properties);
    console.log('[PostHog] User identified:', userId);
  } catch (error) {
    console.error('[PostHog] Identify failed:', error);
  }
};

/**
 * Track an event
 */
export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  if (!isInitialized) return;
  
  try {
    PostHog.capture(eventName, properties);
    console.log('[PostHog] Event tracked:', eventName, properties);
  } catch (error) {
    console.error('[PostHog] Track failed:', error);
  }
};

/**
 * Reset user (on logout)
 */
export const resetPostHog = () => {
  if (!isInitialized) return;
  
  try {
    PostHog.reset();
    console.log('[PostHog] Reset');
  } catch (error) {
    console.error('[PostHog] Reset failed:', error);
  }
};

// ============================================================================
// ONBOARDING FUNNEL EVENTS
// ============================================================================

/**
 * onboarding_step1_completed
 * User completed the first onboarding step (basic surf + personal info)
 */
export const trackOnboardingStep1Completed = () => {
  trackEvent('onboarding_step1_completed');
};

/**
 * onboarding_step2_completed
 * User finished Swelly intake, profile was created, and home screen is shown
 */
export const trackOnboardingStep2Completed = (durationSeconds: number) => {
  trackEvent('onboarding_step2_completed', {
    duration_seconds: durationSeconds,
  });
};

/**
 * onboarding_abandoned
 * User exited or became inactive during onboarding
 */
export const trackOnboardingAbandoned = (step: number, timeSpentSeconds: number) => {
  trackEvent('onboarding_abandoned', {
    abandoned_at_step: step,
    time_spent_seconds: timeSpentSeconds,
  });
};

// ============================================================================
// SWELLY ENTRY & MATCHING EVENTS
// ============================================================================

/**
 * swelly_chat_entered
 * User opened the Swelly chat interface
 */
export const trackSwellyChatEntered = () => {
  trackEvent('swelly_chat_entered');
};

/**
 * swelly_list_created
 * Swelly returned a list of matched users
 */
export const trackSwellyListCreated = (resultsCount: number, intentType?: string) => {
  trackEvent('swelly_list_created', {
    results_count: resultsCount,
    intent_type: intentType || 'unknown',
  });
};

/**
 * swelly_search_failed
 * Swelly returned zero matches or failed
 */
export const trackSwellySearchFailed = (reason?: string) => {
  trackEvent('swelly_search_failed', {
    reason: reason || 'no_matches',
  });
};

// ============================================================================
// DECISION & INTEREST SIGNALS
// ============================================================================

/**
 * profile_view_clicked
 * User viewed another user's profile from the match list
 */
export const trackProfileViewClicked = (source: 'swelly_list' | 'other') => {
  trackEvent('profile_view_clicked', {
    source,
  });
};

/**
 * connect_clicked
 * User clicked "Connect" or "Message"
 */
export const trackConnectClicked = (timeFromListSeconds: number) => {
  trackEvent('connect_clicked', {
    time_from_list_seconds: timeFromListSeconds,
  });
};

// ============================================================================
// MESSAGING & ACTIVATION EVENTS
// ============================================================================

/**
 * first_message_sent
 * First message sent in a new connection
 */
export const trackFirstMessageSent = (conversationId: string) => {
  trackEvent('first_message_sent', {
    conversation_id: conversationId,
  });
};

/**
 * reply_received
 * First reply received from the connected user
 */
export const trackReplyReceived = (timeToReplyMinutes: number, conversationId: string) => {
  trackEvent('reply_received', {
    time_to_reply_minutes: timeToReplyMinutes,
    conversation_id: conversationId,
  });
};

// ============================================================================
// EARLY RETENTION SIGNAL
// ============================================================================

/**
 * second_swelly_search
 * User entered Swelly again after initial use
 */
export const trackSecondSwellySearch = () => {
  trackEvent('second_swelly_search');
};

