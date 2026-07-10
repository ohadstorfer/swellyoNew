/**
 * The attachment menu filling the exact rectangle the keyboard occupies.
 *
 * Absolutely positioned, on purpose. As a normal child it would ADD its height to
 * the column while the container still reserved the keyboard's padding, shoving the
 * composer up by a keyboard's height for however many frames it took Reanimated to
 * zero that padding. Pinned to the bottom it consumes the padding region instead and
 * contributes nothing to layout — so the swap cannot jump, whatever order the JS and
 * UI threads land in.
 *
 * The height is passed in (the last measured keyboard height) and is FIXED: `flex`
 * or measure-on-mount would collapse the panel and re-expand it.
 *
 * Two views, not one. The outer one is the keyboard's rectangle: invisible, but it
 * swallows taps so a press in the gap above the card doesn't reach a message bubble.
 * The inner one is the card the user sees — full width like the keyboard it stands in
 * for, top corners rounded, running off the bottom of the screen.
 *
 * No safe-area padding: the card sits where the keyboard sat, so there is no home
 * indicator to clear. No grabber either — it isn't draggable.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { AttachMenuGrid, type AttachMenuActions } from './AttachMenuGrid';

// Strong ease-out — Reanimated's default withTiming easing is ease-in-out, which
// starts slow and makes the close read sluggish at the exact frame the eye is on it.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
// Exit faster than enter: the close is the system responding to a tap, so it should
// feel instant; the open can afford to be a touch softer.
const FADE_IN_MS = 130;
const FADE_OUT_MS = 90;

/**
 * `dismissing` is set the moment the user asks for the keyboard back, while the panel
 * is still mounted so the keyboard can rise over it without the composer jumping (see
 * useAttachPanel). During that window the card must not swallow taps — a press meant
 * for the keyboard-return would instead fire a stale attachment action, or hit the
 * "+" icon that has already flipped underneath. So we drop pointer events immediately
 * and fade the card out quickly, letting the rising keyboard finish covering an inert,
 * near-invisible surface instead of a live one.
 */
export function AttachPanel({
  height,
  dismissing = false,
  ...actions
}: AttachMenuActions & { height: number; dismissing?: boolean }) {
  // Starts transparent and fades in on mount (the panel is remounted on every open),
  // then fades back out — fast, ease-out — the instant a keyboard-return is requested.
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(dismissing ? 0 : 1, {
      duration: dismissing ? FADE_OUT_MS : FADE_IN_MS,
      easing: EASE_OUT,
    });
  }, [dismissing, opacity]);

  const cardStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View
      testID="attach-panel"
      style={[styles.rect, { height }]}
      pointerEvents={dismissing ? 'none' : 'auto'}
    >
      <Animated.View style={[styles.card, cardStyle]}>
        <AttachMenuGrid {...actions} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The keyboard's rectangle. Transparent — the chat background shows through
  // around the card, exactly as it does around WhatsApp's.
  rect: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    flex: 1,
    // Full width, like the keyboard it stands in for. Only the top corners are
    // rounded — the card runs off the bottom of the screen.
    marginTop: 8,
    // Sampled off a light-mode iOS keyboard screenshot: rgb(223, 225, 228), steady
    // across the gaps between key rows and the strip beside the globe key.
    backgroundColor: '#DFE1E4',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 22,
    paddingHorizontal: 20,
  },
});
