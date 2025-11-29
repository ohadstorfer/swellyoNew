import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  TextInput,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
// @ts-ignore - react-native-keyboard-aware-scroll-view types may not be available
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Svg, { Circle, Rect, Defs, Filter, FeFlood, FeColorMatrix, FeOffset, FeGaussianBlur, FeComposite, FeBlend, Path } from 'react-native-svg';
// Image picker will be conditionally imported
import { Text } from '../components/Text';
import { colors, spacing, typography } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';

interface OnboardingStep4ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
  isLoading?: boolean;
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  width?: number;
  style?: any;
}

// Check Icon Component
const CheckIcon: React.FC<{ size?: number }> = ({ size = 16 }) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M13.3333 4L6 11.3333L2.66667 8"
        stroke="#00A2B6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
};

// Pencil Icon Component - using SVG from public folder
const PencilIcon: React.FC<{ size?: number }> = ({ size = 24 }) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M11.5312 18.5199L11.2583 17.8213L11.5312 18.5199ZM7.47478 19.2988L7.09978 19.9483L7.09978 19.9483L7.47478 19.2988ZM6.12116 15.3964L5.37971 15.5093L6.12116 15.3964ZM6.61146 12.7941L7.26098 13.1691L6.61146 12.7941ZM6.02731 14.0314L5.29028 13.8925H5.29028L6.02731 14.0314ZM13.5397 16.7941L14.1892 17.1691L13.5397 16.7941ZM12.7602 17.9186L13.249 18.4875H13.249L12.7602 17.9186ZM10.4099 6.21503L9.76038 5.84003L10.4099 6.21503ZM17.3381 10.215L16.6886 9.84003L12.8901 16.4191L13.5397 16.7941L14.1892 17.1691L17.9876 10.59L17.3381 10.215ZM6.61146 12.7941L7.26098 13.1691L11.0594 6.59003L10.4099 6.21503L9.76038 5.84003L5.96194 12.4191L6.61146 12.7941ZM11.5312 18.5199L11.2583 17.8213C10.1618 18.2497 9.41502 18.5394 8.83854 18.6741C8.28167 18.8042 8.02898 18.7527 7.84978 18.6493L7.47478 19.2988L7.09978 19.9483C7.75305 20.3255 8.45392 20.3044 9.17981 20.1348C9.88609 19.9698 10.7513 19.6298 11.8041 19.2184L11.5312 18.5199ZM6.12116 15.3964L5.37971 15.5093C5.5499 16.6267 5.68805 17.546 5.89829 18.2402C6.11436 18.9536 6.44651 19.5712 7.09978 19.9483L7.47478 19.2988L7.84978 18.6493C7.67059 18.5458 7.49965 18.3527 7.33389 17.8054C7.16229 17.2388 7.03986 16.4472 6.86261 15.2835L6.12116 15.3964ZM6.61146 12.7941L5.96194 12.4191C5.64012 12.9765 5.38246 13.4033 5.29028 13.8925L6.02731 14.0314L6.76434 14.1702C6.7983 13.99 6.88802 13.8151 7.26098 13.1691L6.61146 12.7941ZM6.12116 15.3964L6.86261 15.2835C6.7503 14.546 6.73039 14.3505 6.76434 14.1702L6.02731 14.0314L5.29028 13.8925C5.1981 14.3817 5.2828 14.873 5.37971 15.5093L6.12116 15.3964ZM13.5397 16.7941L12.8901 16.4191C12.5172 17.0651 12.4105 17.2303 12.2715 17.3498L12.7602 17.9186L13.249 18.4875C13.6266 18.1631 13.8674 17.7265 14.1892 17.1691L13.5397 16.7941ZM11.5312 18.5199L11.8041 19.2184C12.4036 18.9842 12.8714 18.8119 13.249 18.4875L12.7602 17.9186L12.2715 17.3498C12.1324 17.4693 11.953 17.5498 11.2583 17.8213L11.5312 18.5199ZM15.874 4.75093L15.499 5.40045C16.3339 5.88245 16.8939 6.20761 17.2797 6.50537C17.6483 6.78983 17.7658 6.98144 17.8135 7.15945L18.5379 6.96534L19.2623 6.77123C19.0956 6.14904 18.6976 5.70485 18.1961 5.31785C17.7119 4.94416 17.0471 4.56221 16.249 4.10141L15.874 4.75093ZM17.3381 10.215L17.9876 10.59C18.4484 9.79189 18.8331 9.12875 19.0657 8.56299C19.3065 7.97711 19.4291 7.39341 19.2623 6.77123L18.5379 6.96534L17.8135 7.15945C17.8612 7.33747 17.8553 7.56212 17.6783 7.99278C17.493 8.44357 17.1706 9.00517 16.6886 9.84003L17.3381 10.215ZM15.874 4.75093L16.249 4.10141C15.4509 3.6406 14.7877 3.2559 14.222 3.02337C13.6361 2.78257 13.0524 2.65997 12.4302 2.82668L12.6243 3.55113L12.8184 4.27557C12.9964 4.22787 13.2211 4.23376 13.6518 4.41076C14.1025 4.59604 14.6641 4.91844 15.499 5.40045L15.874 4.75093ZM10.4099 6.21503L11.0594 6.59003C11.5414 5.75517 11.8666 5.19516 12.1643 4.80931C12.4488 4.4407 12.6404 4.32327 12.8184 4.27557L12.6243 3.55113L12.4302 2.82668C11.808 2.99339 11.3638 3.39142 10.9768 3.89291C10.6031 4.37716 10.2212 5.04189 9.76038 5.84003L10.4099 6.21503ZM17.3381 10.215L17.7131 9.56551L10.7849 5.56551L10.4099 6.21503L10.0349 6.86455L16.9631 10.8645L17.3381 10.215Z"
        fill="#333333"
      />
    </Svg>
  );
};

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  width,
  style,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const hasValue = value.trim().length > 0;
  const showCheck = hasValue && !isFocused;

  const handleContainerPress = () => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Determine input style based on state
  const inputStyle = hasValue && !isFocused 
    ? styles.fieldInputFilled 
    : styles.fieldInput;

  return (
    <TouchableOpacity
      style={[styles.fieldContainer, width && { width }, style]}
      activeOpacity={1}
      onPress={handleContainerPress}
    >
      {/* Pencil Icon on Left - always shown */}
      <PencilIcon size={24} />
      
      {/* Input Container - Always show TextInput for editing */}
      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={[
            inputStyle,
            Platform.OS === 'web' && styles.fieldInputWeb,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder || label}
          placeholderTextColor={colors.textSecondary}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={true}
          selectTextOnFocus={false}
          clearButtonMode="never"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          blurOnSubmit={true}
        />
      </View>

      {/* Check Icon on Right when field has value and not focused */}
      {showCheck && (
        <View style={styles.checkIconContainer}>
          <CheckIcon size={16} />
        </View>
      )}
    </TouchableOpacity>
  );
};

