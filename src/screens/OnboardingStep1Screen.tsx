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
import { Input } from '../components/Input';
import { BoardTypeSelector } from '../components/BoardTypeSelector';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';

interface OnboardingStep1ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

export interface SurfLevel {
  id: number;
  description: string;
}

export interface BoardType {
  id: number;
  description: string;
}

export interface OnboardingData {
  nickname: string;
  userEmail: string;
  location: string;
  age: number;
  boardType: number; // Board type selection
  surfLevel: number; // Surf level selection
  travelExperience: number; // Travel experience (0 to infinity)
}

const BOARD_TYPES: BoardType[] = [
  {
    id: 0,
    description: 'Shortboard',
  },
  {
    id: 1,
    description: 'Mid-length',
  },
  {
    id: 2,
    description: 'Longboard',
  },
  {
    id: 3,
    description: 'Soft Top',
  },
];

export const OnboardingStep1Screen: React.FC<OnboardingStep1ScreenProps> = ({
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
    boardType: initialData.boardType ?? -1, // Use -1 to indicate no selection
    surfLevel: initialData.surfLevel ?? -1, // Use -1 to indicate no selection
    travelExperience: initialData.travelExperience ?? 0, // Default to 0
  });

  const [errors, setErrors] = useState<Partial<Record<keyof OnboardingData, string>>>({});

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof OnboardingData, string>> = {};

    if (!formData.nickname.trim()) {
      newErrors.nickname = 'Nickname is required';
    }

    // Email validation not needed since it comes from Google and is not editable

    if (!formData.location.trim()) {
      newErrors.location = 'Location is required';
    }

    if (!formData.age || formData.age < 13 || formData.age > 120) {
      newErrors.age = 'Please enter a valid age (13-120)';
    }

    if (formData.boardType === -1) {
      newErrors.boardType = 'Please select your board type';
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

  const handleAgeChange = (text: string) => {
    const ageNum = parseInt(text) || 0;
    updateField('age', ageNum);
  };

  const handleBoardTypeChange = (type: BoardType) => {
    updateField('boardType', type.id); // Only save the ID
  };

  // Helper function to get the selected BoardType object from ID
  const getSelectedBoardType = (): BoardType | undefined => {
    if (formData.boardType >= 0) {
      return BOARD_TYPES.find(type => type.id === formData.boardType);
    }
    return undefined;
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
                <ProgressBar currentStep={1} totalSteps={4} />
              </View>
            </View>

            {/* Form Content */}
            <View style={styles.content}>
              <Text variant="title" style={styles.screenTitle}>
                Tell us about yourself
              </Text>

              {/* Input Fields */}
              <View style={styles.inputSection}>
                <Input
                  label="Nickname"
                  placeholder="Enter your nickname"
                  value={formData.nickname}
                  onChangeText={(text) => updateField('nickname', text)}
                  error={errors.nickname}
                  required
                />

                <Input
                  label="Email"
                  placeholder="Your email from Google"
                  value={formData.userEmail}
                  onChangeText={(text) => updateField('userEmail', text)}
                  error={errors.userEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={false}
                />

                <View style={styles.row}>
                  <Input
                    label="Where are you from?"
                    placeholder="City, Country"
                    value={formData.location}
                    onChangeText={(text) => updateField('location', text)}
                    error={errors.location}
                    required
                    width="half"
                  />
                  
                  <Input
                    label="Age"
                    placeholder="Age"
                    value={formData.age > 0 ? formData.age.toString() : ''}
                    onChangeText={handleAgeChange}
                    error={errors.age}
                    required
                    width="half"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              {/* Board Type Selection */}
              <BoardTypeSelector
                selectedType={getSelectedBoardType()}
                onSelectType={handleBoardTypeChange}
                error={errors.boardType}
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
  },
  screenTitle: {
    fontSize: 28,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  inputSection: {
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  buttonContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  nextButton: {
    width: '100%',
  },
}); 