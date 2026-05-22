/**
 * Persistent shell for onboarding steps 1–7. Renders the fixed header + Next button
 * once (they never unmount as the user moves between steps) and hosts the active
 * step's content in an animated area between them.
 *
 * AppContent owns the per-step async handlers + form data; it passes a
 * `renderStepContent` callback that returns the right content screen for a step key.
 * Each content screen registers its Next/Back behavior via useRegisterOnboardingStep.
 */
import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../styles/theme';
import { useIsDesktopWeb } from '../../utils/responsive';
import { OnboardingStepProvider } from '../../context/OnboardingStepContext';
import { OnboardingHeader, OnboardingFooter } from './OnboardingChrome';
import { OnboardingContentHost } from './OnboardingContentHost';
import { resolveStepKey, type OnboardingStepKey } from './onboardingStepConfig';

interface Props {
  currentStep: number;
  showVideoUploadStep: boolean;
  /** isLoading for the active step (the relevant isSavingStepN from AppContent). */
  isLoading: boolean;
  /** Returns the content-only screen for a given step key. */
  renderStepContent: (key: OnboardingStepKey) => React.ReactNode;
}

export const OnboardingScaffold: React.FC<Props> = ({
  currentStep,
  showVideoUploadStep,
  isLoading,
  renderStepContent,
}) => {
  const isDesktop = useIsDesktopWeb();
  const stepKey = resolveStepKey(currentStep, showVideoUploadStep);

  // Outside the scaffold's responsibility (steps 0 / -1 are handled by AppContent).
  if (!stepKey) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <OnboardingStepProvider>
        <View style={[styles.body, isDesktop && styles.bodyDesktop]}>
          <OnboardingHeader stepKey={stepKey} />
          <OnboardingContentHost activeStepKey={stepKey} renderStep={renderStepContent} />
          <OnboardingFooter isLoading={isLoading} />
        </View>
      </OnboardingStepProvider>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
  },
  flex: {
    flex: 1,
  },
  // Mirrors the per-screen `content` style so the inner content keeps its insets.
  body: {
    flex: 1,
    paddingHorizontal: Platform.OS !== 'web' ? spacing.md : 0,
  },
  bodyDesktop: {
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 0,
  },
});
