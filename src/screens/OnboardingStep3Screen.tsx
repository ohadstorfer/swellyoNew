import React, { useState } from 'react';
import { View, StyleSheet, Platform, LayoutChangeEvent } from 'react-native';
import { TravelExperienceSlider } from '../components/TravelExperienceSlider';
import { Text } from '../components/Text';
import { spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { useRegisterOnboardingStep } from '../context/OnboardingStepContext';

interface OnboardingStep3ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

/**
 * Onboarding step 3: travel experience slider. Content-only — header, progress bar
 * and Next button are owned by OnboardingScaffold. The slider's available height is
 * measured from its container (onLayout) rather than computed from the screen, since
 * the scaffold already excludes the chrome.
 */
export const OnboardingStep3Screen: React.FC<OnboardingStep3ScreenProps> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
}) => {
  const [formData, setFormData] = useState<OnboardingData>({
    nickname: initialData.nickname || '',
    userEmail: initialData.userEmail || '',
    location: initialData.location || '',
    age: initialData.age || 0,
    boardType: initialData.boardType ?? -1,
    surfLevel: initialData.surfLevel ?? -1,
    travelExperience: initialData.travelExperience ?? 0,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof OnboardingData, string>>>({});
  const [sliderHeight, setSliderHeight] = useState(0);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof OnboardingData, string>> = {};
    if (formData.travelExperience < 0 || isNaN(formData.travelExperience)) {
      newErrors.travelExperience = 'Please select your travel experience';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateForm()) {
      onNext(formData);
    }
  };

  const updateField = (field: keyof OnboardingData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    updateFormData({ [field]: value });
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleTravelExperienceChange = (value: number) => {
    updateField('travelExperience', value);
  };

  useRegisterOnboardingStep({
    nextLabel: 'Next',
    canProceed: true,
    onNext: handleNext,
    onBack,
  });

  const onSliderLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && h !== sliderHeight) setSliderHeight(h);
  };

  return (
    <View style={styles.contentRoot}>
      {/* Title block (cyan accent + bold question) */}
      <View style={styles.titleBlock}>
        <Text style={styles.titleAccent}>Travel Experience</Text>
        <Text style={styles.titleQuestion}>How many surf trips have you taken?</Text>
      </View>

      {/* Slider fills the remaining space; its height is measured for the slider. */}
      <View style={styles.sliderContainer} onLayout={onSliderLayout}>
        {sliderHeight > 0 && (
          <TravelExperienceSlider
            value={formData.travelExperience}
            onValueChange={handleTravelExperienceChange}
            error={errors.travelExperience}
            availableHeight={sliderHeight}
            hideTitle
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  contentRoot: {
    flex: 1,
  },
  titleBlock: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    gap: 14,
  },
  titleAccent: {
    fontSize: 32,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: '#05BCD3',
    textAlign: 'center',
    lineHeight: 38,
  },
  titleQuestion: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: '#333333',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 345,
  },
  sliderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 0,
  },
});
