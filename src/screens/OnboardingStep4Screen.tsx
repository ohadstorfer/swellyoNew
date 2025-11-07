import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  TextInput,
  Image,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
// Image picker will be conditionally imported
import { Text } from '../components/Text';
import { colors, spacing, typography } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';

interface OnboardingStep4ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  width?: number;
  style?: any;
}

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  width,
  style,
}) => {
  return (
    <View style={[styles.fieldContainer, width && { width }, style]}>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor={colors.textSecondary}
      />
    </View>
  );
};

export const OnboardingStep4Screen: React.FC<OnboardingStep4ScreenProps> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
}) => {
  const [profilePicture, setProfilePicture] = useState<string | null>(
    initialData.profilePicture || null
  );
  const [name, setName] = useState<string>(initialData.nickname || '');
  const [location, setLocation] = useState<string>(initialData.location || '');
  const [age, setAge] = useState<string>(
    initialData.age ? initialData.age.toString() : ''
  );
  const [pronouns, setPronouns] = useState<string>(initialData.pronouns || '');

  const pickImage = async () => {
    if (Platform.OS === 'web') {
      // For web, use a file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event: any) => {
            const imageUri = event.target.result;
            setProfilePicture(imageUri);
            updateFormData({ profilePicture: imageUri });
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    } else {
      // For native, try to use expo-image-picker if available
      try {
        const ImagePicker = require('expo-image-picker');
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          alert('Sorry, we need camera roll permissions!');
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 1,
        });

        if (!result.canceled && result.assets[0]) {
          const imageUri = result.assets[0].uri;
          setProfilePicture(imageUri);
          updateFormData({ profilePicture: imageUri });
        }
      } catch (error) {
        console.warn('expo-image-picker not available, please install it for native image picking');
        alert('Image picker not available. Please install expo-image-picker for native platforms.');
      }
    }
  };

  const handleNext = () => {
    const formData: OnboardingData = {
      nickname: name,
      userEmail: initialData.userEmail || '',
      location: location,
      age: parseInt(age) || 0,
      boardType: initialData.boardType ?? 0,
      surfLevel: initialData.surfLevel ?? -1,
      travelExperience: initialData.travelExperience ?? 0,
      profilePicture: profilePicture || undefined,
      pronouns: pronouns || undefined,
    };
    onNext(formData);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>

          <Text style={styles.stepText}>Step 4/5</Text>

          <View style={styles.skipButton}>
            {/* Skip button is hidden in this step */}
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '80%' }]} />
          </View>
        </View>

        {/* Main Container */}
        <View style={styles.mainContainer}>
          {/* Profile Picture Container */}
          <View style={styles.profilePictureContainer}>
            <TouchableOpacity
              onPress={pickImage}
              style={styles.profilePictureWrapper}
            >
              {profilePicture ? (
                <Image
                  source={{ uri: profilePicture }}
                  style={styles.profilePicture}
                />
              ) : (
                <View style={styles.profilePicturePlaceholder}>
                  <Ionicons name="camera" size={40} color={colors.textSecondary} />
                </View>
              )}
              <View style={styles.editIconContainer}>
                <View style={styles.editIcon}>
                  <Ionicons name="pencil" size={16} color="#333333" />
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Field
              label="Name"
              value={name}
              onChangeText={(text) => {
                setName(text);
                updateFormData({ nickname: text });
              }}
              placeholder="Jake Glaser"
              width={354}
            />

            <View style={styles.rowContainer}>
              <Field
                label="Location"
                value={location}
                onChangeText={(text) => {
                  setLocation(text);
                  updateFormData({ location: text });
                }}
                placeholder="Los Angeles, CA"
                width={212}
              />
              <Field
                label="Age"
                value={age}
                onChangeText={(text) => {
                  setAge(text);
                  const ageNum = parseInt(text) || 0;
                  updateFormData({ age: ageNum });
                }}
                placeholder="40"
                width={115}
                style={styles.ageField}
              />
            </View>

            <View style={styles.rowContainer}>
              <Field
                label="Pronouns"
                value={pronouns}
                onChangeText={(text) => {
                  setPronouns(text);
                  updateFormData({ pronouns: text });
                }}
                placeholder="He/Him"
                width={212}
              />
            </View>
          </View>
        </View>

        {/* Next Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity onPress={handleNext} activeOpacity={0.8}>
            <LinearGradient
              colors={['#00A2B6', '#0788B0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradientButton}
            >
              <Text style={styles.buttonText}>Next</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    height: 44,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  progressBar: {
    width: 237,
    height: 4,
    backgroundColor: colors.progressBackground,
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.progressFill,
    borderRadius: 8,
  },
  mainContainer: {
    width: 354,
    alignSelf: 'center',
    marginTop: spacing.xxl,
    gap: 35,
  },
  profilePictureContainer: {
    alignItems: 'center',
    gap: 24,
  },
  profilePictureWrapper: {
    width: 162,
    height: 162,
    borderRadius: 81,
    position: 'relative',
    overflow: 'hidden',
  },
  profilePicture: {
    width: 162,
    height: 162,
    borderRadius: 81,
  },
  profilePicturePlaceholder: {
    width: 162,
    height: 162,
    borderRadius: 81,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    gap: 24,
    alignItems: 'flex-end',
  },
  rowContainer: {
    flexDirection: 'row',
    gap: 24,
    width: '100%',
  },
  fieldContainer: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    height: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  fieldInput: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 22,
    color: colors.textSecondary,
    flex: 1,
  },
  ageField: {
    // Age field specific styles if needed
  },
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
  gradientButton: {
    width: 330,
    height: 56,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: colors.white,
    textAlign: 'center',
    lineHeight: 32,
  },
});

