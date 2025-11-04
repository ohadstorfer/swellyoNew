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
import { VideoCarousel, VideoLevel } from '../components/VideoCarousel';
import { colors, spacing } from '../styles/theme';
import { OnboardingData } from './OnboardingStep1Screen';

interface OnboardingStep2ScreenProps {
  onNext: (data: OnboardingData) => void;
  onBack: () => void;
  initialData?: Partial<OnboardingData>;
  updateFormData: (data: Partial<OnboardingData>) => void;
}

// Video levels representing different surf skills
const SURF_LEVEL_VIDEOS: VideoLevel[] = [
  {
    id: 0,
    name: 'Dipping My Toes',
    thumbnailUrl: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=400&h=300&fit=crop',
  },
  {
    id: 1,
    name: 'Cruising Around',
    thumbnailUrl: 'https://images.unsplash.com/photo-1537519646099-335112f03225?w=400&h=300&fit=crop',
  },
  {
    id: 2,
    name: 'Cross Stepping',
    thumbnailUrl: 'https://images.unsplash.com/photo-1621951753023-1f9a988a7c8a?w=400&h=300&fit=crop',
  },
  {
    id: 3,
    name: 'Hanging Toes',
    thumbnailUrl: 'https://images.unsplash.com/photo-1541516160071-4bb0c5af65ba?w=400&h=300&fit=crop',
  },
  {
    id: 4,
    name: 'Charging',
    thumbnailUrl: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=400&h=300&fit=crop',
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>

          <Text style={styles.stepText}>Step 2/4</Text>

          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '50%' }]} />
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
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'web' ? spacing.md : spacing.sm,
    height: 44,
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.textPrimary || '#333',
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
    color: colors.textSecondary || '#7B7B7B',
    textAlign: 'right',
    lineHeight: 15,
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  progressBar: {
    width: 237,
    height: 4,
    backgroundColor: colors.progressBackground || '#BDBDBD',
    borderRadius: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.progressFill || '#333',
    borderRadius: 8,
  },
  titleContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary || '#333',
    textAlign: 'center',
    lineHeight: 24,
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
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
    color: colors.white || '#FFF',
    textAlign: 'center',
    lineHeight: 24,
  },
});
