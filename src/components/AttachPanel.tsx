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
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AttachMenuGrid, type AttachMenuActions } from './AttachMenuGrid';

export function AttachPanel({ height, ...actions }: AttachMenuActions & { height: number }) {
  return (
    <View testID="attach-panel" style={[styles.rect, { height }]}>
      <View style={styles.card}>
        <AttachMenuGrid {...actions} />
      </View>
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
    backgroundColor: '#D9D9D9',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 22,
    paddingHorizontal: 20,
  },
});
