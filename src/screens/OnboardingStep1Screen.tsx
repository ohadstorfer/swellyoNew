import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { useRegisterOnboardingStep } from '../context/OnboardingStepContext';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { BoardCarousel } from '../components/BoardCarousel';
import { colors, spacing, typography } from '../styles/theme';
import { useOnboarding } from '../context/OnboardingContext';
import { useIsDesktopWeb, useScreenDimensions } from '../utils/responsive';
import { preloadVideosForBoardType, preloadFirstVideoForBoardType, areAllVideosReadyForBoardType, isFirstVideoReadyForBoardType } from '../services/media/videoPreloadService';

interface OnboardingStep1ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
  isLoading?: boolean;
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
  dateOfBirth?: string; // ISO date string (YYYY-MM-DD) - preferred
  age?: number; // Legacy support - optional for backward compatibility
  boardType: number;
  surfLevel: number;
  travelExperience: number;
  profilePicture?: string;
  pronouns?: string;
  /** Selected surf journey option ids from welcome step (e.g. 'travel_advice', 'like_minded_travellers', 'travel_partners', 'guidance') */
  surfJourney?: string[];
  // Home break (Google Places) — set in step 4.
  homeBreakPlaceId?: string;
  homeBreakFull?: string;
  homeBreakShort?: string;
  homeBreakLocality?: string;
  homeBreakCountry?: string;
  homeBreakLat?: number;
  homeBreakLng?: number;
  // Trip preferences captured directly in onboarding (steps 4/5/6). Same DB
  // columns the Swelly chat fills in step 8 — both paths upsert into `surfers`.
  destinations_array?: Array<{ country: string; state?: string; area: string[]; time_in_days: number; time_in_text?: string }>;
  travel_type?: 'budget' | 'mid' | 'high' | 'premium';
  lifestyle_keywords?: string[];
  lifestyle_image_urls?: Record<string, string>;
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
  isLoading = false,
}) => {
  const { markOnboardingComplete } = useOnboarding();
  const isDesktop = useIsDesktopWeb();
  const { height: screenHeight } = useScreenDimensions();
  const insets = useSafeAreaInsets();
  const defaultBoardType = (initialData.boardType !== undefined && initialData.boardType >= 0 && initialData.boardType <= 3) 
    ? initialData.boardType 
    : 0;
  
  const [selectedBoardId, setSelectedBoardId] = useState<number>(defaultBoardType);
  const [activeBoardIndex, setActiveBoardIndex] = useState<number>(
    defaultBoardType >= 0 ? BOARD_TYPES.findIndex(b => b.id === defaultBoardType) : 0
  );
  
  const buttonContainerMaxWidth = isDesktop ? 400 : undefined;
  // Board height is measured from the carousel container (onLayout). The scaffold
  // already excludes the header/Next chrome, so it's no longer derived from the screen.
  const [boardHeight, setBoardHeight] = useState(0);

  const onBoardLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && h !== boardHeight) setBoardHeight(h);
  };

  // Track current preload promise to cancel if board type changes
  const preloadPromiseRef = useRef<Promise<any> | null>(null);

  // When board is selected, preload videos for that board type.
  // On native: only preload the first video to avoid saturating the network
  // (remaining videos preload on Step 2 after the first video is playing).
  // On web: preload all videos (browser handles concurrent downloads better).
  useEffect(() => {
    if (selectedBoardId === undefined || selectedBoardId === 3) return;

    const debounceDelay = 100;

    const timeoutId = setTimeout(() => {
      if (Platform.OS === 'web') {
        // Web: preload all videos (browser manages concurrent downloads well)
        if (areAllVideosReadyForBoardType(selectedBoardId)) {
          console.log(`[OnboardingStep1] All videos already preloaded for board type ${selectedBoardId}, skipping`);
          return;
        }
        preloadPromiseRef.current = null;
        console.log(`[OnboardingStep1] Starting all-video preload for board type ${selectedBoardId}`);
        const preloadPromise = preloadVideosForBoardType(selectedBoardId, 'high')
          .then(result => {
            console.log(`[OnboardingStep1] Preloaded ${result.readyCount}/${result.totalCount} videos for board type ${selectedBoardId}`);
          })
          .catch(err => {
            console.warn('[OnboardingStep1] Video preload failed (non-blocking):', err);
          });
        preloadPromiseRef.current = preloadPromise;
      } else {
        // Native: only preload the first video to keep bandwidth free for the player
        if (isFirstVideoReadyForBoardType(selectedBoardId)) {
          console.log(`[OnboardingStep1] First video already preloaded for board type ${selectedBoardId}, skipping`);
          return;
        }
        preloadPromiseRef.current = null;
        console.log(`[OnboardingStep1] Starting first-video-only preload for board type ${selectedBoardId}`);
        const preloadPromise = preloadFirstVideoForBoardType(selectedBoardId)
          .catch(err => {
            console.warn('[OnboardingStep1] Video preload failed (non-blocking):', err);
          });
        preloadPromiseRef.current = preloadPromise;
      }
    }, debounceDelay);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [selectedBoardId]);

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

  useRegisterOnboardingStep({
    nextLabel: 'Next',
    canProceed: true,
    onNext: handleNext,
    onBack,
  });

  return (
    <View style={styles.contentRoot}>
      {/* Title */}
      <View style={[styles.titleContainer, isDesktop && styles.titleContainerDesktop]}>
        <Text style={styles.title}>What is your style?</Text>
      </View>

      {/* Subtitle */}
      <View style={[styles.subtitleContainer, isDesktop && styles.subtitleContainerDesktop]}>
        <Text style={styles.subtitle}>Sharing the board you ride creates more aligned connections.</Text>
      </View>

      {/* Board Carousel — fills remaining space; its height drives the board size. */}
      <View
        style={[styles.carouselContainer, isDesktop && styles.carouselContainerDesktop]}
        onLayout={onBoardLayout}
      >
        {boardHeight > 0 && (
          <BoardCarousel
            boards={BOARD_TYPES}
            selectedBoardId={selectedBoardId}
            onBoardSelect={handleBoardSelect}
            onActiveIndexChange={setActiveBoardIndex}
            availableBoardHeight={boardHeight}
          />
        )}
      </View>

      {/* Dots and Board Name */}
      <View
        style={[
          styles.labelContainer,
          isDesktop && styles.labelContainerDesktop,
          buttonContainerMaxWidth && { maxWidth: buttonContainerMaxWidth },
        ]}
      >
        <View style={styles.dotsContainer}>
          {BOARD_TYPES.map((_board, index) => (
            <View
              key={index}
              style={[styles.dot, index === activeBoardIndex ? styles.dotActive : styles.dotInactive]}
            />
          ))}
        </View>
        <Text style={styles.boardName}>{BOARD_TYPES[activeBoardIndex]?.name || ''}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundGray,
  },
  contentRoot: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Platform.OS !== 'web' ? spacing.md : 0,
  },
  contentDesktop: {
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    height: 44,
  },
  headerDesktop: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 14,
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
  homepageButton: {
    width: 60,
    // Empty space to balance the back button and keep the step indicator centered
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  progressContainerDesktop: {
    paddingBottom: spacing.sm,
  },
  progressBar: {
    // Width is set dynamically via inline style
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
  titleContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    alignItems: 'center',
    paddingBottom: 36, // gap-[36px] from Figma
  },
  titleContainerDesktop: {
    paddingTop: spacing.xl,
    paddingBottom: 36,
  },
  title: {
    fontSize: 24, // var(--Size-2-xl, 24px)
    fontWeight: '700', // Montserrat Bold
    fontFamily: Platform.select({
      web: 'Montserrat, sans-serif',
      default: 'Montserrat',
    }),
    color: '#0788B0', // var(--Text-brand, #0788B0)
    textAlign: 'center',
    lineHeight: 28.8, // 120% of 24px
  },
  subtitleContainer: {
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: 8, // gap-[8px] from Figma
    marginTop: -8, // Adjust to account for titleContainer paddingBottom
  },
  subtitleContainerDesktop: {
    paddingTop: 0,
    paddingBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 18, // var(--Size-lg, 18px)
    fontWeight: '700', // Montserrat Bold
    fontFamily: Platform.select({
      web: 'Montserrat, sans-serif',
      default: 'Montserrat',
    }),
    color: '#000',
    textAlign: 'center',
    lineHeight: 24, // var(--Size-2-xl, 24px) - 133.333% of 18px
  },
  description: {
    fontSize: 16, // var(--Size-md, 16px)
    fontWeight: '400', // Inter Regular
    fontFamily: Platform.select({
      web: 'Inter, sans-serif',
      default: 'Inter',
    }),
    color: '#000',
    textAlign: 'center',
    lineHeight: 22, // var(--Size-xl, 22px) - 137.5% of 16px
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
    marginTop: -spacing.xl,
    marginHorizontal: Platform.OS !== 'web' ? -spacing.md : 0,
    zIndex: 1,
  },
  carouselContainerDesktop: {
    marginTop: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  buttonContainerDesktop: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
    alignSelf: 'center',
  },
  gradientButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: '#212121',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  labelContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.sm as any,
  },
  labelContainerDesktop: {
    paddingHorizontal: spacing.xxl,
    alignSelf: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6 as any,
    marginBottom: spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.dotActive || '#0788B0',
  },
  dotInactive: {
    width: 8,
    backgroundColor: colors.dotInactive || '#CFCFCF',
  },
  boardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
});
