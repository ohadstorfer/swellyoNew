import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { AppState, AppStateStatus } from 'react-native';

/**
 * User Presence Service - Optimized
 * 
 * Simplified design:
 * - Uses Supabase Presence API for real-time status (primary)
 * - Falls back to last_seen_at from database (secondary)
 * - Calculates online status from last_seen_at (within 5 minutes = online)
 * - Minimal database writes (only on app state changes)
 * - Single timer for presence updates
 */

// Configuration
const PRESENCE_UPDATE_INTERVAL = 60000; // 60 seconds - presence heartbeat (increased from 20s)
const ONLINE_THRESHOLD_MINUTES = 5; // Consider user online if active within 5 minutes
const MAX_SUBSCRIPTIONS = 50;
const METRICS_LOG_INTERVAL = 5 * 60 * 1000; // Log metrics every 5 minutes

class UserPresenceService {
  private static instance: UserPresenceService;
  private presenceChannel: any | null = null;
  private userStatusSubscriptions = new Map<string, Set<(isOnline: boolean) => void>>();
  private currentUserId: string | null = null;
  private presenceUpdateInterval: NodeJS.Timeout | null = null;
  private appStateSubscription: any = null;
  private isTrackingCurrentUser: boolean = false;
  private lastDbWrite: number = 0;
  private readonly DB_WRITE_COOLDOWN = 60000; // Only write to DB max once per minute
  private presenceChannelHealthy: boolean = false;
  
