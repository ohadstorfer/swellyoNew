import { authService } from '../services/auth/authService';
import { analyticsService } from '../services/analytics/analyticsService';
import { supabase } from '../config/supabase';
import { userPresenceService } from '../services/presence/userPresenceService';

/**
 * Centralized logout function that properly clears all user state
 * This ensures consistent logout behavior across the app
 */
export interface LogoutOptions {
  resetOnboarding?: () => void | Promise<void>;
  setUser?: (user: null) => void;
  setCurrentStep?: (step: number) => void;
  setIsDemoUser?: (isDemo: boolean) => void;
}

export interface LogoutResult {
  success: boolean;
  error?: string;
}

/**
 * Performs a complete logout:
 *
 * IMPORTANT: Server/session teardown and storage clear happen FIRST, then UI state.
 * This prevents useAuthGuard (and session restore) from re-populating the user
 * while logout is in progress (session exists + user===null would restore user).
 *
 * Order: 1) Sign out Supabase + auth, 2) Clear persistence (resetOnboarding),
 * 3) Then clear context and navigate so there is no session to restore.
 */
export async function performLogout(options: LogoutOptions = {}): Promise<LogoutResult> {
  try {
    console.log('[Logout] Starting logout process...');

    // --- Phase 1: Tear down session and persistence BEFORE clearing UI state ---
    // So no code path can restore user from an existing session or storage.

    // Step 1: Stop presence tracking
    try {
      await userPresenceService.stopTrackingCurrentUser();
      console.log('[Logout] Presence tracking stopped');
    } catch (presenceError) {
      console.error('[Logout] Error stopping presence tracking:', presenceError);
    }

    // Step 2: Sign out from Supabase (must complete before we clear user from context)
    try {
      const { error: supabaseError } = await supabase.auth.signOut();
      if (supabaseError) {
        console.error('[Logout] Supabase sign out error:', supabaseError);
      } else {
        console.log('[Logout] Supabase sign out successful');
      }
    } catch (supabaseError) {
      console.error('[Logout] Error signing out from Supabase:', supabaseError);
    }

    // Step 3: Sign out from auth service wrapper
    try {
      await authService.signOut();
      console.log('[Logout] Auth service sign out successful');
    } catch (authError) {
      console.error('[Logout] Error signing out from auth service:', authError);
    }

    // Step 4: Reset PostHog analytics
    try {
      analyticsService.reset();
      console.log('[Logout] PostHog analytics reset successful');
    } catch (analyticsError) {
      console.error('[Logout] Error resetting PostHog analytics:', analyticsError);
    }

    // Step 5: Clear persistence and onboarding state (AsyncStorage + context)
    if (options.resetOnboarding) {
      try {
        const result = options.resetOnboarding();
        if (result instanceof Promise) {
          await result;
        }
        console.log('[Logout] Onboarding state and storage cleared');
      } catch (resetError) {
        console.error('[Logout] Error resetting onboarding state:', resetError);
      }
    }

    // --- Phase 2: Update UI state after session and storage are cleared ---
    // This ensures useAuthGuard won't see session + user===null and re-restore user.
    if (options.setCurrentStep) {
      try {
        options.setCurrentStep(-1);
        console.log('[Logout] Navigated to WelcomeScreen');
      } catch (navError) {
        console.error('[Logout] Error navigating:', navError);
      }
    }
    if (options.setUser) {
      try {
        options.setUser(null);
        console.log('[Logout] User cleared from context');
      } catch (userError) {
        console.error('[Logout] Error clearing user from context:', userError);
      }
    }
    if (options.setIsDemoUser) {
      try {
        options.setIsDemoUser(false);
        console.log('[Logout] Demo user flag cleared');
      } catch (demoError) {
        console.error('[Logout] Error clearing demo user flag:', demoError);
      }
    }

    console.log('[Logout] Logout process completed successfully');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Logout] Logout process failed:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

