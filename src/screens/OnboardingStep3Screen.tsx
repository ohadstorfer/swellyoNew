import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ProgressBar } from '../components/ProgressBar';
import { TravelExperienceSlider } from '../components/TravelExperienceSlider';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';

interface OnboardingStep3ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

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
    travelExperience: initialData.travelExperience ?? 0, // Default to 0
  });

  const [errors, setErrors] = useState<Partial<Record<keyof OnboardingData, string>>>({});

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof OnboardingData, string>> = {};

    if (formData.travelExperience < 0) {
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
    setFormData(prev => ({ ...prev, [field]: value }));
    // Also update the context immediately
    updateFormData({ [field]: value });
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const handleTravelExperienceChange = (value: number) => {
    updateField('travelExperience', value);
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[colors.backgroundLight, colors.backgroundMedium]}
        style={styles.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onBack} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color={colors.textDark} />
              </TouchableOpacity>
              
              <View style={styles.headerCenter}>
                <ProgressBar currentStep={3} totalSteps={4} />
              </View>
            </View>

            {/* Form Content */}
            <View style={styles.content}>
              {/* Travel Experience Selection */}
              <TravelExperienceSlider
                value={formData.travelExperience}
                onValueChange={handleTravelExperienceChange}
                error={errors.travelExperience}
              />
            </View>

            {/* Next Button */}
            <View style={styles.buttonContainer}>
              <Button
                title="Next"
                onPress={handleNext}
                style={styles.nextButton}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'web' ? spacing.xxl : spacing.lg,
    paddingBottom: spacing.md,
  },
  backButton: {
    padding: spacing.sm,
    marginRight: spacing.md,
  },
  headerCenter: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  buttonContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  nextButton: {
    width: '100%',
  },
});
