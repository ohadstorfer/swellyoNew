import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '../../config/supabase';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
// Lazy-load native Google Sign-In to avoid crash in Expo Go
let GoogleSignin: any = null;
if (Platform.OS !== 'web') {
  try {
    GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
  } catch (e) {
    console.warn('Google Sign-In native module not available (Expo Go?):', e);
  }
}

// Complete the web browser authentication session
WebBrowser.maybeCompleteAuthSession();

export interface User {
  id: string; // Supabase uses UUID strings
  email: string;
  nickname: string;
  googleId?: string;
  photo?: string;
  createdAt: string;
  updatedAt: string;
}

class SupabaseAuthService {
  // Track ongoing login attempts to prevent concurrent logins
  private ongoingLogins = new Map<string, Promise<User>>();

  /**
   * Sign in with Google using Supabase OAuth
   * Prevents concurrent login attempts for the same user.
   * Supabase automatically replaces the existing session on new sign-in — no
   * pre-login signOut is needed.
   */
  async signInWithGoogle(): Promise<User> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.');
    }

    // Check if there's already an ongoing login attempt
    const loginKey = 'current_login';
    const ongoingLogin = this.ongoingLogins.get(loginKey);

    if (ongoingLogin) {
      console.log('[SupabaseAuthService] Login already in progress, returning existing promise');
      return ongoingLogin;
    }

    // Create new login promise
    const loginPromise = (async () => {
      try {
        let result: User;
        if (Platform.OS === 'web') {
          result = await this.signInWithGoogleWeb();
        } else {
          result = await this.signInWithGoogleMobile();
        }

        console.log('[SupabaseAuthService] Login successful, new session created');
        return result;
      } catch (error: any) {
        console.error('Error signing in with Google:', error);
        throw new Error('Sign in failed: ' + (error.message || String(error)));
      } finally {
        this.ongoingLogins.delete(loginKey);
      }
    })();

    this.ongoingLogins.set(loginKey, loginPromise);
    return loginPromise;
  }

  /**
   * Web implementation using Supabase OAuth (PKCE flow).
   *
   * With `flowType: 'pkce'` and `detectSessionInUrl: true`, the Supabase client
   * automatically intercepts the `?code=` param on page load and exchanges it
   * for a session. So after redirect, we just need to call getSession().
   */
  private async signInWithGoogleWeb(): Promise<User> {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      throw new Error('Web Google OAuth is only available on web platform');
    }

    try {
      // 1. Check if a session already exists (e.g. detectSessionInUrl processed a PKCE code,
      //    or the user is already logged in).
      const { data: { session: existingSession } } = await supabase.auth.getSession();

      if (existingSession?.user) {
        // Clean up OAuth params from URL if present (PKCE uses ?code= in query params)
        if (window.location.search.includes('code=')) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        console.log('[SupabaseAuthService] Found existing session, using it');
        return this.convertSupabaseUserToAppUser(existingSession.user);
      }

      // 2. Check for OAuth error return in URL (PKCE uses query params)
      const urlParams = new URLSearchParams(window.location.search);
      const errorParam = urlParams.get('error');
      const errorDescription = urlParams.get('error_description');

      if (errorParam) {
        window.history.replaceState({}, document.title, window.location.pathname);

        let errorMessage = `OAuth error: ${errorParam}`;
        if (errorDescription) {
          errorMessage += ` - ${errorDescription}`;
        }

        if (errorParam === 'server_error') {
          if (errorDescription && errorDescription.includes('Database error')) {
            errorMessage = 'Database Error: ' + errorDescription +
              '\n\nThis error occurs when Supabase tries to automatically create a user record.\n' +
              'Common causes:\n' +
              '1. Database trigger or function is failing\n' +
              '2. Missing required columns in the users table\n' +
              '3. Row Level Security (RLS) policies preventing user creation\n\n' +
              'Check your Supabase logs for details.';
          } else {
            errorMessage += '\n\nPlease check:\n' +
              '1. Supabase redirect URLs are correctly configured\n' +
              '2. Google OAuth credentials are properly set up in Supabase\n' +
              '3. The redirect URL matches your current domain';
          }
        } else if (errorParam === 'access_denied') {
          errorMessage += '\n\nYou cancelled the sign-in process.';
        }

        throw new Error(errorMessage);
      }

      // 3. No session and no error — initiate the OAuth redirect
      const redirectUrl = window.location.origin + window.location.pathname;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        throw new Error(`Failed to initiate Google sign-in: ${error.message}`);
      }

      if (!data?.url) {
        throw new Error('OAuth URL not returned from Supabase. Please check your Supabase configuration.');
      }

      // Redirect to Google. After the user authenticates, Google redirects back
      // with ?code=... which detectSessionInUrl processes on page reload.
      window.location.replace(data.url);

      // This promise never resolves because we're navigating away
      return new Promise(() => {});
    } catch (error: any) {
      console.error('Error in web Google OAuth:', error);
      throw error;
    }
  }

  /**
   * Mobile implementation using native Google Sign-In + Supabase signInWithIdToken.
   *
   * This bypasses Supabase's OAuth redirect flow entirely, avoiding the known
   * issue where Supabase blocks exp:// redirect URLs containing IP addresses.
   * Instead, we authenticate natively with Google and pass the ID token to Supabase.
   */
  private async signInWithGoogleMobile(): Promise<User> {
    try {
      console.log('Starting native Google Sign-In for mobile...');

      // Check if Google Play Services are available (Android only, always true on iOS)
      await GoogleSignin.hasPlayServices();

      // Trigger the native Google Sign-In flow
      const signInResult = await GoogleSignin.signIn();

      const idToken = signInResult?.data?.idToken;
      if (!idToken) {
        throw new Error('No ID token returned from Google Sign-In');
      }

      console.log('Got Google ID token, exchanging with Supabase...');

      // Pass the Google ID token to Supabase — no redirect URLs needed
      const { data: sessionData, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });

      if (error) {
        throw error;
      }

      if (!sessionData.session) {
        throw new Error('No session returned from Supabase');
      }

      return this.convertSupabaseUserToAppUser(sessionData.session.user);
    } catch (error: any) {
      console.error('Error in mobile Google Sign-In:', error);
      throw error;
    }
  }

  /**
   * Convert Supabase user to app User format
   */
  private async convertSupabaseUserToAppUser(supabaseUser: any): Promise<User> {
    try {
      // Get or create user profile in Supabase
      const userProfile = await this.getOrCreateUserProfile(supabaseUser);

      // Try to get the actual name from surfers table (for users who completed onboarding)
      let displayName = userProfile.nickname || supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || 'User';
      let profileImage = supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture;
      
      try {
        const { supabaseDatabaseService } = await import('../database/supabaseDatabaseService');
        const { surfer } = await supabaseDatabaseService.getCurrentUserData();
        
        // If surfer exists and has a name that's not a default value, use it
        if (surfer?.name && 
            surfer.name.trim() !== '' && 
            surfer.name !== 'User' && 
            surfer.name !== 'Demo User') {
          displayName = surfer.name;
        }
        
        // Also use profile image from surfer if available
        if (surfer?.profile_image_url) {
          profileImage = surfer.profile_image_url;
        }
      } catch (surferError) {
        // If we can't get surfer data, just use the nickname from user profile
        // This is not critical, so we continue with the existing displayName
        if (__DEV__) {
          console.log('Could not get surfer name, using user profile nickname:', surferError);
        }
      }

      return {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        nickname: displayName,
        googleId: supabaseUser.app_metadata?.provider_id || supabaseUser.id,
        photo: profileImage,
        createdAt: supabaseUser.created_at || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error converting Supabase user:', error);
      // Return a basic user object if profile creation fails
      return {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        nickname: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || 'User',
        googleId: supabaseUser.app_metadata?.provider_id || supabaseUser.id,
        photo: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture,
        createdAt: supabaseUser.created_at || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Get or create user profile in Supabase users table
   */
  private async getOrCreateUserProfile(supabaseUser: any): Promise<any> {
    try {
      // Import the database service
      const { supabaseDatabaseService } = await import('../database/supabaseDatabaseService');
      
      // Get Google name from metadata
      const googleName = supabaseUser.user_metadata?.full_name || 
                        supabaseUser.user_metadata?.name || 
                        supabaseUser.email?.split('@')[0] || 
                        'User';
      
      // Save user to users table
      const savedUser = await supabaseDatabaseService.saveUser({
        email: supabaseUser.email || '',
        nickname: googleName,
        profilePicture: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture,
        googleId: supabaseUser.app_metadata?.provider_id || supabaseUser.id,
      });

      // Also create/update surfer record with Google name if it doesn't exist or has default "User" name
      try {
        const { data: existingSurfer } = await supabase
          .from('surfers')
          .select('name')
          .eq('user_id', supabaseUser.id)
          .maybeSingle();

        // If no surfer exists, or if surfer exists with "User" name, update it with Google name
        if (!existingSurfer || existingSurfer.name === 'User' || !existingSurfer.name || existingSurfer.name.trim() === '') {
          const { supabaseDatabaseService } = await import('../database/supabaseDatabaseService');
          await supabaseDatabaseService.saveSurfer({
            name: googleName,
            profileImageUrl: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture,
          });
          console.log(`Created/updated surfer record with Google name: ${googleName}`);
        }
      } catch (surferError) {
        // Log but don't fail - surfer creation is not critical for auth
        console.warn('Error creating/updating surfer record during signup:', surferError);
      }

      return {
        nickname: savedUser.nickname || googleName,
        email: savedUser.email,
      };
    } catch (error) {
      console.warn('Error in getOrCreateUserProfile:', error);
      // Return a default profile object
      const googleName = supabaseUser.user_metadata?.full_name || 
                        supabaseUser.user_metadata?.name || 
                        supabaseUser.email?.split('@')[0] || 
                        'User';
      return {
        nickname: googleName,
        email: supabaseUser.email || '',
      };
    }
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<void> {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      console.log('User signed out successfully');
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }

  /**
   * Get the current user
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error) {
        throw error;
      }

      if (!user) {
        return null;
      }

      return this.convertSupabaseUserToAppUser(user);
    } catch (error) {
      console.log('No current user or error getting current user:', error);
      return null;
    }
  }

  /**
   * Check if user is signed in
   */
  async isSignedIn(): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return !!session;
    } catch (error) {
      console.error('Error checking sign in status:', error);
      return false;
    }
  }

  /**
   * Create a demo user for testing/demo purposes
   * Creates an anonymous user with a random email
   */
  async createDemoUser(): Promise<User> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.');
    }

    try {
      // Try anonymous sign-in first (doesn't require email)
      // If that's not available, fall back to email/password
      try {
        const { data: { user: anonUser, session: anonSession }, error: anonError } = await supabase.auth.signInAnonymously();
        
        if (!anonError && anonUser && anonSession) {
          // Anonymous sign-in successful
          const demoEmail = anonUser.email || `demo-${anonUser.id}@anonymous.supabase.co`;
          
          // Create user profile in users table
          const { supabaseDatabaseService } = await import('../database/supabaseDatabaseService');
          await supabaseDatabaseService.saveUser({
            email: demoEmail,
            nickname: 'Demo User',
            googleId: anonUser.id,
          });

          // Convert to app User format
          return this.convertSupabaseUserToAppUser(anonUser);
        }
      } catch (anonErr) {
        console.log('Anonymous sign-in not available, using email/password:', anonErr);
      }

      // Fallback: Generate a unique demo email with a simple format
      // Use a simple numeric format that Supabase will definitely accept
      const timestamp = Date.now();
      const randomNum = Math.floor(Math.random() * 1000000);
      // Use a simple format without special characters
      const demoEmail = `demo${timestamp}${randomNum}@test.com`;
      const demoPassword = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + 'A1!';
      
      // Sign up the demo user
      const { data: { user: supabaseUser }, error: signUpError } = await supabase.auth.signUp({
        email: demoEmail,
        password: demoPassword,
        options: {
          data: {
            full_name: 'Demo User',
            name: 'Demo User',
          },
          emailRedirectTo: undefined, // Don't require email confirmation for demo users
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (!supabaseUser) {
        throw new Error('Failed to create demo user');
      }

      // Check if user is already authenticated (some Supabase configs auto-sign-in)
      let { data: { session } } = await supabase.auth.getSession();
      let finalUser = supabaseUser;
      
      // If not authenticated, sign in the user immediately after signup
      // This is necessary because signUp doesn't automatically sign in the user in some configs
      if (!session || session.user.id !== supabaseUser.id) {
        const { data: { session: newSession, user: signedInUser }, error: signInError } = await supabase.auth.signInWithPassword({
          email: demoEmail,
          password: demoPassword,
        });

        if (signInError) {
          // If signIn fails (e.g., email confirmation required), we can't proceed
          // In production, you might want to disable email confirmation for demo users
          // or use a service role key on the server side
          console.error('Failed to sign in demo user after signUp:', signInError);
          throw new Error('Failed to authenticate demo user. Please ensure email confirmation is disabled for demo users in Supabase settings.');
        }

        if (newSession?.user) {
          finalUser = newSession.user;
        } else if (signedInUser) {
          finalUser = signedInUser;
        }
      }
      
      // Verify we have an authenticated session before proceeding
      const { data: { session: verifySession } } = await supabase.auth.getSession();
      if (!verifySession || verifySession.user.id !== finalUser.id) {
        throw new Error('Demo user authentication failed. Please check Supabase email confirmation settings.');
      }
      
      // Create user profile in users table
      const { supabaseDatabaseService } = await import('../database/supabaseDatabaseService');
      await supabaseDatabaseService.saveUser({
        email: demoEmail,
        nickname: 'Demo User',
        googleId: finalUser.id,
      });

      // Convert to app User format
      return this.convertSupabaseUserToAppUser(finalUser);
    } catch (error: any) {
      console.error('Error creating demo user:', error);
      throw new Error('Failed to create demo user: ' + (error.message || String(error)));
    }
  }

  /**
   * Listen to auth state changes
   */
  onAuthStateChange(callback: (user: User | null) => void) {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const user = await this.convertSupabaseUserToAppUser(session.user);
        callback(user);
      } else {
        callback(null);
      }
    });
  }
}

export const supabaseAuthService = new SupabaseAuthService();

// Note: The ongoingLogins Map is per-instance, so it only prevents concurrent logins
// within the same service instance. For distributed systems, consider using a shared
// store (Redis, database) to track ongoing logins across instances.

