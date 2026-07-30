import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * "Tap to get started" — the handwritten label + hand-drawn curved arrow that
 * points at the floating Swelly avatar when the Lineup has no conversations.
 * Figma: Home Screen › Group 39408 (14351:55305).
 *
 * Rendered in the nav layer (RootNavigator) rather than inside
 * ConversationsScreen so it can be anchored to the Swelly avatar, which lives
 * there too. Sizes below are the raw Figma numbers; the caller positions the
 * box so its bottom-right corner meets the avatar.
 */

/** Figma group size — the arrow's tail starts under the label and ends bottom-right. */
export const SWELLY_HINT_WIDTH = 192;
export const SWELLY_HINT_HEIGHT = 92;

const ACCENT = '#B72DF2'; // Colors/Accent/200

export default function SwellyTapHint() {
  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.label}>Tap to get started</Text>
      <Svg
        style={styles.arrow}
        width={93.022}
        height={62.433}
        viewBox="0 0 93.022 62.433"
        fill="none"
      >
        <Path
          d="M92.9165 58.6893C93.0862 58.4714 93.047 58.1573 92.8292 57.9877L89.2784 55.2232C89.0605 55.0536 88.7463 55.0927 88.5767 55.3106C88.4071 55.5285 88.4462 55.8426 88.6641 56.0123L91.8203 58.4695L89.363 61.6258C89.1934 61.8437 89.2325 62.1578 89.4504 62.3275C89.6683 62.4971 89.9824 62.458 90.1521 62.2401L92.9165 58.6893ZM0.501251 0.00608432L0.00128794 0C-0.0939711 7.82766 5.08376 24.7768 19.2513 38.65C33.4495 52.5531 56.6561 63.3517 92.5838 58.8783L92.522 58.3822L92.4602 57.886C56.8133 62.3245 33.9162 51.6106 19.9509 37.9355C5.95504 24.2304 0.909658 7.53557 1.00121 0.0121686L0.501251 0.00608432Z"
          fill={ACCENT}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SWELLY_HINT_WIDTH,
    height: SWELLY_HINT_HEIGHT,
  },
  label: {
    fontFamily: Platform.OS === 'web'
      ? '"Architects Daughter", cursive'
      : 'ArchitectsDaughter-Regular',
    fontSize: 18,
    lineHeight: 18,
    color: ACCENT,
    textAlign: 'center',
    width: SWELLY_HINT_WIDTH,
    ...(Platform.OS === 'android' && { includeFontPadding: false }),
  },
  arrow: {
    position: 'absolute',
    left: 97.5,
    top: 29.4,
  },
});
