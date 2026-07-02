import React, { useEffect } from 'react';
import {
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';

/**
 * ProfilePhotoViewer
 *
 * WhatsApp-style fullscreen viewer for the profile photo. Tapping the avatar
 * opens the photo with a shared-element (hero) morph: it grows from the avatar's
 * exact on-screen rect while its border-radius animates circle → square and a
 * black backdrop dims in behind it. Dismiss by swiping in ANY direction (the
 * photo follows the finger, the backdrop fades with drag distance) or by tapping
 * the close button. Every dismissal morphs the photo back into the avatar.
 *
 * Assumes a square source image (Swellyo avatars are square-cropped), so
 * `contentFit="cover"` shows the full image at every size and the only visible
 * change is the corner radius revealing the square — matching WhatsApp.
 *
 * No share button (by request) and no non-functional chevron affordance.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ProfilePhotoViewerProps {
  visible: boolean;
  imageUrl: string;
  /** The photo's on-screen rect (window coords), measured at tap time. */
  originRect: Rect;
  /** Called once the close/dismiss morph has finished — parent unmounts then. */
  onClose: () => void;
}

// Strong ease-out curve (Emil Kowalski): starts fast, feels responsive.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OPEN_MS = 300;
const CLOSE_MS = 240;
const DISMISS_MS = 220;
// Momentum-based dismissal: a short flick dismisses even without much distance.
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 900;

export const ProfilePhotoViewer: React.FC<ProfilePhotoViewerProps> = ({
  visible,
  imageUrl,
  originRect,
  onClose,
}) => {
  const { width: SW, height: SH } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // 0 = collapsed onto the avatar, 1 = fullscreen.
  const progress = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const closing = useSharedValue(false);

  // Fullscreen target: a square the width of the screen, centered vertically.
  const targetW = SW;
  const targetH = SW;
  const targetX = 0;
  const targetY = (SH - SW) / 2;

  useEffect(() => {
    if (visible) {
      dragX.value = 0;
      dragY.value = 0;
      closing.value = false;
      progress.value = 0;
      progress.value = withTiming(1, {
        duration: reduceMotion ? 160 : OPEN_MS,
        easing: EASE_OUT,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const finishClose = () => onClose();

  // Tap / hardware-back close: morph the photo straight back into the avatar.
  const close = () => {
    if (closing.value) return;
    closing.value = true;
    dragX.value = withTiming(0, { duration: CLOSE_MS, easing: EASE_OUT });
    dragY.value = withTiming(0, { duration: CLOSE_MS, easing: EASE_OUT });
    progress.value = withTiming(
      0,
      { duration: CLOSE_MS, easing: EASE_OUT },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      },
    );
  };

  const pan = Gesture.Pan()
    .maxPointers(1) // multi-touch protection — ignore extra fingers mid-drag
    .onUpdate((e) => {
      'worklet';
      if (closing.value) return;
      dragX.value = e.translationX;
      dragY.value = e.translationY;
    })
    .onEnd((e) => {
      'worklet';
      const dist = Math.sqrt(
        e.translationX * e.translationX + e.translationY * e.translationY,
      );
      const vel = Math.sqrt(
        e.velocityX * e.velocityX + e.velocityY * e.velocityY,
      );
      if (dist > DISMISS_DISTANCE || vel > DISMISS_VELOCITY) {
        // Dismiss: converge drag → 0 AND progress → 0 so the photo shrinks
        // back into the avatar from wherever it was let go.
        closing.value = true;
        dragX.value = withTiming(0, { duration: DISMISS_MS, easing: EASE_OUT });
        dragY.value = withTiming(0, { duration: DISMISS_MS, easing: EASE_OUT });
        progress.value = withTiming(
          0,
          { duration: DISMISS_MS, easing: EASE_OUT },
          (finished) => {
            if (finished) runOnJS(finishClose)();
          },
        );
      } else {
        // Not far/fast enough — spring back to fullscreen.
        dragX.value = withSpring(0, { damping: 20, stiffness: 200 });
        dragY.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  // The photo box. Morph = animate the box rect (left/top/width/height/radius);
  // drag = transform-only (translate + slight scale) so the frequent gesture
  // stays on the GPU. reduce-motion collapses the morph into a cross-fade.
  const photoStyle = useAnimatedStyle(() => {
    const dist = Math.sqrt(
      dragX.value * dragX.value + dragY.value * dragY.value,
    );

    if (reduceMotion) {
      return {
        position: 'absolute',
        left: targetX,
        top: targetY,
        width: targetW,
        height: targetH,
        borderRadius: 0,
        overflow: 'hidden',
        opacity: progress.value,
        transform: [
          { translateX: dragX.value },
          { translateY: dragY.value },
        ],
      };
    }

    const p = progress.value;
    // Photo shrinks a touch as it's dragged away — WhatsApp's tactile feel.
    const dragScale = interpolate(dist, [0, 400], [1, 0.82], Extrapolation.CLAMP);
    return {
      position: 'absolute',
      left: interpolate(p, [0, 1], [originRect.x, targetX]),
      top: interpolate(p, [0, 1], [originRect.y, targetY]),
      width: interpolate(p, [0, 1], [originRect.width, targetW]),
      height: interpolate(p, [0, 1], [originRect.height, targetH]),
      borderRadius: interpolate(p, [0, 1], [originRect.width / 2, 0]),
      overflow: 'hidden',
      transform: [
        // translate before scale → drag tracks the finger 1:1, scale is centered.
        { translateX: dragX.value },
        { translateY: dragY.value },
        { scale: dragScale },
      ],
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    const dist = Math.sqrt(
      dragX.value * dragX.value + dragY.value * dragY.value,
    );
    const dragFade = interpolate(dist, [0, SH * 0.5], [1, 0], Extrapolation.CLAMP);
    return { opacity: progress.value * dragFade };
  });

  // Controls fade in only near the end of the open morph, and fade out the
  // moment the user starts dragging to dismiss.
  const controlsStyle = useAnimatedStyle(() => {
    const dist = Math.sqrt(
      dragX.value * dragX.value + dragY.value * dragY.value,
    );
    const dragFade = interpolate(dist, [0, 120], [1, 0], Extrapolation.CLAMP);
    const openFade = interpolate(progress.value, [0.6, 1], [0, 1], Extrapolation.CLAMP);
    return { opacity: openFade * dragFade };
  });

  const inner = (
    <Animated.View style={styles.fill}>
      <Animated.View
        style={[styles.backdrop, backdropStyle]}
        pointerEvents="none"
      />

      <GestureDetector gesture={pan}>
        <Animated.View style={styles.fill}>
          <Animated.View style={photoStyle}>
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={imageUrl}
                transition={0}
              />
            ) : null}
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      <Animated.View
        style={[styles.closeWrap, controlsStyle]}
        pointerEvents="box-none"
      >
        <Pressable
          style={styles.closeButton}
          onPress={close}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={close}
    >
      {Platform.OS === 'web' ? (
        inner
      ) : (
        // Android Modals don't inherit the app's root gesture context — needs a
        // local GestureHandlerRootView for the pan to fire.
        <GestureHandlerRootView style={styles.fill}>{inner}</GestureHandlerRootView>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  closeWrap: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 16,
    zIndex: 10,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
