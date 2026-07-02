import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, Alert, Modal } from 'react-native';
import { Text } from '../components/Text';
import { spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import {
  DestinationsCarousel,
  OnboardingDestination,
} from '../components/onboarding/DestinationsCarousel';
import { SkipDisclaimerModal } from '../components/onboarding/SkipDisclaimerModal';
import { ProfileEditDestinationScreen } from '../components/ProfileEditPanel/ProfileEditDestinationScreen';
import { useRegisterOnboardingStep } from '../context/OnboardingStepContext';

interface Props {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

// The edit/add sheet self-animates out over ~320ms; keep the wrapping Modal mounted
// a touch longer so its exit animation isn't cut.
const SHEET_EXIT_MS = 380;

/**
 * Onboarding step 4: trip destinations. Content-only — header, progress bar and Next
 * button are owned by OnboardingScaffold. The add/edit bottom sheet
 * (ProfileEditDestinationScreen) is a full-screen absolute View, so it's wrapped in a
 * React Native Modal to portal it above the scaffold's clipped content host.
 */
export const OnboardingStep4DestinationsScreen: React.FC<Props> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
}) => {
  const [destinations, setDestinations] = useState<OnboardingDestination[]>(
    (initialData.destinations_array || []) as OnboardingDestination[],
  );
  const [sheetVisible, setSheetVisible] = useState(false); // drives the sheet animation
  const [sheetRendered, setSheetRendered] = useState(false); // drives the Modal mount
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [skipModalVisible, setSkipModalVisible] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasDestinations = destinations.length > 0;

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const persist = useCallback(
    (next: OnboardingDestination[]) => {
      setDestinations(next);
      updateFormData({ destinations_array: next });
    },
    [updateFormData],
  );

  const openSheet = (index: number | null) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setEditingIndex(index);
    setSheetRendered(true);
    setSheetVisible(true);
  };

  const closeSheet = () => {
    setSheetVisible(false);
    closeTimerRef.current = setTimeout(() => {
      setSheetRendered(false);
      setEditingIndex(null);
      closeTimerRef.current = null;
    }, SHEET_EXIT_MS);
  };

  const handleAdd = () => openSheet(null);
  const handleEdit = (index: number) => openSheet(index);

  const handleRemove = (index: number) => {
    Alert.alert('Remove destination?', 'This destination will be removed from your list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => persist(destinations.filter((_, i) => i !== index)),
      },
    ]);
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
      persist(destinations.map((d, i) => (i === editingIndex ? newDestination : d)));
    } else {
      persist([...destinations, newDestination]);
    }
    closeSheet();
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

  useRegisterOnboardingStep({
    nextLabel: hasDestinations ? 'Next' : 'Skip',
    canProceed: true,
    onNext: handleNextPress,
    onBack,
  });

  return (
    <>
      <View style={styles.contentRoot}>
        <View style={styles.headerCopy}>
          <Text style={styles.titleAccent}>Where have you traveled?</Text>
          <Text style={styles.subtitle}>
            Give others a look into your travel experience.
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
      </View>

      {/* Bottom sheet — wrapped in a Modal so it renders full-screen above the
          scaffold's clipped content host. Reuses the profile-edit destination sheet. */}
      <Modal
        visible={sheetRendered}
        transparent
        animationType="none"
        onRequestClose={closeSheet}
      >
        <ProfileEditDestinationScreen
          visible={sheetVisible}
          mode={editingIndex !== null ? 'edit' : 'add'}
          destination={editingIndex !== null ? destinations[editingIndex] : null}
          onClose={closeSheet}
          onSave={handleSheetSave}
        />
      </Modal>

      <SkipDisclaimerModal
        visible={skipModalVisible}
        message="Skipping this means we can't match you to other surfers visiting the same places. You can always add destinations later from your profile."
        onConfirmSkip={handleConfirmSkip}
        onCancel={() => setSkipModalVisible(false)}
      />
    </>
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
  carouselContainer: {
    flex: 1,
    justifyContent: 'flex-start',
  },
});

export default OnboardingStep4DestinationsScreen;
