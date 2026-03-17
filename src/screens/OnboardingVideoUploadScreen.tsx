import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { useIsDesktopWeb, responsiveWidth } from '../utils/responsive';
import { getSurfLevelMapping } from '../utils/surfLevelMapping';
import { validateVideoComplete } from '../utils/videoValidation';
import { uploadProfileVideo } from '../services/storage/storageService';
import { supabaseDatabaseService } from '../services/database/supabaseDatabaseService';

interface OnboardingVideoUploadScreenProps {
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
  boardType: number;
  surfLevel: number;
  userId: string;
}

export const OnboardingVideoUploadScreen: React.FC<OnboardingVideoUploadScreenProps> = ({
  onNext,
  onSkip,
  onBack,
  boardType,
  surfLevel,
  userId,
}) => {
  const isDesktop = useIsDesktopWeb();
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | undefined>(undefined);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const progressBarWidth = isDesktop ? 300 : 237;
  const buttonWidth = responsiveWidth(90, 280, 330, 0);

  const surfLevelInfo = getSurfLevelMapping(boardType, surfLevel);

  const previewPlayer = useVideoPlayer(null, (player: any) => {
    if (player) {
      player.loop = true;
      player.muted = true;
    }
  });

  useEffect(() => {
    if (!videoUri || !previewPlayer) return;

    const loadAndPlay = async () => {
      try {
        const replacePromise = previewPlayer.replaceAsync(videoUri);
        if (replacePromise && typeof replacePromise.then === 'function') {
          await replacePromise;
        }
        previewPlayer.loop = true;
        previewPlayer.muted = true;
        previewPlayer.play();
      } catch (e) {
        console.warn('Error loading video preview:', e);
      }
    };

    loadAndPlay();
  }, [videoUri, previewPlayer]);

  const pickVideo = async () => {
    setError(null);

    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/mp4,video/quicktime,video/webm,video/x-msvideo';
      input.style.display = 'none';

      input.onchange = async (event: any) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const uri = URL.createObjectURL(file);
        const fileMimeType = file.type || undefined;

        try {
          const validation = await validateVideoComplete(uri, fileMimeType);
          if (!validation.valid) {
            setError(validation.error || 'Please select a valid video file.');
            URL.revokeObjectURL(uri);
            return;
          }
          setVideoUri(uri);
          setMimeType(fileMimeType);
        } catch (err) {
          console.error('Error validating video:', err);
          setError('Failed to validate video. Please try again.');
          URL.revokeObjectURL(uri);
        }

        document.body.removeChild(input);
      };

      document.body.appendChild(input);
      input.click();
    } else {
      try {
        const ImagePicker = require('expo-image-picker');
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Sorry, we need media library permissions to upload your video!');
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          allowsEditing: false,
          quality: 1.0,
        });

        if (!result.canceled && result.assets[0]) {
          const videoAsset = result.assets[0];
          const assetMimeType = videoAsset.mimeType || undefined;

          const validation = await validateVideoComplete(videoAsset.uri, assetMimeType);
          if (!validation.valid) {
            setError(validation.error || 'Please select a valid video file.');
            return;
          }
          setVideoUri(videoAsset.uri);
          setMimeType(assetMimeType);
        }
      } catch (err) {
        console.warn('expo-image-picker not available:', err);
        Alert.alert('Video Picker Not Available', 'Please install expo-image-picker for native platforms.');
      }
    }
  };

  const handleNext = async () => {
    if (!videoUri || isUploading) return;

    setIsUploading(true);
    setError(null);

    try {
      const result = await uploadProfileVideo(videoUri, userId, mimeType);

      if (result.success) {
        if (result.processing) {
          // Poll for video processing completion
          let attempts = 0;
          const maxAttempts = 60;
          const intervalMs = 2000;

          pollIntervalRef.current = setInterval(async () => {
            attempts++;
            try {
              const surferData = await supabaseDatabaseService.getSurferByUserId(userId);
              if (surferData?.profile_video_url) {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                setIsUploading(false);
                onNext();
              } else if (attempts >= maxAttempts) {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                setIsUploading(false);
                // Still advance even if processing takes too long
                onNext();
              }
            } catch (pollError) {
              console.error('Error polling for video update:', pollError);
              if (attempts >= maxAttempts) {
                if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                setIsUploading(false);
                onNext();
              }
            }
          }, intervalMs);
        } else {
          setIsUploading(false);
          onNext();
        }
      } else {
        setIsUploading(false);
        setError(result.error || 'Failed to upload video. Please try again.');
      }
    } catch (err) {
      console.error('Error uploading video:', err);
      setIsUploading(false);
      setError(err instanceof Error ? err.message : 'Failed to upload video. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.content, isDesktop && styles.contentDesktop]}>
        {/* Header */}
        <View style={[styles.header, isDesktop && styles.headerDesktop]}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#222B30" />
          </TouchableOpacity>

          <Text style={styles.stepText}>Step 2/4</Text>

          <View style={styles.placeholder} />
        </View>

        {/* Progress Bar */}
        <View style={[styles.progressContainer, isDesktop && styles.progressContainerDesktop]}>
          <View style={[styles.progressBar, { width: progressBarWidth }]}>
            <View style={[styles.progressFill, { width: '60%' }]} />
          </View>
        </View>

        {/* Title & Subtitle */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>
            {videoUri ? 'Show Us Your Style' : 'Upload your own surf clip'}
          </Text>
          <Text style={styles.subtitle}>
            {videoUri
              ? 'Drop a clip of you surfing so others can see how you ride'
              : 'Show us how you ride'}
          </Text>
        </View>

        {/* Main Content */}
        <View style={styles.mainContent}>
          {!videoUri ? (
            /* State 1: No video selected */
            <TouchableOpacity style={styles.uploadArea} onPress={pickVideo} activeOpacity={0.7}>
              <View style={styles.uploadIconContainer}>
                <Ionicons name="cloud-upload-outline" size={45} color="#7B7B7B" />
                <Text style={styles.uploadText}>
                  {'Tap to upload\nyour video here'}
                </Text>
              </View>
              <View style={styles.uploadFooter}>
                <Text style={styles.uploadFooterText}>MP4 or MOV • Up to 50MB</Text>
              </View>
            </TouchableOpacity>
          ) : (
            /* State 2: Video selected - preview */
            <View style={styles.previewContainer}>
              <View style={styles.videoPreview} pointerEvents="box-none">
                <VideoView
                  player={previewPlayer}
                  style={styles.videoThumbnail}
                  contentFit="cover"
                  nativeControls={false}
                />
                <View style={styles.videoOverlay}>
                  <Text style={styles.surfSkillLabel}>Surf Skill</Text>
                  <View style={styles.surfLevelInfo}>
                    <Text style={styles.surfLevelName}>
                      {surfLevelInfo?.description || 'Surfer'}
                    </Text>
                    <Text style={styles.surfLevelCategory}>
                      {surfLevelInfo?.category || ''}
                    </Text>
                  </View>
                </View>
                {/* Change video button */}
                <TouchableOpacity style={styles.changeVideoButton} onPress={pickVideo} activeOpacity={0.8}>
                  <Ionicons name="cloud-upload-outline" size={42} color="#FFF" />
                </TouchableOpacity>
              </View>

              <Text style={styles.messageText}>
                {'This helps us match you with the right people, trips, and surf experiences. No pressure,\n\nJust be you!'}
              </Text>
            </View>
          )}

          {error && (
            <Text style={styles.errorText}>{error}</Text>
          )}
        </View>

        {/* Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            onPress={videoUri ? handleNext : onSkip}
            activeOpacity={0.8}
            disabled={isUploading}
            style={[styles.actionButton, { width: buttonWidth }, isUploading && styles.buttonDisabled]}
          >
            {isUploading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>
                {videoUri ? 'Next' : 'Skip'}
              </Text>
            )}
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
  contentDesktop: {
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
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
    fontSize: 12,
    fontWeight: '400',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  placeholder: {
    width: 60,
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 30,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    color: '#7B7B7B',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: 27,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // State 1: Upload area
  uploadArea: {
    width: 339,
    height: 324,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#7B7B7B',
    borderRadius: 21,
    backgroundColor: '#EEE',
    overflow: 'hidden',
  },
  uploadIconContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: '#7B7B7B',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  uploadFooter: {
    borderTopWidth: 1,
    borderTopColor: '#CFCFCF',
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  uploadFooterText: {
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'System',
    color: '#7B7B7B',
  },
  // State 2: Video preview
  previewContainer: {
    width: '100%',
    alignItems: 'center',
  },
  videoPreview: {
    width: '100%',
    height: 229,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  videoThumbnail: {
    width: '100%',
    height: '100%',
  },
  videoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    // gradient-like overlay effect
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  surfSkillLabel: {
    position: 'absolute',
    top: -190,
    left: 16,
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
  },
  surfLevelInfo: {
    // positioned at bottom-left via parent padding
  },
  surfLevelName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  surfLevelCategory: {
    fontSize: 10,
    color: '#DADADA',
    marginTop: 2,
  },
  changeVideoButton: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -32,
    marginLeft: -32,
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.77,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  messageText: {
    fontSize: 14,
    color: '#7B7B7B',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
  errorText: {
    fontSize: 13,
    color: '#E53E3E',
    textAlign: 'center',
    marginTop: 12,
  },
  buttonContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    width: '100%',
    flexShrink: 0,
  },
  actionButton: {
    height: 56,
    borderRadius: 999,
    backgroundColor: '#212121',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'System',
    color: '#FFF',
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