  // Metrics tracking
  private metrics = {
    presenceUpdates: 0,
    dbWrites: 0,
    statusQueries: 0,
    lastReset: Date.now(),
  };
  private metricsLogInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): UserPresenceService {
    if (!UserPresenceService.instance) {
      UserPresenceService.instance = new UserPresenceService();
    }
    return UserPresenceService.instance;
  }

  /**
   * Track current user's online status
   */
  async trackCurrentUser(): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.warn('[UserPresenceService] Supabase not configured');
      return;
    }

    if (this.isTrackingCurrentUser) {
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return;
      }

      this.currentUserId = user.id;
      this.isTrackingCurrentUser = true;

      // Initialize presence channel
      await this.ensurePresenceChannel();

      // Initial presence update
      await this.updateCurrentUserPresence();

      // Initial database write
      await this.writeLastSeenToDatabase();

      // Start periodic presence updates
      this.startPresenceUpdateInterval();

      // Listen to app state changes
      this.setupAppStateListener();

      // Start metrics logging
      this.startMetricsLogging();

      console.log('[UserPresenceService] Started tracking presence');
    } catch (error) {
      console.error('[UserPresenceService] Error tracking current user:', error);
    }
  }

  /**
   * Subscribe to a user's online status
   */
  subscribeToUserStatus(
    userId: string,
    callback: (isOnline: boolean) => void
  ): () => void {
    if (!isSupabaseConfigured()) {
      return () => {};
    }

    if (this.userStatusSubscriptions.size >= MAX_SUBSCRIPTIONS) {
      console.warn(`[UserPresenceService] Max subscriptions reached`);
      return () => {};
    }

    // Initialize presence channel if needed
    this.ensurePresenceChannel().catch(error => {
      console.error('[UserPresenceService] Error ensuring presence channel:', error);
    });

    // Add callback
    if (!this.userStatusSubscriptions.has(userId)) {
      this.userStatusSubscriptions.set(userId, new Set());
    }
    this.userStatusSubscriptions.get(userId)!.add(callback);

    // Get initial status
    this.getUserStatus(userId).then(isOnline => {
      callback(isOnline);
    }).catch(() => {
      callback(false);
    });

    // Return unsubscribe function
    return () => {
      this.unsubscribeFromUserStatus(userId, callback);
    };
  }

  /**
   * Unsubscribe from a user's status
   */
  private unsubscribeFromUserStatus(userId: string, callback: (isOnline: boolean) => void): void {
    const callbacks = this.userStatusSubscriptions.get(userId);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.userStatusSubscriptions.delete(userId);
      }
    }
  }

  /**
   * Ensure presence channel is created and subscribed
   */
  private async ensurePresenceChannel(): Promise<void> {
    if (this.presenceChannel) {
      return;
    }

    try {
      this.presenceChannel = supabase.channel('presence:users', {
        config: {
          presence: {
            key: 'user_id',
          },
        },
      });

      // Listen to presence changes
      this.presenceChannel
        .on('presence', { event: 'sync' }, () => {
          this.notifyAllSubscribers();
        })
        .on('presence', { event: 'join' }, ({ key }: any) => {
          console.log('[UserPresenceService] User joined presence:', key);
          this.notifySubscribersForUser(key, true);
        })
        .on('presence', { event: 'leave' }, ({ key }: any) => {
          console.log('[UserPresenceService] User left presence:', key);
          this.notifySubscribersForUser(key, false);
        })
        .subscribe((status: string) => {
          this.presenceChannelHealthy = status === 'SUBSCRIBED';
          if (status === 'SUBSCRIBED') {
            console.log('[UserPresenceService] Presence channel subscribed');
          } else {
            console.warn('[UserPresenceService] Presence channel unhealthy:', status);
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
      this.metrics.presenceUpdates++;
    } catch (error) {
      console.error('[UserPresenceService] Error updating presence:', error);
    }
  }

  /**
   * Get user status - checks presence first, then database fallback
   * Always checks database as fallback if user not found in presence (even if presence is healthy)
   * This handles: initial status checks, users not yet synced to presence, network partitions
   */
  private async getUserStatus(userId: string): Promise<boolean> {
    // Check presence first (if available)
    if (this.presenceChannel && this.presenceChannelHealthy) {
      try {
        const state = this.presenceChannel.presenceState();
        const userPresence = state[userId];
        if (userPresence && userPresence.length > 0) {
          return true; // User is online in presence - trust it
        }
        // User not found in presence - check database as fallback
        // This handles: initial status before presence sync, users not yet in presence state
      } catch (error) {
        // Fall through to database check if presence check fails
      }
    }

    // Fallback: Query database if presence unavailable OR user not found in presence
    // This handles: network partitions, subscription drops, mobile background kills, initial status
    return this.getUserStatusFromDatabase(userId);
  }

  /**
   * Get user status from database (fallback when presence unavailable)
   */
  private async getUserStatusFromDatabase(userId: string): Promise<boolean> {
    this.metrics.statusQueries++;
    
    try {
      const { data: activity, error } = await supabase
        .from('user_activity')
        .select('last_seen_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !activity?.last_seen_at) {
        return false;
      }

      // Calculate if user was active recently
      const lastSeen = new Date(activity.last_seen_at);
      const now = new Date();
      const diffMinutes = (now.getTime() - lastSeen.getTime()) / 60000;
      
      return diffMinutes < ONLINE_THRESHOLD_MINUTES;
    } catch (error) {
      return false;
    }
  }

  /**
   * Batch get status for multiple users (for efficiency)
   * Checks presence first, then database for users not found in presence
   */
  private async getBatchUserStatus(userIds: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    // First check presence for all users (if healthy)
    if (this.presenceChannel && this.presenceChannelHealthy) {
      try {
        const state = this.presenceChannel.presenceState();
        userIds.forEach(userId => {
          const userPresence = state[userId];
          if (userPresence && userPresence.length > 0) {
            results.set(userId, true); // User is online in presence
          }
        });
      } catch (error) {
        // Fall through to database check if presence check fails
      }
    }

    // For users not found in presence, check database as fallback
    const usersToCheck = userIds.filter(userId => !results.has(userId));
    
    if (usersToCheck.length > 0) {
      this.metrics.statusQueries += usersToCheck.length;
      
      try {
        const { data: activities, error } = await supabase
          .from('user_activity')
          .select('user_id, last_seen_at')
          .in('user_id', usersToCheck);

        if (!error && activities) {
          const now = Date.now();
          activities.forEach(activity => {
            if (activity.last_seen_at) {
              const lastSeen = new Date(activity.last_seen_at).getTime();
              const diffMinutes = (now - lastSeen) / 60000;
              results.set(activity.user_id, diffMinutes < ONLINE_THRESHOLD_MINUTES);
            } else {
              results.set(activity.user_id, false);
            }
          });
        }

        // Set false for users not found in database
        usersToCheck.forEach(userId => {
          if (!results.has(userId)) {
            results.set(userId, false);
          }
        });
      } catch (error) {
        // Set all to false on error
        usersToCheck.forEach(userId => {
          results.set(userId, false);
        });
      }
    }

    return results;
  }

  /**
   * Notify all subscribers of current presence state
   * Uses presence when available, but always checks database for users not in presence
   */
  private async notifyAllSubscribers(): Promise<void> {
    if (!this.presenceChannel || this.userStatusSubscriptions.size === 0) {
      return;
    }

    try {
      const userIds = Array.from(this.userStatusSubscriptions.keys());
      
      // Check presence first (if healthy)
      const presenceResults = new Map<string, boolean>();
      if (this.presenceChannelHealthy) {
        try {
          const state = this.presenceChannel.presenceState();
          userIds.forEach(userId => {
            const userPresence = state[userId];
            if (userPresence && userPresence.length > 0) {
              presenceResults.set(userId, true); // User is online in presence
            }
          });
        } catch (error) {
          // Fall through to database check
        }
      }
      
      // For users not found in presence, check database as fallback
      const usersToCheck = userIds.filter(userId => !presenceResults.has(userId));
      if (usersToCheck.length > 0) {
        const dbStatusMap = await this.getBatchUserStatus(usersToCheck);
        dbStatusMap.forEach((isOnline, userId) => {
          presenceResults.set(userId, isOnline);
        });
      }
      
      // Notify all subscribers with combined results
      userIds.forEach(userId => {
        const isOnline = presenceResults.get(userId) ?? false;
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
      console.log(`[UserPresenceService] Notifying ${callbacks.size} subscriber(s) for user ${userId}: ${isOnline ? 'online' : 'offline'}`);
      callbacks.forEach(callback => {
        try {
          callback(isOnline);
        } catch (error) {
          console.error(`[UserPresenceService] Error in callback for ${userId}:`, error);
        }
      });
    } else {
      console.log(`[UserPresenceService] No subscribers for user ${userId}`);
    }
  }

  /**
   * Start periodic presence updates
   * Only updates presence - database writes happen on app state changes
   */
  private startPresenceUpdateInterval(): void {
    if (this.presenceUpdateInterval) {
      return;
    }

    this.presenceUpdateInterval = setInterval(() => {
      if (this.currentUserId && this.isTrackingCurrentUser) {
        // Only update presence (lightweight) - no periodic database writes
        this.updateCurrentUserPresence().catch(() => {});
      }
    }, PRESENCE_UPDATE_INTERVAL);
  }

  /**
   * Write last_seen_at to database (with cooldown to reduce writes)
   * Works with both old schema (with is_online, updated_at) and new schema (simplified)
   */
  private async writeLastSeenToDatabase(): Promise<void> {
    if (!this.currentUserId) {
      return;
    }

    const now = Date.now();
    if (now - this.lastDbWrite < this.DB_WRITE_COOLDOWN) {
      return; // Too soon since last write
    }

    try {
      const timestamp = new Date().toISOString();
      
      // Try to update existing row first
      const { data: existing } = await supabase
        .from('user_activity')
        .select('user_id')
        .eq('user_id', this.currentUserId)
        .maybeSingle();

      if (existing) {
        // Row exists, update it
        // Try simplified schema first (new), fallback to old schema if needed
        const { error: updateError } = await supabase
          .from('user_activity')
          .update({ last_seen_at: timestamp })
          .eq('user_id', this.currentUserId);

        if (updateError) {
          // If update fails, try with old schema fields (for backward compatibility)
          const { error: oldSchemaError } = await supabase
            .from('user_activity')
            .update({ 
              last_seen_at: timestamp,
              is_online: true,
              updated_at: timestamp,
            })
            .eq('user_id', this.currentUserId);

          if (oldSchemaError) {
            console.error('[UserPresenceService] Error updating user_activity:', oldSchemaError);
          }
        }
      } else {
        // Row doesn't exist, insert it
        // Try simplified schema first (new)
        const { error: insertError } = await supabase
          .from('user_activity')
          .insert({ 
            user_id: this.currentUserId,
            last_seen_at: timestamp,
          });

        if (insertError) {
          // If insert fails, try with old schema fields (for backward compatibility)
          const { error: oldSchemaError } = await supabase
            .from('user_activity')
            .insert({ 
              user_id: this.currentUserId,
              last_seen_at: timestamp,
              is_online: true,
              updated_at: timestamp,
            });

          if (oldSchemaError) {
            console.error('[UserPresenceService] Error inserting user_activity:', oldSchemaError);
          }
        }
      }

      this.lastDbWrite = now;
      this.metrics.dbWrites++;
    } catch (error) {
      console.error('[UserPresenceService] Error writing to database:', error);
    }
  }

  /**
   * Start metrics logging
   */
  private startMetricsLogging(): void {
    if (this.metricsLogInterval) {
      return;
    }

    this.metricsLogInterval = setInterval(() => {
      this.logMetrics();
    }, METRICS_LOG_INTERVAL);
  }

  /**
   * Log metrics for monitoring
   */
  private logMetrics(): void {
    const elapsed = (Date.now() - this.metrics.lastReset) / 60000; // minutes
    if (elapsed > 0) {
      console.log('[PresenceMetrics]', {
        presenceUpdatesPerHour: (this.metrics.presenceUpdates / elapsed) * 60,
        dbWritesPerHour: (this.metrics.dbWrites / elapsed) * 60,
        statusQueriesPerHour: (this.metrics.statusQueries / elapsed) * 60,
        presenceChannelHealthy: this.presenceChannelHealthy,
      });
    }
    // Reset
    this.metrics = { presenceUpdates: 0, dbWrites: 0, statusQueries: 0, lastReset: Date.now() };
  }

  /**
   * Setup app state listener
   */
  private setupAppStateListener(): void {
    if (this.appStateSubscription) {
      return;
    }

    this.appStateSubscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (!this.currentUserId) {
        return;
      }

      if (nextAppState === 'active') {
        // App came to foreground - update presence immediately
        await this.updateCurrentUserPresence();
        await this.writeLastSeenToDatabase();
      }
      // Note: We don't mark as offline when going to background
      // The presence API handles this automatically, and last_seen_at will expire naturally
    });
  }

  /**
   * Stop tracking current user
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

      this.isTrackingCurrentUser = false;
      this.currentUserId = null;

      // Clear intervals
      if (this.presenceUpdateInterval) {
        clearInterval(this.presenceUpdateInterval);
        this.presenceUpdateInterval = null;
      }

      if (this.metricsLogInterval) {
        clearInterval(this.metricsLogInterval);
        this.metricsLogInterval = null;
      }

      console.log('[UserPresenceService] Stopped tracking');
    } catch (error) {
      console.error('[UserPresenceService] Error stopping tracking:', error);
    }
  }

  /**
   * Cleanup all subscriptions and channels
   */
  cleanup(): void {
    this.stopTrackingCurrentUser().catch(() => {});

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    if (this.presenceChannel) {
      supabase.removeChannel(this.presenceChannel);
      this.presenceChannel = null;
    }

    this.userStatusSubscriptions.clear();
  }
}

// Export singleton instance
export const userPresenceService = UserPresenceService.getInstance();

