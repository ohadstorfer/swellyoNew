import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { useOnboarding } from '../context/OnboardingContext';
import { getVideoUrl } from '../services/media/videoService';

interface LoadingScreenProps {
  onComplete: () => void;
  onBack?: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  onComplete,
  onBack,
}) => {
  const { setCurrentStep } = useOnboarding();

  // Get video URL using the utility function
  const videoUrl = getVideoUrl('/Loading 4 to 5.mp4');

  // Create video player
  const player = useVideoPlayer(videoUrl, (player: any) => {
    if (player) {
      player.loop = false;
      player.muted = false;
      player.play();
    }
  });

  // Ensure video plays after mount
  useEffect(() => {
    if (player) {
      const playVideo = async () => {
        try {
          player.loop = false;
          player.muted = false;
          await player.play();
        } catch (error) {
          console.error('Error playing loading video:', error);
        }
      };
      playVideo();
    }
  }, [player]);

  useEffect(() => {
    // Auto-navigate to step 5 after video completes or timeout
    const timer = setTimeout(() => {
      onComplete();
    }, 5000); // 5 second timeout as fallback

    return () => clearTimeout(timer);
  }, [onComplete]);

  // Listen for video end
  useEffect(() => {
    if (!player) return;
    
    const subscription = player.addListener('playToEnd', () => {
      console.log('Video ended, navigating to next step');
      onComplete();
    });

    return () => {
      subscription.remove();
    };
  }, [player, onComplete]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      setCurrentStep(4); // Go back to step 4
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#222B30" />
        </TouchableOpacity>

        <Text style={styles.stepText}>Step 4/5</Text>

        <View style={styles.skipButton}>
          {/* Skip button is hidden in this step */}
        </View>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: '100%' }]} />
        </View>
      </View>

      {/* Main Content */}
      <View style={styles.content}>
        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Moving you to the next stage....</Text>
        </View>

        {/* Video */}
        <View style={styles.videoContainer}>
          <VideoView
            player={player}
            style={styles.video}
            contentFit="cover"
            nativeControls={false}
          />
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  skipButton: {
    width: 60,
    alignItems: 'flex-end',
  },
  progressContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  progressBar: {
    width: 237,
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  titleContainer: {
    marginBottom: 36,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
    color: colors.brandTeal,
    textAlign: 'center',
    lineHeight: 28.8,
    width: 350,
  },
  videoContainer: {
    width: 295,
    height: 294,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#FAFAFA',
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    ...(Platform.OS === 'web' && {
      // Web-specific styles to ensure video is visible
      objectFit: 'cover' as any,
      display: 'block' as any,
      visibility: 'visible' as any,
      opacity: 1,
      mixBlendMode: 'darken' as any, 
      backgroundColor: '#FAFAFA',
    } as any),
  },
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.backgroundMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
});

