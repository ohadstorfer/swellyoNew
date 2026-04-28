import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { VideoCarousel, VideoLevel } from '../components/VideoCarousel';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { useIsDesktopWeb, useScreenDimensions, responsiveWidth, getScreenWidth } from '../utils/responsive';
import { getVideoPreloadStatus, waitForVideoReady } from '../services/media/videoPreloadService';
import { getSurfLevelVideos } from '../services/media/surfLevelVideos';

interface OnboardingStep2ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
  isLoading?: boolean;
}

export const OnboardingStep2Screen: React.FC<OnboardingStep2ScreenProps> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
  isLoading = false,
}) => {
  const isDesktop = useIsDesktopWeb();
  const { height: rawScreenHeight, width: screenWidth } = useScreenDimensions();
  const insets = useSafeAreaInsets();
  const screenHeight = Platform.OS === 'web' ? rawScreenHeight : rawScreenHeight - (insets.top + (Platform.OS === 'android' ? 0 : insets.bottom));
  
  // Get board type from initial data (default to 0 if not set)
  const boardType = initialData.boardType ?? 0;
  
  // Calculate responsive dimensions
  const progressBarWidth = isDesktop ? 300 : 237;
  const buttonContainerMaxWidth = isDesktop ? 400 : undefined;
  const buttonWidth = responsiveWidth(90, 280, 320, 0); // 90% width, min 280px, max 320px, same as Step 1
  
  // Calculate responsive title font size to fit in 2 lines
  // Title text: "Select the video that best represents\nhow you surf."
  const calculateTitleFontSize = () => {
    const titleText = "Select the video that best represents\nhow you surf.";
    const baseFontSize = 20;
    const minFontSize = 16;
    const lineHeight = 1.4; // lineHeight ratio
    
    // Calculate available width for title (accounting for padding)
    const horizontalPadding = isDesktop ? 32 * 2 : 10 * 2; // padding on both sides
    const availableWidth = screenWidth - horizontalPadding;
    
    // Estimate if text fits in 2 lines with base font size
    // Rough estimation: average character width is ~0.6 * fontSize
    const avgCharWidth = baseFontSize * 0.6;
    const longestLine = Math.max(
      "Select the video that best represents".length,
      "how you surf.".length
    );
    const estimatedWidth = longestLine * avgCharWidth;
    
    // If estimated width exceeds available width, reduce font size
    if (estimatedWidth > availableWidth) {
      // Calculate font size that would fit
      const calculatedSize = (availableWidth / longestLine) / 0.6;
      // Use the smaller of calculated size or base size, but not less than min
      return Math.max(minFontSize, Math.min(calculatedSize, baseFontSize));
    }
    
    return baseFontSize;
  };
  
  const titleFontSize = calculateTitleFontSize();
  
  // Calculate available space between title and thumbnails for main video
  // This will be used to dynamically size the main video
  // Includes gaps for proper spacing
  const calculateAvailableVideoHeight = () => {
    // Header: 44px + padding
    const headerHeight = 44 + (isDesktop ? spacing.lg : spacing.sm) + spacing.md;
    
    // Progress bar: 4px + padding
    const progressHeight = 4 + (isDesktop ? spacing.sm * 2 : spacing.md * 2);
    
    // Title: 2 lines with dynamic font size + padding
    // lineHeight is 1.4 * fontSize, so 2 lines = 2 * lineHeight
    const titleLineHeight = titleFontSize * 1.4;
    const titleTwoLinesHeight = titleLineHeight * 2;
    const titlePadding = (isDesktop ? spacing.md : spacing.xs) + (Platform.OS !== 'web' ? spacing.lg : spacing.md);
    const titleHeight = titleTwoLinesHeight + titlePadding;
    
    // Gap between title and video
    const gapAboveVideo = spacing.md;
    
    // Thumbnails section: approximate height (~100px for thumbnails + padding)
    const thumbnailsHeight = 100 + spacing.md;
    
    // Gap between video and thumbnails
    const gapBelowVideo = spacing.md;
    
    // Button: 56px + padding
    const buttonHeight = 56 + spacing.xl;
    
    // Calculate total used space including gaps
    const totalUsedSpace = headerHeight + progressHeight + titleHeight + gapAboveVideo + gapBelowVideo + thumbnailsHeight + buttonHeight;
    
    // Available space for main video (in the spacer area)
    const availableSpace = screenHeight - totalUsedSpace;
    
    // Ensure minimum height (at least 180px for smaller screens) and maximum reasonable height
    // On smaller screens, be more conservative with minimum
    const minHeight = screenWidth <= 375 ? 180 : 200;
    if (availableSpace < minHeight) {
      return minHeight;
    }
    
    // Cap at reasonable maximum (smaller on smaller screens)
    // Android has smaller safe area insets, so allow more space for the video
    const androidBonus = Platform.OS === 'android' ? 40 : 0;
    const maxHeight = (screenWidth <= 375 ? 400 : (screenWidth <= 414 ? 450 : 500)) + androidBonus;
    if (availableSpace > maxHeight) {
      return maxHeight;
    }
    
    return availableSpace;
  };
  
  const availableVideoHeight = calculateAvailableVideoHeight();
  
  // Get videos with resolved URLs for the selected board type
  const surfLevelVideos = React.useMemo(() => getSurfLevelVideos(boardType), [boardType]);

  // Initialize selectedVideoId, and reset it when board type changes to ensure it's valid
  const [selectedVideoId, setSelectedVideoId] = useState<number>(() => {
    const initialSurfLevel = typeof initialData.surfLevel === 'number' && initialData.surfLevel >= 0 
      ? initialData.surfLevel 
      : 0;
    // Ensure the initial value is valid for the current board's videos
    const videos = getSurfLevelVideos(boardType);
    if (videos.length > 0 && videos.some(v => v.id === initialSurfLevel)) {
      return initialSurfLevel;
    }
    return 0; // Default to first video if invalid
  });

  // Check preload status synchronously before render to optimize initial loading state
  const initialMainVideoLoading = React.useMemo(() => {
    if (surfLevelVideos.length === 0) return true;
    const firstVideo = surfLevelVideos[0];
    if (!firstVideo?.videoUrl) return true;

    if (Platform.OS === 'web') {
      // On web, check blob URL or preload status
      const isBlobUrl = firstVideo.videoUrl.startsWith('blob:');
      const preloadStatus = getVideoPreloadStatus(firstVideo.videoUrl);
      const isPreloaded = isBlobUrl || preloadStatus?.ready === true;
      console.log(`[OnboardingStep2] Mount: preloaded=${isPreloaded}, isBlobUrl=${isBlobUrl}`);
      return !isPreloaded;
    }

    // On native, always start with thumbnail visible.
    // The VideoCarousel's statusChange 'readyToPlay' listener drives the reveal.
    console.log(`[OnboardingStep2] Mount: native, showing thumbnail until player ready`);
    return true;
  }, [surfLevelVideos]);

  // Loading states for video optimization - initialized based on preload status
  const [isMainVideoLoading, setIsMainVideoLoading] = useState(initialMainVideoLoading);

  // On web: check preload status on mount and clear loading if ready
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (surfLevelVideos.length === 0) return;
    const firstVideo = surfLevelVideos[0];
    if (!firstVideo?.videoUrl) return;

    if (firstVideo.videoUrl.startsWith('blob:')) {
      setIsMainVideoLoading(false);
      return;
    }
    const preloadStatus = getVideoPreloadStatus(firstVideo.videoUrl);
    if (preloadStatus?.ready) {
      setIsMainVideoLoading(false);
    } else {
      waitForVideoReady(firstVideo.videoUrl, 500)
        .then(() => setIsMainVideoLoading(false));
    }
  }, [surfLevelVideos]);

  // Native: no remaining video preload — avoids bandwidth competition with the player.
  // Remaining videos load on-demand when the user taps them (useCaching: true caches after first play).
  // Web: all videos were preloaded on Step 1 already.

  // Reset selectedVideoId when board type changes to ensure it's valid for the new board's videos
  React.useEffect(() => {
    if (surfLevelVideos.length > 0) {
      // Check if current selectedVideoId is valid for the new board's videos
      const isValid = surfLevelVideos.some(v => v.id === selectedVideoId);
      if (!isValid) {
        // Reset to first video (id: 0) if current selection is invalid
        const newSelectedId = 0;
        setSelectedVideoId(newSelectedId);
        updateFormData({ surfLevel: newSelectedId });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardType]); // Only run when board type changes - surfLevelVideos is derived from boardType

  const handleVideoSelect = (video: VideoLevel) => {
    setSelectedVideoId(video.id);
    updateFormData({ surfLevel: video.id });
  };

  const handleNext = () => {
    const formData: OnboardingData = {
      nickname: initialData.nickname || '',
      userEmail: initialData.userEmail || '',
      location: initialData.location || '',
      age: initialData.age || 0,
      boardType: initialData.boardType ?? -1,
      surfLevel: selectedVideoId,
      travelExperience: initialData.travelExperience ?? 0,
    };
    onNext(formData);
  };

  const handleSkip = () => {
    handleNext();
  };

  const selectedVideo = surfLevelVideos.find((v: VideoLevel) => v.id === selectedVideoId) || surfLevelVideos[0];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.content, isDesktop && styles.contentDesktop]}>
        {/* Header */}
        <View style={[styles.header, isDesktop && styles.headerDesktop]}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>

          <Text style={styles.stepText}>Step 2/4</Text>

          <View style={styles.skipButton}>
            {/* Skip button is hidden/opacity 0 in Figma */}
          </View>
        </View>

        {/* Progress Bar */}
        <View style={[styles.progressContainer, isDesktop && styles.progressContainerDesktop]}>
          <View style={[styles.progressBar, { width: progressBarWidth }]}>
            <View style={[styles.progressFill, { width: '40%' }]} />
          </View>
        </View>

        {/* Title */}
        <View style={[styles.titleContainer, isDesktop && styles.titleContainerDesktop]}>
          <Text style={[styles.title, { fontSize: titleFontSize, lineHeight: titleFontSize * 1.4 }]} numberOfLines={2}>
            Select the video that best represents{'\n'}how you surf.
          </Text>
        </View>

        {/* Video Carousel - main video fills available space, thumbnails at bottom */}
        <View style={[styles.videoCarouselContainer, isDesktop && styles.videoCarouselContainerDesktop]}>
          <VideoCarousel
            videos={surfLevelVideos}
            selectedVideoId={selectedVideoId}
            onVideoSelect={handleVideoSelect}
            availableVideoHeight={availableVideoHeight}
          />
        </View>

        {/* Next Button - fixed at bottom */}
        <View style={[styles.buttonContainer, isDesktop && styles.buttonContainerDesktop, buttonContainerMaxWidth && { maxWidth: buttonContainerMaxWidth }, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <TouchableOpacity
            onPress={handleNext}
            activeOpacity={0.8}
            disabled={isLoading}
            style={isLoading && styles.buttonDisabled}
          >
            <View style={[styles.gradientButton, { width: buttonWidth }]}>
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
    backgroundColor: colors.backgroundGray || '#FAFAFA',
    width: '100%',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    zIndex: 1,
    width: '100%',
    maxWidth: '100%',
    overflow: Platform.OS === 'web' ? 'hidden' : 'visible',
    paddingHorizontal: Platform.OS !== 'web' ? spacing.md : 0,
  },
  contentDesktop: {
    overflow: 'visible',
    alignItems: 'center',
    minHeight: 0,
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'System',
    color: colors.textPrimary || '#333333',
    textAlign: 'center',
    lineHeight: 15,
  },
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    opacity: 0, // Hidden in Figma design
  },
  skipText: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textSecondary || '#7B7B7B',
    textAlign: 'right',
    lineHeight: 15,
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
    backgroundColor: '#BDBDBD',
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#333333',
    borderRadius: 8,
  },
  titleContainer: {
    paddingHorizontal: 10,
    paddingTop: spacing.xs,
    paddingBottom: Platform.OS !== 'web' ? spacing.lg : spacing.md, // More space on native mobile
    alignItems: 'center',
    maxWidth: '100%',
  },
  titleContainerDesktop: {
    paddingHorizontal: 32,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs || 4,
  },
  title: {
    // fontSize and lineHeight are set dynamically via inline style
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: colors.textPrimary || '#333333',
    textAlign: 'center',
  },
  videoCarouselContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: 0, // No padding, thumbnails and button handle their own spacing
    width: '100%',
    minHeight: 0, // Allow flex to shrink
  },
  videoCarouselContainerDesktop: {
    paddingHorizontal: spacing.xxl,
  },
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    width: '100%',
    flexShrink: 0, // Don't shrink, keep fixed size at bottom
  },
  buttonContainerDesktop: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
    alignSelf: 'center',
  },
  gradientButton: {
    height: 56,
    // Width is set dynamically via inline style using responsiveWidth
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: '#212121',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: colors.white || '#FFF',
    textAlign: 'center',
    lineHeight: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});


