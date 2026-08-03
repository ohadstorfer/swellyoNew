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
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ff, fs } from '../../theme/fonts';
import { getSurfLevelMapping } from '../../utils/surfLevelMapping';
import { GalleryPermissionOverlay } from '../GalleryPermissionOverlay';
import { getSurfLevelVideos } from '../../services/media/surfLevelVideos';
import { uploadProfileVideoThumbnail, uploadSurfPhoto } from '../../services/storage/storageService';
import { startProfileVideoUpload } from '../../services/media/pendingProfileVideoUpload';
import { profileVideoUploadTracker } from '../../services/storage/profileVideoUploadTracker';
import { supabaseDatabaseService } from '../../services/database/supabaseDatabaseService';
import { captureVideoThumbnail } from '../../utils/videoThumbnail';
import {
  launchSurfMediaPicker,
  pickSurfMediaOnWeb,
  releasePickedMedia,
  usesAndroidPhotoPicker,
  type PickSurfMediaResult,
} from '../../services/media/surfMediaPicker';

/**
 * What the editor hands back on Save. The Surf Skill card shows exactly one of
 * these, so the parent writes both columns from a single shape and can never
 * leave a stale photo winning over a new clip.
 */
export type SurfSkillMediaSave =
  | { kind: 'video'; videoUri: string }
  /** The photo is already uploaded — `photoUrl` is the permanent S3 URL. */
  | { kind: 'photo'; photoUrl: string }
  | { kind: 'none' };

type Props = {
  visible: boolean;
  onClose: () => void;
  initialBoardType?: string | null;
  initialSurfLevel?: number | null; // 1-5 (DB-level)
  initialUserVideoUri?: string | null;
  initialUserPhotoUrl?: string | null;
  userId?: string | null;
  // onSave receives what the user ended up with. The S3 upload is kicked off in
  // here (video: fire-and-forget; photo: awaited, they're small) — the parent
  // only writes the DB pointers.
  onSave?: (media: SurfSkillMediaSave) => void | Promise<void>;
  saving?: boolean;
};

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

// Same wording as the onboarding upload step — the card is meant to read
// identically in both places.
const getCategorySubtitle = (category: string): string => {
  const categoryMap: { [key: string]: string } = {
    beginner: 'Just Starting',
    intermediate: 'Getting There',
    advanced: 'Doing Good',
    pro: 'Excellent',
  };
  return categoryMap[category.toLowerCase()] || 'Just Starting';
};

// Untitled UI stroke icons (upload-cloud-01 / trash-03), copied from
// OnboardingVideoUploadScreen so both cards use the exact same artwork.
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

