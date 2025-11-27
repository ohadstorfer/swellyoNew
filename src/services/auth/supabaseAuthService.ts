import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '../../config/supabase';
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
      const errorDescription = hashParams.get('error_description');

      if (errorParam) {
        // Clean up the error from URL
        if (window.history && window.location) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        
        // Provide more helpful error messages
        let errorMessage = `OAuth error: ${errorParam}`;
        if (errorDescription) {
          errorMessage += ` - ${errorDescription}`;
        }
        
        // Add specific guidance for common errors
        if (errorParam === 'server_error') {
          if (errorDescription && errorDescription.includes('Database error')) {
            errorMessage = 'Database Error: ' + errorDescription;
            errorMessage += '\n\nThis error occurs when Supabase tries to automatically create a user record in your database.\n' +
              'Common causes:\n' +
              '1. Database trigger or function is failing when creating user records\n' +
              '2. Missing required columns in the users table\n' +
              '3. Row Level Security (RLS) policies preventing user creation\n' +
              '4. Database constraints or foreign key violations\n\n' +
              'To fix:\n' +
              '1. Check your Supabase database for triggers/functions on auth.users\n' +
              '2. Verify the users table schema matches what the trigger expects\n' +
              '3. Check RLS policies on the users table\n' +
              '4. Review Supabase logs for detailed error information';
          } else {
            errorMessage += '\n\nThis usually indicates a configuration issue. Please check:\n' +
              '1. Supabase redirect URLs are correctly configured\n' +
              '2. Google OAuth credentials are properly set up in Supabase\n' +
              '3. The redirect URL matches your current domain';
          }
        } else if (errorParam === 'access_denied') {
          errorMessage += '\n\nYou cancelled the sign-in process.';
        }
        
        throw new Error(errorMessage);
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
      
      // Get the current URL without hash/query params for redirect
      const redirectUrl = window.location.origin + window.location.pathname;
      console.log('OAuth redirect URL:', redirectUrl);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        console.error('Error initiating OAuth:', error);
        throw new Error(`Failed to initiate Google sign-in: ${error.message}`);
      }

      if (!data?.url) {
        throw new Error('OAuth URL not returned from Supabase. Please check your Supabase configuration.');
      }

      // Supabase will redirect, so this promise never resolves
      // The function will be called again when the user returns from OAuth
      console.log('Redirecting to Google OAuth...');
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

