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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { VideoCarousel, VideoLevel } from '../VideoCarousel';
import { getSurfLevelVideos } from '../../services/media/surfLevelVideos';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialBoardType?: string | null;
  initialSurfLevel?: number | null;
  // Surf-skill editing now ONLY changes the level (and the board-paired demo
  // video the user is being shown). It does NOT touch the user's uploaded
  // video — that lives in the dedicated Surf Video editor.
  onSave?: (selectedVideoId: number) => void | Promise<void>;
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
  const [carouselHeight, setCarouselHeight] = useState<number>(0);

  // Sync on closed→open transition only — see SurfVideo screen for rationale.
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setSelectedVideoId(Math.max(0, Math.min(3, (initialSurfLevel ?? 1) - 1)));
    }
    prevVisibleRef.current = visible;
  }, [visible, initialSurfLevel]);

  // Always show Swellyo's reference videos for the user's board type. The
  // user's uploaded clip is ignored here; that lives in the Surf Video editor.
  const videos: VideoLevel[] = useMemo(() => getSurfLevelVideos(boardId), [boardId]);

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

  const handleSave = useCallback(async () => {
    try {
      if (onSave) await onSave(selectedVideoId);
      onClose();
    } catch {
      // Error already surfaced by parent — keep editor open for retry.
    }
  }, [selectedVideoId, onSave, onClose]);

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
              Select the video that best represents how you surf.
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

          </View>

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
