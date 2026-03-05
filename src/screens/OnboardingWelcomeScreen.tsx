import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { useOnboarding } from '../context/OnboardingContext';
import { useScreenDimensions } from '../utils/responsive';
import { colors, borderRadius } from '../styles/theme';

const STEP_HEADER_HEIGHT = 60;
const BUTTON_CONTAINER_HEIGHT = 92;
const MIN_CONTENT_HEIGHT = 400;

// Figma asset URLs (replace with permanent assets if needed after 7 days)
const CARD_IMAGES = {
  share_wisdom:
    'https://www.figma.com/api/mcp/asset/12c06250-18d0-458a-8aa2-134b920d9c9f',
  find_crew:
    'https://www.figma.com/api/mcp/asset/ed75f7f6-1141-459e-a42e-87874db75512',
  plan_trip:
    'https://www.figma.com/api/mcp/asset/d4cedc6c-d6c4-4d92-aa62-3ebe56f873e5',
  just_waves:
    'https://www.figma.com/api/mcp/asset/2f80058e-8d18-4487-a4f6-786526e7411b',
} as const;

const JOURNEY_OPTIONS: Array<{
  id: string;
  title: string;
  subtitle: string;
  imageUri: string;
}> = [
  {
    id: 'share_wisdom',
    title: 'Share your surf wisdom',
    subtitle: 'Give & Get Travel Advice',
    imageUri: CARD_IMAGES.share_wisdom,
  },
  {
    id: 'find_crew',
    title: 'Find your surf crew',
    subtitle: 'Connect with aligned Surfers',
    imageUri: CARD_IMAGES.find_crew,
  },
  {
    id: 'plan_trip',
    title: 'Plan your next trip',
    subtitle: 'Meet Potential Travel Partners',
    imageUri: CARD_IMAGES.plan_trip,
  },
  {
    id: 'just_waves',
    title: 'Just here for the waves',
    subtitle: 'General Surf Guidance',
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
  const availableContentHeight = Math.max(
    MIN_CONTENT_HEIGHT,
    screenHeight - STEP_HEADER_HEIGHT - BUTTON_CONTAINER_HEIGHT
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Step header: back, Step 1/4, progress bar */}
      <View style={styles.stepHeader}>
        <View style={styles.stepHeaderRow}>
          {onBack ? (
            <TouchableOpacity
              onPress={onBack}
              style={styles.backButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
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
        {/* Greeting */}
        <Text style={styles.greeting}>
          {displayName ? `Yo ${displayName}!` : 'Yo!'}
        </Text>

        {/* Title block */}
        <View style={styles.headerTitle}>
          <Text style={styles.title}>What's your surf journey?</Text>
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
                <Text style={styles.cardSubtitle} numberOfLines={2}>
                  {option.subtitle}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Affirmation */}
        <Text style={styles.affirmation}>
          Nice 🤙 You're building your vibe.
        </Text>
      </ScrollView>

      {/* Next button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.button}
          onPress={handleNext}
          activeOpacity={0.8}
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
  },
  stepHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 24,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  backPlaceholder: {
    width: 60,
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
    paddingBottom: 24,
    alignItems: 'center',
  },
  greeting: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    fontSize: 24,
    lineHeight: 28.8,
    color: colors.brandTeal,
    textAlign: 'center',
  },
  headerTitle: {
    alignItems: 'center',
    gap: 8,
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
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontWeight: '400',
    fontSize: 10,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  affirmation: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Body, Inter), sans-serif' : 'Inter',
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
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
  buttonText: {
    fontFamily: Platform.OS === 'web' ? 'var(--Family-Headings, Montserrat), sans-serif' : 'Montserrat',
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 24,
    color: colors.white,
    textAlign: 'center',
  },
});
