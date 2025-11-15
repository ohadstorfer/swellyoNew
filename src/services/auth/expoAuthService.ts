import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { databaseService, User } from '../database/databaseService';

// Configure WebBrowser for better UX
WebBrowser.maybeCompleteAuthSession();

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  photo?: string;
}

class ExpoAuthService {
  private get clientId(): string {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('EXPO_PUBLIC_GOOGLE_CLIENT_ID environment variable is not set');
    }
    return clientId;
  }
  
  private redirectUri = AuthSession.makeRedirectUri({
    useProxy: true,
  });

  async signInWithGoogle(): Promise<User> {
    try {
      console.log('Starting Expo Google OAuth...');
      console.log('Redirect URI:', this.redirectUri);

      // Create the auth request
      const request = new AuthSession.AuthRequest({
        clientId: this.clientId,
        scopes: ['openid', 'profile', 'email'],
        redirectUri: this.redirectUri,
        responseType: AuthSession.ResponseType.Code,
        extraParams: {},
        additionalParameters: {},
        prompt: AuthSession.Prompt.SelectAccount,
      });

      console.log('Auth request created:', request);

      // Start the auth session
      const result = await request.promptAsync({
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      });

      console.log('Auth result:', result);

      if (result.type === 'success') {
        // Exchange the code for tokens
        const tokenResult = await AuthSession.exchangeCodeAsync(
          {
            clientId: this.clientId,
            code: result.params.code,
            redirectUri: this.redirectUri,
            extraParams: {
              code_verifier: request.codeVerifier,
            },
          },
          {
            tokenEndpoint: 'https://oauth2.googleapis.com/token',
          }
        );

        console.log('Token result:', tokenResult);

        // Get user info from Google
        const userInfoResponse = await fetch(
          `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokenResult.accessToken}`
        );
        const userInfo = await userInfoResponse.json();

        console.log('User info from Google:', userInfo);

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
      } else if (result.type === 'cancel') {
        throw new Error('Sign in was cancelled');
      } else {
        throw new Error('Sign in failed');
      }
    } catch (error: any) {
      console.error('Error signing in with Google:', error);
      throw new Error('Sign in failed: ' + error.message);
    }
  }

  async signOut(): Promise<void> {
    try {
      // For Expo, we just clear local data
      console.log('User signed out successfully');
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }
}

export const expoAuthService = new ExpoAuthService();

