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
import { Video, ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { VideoCarousel, VideoLevel } from '../components/VideoCarousel';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';

const getScreenWidth = () => Dimensions.get('window').width;

interface OnboardingStep2ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

// Helper function to get video URL based on name
const getVideoUrl = (name: string): string => {
  // Map video names to file paths
  const videoMap: { [key: string]: string } = {
    'Dipping My Toes': '/surf level/Dipping My Toes.mp4',
    'Cruising Around': '/surf level/Cruising Around.mp4',
    'Cross Stepping': '/surf level/CrossStepping.mp4',
    'Hanging Toes': '/surf level/Hanging Toes.mp4',
    'Charging': '/surf level/Charging.mp4',
  };
  
  return videoMap[name] || '';
};

// Helper function to get thumbnail URL - use video URL as thumbnail (will show first frame)
const getThumbnailUrl = (name: string): string => {
  // Use the video URL as thumbnail - browsers/native will show the first frame
  return getVideoUrl(name);
};

// Video levels representing different surf skills
const SURF_LEVEL_VIDEOS: VideoLevel[] = [
  {
    id: 0,
    name: 'Dipping My Toes',
    thumbnailUrl: getThumbnailUrl('Dipping My Toes'),
    videoUrl: getVideoUrl('Dipping My Toes'),
  },
  {
    id: 1,
    name: 'Cruising Around',
    thumbnailUrl: getThumbnailUrl('Cruising Around'),
    videoUrl: getVideoUrl('Cruising Around'),
  },
  {
    id: 2,
    name: 'Cross Stepping',
    thumbnailUrl: getThumbnailUrl('Cross Stepping'),
    videoUrl: getVideoUrl('Cross Stepping'),
  },
  {
    id: 3,
    name: 'Hanging Toes',
    thumbnailUrl: getThumbnailUrl('Hanging Toes'),
    videoUrl: getVideoUrl('Hanging Toes'),
  },
  {
    id: 4,
    name: 'Charging',
    thumbnailUrl: getThumbnailUrl('Charging'),
    videoUrl: getVideoUrl('Charging'),
  },
];

export const OnboardingStep2Screen: React.FC<OnboardingStep2ScreenProps> = ({
  onNext,
  onBack,
  initialData = {},
  updateFormData,
}) => {
  const [selectedVideoId, setSelectedVideoId] = useState<number>(
    typeof initialData.surfLevel === 'number' && initialData.surfLevel >= 0 ? initialData.surfLevel : 0
  );

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

  const selectedVideo = SURF_LEVEL_VIDEOS.find(v => v.id === selectedVideoId) || SURF_LEVEL_VIDEOS[0];

  return (
    <SafeAreaView style={styles.container}>
      {/* Background Video/Image with 20% opacity */}
      <View style={styles.backgroundVideoContainer}>
        <View style={styles.backgroundVideoWrapper}>
          {selectedVideo.videoUrl ? (
            <Video
              source={{ uri: Platform.OS === 'web' ? selectedVideo.videoUrl : selectedVideo.videoUrl }}
              style={styles.backgroundVideo}
              resizeMode={ResizeMode.COVER}
              shouldPlay={true}
              isLooping={true}
              isMuted={true}
              useNativeControls={false}
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

          <Text style={styles.stepText}>Step 2/4</Text>

          <View style={styles.skipButton}>
            {/* Skip button is hidden/opacity 0 in Figma */}
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: 116 }]} />
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
            videos={SURF_LEVEL_VIDEOS}
            selectedVideoId={selectedVideoId}
            onVideoSelect={handleVideoSelect}
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
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    paddingBottom: spacing.md,
    minHeight: 44,
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
    paddingHorizontal: Platform.OS === 'web' ? 32 : 16,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    alignItems: 'center',
    maxWidth: '100%',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: colors.textPrimary || '#333333',
    textAlign: 'center',
    lineHeight: 24,
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  buttonContainer: {
    paddingHorizontal: Platform.OS === 'web' ? 32 : 16,
    paddingTop: spacing.xl,
    paddingBottom: 40,
    alignItems: 'center',
    width: '100%',
    maxWidth: '100%',
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
});

