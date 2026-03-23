import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../components/Text';
import { colors, spacing } from '../styles/theme';
import { useIsDesktopWeb, responsiveWidth } from '../utils/responsive';
import { getSurfLevelMapping } from '../utils/surfLevelMapping';
import { validateVideoComplete } from '../utils/videoValidation';
import { uploadProfileVideo } from '../services/storage/storageService';
import { getSurfLevelVideoFromStorage } from '../services/media/videoService';

const BOARD_VIDEO_DEFINITIONS: { [boardType: number]: Array<{ name: string; videoFileName: string; thumbnailFileName: string }> } = {
  0: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Snapping', videoFileName: 'Snapping.mp4', thumbnailFileName: 'Snapping thumbnail.PNG' },
    { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
  ],
  1: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Trimming Lines', videoFileName: 'Trimming Lines.mp4', thumbnailFileName: 'Trimming Lines thumbnail.PNG' },
    { name: 'Carving Turns', videoFileName: 'Carving Turns.mp4', thumbnailFileName: 'Carving Turns thumbnail.PNG' },
  ],
  2: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Trimming Lines', videoFileName: 'Trimming Lines.mp4', thumbnailFileName: 'Trimming Lines thumbnail.PNG' },
    { name: 'Carving Turns', videoFileName: 'Carving Turns.mp4', thumbnailFileName: 'Carving Turns thumbnail.PNG' },
  ],
  3: [
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Trimming Lines', videoFileName: 'Trimming Lines.mp4', thumbnailFileName: 'Trimming Lines thumbnail.PNG' },
    { name: 'Carving Turns', videoFileName: 'Carving Turns.mp4', thumbnailFileName: 'Carving Turns thumbnail.PNG' },
  ],
};

const getBoardFolder = (boardType: number): string => {
  const folderMap: { [key: number]: string } = { 0: 'shortboard', 1: 'midlength', 2: 'longboard', 3: 'softtop' };
  return folderMap[boardType] || 'shortboard';
};

