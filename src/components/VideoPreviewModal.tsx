import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
  DeviceEventEmitter,
  Alert,
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
} from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';
import Svg, { Path } from 'react-native-svg';
import { ChatTextInput } from './ChatTextInput';

interface VideoPreviewModalProps {
  visible: boolean;
  videoUri: string;
  onSend: (caption?: string, overrideVideoUri?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  /** Overrides the default send-button color so the preview matches the host chat's theme. */
  primaryColor?: string;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const TRIM_MAX_DURATION_S = 20; // Matches videoValidation.ts hard cap

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

// Scissors-style trim icon.
const TrimIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M6 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({
  visible,
  videoUri,
  onSend,
  onCancel,
  isProcessing = false,
  primaryColor = '#B72DF2',
}) => {
  const insets = useSafeAreaInsets();
  const [caption, setCaption] = useState('');

  // The video URI shown in the preview. Starts as the picked video; if the user
  // trims, this switches to the trimmed temp file so the player and send path
  // both work off the new file.
  const [currentVideoUri, setCurrentVideoUri] = useState(videoUri);

  // Reset the shown URI whenever the modal opens with a (possibly new) picker result.
  useEffect(() => {
    if (visible) {
      setCurrentVideoUri(videoUri);
    }
  }, [visible, videoUri]);

  const player = useVideoPlayer(visible ? currentVideoUri : null, (p) => {
    p.loop = true;
    p.muted = false;
  });

  const translateY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = 0;
    }
  }, [visible, translateY]);

  const handleSend = () => {
    if (isProcessing) return;
    onSend(caption.trim() || undefined, currentVideoUri !== videoUri ? currentVideoUri : undefined);
    setCaption('');
  };

  const handleCancel = () => {
    if (isProcessing) return;
    setCaption('');
    onCancel();
  };

  // Pan-to-dismiss — same pattern as ImagePreviewModal.
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
        const destination = e.translationY > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT;
        translateY.value = withTiming(destination, { duration: 220 }, (finished) => {
          if (finished) {
            runOnJS(handleCancel)();
          }
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 180 });
      }
    });

  const animatedContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(
      Math.abs(translateY.value),
      [0, SCREEN_HEIGHT * 0.4],
      [1, 0.6],
      Extrapolation.CLAMP,
    ),
  }));

  // Trim editor wiring — native only. `react-native-video-trim` opens its own
  // native modal with a filmstrip + drag handles. Events arrive via DeviceEventEmitter.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const sub = DeviceEventEmitter.addListener('VideoTrim', (event: any) => {
      if (!event) return;
      switch (event.name) {
        case 'onFinishTrimming':
          if (typeof event.outputPath === 'string' && event.outputPath.length > 0) {
            // Prepend file:// if the lib returns a bare path.
            const uri = event.outputPath.startsWith('file://')
              ? event.outputPath
              : `file://${event.outputPath}`;
            setCurrentVideoUri(uri);
          }
          break;
        case 'onError':
          if (__DEV__) console.warn('[VideoTrim] onError:', event);
          break;
        default:
          break;
      }
    });

    return () => sub.remove();
  }, []);

  const openTrim = async () => {
    if (Platform.OS === 'web' || isProcessing) return;
    try {
      const { showEditor, isValidFile } = require('react-native-video-trim');
      const valid = await isValidFile(currentVideoUri);
      if (!valid) {
        Alert.alert('Invalid video', 'This video can\'t be trimmed.');
        return;
      }
      // Pause the preview before opening the trim editor so audio doesn't overlap.
      try { player.pause(); } catch {}
      showEditor(currentVideoUri, {
        maxDuration: TRIM_MAX_DURATION_S,
        enablePreciseTrimming: true,
        saveToPhoto: false,
        fullScreenModalIOS: true,
      });
    } catch (err) {
      if (__DEV__) console.warn('[VideoTrim] failed to open editor:', err);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.container}>
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.flex, animatedContentStyle]}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.flex}
              >
                <View style={styles.videoContainer}>
                  {visible && currentVideoUri ? (
                    <VideoView
                      player={player}
                      style={styles.video}
                      contentFit="contain"
                      nativeControls={!isProcessing}
                    />
                  ) : null}

                  {isProcessing && (
                    <View style={styles.processingOverlay} pointerEvents="none">
                      <ActivityIndicator size="large" color="#FFFFFF" />
                    </View>
                  )}
                </View>

                {/* Close — top-left */}
                <TouchableOpacity
                  style={[styles.closeButton, { top: insets.top + 12 }]}
                  onPress={handleCancel}
                  disabled={isProcessing}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <CloseIcon />
                </TouchableOpacity>

                {/* Trim — top-right, native only */}
                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={[styles.trimButton, { top: insets.top + 12 }]}
                    onPress={openTrim}
                    disabled={isProcessing}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <TrimIcon />
                  </TouchableOpacity>
                )}

                <View style={[styles.inputWrapper, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                  <ChatTextInput
                    value={caption}
                    onChangeText={setCaption}
                    onSend={handleSend}
                    disabled={isProcessing}
                    placeholder="Add a caption..."
                    maxLength={500}
                    primaryColor={primaryColor}
                    backgroundColor="#2B2B2B"
                    textColor="#FFFFFF"
                    placeholderColor="rgba(255, 255, 255, 0.5)"
                    allowEmpty
                  />
                </View>
              </KeyboardAvoidingView>
            </Animated.View>
          </GestureDetector>
        </View>
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
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
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
  trimButton: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(40, 40, 40, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
});
