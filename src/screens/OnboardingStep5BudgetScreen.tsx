import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { useIsDesktopWeb, responsiveWidth } from '../utils/responsive';
import { BudgetCardsCarousel, BudgetOption } from '../components/BudgetCardsCarousel';

interface Props {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
  isLoading?: boolean;
}

/**
 * Onboarding step 5: budget / travel_type. Reuses the same BudgetCardsCarousel
 * the Swelly chat uses so both entry paths produce the same enum values.
 *
 * Next is always enabled; if the user hasn't picked, we just don't write
 * travel_type — partial save semantics from `saveSurfer` keep the existing
 * value intact.
 */
export const OnboardingStep5BudgetScreen: React.FC<Props> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
  isLoading = false,
}) => {
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktopWeb();
  const [selected, setSelected] = useState<BudgetOption | null>(
    (initialData.travel_type as BudgetOption | undefined) ?? null,
  );

  const progressBarWidth = isDesktop ? 300 : 237;
  const buttonContainerMaxWidth = isDesktop ? 400 : undefined;
  const buttonWidth = responsiveWidth(90, 280, 320, 0);

  const handleSelect = useCallback(
    (budget: BudgetOption) => {
      setSelected(budget);
      updateFormData({ travel_type: budget });
    },
    [updateFormData],
  );

  const handleNext = () => {
    if (!selected) return;
    const data = { ...initialData } as OnboardingData;
    data.travel_type = selected;
    onNext(data);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.content, isDesktop && styles.contentDesktop]}>
        <View style={[styles.header, isDesktop && styles.headerDesktop]}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>
          <Text style={styles.stepText}>Travel Deets 2/3</Text>
          <View style={styles.skipButton} />
        </View>

        <View style={[styles.progressContainer, isDesktop && styles.progressContainerDesktop]}>
          <View style={[styles.progressBar, { width: progressBarWidth }]}>
            <View style={[styles.progressFill, { width: '66.7%' }]} />
          </View>
        </View>

        <View style={styles.headerCopy}>
          <Text style={styles.titleAccent}>Budget Mode</Text>
          <Text style={styles.subtitle}>How do you like to travel?</Text>
        </View>

        <View style={styles.carouselContainer}>
          <BudgetCardsCarousel
            onSelect={handleSelect}
            initialSelection={selected ?? undefined}
          />
        </View>

        <View
          style={[
            styles.buttonContainer,
            isDesktop && styles.buttonContainerDesktop,
            buttonContainerMaxWidth && { maxWidth: buttonContainerMaxWidth },
            { paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          <TouchableOpacity
            onPress={handleNext}
            activeOpacity={0.8}
            disabled={isLoading || !selected}
            style={(isLoading || !selected) && styles.buttonDisabled}
          >
            <View style={[styles.primaryButton, { width: buttonWidth }]}>
              <Text style={styles.buttonText}>{isLoading ? 'Loading...' : 'Next'}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray || '#FAFAFA',
  },
  content: {
    flex: 1,
    paddingHorizontal: Platform.OS !== 'web' ? spacing.md : 0,
  },
  contentDesktop: {
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    height: 44,
  },
  headerDesktop: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    opacity: 0,
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  progressContainerDesktop: {
    paddingBottom: spacing.sm,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#BDBDBD',
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#333333',
    borderRadius: 8,
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
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    width: '100%',
    flexShrink: 0,
  },
  buttonContainerDesktop: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
    alignSelf: 'center',
  },
  primaryButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: '#212121',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: colors.white || '#FFF',
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default OnboardingStep5BudgetScreen;
