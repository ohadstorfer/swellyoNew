import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase, isSupabaseConfigured } from '../../config/supabase';

export interface NotificationTapPayload {
  type?: string;
  conversationId?: string;
  tripId?: string;
  requestId?: string;
  /** trip_reminder stage (week/tomorrow/today/commit/gear) — refines the deep-link. */
  stage?: string;
  /** approved/declined on *_decided types — refines the deep-link. */
  decision?: string;
}

class PushNotificationService {
  private static instance: PushNotificationService;
  private currentToken: string | null = null;
  private isRegistered: boolean = false;
  private tokenSubscription: Notifications.Subscription | null = null;
  private notificationListener: Notifications.Subscription | null = null;
  private responseListener: Notifications.Subscription | null = null;
  private getCurrentConversationId: (() => string | null) | null = null;
  private onNotificationTap: ((payload: NotificationTapPayload) => void) | null = null;

  private constructor() {}

  static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  /**
   * Register for push notifications and save token to Supabase.
   * Safe to call multiple times — no-ops if already registered with same token.
   * Skips entirely on web.
   */
  async registerForPushNotifications(): Promise<string | null> {
    if (Platform.OS === 'web') {
      return null;
    }

    if (!isSupabaseConfigured()) {
      console.warn('[PushNotificationService] Supabase not configured');
      return null;
    }

    try {
      if (!Device.isDevice) {
        console.warn('[PushNotificationService] Not a physical device, skipping');
        return null;
      }

      // Request permission
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('[PushNotificationService] Permission not granted');
        return null;
      }

      // Set up Android notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#05BCD3',
        });
      }

      // Get Expo push token
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenData.data;

      // Save to Supabase if token changed
      if (token && token !== this.currentToken) {
        await this.saveTokenToSupabase(token);
        this.currentToken = token;
      }

      // Listen for token refresh
      if (!this.tokenSubscription) {
        this.tokenSubscription = Notifications.addPushTokenListener(async (newToken) => {
          const newExpoPushToken = newToken.data as string;
          if (newExpoPushToken !== this.currentToken) {
            await this.saveTokenToSupabase(newExpoPushToken);
            this.currentToken = newExpoPushToken;
          }
        });
      }

      this.isRegistered = true;
      console.log('[PushNotificationService] Registered successfully, token:', token);
      return token;
    } catch (error) {
      console.error('[PushNotificationService] Registration failed:', error);
      return null;
    }
  }

  private async saveTokenToSupabase(token: string): Promise<void> {
    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) {
        console.warn('[PushNotificationService] No authenticated user');
        return;
      }

      // A single device token can only legitimately belong to one surfer row at
      // a time. Clear it from any other rows first so onboarding-reminder /
      // blast queries don't accidentally target a stale row attached to this
      // device. Order matters: clear others BEFORE setting ours.
      const { error: clearError } = await supabase
        .from('surfers')
        .update({ expo_push_token: null })
        .eq('expo_push_token', token)
        .neq('user_id', authUser.id);
      if (clearError) {
        console.warn('[PushNotificationService] Error clearing token from other rows:', clearError);
        // Non-fatal — proceed to save our own row anyway.
      }

      const { error } = await supabase
        .from('surfers')
        .update({ expo_push_token: token })
        .eq('user_id', authUser.id);

      if (error) {
        console.error('[PushNotificationService] Error saving token:', error);
      } else {
        console.log('[PushNotificationService] Token saved to Supabase');
      }
    } catch (error) {
      console.error('[PushNotificationService] Error saving token:', error);
    }
  }

  /**
   * Set up foreground notification handling and tap listener.
   * Call once from the main app component after auth.
   */
  setupNotificationHandlers(
    getCurrentConversationId: () => string | null,
    onNotificationTap: (payload: NotificationTapPayload) => void
  ): void {
    if (Platform.OS === 'web') return;

    this.getCurrentConversationId = getCurrentConversationId;
    this.onNotificationTap = onNotificationTap;

    // Foreground: decide whether to show the notification.
    //
    // Rule: if the app is in the foreground (AppState 'active'), NEVER show a
    // heads-up banner / play a sound — the user is already in the app and an
    // in-app indicator (unread badge, conversation list refresh) is enough.
    // We still let the notification be delivered to data listeners so things
    // like unread counts can update.
    //
    // Additionally, if we can read the currently-open conversation and the
    // payload is for that same conversation, suppress regardless of AppState
    // (defensive — should already be covered by the AppState check).
    //
    // Note: expo-notifications SDK 54 deprecated `shouldShowAlert` in favor of
    // `shouldShowBanner` + `shouldShowList`. We set all three for safety so
    // this keeps working across upgrades.
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const conversationId = notification.request.content.data?.conversationId as string | undefined;
        const currentId = this.getCurrentConversationId?.();
        const isForeground = AppState.currentState === 'active';
        const isSameConversation = !!conversationId && conversationId === currentId;
        const shouldShow = !isForeground && !isSameConversation;
        return {
          // Legacy key (pre-SDK 54) — kept for backwards compat
          shouldShowAlert: shouldShow,
          // SDK 54+ replacement keys
          shouldShowBanner: shouldShow,
          shouldShowList: shouldShow,
          shouldPlaySound: shouldShow,
          shouldSetBadge: shouldShow,
        };
      },
    });

    // Tap: user tapped a notification — pass the full data payload so the app can route by type
    if (this.responseListener) {
      this.responseListener.remove();
    }
    this.responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as Record<string, unknown>;
      if (this.onNotificationTap) {
        this.onNotificationTap({
          type: typeof data.type === 'string' ? (data.type as string) : undefined,
          conversationId: typeof data.conversationId === 'string' ? (data.conversationId as string) : undefined,
          tripId: typeof data.tripId === 'string' ? (data.tripId as string) : undefined,
          requestId: typeof data.requestId === 'string' ? (data.requestId as string) : undefined,
          stage: typeof data.stage === 'string' ? (data.stage as string) : undefined,
          decision: typeof data.decision === 'string' ? (data.decision as string) : undefined,
        });
      }
    });
  }

  async clearToken(): Promise<void> {
    try {
      if (this.currentToken) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          await supabase
            .from('surfers')
            .update({ expo_push_token: null })
            .eq('user_id', authUser.id);
        }
      }
    } catch (error) {
      console.warn('[PushNotificationService] Error clearing token:', error);
    }

    this.currentToken = null;
    this.isRegistered = false;
    if (this.tokenSubscription) {
      this.tokenSubscription.remove();
      this.tokenSubscription = null;
    }
    if (this.responseListener) {
      this.responseListener.remove();
      this.responseListener = null;
    }
    this.getCurrentConversationId = null;
    this.onNotificationTap = null;

    console.log('[PushNotificationService] Token cleared');
  }
}

export const pushNotificationService = PushNotificationService.getInstance();
