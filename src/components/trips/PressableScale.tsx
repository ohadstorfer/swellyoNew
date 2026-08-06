/**
 * PressableScale — the app's press feedback, actually animated.
 *
 * 0.97 on press-in, spring back on release, native-driven so it stays smooth
 * while the JS thread is busy fetching.
 *
 * WHY THIS FILE EXISTS: PlanSections.tsx has had exactly this component since
 * the Figma work, but private — it is one of the few things that file does not
 * export. The Dashboard tab was written against a plain
 * `pressed && { transform: [{ scale: 0.97 }] }`, which is the same number with
 * no transition: it snaps to 0.97 and snaps back, which reads as a glitch
 * rather than a press.
 *
 * The copy is deliberate. PlanSections is designed, reviewed and shipped, and
 * re-pointing its private copy at this file to save nine lines risks a
 * regression in a tab that is currently correct. Whoever next opens
 * PlanSections for another reason can delete its version and import this one.
 */
import React, { useRef } from 'react';
import { Animated, Pressable, type StyleProp, type ViewStyle } from 'react-native';

export const PressableScale: React.FC<{
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /** 0.97 is the app-wide press scale. Override only for very large targets. */
  scaleTo?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
}> = ({
  onPress,
  disabled,
  style,
  children,
  scaleTo = 0.97,
  accessibilityLabel,
  accessibilityRole = 'button',
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => !disabled && animate(scaleTo)}
      onPressOut={() => animate(1)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
};

export default PressableScale;
