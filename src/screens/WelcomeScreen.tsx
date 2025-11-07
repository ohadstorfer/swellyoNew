import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Image,
  Text as RNText,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { BackgroundVideo } from '../components/BackgroundVideo';
import { colors, spacing } from '../styles/theme';
import { authService } from '../utils/authService';
import { simpleAuthService } from '../utils/simpleAuthService';
import { useOnboarding } from '../context/OnboardingContext';

interface WelcomeScreenProps {
  onGetStarted: () => void;
  onDemoChat?: () => void;
}

// Figma design asset URLs
const GOOGLE_LOGO_URL = 'https://www.figma.com/api/mcp/asset/d749a4e2-08f7-4b0f-9874-88fbb9b88f33';

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onGetStarted, onDemoChat }) => {
  const [isLoading, setIsLoading] = useState(false);
  const { setUser, updateFormData } = useOnboarding();
  
  // Detect if we're on mobile (native or web on mobile device)
  const isMobile = Platform.OS === 'ios' || Platform.OS === 'android' || 
    (Platform.OS === 'web' && typeof window !== 'undefined' && window.innerWidth <= 768);

  useEffect(() => {
    // Load Montserrat font from Google Fonts for web
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Check if font is already loaded
      if (!document.querySelector('link[href*="fonts.googleapis.com/css2?family=Montserrat"]')) {
        const link = document.createElement('link');
        link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
    }

    // Check if we're returning from OAuth
    const checkOAuthReturn = async () => {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        
        if (code) {
          console.log('Detected OAuth return with code, processing...');
          try {
            setIsLoading(true);
            const user = await simpleAuthService.signInWithGoogle();
            console.log('OAuth return successful, setting user:', user);
            setUser(user);
            
            // Set default nickname and email in form data
            updateFormData({
              nickname: user.nickname,
              userEmail: user.email,
            });
            
            onGetStarted();
          } catch (error: any) {
            console.error('OAuth return error:', error);
            Alert.alert(
              'Sign In Failed',
              error.message || 'An error occurred during sign in. Please try again.',
              [{ text: 'OK' }]
            );
          } finally {
            setIsLoading(false);
          }
          return;
        }
      }

      // Initialize Google Sign-In (no-op for expo-auth-session, but kept for compatibility)
      const initGoogleSignIn = async () => {
        try {
          console.log('Initializing Google Sign-In...');
          await authService.configure();
          console.log('Google Sign-In configured successfully');
        } catch (error) {
          console.error('Failed to configure Google Sign-In:', error);
        }
      };

      initGoogleSignIn();
    };

    checkOAuthReturn();
  }, [setUser, onGetStarted]);

  const handleGoogleSignIn = async () => {
    console.log('Google Sign-In button pressed');
    try {
      setIsLoading(true);
      console.log('Starting Google Sign-In process...');
      
      if (Platform.OS === 'web') {
        console.log('Using Simple Auth Service for web');
        const user = await simpleAuthService.signInWithGoogle();
        console.log('Google Sign-In successful, setting user:', user);
        setUser(user);
        
        // Set default nickname and email in form data
        updateFormData({
          nickname: user.nickname,
          userEmail: user.email,
        });
        
        onGetStarted();
      } else {
        console.log('Using mobile Google OAuth flow');
        const user = await authService.signInWithGoogle();
        console.log('Google Sign-In successful, setting user:', user);
        setUser(user);
        
        // Set default nickname and email in form data
        updateFormData({
          nickname: user.nickname,
          userEmail: user.email,
        });
        
        onGetStarted();
      }
    } catch (error: any) {
      console.error('Google Sign-In Error:', error);
      Alert.alert(
        'Sign In Failed',
        error.message || 'An error occurred during sign in. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = () => {
    // TODO: Navigate to login screen
    console.log('Login pressed');
  };


  console.log('WelcomeScreen rendering - Platform:', Platform.OS);
  
  return (
    <View style={styles.container}>
      {/* Background Video */}
      <BackgroundVideo />

      {/* Gradient Overlay */}
      <LinearGradient
        colors={['transparent', 'transparent', 'rgba(0,0,0,0.29)']}
        locations={[0, 0.18721, 0.75469]}
        style={styles.gradientOverlay}
      />

        {/* Content */}
        <View style={styles.content}>
          {/* Centered logo and tagline */}
          <View style={styles.topContent}>
            {/* Logo (includes SWELLYO text) */}
            <View style={styles.logoContainer}>
              <Logo size={112} />
            </View>

            {/* Tagline */}
            <RNText style={styles.tagline}>
              Join The Current
            </RNText>
          </View>

          {/* Bottom section with buttons */}
          <View style={styles.bottomContent}>
            {/* Call to Action */}
            <View style={styles.buttonContainer}>
            <TouchableOpacity
              onPress={handleGoogleSignIn}
              disabled={isLoading}
              style={[styles.getStartedButton, isLoading && styles.buttonDisabled]}
              activeOpacity={0.8}
            >
              <View style={styles.buttonContent}>
                <Image
                  source={{ uri: GOOGLE_LOGO_URL }}
                  style={styles.googleIcon}
                  resizeMode="contain"
                />
                <RNText style={styles.getStartedButtonText} numberOfLines={1}>
                  {isLoading ? "Signing in..." : "Continue with Google"}
                </RNText>
              </View>
            </TouchableOpacity>
            
            {/* Demo Chat Button */}
            {onDemoChat && (
              <Button
                title="Demo Chat"
                onPress={onDemoChat}
                style={[styles.getStartedButton, styles.demoButton]}
              />
            )}
            </View>

            {/* Login Prompt */}
            <View style={styles.loginContainer}>
            <Text variant="body" style={styles.loginText}>
              Do you have an account?{' '}
              <TouchableOpacity onPress={handleGoogleSignIn}>
                <Text variant="link" style={styles.loginLink}>
                  {isLoading ? 'Signing in...' : 'Log in'}
                </Text>
              </TouchableOpacity>
            </Text>
            </View>
          </View>
        </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    zIndex: 1,
    position: 'relative',
    justifyContent: 'space-between',
  },
  topContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xxxxl,
  },
  bottomContent: {
    paddingBottom: spacing.lg,
    alignItems: 'center',
    width: '100%',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 0, // No bottom margin - spacing is handled by tagline margin
  },
  tagline: {
    marginTop: 10, // Gap from Figma (10px gap between logo and slogan container)
    color: colors.white,
    textAlign: 'center',
    // Montserrat Bold (700) - Family/Headings from Figma
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontWeight: '700', // Montserrat Bold
    fontSize: 16, // H-5: 16px
    lineHeight: 24, // H-5: 24px line height
  },
  buttonContainer: {
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.md,
  },
  getStartedButton: {
    width: '90%',
    maxWidth: 320,
    minWidth: 280,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#d8dadc',
    borderRadius: 28,
    paddingVertical: 17,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
  },
  googleIcon: {
    width: 18.174,
    height: 19,
    marginRight: 10,
    flexShrink: 0,
  },
  getStartedButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600', // Inter SemiBold
    lineHeight: 20, // 1.25 * 16 = 20
    fontFamily: Platform.OS === 'ios' ? 'Inter-SemiBold' : Platform.OS === 'android' ? 'sans-serif-medium' : Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    flexShrink: 0,
  },
  googleSignInButton: {
    width: '90%',
    maxWidth: 320,
    height: 50,
  },
  loginContainer: {
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  loginText: {
    textAlign: 'center',
    color: colors.white,
  },
  loginLink: {
    color: colors.white,
    textDecorationLine: 'underline',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  demoButton: {
    backgroundColor: '#8B5CF6',
    marginTop: spacing.sm,
  },
}); 