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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVideoPlayer, VideoView } from 'expo-video';
import { GalleryPermissionOverlay } from '../GalleryPermissionOverlay';
import { getSurfLevelVideos } from '../../services/media/surfLevelVideos';
import { validateVideoComplete } from '../../utils/videoValidation';
import { uploadProfileVideoS3 } from '../../services/storage/storageService';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialBoardType?: string | null;
  initialSurfLevel?: number | null; // 1-5 (DB-level)
  initialUserVideoUri?: string | null;
  userId?: string | null;
  // onSave receives the video URI to persist (or null to clear). The parent
  // is responsible for kicking off the S3 upload + writing profile_video_url.
  // Returning the value lets the parent decide whether to upload.
  onSave?: (userVideoUri: string | null) => void | Promise<void>;
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
  soft_top: 0,
};

function dbBoardToId(boardType?: string | null): number {
  if (!boardType) return 0;
  return BOARD_DB_TO_ID[boardType.toLowerCase()] ?? 0;
}

export const ProfileEditSurfVideoScreen: React.FC<Props> = ({
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
  const levelId = Math.max(0, Math.min(3, (initialSurfLevel ?? 1) - 1));

  const [userVideoUri, setUserVideoUri] = useState<string | null>(initialUserVideoUri ?? null);
  const [mimeType, setMimeType] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showPermissionOverlay, setShowPermissionOverlay] = useState(false);

  // Sync only on closed→open transition (same rationale as the other editors).
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setUserVideoUri(initialUserVideoUri ?? null);
      setMimeType(undefined);
      setError(null);
    }
    prevVisibleRef.current = visible;
  }, [visible, initialUserVideoUri]);

  // Pick the playable URL: user's clip if set, otherwise the Swellyo demo
  // video matching their current surf level + board type (so empty-state
  // shows the demo they're seeing on the Surf Skill page).
  const videoUrl = useMemo(() => {
    if (userVideoUri) return userVideoUri;
    const demoList = getSurfLevelVideos(boardId);
    const demo = demoList.find(v => v.id === levelId) ?? demoList[0];
    return demo?.videoUrl ?? null;
  }, [userVideoUri, boardId, levelId]);

  const player = useVideoPlayer(videoUrl ?? null, p => {
    p.loop = true;
    p.muted = true;
    if (videoUrl) p.play();
  });

  useEffect(() => {
    if (visible && !mounted) {
      translateX.setValue(screenWidth);
      backdropOpacity.setValue(0);
      setMounted(true);
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
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
        Animated.timing(backdropOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
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
        setError(null);
      }
    } catch (err) {
      console.warn('expo-image-picker not available:', err);
      Alert.alert('Video Picker Not Available', 'Please install expo-image-picker for native platforms.');
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
        if (primerShown) await launchVideoPicker();
        else setShowPermissionOverlay(true);
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
        // Fire-and-forget: Edge Function writes profile_video_url after
        // MediaConvert finishes. Persist the OLD url here so the DB never
        // holds a local URI.
        uploadProfileVideoS3(userVideoUri, userId, mimeType).catch(err =>
          console.error('[SurfVideoEdit] background upload failed:', err),
        );
        if (onSave) await onSave(initialUserVideoUri ?? null);
      } else {
        if (onSave) await onSave(userVideoUri);
      }
      onClose();
    } catch {
      // Error surfaced upstream; keep the editor open for retry.
    }
  }, [userVideoUri, initialUserVideoUri, mimeType, userId, onSave, onClose]);

  if (!mounted) return null;

  const hasUserVideo = !!userVideoUri;

  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} pointerEvents="none" />
      <Animated.View
        style={[
          styles.panel,
          { width: screenWidth, transform: [{ translateX }] },
        ]}
      >
        <SafeAreaContainer style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={[styles.backRow, { paddingTop: 6 }]}>
            <TouchableOpacity style={styles.backButton} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={16} color={FIGMA.textPrimary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.headerSeparator} />

          <View style={styles.titleBlock}>
            <Text style={styles.title}>People Wanna See You Surf!</Text>
            <Text style={styles.subtitle}>
              The video shows in your profile, so others can see how you ride.
            </Text>
          </View>

          <View style={styles.videoWrap}>
            {videoUrl ? (
              <VideoView
                player={player}
                style={styles.video}
                contentFit="cover"
                nativeControls={false}
              />
            ) : (
              <View style={styles.videoPlaceholder}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
            {/* Upload + trash overlay buttons */}
            <View style={styles.overlayButtons} pointerEvents="box-none">
              <TouchableOpacity style={styles.overlayButton} activeOpacity={0.7} onPress={pickVideo}>
                <Ionicons name="cloud-upload-outline" size={20} color="#FFFFFF" />
              </TouchableOpacity>
              {hasUserVideo && (
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
              )}
            </View>
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={[styles.saveButtonContainer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
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
  root: { ...StyleSheet.absoluteFillObject },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: FIGMA.bg,
  },
  safeArea: { flex: 1 },
  backRow: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: FIGMA.textPrimary,
  },
  headerSeparator: {
    height: 1,
    backgroundColor: FIGMA.border,
  },
  titleBlock: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: FIGMA.textPrimary,
    fontFamily: Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: FIGMA.textSecondary,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    lineHeight: 20,
  },
  videoWrap: {
    flex: 1,
    margin: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  video: { width: '100%', height: '100%' },
  videoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayButtons: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  overlayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: FIGMA.overlayButtonBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#E53935',
    fontSize: 13,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  saveButtonContainer: {
    paddingHorizontal: 16,
  },
  saveButton: {
    backgroundColor: FIGMA.buttonBg,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: FIGMA.buttonText,
    fontSize: 16,
    fontWeight: '600',
  },
});
