import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Platform,
  StatusBar,
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
import { Text } from './Text';

// expo-video isn't available on web — require lazily so the web bundle skips it.
let useVideoPlayer: any = null;
let VideoView: any = null;
if (Platform.OS !== 'web') {
  try {
    const expoVideo = require('expo-video');
    useVideoPlayer = expoVideo.useVideoPlayer;
    VideoView = expoVideo.VideoView;
  } catch {}
}

interface FullscreenVideoPlayerProps {
  visible: boolean;
  /** Playable URL. May be null while it's still being signed — the modal opens
      immediately on the poster and playback starts when the URL arrives. */
  videoUrl: string | null;
  /** The bubble's thumbnail URL — already in expo-image's cache, so it paints
      instantly, meaning we never open onto black. */
  posterUrl?: string | null;
  onClose: () => void;
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

/**
 * How long the poster is allowed to stand alone before we admit we're loading.
 *
 * The poster covers the sign + buffer wait, and when that wait is short it
 * reads as an instant open — a spinner there would be a pointless flash. But
 * past a moment, a lone still frame stops reading as "loading" and starts
 * reading as "this is a photo and the app is broken", which is exactly what a
 * slow sign felt like. So: no indicator early, a clear one once it's earned.
 */
const LOADER_DELAY_MS = 220;

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

// Live scrubbing (the frame follows the finger) is iOS-only for now. ExoPlayer
// on this SDK can only do EXACT seeks — each decodes from the previous
// keyframe, so seeking while dragging queues up and freezes the preview. The
// fast keyframe seeking that makes it smooth (seekTolerance +
// scrubbingModeOptions, Media3 "live scrubbing") ships with expo-video 55 /
// SDK 55 — flip this on for Android after that upgrade. Until then Android
// drags the bar only and seeks once on release.
const LIVE_SCRUB_ENABLED = Platform.OS !== 'android';

const formatClock = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
};

const WebVideoPlayer: React.FC<{ videoUrl: string | null; posterUrl?: string | null; visible: boolean }> = ({
  videoUrl,
  posterUrl,
  visible,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (visible && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
    if (!visible && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [visible, videoUrl]);

  if (!visible) return null;

  // URL still signing — poster so we never open onto black, plus a spinner so a
  // slow sign doesn't read as a static photo. Once the URL lands, <video>'s own
  // poster attribute covers buffering. No delay-arming here (unlike native):
  // this branch only exists while we're provably still waiting on the network.
  if (!videoUrl) {
    return (
      <View style={styles.flex}>
        {posterUrl ? (
          <img
            src={posterUrl}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              backgroundColor: '#000',
            }}
          />
        ) : null}
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      </View>
    );
  }

  return (
    <video
      ref={videoRef}
      src={videoUrl}
      poster={posterUrl || undefined}
      controls
      autoPlay
      playsInline
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        backgroundColor: '#000',
      }}
    />
  );
};

