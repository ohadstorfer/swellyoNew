import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { useOnboarding } from '../context/OnboardingContext';
import { useScreenDimensions } from '../utils/responsive';
import { colors, borderRadius, spacing } from '../styles/theme';

const STEP_HEADER_HEIGHT = 60;
const BUTTON_CONTAINER_HEIGHT = 92;
const MIN_CONTENT_HEIGHT = 400;

const CARD_IMAGES = {
  share_wisdom:
    'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/onboarding-welcome-images/b0d7956780bd01fbfac42c1db76ed27df34c3fcf.jpg',
  find_crew:
    'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/onboarding-welcome-images/63ee08f6a46333084911295e23748727ebc90198.jpg',
  plan_trip:
    'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/onboarding-welcome-images/6cbafc07268184703dff606b6cb48836431babec.jpg',
  just_waves:
    'https://rfdhtvcmagsbxqntnepv.supabase.co/storage/v1/object/public/onboarding-welcome-images/082aedec1b3d12fa462436f56cd5af2e3d6ad236.jpg',
} as const;

/** All onboarding welcome image URLs — exported for prefetching. */
export const ONBOARDING_WELCOME_IMAGE_URLS = Object.values(CARD_IMAGES);

const JOURNEY_OPTIONS: Array<{
  id: string;
  title: string;
  imageUri: string;
}> = [
  {
    id: 'share_wisdom',
    title: 'Give & Get Travel Advice',
    imageUri: CARD_IMAGES.share_wisdom,
  },
  {
    id: 'find_crew',
    title: 'Connect with Like-Minded Travelers',
    imageUri: CARD_IMAGES.find_crew,
  },
  {
    id: 'plan_trip',
    title: 'Meet Potential Travel Partners',
    imageUri: CARD_IMAGES.plan_trip,
  },
  {
    id: 'just_waves',
    title: 'General Surf Guidance',
    imageUri: CARD_IMAGES.just_waves,
  },
];

interface OnboardingWelcomeScreenProps {
  onNext: () => void;
  onBack?: () => void;
  updateFormData?: (data: { surfJourney?: string[] }) => void;
}

export const OnboardingWelcomeScreen: React.FC<OnboardingWelcomeScreenProps> = ({
  onNext,
  onBack,
  updateFormData,
}) => {
  const { user, formData } = useOnboarding();
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => formData?.surfJourney ?? []
  );

  const displayName = user?.nickname || formData?.nickname || '';

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (selectedIds.length < 2) {
      Alert.alert(
        'Pick at least two',
        'Please select at least two options for your surf journey.',
        [{ text: 'OK' }]
      );
      return;
    }
    updateFormData?.({ surfJourney: selectedIds });
    onNext();
  };

  const progressWidth = 237;
  const progressFilled = 34; // 1/4 step

  const { height: screenHeight } = useScreenDimensions();
  const safeAreaInsets = Platform.OS === 'web' ? 0 : 90;
  const availableContentHeight = Math.max(
    MIN_CONTENT_HEIGHT,
    screenHeight - STEP_HEADER_HEIGHT - BUTTON_CONTAINER_HEIGHT - safeAreaInsets
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Step header: 16px above the title block (second headline) */}
      <View style={styles.stepHeader}>
        <View style={styles.stepHeaderRow}>
          {onBack ? (
            <TouchableOpacity
              onPress={onBack}
              style={styles.backButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="arrow-back" size={24} color="#222B30" />
            </TouchableOpacity>
          ) : (
            <View style={styles.backPlaceholder} />
          )}

        </View>
 
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            minHeight: availableContentHeight,
            flexGrow: 1,
            justifyContent: 'space-evenly',
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title block */}
        <View style={styles.headerTitle}>
        <Text
              style={styles.greetingHeader}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {displayName ? `Yo ${displayName}!` : 'Yo!'}
            </Text>
          <Text style={styles.title}>What are you here for?</Text>
          <Text style={styles.subtitle}>Pick at least two!</Text>
        </View>

        {/* 2x2 cards */}
        <View style={styles.cardsGrid}>
          {JOURNEY_OPTIONS.map((option) => {
            const selected = selectedIds.includes(option.id);
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.card, selected && styles.cardSelected]}
                onPress={() => toggleSelection(option.id)}
                activeOpacity={0.85}
              >
                <View style={styles.cardImageWrap}>
                  <Image
                    source={{ uri: option.imageUri }}
                    style={styles.cardImage}
                    resizeMode="cover"
                  />
                  <View
                    style={[
                      styles.checkbox,
                      selected ? styles.checkboxSelected : styles.checkboxUnselected,
                    ]}
                  >
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={12}
                        color={colors.white}
                      />
                    ) : null}
                  </View>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {option.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        
      </ScrollView>

      {/* Next button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, selectedIds.length < 2 && styles.buttonDisabled]}
          onPress={handleNext}
          activeOpacity={0.8}
          disabled={selectedIds.length < 2}
        >
          <Text style={styles.buttonText}>Next</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: Platform.OS !== 'web' ? spacing.md : 0,
  },
  stepHeader: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 8,
    paddingBottom: 0,
    gap: 8,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    position: 'relative',
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
    zIndex: 1,
  },
  backPlaceholder: {
    width: 60,
    minHeight: 29,
    zIndex: 1,
  },
  greetingHeaderWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  greetingHeader: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    fontSize: 24,
    lineHeight: 28.8,
    color: colors.brandTeal,
    textAlign: 'center',
  },
  skipPlaceholder: {
    width: 60,
    alignItems: 'flex-end',
  },
  stepLabel: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontWeight: '400',
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  progressTrack: {
    height: 4,
    borderRadius: 8,
    backgroundColor: colors.progressBackground,
    width: 237,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 8,
    backgroundColor: colors.progressFill,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 24,
    alignItems: 'center',
  },
  headerTitle: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  title: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    fontSize: 22,
    lineHeight: 32,
    color: '#212121',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
    width: '100%',
    maxWidth: 345,
  },
  card: {
    width: '47%',
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
    // Figma Box Shadow 01
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 4,
  },
  cardSelected: {
    borderColor: colors.brandTeal,
  },
  cardImageWrap: {
    height: 104,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' && { objectFit: 'cover' as any }),
  },
  checkbox: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxUnselected: {
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#CFCFCF',
  },
  checkboxSelected: {
    backgroundColor: '#05bcd3',
    borderWidth: 1,
    borderColor: '#05bcd3',
  },
  cardTitle: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  affirmation: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  buttonContainer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 12,
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#212121',
    height: 56,
    minWidth: 150,
    maxWidth: 330,
    width: '100%',
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 24,
    color: colors.white,
    textAlign: 'center',
  },
});
