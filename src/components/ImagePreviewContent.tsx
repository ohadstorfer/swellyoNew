/**
 * Inner UI of the image preview — the picked/captured image, a caption bar, and
 * close/edit affordances, with swipe-to-dismiss. Extracted from
 * ImagePreviewModal so it can render either inside its own <Modal> (gallery and
 * capture flows) OR directly inside ChatCameraModal (filmstrip flow).
 *
 * Open-from-frame: when `openFrame` (the tapped thumbnail's window rect) is
 * provided, the image animates from that rect to its final laid-out position on
 * mount, and the chrome fades in behind it. Because the target is the image's
 * OWN measured rect, it lands exactly where the editor shows it — no fullscreen
 * overshoot, no jump. Without `openFrame` the content renders statically (the
 * standalone <Modal> handles its own fade).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Image,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
  Pressable,
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
  Easing,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { ChatTextInput } from './ChatTextInput';

export interface OpenFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImagePreviewContentProps {
  /** Drives the per-open reset (offset + send guard). */
  visible: boolean;
  imageUri: string;
  onSend: (caption?: string) => void;
  onCancel: () => void;
  /** When provided, shows an Edit button that opens a native crop/edit flow. */
  onEdit?: () => void;
  isProcessing?: boolean;
  /** Overrides the default send-button color so the preview matches the host chat's theme. */
  primaryColor?: string;
  /** Thumbnail window rect to grow the image from (filmstrip flow). */
  openFrame?: OpenFrame;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_DISTANCE = 120; // px — past this, release dismisses
const DISMISS_VELOCITY = 800; // px/s — past this, release dismisses regardless of distance
const OPEN_DURATION = 300;
const OPEN_EASING = Easing.bezier(0.23, 1, 0.32, 1);

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

