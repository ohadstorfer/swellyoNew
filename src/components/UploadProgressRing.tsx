import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Strong ease-out — built-in curves are too weak for a ring this small to read.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

interface UploadProgressRingProps {
  /**
   * Real upload progress, 0–100. While undefined the ring self-animates: a
   * quick head start, then a slow decelerating creep toward ~85% — so the
   * pre-upload phases (compression, transcode, queue wait) never show a dead
   * ring. Once real progress arrives it takes over.
   */
  progress?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
}

/**
 * Determinate circular progress ring for in-flight media uploads (WhatsApp /
 * iMessage style). Displayed progress is monotonic — it never moves backward,
 * even if the simulated creep got ahead of the first real byte counts.
 */
export default function UploadProgressRing({
  progress,
  size = 44,
  strokeWidth = 3,
  color = '#FFFFFF',
  trackColor = 'rgba(255,255,255,0.3)',
}: UploadProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // 0..1 fraction of the ring that is filled.
  const fill = useSharedValue(0);

  useEffect(() => {
    if (progress === undefined || progress === null) {
      // Head start (a ring sitting at 0 reads as frozen), then a long
      // decelerating creep that mimics an upload without ever finishing.
      fill.value = withSequence(
        withTiming(0.1, { duration: 400, easing: EASE_OUT }),
        withTiming(0.85, { duration: 25000, easing: Easing.out(Easing.quad) }),
      );
      return;
    }
    const target = Math.min(Math.max(progress / 100, 0), 1);
    cancelAnimation(fill);
    // Monotonic: hold position until real progress passes the simulated creep.
    fill.value = withTiming(Math.max(target, fill.value), {
      duration: 350,
      easing: EASE_OUT,
    });
  }, [progress, fill]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - fill.value),
  }));

  return (
    <View style={{ width: size, height: size }}>
      {/* Rotate so progress starts at 12 o'clock. */}
      <Svg width={size} height={size} style={styles.rotated}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference}`}
          animatedProps={animatedProps}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  rotated: {
    transform: [{ rotate: '-90deg' }],
  },
});
