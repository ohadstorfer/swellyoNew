import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { AppState, AppStateStatus } from 'react-native';

/**
 * User Presence Service
 * Efficient service to track and subscribe to user online status using Supabase Presence API
 * 
 * Optimizations:
 * - Single global presence channel (not per-user channels)
 * - Debounced database updates (batch writes every 30 seconds)
 * - Subscription deduplication (multiple components can subscribe to same user)
 * - Throttled presence updates (every 20 seconds)
 * - Automatic cleanup when no subscribers remain
 */

class UserPresenceService {
  private static instance: UserPresenceService;
  private presenceChannel: any | null = null; // Single global channel
  private userStatusSubscriptions = new Map<string, Set<(isOnline: boolean) => void>>();
  private currentUserId: string | null = null;
  private presenceUpdateInterval: NodeJS.Timeout | null = null;
  private dbUpdateDebounceTimer: NodeJS.Timeout | null = null;
  private lastDbUpdate: number = 0;
  private appStateSubscription: any = null;
  private isTrackingCurrentUser: boolean = false;
  
  // Configuration constants
  private readonly DB_UPDATE_INTERVAL = 30000; // 30 seconds
  private readonly PRESENCE_UPDATE_INTERVAL = 20000; // 20 seconds
  private readonly MAX_SUBSCRIPTIONS = 50; // Limit concurrent subscriptions

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): UserPresenceService {
    if (!UserPresenceService.instance) {
      UserPresenceService.instance = new UserPresenceService();
    }
    return UserPresenceService.instance;
  }

  /**
   * Track current user's online status
   * Should be called once when user logs in
   */
  async trackCurrentUser(): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.warn('[UserPresenceService] Supabase not configured, presence tracking disabled');
      return;
    }

    if (this.isTrackingCurrentUser) {
      console.log('[UserPresenceService] Already tracking current user');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('[UserPresenceService] No user found, cannot track presence');
        return;
      }

      this.currentUserId = user.id;
      this.isTrackingCurrentUser = true;

      // Initialize presence channel if not already created
      await this.ensurePresenceChannel();

      // Track current user's presence
      await this.updateCurrentUserPresence();

      // Set up periodic presence updates
      this.startPresenceUpdateInterval();

      // Listen to app state changes
      this.setupAppStateListener();

      // Initial database update
      await this.debouncedDbUpdate();

      console.log('[UserPresenceService] Started tracking current user presence');
    } catch (error) {
      console.error('[UserPresenceService] Error tracking current user:', error);
    }
  }

  /**
   * Subscribe to a user's online status
   * Returns unsubscribe function
   */
  subscribeToUserStatus(
    userId: string,
    callback: (isOnline: boolean) => void
  ): () => void {
    if (!isSupabaseConfigured()) {
      console.warn('[UserPresenceService] Supabase not configured, subscription disabled');
      return () => {}; // Return no-op unsubscribe
    }

    // Limit concurrent subscriptions
    if (this.userStatusSubscriptions.size >= this.MAX_SUBSCRIPTIONS) {
      console.warn(`[UserPresenceService] Max subscriptions reached (${this.MAX_SUBSCRIPTIONS}), cannot subscribe to ${userId}`);
      return () => {};
    }

    // Initialize presence channel if needed
    this.ensurePresenceChannel().catch(error => {
      console.error('[UserPresenceService] Error ensuring presence channel:', error);
    });

    // Add callback to subscription set
    if (!this.userStatusSubscriptions.has(userId)) {
      this.userStatusSubscriptions.set(userId, new Set());
    }
    this.userStatusSubscriptions.get(userId)!.add(callback);

    // Get initial status from presence
    this.getUserStatusFromPresence(userId).then(isOnline => {
      callback(isOnline);
    }).catch(error => {
      console.error(`[UserPresenceService] Error getting initial status for ${userId}:`, error);
    });

    console.log(`[UserPresenceService] Subscribed to user ${userId} (total subscriptions: ${this.userStatusSubscriptions.size})`);

    // Return unsubscribe function
    return () => {
      this.unsubscribeFromUserStatus(userId, callback);
    };
  }

  /**
   * Unsubscribe from a user's status
   */
  unsubscribeFromUserStatus(userId: string, callback: (isOnline: boolean) => void): void {
    const callbacks = this.userStatusSubscriptions.get(userId);
    if (callbacks) {
      callbacks.delete(callback);
      
      // If no more callbacks for this user, remove the entry
      if (callbacks.size === 0) {
        this.userStatusSubscriptions.delete(userId);
        console.log(`[UserPresenceService] Unsubscribed from user ${userId} (no more subscribers)`);
      }
    }
  }

  /**
   * Ensure presence channel is created and subscribed
   */
  private async ensurePresenceChannel(): Promise<void> {
    if (this.presenceChannel) {
      return; // Channel already exists
    }

    try {
      this.presenceChannel = supabase.channel('presence:users', {
        config: {
          presence: {
            key: 'user_id', // Use user_id as the presence key
          },
        },
      });

      // Listen to presence changes
      this.presenceChannel
        .on('presence', { event: 'sync' }, () => {
          this.notifyAllSubscribers();
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }: any) => {
          // User came online
          const userId = key;
          this.notifySubscribersForUser(userId, true);
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }: any) => {
          // User went offline
          const userId = key;
          this.notifySubscribersForUser(userId, false);
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            console.log('[UserPresenceService] Presence channel subscribed');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[UserPresenceService] Presence channel error');
          }
        });
    } catch (error) {
      console.error('[UserPresenceService] Error creating presence channel:', error);
    }
  }

  /**
   * Update current user's presence
   */
  private async updateCurrentUserPresence(): Promise<void> {
    if (!this.presenceChannel || !this.currentUserId) {
      return;
    }

    try {
      await this.presenceChannel.track({
        user_id: this.currentUserId,
        online_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[UserPresenceService] Error updating presence:', error);
    }
  }

  /**
   * Get user status from presence
   */
  private async getUserStatusFromPresence(userId: string): Promise<boolean> {
    if (!this.presenceChannel) {
      return false;
    }

    try {
      const state = this.presenceChannel.presenceState();
      const userPresence = state[userId];
      return !!userPresence && userPresence.length > 0;
    } catch (error) {
      console.error(`[UserPresenceService] Error getting presence state for ${userId}:`, error);
      return false;
    }
  }

  /**
   * Notify all subscribers of current presence state
   */
  private notifyAllSubscribers(): void {
    if (!this.presenceChannel) {
      return;
    }

    try {
      const state = this.presenceChannel.presenceState();
      
      this.userStatusSubscriptions.forEach((callbacks, userId) => {
        const userPresence = state[userId];
        const isOnline = !!userPresence && userPresence.length > 0;
        
        callbacks.forEach(callback => {
          try {
            callback(isOnline);
          } catch (error) {
            console.error(`[UserPresenceService] Error in callback for ${userId}:`, error);
          }
        });
      });
    } catch (error) {
      console.error('[UserPresenceService] Error notifying subscribers:', error);
    }
  }

  /**
   * Notify subscribers for a specific user
   */
  private notifySubscribersForUser(userId: string, isOnline: boolean): void {
    const callbacks = this.userStatusSubscriptions.get(userId);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(isOnline);
        } catch (error) {
          console.error(`[UserPresenceService] Error in callback for ${userId}:`, error);
        }
      });
    }
  }

  /**
   * Start periodic presence updates
   */
  private startPresenceUpdateInterval(): void {
    if (this.presenceUpdateInterval) {
      return; // Already started
    }

    this.presenceUpdateInterval = setInterval(() => {
      if (this.currentUserId && this.isTrackingCurrentUser) {
        this.updateCurrentUserPresence().catch(error => {
          console.error('[UserPresenceService] Error in periodic presence update:', error);
        });
      }
    }, this.PRESENCE_UPDATE_INTERVAL);
  }

  /**
   * Debounced database update
   * Batches writes to user_activity table every 30 seconds
   */
  private async debouncedDbUpdate(): Promise<void> {
    if (!this.currentUserId) {
      return;
    }

    // Clear existing timer
    if (this.dbUpdateDebounceTimer) {
      clearTimeout(this.dbUpdateDebounceTimer);
    }

    // Set new timer
    this.dbUpdateDebounceTimer = setTimeout(async () => {
      const now = Date.now();
      
      // Only update if enough time has passed
      if (now - this.lastDbUpdate < this.DB_UPDATE_INTERVAL) {
        return;
      }

      try {
        await supabase
          .from('user_activity')
          .upsert({
            user_id: this.currentUserId,
            last_seen_at: new Date().toISOString(),
            is_online: true,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id',
          });

        this.lastDbUpdate = now;
      } catch (error) {
        console.error('[UserPresenceService] Error updating user_activity:', error);
      }
    }, this.DB_UPDATE_INTERVAL);
  }

  /**
   * Setup app state listener
   */
  private setupAppStateListener(): void {
    if (this.appStateSubscription) {
      return; // Already set up
    }

    this.appStateSubscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (!this.currentUserId) {
        return;
      }

      if (nextAppState === 'active') {
        // App came to foreground - update presence
        await this.updateCurrentUserPresence();
        await this.debouncedDbUpdate();
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App went to background - mark as offline in database (but keep presence for a bit)
        try {
          await supabase
            .from('user_activity')
            .upsert({
              user_id: this.currentUserId,
              last_seen_at: new Date().toISOString(),
              is_online: false,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'user_id',
            });
        } catch (error) {
          console.error('[UserPresenceService] Error updating offline status:', error);
        }
      }
    });
  }

  /**
   * Stop tracking current user (on logout)
   */
  async stopTrackingCurrentUser(): Promise<void> {
    if (!this.isTrackingCurrentUser) {
      return;
    }

    try {
      // Untrack presence
      if (this.presenceChannel && this.currentUserId) {
        await this.presenceChannel.untrack();
      }

      // Update database to offline
      if (this.currentUserId) {
        await supabase
          .from('user_activity')
          .upsert({
            user_id: this.currentUserId,
            last_seen_at: new Date().toISOString(),
            is_online: false,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id',
          });
      }

      this.isTrackingCurrentUser = false;
      this.currentUserId = null;

      // Clear intervals
      if (this.presenceUpdateInterval) {
        clearInterval(this.presenceUpdateInterval);
        this.presenceUpdateInterval = null;
      }

      if (this.dbUpdateDebounceTimer) {
        clearTimeout(this.dbUpdateDebounceTimer);
        this.dbUpdateDebounceTimer = null;
      }

      console.log('[UserPresenceService] Stopped tracking current user');
    } catch (error) {
      console.error('[UserPresenceService] Error stopping tracking:', error);
    }
  }

  /**
   * Cleanup all subscriptions and channels
   */
  cleanup(): void {
    // Stop tracking current user
    this.stopTrackingCurrentUser().catch(error => {
      console.error('[UserPresenceService] Error in cleanup:', error);
    });

    // Remove app state listener
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // Remove presence channel
    if (this.presenceChannel) {
      supabase.removeChannel(this.presenceChannel);
      this.presenceChannel = null;
    }

    // Clear all subscriptions
    this.userStatusSubscriptions.clear();

    console.log('[UserPresenceService] Cleaned up all subscriptions');
  }
}

// Export singleton instance
export const userPresenceService = UserPresenceService.getInstance();

