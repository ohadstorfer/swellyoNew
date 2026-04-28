import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VideoCarousel, VideoLevel } from '../VideoCarousel';
import { GalleryPermissionOverlay } from '../GalleryPermissionOverlay';
import { getSurfLevelVideos } from '../../services/media/surfLevelVideos';
import { validateVideoComplete } from '../../utils/videoValidation';
import { uploadProfileVideoS3 } from '../../services/storage/storageService';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialBoardType?: string | null;
  initialSurfLevel?: number | null;
  initialUserVideoUri?: string | null;
  userId?: string | null;
  onSave?: (selectedVideoId: number, userVideoUri: string | null) => void | Promise<void>;
  saving?: boolean;
};

const SafeAreaContainer = Platform.OS === 'web' ? View : SafeAreaView;

const FIGMA = {
  bg: '#FFFFFF',
  border: '#EEEEEE',
  textPrimary: '#212121',
  textSecondary: '#7B7B7B',
  buttonBg: '#212121',
  buttonText: '#FFFFFF',
  overlayButtonBg: '#333333',
};

const BOARD_DB_TO_ID: Record<string, number> = {
  shortboard: 0,
  mid_length: 1,
  longboard: 2,
  soft_top: 0, // soft top has no dedicated videos — fall back to shortboard
};

function dbBoardToId(boardType?: string | null): number {
  if (!boardType) return 0;
  return BOARD_DB_TO_ID[boardType.toLowerCase()] ?? 0;
}

