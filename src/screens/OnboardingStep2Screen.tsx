import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { VideoCarousel, VideoLevel } from '../components/VideoCarousel';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { getVideoUrl as getVideoUrlUtil } from '../services/media/videoService';
import { getImageUrl } from '../services/media/imageService';
import { useIsDesktopWeb, useScreenDimensions, responsiveWidth, getScreenWidth } from '../utils/responsive';

interface OnboardingStep2ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
  isLoading?: boolean;
}

// Board-specific video definitions
// Each board type has its own set of videos in the specified order
const BOARD_VIDEO_DEFINITIONS: { [boardType: number]: Array<{ name: string; videoFileName: string; thumbnailFileName: string }> } = {
  // Shortboard (id: 0): Dipping My Toes, Cruising Around, Snapping, Charging
  0: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Snapping', videoFileName: 'Snapping.mp4', thumbnailFileName: 'Snapping thumbnail.PNG' },
    { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
  ],
  // Midlength (id: 1): Dipping My Toes, Cruising Around, Trimming Lines, Carving Turns
  1: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Trimming Lines', videoFileName: 'Trimming Lines.mp4', thumbnailFileName: 'Trimming Lines thumbnail.PNG' },
    { name: 'Carving Turns', videoFileName: 'Carving Turns.mp4', thumbnailFileName: 'Carving Turns thumbnail.PNG' },
  ],
  // Longboard (id: 2): Dipping My Toes, Cruising Around, Cross Stepping, Hanging Toes
  2: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Cross Stepping', videoFileName: 'CrossStepping.mp4', thumbnailFileName: 'CrossStepping thumbnail.PNG' },
    { name: 'Hanging Toes', videoFileName: 'Hanging Toes.mp4', thumbnailFileName: 'Hanging Toes thumbnail.PNG' },
  ],
  // Softtop (id: 3): Skip step 2 - no videos
};

// Helper function to get board folder name from board type
const getBoardFolder = (boardType: number): string => {
  const folderMap: { [key: number]: string } = {
    0: 'shortboard',
    1: 'midlength',
    2: 'longboard',
    3: 'softtop', // Not used, but for completeness
  };
  return folderMap[boardType] || 'shortboard';
};

// Function to get videos with resolved URLs for a specific board type
const getSurfLevelVideos = (boardType: number): VideoLevel[] => {
  const boardVideos = BOARD_VIDEO_DEFINITIONS[boardType];
  if (!boardVideos) {
    console.warn(`No videos defined for board type ${boardType}, using shortboard as fallback`);
    return getSurfLevelVideos(0); // Fallback to shortboard
  }

  const boardFolder = getBoardFolder(boardType);
  
  return boardVideos
    .filter(video => {
      // Filter out videos that don't exist (e.g., Snapping if file doesn't exist)
      // We'll include all videos and let the component handle missing files gracefully
      return true;
    })
    .map((video, index) => {
      const videoPath = `/surf level/${boardFolder}/${video.videoFileName}`;
      const thumbnailPath = `/surf level/${boardFolder}/${video.thumbnailFileName}`;
      
      return {
        id: index, // Use index as ID to maintain order
        name: video.name,
        thumbnailUrl: getImageUrl(thumbnailPath),
        videoUrl: getVideoUrlUtil(videoPath),
      };
    });
};

