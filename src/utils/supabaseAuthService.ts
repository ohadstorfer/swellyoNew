import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '../config/supabase';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

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
  /**
   * Sign in with Google using Supabase OAuth
   */
  async signInWithGoogle(): Promise<User> {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.');
    }

    try {
      if (Platform.OS === 'web') {
        return this.signInWithGoogleWeb();
      } else {
        return this.signInWithGoogleMobile();
      }
    } catch (error: any) {
      console.error('Error signing in with Google:', error);
      throw new Error('Sign in failed: ' + (error.message || String(error)));
    }
  }

  /**
   * Web implementation using Supabase OAuth
   */
  private async signInWithGoogleWeb(): Promise<User> {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      throw new Error('Web Google OAuth is only available on web platform');
    }

    try {
      console.log('Starting Supabase Google OAuth for web...');
      
      // First, check if we already have a valid session
      const { data: existingSession, error: sessionCheckError } = await supabase.auth.getSession();
      
      if (!sessionCheckError && existingSession?.session?.user) {
        console.log('Found existing Supabase session, using it');
        return this.convertSupabaseUserToAppUser(existingSession.session.user);
      }
      
      // Check if we're returning from OAuth redirect
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const errorParam = hashParams.get('error');

      if (errorParam) {
        throw new Error(`OAuth error: ${errorParam}`);
      }

      if (accessToken) {
        // We're returning from OAuth, get the session
        console.log('Detected OAuth redirect, processing session...');
        
        // Wait a bit for Supabase to process the session
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          throw sessionError;
        }

        if (sessionData.session && sessionData.session.user) {
          // Clean up the URL after successful auth
          if (window.history && window.location) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          return this.convertSupabaseUserToAppUser(sessionData.session.user);
        }
      }

      // No access token found and no existing session, initiate OAuth flow
      console.log('No existing session found, initiating Google OAuth flow...');
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        throw error;
      }

      // Supabase will redirect, so this promise never resolves
      // The function will be called again when the user returns from OAuth
      return new Promise(() => {}); // Never resolves, redirect happens
    } catch (error: any) {
      console.error('Error in web Google OAuth:', error);
      throw error;
    }
  }

  /**
   * Mobile implementation using Supabase OAuth with expo-auth-session
   */
  private async signInWithGoogleMobile(): Promise<User> {
    try {
      console.log('Starting Supabase Google OAuth for mobile...');

      // Get the redirect URI
      const redirectUri = AuthSession.makeRedirectUri({
        useProxy: true,
      });

      console.log('Redirect URI:', redirectUri);

      // Start OAuth flow with Supabase
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        throw error;
      }

      if (!data.url) {
        throw new Error('No OAuth URL returned from Supabase');
      }

      // Open the OAuth URL in browser
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUri
      );

      if (result.type === 'cancel') {
        throw new Error('Sign in was cancelled');
      }

      if (result.type === 'success' && result.url) {
        // Parse the URL to get the access token
        const url = new URL(result.url);
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (accessToken) {
          // Set the session manually
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          });

          if (sessionError) {
            throw sessionError;
          }

          if (sessionData.session) {
            return this.convertSupabaseUserToAppUser(sessionData.session.user);
          }
        }
      }

      throw new Error('Failed to complete OAuth flow');
    } catch (error: any) {
      console.error('Error in mobile Google OAuth:', error);
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

      return {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        nickname: userProfile.nickname || supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || 'User',
        googleId: supabaseUser.app_metadata?.provider_id || supabaseUser.id,
        photo: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture,
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
      const { supabaseDatabaseService } = await import('./supabaseDatabaseService');
      
      // Save user to users table
      const savedUser = await supabaseDatabaseService.saveUser({
        email: supabaseUser.email || '',
        nickname: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name,
        profilePicture: supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture,
        googleId: supabaseUser.app_metadata?.provider_id || supabaseUser.id,
      });

      return {
        nickname: savedUser.nickname || supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || 'User',
        email: savedUser.email,
      };
    } catch (error) {
      console.warn('Error in getOrCreateUserProfile:', error);
      // Return a default profile object
      return {
        nickname: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || 'User',
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

