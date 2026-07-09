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
 * No safe-area padding: the panel sits where the keyboard sat, so there is no home
 * indicator to clear. No grabber either — it isn't draggable.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AttachMenuGrid, type AttachMenuActions } from './AttachMenuGrid';

export function AttachPanel({ height, ...actions }: AttachMenuActions & { height: number }) {
  return (
    <View testID="attach-panel" style={[styles.panel, { height }]}>
      <AttachMenuGrid {...actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#D9D9D9',
    paddingTop: 22,
    paddingHorizontal: 20,
  },
});
