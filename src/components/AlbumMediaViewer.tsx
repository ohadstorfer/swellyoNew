/**
 * Fullscreen viewer for an ALBUM's media with horizontal swipe between items
 * (WhatsApp behavior). Single non-album media keep FullscreenImageViewer /
 * FullscreenVideoPlayer; this component exists because those are one-item
 * viewers and an album tap should land you in a pager, not a dead end.
 *
 * Pages:
 * - Images copy FullscreenImageViewer's instant-thumbnail trick — the bubble's
 *   cached thumbnail paints immediately, full-res fades in on top.
 * - Videos mount ONE live player (the active page only; swiping away unmounts
 *   and releases it), autoplay like FullscreenVideoPlayer, tap to toggle.
 *   DM video URLs are presigned per view: signing kicks off lazily when a
 *   video page becomes active, with the poster covering the round trip.
 *
 * Vertical pan-to-dismiss uses the exact recipe of both single viewers
 * (activeOffsetY ±15 / failOffsetX ±25), so horizontal drags go to the pager
 * and vertical drags dismiss.
 *
 * Native-only by usage: the hosts route web album taps to the single-item
 * viewers instead (expo-video playback + RNGH pan are mobile-tuned here).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Platform,
  StatusBar,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { Message } from '../services/messaging/messagingService';
import { ff } from '../theme/fonts';

interface AlbumMediaViewerProps {
  visible: boolean;
  /** The album's items, chronological (send order). */
  items: Message[];
  /** Which item was tapped. */
  initialIndex: number;
  onClose: () => void;
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

const CloseIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 6L6 18M6 6l12 12"
      stroke="#FFFFFF"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const PlayIcon = () => (
  <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
    <Path d="M8 5v14l11-7z" fill="#FFFFFF" />
  </Svg>
);

const isVideoMessage = (m: Message): boolean => m.type === 'video' || !!m.video_metadata;
const itemKey = (m: Message): string => m.client_id || m.id;
const videoPoster = (m: Message): string =>
  m.video_metadata?.thumbnail_url || m._localPreviewUri || '';

/**
 * The active video page — mirrors FullscreenVideoPlayer's NativeVideoPlayer:
 * autoplay once the (possibly still-signing) URL lands, poster covers the
 * wait, tap toggles. Mounted only while its page is active.
 */
