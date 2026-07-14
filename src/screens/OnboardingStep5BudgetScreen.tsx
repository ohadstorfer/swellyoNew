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
  const initialSelection = (initialData.travel_type as BudgetOption | undefined) ?? undefined;
  // The bottom "Select" button picks whichever card is currently centred, so the
  // centred card IS the selection — there is no per-card Select button anymore.
  const [centered, setCentered] = useState<BudgetOption | null>(initialSelection ?? null);

  const handleCenteredCardChange = useCallback((budget: BudgetOption) => {
    setCentered(budget);
  }, []);

  const handleNext = useCallback(() => {
    if (!centered) return;
    updateFormData({ travel_type: centered });
    const data = { ...initialData } as OnboardingData;
    data.travel_type = centered;
    onNext(data);
  }, [centered, initialData, onNext, updateFormData]);

  useRegisterOnboardingStep({
    nextLabel: 'Select',
    canProceed: !!centered,
    onNext: handleNext,
    onBack,
  });

  return (
    <View style={styles.contentRoot}>
      <View style={styles.headerCopy}>
        <Text style={styles.titleAccent} maxFontSizeMultiplier={1.3}>
          Budget Mode
        </Text>
        <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
          How do you like to travel?
        </Text>
      </View>

      <View style={styles.carouselContainer}>
        <BudgetCardsCarousel
          onSelect={() => {}}
          hideSelectButton
          initialSelection={initialSelection}
          onCenteredCardChange={handleCenteredCardChange}
        />
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
