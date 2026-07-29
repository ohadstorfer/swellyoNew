import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../components/Text';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GalleryPermissionOverlay } from '../components/GalleryPermissionOverlay';
import { ff, fs } from '../theme/fonts';
import { useRegisterOnboardingStep } from '../context/OnboardingStepContext';
import { getSurfLevelMapping } from '../utils/surfLevelMapping';
import { validateVideoComplete } from '../utils/videoValidation';
import { startProfileVideoUpload } from '../services/media/pendingProfileVideoUpload';
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

// Untitled UI stroke icons from the Figma design (upload-cloud-01 / trash-03),
// rebuilt as react-native-svg paths. Each sits centred in a 24x24 box, keeping
// the leaf dimensions the design gives them.
const UploadCloudIcon = () => (
  <View style={styles.actionIconBox}>
    <Svg width={21.5} height={19.5} viewBox="0 0 21.5 19.5" fill="none">
      <Path
        d="M2.75 13.9922C1.54401 13.185 0.75 11.8102 0.75 10.25C0.75 7.90643 2.54151 5.98129 4.82974 5.76937C5.29781 2.92213 7.77024 0.75 10.75 0.75C13.7298 0.75 16.2022 2.92213 16.6703 5.76937C18.9585 5.98129 20.75 7.90643 20.75 10.25C20.75 11.8102 19.956 13.185 18.75 13.9922M14.75 13.75L10.75 9.75L6.75 13.75M10.75 9.75V18.75"
        stroke="#FFFFFF"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  </View>
);

