import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Platform,
  StatusBar,
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
  videoUrl: string;
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

const WebVideoPlayer: React.FC<{ videoUrl: string; visible: boolean }> = ({ videoUrl, visible }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (visible && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
    if (!visible && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [visible]);

  if (!visible || !videoUrl) return null;

  return (
    <video
      ref={videoRef}
      src={videoUrl}
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
const NativeVideoPlayer: React.FC<{ videoUrl: string; visible: boolean; onClose: () => void }> = ({
  videoUrl,
  visible,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const translateY = useSharedValue(0);
  const [isPlaying, setIsPlaying] = useState(false);

  if (!useVideoPlayer || !VideoView) return null;

  const player = useVideoPlayer(visible ? videoUrl : null, (p: any) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });

  useEffect(() => {
    if (!visible) {
      setIsPlaying(false);
      translateY.value = 0;
      return;
    }
    const sub = player.addListener('playingChange', ({ isPlaying: next }: { isPlaying: boolean }) => {
      setIsPlaying(next);
    });
    setIsPlaying(player.playing);
    return () => sub.remove();
  }, [visible, player, translateY]);

  const togglePlay = useCallback(() => {
    try {
      if (player.playing) player.pause();
      else player.play();
    } catch {}
  }, [player]);

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

  if (!visible || !videoUrl) return null;

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
            />

            {!isPlaying && (
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
            <WebVideoPlayer videoUrl={videoUrl} visible={visible} />
          </>
        ) : (
          <NativeVideoPlayer videoUrl={videoUrl} visible={visible} onClose={onClose} />
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
});
