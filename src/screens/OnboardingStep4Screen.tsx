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
import { TextInput as PaperTextInput } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
// @ts-ignore - react-native-keyboard-aware-scroll-view types may not be available
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Svg, { Circle, Rect, Defs, Filter, FeFlood, FeColorMatrix, FeOffset, FeGaussianBlur, FeComposite, FeBlend, Path } from 'react-native-svg';
// Platform-specific wrapper - automatically uses .native.tsx on native and .web.tsx on web
import { CountryPicker, Country, CountryCode } from '../components/CountryPickerWrapper';
// Image picker will be conditionally imported
import { Text } from '../components/Text';
import { colors, spacing, typography } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { uploadProfileImage } from '../services/storage/storageService';
import { supabase } from '../config/supabase';

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
  keyboardType?: 'default' | 'numeric' | 'number-pad' | 'phone-pad';
  numericOnly?: boolean;
}

interface CountryFieldProps {
  label: string;
  value: string;
  onSelect: (countryName: string) => void;
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
  keyboardType = 'default',
  numericOnly = false,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<any>(null);
  const hasValue = value.trim().length > 0;
  const showCheck = hasValue && !isFocused;

  const handleContainerPress = () => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Handle text change with numeric filtering if needed
  const handleTextChange = (text: string) => {
    if (numericOnly) {
      // Only allow digits
      const numericText = text.replace(/[^0-9]/g, '');
      onChangeText(numericText);
    } else {
      onChangeText(text);
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
      
      {/* Input Container - Use React Native Paper TextInput */}
      <View style={styles.inputContainer}>
        <PaperTextInput
          ref={inputRef}
          mode="flat"
        value={value}
          onChangeText={handleTextChange}
        placeholder={placeholder || label}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={true}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType}
          returnKeyType="next"
          blurOnSubmit={true}
          dense={false}
          style={[
            styles.paperTextInput,
            inputStyle,
            Platform.OS === 'web' && styles.fieldInputWeb,
            {
              // fontSize and lineHeight come from inputStyle (fieldInputFilled or fieldInput)
              color: hasValue && !isFocused ? colors.textPrimary : colors.textSecondary,
            },
          ]}
          contentStyle={[
            styles.paperTextInputContent,
            {
              // fontSize and lineHeight come from inputStyle (fieldInputFilled or fieldInput)
              color: hasValue && !isFocused ? colors.textPrimary : colors.textSecondary,
            },
          ]}
          underlineColor="transparent"
          activeUnderlineColor="transparent"
          selectionColor={colors.primary || '#00A2B6'}
          placeholderTextColor={colors.textSecondary}
          theme={{
            colors: {
              primary: colors.primary || '#00A2B6',
              text: hasValue && !isFocused ? colors.textPrimary : colors.textSecondary,
              placeholder: colors.textSecondary,
              background: 'transparent',
              onSurface: hasValue && !isFocused ? colors.textPrimary : colors.textSecondary,
            },
          }}
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

// Comprehensive country list for web
const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Argentina', 'Australia', 'Austria',
  'Bahrain', 'Bangladesh', 'Belgium', 'Brazil', 'Bulgaria', 'Canada',
  'Chile', 'China', 'Colombia', 'Croatia', 'Czech Republic', 'Denmark',
  'Egypt', 'Estonia', 'Finland', 'France', 'Germany', 'Greece',
  'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Ireland',
  'Israel', 'Italy', 'Japan', 'Jordan', 'Kenya', 'Kuwait',
  'Latvia', 'Lebanon', 'Lithuania', 'Luxembourg', 'Malaysia', 'Mexico',
  'Morocco', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Oman',
  'Pakistan', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar',
  'Romania', 'Russia', 'Saudi Arabia', 'Singapore', 'Slovakia', 'Slovenia',
  'South Africa', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'Taiwan',
  'Thailand', 'Turkey', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Vietnam', 'Yemen'
].sort();

// Country Field Component - matches Field styling but uses CountryPicker (native) or custom dropdown (web)
const CountryField: React.FC<CountryFieldProps> = ({
  label,
  value,
  onSelect,
  placeholder,
  width,
  style,
}) => {
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [countryCode, setCountryCode] = useState<any>('US');
  const hasValue = value.trim().length > 0;
  const showCheck = hasValue;

  // Try to find country code from country name
  const getCountryCodeFromName = (countryName: string): string => {
    const nameToCode: Record<string, string> = {
      'United States': 'US', 'United Kingdom': 'GB', 'Canada': 'CA',
      'Australia': 'AU', 'Germany': 'DE', 'France': 'FR', 'Spain': 'ES',
      'Italy': 'IT', 'Japan': 'JP', 'China': 'CN', 'India': 'IN',
      'Brazil': 'BR', 'Mexico': 'MX', 'Netherlands': 'NL', 'Sweden': 'SE',
      'Norway': 'NO', 'Denmark': 'DK', 'Finland': 'FI', 'Poland': 'PL',
      'Portugal': 'PT', 'Greece': 'GR', 'Ireland': 'IE', 'Switzerland': 'CH',
      'Austria': 'AT', 'Belgium': 'BE', 'New Zealand': 'NZ', 'South Africa': 'ZA',
      'Argentina': 'AR', 'Chile': 'CL', 'Colombia': 'CO', 'Peru': 'PE',
      'Israel': 'IL', 'Turkey': 'TR', 'Russia': 'RU', 'South Korea': 'KR',
      'Thailand': 'TH', 'Indonesia': 'ID', 'Philippines': 'PH', 'Vietnam': 'VN',
      'Singapore': 'SG', 'Malaysia': 'MY',
    };
    return nameToCode[countryName] || 'US';
  };

  // Initialize country code from value if available
  React.useEffect(() => {
    if (value && value.trim().length > 0 && Platform.OS !== 'web') {
      const code = getCountryCodeFromName(value);
      setCountryCode(code);
    }
  }, [value]);

  // Web-specific handlers
  const filteredCountries = COUNTRIES.filter(country =>
    country.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleWebSelect = (countryName: string) => {
    onSelect(countryName);
    setIsPickerVisible(false);
    setSearchQuery('');
  };

  // Native-specific handler
  const handleNativeSelect = (country: any) => {
    setCountryCode(country.cca2);
    const countryName = typeof country.name === 'string' 
      ? country.name 
      : country.name?.common || 'Unknown';
    onSelect(countryName);
    setIsPickerVisible(false);
  };

  // Determine text style based on state
  const textStyle = hasValue 
    ? styles.fieldInputFilled 
    : styles.fieldInput;

  // Web implementation
  if (Platform.OS === 'web') {
    return (
      <>
        <TouchableOpacity
          style={[styles.fieldContainer, width && { width }, style]}
          activeOpacity={0.7}
          onPress={() => setIsPickerVisible(true)}
        >
          <PencilIcon size={24} />
          <View style={styles.inputContainer}>
            <Text
              style={[textStyle, styles.fieldInputWeb]}
              numberOfLines={1}
            >
              {hasValue ? value : (placeholder || label)}
            </Text>
          </View>
          {showCheck && (
            <View style={styles.checkIconContainer}>
              <CheckIcon size={16} />
            </View>
          )}
        </TouchableOpacity>

        {/* Web Modal */}
        {isPickerVisible && (
          <TouchableOpacity
            style={styles.webModalOverlay}
            activeOpacity={1}
            onPress={() => {
              setIsPickerVisible(false);
              setSearchQuery('');
            }}
          >
            <TouchableOpacity
              style={styles.webModalContent}
              activeOpacity={1}
              onPress={(e) => {
                // Prevent closing when clicking inside the modal
                e.stopPropagation();
              }}
            >
              <View style={styles.webModalHeader}>
                <Text style={styles.webModalTitle}>Select Country</Text>
                <TouchableOpacity
                  onPress={() => {
                    setIsPickerVisible(false);
                    setSearchQuery('');
                  }}
                  style={styles.webModalCloseButton}
                >
                  <Ionicons name="close" size={24} color="#333" />
                </TouchableOpacity>
              </View>
              
              <TextInput
                style={styles.webSearchInput}
                placeholder="Search countries..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />

              <View style={styles.webCountryList}>
                {filteredCountries.map((country) => (
                  <TouchableOpacity
                    key={country}
                    style={[
                      styles.webCountryItem,
                      value === country && styles.webCountryItemSelected,
                    ]}
                    onPress={() => handleWebSelect(country)}
                  >
                    <Text
                      style={[
                        styles.webCountryText,
                        value === country && styles.webCountryTextSelected,
                      ]}
                    >
                      {country}
                    </Text>
                  </TouchableOpacity>
                ))}
                {filteredCountries.length === 0 && (
                  <Text style={styles.webNoResults}>No countries found</Text>
                )}
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      </>
    );
  }

  // Native implementation
  if (!CountryPicker) {
    // Fallback if CountryPicker is not available
    return (
      <TouchableOpacity
        style={[styles.fieldContainer, width && { width }, style]}
        activeOpacity={0.7}
      >
        <PencilIcon size={24} />
        <View style={styles.inputContainer}>
          <Text
            style={[textStyle]}
            numberOfLines={1}
          >
            {hasValue ? value : (placeholder || label)}
          </Text>
        </View>
        {showCheck && (
          <View style={styles.checkIconContainer}>
            <CheckIcon size={16} />
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.fieldContainer, width && { width }, style]}
        activeOpacity={0.7}
        onPress={() => setIsPickerVisible(true)}
      >
        <PencilIcon size={24} />
        <View style={styles.inputContainer}>
          <Text
            style={[textStyle]}
            numberOfLines={1}
          >
            {hasValue ? value : (placeholder || label)}
          </Text>
        </View>
        {showCheck && (
          <View style={styles.checkIconContainer}>
            <CheckIcon size={16} />
          </View>
        )}
      </TouchableOpacity>

      {CountryPicker && (
        <CountryPicker
          visible={isPickerVisible}
          withFilter
          withFlag
          withCountryNameButton={false}
          withAlphaFilter
          withCallingCode={false}
          withEmoji
          countryCode={countryCode}
          onSelect={handleNativeSelect}
          onClose={() => setIsPickerVisible(false)}
          theme={{
            primaryColor: '#00A2B6',
            primaryColorVariant: '#0788B0',
            backgroundColor: colors.white || '#FFFFFF',
            onBackgroundTextColor: colors.textPrimary || '#333333',
            fontSize: 16,
            fontFamily: 'Inter',
          }}
        />
      )}
    </>
  );
};

// Pronoun Field Component - similar to CountryField but with 3 simple options
interface PronounFieldProps {
  label: string;
  value: string;
  onSelect: (pronoun: string) => void;
  placeholder?: string;
  width?: number;
  style?: any;
}

const PRONOUN_OPTIONS = ['Bro', 'Sis', 'Neither'];

const PronounField: React.FC<PronounFieldProps> = ({
  label,
  value,
  onSelect,
  placeholder,
  width,
  style,
}) => {
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const hasValue = value.trim().length > 0;
  const showCheck = hasValue;

  // Get display text from value
  const getDisplayText = (val: string): string => {
    if (!val) return placeholder || label;
    const option = PRONOUN_OPTIONS.find(opt => opt.toLowerCase() === val.toLowerCase());
    return option || val;
  };

  const handleSelect = (option: string) => {
    const optionValue = option.toLowerCase();
    onSelect(optionValue);
    setIsPickerVisible(false);
  };

  // Determine text style based on state
  const textStyle = hasValue 
    ? styles.fieldInputFilled 
    : styles.fieldInput;

  return (
    <>
      <TouchableOpacity
        style={[styles.fieldContainer, width && { width }, style]}
        activeOpacity={0.7}
        onPress={() => setIsPickerVisible(true)}
      >
        <PencilIcon size={24} />
        <View style={styles.inputContainer}>
          <Text
            style={[textStyle, Platform.OS === 'web' && styles.fieldInputWeb]}
            numberOfLines={1}
          >
            {getDisplayText(value)}
          </Text>
        </View>
        {showCheck && (
          <View style={styles.checkIconContainer}>
            <CheckIcon size={16} />
          </View>
        )}
      </TouchableOpacity>

      {/* Modal for pronoun selection */}
      {isPickerVisible && (
        <TouchableOpacity
          style={styles.webModalOverlay}
          activeOpacity={1}
          onPress={() => setIsPickerVisible(false)}
        >
          <TouchableOpacity
            style={styles.pronounModalContent}
            activeOpacity={1}
            onPress={(e) => {
              // Prevent closing when clicking inside the modal
              e.stopPropagation();
            }}
          >
            <View style={styles.webModalHeader}>
              <Text style={styles.webModalTitle}>How can we call you?</Text>
              <TouchableOpacity
                onPress={() => setIsPickerVisible(false)}
                style={styles.webModalCloseButton}
              >
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.pronounModalList}>
              {PRONOUN_OPTIONS.map((option) => {
                const isSelected = value.toLowerCase() === option.toLowerCase();
                return (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.pronounModalItem,
                      isSelected && styles.pronounModalItemSelected,
                    ]}
                    onPress={() => handleSelect(option)}
                  >
                    <Text
                      style={[
                        styles.pronounModalText,
                        isSelected && styles.pronounModalTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                    {isSelected && (
                      <View style={styles.pronounModalCheck}>
                        <CheckIcon size={16} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    </>
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
  const [pronoun, setPronoun] = useState<string>(initialData.pronouns || '');
  const [isUploading, setIsUploading] = useState(false);

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
            // Only set local state for preview - upload happens in handleNext
            setProfilePicture(imageUri);
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
          // Only set local state for preview - upload happens in handleNext
          setProfilePicture(imageUri);
        }
      } catch (error) {
        console.warn('expo-image-picker not available, please install it for native image picking');
        alert('Image picker not available. Please install expo-image-picker for native platforms.');
      }
    }
  };


  const keyboardAwareScrollViewRef = useRef<any>(null);

  const handleNext = async () => {
    let finalProfilePicture = profilePicture;
    
    // If we have a local image (base64 or file://), upload it
    if (profilePicture && (profilePicture.startsWith('data:') || profilePicture.startsWith('file://') || profilePicture.startsWith('content://'))) {
      setIsUploading(true);
      try {
        // Get current user ID
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const result = await uploadProfileImage(profilePicture, user.id);
          if (result.success && result.url) {
            finalProfilePicture = result.url;
            console.log('[OnboardingStep4] Image uploaded successfully to storage:', result.url);
          } else {
            // Only fall back to base64 if it's a bucket/permission issue
            const isBucketError = result.error?.includes('bucket') || result.error?.includes('Bucket');
            if (isBucketError) {
              console.warn('[OnboardingStep4] Storage bucket issue, using base64 fallback:', result.error);
              finalProfilePicture = profilePicture;
            } else {
              // For other errors, log but still try to use base64 as fallback
              console.error('[OnboardingStep4] Image upload failed (non-bucket error):', result.error);
              console.warn('[OnboardingStep4] Falling back to base64 image. Please check storage permissions.');
              finalProfilePicture = profilePicture;
            }
          }
        } else {
          // No user authenticated, use base64 directly
          console.warn('[OnboardingStep4] No authenticated user, using base64 image');
          finalProfilePicture = profilePicture;
        }
      } catch (error) {
        console.error('[OnboardingStep4] Error uploading image:', error);
        // Continue with the local image as fallback
        finalProfilePicture = profilePicture;
      } finally {
        setIsUploading(false);
      }
    }
    
    const formData: OnboardingData = {
      nickname: name,
      userEmail: initialData.userEmail || '',
      location: location,
      age: parseInt(age) || 0,
      boardType: initialData.boardType ?? 0,
      surfLevel: initialData.surfLevel ?? -1,
      travelExperience: initialData.travelExperience ?? 0,
      profilePicture: finalProfilePicture || undefined,
      pronouns: pronoun || undefined,
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
              <CountryField
                label="Location"
                value={location}
                onSelect={(countryName) => {
                  setLocation(countryName);
                  updateFormData({ location: countryName });
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
                keyboardType="numeric"
                numericOnly={true}
              />
            </View>

            {/* Pronoun Selection */}
            <PronounField
              label="How should we address you?"
              value={pronoun}
              onSelect={(selectedPronoun) => {
                setPronoun(selectedPronoun);
                updateFormData({ pronouns: selectedPronoun });
              }}
              placeholder="How should we address you?*"
              width={357}
            />
            </View>
          </View>
        </View>
          </KeyboardAwareScrollView>

          {/* Next Button - Fixed at bottom, moves up with keyboard */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            onPress={handleNext} 
            activeOpacity={0.8}
            disabled={isLoading || isUploading}
            style={(isLoading || isUploading) && styles.buttonDisabled}
          >
            <LinearGradient
              colors={['#00A2B6', '#0788B0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradientButton}
            >
              <Text style={styles.buttonText}>
                {isUploading ? 'Uploading...' : isLoading ? 'Loading...' : 'Next'}
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
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 22,
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
  paperTextInput: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    margin: 0,
    height: '100%',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontWeight: '400',
  },
  paperTextInputContent: {
    paddingHorizontal: 0,
    margin: 0,
    minHeight: 0,
    height: '100%',
    ...(Platform.OS === 'web' && {
      outline: 'none',
    }),
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
  // Web modal styles
  webModalOverlay: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webModalContent: {
    backgroundColor: colors.white || '#FFFFFF',
    borderRadius: 12,
    width: '90%',
    maxWidth: 500,
    maxHeight: '80%',
    overflow: 'hidden',
    ...(Platform.OS === 'web' && {
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    }),
  },
  webModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  webModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: colors.textPrimary || '#333333',
  },
  webModalCloseButton: {
    padding: spacing.xs,
  },
  webSearchInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: spacing.md,
    margin: spacing.lg,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary || '#333333',
    ...(Platform.OS === 'web' && {
      outlineStyle: 'none',
    }),
  },
  webCountryList: {
    maxHeight: 400,
    ...(Platform.OS === 'web' && {
      overflowY: 'auto' as any,
    }),
  },
  webCountryItem: {
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  webCountryItemSelected: {
    backgroundColor: '#F0F9FA',
  },
  webCountryText: {
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary || '#333333',
  },
  webCountryTextSelected: {
    color: '#00A2B6',
    fontWeight: '600',
  },
  webNoResults: {
    padding: spacing.lg,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textSecondary || '#666666',
  },
  pronounModalContent: {
    backgroundColor: colors.white || '#FFFFFF',
    borderRadius: 12,
    width: '90%',
    maxWidth: 400,
    overflow: 'hidden',
    ...(Platform.OS === 'web' && {
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    }),
  },
  pronounModalList: {
    maxHeight: 300,
    ...(Platform.OS === 'web' && {
      overflowY: 'auto' as any,
    }),
  },
  pronounModalItem: {
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pronounModalItemSelected: {
    backgroundColor: '#F0F9FA',
  },
  pronounModalText: {
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary || '#333333',
  },
  pronounModalTextSelected: {
    color: '#00A2B6',
    fontWeight: '600',
  },
  pronounModalCheck: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
