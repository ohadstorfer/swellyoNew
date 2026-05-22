import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text } from '../components/Text';
import { spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { BudgetCardsCarousel, BudgetOption } from '../components/BudgetCardsCarousel';
import { useRegisterOnboardingStep } from '../context/OnboardingStepContext';

interface Props {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

/**
 * Onboarding step 5: budget / travel_type. Content-only — the header, progress bar
 * and Next button are owned by OnboardingScaffold. Reuses the same BudgetCardsCarousel
 * the Swelly chat uses so both entry paths produce the same enum values.
 *
 * Next stays disabled until a budget is picked (reported via useRegisterOnboardingStep).
 */
export const OnboardingStep5BudgetScreen: React.FC<Props> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
}) => {
  const [selected, setSelected] = useState<BudgetOption | null>(
    (initialData.travel_type as BudgetOption | undefined) ?? null,
  );

  const handleSelect = useCallback(
    (budget: BudgetOption) => {
      setSelected(budget);
      updateFormData({ travel_type: budget });
    },
    [updateFormData],
  );

  const handleNext = useCallback(() => {
    if (!selected) return;
    const data = { ...initialData } as OnboardingData;
    data.travel_type = selected;
    onNext(data);
  }, [selected, initialData, onNext]);

  useRegisterOnboardingStep({
    nextLabel: 'Next',
    canProceed: !!selected,
    onNext: handleNext,
    onBack,
  });

  return (
    <View style={styles.contentRoot}>
      <View style={styles.headerCopy}>
        <Text style={styles.titleAccent}>Budget Mode</Text>
        <Text style={styles.subtitle}>How do you like to travel?</Text>
      </View>

      <View style={styles.carouselContainer}>
        <BudgetCardsCarousel onSelect={handleSelect} initialSelection={selected ?? undefined} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  contentRoot: {
    flex: 1,
  },
  headerCopy: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: 14,
  },
  titleAccent: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    color: '#05BCD3',
    textAlign: 'center',
    marginBottom: 8,
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  subtitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
  },
});

export default OnboardingStep5BudgetScreen;
