/**
 * The attachment menu rendered inline, filling the exact rectangle the keyboard
 * occupies. Its height is passed in (the last measured keyboard height) and is a
 * FIXED height on purpose: `flex` or measure-on-mount would collapse the panel and
 * re-expand it, which is the jump this whole design exists to avoid.
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
    backgroundColor: '#D9D9D9',
    paddingTop: 22,
    paddingHorizontal: 20,
  },
});
