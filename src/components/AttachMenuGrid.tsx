/**
 * The 4-tile attachment menu. Lifted out of AttachSheet so it can be hosted by
 * AttachPanel (inline, in the keyboard's rectangle) rather than a bottom sheet.
 *
 * Tapping a tile does NOT close the panel — the picker opens over it, and the panel
 * is still there when the picker goes away. The tile answers the press itself.
 *
 * Tiles call their handlers directly. AttachSheet had to defer each handler to the
 * shell's `onDismissed` because one firing while iOS tore down the Modal's
 * UIViewController hung the main thread on PHPicker (out-of-process) and the OS
 * killed the app. There is no Modal here, so there is no teardown to wait for.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ff, fs } from '../theme/fonts';

export interface AttachMenuActions {
  onPhotos: () => void;
  onCamera: () => void;
  onDocument: () => void;
  onContact: () => void;
}

type Tile = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  hidden?: boolean;
};

const CIRCLE_REST = '#FFFFFF';
const CIRCLE_PRESSED = '#D8DBDF';

// Press in fast — the tile has to answer the finger. Release a touch slower, because
// by then the user is watching the picker, not the tile. Both ease-out: the built-in
// curves are too weak, and ease-in would delay the very frame being watched.
const PRESS_IN_MS = 90;
const PRESS_OUT_MS = 160;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function AttachTile({ tile }: { tile: Tile }) {
  const press = useSharedValue(0);
  // Motion-sensitive users keep the colour change — it carries the meaning — and
  // lose only the movement.
  const reduceMotion = useReducedMotion();

  const tileStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : interpolate(press.value, [0, 1], [1, 0.96]) }],
  }));

  const circleStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(press.value, [0, 1], [CIRCLE_REST, CIRCLE_PRESSED]),
  }));

  return (
    <Pressable
      style={styles.tile}
      onPress={tile.onPress}
      onPressIn={() => {
        press.value = withTiming(1, { duration: PRESS_IN_MS, easing: EASE_OUT });
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: PRESS_OUT_MS, easing: EASE_OUT });
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={tile.label}
    >
      {/* scale() scales children, so the icon and label shrink with the circle. */}
      <Reanimated.View style={[styles.tileInner, tileStyle]}>
        <Reanimated.View style={[styles.iconCircle, circleStyle]}>
          <Ionicons name={tile.icon} size={26} color={tile.color} />
        </Reanimated.View>
        <Text style={styles.tileLabel}>{tile.label}</Text>
      </Reanimated.View>
    </Pressable>
  );
}

export function AttachMenuGrid({ onPhotos, onCamera, onDocument, onContact }: AttachMenuActions) {
  // WhatsApp light menu: grey surface, white circles; only the glyph color changes
  // per action.
  const tiles: Tile[] = [
    { key: 'photos', label: 'Photos', icon: 'images', color: '#2E6FF2', onPress: onPhotos },
    { key: 'camera', label: 'Camera', icon: 'camera', color: '#3C4043', onPress: onCamera, hidden: Platform.OS === 'web' },
    { key: 'document', label: 'Document', icon: 'document-text', color: '#4E9BFF', onPress: onDocument },
    { key: 'contact', label: 'Contact', icon: 'person', color: '#5A616B', onPress: onContact },
  ];

  return (
    <View style={styles.grid}>
      {tiles.filter(t => !t.hidden).map(t => (
        <AttachTile key={t.key} tile={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 22,
  },
  tile: {
    width: '25%',
  },
  tileInner: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  tileLabel: {
    fontFamily: ff('Inter', '500'),
    fontSize: fs(12),
    color: '#1A1A1A',
    includeFontPadding: false,
  },
});
