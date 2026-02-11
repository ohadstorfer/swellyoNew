import { useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { supabase } from '../config/supabase';
import { useOnboarding } from '../context/OnboardingContext';
import { performLogout } from '../utils/logout';

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
   * Check if we're in an OAuth callback flow
   * This prevents the guard from redirecting during OAuth return
   * Uses multiple detection methods with fallbacks for robustness
   */
  /**
   * Clear stale OAuth flags if they exist but OAuth is not actually in progress
   */
  const clearStaleOAuthFlags = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    try {
      // Check if flags exist
      const hasSessionFlag = sessionStorage.getItem('oauth_redirecting') === 'true';
      const hasLocalFlag = localStorage.getItem('oauth_redirecting') === 'true';
      
      if (hasSessionFlag || hasLocalFlag) {
        // Check if URL has OAuth params - if not, flags might be stale
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const urlParams = new URLSearchParams(window.location.search);
        const hasUrlParams = !!(hashParams.get('access_token') || hashParams.get('refresh_token') || 
                                urlParams.get('code') || hashParams.get('error') || urlParams.get('error'));
        
        if (!hasUrlParams) {
          // No URL params but flags are set - check timestamp
          const timestampSession = sessionStorage.getItem('oauth_timestamp');
          const timestampLocal = localStorage.getItem('oauth_timestamp');
          const timestamp = timestampSession ? parseInt(timestampSession, 10) : 
                          (timestampLocal ? parseInt(timestampLocal, 10) : 0);
          
          if (timestamp) {
            const now = Date.now();
            const oneMinute = 60 * 1000;
            
            // If flags are older than 1 minute and no URL params, they're likely stale
            if (now - timestamp > oneMinute) {
              console.log('[useAuthGuard] Clearing stale OAuth flags (no URL params, older than 1 minute)');
              try {
                sessionStorage.removeItem('oauth_redirecting');
                sessionStorage.removeItem('oauth_timestamp');
                localStorage.removeItem('oauth_redirecting');
                localStorage.removeItem('oauth_timestamp');
              } catch (e) {
                // Ignore storage errors
              }
            }
          }
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }, []);

  const isOAuthCallback = useCallback((): boolean => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return false;
    }

    try {
      // Method 1: Check URL hash/query parameters (primary method - most reliable)
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const urlParams = new URLSearchParams(window.location.search);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const code = urlParams.get('code');
      const errorParam = hashParams.get('error') || urlParams.get('error');
      const type = hashParams.get('type') || urlParams.get('type');
      
      // OAuth callback indicators in URL - if present, definitely in OAuth callback
      if (accessToken || refreshToken || code || (errorParam && type === 'recovery')) {
        return true;
      }

      // Method 2: Check storage flags (secondary method - only trust if very recent)
      // Only use storage flags if they're very recent (within 30 seconds) to prevent stuck flags
      // If flags are older, they should be cleared (handled in clearStaleOAuthFlags)
      try {
        const isOAuthRedirectingSession = sessionStorage.getItem('oauth_redirecting') === 'true';
        const oauthTimestampSession = sessionStorage.getItem('oauth_timestamp');
        const isOAuthRedirectingLocal = localStorage.getItem('oauth_redirecting') === 'true';
        const oauthTimestampLocal = localStorage.getItem('oauth_timestamp');
        
        if ((isOAuthRedirectingSession && oauthTimestampSession) || (isOAuthRedirectingLocal && oauthTimestampLocal)) {
          const timestamp = oauthTimestampSession 
            ? parseInt(oauthTimestampSession, 10)
            : (oauthTimestampLocal ? parseInt(oauthTimestampLocal, 10) : 0);
          
          if (timestamp) {
            const now = Date.now();
            const thirtySeconds = 30 * 1000; // Only trust flags if very recent (30 seconds)
            
            if (now - timestamp < thirtySeconds) {
              // Flags are very recent, might be in OAuth flow
              return true;
            } else {
              // Flags are older than 30 seconds - don't trust them without URL params
              // They'll be cleared by clearStaleOAuthFlags if older than 1 minute
              return false;
            }
          }
        }
      } catch (e) {
        // sessionStorage/localStorage might not be available, continue
      }

      return false;
    } catch (error) {
      // If any error occurs, default to not being in OAuth callback
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
        setCurrentStep(-1);
      }
    } catch (error) {
      console.error('[useAuthGuard] Error during logout:', error);
      // Force redirect even if logout fails
      setUser(null);
      setIsDemoUser(false);
      setCurrentStep(-1);
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
    
    // Clear stale OAuth flags before checking auth
    clearStaleOAuthFlags();
    
    // Check if we're in OAuth callback - prioritize URL params
    const hashParams = Platform.OS === 'web' && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.hash.substring(1))
      : new URLSearchParams();
    const urlParams = Platform.OS === 'web' && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    const hasUrlParams = !!(hashParams.get('access_token') || hashParams.get('refresh_token') || 
                           urlParams.get('code') || hashParams.get('error') || urlParams.get('error'));
    
    // Only skip auth check if we have URL params (definitely in OAuth callback)
    // If only storage flags are set (no URL params), we should still check for session
    if (hasUrlParams) {
      console.log('[useAuthGuard] OAuth callback detected (URL params), skipping auth check');
      return;
    }
    
    // If storage flags are set but no URL params, check if there's actually a session
    // If no session exists, the flags are stale and we should proceed with auth check
    if (isOAuthCallback() && !hasUrlParams) {
      // Storage flags are set but no URL params - verify session exists
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          // No session and no URL params - flags are stale, clear them and proceed with auth check
          console.log('[useAuthGuard] OAuth flags set but no URL params and no session - clearing flags and checking auth');
          try {
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
              sessionStorage.removeItem('oauth_redirecting');
              sessionStorage.removeItem('oauth_timestamp');
              localStorage.removeItem('oauth_redirecting');
              localStorage.removeItem('oauth_timestamp');
            }
          } catch (e) {
            // Ignore storage errors
          }
          // Continue with auth check below
        } else {
          // Session exists - might be in OAuth flow, but be conservative and still check
          // Only skip if flags are very recent (handled by isOAuthCallback returning true for < 30s)
          console.log('[useAuthGuard] OAuth flags set with session - proceeding with auth check to verify');
          // Continue with auth check below
        }
      } catch (sessionCheckError) {
        // Error checking session - proceed with normal auth check
        console.log('[useAuthGuard] Error checking session with OAuth flags, proceeding with auth check');
      }
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
          if (currentStep !== -1) {
            console.log('[useAuthGuard] User is null and no session - ensuring WelcomeScreen');
            setCurrentStep(-1);
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
        
        // Preload profile video in background (non-blocking)
        if (appUser?.id) {
          const { preloadProfileVideo } = await import('../services/media/videoPreloadService');
          preloadProfileVideo(appUser.id.toString(), 'high')
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
      // BUT: Ignore SIGNED_OUT during OAuth login flow (pre-login sign-out)
      // The oauth_redirecting flag indicates we're in the middle of a login
      if (event === 'SIGNED_OUT') {
        // Check if we're in an OAuth login flow
        // This can happen in two cases:
        // 1. We're returning from OAuth (isOAuthCallback checks URL params)
        // 2. We're initiating OAuth (oauth_redirecting flag is set)
        const isOAuthLogin = isOAuthCallback();
        
        // Also check for oauth_redirecting flag (set before redirect)
        let isOAuthRedirecting = false;
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          try {
            isOAuthRedirecting = sessionStorage.getItem('oauth_redirecting') === 'true' || 
                                  localStorage.getItem('oauth_redirecting') === 'true';
          } catch (e) {
            // Ignore storage errors
          }
        }
        
        if (isOAuthLogin || isOAuthRedirecting) {
          console.log('[useAuthGuard] SIGNED_OUT event during OAuth login - ignoring (pre-login sign-out)');
          return;
        }
        
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
      // Ensure we're on WelcomeScreen - set currentStep if not already -1
      // This prevents redirect loops while ensuring navigation happens
      if (currentStep !== -1) {
        console.log('[useAuthGuard] User is null, ensuring navigation to WelcomeScreen');
        setCurrentStep(-1);
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
      // Clear stale OAuth flags on app load/focus
      clearStaleOAuthFlags();
      
      const handleFocus = () => {
        // Clear stale flags when window regains focus
        clearStaleOAuthFlags();
        // Don't check auth state if we're in the middle of an OAuth redirect (use improved detection)
        if (isOAuthCallback()) {
          console.log('[useAuthGuard] OAuth redirect in progress, skipping focus check');
          // Clear stale flags after a delay if OAuth callback is no longer valid
          setTimeout(() => {
            try {
              if (!isOAuthCallback()) {
                // OAuth callback is no longer valid, clean up flags
                sessionStorage.removeItem('oauth_redirecting');
                sessionStorage.removeItem('oauth_timestamp');
                localStorage.removeItem('oauth_redirecting');
                localStorage.removeItem('oauth_timestamp');
              }
            } catch (e) {
              // Ignore
            }
          }, 2000);
          return;
        }
        
        console.log('[useAuthGuard] Window focused, re-checking auth state');
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

