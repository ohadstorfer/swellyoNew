import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { BoardCarousel } from '../components/BoardCarousel';
import { colors, spacing, typography } from '../styles/theme';

// Helper to detect if we're on desktop web (not mobile web)
const isDesktopWeb = () => {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return window.innerWidth > 768; // Desktop breakpoint
};

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
  name: string;
  imageUrl: string;
  description?: string;
}

export interface OnboardingData {
  nickname: string;
  userEmail: string;
  location: string;
  age: number;
  boardType: number;
  surfLevel: number;
  travelExperience: number;
  profilePicture?: string;
  pronouns?: string;
}

const BOARD_TYPES: BoardType[] = [
  {
    id: 0,
    name: 'Short Board',
    imageUrl: 'https://api.builder.io/api/v1/image/assets/TEMP/9761796f6e2272f3cacf14c4fc9342525bb54ff8?width=371',
  },
  {
    id: 1,
    name: 'Mid Length',
    imageUrl: 'https://api.builder.io/api/v1/image/assets/TEMP/377f67727b21485479e873ed3d93c57611722f74?width=371',
  },
  {
    id: 2,
    name: 'Long Board',
    imageUrl: 'https://api.builder.io/api/v1/image/assets/TEMP/4692a28e8ac444a82eec1f691f5f008c8a9bbc8e?width=371',
  },
  {
    id: 3,
    name: 'Soft Top',
    imageUrl: 'https://api.builder.io/api/v1/image/assets/TEMP/1d104557a7a5ea05c3b36931c1ee56fd01a6d426?width=371',
  },
];

export const OnboardingStep1Screen: React.FC<OnboardingStep1ScreenProps> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
}) => {
  const [selectedBoardId, setSelectedBoardId] = useState<number>(
    initialData.boardType ?? 0
  );

  const handleBoardSelect = (board: BoardType) => {
    setSelectedBoardId(board.id);
    updateFormData({ boardType: board.id });
  };

  const handleNext = () => {
    const formData: OnboardingData = {
      nickname: initialData.nickname || '',
      userEmail: initialData.userEmail || '',
      location: initialData.location || '',
      age: initialData.age || 0,
      boardType: selectedBoardId,
      surfLevel: initialData.surfLevel ?? -1,
      travelExperience: initialData.travelExperience ?? 0,
    };
    onNext(formData);
  };

  const handleSkip = () => {
    handleNext();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>

          <Text style={styles.stepText}>Step 1/5</Text>

          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '20%' }]} />
          </View>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>
            Nice to meet you,{'\n'}
            {initialData.nickname || 'Jake'}!
          </Text>
        </View>

        {/* Subtitle */}
        <View style={styles.subtitleContainer}>
          <Text style={styles.subtitle}>What is your choice style?</Text>
          <Text style={styles.description}>
            Select one... you can add more later!
          </Text>
        </View>

        {/* Board Carousel */}
        <View style={styles.carouselContainer}>
          <BoardCarousel
            boards={BOARD_TYPES}
            selectedBoardId={selectedBoardId}
            onBoardSelect={handleBoardSelect}
          />
        </View>

        {/* Next Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            onPress={handleNext}
            activeOpacity={0.8}
          >
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
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
  },
  content: {
    flex: 1,
    ...(isDesktopWeb() && {
      maxWidth: 800,
      alignSelf: 'center',
      width: '100%',
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    height: 44,
    ...(isDesktopWeb() && {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
    }),
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
    paddingHorizontal: 10,
  },
  skipText: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary,
    textAlign: 'right',
    lineHeight: 15,
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    ...(isDesktopWeb() && {
      paddingVertical: spacing.sm,
    }),
  },
  progressBar: {
    width: 237,
    height: 4,
    backgroundColor: colors.progressBackground,
    borderRadius: 8,
    overflow: 'hidden',
    ...(isDesktopWeb() && {
      width: 300,
    }),
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.progressFill,
    borderRadius: 8,
  },
  titleContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    alignItems: 'center',
    ...(isDesktopWeb() && {
      paddingTop: spacing.xl,
      paddingBottom: spacing.sm,
    }),
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.brandTeal,
    textAlign: 'center',
    lineHeight: 28.8,
    ...(isDesktopWeb() && {
      fontSize: 28,
      lineHeight: 34,
    }),
  },
  subtitleContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...(isDesktopWeb() && {
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    }),
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    lineHeight: 24,
  },
  description: {
    fontSize: 12,
    fontWeight: '400',
    color: '#000',
    textAlign: 'center',
    lineHeight: 15,
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
    marginTop: -spacing.xl,
    ...(isDesktopWeb() && {
      marginTop: -spacing.lg,
      paddingHorizontal: spacing.lg,
    }),
  },
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    ...(isDesktopWeb() && {
      paddingHorizontal: spacing.xxl,
      paddingBottom: spacing.xxl,
      maxWidth: 400,
      alignSelf: 'center',
    }),
  },
  gradientButton: {
    height: 56,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
    textAlign: 'center',
    lineHeight: 24,
  },
});
