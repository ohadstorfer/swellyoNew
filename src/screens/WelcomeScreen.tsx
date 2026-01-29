import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Image,
  Text as RNText,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Logo } from '../components/Logo';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { BackgroundVideo } from '../components/BackgroundVideo';
import { colors, spacing } from '../styles/theme';
import { authService } from '../services/auth/authService';
import { simpleAuthService } from '../services/auth/simpleAuthService';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import { isSupabaseConfigured } from '../config/supabase';
import { useOnboarding } from '../context/OnboardingContext';
import { getImageUrl } from '../services/media/imageService';
import { useIsMobile, responsiveWidth } from '../utils/responsive';

interface WelcomeScreenProps {
  onGetStarted: () => void;
  onDemoChat?: () => void | Promise<void>;
  isCheckingAuth?: boolean;
}

// Google logo path from public/welcome page folder
const GOOGLE_LOGO_PATH = '/welcome page/Google logo.svg';

// Google Icon Component with fallback
const GoogleIcon: React.FC = () => {
  const [imageError, setImageError] = React.useState(false);
  
  // Get the Google logo URL using the image utility for proper platform handling
  const googleLogoUrl = React.useMemo(() => getImageUrl(GOOGLE_LOGO_PATH), []);

  if (imageError) {
    // Fallback: Simple "G" text
    return (
      <View style={styles.googleIconFallback}>
        <RNText style={styles.googleIconText}>G</RNText>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: googleLogoUrl }}
      style={styles.googleIcon}
      resizeMode="contain"
      onError={(error) => {
        console.warn('Failed to load Google icon, using fallback:', error);
        setImageError(true);
      }}
    />
  );
};

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onGetStarted, onDemoChat, isCheckingAuth = false }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const { setUser, updateFormData, checkOnboardingStatus, isComplete, isDemoUser, setIsDemoUser, resetOnboarding, setCurrentStep, user } = useOnboarding();
  
  // Use responsive hook for accurate mobile detection
  const isMobile = useIsMobile();
  
  // Calculate responsive button width
  const buttonWidth = responsiveWidth(90, 280, 320, 0);

  // Spinning animation for logo when checking auth
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isCheckingAuth) {
      // Start spinning animation
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      // Stop spinning animation
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
    }
  }, [isCheckingAuth, spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

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

    // Check for existing session and OAuth return
    const checkAuthState = async () => {
      // Don't auto-sign-in if user is explicitly null (e.g., after logout)
      if (user === null && !isDemoUser) {
        console.log('User is null, skipping auto-sign-in (likely after logout)');
        return;
      }
      
      // First, check if we have an existing Supabase session
      if (isSupabaseConfigured()) {
        try {
          const supabaseUser = await supabaseAuthService.getCurrentUser();
          if (supabaseUser) {
            console.log('Found existing Supabase session, user:', supabaseUser);
            // Convert Supabase user (id: string) to legacy format (id: number)
            const legacyUser = {
              id: parseInt(supabaseUser.id.replace(/-/g, '').substring(0, 15), 16) || Date.now(),
              email: supabaseUser.email,
              nickname: supabaseUser.nickname,
              googleId: supabaseUser.googleId || supabaseUser.id,
              createdAt: supabaseUser.createdAt,
              updatedAt: supabaseUser.updatedAt,
            };
            setUser(legacyUser);
            updateFormData({
              nickname: supabaseUser.nickname,
              userEmail: supabaseUser.email,
            });
            
            // Identify user with PostHog when session is restored
            const { analyticsService } = await import('../services/analytics/analyticsService');
            const userId = legacyUser.id.toString();
            const userProperties = {
              $email: supabaseUser.email,
              $name: supabaseUser.nickname || supabaseUser.email?.split('@')[0] || 'User',
              email: supabaseUser.email,
              name: supabaseUser.nickname || supabaseUser.email?.split('@')[0] || 'User',
            };
            analyticsService.identify(userId, userProperties);
            console.log('[WelcomeScreen] User identified with PostHog after session restoration:', userId);
            
            // Check if user has finished onboarding before navigating
            const hasFinishedOnboarding = await checkOnboardingStatus();
            if (!hasFinishedOnboarding) {
              onGetStarted();
            }
            // If hasFinishedOnboarding is true, isComplete will be set and AppContent will show homepage
            return; // Don't proceed with OAuth flow if we already have a session
          }
        } catch (error) {
          console.log('No existing Supabase session:', error);
        }
      }

      // Check if we're returning from OAuth (for Supabase web flow)
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
        // Check for Supabase OAuth return (access_token in hash)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        
        if (accessToken && isSupabaseConfigured()) {
          console.log('Detected Supabase OAuth return, processing session...');
          try {
            setIsLoading(true);
            // The session should already be set by Supabase, just get the user
            const supabaseUser = await supabaseAuthService.getCurrentUser();
            if (supabaseUser) {
              console.log('Supabase OAuth return successful, setting user:', supabaseUser);
              // Convert Supabase user (id: string) to legacy format (id: number)
              const legacyUser = {
                id: parseInt(supabaseUser.id.replace(/-/g, '').substring(0, 15), 16) || Date.now(),
                email: supabaseUser.email,
                nickname: supabaseUser.nickname,
                googleId: supabaseUser.googleId || supabaseUser.id,
                createdAt: supabaseUser.createdAt,
                updatedAt: supabaseUser.updatedAt,
              };
              setUser(legacyUser);
              updateFormData({
                nickname: supabaseUser.nickname,
                userEmail: supabaseUser.email,
              });
              
              // Identify user with PostHog after OAuth return
              const { analyticsService } = await import('../services/analytics/analyticsService');
              const userId = legacyUser.id.toString();
              const userProperties = {
                $email: supabaseUser.email,
                $name: supabaseUser.nickname || supabaseUser.email?.split('@')[0] || 'User',
                email: supabaseUser.email,
                name: supabaseUser.nickname || supabaseUser.email?.split('@')[0] || 'User',
              };
              analyticsService.identify(userId, userProperties);
              console.log('[WelcomeScreen] User identified with PostHog after OAuth return:', userId);
              
              // Clean up the URL hash
              window.history.replaceState({}, document.title, window.location.pathname);
              
              // Check if user has finished onboarding before navigating
              const hasFinishedOnboarding = await checkOnboardingStatus();
              if (!hasFinishedOnboarding) {
                onGetStarted();
              }
              // If hasFinishedOnboarding is true, isComplete will be set and AppContent will show homepage
              return;
            }
          } catch (error: any) {
            console.error('Supabase OAuth return error:', error);
            // Clean up the URL even on error
            window.history.replaceState({}, document.title, window.location.pathname);
          } finally {
            setIsLoading(false);
          }
        }

        // Check for legacy OAuth return (code in query params)
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        
        if (code && !isSupabaseConfigured()) {
          console.log('Detected legacy OAuth return with code, processing...');
          try {
            setIsLoading(true);
            const user = await simpleAuthService.signInWithGoogle();
            console.log('Legacy OAuth return successful, setting user:', user);
            setUser(user);
            
            // Set default nickname and email in form data
            updateFormData({
              nickname: user.nickname,
              userEmail: user.email,
            });
            
            // Identify user with PostHog after legacy OAuth return
            const { analyticsService } = await import('../services/analytics/analyticsService');
            const userId = user.id.toString();
            const userProperties = {
              $email: user.email,
              $name: user.nickname || user.email?.split('@')[0] || 'User',
              email: user.email,
              name: user.nickname || user.email?.split('@')[0] || 'User',
            };
            analyticsService.identify(userId, userProperties);
            console.log('[WelcomeScreen] User identified with PostHog after legacy OAuth return:', userId);
            
            onGetStarted();
          } catch (error: any) {
            console.error('Legacy OAuth return error:', error);
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

    checkAuthState();
  }, [setUser, onGetStarted, updateFormData]);

  const handleGoogleSignIn = async () => {
    console.log('Google Sign-In button pressed');
    try {
      setIsLoading(true);
      
      // Check if there's any existing user session and log out first
      const hasExistingSession = user !== null || isDemoUser;
      
      if (hasExistingSession) {
        console.log('Existing user session detected, logging out before Google sign-in...');
        try {
          // Use centralized logout function to ensure all state is cleared
          const { performLogout } = await import('../utils/logout');
          const logoutResult = await performLogout({
            resetOnboarding,
            setUser,
            setCurrentStep: (step: number) => {
              // Don't navigate yet, we'll navigate after sign-in
              // But still update the step internally if needed
              if (step === -1) {
                // WelcomeScreen is already showing, no need to navigate
              }
            },
            setIsDemoUser,
          });
          
          if (logoutResult.success) {
            console.log('User logged out successfully before new sign-in');
          } else {
            console.error('Error during logout before sign-in:', logoutResult.error);
            // Continue with sign-in even if logout fails
          }
        } catch (logoutError) {
          console.error('Error logging out user:', logoutError);
          // Continue with Google sign-in even if logout fails
        }
      }
      
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
        
        // Identify user with PostHog after Google sign-in (web)
        const { analyticsService } = await import('../services/analytics/analyticsService');
        const userId = user.id.toString();
        const userProperties = {
          $email: user.email,
          $name: user.nickname || user.email?.split('@')[0] || 'User',
          email: user.email,
          name: user.nickname || user.email?.split('@')[0] || 'User',
        };
        analyticsService.identify(userId, userProperties);
        console.log('[WelcomeScreen] User identified with PostHog after Google sign-in (web):', userId);
        
        // Check if user has finished onboarding before navigating
        const hasFinishedOnboarding = await checkOnboardingStatus();
        if (!hasFinishedOnboarding) {
          onGetStarted(); // Only navigate to onboarding if not complete
        }
        // If complete, don't call onGetStarted() - AppContent will show ConversationsScreen
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
        
        // Identify user with PostHog after Google sign-in (mobile)
        const { analyticsService } = await import('../services/analytics/analyticsService');
        const userId = user.id.toString();
        const userProperties = {
          $email: user.email,
          $name: user.nickname || user.email?.split('@')[0] || 'User',
          email: user.email,
          name: user.nickname || user.email?.split('@')[0] || 'User',
        };
        analyticsService.identify(userId, userProperties);
        console.log('[WelcomeScreen] User identified with PostHog after Google sign-in (mobile):', userId);
        
        // Check if user has finished onboarding before navigating
        const hasFinishedOnboarding = await checkOnboardingStatus();
        if (!hasFinishedOnboarding) {
          onGetStarted(); // Only navigate to onboarding if not complete
        }
        // If complete, don't call onGetStarted() - AppContent will show ConversationsScreen
      }
    } catch (error: any) {
      console.error('Google Sign-In Error:', error);
      const errorMessage = error?.message || 'An error occurred during sign in. Please try again.';
      
      // Check if it's a database error and provide specific guidance
      if (errorMessage.includes('Database error') || errorMessage.includes('Database Error')) {
        Alert.alert(
          'Database Error During Sign-In',
          'There was an error creating your user account in the database.\n\n' +
          'This usually happens when:\n' +
          '• A database trigger is failing\n' +
          '• Required fields are missing\n' +
          '• Row Level Security policies are blocking the operation\n\n' +
          'Please contact support or check your Supabase database configuration.',
          [{ text: 'OK' }]
        );
      } else if (errorMessage.includes('server_error')) {
        Alert.alert(
          'Sign In Configuration Error',
          'There seems to be a configuration issue with Google sign-in.\n\n' +
          'Please check:\n' +
          '• Supabase redirect URLs are configured correctly\n' +
          '• Google OAuth is properly set up in Supabase\n' +
          '• The redirect URL matches your current domain\n\n' +
          'If you\'re a developer, check the Supabase dashboard settings.',
          [{ text: 'OK' }]
        );
      } else if (errorMessage.includes('access_denied')) {
        Alert.alert(
          'Sign In Cancelled',
          'You cancelled the sign-in process. Please try again when ready.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Sign In Failed',
          errorMessage,
          [{ text: 'OK' }]
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = () => {
    // TODO: Navigate to login screen
    console.log('Login pressed');
  };

  const handleDemoChat = async () => {
    if (!onDemoChat || isDemoLoading) return;
    
    try {
      setIsDemoLoading(true);
      // Call the demo chat handler (it's async and will navigate to onboarding)
      await onDemoChat();
    } catch (error: any) {
      console.error('Error in demo chat:', error);
      Alert.alert('Error', 'Failed to start demo. Please try again.');
      setIsDemoLoading(false);
    }
    // Note: We don't set isDemoLoading to false here because navigation happens
    // The component will unmount when navigating to onboarding
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
            {/* Logo - only icon spins, text stays static */}
            <Logo 
              size={112} 
              iconWrapperStyle={isCheckingAuth ? { transform: [{ rotate: spin }] } : undefined}
            />

            {/* Tagline */}
            <RNText style={styles.tagline}>
              Join The Current
            </RNText>
          </View>

          {/* Bottom section with buttons */}
          <View style={styles.bottomContent}>
            {/* Call to Action */}
            <View style={styles.buttonContainer}>
            {!isCheckingAuth && (
              <TouchableOpacity
                onPress={handleGoogleSignIn}
                disabled={isLoading}
                style={[styles.getStartedButton, { width: buttonWidth }, isLoading && styles.buttonDisabled]}
                activeOpacity={0.8}
              >
                <View style={styles.buttonContent}>
                  <GoogleIcon />
                  <RNText style={styles.getStartedButtonText} numberOfLines={1}>
                    {isLoading ? "Signing in..." : "Continue with Google"}
                  </RNText>
                </View>
              </TouchableOpacity>
            )}
            
            {/* Demo Chat Button */}
            {onDemoChat && (
              <TouchableOpacity
                onPress={handleDemoChat}
                disabled={isDemoLoading || isLoading}
                style={[
                  styles.getStartedButton, 
                  { width: buttonWidth }, 
                  styles.demoButton,
                  (isDemoLoading || isLoading) && styles.buttonDisabled
                ]}
                activeOpacity={0.8}
              >
                <RNText style={styles.getStartedButtonText} numberOfLines={1}>
                  {isDemoLoading ? "Loading..." : "Demo"}
                </RNText>
              </TouchableOpacity>
            )}
            </View>

            {/* Login Prompt */}
            {/* <View style={styles.loginContainer}>
              <Text variant="body" style={styles.loginText}>
                Do you have an account?{' '}
                <TouchableOpacity onPress={handleGoogleSignIn}>
                  <Text variant="link" style={styles.loginLink}>
                    {isLoading ? 'Signing in...' : 'Log in'}
                  </Text>
                </TouchableOpacity>
              </Text>
            </View> */}
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
    marginBottom: spacing.xl,
  },
  getStartedButton: {
    // Width is set dynamically via inline style using responsiveWidth
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
    ...(Platform.OS === 'web' && {
      objectFit: 'contain' as any,
      display: 'block' as any,
    }),
  },
  googleIconFallback: {
    width: 18.174,
    height: 19,
    marginRight: 10,
    flexShrink: 0,
    backgroundColor: '#4285F4',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  getStartedButtonText: {
    textAlign: 'center',
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
    paddingBottom: spacing.md,
  },
  loginContainer: {
    alignItems: 'center',
    marginTop: spacing.sm,
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