export const ProfileEditSurfVideoScreen: React.FC<Props> = ({
  visible,
  onClose,
  initialBoardType,
  initialSurfLevel,
  initialUserVideoUri,
  initialUserPhotoUrl,
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

  // Card captions — same source the onboarding upload step reads from.
  const surfLevelInfo = getSurfLevelMapping(boardId, levelId);
  const levelName = surfLevelInfo?.description || 'Dipping My Toes';
  const levelCategory = getCategorySubtitle(surfLevelInfo?.category || 'beginner');

  /**
   * The one media slot. `isNew` marks a freshly picked local file that still
   * has to be uploaded; anything else is already live on the profile.
   * `hints` (videos only) feed the transcode decision in startProfileVideoUpload.
   */
  type EditorMedia =
    | { kind: 'video'; uri: string; isNew: boolean; mimeType?: string; hints?: { width?: number; height?: number; fileSize?: number } }
    | { kind: 'photo'; uri: string; isNew: boolean; mimeType?: string };

  // Photo wins over video when both columns somehow hold a value — same
  // precedence the Surf Skill card uses, so the editor shows what the profile shows.
  const initialMedia = useCallback((): EditorMedia | null => {
    if (initialUserPhotoUrl) return { kind: 'photo', uri: initialUserPhotoUrl, isNew: false };
    if (initialUserVideoUri) return { kind: 'video', uri: initialUserVideoUri, isNew: false };
    return null;
  }, [initialUserPhotoUrl, initialUserVideoUri]);

  const [media, setMedia] = useState<EditorMedia | null>(initialMedia);
  const [error, setError] = useState<string | null>(null);
  const [showPermissionOverlay, setShowPermissionOverlay] = useState(false);
  // Photos upload on Save (awaited — they're small), so the button needs its
  // own busy state independent of the parent's DB-write `saving`.
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Sync only on closed→open transition (same rationale as the other editors).
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setMedia(initialMedia());
      setError(null);
    }
    prevVisibleRef.current = visible;
  }, [visible, initialMedia]);

  const photoUri = media?.kind === 'photo' ? media.uri : null;

  // Pick the playable URL: user's clip if set, otherwise the Swellyo demo
  // video matching their current surf level + board type (so empty-state
  // shows the demo they're seeing on the Surf Skill page). Null while a photo
  // is showing — the player has nothing to do.
  const videoUrl = useMemo(() => {
    if (photoUri) return null;
    if (media?.kind === 'video') return media.uri;
    const demoList = getSurfLevelVideos(boardId);
    const demo = demoList.find(v => v.id === levelId) ?? demoList[0];
    return demo?.videoUrl ?? null;
  }, [photoUri, media, boardId, levelId]);

  const player = useVideoPlayer(videoUrl ?? null, p => {
    p.loop = true;
    p.muted = true;
    if (videoUrl) p.play();
  });

  // The init callback above only runs once. When the user picks a new clip
  // (videoUrl changes), expo-video swaps the source internally but does NOT
  // re-trigger play() — on iOS Simulator that surfaces as "stuck on the first
  // frame". This effect kicks play() after a short delay so the new source has
  // time to load. Mirrors the workaround timeout in OnboardingVideoUploadScreen.
  useEffect(() => {
    if (!player || !videoUrl) return;
    const timeoutId = setTimeout(() => {
      try {
        player.muted = true;
        player.loop = true;
        const result = player.play() as unknown as Promise<void> | void;
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err: any) => {
            if (__DEV__ && err?.name !== 'NotAllowedError') {
              console.warn('[SurfVideoEdit] play() rejected:', err);
            }
          });
        }
      } catch (err) {
        if (__DEV__) console.warn('[SurfVideoEdit] play() threw:', err);
      }
    }, Platform.OS === 'web' ? 200 : 100);
    return () => clearTimeout(timeoutId);
  }, [player, videoUrl]);

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

  // Applies a picker result to the single media slot. Shared by the native and
  // web paths (see surfMediaPicker for the pickers themselves).
  const applyPickResult = useCallback((result: PickSurfMediaResult) => {
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    if (result.status !== 'picked') return;
    setMedia(prev => {
      // Free the previous blob: URI on web, but only if it was a local pick —
      // a persisted https URL isn't ours to revoke.
      if (prev?.isNew) releasePickedMedia({ kind: prev.kind, uri: prev.uri });
      return { ...result.media, isNew: true } as EditorMedia;
    });
    setError(null);
  }, []);

  const launchMediaPicker = useCallback(async () => {
    applyPickResult(await launchSurfMediaPicker());
  }, [applyPickResult]);

  const pickMedia = useCallback(async () => {
    setError(null);
    if (Platform.OS === 'web') {
      applyPickResult(await pickSurfMediaOnWeb());
      return;
    }
    // Android 13+ uses the system Photo Picker (no permission, no primer).
    if (usesAndroidPhotoPicker()) {
      await launchMediaPicker();
      return;
    }
    const primerShown = await AsyncStorage.getItem('@swellyo_gallery_primer_shown');
    if (primerShown) await launchMediaPicker();
    else setShowPermissionOverlay(true);
  }, [applyPickResult, launchMediaPicker]);

  const handleSave = useCallback(async () => {
    // Drop any error from a previous attempt. Without this a stale message
    // (e.g. an upload failure) stays on screen next to a *different* failure,
    // pointing at the wrong step.
    setError(null);
    try {
      // Nothing picked (or the user hit the trash) — clear both columns.
      if (!media) {
        if (onSave) await onSave({ kind: 'none' });
        onClose();
        return;
      }

      // Untouched — re-assert what's already live so the parent still clears
      // the other column (e.g. a legacy row that has both).
      if (!media.isNew) {
        if (onSave) {
          await onSave(
            media.kind === 'photo'
              ? { kind: 'photo', photoUrl: media.uri }
              : { kind: 'video', videoUri: media.uri },
          );
        }
        onClose();
        return;
      }

      // A fresh pick can't be uploaded without a user id, and persisting the
      // raw file:// URI would leave a permanently broken image on the profile.
      if (!userId) {
        setError('Could not save — please reopen the app and try again.');
        return;
      }

      if (media.kind === 'photo') {
        // Photos are small and there's no server-side processing step, so we
        // await the upload and hand the parent a final URL. ~1s behind the
        // "Saving..." label, versus a video's minutes of MediaConvert work.
        setUploadingPhoto(true);
        const result = await uploadSurfPhoto(media.uri, userId);
        setUploadingPhoto(false);
        if (!result.success || !result.url) {
          setError(result.error || 'Failed to upload photo. Please try again.');
          return; // keep the editor open for retry
        }
        if (onSave) await onSave({ kind: 'photo', photoUrl: result.url });
        onClose();
        return;
      }

      // Kick off the S3 video upload immediately (fire-and-forget) — this
      // is what the user is actually waiting on. Shrinks + makes it resumable
      // (see startProfileVideoUpload, 2026-07-25).
      startProfileVideoUpload(media.uri, userId, {
        mimeType: media.mimeType,
        hints: media.hints,
      }).catch(err => console.error('[SurfVideoEdit] background upload failed:', err));

      // In parallel, capture a thumbnail. When it resolves it serves two
      // purposes:
      //   1. setLocalThumbnail → ProfileEditPanel flips the surf-skill card
      //      to the user's clip for this session, even before the video
      //      finishes uploading.
      //   2. uploadProfileVideoThumbnail + saveSurfer → persists the poster
      //      across reloads via profile_video_thumbnail_url.
      captureVideoThumbnail(media.uri)
        .then(thumb => {
          if (!thumb) return;
          profileVideoUploadTracker.setLocalThumbnail(userId, thumb);
          return uploadProfileVideoThumbnail(thumb, userId).then(url => {
            if (url) {
              return supabaseDatabaseService.saveSurfer({ profileVideoThumbnailUrl: url });
            }
          });
        })
        .catch(err => {
          console.warn('[SurfVideoEdit] thumbnail persist failed:', err);
        });

      // The processed URL isn't known yet (MediaConvert writes it server-side),
      // so keep whatever profile_video_url held. The photo column still has to
      // be cleared now, or the old photo would keep winning on the card.
      if (onSave) await onSave({ kind: 'video', videoUri: initialUserVideoUri ?? '' });
      onClose();
    } catch {
      setUploadingPhoto(false);
      // Error surfaced upstream; keep the editor open for retry.
    }
  }, [media, initialUserVideoUri, userId, onSave, onClose]);

  if (!mounted) return null;

  const hasUserMedia = !!media;
  const isBusy = saving || uploadingPhoto;

  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} pointerEvents="none" />
      <Animated.View
        style={[
          styles.panel,
          { width: screenWidth, transform: [{ translateX }] },
        ]}
      >
        {/* Top inset comes from JS (`insets`), NOT from a native <SafeAreaView>.
            This panel lives inside ProfileEditPanel's RN <Modal> and is
            mounted/unmounted on every open. RNCSafeAreaView pushes its inset
            through an async Fabric state update on didMoveToWindow; on a
            recycled view that update can be skipped (it caches the inset before
            its shadow-node state is attached, then early-returns on the
            equality check, and the provider only re-notifies on *change*).
            When that happens the view contributes 0 padding and never
            recovers — the Back row ends up under the Dynamic Island. The JS
            inset is read from context and is always correct, which is why the
            parent panel's header never drifts. */}
        <View style={styles.safeArea}>
          <View style={[styles.backRow, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity style={styles.backButton} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={16} color={FIGMA.textPrimary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.headerSeparator} />

          {/* Title + card ride together in the middle of the space left between
              the header and Save, so the fixed-height card doesn't leave all
              the empty room below it. */}
          <View style={styles.centerBlock}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>People Wanna See You Surf!</Text>
              <Text style={styles.subtitle}>
                Add a photo or a video — it shows in your profile, so others can see how you ride.
              </Text>
            </View>

            {/* Same card as the onboarding upload step: fixed-height frame, the
                "Surf Skill" label top-left, level name + category bottom-left and
                the upload/remove buttons bottom-right. */}
            <View style={styles.videoCard} pointerEvents="box-none">
              {photoUri ? (
                <Image
                  source={{ uri: photoUri }}
                  style={styles.videoThumbnail}
                  resizeMode="cover"
                  accessibilityLabel="Your surf photo"
                />
              ) : videoUrl ? (
                <VideoView
                  player={player}
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
              ) : (
                <View style={styles.videoPlaceholder}>
                  <ActivityIndicator color="#fff" />
                </View>
              )}

              {/* Transparent overlay to prevent interactions with the video itself */}
              <View style={styles.videoTapBlocker} />

              <Text style={styles.cardTopLabel}>Surf Skill</Text>

              <View style={styles.cardBottomBlock} pointerEvents="none">
                <Text style={styles.cardLevelName}>{levelName}</Text>
                <Text style={styles.cardLevelCategory}>{levelCategory}</Text>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.cardActionButton}
                  onPress={pickMedia}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Upload your own surf photo or video"
                >
                  <UploadCloudIcon />
                </TouchableOpacity>
                {hasUserMedia && (
                  <TouchableOpacity
                    style={styles.cardActionButton}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Remove your surf photo or video"
                    onPress={() => {
                      setMedia(prev => {
                        if (prev?.isNew) releasePickedMedia({ kind: prev.kind, uri: prev.uri });
                        return null;
                      });
                      setError(null);
                    }}
                  >
                    <TrashIcon />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={[styles.saveButtonContainer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
            <TouchableOpacity
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={isBusy}
              style={[styles.saveButton, isBusy && styles.saveButtonDisabled]}
            >
              <Text style={styles.saveButtonText}>{isBusy ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
      {Platform.OS !== 'web' && (
        <GalleryPermissionOverlay
          visible={showPermissionOverlay}
          onAllow={async () => {
            await AsyncStorage.setItem('@swellyo_gallery_primer_shown', 'true');
            setShowPermissionOverlay(false);
            launchMediaPicker();
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
  // ---- Video card (mirrors OnboardingVideoUploadScreen) ------------------
  videoCard: {
    marginHorizontal: 16,
    marginTop: 16,
    height: 243,
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
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: FIGMA.overlayButtonBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBlock: {
    flex: 1,
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