export const ProfileEditSurfSkillScreen: React.FC<Props> = ({
  visible,
  onClose,
  initialBoardType,
  initialSurfLevel,
  initialUserVideoUri,
  userId,
  onSave,
  saving = false,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  const translateX = useRef(new Animated.Value(screenWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const boardId = dbBoardToId(initialBoardType);
  const initialId = Math.max(0, Math.min(3, (initialSurfLevel ?? 1) - 1));

  const [selectedVideoId, setSelectedVideoId] = useState<number>(initialId);
  const [userVideoUri, setUserVideoUri] = useState<string | null>(initialUserVideoUri ?? null);
  const [mimeType, setMimeType] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showPermissionOverlay, setShowPermissionOverlay] = useState(false);
  const [carouselHeight, setCarouselHeight] = useState<number>(0);

  // Sync only on closed→open transition. A re-run mid-interaction (e.g. the
  // parent context emitting after another save) would yank the user's
  // selection back to the upstream value while they're still picking.
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setSelectedVideoId(Math.max(0, Math.min(3, (initialSurfLevel ?? 1) - 1)));
      setUserVideoUri(initialUserVideoUri ?? null);
      setMimeType(undefined);
      setError(null);
    }
    prevVisibleRef.current = visible;
  }, [visible, initialSurfLevel, initialUserVideoUri]);

  // Build the videos list. When a user video exists, swap the videoUrl on the
  // currently-selected level so the main player shows their clip while the
  // thumbnails remain the static level images.
  const videos: VideoLevel[] = useMemo(() => {
    const base = getSurfLevelVideos(boardId);
    if (!userVideoUri) return base;
    return base.map(v =>
      v.id === selectedVideoId ? { ...v, videoUrl: userVideoUri } : v,
    );
  }, [boardId, userVideoUri, selectedVideoId]);

  useEffect(() => {
    if (visible && !mounted) {
      translateX.setValue(screenWidth);
      backdropOpacity.setValue(0);
      setMounted(true);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: 520,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, mounted, screenWidth, translateX, backdropOpacity]);

  useEffect(() => {
    if (mounted && !visible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: screenWidth,
          duration: 320,
          easing: Easing.bezier(0.64, 0, 0.78, 0),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [mounted, visible, screenWidth, translateX, backdropOpacity]);

  const handleVideoSelect = useCallback((video: VideoLevel) => {
    setSelectedVideoId(video.id);
  }, []);

  const launchVideoPicker = useCallback(async () => {
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
              ],
            );
          } else {
            Alert.alert(
              'Permission Required',
              'Sorry, we need media library permissions to upload your video!',
            );
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
        setError(null);
      }
    } catch (err) {
      console.warn('expo-image-picker not available:', err);
      Alert.alert(
        'Video Picker Not Available',
        'Please install expo-image-picker for native platforms.',
      );
    }
  }, []);

  const pickVideo = useCallback(async () => {
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
  }, [launchVideoPicker]);

  const isLocalUri = (uri: string): boolean =>
    uri.startsWith('file://') ||
    uri.startsWith('content://') ||
    uri.startsWith('blob:') ||
    uri.startsWith('data:');

  const handleSave = useCallback(async () => {
    try {
      const isFreshLocalUri =
        userVideoUri !== null &&
        userVideoUri !== initialUserVideoUri &&
        isLocalUri(userVideoUri);

      if (isFreshLocalUri && userId && userVideoUri) {
        // Fire-and-forget: the Edge Function (process-profile-video-s3) writes
        // surfers.profile_video_url after MediaConvert finishes processing.
        // Persist the OLD url here so the DB never holds a local URI.
        uploadProfileVideoS3(userVideoUri, userId, mimeType).catch(err =>
          console.error('[SurfSkillEdit] background upload failed:', err),
        );
        if (onSave) await onSave(selectedVideoId, initialUserVideoUri ?? null);
      } else {
        if (onSave) await onSave(selectedVideoId, userVideoUri);
      }
      onClose();
    } catch {
      // Error already surfaced by parent — keep editor open for retry.
    }
  }, [
    selectedVideoId,
    userVideoUri,
    initialUserVideoUri,
    mimeType,
    userId,
    onSave,
    onClose,
  ]);

  if (!mounted) return null;

  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents="none"
      />
      <Animated.View
        style={[
          styles.panel,
          { width: screenWidth, transform: [{ translateX }] },
        ]}
      >
        <SafeAreaContainer style={styles.safeArea} edges={['top', 'bottom']}>
          <View
            style={[
              styles.backRow,
              { paddingTop: 6 },
            ]}
          >
            <TouchableOpacity
              style={styles.backButton}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={16} color={FIGMA.textPrimary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.headerSeparator} />

          <View style={styles.titleBlock}>
            <Text style={styles.title}>Surf Skill</Text>
            <Text style={styles.subtitle}>
              Select the video that best represents how you surf or Drop a clip of you
              surfing so others can see how you ride
            </Text>
          </View>

          <View
            style={styles.carouselWrapper}
            onLayout={e => setCarouselHeight(e.nativeEvent.layout.height)}
          >
            {(() => {
              // VideoCarousel uses `availableVideoHeight` for the MAIN video only;
              // it also renders an ~80px thumbnail strip + ~24px dots + spacing
              // below. Reserve that space so the video sizes adaptively without
              // crowding the rest of the layout.
              const VIDEO_RESERVED_BELOW = 140;
              const videoOnlyHeight = carouselHeight - VIDEO_RESERVED_BELOW;
              return (
                <VideoCarousel
                  videos={videos}
                  selectedVideoId={selectedVideoId}
                  onVideoSelect={handleVideoSelect}
                  availableVideoHeight={
                    videoOnlyHeight > 0 ? videoOnlyHeight : undefined
                  }
                />
              );
            })()}

            {/* Upload + trash overlay buttons */}
            <View style={styles.overlayButtons} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.overlayButton}
                activeOpacity={0.7}
                onPress={pickVideo}
              >
                <Ionicons name="cloud-upload-outline" size={20} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.overlayButton}
                activeOpacity={0.7}
                onPress={() => {
                  setUserVideoUri(null);
                  setMimeType(undefined);
                  setError(null);
                }}
              >
                <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View
            style={[
              styles.saveButtonContainer,
              { paddingBottom: Math.max(insets.bottom, 24) },
            ]}
          >
            <TouchableOpacity
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={saving}
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            >
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaContainer>
      </Animated.View>
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
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: FIGMA.bg,
  },
  safeArea: {
    flex: 1,
  },
  backRow: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    height: 40,
    minWidth: 70,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: FIGMA.border,
  },
  backButtonText: {
    fontSize: 12,
    lineHeight: 18,
    color: FIGMA.textPrimary,
  },
  headerSeparator: {
    height: 1,
    backgroundColor: FIGMA.border,
    marginHorizontal: 16,
  },
  titleBlock: {
    paddingTop: 32,
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 22,
    lineHeight: 32,
    fontWeight: '700',
    color: FIGMA.textPrimary,
    textAlign: 'center',
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  carouselWrapper: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  overlayButtons: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 12,
    right: 50,
    // Sits just above the thumbnail strip (VIDEO_RESERVED_BELOW = 140),
    // pinned to the bottom-left of the main video area.
    bottom: 156,
  },
  overlayButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: FIGMA.overlayButtonBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  saveButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: FIGMA.buttonBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: FIGMA.buttonText,
    ...Platform.select({
      web: { fontFamily: 'Montserrat, sans-serif' },
      default: { fontFamily: 'Montserrat' },
    }),
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#FF6B6B',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});

export default ProfileEditSurfSkillScreen;
