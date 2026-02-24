/**
 * Bootstrap: register infrastructure-level logout handlers.
 * Called once at app init. Handlers clear storage and reset upload state on logout.
 * Scope: storage clears, upload reset. No messaging (single authority: MessagingProvider on user === null).
 */

import { logoutRegistry } from './logoutRegistry';
import { chatHistoryCache } from '../services/messaging/chatHistoryCache';
import { clearConversationListCache } from '../services/messaging/conversationListCache';
import { resetForLogout as imageUploadResetForLogout } from '../services/messaging/imageUploadService';
import { clearAllMatchedUsers } from './tripPlanningStorage';
import { clearCachedUserProfile } from './userProfileCache';

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
}
