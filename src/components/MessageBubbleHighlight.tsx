import React, { useEffect } from 'react';
import { StyleSheet, StyleProp, ViewStyle, ViewProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';

interface MessageBubbleHighlightProps extends Omit<ViewProps, 'style'> {
  isHighlighted: boolean;
  onAnimationEnd: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export const MessageBubbleHighlight: React.FC<MessageBubbleHighlightProps> = ({
  isHighlighted,
  onAnimationEnd,
  style,
  children,
  ...rest
}) => {
  const flashOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isHighlighted) return;
    flashOpacity.value = withSequence(
      withTiming(0.35, { duration: 250 }),
      withDelay(
        400,
        withTiming(0, { duration: 550 }, (finished) => {
          if (finished) {
            runOnJS(onAnimationEnd)();
          }
        }),
      ),
    );
  }, [isHighlighted]);

  const animatedFlashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  return (
    <Animated.View style={style} {...rest}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[styles.flash, animatedFlashStyle]}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 235, 100, 1)',
    borderRadius: 16,
  },
});