const AlbumVideoPage: React.FC<{ url: string | null; posterUrl: string }> = ({ url, posterUrl }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);

  // Source flips null → signed URL; the setup callback re-runs and autoplays.
  const player = useVideoPlayer(url ?? null, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying: next }) => {
      setIsPlaying(next);
    });
    setIsPlaying(player.playing);
    return () => sub.remove();
  }, [player]);

  const togglePlay = () => {
    if (!url) return;
    try {
      if (player.playing) player.pause();
      else player.play();
    } catch {}
  };

  return (
    <Pressable style={styles.pageFill} onPress={togglePlay}>
      <VideoView
        player={player}
        style={styles.media}
        contentFit="contain"
        nativeControls={false}
        onFirstFrameRender={() => setFirstFrameRendered(true)}
      />
      {!!posterUrl && !firstFrameRendered && (
        <Animated.View exiting={FadeOut.duration(200)} style={styles.pageFillAbsolute} pointerEvents="none">
          <ExpoImage
            source={{ uri: posterUrl }}
            style={styles.media}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
        </Animated.View>
      )}
      {!isPlaying && (firstFrameRendered || !posterUrl) && (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={styles.playButtonOverlay}
          pointerEvents="none"
        >
          <View style={styles.playButtonCircle}>
            <PlayIcon />
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
};

export const AlbumMediaViewer: React.FC<AlbumMediaViewerProps> = ({
  visible,
  items,
  initialIndex,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const { width, height: screenHeight } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  // Signed playable URLs per item key. Signing starts when a video page
  // becomes active; the ref dedupes in-flight requests.
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const signRequestedRef = useRef<Set<string>>(new Set());
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setActiveIndex(initialIndex);
      translateY.value = 0;
    }
  }, [visible, initialIndex, translateY]);

  // Lazily sign the active video's URL (same round trip the video bubble does,
  // hidden behind the poster).
  useEffect(() => {
    if (!visible) return;
    const m = items[activeIndex];
    if (!m || !isVideoMessage(m)) return;
    const key = itemKey(m);
    if (signRequestedRef.current.has(key)) return;
    signRequestedRef.current.add(key);
    const fallback = m.video_metadata?.video_url || m.video_metadata?.original_url || '';
    const storagePath = m.video_metadata?.storage_path;
    if (!storagePath) {
      if (fallback) setSignedUrls((prev) => ({ ...prev, [key]: fallback }));
      return;
    }
    import('../services/messaging/videoUploadService')
      .then(({ signDmVideoUrl }) => signDmVideoUrl(storagePath))
      .then((signed) => {
        const url = signed || fallback;
        if (url) setSignedUrls((prev) => ({ ...prev, [key]: url }));
      })
      .catch(() => {
        if (fallback) setSignedUrls((prev) => ({ ...prev, [key]: fallback }));
      });
  }, [visible, activeIndex, items]);

  // Same dismiss recipe as FullscreenImageViewer/-VideoPlayer: vertical drags
  // dismiss, horizontal drags fail the pan and feed the pager instead.
  const panGesture = Gesture.Pan()
    .activeOffsetY([-15, 15])
    .failOffsetX([-25, 25])
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const distance = Math.abs(e.translationY);
      const velocity = Math.abs(e.velocityY);
      if (distance > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
        const destination = e.translationY > 0 ? screenHeight : -screenHeight;
        translateY.value = withTiming(destination, { duration: 220 }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 180 });
      }
    });

  const animatedContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(
      Math.abs(translateY.value),
      [0, screenHeight * 0.4],
      [1, 0.6],
      Extrapolation.CLAMP,
    ),
  }));

  const renderPage = ({ item, index }: { item: Message; index: number }) => {
    if (isVideoMessage(item)) {
      const poster = videoPoster(item);
      if (index !== activeIndex) {
        // Inactive video: poster only — one live player at a time.
        return (
          <View style={[styles.pageFill, { width }]}>
            {!!poster && (
              <ExpoImage
                source={{ uri: poster }}
                style={styles.media}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
              />
            )}
            <View style={styles.playButtonOverlay} pointerEvents="none">
              <View style={styles.playButtonCircle}>
                <PlayIcon />
              </View>
            </View>
          </View>
        );
      }
      return (
        <View style={{ width }}>
          <AlbumVideoPage url={signedUrls[itemKey(item)] ?? null} posterUrl={poster} />
        </View>
      );
    }
    const fullUrl = item.image_metadata?.image_url || item._localPreviewUri || '';
    const thumbUrl = item.image_metadata?.thumbnail_url || '';
    return (
      <View style={[styles.pageFill, { width }]}>
        {/* Thumbnail stays mounted underneath (instant from expo-image cache);
            the full-res fades in on top — never a blank frame. */}
        {!!thumbUrl && (
          <ExpoImage
            source={{ uri: thumbUrl }}
            style={styles.mediaAbsolute}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
        )}
        {!!fullUrl && (
          <ExpoImage
            source={{ uri: fullUrl }}
            style={styles.mediaAbsolute}
            contentFit="contain"
            cachePolicy="memory-disk"
            priority="high"
            transition={200}
          />
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <GestureHandlerRootView style={styles.flex}>
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.container, animatedContentStyle]}>
            <FlatList
              data={items}
              renderItem={renderPage}
              keyExtractor={itemKey}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0))}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / width);
                if (index !== activeIndex && index >= 0 && index < items.length) {
                  setActiveIndex(index);
                }
              }}
              extraData={`${activeIndex}-${Object.keys(signedUrls).length}`}
              style={styles.flex}
            />

            {/* "2 of 6" position counter, WhatsApp-style. */}
            <View style={[styles.counterPill, { top: insets.top + 18 }]} pointerEvents="none">
              <Text style={styles.counterText}>
                {Math.min(activeIndex + 1, items.length)} of {items.length}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.closeButton, { top: insets.top + 12 }]}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <CloseIcon />
            </TouchableOpacity>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  pageFill: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageFillAbsolute: {
    ...StyleSheet.absoluteFillObject,
  },
  media: {
    width: '100%',
    height: '100%',
  },
  mediaAbsolute: {
    ...StyleSheet.absoluteFillObject,
  },
  playButtonOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
  },
  closeButton: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(40, 40, 40, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  counterPill: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(40, 40, 40, 0.85)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    zIndex: 10,
  },
  counterText: {
    fontFamily: ff('Inter', '500'),
    fontSize: 13,
    color: '#FFFFFF',
  },
});
