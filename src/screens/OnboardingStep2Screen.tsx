import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  Image,
  Dimensions,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { VideoCarousel, VideoLevel } from '../components/VideoCarousel';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';
import { getVideoUrl as getVideoUrlUtil } from '../utils/videoUtils';
import { getImageUrl } from '../utils/imageUtils';

const getScreenWidth = () => Dimensions.get('window').width;

// Helper to detect if we're on desktop web (not mobile web)
const isDesktopWeb = () => {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return window.innerWidth > 768; // Desktop breakpoint
};

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
  // Get board type from initial data (default to 0 if not set)
  const boardType = initialData.boardType ?? 0;

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
      <View style={styles.backgroundVideoContainer}>
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

      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>

          <Text style={styles.stepText}>Step 2/5</Text>

          <View style={styles.skipButton}>
            {/* Skip button is hidden/opacity 0 in Figma */}
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '40%' }]} />
          </View>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>
            Select the video that best represents{'\n'}how you surf.
          </Text>
        </View>

        {/* Video Carousel */}
        <View style={styles.carouselContainer}>
          <VideoCarousel
            videos={surfLevelVideos}
            selectedVideoId={selectedVideoId}
            onVideoSelect={handleVideoSelect}
          />
        </View>

        {/* Next Button */}
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
    backgroundColor: colors.backgroundGray || '#FAFAFA',
    width: '100%',
    overflow: 'hidden',
  },
  backgroundVideoContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 640,
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
    overflow: 'hidden', // Mobile: keep original
    ...(isDesktopWeb() && {
      overflow: 'visible',
      alignItems: 'center',
      minHeight: 0, // Allow flex to shrink if needed
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm, // Mobile: keep original
    paddingBottom: spacing.md, // Mobile: keep original
    minHeight: 44,
    ...(isDesktopWeb() && {
      paddingTop: spacing.sm, // Desktop: minimal top padding
      paddingBottom: spacing.sm, // Desktop: reduced bottom padding
    }),
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
    paddingBottom: spacing.md, // Mobile native: keep original
    alignItems: 'center',
    ...(Platform.OS === 'web' && !isDesktopWeb() && {
      // Mobile web: reduce spacing to match image
      paddingBottom: spacing.sm,
    }),
    ...(isDesktopWeb() && {
      paddingBottom: spacing.sm, // Desktop: reduced bottom padding
    }),
  },
  progressBar: {
    width: 237,
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
    paddingHorizontal: 16,
    paddingTop: spacing.xl, // Mobile web: same as mobile web
    paddingBottom: spacing.md, // Mobile web: same as mobile web
    alignItems: 'center',
    maxWidth: '100%',
    ...(Platform.OS !== 'web' && {
      // Native mobile (Expo Go) ONLY: add more space below title to prevent covering video
      paddingBottom: spacing.lg, // Increased bottom padding for native mobile
    }),
    ...(isDesktopWeb() && {
      // Desktop web ONLY - keep desktop styles unchanged
      paddingHorizontal: 32,
      paddingTop: spacing.md, // Desktop: reduced top padding
      paddingBottom: spacing.xs || 4, // Desktop: minimal bottom padding
    }),
  },
  title: {
    fontSize: 20, // Native mobile and mobile web: same as mobile web
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: colors.textPrimary || '#333333',
    textAlign: 'center',
    lineHeight: 28, // Native mobile and mobile web: same as mobile web
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm, // Mobile web: keep current (8px)
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    ...(Platform.OS !== 'web' && {
      // Native mobile (Expo Go) ONLY: add more space above video to prevent title overlap
      paddingTop: 80, // 80px top padding for native mobile
      paddingBottom: spacing.sm, // Keep bottom padding same as web mobile
    }),
    ...(isDesktopWeb() && {
      maxWidth: 600,
      alignSelf: 'center',
      minHeight: 0,
      overflow: 'visible',
      paddingTop: 8, // Desktop: minimal top padding
      paddingBottom: 8, // Desktop: minimal bottom padding
      paddingVertical: 0, // Desktop: override vertical padding
    }),
  },
  buttonContainer: {
    paddingHorizontal: 16,
    paddingTop: spacing.md, // Native mobile and mobile web: same as mobile web
    paddingBottom: 24, // Native mobile and mobile web: same as mobile web
    alignItems: 'center',
    width: '100%',
    maxWidth: '100%',
    ...(isDesktopWeb() && {
      paddingHorizontal: 32,
      flexShrink: 0,
      paddingTop: spacing.md, // Desktop: reduced top padding
      paddingBottom: 24, // Desktop: reduced bottom padding
    }),
  },
  gradientButton: {
    height: 56,
    width: Platform.OS === 'web' 
      ? Math.min(330, getScreenWidth() - 64) 
      : Math.min(330, getScreenWidth() - 64),
    maxWidth: 330,
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

