import PostHog from 'posthog-react-native';
import { Platform } from 'react-native';

// PostHog configuration
const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';

interface QueuedEvent {
  eventName: string;
  properties?: Record<string, any>;
}

class AnalyticsService {
  private posthogInstance: PostHog | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private eventQueue: QueuedEvent[] = [];
  private hasCompletedOnboarding = false;
  private hasEnteredSwellyChat = false;
  private onboardingStartTime: number | null = null;
  private onboardingAbandonTimer: NodeJS.Timeout | null = null;
  private swellyListCreatedTime: number | null = null;

  /**
   * Initialize PostHog
   */
  async initialize(userId?: string) {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    if (!POSTHOG_API_KEY) {
      console.warn('[Analytics] PostHog API key not configured');
      return;
    }

    this.isInitializing = true;

    try {
      console.log('[Analytics] 🚀 Starting PostHog initialization...', {
        hasApiKey: !!POSTHOG_API_KEY,
        host: POSTHOG_HOST,
        timestamp: new Date().toISOString(),
      });
      
      // Create PostHog instance using constructor (v4.19.0 API)
      this.posthogInstance = new PostHog(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        enableSessionReplay: true,
        captureApplicationLifecycleEvents: true,
        captureDeepLinks: true,
        flushAt: 20, // Flush after 20 events
        flushInterval: 30000, // Or flush every 30 seconds
      });

      if (userId) {
        this.posthogInstance.identify(userId);
        console.log('[Analytics] 👤 User identified:', userId);
      }

      this.isInitialized = true;
      this.isInitializing = false;
      console.log('[Analytics] ✅ PostHog initialized successfully', {
        queuedEvents: this.eventQueue.length,
        timestamp: new Date().toISOString(),
      });
      
      // Flush queued events
      this.flushEventQueue();
    } catch (error) {
      this.isInitializing = false;
      console.error('[Analytics] ❌ Failed to initialize PostHog:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Flush queued events after initialization
   */
  private flushEventQueue() {
    if (this.eventQueue.length > 0 && this.posthogInstance) {
      const queueSize = this.eventQueue.length;
      console.log(`[Analytics] 🔄 FLUSHING ${queueSize} queued event(s)`, {
        timestamp: new Date().toISOString(),
      });
      
      let successCount = 0;
      let failureCount = 0;
      
      this.eventQueue.forEach(({ eventName, properties }) => {
        try {
          this.posthogInstance!.capture(eventName, properties);
          successCount++;
          console.log(`[Analytics] ${eventName} ✅ SENT from queue`, {
            properties: properties || {},
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          failureCount++;
          console.error(`[Analytics] ${eventName} ❌ FAILED to send from queue:`, {
            error: error instanceof Error ? error.message : String(error),
            properties: properties || {},
            timestamp: new Date().toISOString(),
          });
        }
      });
      
      console.log(`[Analytics] 📊 Queue flush complete: ${successCount} sent, ${failureCount} failed`, {
        totalQueued: queueSize,
        timestamp: new Date().toISOString(),
      });
      
      this.eventQueue = [];
    }
  }

  /**
   * Identify a user
   */
  identify(userId: string, properties?: Record<string, any>) {
    if (!this.isInitialized || !this.posthogInstance) {
      console.warn('[Analytics] ⚠️ Cannot identify user - PostHog not initialized', {
        userId,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    try {
      this.posthogInstance.identify(userId, properties);
      console.log('[Analytics] 👤 User identified:', {
        userId,
        properties: properties || {},
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Analytics] ❌ Failed to identify user:', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Track an event
   */
  track(eventName: string, properties?: Record<string, any>) {
    const logPrefix = `[Analytics] ${eventName}`;
    
    if (this.isInitialized && this.posthogInstance) {
      // PostHog is ready, track immediately
      try {
        this.posthogInstance.capture(eventName, properties);
        console.log(`${logPrefix} ✅ SENT successfully`, {
          properties: properties || {},
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`${logPrefix} ❌ FAILED to send:`, {
          error: error instanceof Error ? error.message : String(error),
          properties: properties || {},
          timestamp: new Date().toISOString(),
        });
      }
    } else if (this.isInitializing) {
      // PostHog is initializing, queue the event
      this.eventQueue.push({ eventName, properties });
      console.log(`${logPrefix} ⏳ QUEUED (PostHog initializing)`, {
        queueSize: this.eventQueue.length,
        properties: properties || {},
        timestamp: new Date().toISOString(),
      });
    } else {
      // PostHog not started yet, queue the event
      this.eventQueue.push({ eventName, properties });
      console.log(`${logPrefix} ⏳ QUEUED (PostHog not initialized)`, {
        queueSize: this.eventQueue.length,
        properties: properties || {},
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Set user properties
   */
  setUserProperties(properties: Record<string, any>) {
    if (!this.isInitialized || !this.posthogInstance) return;
    this.posthogInstance.setPersonProperties(properties);
  }

  /**
   * Reset (for logout)
   */
  reset() {
    if (!this.isInitialized || !this.posthogInstance) return;
    this.posthogInstance.reset();
    this.hasCompletedOnboarding = false;
    this.hasEnteredSwellyChat = false;
    this.onboardingStartTime = null;
    this.swellyListCreatedTime = null;
    this.clearOnboardingAbandonTimer();
  }

  // ==================== ONBOARDING EVENTS ====================

  /**
   * Track onboarding step 1 completion
   */
  trackOnboardingStep1Completed() {
    console.log('[Analytics] 📍 Tracking: onboarding_step1_completed');
    this.track('onboarding_step1_completed');
  }

  /**
   * Track onboarding step 2 completion (profile created)
   */
  trackOnboardingStep2Completed(durationSeconds?: number) {
    // Calculate duration from start time if not provided
    const calculatedDuration = durationSeconds !== undefined 
      ? durationSeconds 
      : (this.onboardingStartTime ? (Date.now() - this.onboardingStartTime) / 1000 : undefined);
    
    const properties: Record<string, any> = {};
    if (calculatedDuration !== undefined) {
      properties.duration_seconds = Math.round(calculatedDuration);
    }
    
    console.log('[Analytics] 📍 Tracking: onboarding_step2_completed', {
      duration_seconds: properties.duration_seconds,
      timestamp: new Date().toISOString(),
    });
    
    this.track('onboarding_step2_completed', properties);
    this.hasCompletedOnboarding = true;
    this.clearOnboardingAbandonTimer();
  }

  /**
   * Start tracking onboarding abandonment
   * Emits event if user becomes inactive for 12 minutes before completing step 2
   * Should be called when step 2 (Swelly chat) starts
   */
  startOnboardingAbandonTracking(step: number = 2) {
    this.clearOnboardingAbandonTimer();
    if (!this.onboardingStartTime) {
      this.onboardingStartTime = Date.now();
    }

    console.log('[Analytics] ⏱️ Started onboarding abandon tracking', {
      step,
      startTime: new Date(this.onboardingStartTime).toISOString(),
      timeoutMinutes: 12,
      timestamp: new Date().toISOString(),
    });

    // Set timer for 12 minutes (720000 ms)
    this.onboardingAbandonTimer = setTimeout(() => {
      if (!this.hasCompletedOnboarding) {
        const timeSpentSeconds = this.onboardingStartTime 
          ? (Date.now() - this.onboardingStartTime) / 1000 
          : 0;
        
        console.log('[Analytics] 📍 Tracking: onboarding_abandoned', {
          abandoned_at_step: step,
          time_spent_seconds: Math.round(timeSpentSeconds),
          timestamp: new Date().toISOString(),
        });
        
        this.track('onboarding_abandoned', {
          abandoned_at_step: step,
          time_spent_seconds: Math.round(timeSpentSeconds),
        });
      } else {
        console.log('[Analytics] ✅ Onboarding completed - abandon tracking cancelled');
      }
    }, 12 * 60 * 1000);
  }

  /**
   * Clear onboarding abandon timer
   */
  private clearOnboardingAbandonTimer() {
    if (this.onboardingAbandonTimer) {
      clearTimeout(this.onboardingAbandonTimer);
      this.onboardingAbandonTimer = null;
    }
  }

  // ==================== SWELLY CHAT EVENTS ====================

  /**
   * Track when user enters Swelly chat
   */
  trackSwellyChatEntered() {
    const isSecondSearch = this.hasEnteredSwellyChat;
    this.hasEnteredSwellyChat = true;

    console.log('[Analytics] 📍 Tracking: swelly_chat_entered', {
      isSecondSearch,
      timestamp: new Date().toISOString(),
    });
    
    this.track('swelly_chat_entered');

    // If this is the second time entering, track retention event
    if (isSecondSearch) {
      console.log('[Analytics] 📍 Tracking: second_swelly_search', {
        timestamp: new Date().toISOString(),
      });
      this.track('second_swelly_search');
    }
  }

  /**
   * Track when Swelly returns a list of matched users
   */
  trackSwellyListCreated(resultsCount: number, intentType?: string) {
    const properties: Record<string, any> = {
      results_count: resultsCount,
    };

    if (intentType) {
      properties.intent_type = intentType;
    } else {
      properties.intent_type = 'unknown';
    }

    console.log('[Analytics] 📍 Tracking: swelly_list_created', {
      results_count: resultsCount,
      intent_type: properties.intent_type,
      timestamp: new Date().toISOString(),
    });

    this.track('swelly_list_created', properties);
    this.swellyListCreatedTime = Date.now();
  }

  /**
   * Track when Swelly search fails or returns zero results
   */
  trackSwellySearchFailed(reason?: string) {
    const failureReason = reason || 'no_matches';
    console.log('[Analytics] 📍 Tracking: swelly_search_failed', {
      reason: failureReason,
      timestamp: new Date().toISOString(),
    });
    
    this.track('swelly_search_failed', {
      reason: failureReason,
    });
  }

  // ==================== PROFILE & CONNECTION EVENTS ====================

  /**
   * Track when user views another user's profile from match list
   */
  trackProfileViewClicked(source: 'swelly_list' | 'other' = 'other') {
    console.log('[Analytics] 📍 Tracking: profile_view_clicked', {
      source,
      timestamp: new Date().toISOString(),
    });
    
    this.track('profile_view_clicked', {
      source,
    });
  }

  /**
   * Track when user clicks Connect or Message button
   */
  trackConnectClicked(timeFromListSeconds?: number) {
    const properties: Record<string, any> = {};

    // Use provided time or calculate from list creation if available
    if (timeFromListSeconds !== undefined) {
      properties.time_from_list_seconds = timeFromListSeconds;
    } else if (this.swellyListCreatedTime) {
      const timeFromList = (Date.now() - this.swellyListCreatedTime) / 1000; // in seconds
      properties.time_from_list_seconds = Math.round(timeFromList);
    }

    console.log('[Analytics] 📍 Tracking: connect_clicked', {
      time_from_list_seconds: properties.time_from_list_seconds,
      timestamp: new Date().toISOString(),
    });

    this.track('connect_clicked', properties);
  }

  // ==================== MESSAGING EVENTS ====================

  /**
   * Track when first message is sent in a new connection
   */
  trackFirstMessageSent(conversationId?: string) {
    const properties: Record<string, any> = {};
    if (conversationId) {
      properties.conversation_id = conversationId;
    }
    
    console.log('[Analytics] 📍 Tracking: first_message_sent', {
      conversation_id: conversationId,
      timestamp: new Date().toISOString(),
    });
    
    this.track('first_message_sent', properties);
  }

  /**
   * Track when first reply is received
   */
  trackReplyReceived(timeToReplyMinutes?: number, conversationId?: string) {
    const properties: Record<string, any> = {};
    if (timeToReplyMinutes !== undefined) {
      properties.time_to_reply_minutes = timeToReplyMinutes;
    }
    if (conversationId) {
      properties.conversation_id = conversationId;
    }
    
    console.log('[Analytics] 📍 Tracking: reply_received', {
      time_to_reply_minutes: timeToReplyMinutes,
      conversation_id: conversationId,
      timestamp: new Date().toISOString(),
    });
    
    this.track('reply_received', properties);
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();

