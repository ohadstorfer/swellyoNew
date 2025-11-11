import { Platform } from 'react-native';
import { databaseService, User } from './databaseService';
import { supabaseAuthService } from './supabaseAuthService';
import { isSupabaseConfigured } from '../config/supabase';

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  photo?: string;
}

class SimpleAuthService {
  async signInWithGoogle(): Promise<User> {
    try {
      console.log('Starting simple Google OAuth...');
      
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
    } catch (error: any) {
      console.error('Error signing in with Google:', error);
      throw new Error('Sign in failed: ' + error.message);
    }
  }

  private async signInWithGoogleWeb(): Promise<User> {
    // Skip on mobile - web only
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) {
      throw new Error('Google OAuth is only available on web');
    }

    // Check if we're returning from OAuth with a code
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (error) {
      throw new Error(`OAuth error: ${error}`);
    }

    if (code) {
      console.log('Found OAuth code in URL, processing...');
      // Clean up the URL
      if (window.history && window.location) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      
      return new Promise((resolve, reject) => {
        this.exchangeCodeForUser(code, resolve, reject);
      });
    }

    // No code found, redirect to Google OAuth
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set');
    }
    const redirectUri = encodeURIComponent(window.location?.origin || '');
    const scope = encodeURIComponent('openid email profile');
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${clientId}&` +
      `redirect_uri=${redirectUri}&` +
      `scope=${scope}&` +
      `response_type=code&` +
      `access_type=offline&` +
      `prompt=select_account`;

    console.log('=== OAuth Debug Info ===');
    if (window.location) {
      console.log('Current URL:', window.location.href);
      console.log('Current Origin:', window.location.origin);
    }
    console.log('Redirect URI:', redirectUri);
    console.log('Full Auth URL:', authUrl);
    console.log('========================');
    
    // Redirect to Google OAuth
    if (window.location) {
      window.location.href = authUrl;
    }
    
    // This will never resolve because we're redirecting
    return new Promise(() => {});
  }

  private async exchangeCodeForUser(code: string, resolve: (user: User) => void, reject: (error: Error) => void) {
    try {
      console.log('=== Token Exchange Debug ===');
      console.log('Exchanging code for user info...', code);
      if (window.location) {
        console.log('Using redirect URI:', window.location.origin);
        console.log('Current URL:', window.location.href);
      }
      console.log('============================');
      
      // Exchange code for access token
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      const clientSecret = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('Google OAuth credentials are not configured. Please set EXPO_PUBLIC_GOOGLE_CLIENT_ID and EXPO_PUBLIC_GOOGLE_CLIENT_SECRET environment variables.');
      }
      
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: window.location?.origin || '',
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Token data:', tokenData);

      // Get user info from Google
      const userInfoResponse = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokenData.access_token}`
      );

      if (!userInfoResponse.ok) {
        throw new Error(`User info fetch failed: ${userInfoResponse.statusText}`);
      }

      const userInfo = await userInfoResponse.json();
      console.log('User info from Google:', userInfo);

      const googleUser: GoogleUser = {
        id: userInfo.id,
        email: userInfo.email,
        name: userInfo.name || '',
        photo: userInfo.picture || undefined,
      };

      await this.saveUserAndResolve(googleUser, resolve, reject);
    } catch (error) {
      console.error('Error exchanging code:', error);
      reject(new Error('Failed to exchange code: ' + (error instanceof Error ? error.message : String(error))));
    }
  }

  private async saveUserAndResolve(googleUser: GoogleUser, resolve: (user: User) => void, reject: (error: Error) => void) {
    try {
      console.log('Saving user to database:', googleUser);
      
      const user = await databaseService.saveUser({
        email: googleUser.email,
        nickname: googleUser.name,
        googleId: googleUser.id,
      });

      console.log('User signed in successfully:', user);
      resolve(user);
    } catch (error) {
      reject(new Error('Failed to save user: ' + (error instanceof Error ? error.message : String(error))));
    }
  }

  private async signInWithGoogleMobile(): Promise<User> {
    // For mobile, we'll use the existing authService
    const { authService } = await import('./authService');
    return authService.signInWithGoogle();
  }

  async signOut(): Promise<void> {
    try {
      if (isSupabaseConfigured()) {
        await supabaseAuthService.signOut();
      } else {
        console.log('User signed out successfully (legacy method)');
      }
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }
}

export const simpleAuthService = new SimpleAuthService();