const getCategorySubtitle = (category: string): string => {
  const categoryMap: { [key: string]: string } = {
    'beginner': 'Just Starting',
    'intermediate': 'Getting There',
    'advanced': 'Doing Good',
    'pro': 'Excellent',
  };
  return categoryMap[category.toLowerCase()] || 'Just Starting';
};

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
  const [userVideoUri, setUserVideoUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const hasUserVideo = userVideoUri !== null;

  const progressBarWidth = isDesktop ? 300 : 237;
  const buttonWidth = responsiveWidth(90, 280, 330, 0);

  const surfLevelInfo = getSurfLevelMapping(boardType, surfLevel);

  const displayName = surfLevelInfo?.description || 'Dipping My Toes';
  const subtitle = getCategorySubtitle(surfLevelInfo?.category || 'beginner');

  // Compute default video URL from boardType (0-based) and surfLevel (0-based)
  const defaultVideoUrl = (() => {
    const boardVideos = BOARD_VIDEO_DEFINITIONS[boardType];
    if (!boardVideos) return '';
    const videoIndex = Math.min(surfLevel, boardVideos.length - 1);
    const video = boardVideos[videoIndex];
    if (!video) return '';
    const boardFolder = getBoardFolder(boardType);
    return getSurfLevelVideoFromStorage(`${boardFolder}/${video.videoFileName}`);
  })();

  const isInitialMountRef = useRef(true);

  const previewPlayer = useVideoPlayer(defaultVideoUrl || '', (player: any) => {
    if (player) {
      player.staysActiveInBackground = true;
      player.loop = true;
      player.muted = true;
    }
  });

  // Hook A: Status change listener — play when readyToPlay
  useEffect(() => {
    if (!previewPlayer || !defaultVideoUrl) return;

    let isMounted = true;

    const handleStatusChange = (status: any) => {
      if (!isMounted || !previewPlayer) return;

      const isReady = status?.status === 'readyToPlay' ||
                     status?.isReadyToPlay ||
                     (status?.status === 'readyToPlay' && !status?.error);

      if (isReady) {
        previewPlayer.muted = true;
        previewPlayer.loop = true;

        const playPromise = previewPlayer.play();
        if (playPromise !== undefined && typeof (playPromise as any).catch === 'function') {
          (playPromise as any).catch((error: any) => {
            if (__DEV__ && error.name !== 'NotAllowedError') {
              console.warn('[OnboardingVideo] Play failed:', error);
            }
          });
        }
      }
    };

    try {
      if (previewPlayer.addListener) {
        const statusSubscription = previewPlayer.addListener('statusChange', handleStatusChange);

        return () => {
          isMounted = false;
          if (statusSubscription && typeof statusSubscription.remove === 'function') {
            statusSubscription.remove();
          }
        };
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[OnboardingVideo] Could not set up listeners:', error);
      }
    }

    return () => {
      isMounted = false;
    };
  }, [previewPlayer, defaultVideoUrl]);

  // Hook B: replaceAsync + web playsInline + canplay wait
  useEffect(() => {
    const videoUrl = userVideoUri || defaultVideoUrl;
    if (!videoUrl || !previewPlayer) {
      isInitialMountRef.current = false;
      return;
    }

    // Ensure playsInline is set before replaceAsync (Safari requirement)
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const setPlaysInline = () => {
        const videoElements = document.querySelectorAll('video');
        videoElements.forEach((videoElement: HTMLVideoElement) => {
          videoElement.setAttribute('playsinline', 'true');
          videoElement.setAttribute('webkit-playsinline', 'true');
          videoElement.setAttribute('x5-playsinline', 'true');
          videoElement.playsInline = true;
        });
      };
      setPlaysInline();
      setTimeout(setPlaysInline, 50);
    }

    const replacePromise = previewPlayer.replaceAsync(videoUrl);
    if (replacePromise && typeof replacePromise.then === 'function') {
      replacePromise.then(() => {
        if (!previewPlayer) return;

        previewPlayer.loop = true;
        previewPlayer.muted = true;

        // Ensure playsInline is set again after replaceAsync
        if (Platform.OS === 'web' && typeof document !== 'undefined') {
          const setPlaysInline = () => {
            const videoElements = document.querySelectorAll('video');
            videoElements.forEach((videoElement: HTMLVideoElement) => {
              videoElement.setAttribute('playsinline', 'true');
              videoElement.setAttribute('webkit-playsinline', 'true');
              videoElement.setAttribute('x5-playsinline', 'true');
              videoElement.playsInline = true;
            });
          };
          setPlaysInline();
          setTimeout(setPlaysInline, 50);
        }

        // Wait for video element to be ready before playing
        const waitForVideoReady = (): Promise<void> => {
          return new Promise<void>((resolve) => {
            if (Platform.OS === 'web' && typeof document !== 'undefined') {
              const findVideoElement = () => {
                const videoElements = document.querySelectorAll('video');
                return Array.from(videoElements).find((video: HTMLVideoElement) => {
                  return video.src === videoUrl || video.currentSrc === videoUrl;
                }) as HTMLVideoElement | undefined;
              };

              const videoElement = findVideoElement();
              if (videoElement) {
                const HAVE_CURRENT_DATA = 2;
                if (videoElement.readyState >= HAVE_CURRENT_DATA) {
                  resolve();
                } else {
                  const canPlayHandler = () => {
                    resolve();
                  };
                  videoElement.addEventListener('canplay', canPlayHandler, { once: true });

                  setTimeout(() => {
                    videoElement.removeEventListener('canplay', canPlayHandler);
                    resolve();
                  }, 500);
                }
              } else {
                resolve();
              }
            } else {
              resolve();
            }
          });
        };

        waitForVideoReady().then(() => {
          if (!previewPlayer) return;

          previewPlayer.loop = true;
          previewPlayer.muted = true;

          const playPromise = previewPlayer.play();

          if (playPromise !== undefined && typeof (playPromise as any).catch === 'function') {
            (playPromise as any).then(() => {
              if (__DEV__) {
                console.log('[OnboardingVideo] Video playing successfully after replaceAsync');
              }
            }).catch((playError: any) => {
              if (playError.name !== 'NotAllowedError') {
                if (__DEV__) {
                  console.warn(`[OnboardingVideo] Play failed (${playError.name}): ${playError.message}, retrying...`);
                }

                setTimeout(() => {
                  if (previewPlayer) {
                    const retryPlayResult = previewPlayer.play();
                    if (retryPlayResult !== undefined && typeof (retryPlayResult as any).then === 'function') {
                      (retryPlayResult as any).catch((retryError: any) => {
                        if (__DEV__ && retryError.name !== 'NotAllowedError') {
                          console.warn('[OnboardingVideo] Play retry failed:', retryError.message);
                        }
                      });
                    }
                  }
                }, 200);
              }
            });
          }
        });

        isInitialMountRef.current = false;
      }).catch((error: any) => {
        console.error('[OnboardingVideo] Error replacing video:', error);
        isInitialMountRef.current = false;
      });
    } else {
      isInitialMountRef.current = false;
    }
  }, [userVideoUri, defaultVideoUrl, previewPlayer]);

  // Hook C: Workaround timeout — backup play attempt
  useEffect(() => {
    const videoUrl = userVideoUri || defaultVideoUrl;
    if (!previewPlayer || !videoUrl) return;

    const timeoutId = setTimeout(() => {
      if (previewPlayer) {
        previewPlayer.muted = true;
        previewPlayer.loop = true;

        const playPromise = previewPlayer.play();
        if (playPromise !== undefined && typeof (playPromise as any).catch === 'function') {
          (playPromise as any).catch((error: any) => {
            if (__DEV__ && error.name !== 'NotAllowedError') {
              console.warn('[OnboardingVideo] AutoPlay workaround failed:', error);
            }
          });
        }
      }
    }, Platform.OS === 'web' ? 200 : 100);

    return () => clearTimeout(timeoutId);
  }, [previewPlayer, userVideoUri, defaultVideoUrl]);

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
          setUserVideoUri(uri);
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
          setUserVideoUri(videoAsset.uri);
          setMimeType(assetMimeType);
        }
      } catch (err) {
        console.warn('expo-image-picker not available:', err);
        Alert.alert('Video Picker Not Available', 'Please install expo-image-picker for native platforms.');
      }
    }
  };

  const handleNext = () => {
    if (hasUserVideo && userVideoUri) {
      uploadProfileVideo(userVideoUri, userId, mimeType)
        .catch(err => console.error('Background video upload error:', err));
    }
    onNext();
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

        

        {/* Main Content */}
        <View style={styles.mainContent}>

          {/* Title & Subtitle */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Show Us Your Style</Text>
          <Text style={styles.subtitle}>
            Drop a clip of you surfing so others can see how you ride
          </Text>
        </View>

          <View style={styles.previewContainer}>
            <View style={styles.videoPreview} pointerEvents="box-none">
              <View style={styles.surfSkillVideoWrapper}>
                <VideoView
                  player={previewPlayer}
                  style={styles.videoThumbnail}
                  contentFit="cover"
                  nativeControls={false}
                  allowsFullscreen={false}
                  allowsPictureInPicture={false}
                  {...(Platform.OS === 'web' && {
                    controls: false,
                    disablePictureInPicture: true,
                    playsinline: true,
                    'webkit-playsinline': true,
                    playsInline: true,
                  } as any)}
                />
                {/* Transparent overlay to prevent interactions */}
                <View style={styles.surfSkillVideoOverlay} />

                {/* Title - top left */}
                <View style={styles.surfSkillTitleOverlay}>
                  <Text style={styles.surfSkillTitleOverlayText}>Surf Skill</Text>
                </View>

                {/* Level Name and Subtitle - bottom left */}
                <View style={styles.surfSkillContentOverlay}>
                  <View style={styles.surfSkillNameContainer}>
                    <Text style={styles.surfSkillNameOverlay}>{displayName}</Text>
                  </View>
                  <Text style={styles.surfSkillSubtitleOverlay}>{subtitle}</Text>
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

          {error && (
            <Text style={styles.errorText}>{error}</Text>
          )}
        </View>

        {/* Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            onPress={hasUserVideo ? handleNext : onSkip}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#00A2B6', '#0788B0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.gradientButton, { width: buttonWidth }]}
            >
              <Text style={styles.buttonText}>{hasUserVideo ? 'Next' : 'Skip'}</Text>
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
    paddingBottom: spacing.xxl,
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
  surfSkillVideoWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  surfSkillVideoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  surfSkillTitleOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 20,
    pointerEvents: 'none',
  },
  surfSkillTitleOverlayText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: colors.white,
  },
  surfSkillContentOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    zIndex: 20,
    pointerEvents: 'none',
    gap: 4,
  },
  surfSkillNameContainer: {
    marginBottom: 4,
  },
  surfSkillNameOverlay: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 22,
    color: colors.white,
  },
  surfSkillSubtitleOverlay: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    lineHeight: 20,
    color: colors.white,
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
    zIndex: 30,
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
  gradientButton: {
    height: 56,
    borderRadius: 999,
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
});