// Plus Icon SVG Component
const PlusIcon: React.FC<{ size?: number }> = ({ size = 40 }) => {
  const scale = size / 40;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Defs>
        <Filter id={`filter0_d_3645_6670_${size}`} x="0" y="0" width="40" height="40" filterUnits="userSpaceOnUse">
          <FeFlood floodOpacity="0" result="BackgroundImageFix"/>
          <FeColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
          <FeOffset/>
          <FeGaussianBlur stdDeviation="2"/>
          <FeComposite in2="hardAlpha" operator="out"/>
          <FeColorMatrix type="matrix" values="0 0 0 0 0.376471 0 0 0 0 0.396078 0 0 0 0 0.435294 0 0 0 0.45 0"/>
          <FeBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_3645_6670"/>
          <FeBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_3645_6670" result="shape"/>
        </Filter>
      </Defs>
      <Circle cx="20" cy="20" r="16" fill="white" filter={`url(#filter0_d_3645_6670_${size})`}/>
      <Circle cx="20" cy="20" r="13" fill="#00A2B6"/>
      <Rect x="19" y="11" width="2" height="18" rx="1" fill="white"/>
      <Rect x="29" y="19" width="2" height="18" rx="1" transform="rotate(90 29 19)" fill="white"/>
    </Svg>
  );
};

