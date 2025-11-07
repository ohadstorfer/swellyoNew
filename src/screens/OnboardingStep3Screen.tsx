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
import { TravelExperienceSlider } from '../components/TravelExperienceSlider';
import { Text } from '../components/Text';
import { colors, spacing, typography } from '../styles/theme';
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
      <View style={styles.gradient}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header with Step Process */}
            <View style={styles.header}>
              <View style={styles.headerContent}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                  <Ionicons name="arrow-back" size={24} color={colors.textDark} />
                </TouchableOpacity>
                
                <View style={styles.stepTextContainer}>
                  <Text style={styles.stepText}>Step 3/5</Text>
                </View>
                
                <TouchableOpacity onPress={handleNext} style={styles.skipButton}>
                  <Text style={styles.skipText}>Skip</Text>
                </TouchableOpacity>
              </View>
              
              {/* Progress Bar */}
              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: '60%' }]} />
                </View>
              </View>
            </View>

            {/* Form Content */}
            <View style={styles.content}>
              <TravelExperienceSlider
                value={formData.travelExperience}
                onValueChange={handleTravelExperienceChange}
                error={errors.travelExperience}
              />
              
              {/* Clickable areas for level navigation */}
              <TouchableOpacity
                style={styles.leftClickArea}
                onPress={() => {
                  const newValue = Math.max(0, formData.travelExperience - 1);
                  handleTravelExperienceChange(newValue);
                }}
                activeOpacity={0.3}
              />
              <TouchableOpacity
                style={styles.rightClickArea}
                onPress={() => {
                  const newValue = Math.min(3, formData.travelExperience + 1);
                  handleTravelExperienceChange(newValue);
                }}
                activeOpacity={0.3}
              />
            </View>

            {/* Next Button */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.nextButton}
                onPress={handleNext}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#00A2B6', '#0788B0']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.buttonGradient}
                >
                  <Text style={styles.buttonText}>Next</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  gradient: {
    flex: 1,
    backgroundColor: '#FAFAFA',
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
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.xxl : spacing.lg,
    paddingBottom: spacing.md,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    height: 24,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  stepTextContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    ...typography.bodySmall,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skipText: {
    ...typography.bodySmall,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  progressContainer: {
    alignItems: 'center',
    width: '100%',
  },
  progressBar: {
    width: 237,
    height: 4,
    backgroundColor: '#BDBDBD',
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#333333',
    borderRadius: 8,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: spacing.xl,
    position: 'relative',
  },
  leftClickArea: {
    position: 'absolute',
    left: 0,
    width: 142,
    top: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  rightClickArea: {
    position: 'absolute',
    right: 0,
    width: 142,
    top: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  buttonContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
  },
  nextButton: {
    width: 330,
    height: 56,
    borderRadius: 999,
    overflow: 'hidden',
    minWidth: 150,
  },
  buttonGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  buttonText: {
    ...typography.button,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 32,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
