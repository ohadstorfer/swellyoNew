import { authService } from '../services/auth/authService';
import { analyticsService } from '../services/analytics/analyticsService';

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
 * 1. Signs out from Supabase/auth service
 * 2. Resets PostHog analytics
 * 3. Resets onboarding state (if provided)
 * 4. Clears user from context (if provided)
 * 5. Navigates to welcome screen (if provided)
 */
export async function performLogout(options: LogoutOptions = {}): Promise<LogoutResult> {
  try {
    console.log('[Logout] Starting logout process...');

    // Step 1: Sign out from auth service
    try {
      await authService.signOut();
      console.log('[Logout] Auth service sign out successful');
    } catch (authError) {
      console.error('[Logout] Error signing out from auth service:', authError);
      // Continue with logout even if auth sign out fails
    }

    // Step 2: Reset PostHog analytics
    try {
      analyticsService.reset();
      console.log('[Logout] PostHog analytics reset successful');
    } catch (analyticsError) {
      console.error('[Logout] Error resetting PostHog analytics:', analyticsError);
      // Continue with logout even if analytics reset fails
    }

    // Step 3: Reset onboarding state (if provided)
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

    // Step 4: Clear user from context (if provided)
    if (options.setUser) {
      try {
        options.setUser(null);
        console.log('[Logout] User cleared from context');
      } catch (userError) {
        console.error('[Logout] Error clearing user from context:', userError);
      }
    }

    // Step 5: Clear demo user flag (if provided)
    if (options.setIsDemoUser) {
      try {
        options.setIsDemoUser(false);
        console.log('[Logout] Demo user flag cleared');
      } catch (demoError) {
        console.error('[Logout] Error clearing demo user flag:', demoError);
      }
    }

    // Step 6: Navigate to welcome screen (if provided)
    if (options.setCurrentStep) {
      try {
        options.setCurrentStep(-1); // -1 = WelcomeScreen
        console.log('[Logout] Navigated to WelcomeScreen');
      } catch (navError) {
        console.error('[Logout] Error navigating to welcome screen:', navError);
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

