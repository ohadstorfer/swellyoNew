import React, { useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../components/Text';
import { colors, spacing, typography } from '../styles/theme';
import { useIsDesktopWeb } from '../utils/responsive';
import { analyticsService } from '../services/analytics/analyticsService';

interface MVPThankYouScreenProps {
  onBackToHomepage: () => void;
}

export const MVPThankYouScreen: React.FC<MVPThankYouScreenProps> = ({ onBackToHomepage }) => {
  const isDesktop = useIsDesktopWeb();

  useEffect(() => {
    // Track event to trigger PostHog survey
    // The survey should be configured in PostHog to trigger on "onboarding_step2_completed" event
    // Since we're using PostHogSurveyProvider, surveys will show automatically when this event is tracked
    console.log('[MVPThankYouScreen] Tracking onboarding_step2_completed to trigger PostHog survey');
    
    // Track the event (it may have been tracked already, but tracking again ensures survey triggers)
    // Use a small delay to ensure PostHog has processed any previous events
    const timer = setTimeout(() => {
      analyticsService.trackOnboardingStep2Completed();
      console.log('[MVPThankYouScreen] Event tracked - PostHog survey should appear if configured');
    }, 500); // Small delay to ensure PostHog is ready

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.content, isDesktop && styles.contentDesktop]}>
        <View style={styles.textContainer}>
          <Text style={styles.title}>Thank You! 🎉</Text>
          <Text style={styles.subtitle}>
            You've completed the onboarding process!
          </Text>
          <Text style={styles.description}>
            We're currently testing the onboarding experience.{'\n'}
            The full app will be available soon.
          </Text>
        </View>
        
        <TouchableOpacity 
          onPress={onBackToHomepage}
          style={styles.button}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#00A2B6', '#0788B0']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradientButton}
          >
            <Text style={styles.buttonText}>Back to Homepage</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  contentDesktop: {
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
    maxWidth: 500,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.brandTeal,
    marginBottom: spacing.md,
    textAlign: 'center',
    fontFamily: Platform.select({
      web: 'Montserrat, sans-serif',
      default: 'Montserrat',
    }),
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
    fontFamily: Platform.select({
      web: 'Montserrat, sans-serif',
      default: 'Montserrat',
    }),
  },
  description: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    fontFamily: Platform.select({
      web: 'Inter, sans-serif',
      default: 'Inter',
    }),
  },
  button: {
    width: '100%',
    maxWidth: 300,
  },
  gradientButton: {
    height: 56,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
    fontFamily: Platform.select({
      web: 'Montserrat, sans-serif',
      default: 'Montserrat',
    }),
  },
});

