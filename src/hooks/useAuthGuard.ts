import { useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../config/supabase';
import { useOnboarding } from '../context/OnboardingContext';
import { performLogout } from '../utils/logout';
import { STEP_WELCOME } from '../constants/onboardingSteps';

/**
 * Centralized authentication guard hook
 * 
 * Monitors authentication state and automatically redirects unauthenticated users
 * to the WelcomeScreen. Handles all edge cases including session expiration,
 * token refresh failures, and OAuth callback flows.
 */
export function useAuthGuard() {
  const { user, setUser, setCurrentStep, resetOnboarding, setIsDemoUser, isDemoUser, isRestoringSession, currentStep } = useOnboarding();
  const isProcessingLogoutRef = useRef(false);
  const lastAuthCheckRef = useRef<number>(0);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Check if we're in an OAuth callback flow.
   * Detects OAuth return by checking URL parameters only (no storage flags needed
   * since we no longer do pre-login signOut).
   */
  const isOAuthCallback = useCallback((): boolean => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return false;
    }

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const code = urlParams.get('code');
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const errorParam = hashParams.get('error') || urlParams.get('error');
      const type = hashParams.get('type') || urlParams.get('type');

      return !!(code || accessToken || refreshToken || (errorParam && type === 'recovery'));
    } catch (error) {
      console.warn('[useAuthGuard] Error checking OAuth callback:', error);
      return false;
    }
  }, []);

  /**
   * Perform logout and redirect to WelcomeScreen
   * Debounced to prevent multiple rapid calls
   */
  const handleUnauthenticated = useCallback(async () => {
    // Prevent multiple simultaneous logout calls
    if (isProcessingLogoutRef.current) {
      console.log('[useAuthGuard] Logout already in progress, skipping');
      return;
    }

    // Debounce rapid auth state changes (e.g., during OAuth flow)
    const now = Date.now();
    if (now - lastAuthCheckRef.current < 500) {
      console.log('[useAuthGuard] Debouncing auth check');
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(() => {
        handleUnauthenticated();
      }, 500);
      return;
    }
    lastAuthCheckRef.current = now;

    // Don't redirect during OAuth callback
    if (isOAuthCallback()) {
      console.log('[useAuthGuard] OAuth callback detected, skipping redirect');
      return;
    }

    isProcessingLogoutRef.current = true;
    console.log('[useAuthGuard] User is unauthenticated, performing logout and redirect');

    try {
      const result = await performLogout({
        resetOnboarding,
        setUser,
        setCurrentStep,
        setIsDemoUser,
      });

      if (result.success) {
        console.log('[useAuthGuard] Logout successful, redirected to WelcomeScreen');
      } else {
        console.error('[useAuthGuard] Logout failed:', result.error);
        // Force redirect even if logout fails
        setUser(null);
        setIsDemoUser(false);
        setCurrentStep(STEP_WELCOME);
      }
    } catch (error) {
      console.error('[useAuthGuard] Error during logout:', error);
      // Force redirect even if logout fails
      setUser(null);
      setIsDemoUser(false);
      setCurrentStep(STEP_WELCOME);
    } finally {
      // Reset flag after a delay to allow state updates to propagate
      setTimeout(() => {
        isProcessingLogoutRef.current = false;
      }, 1000);
    }
  }, [resetOnboarding, setUser, setCurrentStep, setIsDemoUser, isOAuthCallback]);

  /**
   * Check authentication state
   */
  const checkAuthState = useCallback(async () => {
    // Wait for session restoration to complete
    if (isRestoringSession) {
      console.log('[useAuthGuard] Waiting for session restoration...');
      return;
    }
    
    // Skip auth check if we're in an OAuth callback (URL has code/token params)
    if (isOAuthCallback()) {
      console.log('[useAuthGuard] OAuth callback detected (URL params), skipping auth check');
      return;
    }

    // Demo users are considered authenticated
    if (isDemoUser) {
      return;
    }

    try {
      // Check session validity
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        console.log('[useAuthGuard] No valid session found:', sessionError?.message || 'No session');
        
        // If user exists in context but no session, they're unauthenticated
        if (user !== null) {
          console.log('[useAuthGuard] User in context but no session - redirecting');
          await handleUnauthenticated();
        } else {
          // User is null and no session - ensure we're on WelcomeScreen
          if (currentStep !== STEP_WELCOME) {
            console.log('[useAuthGuard] User is null and no session - ensuring WelcomeScreen');
            setCurrentStep(STEP_WELCOME);
          }
        }
        return;
      }

      // Session exists - check if user needs to be restored to context
      if (user === null) {
        console.log('[useAuthGuard] Session exists but user not in context - restoring user');
        
        // Get user from session and restore to context
        const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
        
        if (userError || !authUser) {
          console.log('[useAuthGuard] Failed to get user from session:', userError?.message || 'No user');
          // Session exists but can't get user - something is wrong, redirect
          await handleUnauthenticated();
          return;
        }
        
        // Convert and set user in context
        const { convertSupabaseUserToAppUser } = await import('../utils/userConversion');
        const appUser = convertSupabaseUserToAppUser(authUser);
        console.log('[useAuthGuard] Restoring user to context:', appUser.id);
        setUser(appUser);
        
        // Preload profile video in background (non-blocking) - use auth UUID for surfers table lookup
        if (authUser?.id) {
          const { preloadProfileVideo } = await import('../services/media/videoPreloadService');
          preloadProfileVideo(authUser.id, 'high')
            .then(result => {
              if (__DEV__) {
                console.log(`[useAuthGuard] Profile video preload completed: ready=${result?.ready}`);
              }
            })
            .catch(err => {
              console.warn('[useAuthGuard] Profile video preload failed (non-blocking):', err);
            });
        }
        
        return; // Don't redirect - user is now restored
      }

      // User exists and session is valid - verify user can still be fetched
      const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !authUser) {
        console.log('[useAuthGuard] Failed to verify user:', userError?.message || 'No user');
        
        // If user exists in context but can't be verified, they're unauthenticated
        if (user !== null) {
          console.log('[useAuthGuard] User in context but cannot be verified - redirecting');
          await handleUnauthenticated();
        }
        return;
      }

      // User is authenticated
      console.log('[useAuthGuard] User is authenticated:', authUser.id);
    } catch (error) {
      console.error('[useAuthGuard] Error checking auth state:', error);
      // On error, if user exists in context, redirect to be safe
      if (user !== null) {
        console.log('[useAuthGuard] Error during auth check, redirecting to be safe');
        await handleUnauthenticated();
      }
    }
  }, [user, isDemoUser, isRestoringSession, isOAuthCallback, handleUnauthenticated, setUser, currentStep, setCurrentStep]);

  /**
   * Listen to auth state changes from Supabase
   */
  useEffect(() => {
    console.log('[useAuthGuard] Setting up auth state listener');

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[useAuthGuard] Auth state changed:', event, session ? 'session exists' : 'no session');

      // Don't process during OAuth callback or redirect (use improved detection)
      if (isOAuthCallback()) {
        console.log('[useAuthGuard] OAuth callback/redirect in progress, skipping auth state change');
        return;
      }

      // Handle sign out events
      if (event === 'SIGNED_OUT') {
        console.log('[useAuthGuard] SIGNED_OUT event detected');
        await handleUnauthenticated();
        return;
      }

      // Handle token refresh failures with retry logic
      if (event === 'TOKEN_REFRESHED' && !session) {
        console.log('[useAuthGuard] Token refresh failed - no session, attempting retry...');
        
        // Retry logic for transient failures
        let retryCount = 0;
        const maxRetries = 3;
        const retryDelay = 1000; // Start with 1 second
        
        while (retryCount < maxRetries) {
          try {
            // Wait before retry with exponential backoff
            if (retryCount > 0) {
              const delay = retryDelay * Math.pow(2, retryCount - 1);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            // Attempt to get session again
            const { data: { session: retrySession }, error: retryError } = await supabase.auth.getSession();
            
            if (retrySession) {
              console.log('[useAuthGuard] Token refresh retry successful');
              // Session restored, verify user is in context
              if (user === null) {
                const { data: { user: authUser } } = await supabase.auth.getUser();
                if (authUser) {
                  const { convertSupabaseUserToAppUser } = await import('../utils/userConversion');
                  const appUser = convertSupabaseUserToAppUser(authUser);
                  setUser(appUser);
                }
              }
              return; // Success, exit
            }
            
            if (retryError) {
              console.log(`[useAuthGuard] Token refresh retry ${retryCount + 1} failed:`, retryError.message);
            }
            
            retryCount++;
          } catch (retryError) {
            console.error(`[useAuthGuard] Token refresh retry ${retryCount + 1} error:`, retryError);
            retryCount++;
          }
        }
        
        // All retries exhausted - permanent failure, logout
        console.error('[useAuthGuard] Token refresh failed after all retries - permanent failure');
        await handleUnauthenticated();
        return;
      }

      // Handle session expiration
      if (event === 'USER_UPDATED' && !session) {
        console.log('[useAuthGuard] User updated but no session');
        await handleUnauthenticated();
        return;
      }

      // If we have a session, verify user is in context (but wait for restoration to complete)
      if (session && user === null && !isDemoUser && !isRestoringSession) {
        console.log('[useAuthGuard] Session exists but user not in context - checking auth state');
        await checkAuthState();
      }
    });

    // Initial auth check (will wait for restoration if in progress)
    checkAuthState();

    // Cleanup
    return () => {
      console.log('[useAuthGuard] Cleaning up auth state listener');
      subscription.unsubscribe();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount - handleUnauthenticated and checkAuthState use latest context values

  /**
   * Re-check auth state when user changes or session restoration completes
   */
  useEffect(() => {
    // Wait for session restoration to complete
    if (isRestoringSession) {
      return;
    }
    
    // If user becomes null and we're not a demo user, ensure we're on WelcomeScreen
    if (user === null && !isDemoUser) {
      // Ensure we're on WelcomeScreen - set currentStep if not already STEP_WELCOME
      // This prevents redirect loops while ensuring navigation happens
      if (currentStep !== STEP_WELCOME) {
        console.log('[useAuthGuard] User is null, ensuring navigation to WelcomeScreen');
        setCurrentStep(STEP_WELCOME);
      }
      return;
    }

    // If user exists, verify session is still valid
    if (user !== null && !isDemoUser) {
      checkAuthState();
    }
  }, [user, isDemoUser, isRestoringSession, checkAuthState, currentStep, setCurrentStep]);

  /**
   * Handle app foregrounding (mobile) or focus (web)
   * Re-check auth state when app comes to foreground
   */
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleFocus = () => {
        // Don't check auth state if we're in the middle of an OAuth redirect
        if (isOAuthCallback()) {
          return;
        }
        checkAuthState();
      };

      window.addEventListener('focus', handleFocus);
      return () => {
        window.removeEventListener('focus', handleFocus);
      };
    } else {
      // For mobile, we'd use AppState from react-native
      // This is handled by the auth state listener which is always active
    }
  }, [checkAuthState]);

  /**
   * Handle storage events for multi-tab sync (web only)
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const handleStorageChange = (e: StorageEvent) => {
      // Listen for auth state changes from other tabs
      if (e.key === 'sb-auth-token' || e.key?.includes('supabase')) {
        console.log('[useAuthGuard] Storage event detected, re-checking auth state');
        checkAuthState();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [checkAuthState]);
}