export const OnboardingStep2Screen: React.FC<OnboardingStep2ScreenProps> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
  isLoading = false,
}) => {
  const isDesktop = useIsDesktopWeb();
  const { height: screenHeight, width: screenWidth } = useScreenDimensions();
  
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
    const maxHeight = screenWidth <= 375 ? 400 : (screenWidth <= 414 ? 450 : 500);
    if (availableSpace > maxHeight) {
      return maxHeight;
    }
    
    return availableSpace;
  };
  
  const availableVideoHeight = calculateAvailableVideoHeight();
  
  // Calculate background video container height
  // Background video should cover the area from top to where main video ends
  // It includes: header + progress + title + main video area
  const calculateBackgroundVideoHeight = () => {
    const headerHeight = 44 + (isDesktop ? spacing.lg : spacing.sm) + spacing.md;
    const progressHeight = 4 + (isDesktop ? spacing.sm * 2 : spacing.md * 2);
    const titleHeight = 28 + (isDesktop ? spacing.md : spacing.xs) + (Platform.OS !== 'web' ? spacing.lg : spacing.md);
    const mainVideoArea = availableVideoHeight;
    
    // Total height covers up to the end of main video area
    return headerHeight + progressHeight + titleHeight + mainVideoArea + 48; // 48px for rounded bottom
  };
  
  const backgroundVideoHeight = calculateBackgroundVideoHeight();

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

  // Create video player for background video
  const backgroundPlayer = useVideoPlayer(
    selectedVideo.videoUrl || '',
    (player: any) => {
      if (player && selectedVideo.videoUrl) {
        try {
          player.loop = true;
          player.muted = true;
          player.play();
        } catch (error) {
          console.error('Error initializing background video player:', error);
        }
      }
    }
  );

  // Update player source when video changes
  React.useEffect(() => {
    if (selectedVideo.videoUrl && backgroundPlayer) {
      const videoUrl = selectedVideo.videoUrl;
      if (!videoUrl) {
        console.warn('No video URL provided for background video:', selectedVideo.name);
        return;
      }
      
      backgroundPlayer.replaceAsync(videoUrl).then(() => {
        if (backgroundPlayer) {
          backgroundPlayer.loop = true;
          backgroundPlayer.muted = true;
          try {
            backgroundPlayer.play();
          } catch (playError: any) {
            console.error('Error playing background video:', playError);
          }
        }
      }).catch((error: any) => {
        console.error('Error replacing background video:', error, 'URL:', videoUrl);
      });
    }
  }, [selectedVideo.videoUrl, selectedVideo.name, backgroundPlayer]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Background Video/Image with 20% opacity */}
      <View style={[styles.backgroundVideoContainer, { height: backgroundVideoHeight }]}>
        <View style={styles.backgroundVideoWrapper}>
          {selectedVideo.videoUrl ? (
            <VideoView
              player={backgroundPlayer}
              style={styles.backgroundVideo}
              contentFit="cover"
              nativeControls={false}
              allowsFullscreen={false}
              allowsPictureInPicture={false}
            />
          ) : (
            <Image
              source={{ uri: selectedVideo.thumbnailUrl }}
              style={styles.backgroundVideo}
              resizeMode="cover"
            />
          )}
        </View>
      </View>

      <View style={[styles.content, isDesktop && styles.contentDesktop]}>
        {/* Header */}
        <View style={[styles.header, isDesktop && styles.headerDesktop]}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>

          <Text style={styles.stepText}>Step 2/5</Text>

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
        <View style={[styles.buttonContainer, isDesktop && styles.buttonContainerDesktop, buttonContainerMaxWidth && { maxWidth: buttonContainerMaxWidth }]}>
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
              style={[styles.gradientButton, { width: buttonWidth }]}
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
    backgroundColor: colors.backgroundGray || '#FAFAFA',
    width: '100%',
    overflow: 'hidden',
  },
  backgroundVideoContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Height is set dynamically via inline style to match main video area
    overflow: 'hidden',
    borderBottomLeftRadius: 48,
    borderBottomRightRadius: 48,
  },
  backgroundVideoWrapper: {
    width: '100%',
    height: '100%',
    opacity: 0.2,
  },
  backgroundVideo: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' && {
      objectFit: 'cover' as any,
      objectPosition: 'center center' as any,
    }),
  },
  content: {
    flex: 1,
    zIndex: 1,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    minHeight: 44,
  },
  headerDesktop: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
    padding: 10,
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
    paddingHorizontal: spacing.xl,
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
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
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