const TrashIcon = () => (
  <View style={styles.actionIconBox}>
    <Svg width={19.5} height={19.5} viewBox="0 0 19.5 19.5" fill="none">
      <Path
        d="M6.75 0.75H12.75M0.75 3.75H18.75M16.75 3.75L16.0487 14.2693C15.9435 15.8475 15.8909 16.6367 15.55 17.235C15.2499 17.7618 14.7972 18.1853 14.2517 18.4497C13.632 18.75 12.8411 18.75 11.2593 18.75H8.24065C6.65891 18.75 5.86803 18.75 5.24834 18.4497C4.70276 18.1853 4.25009 17.7618 3.94998 17.235C3.60911 16.6367 3.5565 15.8475 3.45129 14.2693L2.75 3.75M7.75 8.25V13.25M11.75 8.25V13.25"
        stroke="#FFFFFF"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  </View>
);

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
  const [userVideoUri, setUserVideoUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | undefined>(undefined);
  // Picker asset hints so the pre-upload transcode decision is right without
  // probing the file (see startProfileVideoUpload / videoTranscode.shouldTranscode).
  const [videoHints, setVideoHints] = useState<{ width?: number; height?: number; fileSize?: number } | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showPermissionOverlay, setShowPermissionOverlay] = useState(false);

  const hasUserVideo = userVideoUri !== null;

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
      player.audioMixingMode = 'mixWithOthers';
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

  const launchVideoPicker = async () => {
    try {
      const ImagePicker = require('expo-image-picker');
      const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;

      if (!usePhotoPicker) {
        const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          if (!canAskAgain) {
            Alert.alert(
              'Permission Required',
              'Swellyo needs access to your photos. Please enable it in your device settings.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ]
            );
          } else {
            Alert.alert('Permission Required', 'Sorry, we need media library permissions to upload your video!');
          }
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
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
        setVideoHints({
          width: videoAsset.width,
          height: videoAsset.height,
          fileSize: (videoAsset as any).fileSize,
        });
      }
    } catch (err) {
      console.warn('expo-image-picker not available:', err);
      Alert.alert('Video Picker Not Available', 'Please install expo-image-picker for native platforms.');
    }
  };

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
          setVideoHints({ fileSize: file.size });
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
      const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;
      if (usePhotoPicker) {
        await launchVideoPicker();
      } else {
        const primerShown = await AsyncStorage.getItem('@swellyo_gallery_primer_shown');
        if (primerShown) {
          await launchVideoPicker();
        } else {
          setShowPermissionOverlay(true);
        }
      }
    }
  };

  // Trash button: drop the picked clip and fall back to the default surf-level
  // preview. A no-op when the user hasn't picked anything yet.
  const clearVideo = () => {
    setError(null);
    if (!userVideoUri) return;
    if (Platform.OS === 'web' && userVideoUri.startsWith('blob:')) {
      URL.revokeObjectURL(userVideoUri);
    }
    setUserVideoUri(null);
    setMimeType(undefined);
    setVideoHints(undefined);
  };

  const handleNext = () => {
    if (hasUserVideo && userVideoUri) {
      // Shrink → durable copy → resumable upload. Fire-and-forget: the user
      // never waits, but the upload survives an app-kill and won't saturate
      // the first session (see startProfileVideoUpload, 2026-07-25).
      startProfileVideoUpload(userVideoUri, userId, { mimeType, hints: videoHints })
        .catch(err => console.error('Background S3 video upload error:', err));
    }
    onNext();
  };

  useRegisterOnboardingStep({
    nextLabel: hasUserVideo ? 'Next' : 'Skip',
    canProceed: true,
    onNext: hasUserVideo ? handleNext : onSkip,
    onBack,
  });

  return (
    <>
      {/* Main Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.mainContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title & Subtitle */}
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Show us your style</Text>
          <Text style={styles.subtitle}>
            Drop a clip of you surfing so others can see how you ride
          </Text>
        </View>

        <View style={styles.videoCard} pointerEvents="box-none">
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
          {/* Transparent overlay to prevent interactions with the video itself */}
          <View style={styles.videoTapBlocker} />

          {/* "Surf Skill" — top left */}
          <Text style={styles.cardTopLabel}>Surf Skill</Text>

          {/* Level name + category — bottom left */}
          <View style={styles.cardBottomBlock} pointerEvents="none">
            <Text style={styles.cardLevelName}>{displayName}</Text>
            <Text style={styles.cardLevelCategory}>{subtitle}</Text>
          </View>

          {/* Upload / remove — bottom right */}
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.cardActionButton}
              onPress={pickVideo}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Upload your own surf video"
              testID="video-upload-button"
            >
              <UploadCloudIcon />
            </TouchableOpacity>
            {/* Nothing to delete until the user replaces the default clip. */}
            {hasUserVideo && (
              <TouchableOpacity
                style={styles.cardActionButton}
                onPress={clearVideo}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Remove your surf video"
                testID="video-remove-button"
              >
                <TrashIcon />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        <View style={styles.messageBlock}>
          <Text style={styles.messageText}>
            This helps us match you with the right people, trips, and surf experiences. No pressure,
          </Text>
          <Text style={styles.messageEmphasis}>Just be you!</Text>
        </View>
      </ScrollView>
      {Platform.OS !== 'web' && (
      <GalleryPermissionOverlay
        visible={showPermissionOverlay}
        onAllow={async () => {
          await AsyncStorage.setItem('@swellyo_gallery_primer_shown', 'true');
          setShowPermissionOverlay(false);
          launchVideoPicker();
        }}
        onDismiss={() => setShowPermissionOverlay(false)}
      />
    )}
    </>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  mainContent: {
    flexGrow: 1,
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 24,
  },

  // ---- Header ----------------------------------------------------------
  headerBlock: {
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontFamily: ff('Montserrat', '700'),
    ...(Platform.OS === 'web' && { fontWeight: '700' as const }),
    fontSize: fs(24),
    lineHeight: 28.8, // 120% of 24px
    letterSpacing: -1,
    color: '#05BCD3',
    textAlign: 'center',
    includeFontPadding: false,
  },
  subtitle: {
    fontFamily: ff('Montserrat', '700'),
    ...(Platform.OS === 'web' && { fontWeight: '700' as const }),
    fontSize: fs(18),
    lineHeight: 24,
    color: '#333333',
    textAlign: 'center',
    paddingHorizontal: 16,
    includeFontPadding: false,
  },

  // ---- Video card ------------------------------------------------------
  videoCard: {
    width: '100%',
    height: 243,
    marginTop: 48,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000000',
    position: 'relative',
  },
  videoThumbnail: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' && {
      // Force the underlying <video> element to fill the box on web. The
      // VideoView contentFit prop alone isn't always honored by expo-video
      // on web, so we set object-fit explicitly to guarantee fill (no bars).
      objectFit: 'cover' as any,
      objectPosition: 'center center' as any,
    }),
  },
  videoTapBlocker: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  cardTopLabel: {
    position: 'absolute',
    top: 20,
    left: 16,
    fontFamily: ff('Inter', '700'),
    ...(Platform.OS === 'web' && { fontWeight: '700' as const }),
    fontSize: fs(18),
    lineHeight: 22,
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  cardBottomBlock: {
    position: 'absolute',
    left: 16,
    bottom: 23,
    gap: 4,
  },
  cardLevelName: {
    fontFamily: ff('Inter', '700'),
    ...(Platform.OS === 'web' && { fontWeight: '700' as const }),
    fontSize: fs(16),
    lineHeight: 22,
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  cardLevelCategory: {
    fontFamily: ff('Inter', '400'),
    ...(Platform.OS === 'web' && { fontWeight: '400' as const }),
    fontSize: fs(10),
    lineHeight: 14,
    color: '#DADADA',
    includeFontPadding: false,
  },
  cardActions: {
    position: 'absolute',
    right: 16,
    bottom: 29,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardActionButton: {
    width: 44,
    height: 44,
    borderRadius: 40,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ---- Message ---------------------------------------------------------
  messageBlock: {
    width: '100%',
    marginTop: 48,
    alignItems: 'center',
  },
  messageText: {
    fontFamily: ff('Inter', '400'),
    ...(Platform.OS === 'web' && { fontWeight: '400' as const }),
    fontSize: fs(14),
    lineHeight: 18,
    color: '#7B7B7B',
    textAlign: 'center',
    includeFontPadding: false,
  },
  messageEmphasis: {
    marginTop: 18,
    fontFamily: ff('Inter', '700'),
    ...(Platform.OS === 'web' && { fontWeight: '700' as const }),
    fontSize: fs(18),
    lineHeight: 22,
    color: '#7B7B7B',
    textAlign: 'center',
    includeFontPadding: false,
  },

  errorText: {
    fontFamily: ff('Inter', '400'),
    ...(Platform.OS === 'web' && { fontWeight: '400' as const }),
    fontSize: fs(13),
    color: '#E53E3E',
    textAlign: 'center',
    marginTop: 12,
  },
});