// Pencil — universal "edit" affordance.
const EditIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ImagePreviewContent: React.FC<ImagePreviewContentProps> = ({
  visible,
  imageUri,
  onSend,
  onCancel,
  onEdit,
  isProcessing = false,
  primaryColor = '#B72DF2',
  openFrame,
}) => {
  const insets = useSafeAreaInsets();
  const [caption, setCaption] = useState('');
  const hasOpenAnim = !!openFrame;

  const translateY = useSharedValue(0);

  // Open animation: 0 = at the thumbnail frame, 1 = final laid-out position.
  const openProgress = useSharedValue(hasOpenAnim ? 0 : 1);
  // The image element's own window rect, measured after first layout. Grow maps
  // this → openFrame at progress 0 and → identity at progress 1.
  const natX = useSharedValue(0);
  const natY = useSharedValue(0);
  const natW = useSharedValue(1);
  const natH = useSharedValue(1);
  const measured = useSharedValue(hasOpenAnim ? 0 : 1);
  const measureRef = useRef<View>(null);
  const startedRef = useRef(false);

  // Re-entrancy guard. onSend (the host's handleImageSend) is async and only
  // closes this preview after a network round-trip, so the send button stays
  // live for that whole window. Without a synchronous guard a fast double-tap —
  // or a single Android press the OS delivers as two touch events — fires onSend
  // twice and uploads the image twice. A ref blocks within the same tick; state
  // wouldn't update fast enough.
  const sendingRef = useRef(false);

  // Reset the animated offset (and re-arm the send guard) every time the preview
  // opens so re-opens start centered and can send again.
  useEffect(() => {
    if (visible) {
      translateY.value = 0;
      sendingRef.current = false;
    }
  }, [visible, translateY]);

  // Measure the image element's natural rect, then run the grow once.
  const startOpenAnim = () => {
    if (!hasOpenAnim || startedRef.current) return;
    const node = measureRef.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      if (startedRef.current) return;
      startedRef.current = true;
      if (!width || !height) {
        // Measurement failed — never leave the preview invisible; show it
        // statically instead of animating.
        measured.value = 1;
        openProgress.value = 1;
        return;
      }
      natX.value = x;
      natY.value = y;
      natW.value = width;
      natH.value = height;
      measured.value = 1;
      openProgress.value = withTiming(1, { duration: OPEN_DURATION, easing: OPEN_EASING });
    });
  };

  const handleSend = () => {
    if (isProcessing) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    onSend(caption.trim() || undefined);
    setCaption('');
  };

  const handleCancel = () => {
    if (isProcessing) return;
    setCaption('');
    onCancel();
  };

  // Pan-to-dismiss — vertical swipe (up or down) past the threshold closes.
  // `activeOffsetY` requires a real vertical motion before activating, so taps on
  // the caption input still focus normally. `failOffsetX` bails on mostly-horizontal drags.
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

  // The image element grows from openFrame to its natural rect. Transform-only.
  const imageAnimStyle = useAnimatedStyle(() => {
    if (!hasOpenAnim) return {};
    if (measured.value === 0) return { opacity: 0 };
    const p = openProgress.value;
    const f = openFrame as OpenFrame;
    const scaleX = interpolate(p, [0, 1], [f.width / natW.value, 1]);
    const scaleY = interpolate(p, [0, 1], [f.height / natH.value, 1]);
    const translateX = interpolate(
      p,
      [0, 1],
      [f.x + f.width / 2 - (natX.value + natW.value / 2), 0],
    );
    const tY = interpolate(
      p,
      [0, 1],
      [f.y + f.height / 2 - (natY.value + natH.value / 2), 0],
    );
    return {
      opacity: 1,
      transform: [{ translateX }, { translateY: tY }, { scaleX }, { scaleY }],
    };
  });

  // Chrome (close/edit/caption) fades in as the image nears its final spot.
  const chromeStyle = useAnimatedStyle(() => {
    if (!hasOpenAnim) return { opacity: 1 };
    return {
      opacity: interpolate(openProgress.value, [0.45, 1], [0, 1], Extrapolation.CLAMP),
    };
  });

  return (
    <GestureHandlerRootView style={styles.flex}>
      <View style={styles.container}>
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.flex, animatedContentStyle]}>
            {/* Media fills the whole screen, WhatsApp-style: edge-to-edge, with
                the chrome floating on top instead of carving out layout space.
                A screen-aspect capture lands truly full-bleed; other aspects
                letterbox centered. */}
            <View style={styles.mediaFill}>
              {/* Transform-free measure box (== the image element rect). The
                  inner Animated.View carries the grow transform. alignSelf
                  'stretch' is load-bearing: without it this box collapses to
                  zero width and the measure fails, leaving the preview
                  invisible. */}
              <View
                ref={measureRef}
                style={styles.measureBox}
                collapsable={false}
                onLayout={startOpenAnim}
              >
                <Animated.View style={[styles.flex, imageAnimStyle]}>
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.image}
                    resizeMode="contain"
                  />
                </Animated.View>
              </View>

              {isProcessing && (
                <View style={styles.processingOverlay} pointerEvents="none">
                  <ActivityIndicator size="large" color="#FFFFFF" />
                </View>
              )}
            </View>

            {/* Caption bar — floats over the image and rides the keyboard.
                Reuses ChatTextInput so behaviour matches the DM composer. */}
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.chromeFill}
              pointerEvents="box-none"
            >
              <Animated.View
                style={[styles.inputWrapper, { paddingBottom: Math.max(insets.bottom, 8) }, chromeStyle]}
              >
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
              </Animated.View>
            </KeyboardAvoidingView>

            {/* Close button — circular, top-left, above the status bar */}
            <Animated.View style={[styles.closeButton, { top: insets.top + 12 }, chromeStyle]}>
              <Pressable
                style={styles.iconFill}
                onPress={handleCancel}
                disabled={isProcessing}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <CloseIcon />
              </Pressable>
            </Animated.View>

            {/* Edit button — top-right. Hidden when the host doesn't supply
                onEdit (web / Expo Go / cropper module missing). */}
            {onEdit && (
              <Animated.View style={[styles.editButton, { top: insets.top + 12 }, chromeStyle]}>
                <Pressable
                  style={styles.iconFill}
                  onPress={onEdit}
                  disabled={isProcessing}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <EditIcon />
                </Pressable>
              </Animated.View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  measureBox: {
    flex: 1,
    alignSelf: 'stretch',
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  mediaFill: {
    ...StyleSheet.absoluteFillObject,
  },
  chromeFill: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  iconFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(40, 40, 40, 0.85)',
    zIndex: 10,
  },
  editButton: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(40, 40, 40, 0.85)',
    zIndex: 10,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
});
