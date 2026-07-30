import React from 'react';
import { View, Image, StyleSheet, Platform, StyleProp, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Images } from '../assets/images';

/**
 * Swelly's face in the glassy gradient-ringed bubble.
 * Figma "Sweely" (13977:37524) — a 30%-white fill, a 1px purple→coral ring and
 * a soft purple glow, with the pelican sitting inside at 51×68.
 *
 * This is the *bubble* variant. The floating Ask-Swelly avatar and the Swelly
 * chat header use the other one (grey disc + solid ring, `Images.sweely`),
 * where the beanie deliberately breaks out of the circle.
 *
 * The ring is drawn in SVG rather than as a `borderColor`, because it's a
 * gradient (get_design_context flattens it to its first stop, #B72DF2 — the
 * rendered node goes purple→coral left to right) and because a gradient border
 * faked with a padded LinearGradient would bleed through the translucent fill.
 */

const RADIUS = 40;
const RING_FROM = '#B72DF2'; // Colors/Accent/200
const RING_TO = '#FE5367';
const GLOW = 'rgba(183, 45, 242, 0.24)';

interface SwellyFaceBubbleProps {
  /** Bubble size. Defaults to the Figma 89×84. */
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export default function SwellyFaceBubble({
  width = 89,
  height = 84,
  style,
}: SwellyFaceBubbleProps) {
  return (
    <View style={[styles.bubble, { width, height }, style]}>
      {/* Gradient ring, inset by half a stroke so it sits inside the box. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="swellyFaceRing" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={RING_FROM} />
            <Stop offset="1" stopColor={RING_TO} />
          </LinearGradient>
        </Defs>
        <Rect
          x={0.5}
          y={0.5}
          width={width - 1}
          height={height - 1}
          rx={RADIUS}
          ry={RADIUS}
          fill="none"
          stroke="url(#swellyFaceRing)"
          strokeWidth={1}
        />
      </Svg>
      <Image source={Images.swellyFace} style={styles.face} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: RADIUS,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: GLOW,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 14,
      },
      // shadowColor is honoured alongside elevation from API 28.
      android: { elevation: 4, shadowColor: '#B72DF2' },
      default: { boxShadow: `0px 2px 14px 0px ${GLOW}` },
    }),
  },
  face: {
    width: 51,
    height: 68,
  },
});
