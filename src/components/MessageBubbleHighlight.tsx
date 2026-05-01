import React, { useEffect, useMemo } from 'react';
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
    console.log('[reply-jump] flash animation starting');
    flashOpacity.value = withSequence(
      withTiming(0.5, { duration: 450 }),
      withDelay(
        250,
        withTiming(0, { duration: 450 }, (finished) => {
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

  // Match the bubble's asymmetric corners (own: 16/2/16/16, other: 16/16/2/16
  // — see styles.userMessageBubble / botMessageBubble in chat screens). Using
  // a uniform borderRadius bled the overlay past the pointy corner.
  const overlayRadii = useMemo(() => {
    const flat = (StyleSheet.flatten(style) as ViewStyle | undefined) || {};
    const fallback = flat.borderRadius ?? 16;
    return {
      borderTopLeftRadius: flat.borderTopLeftRadius ?? fallback,
      borderTopRightRadius: flat.borderTopRightRadius ?? fallback,
      borderBottomLeftRadius: flat.borderBottomLeftRadius ?? fallback,
      borderBottomRightRadius: flat.borderBottomRightRadius ?? fallback,
    };
  }, [style]);

  return (
    <Animated.View style={style} {...rest}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          overlayRadii,
          styles.flashColor,
          animatedFlashStyle,
        ]}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  flashColor: {
    backgroundColor: 'rgba(0, 0, 0, 1)',
  },
});
