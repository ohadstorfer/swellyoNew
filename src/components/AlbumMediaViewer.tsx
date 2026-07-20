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
  ActivityIndicator,
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
  Easing,
  cancelAnimation,
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

const formatClock = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
};

// Live scrubbing (the frame follows the finger) is iOS-only for now. ExoPlayer
// on this SDK can only do EXACT seeks — each decodes from the previous
// keyframe, so seeking while dragging queues up and freezes the preview. The
// fast keyframe seeking that makes it smooth (seekTolerance +
// scrubbingModeOptions, Media3 "live scrubbing") ships with expo-video 55 /
// SDK 55 — flip this on for Android after that upgrade. Until then Android
// drags the bar only and seeks once on release.
const LIVE_SCRUB_ENABLED = Platform.OS !== 'android';

const isVideoMessage = (m: Message): boolean => m.type === 'video' || !!m.video_metadata;
const itemKey = (m: Message): string => m.client_id || m.id;
const videoPoster = (m: Message): string =>
  m.video_metadata?.thumbnail_url || m._localPreviewUri || '';

/**
 * The active video page — mirrors FullscreenVideoPlayer's NativeVideoPlayer:
 * autoplay once the (possibly still-signing) URL lands, poster covers the
 * wait, tap toggles. Mounted only while its page is active.
 */
/** Mirrors FullscreenVideoPlayer's LOADER_DELAY_MS — see the rationale there. */
const LOADER_DELAY_MS = 220;

