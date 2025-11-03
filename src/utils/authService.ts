import { GoogleSignin, GoogleSigninButton, statusCodes } from '@react-native-google-signin/google-signin';
import { databaseService, User } from './databaseService';
import { Platform } from 'react-native';

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

    try {
      console.log('Configuring Google Sign-In...');
      const webClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      if (!webClientId) {
        throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set');
      }
      // Configure Google Sign-In
      GoogleSignin.configure({
        webClientId: webClientId,
        offlineAccess: true,
        hostedDomain: '',
        forceCodeForRefreshToken: true,
      });
      
      this.isConfigured = true;
      console.log('Google Sign-In configured successfully');
    } catch (error) {
      console.error('Error configuring Google Sign-In:', error);
      throw error;
    }
  }

  async signInWithGoogle(): Promise<User> {
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
      console.log('Starting Google Sign-In process...');
      await this.configure();

      console.log('Checking Google Play Services...');
      // Check if device supports Google Play Services
      await GoogleSignin.hasPlayServices();

      console.log('Initiating Google Sign-In...');
      // Sign in
      const userInfo = await GoogleSignin.signIn();
      
      console.log('Google Sign-In response:', userInfo);
      
      if (!userInfo.data?.user) {
        throw new Error('No user data received from Google');
      }

      const googleUser: GoogleUser = {
        id: userInfo.data.user.id,
        email: userInfo.data.user.email,
        name: userInfo.data.user.name || '',
        photo: userInfo.data.user.photo || undefined,
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
      
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        throw new Error('Sign in was cancelled');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        throw new Error('Sign in is already in progress');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play Services not available');
      } else {
        throw new Error('Sign in failed: ' + error.message);
      }
    }
  }

  async signOut(): Promise<void> {
    try {
      await GoogleSignin.signOut();
      console.log('User signed out successfully');
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }

  async getCurrentUser(): Promise<User | null> {
    try {
      await this.configure();
      
      const userInfo = await GoogleSignin.signInSilently();
      if (!userInfo.user) return null;

      const user = await databaseService.getUserByGoogleId(userInfo.user.id);
      return user;
    } catch (error) {
      console.log('No current user or error getting current user:', error);
      return null;
    }
  }

  async isSignedIn(): Promise<boolean> {
    try {
      await this.configure();
      const isSignedIn = await GoogleSignin.isSignedIn();
      return isSignedIn;
    } catch (error) {
      console.error('Error checking sign in status:', error);
      return false;
    }
  }
}

export const authService = new AuthService();
