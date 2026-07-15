import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles/theme';
import { hapticLight } from '../utils/haptics';

const MAX_TRANSLATION = 60;
const REPLY_THRESHOLD = 40;

type Props = {
  enabled: boolean;
  /** Fired after the snap-back animation finishes if the user crossed the
   *  threshold. The parent is expected to set the reply state and focus the
   *  chat input — same effect as pressing "Reply" in the long-press menu. */
  onReply: () => void;
  children: React.ReactNode;
};

export function SwipeToReplyWrapper({ enabled, onReply, children }: Props) {
  const translateX = useSharedValue(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // First value must be the negative-direction threshold; using a large
        // negative so left swipes never activate. Right swipe activates at 15px,
        // giving the FlatList room to win slow vertical scrolls.
        .activeOffsetX([-999, 15])
        // Tight Y fail so any vertical drift releases the touch to the scroll
        // view quickly — fixes "slow scroll feels stuck" while reply swipe still
        // works at typical swipe speeds.
        .failOffsetY([-6, 6])
        .onUpdate((e) => {
          'worklet';
          translateX.value = Math.max(0, Math.min(e.translationX, MAX_TRANSLATION));
        })
        .onEnd(() => {
          'worklet';
          if (translateX.value >= REPLY_THRESHOLD) {
            // Fire immediately so the reply banner starts sliding up in parallel
            // with the bubble snapping back — no waiting for the spring to settle.
            runOnJS(hapticLight)();
            runOnJS(onReply)();
          }
          translateX.value = withSpring(0, {
            damping: 20,
            stiffness: 220,
            mass: 0.5,
          });
        }),
    [onReply, translateX],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, 20, MAX_TRANSLATION], [0, 0, 1]),
    transform: [
      {
        scale: interpolate(translateX.value, [0, MAX_TRANSLATION], [0.6, 1]),
      },
    ],
  }));

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.iconLayer}>
        <Reanimated.View style={iconStyle}>
          <Ionicons name="arrow-undo" size={20} color={colors.textSecondary} />
        </Reanimated.View>
      </View>
      <GestureDetector gesture={pan}>
        <Reanimated.View style={rowStyle}>{children}</Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  iconLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: MAX_TRANSLATION,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