const AlbumVideoPage: React.FC<{ url: string | null; posterUrl: string }> = ({ url, posterUrl }) => {
  const insets = useSafeAreaInsets();
  const [isPlaying, setIsPlaying] = useState(false);
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const [duration, setDuration] = useState(0);
  // Whole seconds only — timeUpdate fires 4×/s but React bails out on the
  // identical floored value, so the label re-renders once per second.
  const [timeLabel, setTimeLabel] = useState(0);
  // Scrub state lives on the UI thread so dragging never re-renders the video.
  const progress = useSharedValue(0);   // 0..1 played fraction (or scrub target)
  const scrubbing = useSharedValue(0);  // 1 while the finger is on the track
  const barWidth = useSharedValue(0);

  // Played to the end (loop is off) — the next "play" must restart, not resume.
  const endedRef = useRef(false);

  // Source flips null → signed URL; the setup callback re-runs and autoplays.
  const player = useVideoPlayer(url ?? null, (p) => {
    p.loop = false;
    p.muted = false;
    // timeUpdate is disabled (interval 0) by default — the seek bar needs it.
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying: next }) => {
      if (next) endedRef.current = false;
      setIsPlaying(next);
    });
    const timeSub = player.addListener('timeUpdate', ({ currentTime }) => {
      const dur = player.duration;
      if (isFinite(dur) && dur > 0) {
        setDuration(dur);
        // While the finger owns the track, playback must not fight it.
        if (!scrubbing.value) {
          const target = Math.min(currentTime / dur, 1);
          // The 250ms ticks are discrete; a LINEAR tween of the same length
          // turns them into continuous motion (constant motion → linear
          // easing). A big delta is a seek or restart, not playback — snap,
          // or the knob would visibly sweep across the bar.
          if (Math.abs(target - progress.value) > 0.1) {
            progress.value = target;
          } else {
            progress.value = withTiming(target, { duration: 260, easing: Easing.linear });
          }
          setTimeLabel(Math.floor(currentTime));
        }
      }
    });
    const endSub = player.addListener('playToEnd', () => {
      endedRef.current = true;
      // On Android playback continues during a scrub — if it runs out mid-drag,
      // don't yank the knob out from under the finger.
      if (!scrubbing.value) {
        progress.value = 1;
        const dur = player.duration;
        if (isFinite(dur) && dur > 0) setTimeLabel(Math.floor(dur));
      }
    });
    setIsPlaying(player.playing);
    return () => {
      sub.remove();
      timeSub.remove();
      endSub.remove();
    };
  }, [player, progress, scrubbing]);

  // ── Live scrubbing (per the expo-video docs' scrubbing recipe) ────────────
  // While the finger is down: playback paused, scrubbing mode on (codec rate
  // boosted for seek bursts), LOOSE seek tolerance (nearest keyframe = fast),
  // and throttled currentTime writes so the frame under the finger updates
  // live. On release: exact seek (tolerance 0) and resume if it was playing.
  const wasPlayingRef = useRef(false);
  const lastLiveSeekAtRef = useRef(0);
  // Scrubbing pauses playback, which would pop the big play overlay mid-drag —
  // this state keeps it hidden until the finger lifts.
  const [isScrubbingUi, setIsScrubbingUi] = useState(false);

  const beginScrub = () => {
    wasPlayingRef.current = player.playing;
    setIsScrubbingUi(true);
    if (!LIVE_SCRUB_ENABLED) return; // Android keeps playing; seek lands on release.
    try {
      player.pause();
      // Not in expo-video 3.0.x typings/runtime yet — harmless no-op today,
      // becomes a real codec-rate + keyframe-seek boost on upgrade.
      (player as any).scrubbingModeOptions = { scrubbingModeEnabled: true };
      (player as any).seekTolerance = { toleranceBefore: 10, toleranceAfter: 10 };
    } catch {}
  };

  const liveSeek = (fraction: number) => {
    const dur = player.duration;
    if (!isFinite(dur) || dur <= 0) return;
    // The time label always follows the finger, even where live seeking is off.
    setTimeLabel(Math.floor(fraction * dur));
    if (!LIVE_SCRUB_ENABLED) return;
    // ~10 seeks/s: fast enough to feel live, sparse enough not to flood the decoder.
    const now = Date.now();
    if (now - lastLiveSeekAtRef.current < 100) return;
    lastLiveSeekAtRef.current = now;
    try {
      player.currentTime = fraction * dur;
    } catch {}
  };

  const endScrub = (fraction: number) => {
    setIsScrubbingUi(false);
    try {
      if (LIVE_SCRUB_ENABLED) {
        (player as any).scrubbingModeOptions = { scrubbingModeEnabled: false };
        (player as any).seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
      }
      const dur = player.duration;
      if (isFinite(dur) && dur > 0) {
        // Scrubbing away from the end revives normal play/pause.
        if (fraction < 0.999) endedRef.current = false;
        player.currentTime = fraction * dur;
        setTimeLabel(Math.floor(fraction * dur));
      }
      // Android never paused, so there's nothing to resume there.
      if (LIVE_SCRUB_ENABLED && wasPlayingRef.current && fraction < 0.999) player.play();
    } catch {}
  };

  // minDistance(0) activates on touch-down, which does two jobs at once: a bare
  // tap on the track seeks, and neither the pager's horizontal scroll nor the
  // outer pan-to-dismiss can steal a scrub that starts on the bar.
  const scrubGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      if (barWidth.value <= 0) return;
      scrubbing.value = 1;
      // Kill any in-flight playback tween so it can't fight the finger.
      cancelAnimation(progress);
      progress.value = Math.min(Math.max(e.x / barWidth.value, 0), 1);
      runOnJS(beginScrub)();
      runOnJS(liveSeek)(progress.value);
    })
    .onUpdate((e) => {
      if (barWidth.value <= 0) return;
      progress.value = Math.min(Math.max(e.x / barWidth.value, 0), 1);
      // The frame under the finger updates as you drag — the whole point.
      runOnJS(liveSeek)(progress.value);
    })
    .onFinalize(() => {
      runOnJS(endScrub)(progress.value);
      scrubbing.value = 0;
    });

  const trackFillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * barWidth.value },
      { scale: withTiming(scrubbing.value ? 1.4 : 1, { duration: 120 }) },
    ],
  }));

  // Playback starting is independent proof the video is up, so a missed
  // onFirstFrameRender can't strand the page on a still frame.
  const frameVisible = firstFrameRendered || isPlaying;

  // Armed on a delay so a fast open never flashes a spinner; past that, a lone
  // still frame stops reading as "loading" and starts reading as a photo.
  const [showLoader, setShowLoader] = useState(false);
  useEffect(() => {
    if (frameVisible) {
      setShowLoader(false);
      return;
    }
    const timer = setTimeout(() => setShowLoader(true), LOADER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [frameVisible]);

  const togglePlay = () => {
    if (!url) return;
    try {
      if (player.playing) {
        player.pause();
      } else if (endedRef.current) {
        // Finished video: play means "watch again" — from the top.
        endedRef.current = false;
        player.replay();
      } else {
        player.play();
      }
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
      {!!posterUrl && !frameVisible && (
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
      {/* The scrim is what turns the still frame from "photo" into "loading". */}
      {showLoader && !frameVisible && (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={styles.loadingOverlay}
          pointerEvents="none"
        >
          <ActivityIndicator size="large" color="#FFFFFF" />
        </Animated.View>
      )}
      {!isPlaying && frameVisible && !isScrubbingUi && (
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
      {/* Seek bar — only once there's a frame and a known duration. Absolute
          over the Pressable; its own gesture keeps taps from toggling play. */}
      {frameVisible && duration > 0 && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={[styles.controlsBar, { bottom: insets.bottom + 20 }]}
        >
          <Text style={styles.timeText}>{formatClock(timeLabel)}</Text>
          <GestureDetector gesture={scrubGesture}>
            <View
              style={styles.trackHitArea}
              onLayout={(e) => { barWidth.value = e.nativeEvent.layout.width; }}
            >
              <View style={styles.track}>
                <Animated.View style={[styles.trackFill, trackFillStyle]} />
              </View>
              <Animated.View style={[styles.knob, knobStyle]} />
            </View>
          </GestureDetector>
          <Text style={styles.timeText}>{formatClock(duration)}</Text>
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    // Dim enough to read as "held back", light enough to keep the frame legible.
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
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
  controlsBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timeText: {
    fontFamily: ff('Inter', '500'),
    color: '#FFFFFF',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    // Both labels the same width, so the track doesn't shift as digits change.
    minWidth: 34,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 4,
  },
  trackHitArea: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  track: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 1.5,
  },
  knob: {
    position: 'absolute',
    left: -6,
    top: 12,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
});
