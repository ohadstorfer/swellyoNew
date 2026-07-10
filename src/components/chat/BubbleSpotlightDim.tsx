import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Dimensions, Animated, Easing, Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { buildDimPathD, DEFAULT_RADII, type BubbleRadii } from '../MessageActionsMenu';

export interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radii?: BubbleRadii;
}

interface Props {
  /** Bubble bounds in window coords to keep "lit" (a hole in the dim). */
  rect: SpotlightRect;
  /** Tap anywhere on the dimmed area to dismiss (e.g. cancel edit). */
  onPress: () => void;
}

// Frost strength behind the menu. Kept well under 20 — heavy blur is expensive,
// and the chat background is already light (#FAFAFA), so a little goes far.
const BLUR_INTENSITY = 30;
// The blur alone barely separates the white actions menu from a light chat
// background, so a faint scrim rides on top of it for contrast. Much lighter
// than the 0.3 flat dim it replaces — the blur is doing most of the work now.
const SCRIM = 'rgba(0, 0, 0, 0.18)';
// Web has no MaskedView (the shim drops children), so it keeps the flat dim.
const WEB_DIM = 'rgba(0, 0, 0, 0.3)';

/**
 * Full-bleed frost with a rounded-rect hole over one message bubble — the iOS
 * context-menu "lift", reused for edit mode so the rest of the chat blurs while
 * the message being edited stays perfectly sharp.
 *
 * The same SVG path that used to paint the dim now MASKS a BlurView: it's the
 * screen rect minus the bubble rect, filled opaque, so the blur renders
 * everywhere except through the hole.
 *
 * Rendered in-tree (NOT a Modal) so the composer/edit bar can sit on top of it.
 */
export function BubbleSpotlightDim({ rect, onPress }: Props) {
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const d = buildDimPathD(
    screenW,
    screenH,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    rect.radii ?? DEFAULT_RADII,
  );

  // Fade in on mount (ease-out, native driver). Stays mounted across the
  // menu→edit transition, so it only fades the FIRST time it appears — the
  // transition itself is seamless (same element).
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fade]);

  const mask = (
    <Svg width={screenW} height={screenH} style={StyleSheet.absoluteFill}>
      <Path d={d} fill="#000000" fillRule="evenodd" />
    </Svg>
  );

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onPress}>
        {Platform.OS === 'web' ? (
          <Svg pointerEvents="none" width={screenW} height={screenH} style={StyleSheet.absoluteFill}>
            <Path d={d} fill={WEB_DIM} fillRule="evenodd" />
          </Svg>
        ) : (
          <MaskedView pointerEvents="none" style={StyleSheet.absoluteFill} maskElement={mask}>
            <BlurView intensity={BLUR_INTENSITY} tint="light" style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
          </MaskedView>
        )}
      </Pressable>
    </Animated.View>
  );
}
