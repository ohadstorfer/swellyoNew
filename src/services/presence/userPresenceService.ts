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

// Backoff for re-subscribing the presence channel after CHANNEL_ERROR / TIMED_OUT /
// CLOSED. Doubles up to 30s and then caps — these are the only states that leave
// the channel unrecoverable without manual re-subscribe, and on mobile they happen
// often (network changes, background, JWT refresh mid-connect).
const PRESENCE_RECOVERY_BACKOFF_MS = [2000, 5000, 10000, 30000] as const;
// Cap recovery attempts so a persistent WebSocket-level failure (stale JWT,
// network partition, killed realtime socket) doesn't spam hundreds of warnings.
// Reset to 0 on AppState 'active' so foregrounding gives presence a fresh shot.
const MAX_RECOVERY_ATTEMPTS = 10;

class UserPresenceService {
  private static instance: UserPresenceService;
  private presenceChannel: any | null = null;
  private userStatusSubscriptions = new Map<string, Set<(isOnline: boolean) => void>>();
  private lastNotifiedStatus = new Map<string, boolean>();
  private currentUserId: string | null = null;
  private presenceUpdateInterval: NodeJS.Timeout | null = null;
  private appStateSubscription: any = null;
  private isTrackingCurrentUser: boolean = false;
  private lastDbWrite: number = 0;
  private readonly DB_WRITE_COOLDOWN = 60000; // Only write to DB max once per minute
  private presenceChannelHealthy: boolean = false;
  private recoveryAttempts: number = 0;
  private recoveryTimeout: ReturnType<typeof setTimeout> | null = null;

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