export const OnboardingStep4Screen: React.FC<OnboardingStep4ScreenProps> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
  isLoading = false,
}) => {
  const [profilePicture, setProfilePicture] = useState<string | null>(
    initialData.profilePicture || null
  );
  const [name, setName] = useState<string>(initialData.nickname || '');
  const [location, setLocation] = useState<string>(initialData.location || '');
  const [age, setAge] = useState<string>(
    initialData.age ? initialData.age.toString() : ''
  );

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


  const keyboardAwareScrollViewRef = useRef<any>(null);

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
    };
    onNext(formData);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.contentWrapper}>
          {/* Sticky Header with Gradient */}
          <View style={styles.stickyHeader}>
            <LinearGradient
              colors={[
                colors.backgroundGray, 
                'rgba(250, 250, 250, 0)' // transparent version of backgroundGray
              ]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.headerGradient}
            />
            
            <View style={styles.header}>
              <TouchableOpacity onPress={onBack} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="#222B30" />
              </TouchableOpacity>

              <Text style={styles.stepText}>Step 4/4</Text>

              <View style={styles.skipButton}>
                {/* Skip button is hidden in this step */}
              </View>
            </View>
            
            {/* Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: '100%' }]} />
              </View>
            </View>
          </View>

          <KeyboardAwareScrollView
            ref={keyboardAwareScrollViewRef}
            extraHeight={180}
            enableOnAndroid={true}
            enableAutomaticScroll={true}
            keyboardOpeningTime={0}
            extraScrollHeight={0}
            scrollEventThrottle={0}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >

            {/* Main Container */}
            <View style={styles.mainContainerWrapper}>
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
                      style={styles.profilePicture as any}
                    />
                  ) : (
                    <View style={styles.profilePicturePlaceholder}>
                      <Ionicons name="camera" size={40} color={colors.textSecondary} />
                    </View>
                  )}
                  <View style={styles.editIconContainer}>
                    <PlusIcon size={40} />
                  </View>
                </TouchableOpacity>
                
                {/* Text Container - Missing from design */}
                <View style={styles.textContainer}>
                  <Text style={styles.headingText}>Add a Picture</Text>
                  <Text style={styles.subheadingText}>Let's get to know each other better!</Text>
                </View>
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
                  placeholder="Nickname*"
                  width={357}
                />

                <View style={styles.rowContainer}>
                  <Field
                    label="Location"
                    value={location}
                    onChangeText={(text) => {
                      setLocation(text);
                      updateFormData({ location: text });
                    }}
                    placeholder="Where are you from?*"
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
                    placeholder="Age*"
                    width={118}
                    style={styles.ageField}
                  />
                </View>
              </View>
              </View>
            </View>
          </KeyboardAwareScrollView>

          {/* Next Button - Fixed at bottom, moves up with keyboard */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity 
              onPress={handleNext} 
              activeOpacity={0.8}
              disabled={isLoading}
              style={isLoading && styles.buttonDisabled}
            >
              <LinearGradient
                colors={['#00A2B6', '#0788B0']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Text style={styles.buttonText}>
                  {isLoading ? 'Loading...' : 'Next'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
  },
  contentWrapper: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 100, // Space for button
    paddingTop: 80, // Space for sticky header (header + progress bar + gradient)
  },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    paddingBottom: spacing.md,
    overflow: 'hidden', // ensures gradient stays inside
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    height: 24,
    position: 'relative', // ensures content stays on top of gradient
    zIndex: 1,
  },
  progressContainer: {
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.sm,
    position: 'relative', // ensures content stays on top of gradient
    zIndex: 1,
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
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none', // avoid blocking clicks
  },
  mainContainerWrapper: {
    paddingTop: 0,
    width: '100%',
    alignItems: 'center',
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
  mainContainer: {
    width: 357,
    alignSelf: 'center',
    marginTop: 0,
    gap: 32,
  },
  profilePictureContainer: {
    alignItems: 'center',
    gap: 24,
    paddingTop: 16,
    width: '100%',
  },
  textContainer: {
    alignItems: 'center',
    gap: 4,
    width: '100%',
  },
  headingText: {
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    color: colors.textPrimary,
    textAlign: 'center',
    width: 350,
  },
  subheadingText: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    height: 25,
    width: 351,
  },
  profilePictureWrapper: {
    width: 161.105,
    height: 163,
    borderRadius: 81.5,
    position: 'relative',
    overflow: 'visible',
  },
  profilePicture: {
    width: 161.105,
    height: 163,
    borderRadius: 81.5,
  } as const,
  profilePicturePlaceholder: {
    width: 161.105,
    height: 163,
    borderRadius: 81.5,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editIconContainer: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...(Platform.OS === 'web' && {
      // @ts-ignore
      pointerEvents: 'none' as any,
    }),
  },
  form: {
    gap: 18,
    alignItems: 'stretch',
    width: '100%',
  },
  rowContainer: {
    flexDirection: 'row',
    gap: 27,
    width: '100%',
  },
  fieldContainer: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 12,
    height: 56,
    paddingHorizontal: 16,
    paddingVertical: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
  },
  inputContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    minHeight: 0,
    height: '100%',
  },
  fieldInput: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
    color: colors.textSecondary,
    padding: 0,
    margin: 0,
    width: '100%',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  fieldInputFilled: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.textPrimary,
    padding: 0,
    margin: 0,
    width: '100%',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  fieldInputWeb: {
    // @ts-ignore - web-specific CSS property
    outline: 'none',
  },
  checkIconContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ageField: {
    // Age field specific styles if needed
  },
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.lg,
    paddingTop: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.backgroundGray,
    borderTopWidth: 0,
    ...(Platform.OS === 'web' && {
      position: 'fixed' as any,
      bottom: 0,
      left: 0,
      right: 0,
    }),
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
  buttonDisabled: {
    opacity: 0.6,
  },
});

