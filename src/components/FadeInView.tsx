// FadeInView — a content-reveal wrapper used when a screen swaps its loading
// skeleton for real content. Fades opacity 0→1 with a subtle upward rise, using
// a strong ease-out curve (content is *entering*, so it should feel responsive).
//
// Design rationale (Emil Kowalski's animation framework):
//   • ease-out, not ease-in — entering elements feel snappy, not sluggish.
//   • custom bezier — RN's built-in easings are too weak to read as intentional.
//   • < 300ms — UI reveals under 300ms feel responsive.
//   • opacity + translateY only, native driver — runs off the JS thread.
//   • never from scale(0) — a small translateY(8) reads more naturally.
//   • respects reduce-motion — keeps the opacity fade, drops the movement.

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

// Strong ease-out (easing.dev "out-quint"-ish). Built-in Easing.out(Easing.cubic)
// is too gentle for a reveal to feel intentional.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

interface FadeInViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Reveal duration in ms. Default 280 (kept under 300 for snappiness). */
  duration?: number;
  /** Upward travel in px before settling. Default 8. Ignored under reduce-motion. */
  translateY?: number;
  /** Delay before starting — use to stagger sibling reveals (30–80ms apart). */
  delay?: number;
}

export const FadeInView: React.FC<FadeInViewProps> = ({
  children,
  style,
  duration = 280,
  translateY = 8,
  delay = 0,
}) => {
  const progress = useRef(new Animated.Value(0)).current;
  // useReducedMotion() is synchronous — reads the OS setting before first render,
  // so the transform is correct from frame 0 with no async Promise race.
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = {
    opacity: progress,
    transform: reduceMotion
      ? []
      : [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [translateY, 0],
            }),
          },
        ],
  };

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
};

export default FadeInView;
