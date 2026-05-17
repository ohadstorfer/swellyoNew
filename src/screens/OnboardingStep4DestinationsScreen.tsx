import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { useIsDesktopWeb, responsiveWidth } from '../utils/responsive';
import {
  DestinationsCarousel,
  OnboardingDestination,
} from '../components/onboarding/DestinationsCarousel';
import { SkipDisclaimerModal } from '../components/onboarding/SkipDisclaimerModal';
import { ProfileEditDestinationScreen } from '../components/ProfileEditPanel/ProfileEditDestinationScreen';

interface Props {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
  isLoading?: boolean;
}

/**
 * Onboarding step 4: trip destinations.
 *
 * - Carousel of destination cards + "Add Destination" empty card at the end.
 * - Tapping the empty card opens `ProfileEditDestinationScreen` (the same
 *   bottom sheet edit-profile uses) in `add` mode. We reuse it rather than
 *   ship a parallel popup — the Figma layout matches that sheet exactly.
 * - Bottom button toggles between "Skip" (no destinations yet) and "Next"
 *   (≥1 destination). Skip surfaces a disclaimer modal explaining the
 *   matching consequence before letting the user proceed.
 */
export const OnboardingStep4DestinationsScreen: React.FC<Props> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
  isLoading = false,
}) => {
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktopWeb();
  const [destinations, setDestinations] = useState<OnboardingDestination[]>(
    (initialData.destinations_array || []) as OnboardingDestination[],
  );
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [skipModalVisible, setSkipModalVisible] = useState(false);

  const progressBarWidth = isDesktop ? 300 : 237;
  const buttonContainerMaxWidth = isDesktop ? 400 : undefined;
  const buttonWidth = responsiveWidth(90, 280, 320, 0);
  const hasDestinations = destinations.length > 0;

  const persist = useCallback(
    (next: OnboardingDestination[]) => {
      setDestinations(next);
      updateFormData({ destinations_array: next });
    },
    [updateFormData],
  );

  const handleAdd = () => {
    setEditingIndex(null);
    setSheetVisible(true);
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setSheetVisible(true);
  };

  const handleRemove = (index: number) => {
    Alert.alert(
      'Remove destination?',
      'This destination will be removed from your list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => persist(destinations.filter((_, i) => i !== index)),
        },
      ],
    );
  };

  const handleSheetSave = async (saved: {
    country: string;
    area: string[];
    time_in_days: number;
    time_in_text: string;
  }) => {
    const newDestination: OnboardingDestination = {
      country: saved.country,
      area: saved.area,
      time_in_days: saved.time_in_days,
      time_in_text: saved.time_in_text,
    };
    if (editingIndex !== null) {
      const next = destinations.map((d, i) => (i === editingIndex ? newDestination : d));
      persist(next);
    } else {
      persist([...destinations, newDestination]);
    }
    setSheetVisible(false);
    setEditingIndex(null);
  };

  const handleSheetClose = () => {
    setSheetVisible(false);
    setEditingIndex(null);
  };

  const handleNextPress = () => {
    if (hasDestinations) {
      onNext({ ...initialData, destinations_array: destinations } as OnboardingData);
    } else {
      // No destinations — show the disclaimer first.
      setSkipModalVisible(true);
    }
  };

  const handleConfirmSkip = () => {
    setSkipModalVisible(false);
    onNext({ ...initialData, destinations_array: [] } as OnboardingData);
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
          <Text style={styles.titleAccent}>Where have you traveled?</Text>
          <Text style={styles.subtitle}>
            Travelers wanna know what destinations did you experience!
          </Text>
        </View>

        <View style={styles.carouselContainer}>
          <DestinationsCarousel
            destinations={destinations}
            onAdd={handleAdd}
            onEditAt={handleEdit}
            onRemoveAt={handleRemove}
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
            onPress={handleNextPress}
            activeOpacity={0.8}
            disabled={isLoading}
            style={isLoading && styles.buttonDisabled}
          >
            <View style={[styles.primaryButton, { width: buttonWidth }]}>
              <Text style={styles.buttonText}>
                {isLoading ? 'Loading...' : hasDestinations ? 'Next' : 'Skip'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom sheet — covers entire screen with backdrop, slides up from
          bottom. Reuses the profile-edit destination sheet so behavior matches
          the edit-profile flow exactly. */}
      <ProfileEditDestinationScreen
        visible={sheetVisible}
        mode={editingIndex !== null ? 'edit' : 'add'}
        destination={editingIndex !== null ? destinations[editingIndex] : null}
        onClose={handleSheetClose}
        onSave={handleSheetSave}
      />

      <SkipDisclaimerModal
        visible={skipModalVisible}
        message="Skipping this means we can't match you to other surfers visiting the same places. You can always add destinations later from your profile."
        onConfirmSkip={handleConfirmSkip}
        onCancel={() => setSkipModalVisible(false)}
      />
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
    fontWeight: '400',
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
    paddingBottom: spacing.md,
    gap: 8,
  },
  titleAccent: {
    fontSize: 31,
    lineHeight: 37,
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
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  helper: {
    fontSize: 16,
    lineHeight: 24,
    color: '#7B7B7B',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    ...Platform.select({
      web: { fontFamily: 'Inter, sans-serif' },
      default: { fontFamily: 'Inter' },
    }),
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'flex-start',
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

export default OnboardingStep4DestinationsScreen;
