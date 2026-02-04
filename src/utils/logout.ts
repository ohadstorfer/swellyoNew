import { authService } from '../services/auth/authService';
import { analyticsService } from '../services/analytics/analyticsService';
import { supabase } from '../config/supabase';

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
 * 1. Signs out from Supabase/auth service (explicit Supabase signOut)
 * 2. Signs out from auth service wrapper
 * 3. Resets PostHog analytics
 * 4. Resets onboarding state (if provided)
 * 5. Clears user from context (if provided)
 * 6. Navigates to welcome screen (if provided)
 */
export async function performLogout(options: LogoutOptions = {}): Promise<LogoutResult> {
  try {
    console.log('[Logout] Starting logout process...');

    // Step 1: Explicitly sign out from Supabase first
    try {
      const { error: supabaseError } = await supabase.auth.signOut();
      if (supabaseError) {
        console.error('[Logout] Supabase sign out error:', supabaseError);
      } else {
        console.log('[Logout] Supabase sign out successful');
      }
    } catch (supabaseError) {
      console.error('[Logout] Error signing out from Supabase:', supabaseError);
      // Continue with logout even if Supabase sign out fails
    }

    // Step 2: Sign out from auth service wrapper
    try {
      await authService.signOut();
      console.log('[Logout] Auth service sign out successful');
    } catch (authError) {
      console.error('[Logout] Error signing out from auth service:', authError);
      // Continue with logout even if auth sign out fails
    }

    // Step 3: Clear user from context BEFORE other operations
    // This ensures UI updates immediately
    if (options.setUser) {
      try {
        options.setUser(null);
        console.log('[Logout] User cleared from context');
      } catch (userError) {
        console.error('[Logout] Error clearing user from context:', userError);
      }
    }

    // Step 4: Clear demo user flag
    if (options.setIsDemoUser) {
      try {
        options.setIsDemoUser(false);
        console.log('[Logout] Demo user flag cleared');
      } catch (demoError) {
        console.error('[Logout] Error clearing demo user flag:', demoError);
      }
    }

    // Step 5: Reset PostHog analytics
    try {
      analyticsService.reset();
      console.log('[Logout] PostHog analytics reset successful');
    } catch (analyticsError) {
      console.error('[Logout] Error resetting PostHog analytics:', analyticsError);
      // Continue with logout even if analytics reset fails
    }

    // Step 6: Reset onboarding state (if provided)
    if (options.resetOnboarding) {
      try {
        const result = options.resetOnboarding();
        // Handle both sync and async resetOnboarding
        if (result instanceof Promise) {
          await result;
        }
        console.log('[Logout] Onboarding state reset successful');
      } catch (resetError) {
        console.error('[Logout] Error resetting onboarding state:', resetError);
        // Continue with logout even if reset fails
      }
    }

    // Step 7: Navigate to welcome screen (if provided)
    // This must happen last to ensure all state is cleared first
    if (options.setCurrentStep) {
      try {
        options.setCurrentStep(-1); // -1 = WelcomeScreen
        console.log('[Logout] Navigated to WelcomeScreen');
      } catch (navError) {
        console.error('[Logout] Error navigating to welcome screen:', navError);
        // If navigation fails, try again after a short delay
        setTimeout(() => {
          try {
            options.setCurrentStep?.(-1);
          } catch (retryError) {
            console.error('[Logout] Retry navigation also failed:', retryError);
          }
        }, 100);
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

