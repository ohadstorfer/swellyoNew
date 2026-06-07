import { authService } from '../services/auth/authService';
import { analyticsService } from '../services/analytics/analyticsService';
import { userPresenceService } from '../services/presence/userPresenceService';
import { logoutRegistry } from './logoutRegistry';
import { STEP_WELCOME } from '../constants/onboardingSteps';

let logoutInProgress = false;

/**
 * Options passed to performLogout. Callers provide context setters so logout
 * can clear app state and navigate without depending on React directly.
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

const LOGOUT_INFRA_TIMEOUT_MS = 8000;
const LOGOUT_APP_STATE_TIMEOUT_MS = 5000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ]);
}

/**
 * Layer 1 – Infrastructure: pure side effects only.
 * Sign-out is done exclusively via authService.signOut(); it delegates to
 * supabaseAuthService (Supabase) when configured. No direct supabase.auth here.
 * Respects AbortSignal so we can no-op if timeout already fired.
 */
async function destroySession(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try {
    await userPresenceService.stopTrackingCurrentUser();
    console.log('[Logout] Presence tracking stopped');
  } catch (presenceError) {
    console.error('[Logout] Error stopping presence tracking:', presenceError);
  }

  if (signal.aborted) return;
  try {
    await authService.signOut();
    console.log('[Logout] Auth sign out successful');
  } catch (authError) {
    console.error('[Logout] Error signing out:', authError);
  }
}

/**
 * Layer 2 – App state reset: context and persistence.
 * No navigation step value set here (that is Layer 3).
 */
async function resetAppStateAfterLogout(options: LogoutOptions): Promise<void> {
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
}

/**
 * Layer 3 – Navigation: redirect to welcome screen.
 * Uses STEP_WELCOME constant instead of magic number.
 */
function navigateToWelcomeScreen(options: LogoutOptions): void {
  if (options.setCurrentStep) {
    try {
      options.setCurrentStep(STEP_WELCOME);
      console.log('[Logout] Navigated to WelcomeScreen');
    } catch (navError) {
      console.error('[Logout] Error navigating:', navError);
    }
  }
}

/**
 * Performs a full logout by running in order:
 * 1. destroySession (infra: presence + authService.signOut) with timeout and AbortSignal
 * 2. resetAppStateAfterLogout (onboarding/storage + user/demo flags)
 * 3. logoutRegistry.executeAll (cache/storage clears) – before navigation so User B never sees User A's data
 * 4. navigateToWelcomeScreen (setCurrentStep(STEP_WELCOME))
 * 5. analyticsService.reset()
 *
 * logoutInProgress is always reset in finally so a single failure cannot block future logouts.
 */
export async function performLogout(options: LogoutOptions = {}): Promise<LogoutResult> {
  try {
    if (logoutInProgress) {
      console.log('[Logout] Logout already in progress, ignoring');
      return { success: true };
    }
    logoutInProgress = true;
    console.log('[Logout] Starting logout process...');

    const abortController = new AbortController();
    const signal = abortController.signal;

    // Layer 1: Infrastructure (with timeout; on timeout, abort so late steps no-op)
    try {
      await withTimeout(
        destroySession(signal),
        LOGOUT_INFRA_TIMEOUT_MS,
        '[Logout] Layer 1 (destroySession)',
        () => abortController.abort()
      );
    } catch (layer1Error) {
      console.warn('[Logout] Layer 1 finished with error or timeout, proceeding:', layer1Error);
    }

    // Layer 2: App state reset (with timeout so we never block forever)
    try {
      await withTimeout(
        resetAppStateAfterLogout(options),
        LOGOUT_APP_STATE_TIMEOUT_MS,
        '[Logout] Layer 2 (resetAppState)'
      );
    } catch (layer2Error) {
      console.warn('[Logout] Layer 2 finished with error or timeout, proceeding:', layer2Error);
    }

    // Run registry (cache/storage clears) before navigation so User B never sees User A's data.
    try {
      await logoutRegistry.executeAll({ timeoutMs: 8000 });
      console.log('[Logout] Registry handlers completed');
    } catch (registryErr) {
      console.error('[Logout] Registry error:', registryErr);
    }

    // Layer 3: Navigation
    navigateToWelcomeScreen(options);

    // Analytics reset after context/navigation (order: sign out → clear context → reset analytics)
    try {
      analyticsService.reset();
      console.log('[Logout] Analytics reset successful');
    } catch (analyticsError) {
      console.error('[Logout] Error resetting analytics:', analyticsError);
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
  } finally {
    logoutInProgress = false;
  }
}
