import { databaseService, User } from '../database/databaseService';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabaseAuthService } from './supabaseAuthService';
import { isSupabaseConfigured } from '../../config/supabase';

// Complete the web browser authentication session
WebBrowser.maybeCompleteAuthSession();

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  photo?: string;
}

class AuthService {
  private isConfigured = false;

  async configure(): Promise<void> {
    if (this.isConfigured) {
      console.log('Google Sign-In already configured');
      return;
    }

    // Configuration is not needed for expo-auth-session
    this.isConfigured = true;
    console.log('Google Sign-In configured successfully');
  }

  async signInWithGoogle(): Promise<User> {
    // Use Supabase if configured, otherwise fall back to old method
    if (isSupabaseConfigured()) {
      console.log('Using Supabase for Google OAuth');
      const supabaseUser = await supabaseAuthService.signInWithGoogle();
      // Convert Supabase user format to legacy User format for compatibility
      return {
        id: parseInt(supabaseUser.id.replace(/-/g, '').substring(0, 15)) || Date.now(),
        email: supabaseUser.email,
        nickname: supabaseUser.nickname,
        googleId: supabaseUser.googleId || supabaseUser.id,
        createdAt: supabaseUser.createdAt,
        updatedAt: supabaseUser.updatedAt,
      };
    }
    
    console.log('Supabase not configured, using legacy OAuth method');
    if (Platform.OS === 'web') {
      return this.signInWithGoogleWeb();
    } else {
      return this.signInWithGoogleMobile();
    }
  }

  private async signInWithGoogleWeb(): Promise<User> {
    return new Promise((resolve, reject) => {
      try {
        // Check if Google Identity Services is already loaded
        if ((window as any).google?.accounts?.id) {
          this.initializeGoogleSignIn(resolve, reject);
        } else {
          // Load Google Identity Services script
          const script = document.createElement('script');
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.defer = true;
          script.onload = () => {
            this.initializeGoogleSignIn(resolve, reject);
          };
          script.onerror = () => {
            reject(new Error('Failed to load Google Identity Services'));
          };
          document.head.appendChild(script);
        }
      } catch (error) {
        console.error('Error setting up Google Sign-In:', error);
        reject(error);
      }
    });
  }

  private initializeGoogleSignIn(resolve: (user: User) => void, reject: (error: Error) => void) {
    try {
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      if (!clientId) {
        throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set');
      }
      console.log('Initializing Google Sign-In with client ID');
      
      // Initialize Google Identity Services
      (window as any).google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: any) => {
          try {
            console.log('Google Sign-In response received:', response);
            
            // Decode the JWT token to get user info
            const payload = JSON.parse(atob(response.credential.split('.')[1]));
            console.log('Decoded payload:', payload);

            const googleUser: GoogleUser = {
              id: payload.sub,
              email: payload.email,
              name: payload.name || '',
              photo: payload.picture || undefined,
            };

            console.log('Saving user to database:', googleUser);
            // Save user to database
            const user = await databaseService.saveUser({
              email: googleUser.email,
              nickname: googleUser.name,
              googleId: googleUser.id,
            });

            console.log('User signed in successfully:', user);
            resolve(user);
          } catch (error) {
            console.error('Error processing Google Sign-In response:', error);
            reject(new Error('Failed to process sign-in response: ' + (error instanceof Error ? error.message : String(error))));
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        context: 'signin'
      });

      console.log('Google Sign-In initialized, showing prompt...');
      
      // Show the Google Sign-In popup
      (window as any).google.accounts.id.prompt((notification: any) => {
        console.log('Prompt notification:', notification);
        
        if (notification.isNotDisplayed()) {
          const reason = notification.getNotDisplayedReason();
          console.error('Popup not displayed, reason:', reason);
          reject(new Error(`Google Sign-In popup not displayed: ${reason}`));
        } else if (notification.isSkippedMoment()) {
          const reason = notification.getSkippedReason();
          console.warn('Popup skipped, reason:', reason);
          reject(new Error(`Google Sign-In popup skipped: ${reason}`));
        } else {
          console.log('Google Sign-In popup displayed successfully');
        }
      });
    } catch (error) {
      console.error('Error initializing Google Sign-In:', error);
      reject(new Error('Failed to initialize Google Sign-In: ' + (error instanceof Error ? error.message : String(error))));
    }
  }

  private async signInWithGoogleMobile(): Promise<User> {
    try {
      console.log('Starting Google Sign-In process with expo-auth-session...');
      await this.configure();

      const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      if (!clientId) {
        throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set');
      }

      // Use expo-auth-session for OAuth flow
      const redirectUri = AuthSession.makeRedirectUri({});

      const discovery = {
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
      };

      const request = new AuthSession.AuthRequest({
        clientId,
        scopes: ['openid', 'profile', 'email'],
        redirectUri,
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
      });

      console.log('Initiating OAuth flow...');
      const result = await request.promptAsync(discovery);

      if (result.type === 'cancel') {
        throw new Error('Sign in was cancelled');
      }

      if (result.type === 'error') {
        throw new Error(`Sign in failed: ${result.error?.message || 'Unknown error'}`);
      }

      if (result.type !== 'success') {
        throw new Error('Unexpected response type from OAuth flow');
      }

      // Exchange authorization code for access token
      const code = result.params.code;
      if (!code) {
        throw new Error('No authorization code received from Google');
      }

      console.log('Exchanging authorization code for access token...');
      
      // Exchange code for token
      const tokenResponse = await fetch(
        `https://oauth2.googleapis.com/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: clientId,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }).toString(),
        }
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Failed to exchange code for token: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      
      if (!accessToken) {
        throw new Error('No access token received from Google');
      }

      console.log('Fetching user info from Google...');
      const userInfoResponse = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
      );

      if (!userInfoResponse.ok) {
        throw new Error('Failed to fetch user info from Google');
      }

      const userInfo = await userInfoResponse.json();
      console.log('Google user info:', userInfo);

      const googleUser: GoogleUser = {
        id: userInfo.id,
        email: userInfo.email,
        name: userInfo.name || '',
        photo: userInfo.picture || undefined,
      };

      console.log('Saving user to database:', googleUser);
      // Save user to database
      const user = await databaseService.saveUser({
        email: googleUser.email,
        nickname: googleUser.name,
        googleId: googleUser.id,
      });

      console.log('User signed in successfully:', user);
      return user;
    } catch (error: any) {
      console.error('Error signing in with Google:', error);
      throw new Error('Sign in failed: ' + (error.message || String(error)));
    }
  }

  async signOut(): Promise<void> {
    try {
      if (isSupabaseConfigured()) {
        await supabaseAuthService.signOut();
      } else {
        // For expo-auth-session, we just clear any stored tokens
        // In a production app, you might want to revoke the token with Google
        console.log('User signed out successfully (legacy method)');
      }
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }

  async getCurrentUser(): Promise<User | null> {
    try {
      // expo-auth-session doesn't have a built-in "silent sign-in" method
      // You would need to store the token and check it, or use AsyncStorage
      // For now, return null - this can be enhanced if needed
      return null;
    } catch (error) {
      console.log('No current user or error getting current user:', error);
      return null;
    }
  }

  async isSignedIn(): Promise<boolean> {
    try {
      // expo-auth-session doesn't have a built-in "isSignedIn" method
      // You would need to check stored tokens or session state
      // For now, return false - this can be enhanced if needed
      return false;
    } catch (error) {
      console.error('Error checking sign in status:', error);
      return false;
    }
  }
}

export const authService = new AuthService();

