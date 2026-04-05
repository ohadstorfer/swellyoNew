/**
 * Bootstrap: register infrastructure-level logout handlers.
 * Called once at app init. Handlers clear storage and reset upload state on logout.
 * Scope: storage clears, upload reset, in-memory cache clears.
 */

import { Platform } from 'react-native';
import { logoutRegistry } from './logoutRegistry';
import { chatHistoryCache } from '../services/messaging/chatHistoryCache';
import { clearConversationListCache } from '../services/messaging/conversationListCache';
import { resetForLogout as imageUploadResetForLogout } from '../services/messaging/imageUploadService';
import { clearAllMatchedUsers } from './tripPlanningStorage';
import { clearCachedUserProfile } from './userProfileCache';
import { clearPreloadCache } from '../services/media/videoPreloadService';
import { avatarCacheService } from '../services/media/avatarCacheService';
import { clearSwellyShaperChatId } from '../screens/SwellyShaperScreen';
import { swellyShaperService } from '../services/swelly/swellyShaperService';
import { messagingService } from '../services/messaging/messagingService';
import { blockingService } from '../services/blocking/blockingService';
import { pushNotificationService } from '../services/notifications/pushNotificationService';

let registered = false;

/**
 * Register all logout handlers. Idempotent; safe to call multiple times.
 */
export function registerLogoutHandlers(): void {
  if (registered) return;
  registered = true;

  logoutRegistry.register(() => chatHistoryCache.clearAll());
  logoutRegistry.register(() => clearConversationListCache());
  logoutRegistry.register(() => imageUploadResetForLogout());
  logoutRegistry.register(() => clearAllMatchedUsers());
  logoutRegistry.register(async () => {
    try {
      await clearCachedUserProfile();
    } catch (e) {
      console.warn('[Logout] clearCachedUserProfile failed:', e);
    }
  });

  // Video preload cache (in-memory + DOM elements on web)
  logoutRegistry.register(() => clearPreloadCache());

  // Avatar prefetch tracking (in-memory)
  logoutRegistry.register(() => avatarCacheService.clearCache());

  // Swelly Shaper: clear persisted chat ID (AsyncStorage) and in-memory service state
  // So User B never sees or continues User A's Swelly Shaper conversation
  logoutRegistry.register(() => clearSwellyShaperChatId());
  logoutRegistry.register(() => swellyShaperService.resetChat());

  // Messaging in-memory state (channels, typing, subscriptions)
  logoutRegistry.register(() => messagingService.resetAll());

  // Block list cache
  logoutRegistry.register(() => blockingService.clear());

  // Push notification token
  logoutRegistry.register(() => pushNotificationService.clearToken());

  // Web-only: clear localStorage user data
  if (Platform.OS === 'web') {
    logoutRegistry.register(() => {
      try {
        const { webDatabaseService } = require('./webDatabase');
        webDatabaseService.clearAll();
      } catch (e) {
        console.warn('[Logout] webDatabaseService.clearAll failed:', e);
      }
    });
  }
}