// Native viewer — mirrors VideoPreviewModal's look: custom play overlay (no
// native controls), pan-to-dismiss, black background. No caption/trim/send
// because the video has already been sent.
const NativeVideoPlayer: React.FC<{
  videoUrl: string | null;
  posterUrl?: string | null;
  visible: boolean;
  onClose: () => void;
}> = ({ videoUrl, posterUrl, visible, onClose }) => {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const translateY = useSharedValue(0);
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

  if (!useVideoPlayer || !VideoView) return null;

  // useVideoPlayer recreates the player when the source changes, so passing
  // null while the URL is still being signed and the real URL afterwards
  // works: the setup callback re-runs and autoplays once the URL lands.
  // Played to the end (loop is off) — the next "play" must restart, not resume.
  const endedRef = useRef(false);

  const player = useVideoPlayer(visible && videoUrl ? videoUrl : null, (p: any) => {
    p.loop = false;
    p.muted = false;
    // timeUpdate is disabled (interval 0) by default — the seek bar needs it.
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  useEffect(() => {
    if (!visible) {
      setIsPlaying(false);
      setFirstFrameRendered(false);
      setDuration(0);
      setTimeLabel(0);
      endedRef.current = false;
      translateY.value = 0;
      progress.value = 0;
      scrubbing.value = 0;
      return;
    }
    const sub = player.addListener('playingChange', ({ isPlaying: next }: { isPlaying: boolean }) => {
      if (next) endedRef.current = false;
      setIsPlaying(next);
    });
    const timeSub = player.addListener('timeUpdate', ({ currentTime }: { currentTime: number }) => {
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
  }, [visible, player, translateY, progress, scrubbing]);

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

  const beginScrub = useCallback(() => {
    wasPlayingRef.current = player.playing;
    setIsScrubbingUi(true);
    if (!LIVE_SCRUB_ENABLED) return; // Android keeps playing; seek lands on release.
    try {
      player.pause();
      player.scrubbingModeOptions = { scrubbingModeEnabled: true };
      player.seekTolerance = { toleranceBefore: 10, toleranceAfter: 10 };
    } catch {}
  }, [player]);

  const liveSeek = useCallback((fraction: number) => {
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
  }, [player]);

  const endScrub = useCallback((fraction: number) => {
    setIsScrubbingUi(false);
    try {
      if (LIVE_SCRUB_ENABLED) {
        player.scrubbingModeOptions = { scrubbingModeEnabled: false };
        player.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
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
  }, [player]);

  // Playback having started is independent proof the video is up, so the poster
  // and loader clear even if onFirstFrameRender is missed — otherwise a dropped
  // callback would strand the viewer on a still frame with a spinner forever.
  const frameVisible = firstFrameRendered || isPlaying;

  // The loader is armed on a delay rather than rendered outright, so a fast
  // open never flashes a spinner (see LOADER_DELAY_MS).
  const [showLoader, setShowLoader] = useState(false);
  useEffect(() => {
    if (!visible || frameVisible) {
      setShowLoader(false);
      return;
    }
    const timer = setTimeout(() => setShowLoader(true), LOADER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, frameVisible]);

  const togglePlay = useCallback(() => {
    if (!videoUrl) return;
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
  }, [player, videoUrl]);

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

  // minDistance(0) activates on touch-down, which does two jobs at once: a bare
  // tap on the track seeks, and the outer pan-to-dismiss (15px vertical) can
  // never steal a scrub that starts on the bar.
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

  if (!visible) return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.flex, animatedContentStyle]}>
          <Pressable style={styles.videoContainer} onPress={togglePlay}>
            <VideoView
              player={player}
              style={styles.video}
              contentFit="contain"
              nativeControls={false}
              onFirstFrameRender={() => setFirstFrameRendered(true)}
            />

            {/* Poster: the bubble's thumbnail, instant from expo-image cache.
                Covers URL signing + buffering so we never open onto black, then
                fades once the video's first frame is on screen. */}
            {posterUrl && !frameVisible && (
              <Animated.View
                exiting={FadeOut.duration(200)}
                style={styles.posterOverlay}
                pointerEvents="none"
              >
                <ExpoImage
                  source={{ uri: posterUrl }}
                  style={styles.video}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              </Animated.View>
            )}

            {/* Loading — armed on a delay, so a quick open never flashes it.
                The scrim is what makes the still frame read as "loading" rather
                than "photo": it visibly holds the poster back from being the
                final state, and gives the spinner something to sit on. Exit is
                quicker than enter — the system responding should feel snappy. */}
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

            {/* Play icon only once there's a frame to play/pause against —
                showing it over a loading poster would invite dead taps. */}
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
          </Pressable>

          {/* Seek bar — only once there's a frame and a known duration, so it
              never renders against a video that can't be scrubbed yet. Sits
              OUTSIDE the Pressable: touching it must never toggle play/pause. */}
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
  );
};

export const FullscreenVideoPlayer: React.FC<FullscreenVideoPlayerProps> = ({
  visible,
  videoUrl,
  posterUrl,
  onClose,
}) => {
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
      <View style={styles.container}>
        {Platform.OS === 'web' ? (
          <>
            <TouchableOpacity
              style={[styles.closeButton, { top: 16 }]}
              onPress={onClose}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            >
              <CloseIcon />
            </TouchableOpacity>
            <WebVideoPlayer videoUrl={videoUrl} posterUrl={posterUrl} visible={visible} />
          </>
        ) : (
          <NativeVideoPlayer videoUrl={videoUrl} posterUrl={posterUrl} visible={visible} onClose={onClose} />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  posterOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    // Dim enough to read as "held back", light enough to keep the frame legible.
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
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
  controlsBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timeText: {
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