    // Get initial status (seed lastNotifiedStatus so dedupe works on next sync)
    this.getUserStatus(userId).then(isOnline => {
      this.lastNotifiedStatus.set(userId, isOnline);
      callback(isOnline);
    }).catch(() => {
      this.lastNotifiedStatus.set(userId, false);
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
        this.lastNotifiedStatus.delete(userId);
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
          this.notifySubscribersForUser(key, true);
        })
        .on('presence', { event: 'leave' }, ({ key }: any) => {
          this.notifySubscribersForUser(key, false);
        })
        .subscribe((status: string) => {
          this.presenceChannelHealthy = status === 'SUBSCRIBED';
          console.log(`[UserPresenceService] Presence channel status: ${status}`);
          if (status === 'SUBSCRIBED') {
            // Healthy again — reset recovery backoff and cancel any pending retry.
            this.recoveryAttempts = 0;
            if (this.recoveryTimeout) {
              clearTimeout(this.recoveryTimeout);
              this.recoveryTimeout = null;
            }
            // Re-track the current user so peers see us online again after a
            // reconnect. track() is a no-op when we haven't called trackCurrentUser
            // yet (currentUserId null) — safe to call unconditionally.
            this.updateCurrentUserPresence().catch(() => {});
            // Resync subscribers with live presence state — initial getUserStatus()
            // ran against DB fallback; this picks up anyone already present in the
            // channel without waiting for the next sync event.
            this.notifyAllSubscribers().catch(() => {});
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            this.scheduleChannelRecovery(status);
          }
        });
    } catch (error) {
      console.error('[UserPresenceService] Error creating presence channel:', error);
    }
  }

  /**
   * Schedule re-creating the presence channel after a non-recoverable status
   * (CHANNEL_ERROR / TIMED_OUT / CLOSED). Without this, a single transient failure
   * — common on mobile across backgrounding, network changes, and JWT refresh —
   * leaves the channel dead forever and the "Available" indicator stuck on the
   * last-known (often stale) state. Backoff grows from 2s up to 30s.
   */
  private scheduleChannelRecovery(reason: string): void {
    if (this.recoveryTimeout) {
      return; // already scheduled
    }

    // Give up after MAX_RECOVERY_ATTEMPTS — at that point it's almost always a
    // WebSocket-level problem (stale JWT, killed socket, network partition),
    // not a channel-level one, and retrying every 30s just spams logs.
    // AppState 'active' will reset the counter and trigger a fresh attempt.
    if (this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      console.error(
        `[UserPresenceService] Presence channel ${reason} — giving up after ${this.recoveryAttempts} attempts. ` +
        `Likely a WebSocket-level issue (stale JWT / network / realtime socket dead). ` +
        `Will retry when app returns to foreground.`
      );
      this.logRealtimeConnectionState();
      this.presenceChannelHealthy = false;
      return;
    }

    // Capture and clear the dead channel reference up front so the scheduled
    // callback can await its teardown before building a new channel on the
    // same topic. Without the await, supabase can briefly hold two channels
    // on 'presence:users' and the new subscribe lands in a racey state.
    const deadChannel = this.presenceChannel;
    this.presenceChannel = null;
    this.presenceChannelHealthy = false;

    const idx = Math.min(
      this.recoveryAttempts,
      PRESENCE_RECOVERY_BACKOFF_MS.length - 1
    );
    const delay = PRESENCE_RECOVERY_BACKOFF_MS[idx];
    this.recoveryAttempts += 1;

    console.warn(
      `[UserPresenceService] Presence channel ${reason}; retry #${this.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS} in ${delay}ms`
    );
    this.logRealtimeConnectionState();

    this.recoveryTimeout = setTimeout(async () => {
      this.recoveryTimeout = null;
      // Skip retry if nobody is using presence anymore (logout between schedule
      // and fire, or all DM screens unmounted before tracking started).
      if (!this.isTrackingCurrentUser && this.userStatusSubscriptions.size === 0) {
        this.recoveryAttempts = 0;
        return;
      }
      if (deadChannel) {
        try {
          await supabase.removeChannel(deadChannel);
        } catch (_) {
          // Ignore — channel may already be torn down server-side.
        }
      }
      try {
        await this.ensurePresenceChannel();
      } catch (err) {
        console.error('[UserPresenceService] Recovery ensurePresenceChannel failed:', err);
        this.scheduleChannelRecovery('retry failed');
      }
    }, delay);
  }

  /**
   * Log the Supabase realtime client's socket-level state. On repeated
   * channel CLOSED events, this tells us whether it's a single-channel issue
   * or the entire WebSocket is down (which is the common mobile failure mode).
   */
  private logRealtimeConnectionState(): void {
    try {
      const rt: any = (supabase as any).realtime;
      if (!rt) return;
      const info: Record<string, unknown> = {};
      if (typeof rt.isConnected === 'function') info.isConnected = rt.isConnected();
      if (typeof rt.connectionState === 'function') info.connectionState = rt.connectionState();
      if (Array.isArray(rt.channels)) info.channelCount = rt.channels.length;
      console.warn('[UserPresenceService] Realtime socket state:', info);
    } catch (_) {
      // ignore — diagnostic only
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
      
      // Notify subscribers only when the status actually changed — avoids flicker
      // caused by presence sync events that re-report the same state.
      userIds.forEach(userId => {
        const isOnline = presenceResults.get(userId) ?? false;
        const prev = this.lastNotifiedStatus.get(userId);
        if (prev === isOnline) return;
        this.lastNotifiedStatus.set(userId, isOnline);
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
    const prev = this.lastNotifiedStatus.get(userId);
    if (prev === isOnline) return;
    this.lastNotifiedStatus.set(userId, isOnline);
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
        // If recovery hit the cap while backgrounded, reset and rebuild.
        // Foregrounding is the natural "try again" signal on mobile — network
        // changes, JWT refresh, and socket resurrection usually resolve here.
        if (!this.presenceChannelHealthy && this.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
          console.log('[UserPresenceService] App active — resetting presence recovery and rebuilding channel');
          this.recoveryAttempts = 0;
          this.ensurePresenceChannel().catch((err) => {
            console.error('[UserPresenceService] App-active rebuild failed:', err);
          });
        }
        // App came to foreground - update presence immediately
        await this.updateCurrentUserPresence();
        await this.writeLastSeenToDatabase();
      }
      // Note: We don't mark as offline when going to background
      // The presence API handles this automatically, and last_seen_at will expire naturally
    });
  }

  /**
   * Stop tracking current user and fully clean up all resources.
   * Removes the presence channel, app state listener, and status subscriptions
   * so no stale state leaks across user sessions.
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

      // Cancel any pending presence-channel recovery so logout doesn't
      // resurrect a dead channel for the signed-out user.
      if (this.recoveryTimeout) {
        clearTimeout(this.recoveryTimeout);
        this.recoveryTimeout = null;
      }
      this.recoveryAttempts = 0;

      // Remove app state listener
      if (this.appStateSubscription) {
        this.appStateSubscription.remove();
        this.appStateSubscription = null;
      }

      // Remove presence channel
      if (this.presenceChannel) {
        supabase.removeChannel(this.presenceChannel);
        this.presenceChannel = null;
        this.presenceChannelHealthy = false;
      }

      // Clear all status subscriptions
      this.userStatusSubscriptions.clear();
      this.lastNotifiedStatus.clear();

      console.log('[UserPresenceService] Stopped tracking and cleaned up');
    } catch (error) {
      console.error('[UserPresenceService] Error stopping tracking:', error);
    }
  }

  /**
   * Cleanup all subscriptions and channels.
   * Delegates to stopTrackingCurrentUser() which now handles full cleanup.
   */
  cleanup(): void {
    this.stopTrackingCurrentUser().catch(() => {});
  }
}

// Export singleton instance
export const userPresenceService = UserPresenceService.getInstance();

