import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
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
  /** Selected surf journey option ids from welcome step (e.g. 'share_wisdom', 'find_crew', 'plan_trip', 'just_waves') */
  surfJourney?: string[];
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
  
  // Calculate responsive dimensions
  const progressBarWidth = isDesktop ? 300 : 237;
  const buttonContainerMaxWidth = isDesktop ? 400 : undefined;
  
  // Calculate available space between subtitle text and dots/board name
  // This will be used as the board height to fill the space dynamically
  const calculateAvailableBoardHeight = () => {
    // Calculate space from bottom of subtitle to top of label container
    
    // Subtitle ends at: 
    // - subtitle lineHeight (24px) + description lineHeight (22px) + gap (8px)
    // - Plus any paddingBottom from subtitleContainer
    const subtitleBottom = 24 + 22 + 8 + (isDesktop ? spacing.sm : 0);
    
    // Label container starts at: 
    // - It's positioned above the button, so we need to account for:
    // - Label container paddingBottom (spacing.md)
    // - The gap between label and button area
    // Since carouselContainer has flex: 1 and justifyContent: 'center',
    // and labelContainer is after it, we need to calculate the space differently
    
    // The carousel container uses flex: 1, so it takes available space
    // We need to calculate: screenHeight - (everything above subtitle) - (subtitle) - (label + button)
    
    // Everything above subtitle:
    const headerHeight = 44 + (isDesktop ? spacing.lg : (Platform.OS === 'web' ? spacing.md : spacing.sm));
    const progressHeight = 4 + (isDesktop ? spacing.sm * 2 : spacing.md * 2);
    const titleHeight = 28.8 + (isDesktop ? spacing.xl : spacing.lg) + 36; // lineHeight + paddingTop + paddingBottom
    
    // Subtitle height (already calculated above)
    const subtitleTotalHeight = subtitleBottom;
    
    // Label + Button area:
    const labelHeight = 24 + 24 + spacing.sm + spacing.md; // dots + board name + gap + padding
    const buttonHeight = 56 + spacing.xl; // button + padding
    
    // Carousel marginTop (negative, adds space)
    // Reclaim most of the negative margin, but reserve 4px minimum gap from subtitle
    const carouselMarginTop = isDesktop ? spacing.lg : (spacing.xl - 16);
    
    // Calculate available space for board
    // Total used space = everything above subtitle + subtitle + label + button
    const totalUsedSpace = headerHeight + progressHeight + titleHeight + subtitleTotalHeight + labelHeight + buttonHeight;
    
    // On native, SafeAreaView consumes top/bottom insets
    // but screenHeight is the full window height. Subtract these so boards fit within safe area.
    // On Android with edge-to-edge, insets.bottom (nav bar) is large and over-shrinks boards.
    // Only subtract top inset on Android; SafeAreaView already pads the bottom.
    const safeAreaInsets = Platform.OS === 'web' ? 0 : (insets.top + (Platform.OS === 'android' ? 0 : insets.bottom));

    // Available space = screen height - safe area - used space + carousel margin (negative margin adds space)
    // Subtract a small buffer (8px) for visual spacing
    const availableSpace = screenHeight - safeAreaInsets - totalUsedSpace + carouselMarginTop - 8;
    
    // Ensure minimum height (at least 200px) and maximum reasonable height
    if (availableSpace < 200) {
      return 200;
    }
    
    // Cap at reasonable maximum to prevent boards from being too large on very tall screens
    if (availableSpace > 600) {
      return 600;
    }
    
    return availableSpace;
  };
  
  const availableBoardHeight = calculateAvailableBoardHeight();

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

  const handleSkip = () => {
    handleNext();
  };

  // Removed handleHomepage - home button removed

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.content, isDesktop && styles.contentDesktop]}>
        {/* Header */}
        <View style={[styles.header, isDesktop && styles.headerDesktop]}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>

          <View style={styles.stepTextContainer}>
            <Text style={styles.stepText}>Step 1/4</Text>
          </View>

          <View style={styles.homepageButton}>
            {/* Empty space to balance the back button and keep Step 1/4 centered */}
          </View>
        </View>

        {/* Progress Bar */}
        <View style={[styles.progressContainer, isDesktop && styles.progressContainerDesktop]}>
          <View style={[styles.progressBar, { width: progressBarWidth }]}>
            <View style={[styles.progressFill, { width: '20%' }]} />
          </View>
        </View>

        {/* Title */}
        <View style={[styles.titleContainer, isDesktop && styles.titleContainerDesktop]}>
          <Text style={styles.title}>
          What is your style?
          </Text>
        </View>

        {/* Subtitle */}
        <View style={[styles.subtitleContainer, isDesktop && styles.subtitleContainerDesktop]}>
          <Text style={styles.subtitle}>Pick your go-to board.</Text>
          <Text style={styles.description}>
            Select one... 
            you can add more to your quiver later!
          </Text>
        </View>

        {/* Board Carousel */}
        <View style={[styles.carouselContainer, isDesktop && styles.carouselContainerDesktop]}>
          <BoardCarousel
            boards={BOARD_TYPES}
            selectedBoardId={selectedBoardId}
            onBoardSelect={handleBoardSelect}
            onActiveIndexChange={setActiveBoardIndex}
            availableBoardHeight={availableBoardHeight}
          />
        </View>

        {/* Dots and Board Name - positioned above Next button */}
        <View style={[styles.labelContainer, isDesktop && styles.labelContainerDesktop, buttonContainerMaxWidth && { maxWidth: buttonContainerMaxWidth }]}>
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

        {/* Next Button */}
        <View style={[styles.buttonContainer, isDesktop && styles.buttonContainerDesktop, buttonContainerMaxWidth && { maxWidth: buttonContainerMaxWidth }, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <TouchableOpacity
            onPress={handleNext}
            activeOpacity={0.8}
            disabled={isLoading}
            style={isLoading && styles.buttonDisabled}
          >
            <View style={styles.gradientButton}>
              <Text style={styles.buttonText}>
                {isLoading ? 'Loading...' : 'Next'}
              </Text>
            </View>
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
  stepTextContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 0,
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
  homepageButton: {
    width: 60,
    // Empty space to balance the back button and keep Step 1/5 centered
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  progressContainerDesktop: {
    paddingVertical: spacing.sm,
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
