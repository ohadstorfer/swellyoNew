/**
 * The 4-tile attachment menu. Lifted out of AttachSheet so it can be hosted by
 * AttachPanel (inline, in the keyboard's rectangle) rather than a bottom sheet.
 *
 * Tiles call their handlers directly. AttachSheet had to defer each handler to the
 * shell's `onDismissed` because one firing while iOS tore down the Modal's
 * UIViewController hung the main thread on PHPicker (out-of-process) and the OS
 * killed the app. There is no Modal here, so there is no teardown to wait for.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
        <Pressable
          key={t.key}
          style={styles.tile}
          onPress={t.onPress}
          android_ripple={{ color: 'rgba(0,0,0,0.06)', borderless: false }}
          hitSlop={6}
        >
          <View style={styles.iconCircle}>
            <Ionicons name={t.icon} size={26} color={t.color} />
          </View>
          <Text style={styles.tileLabel}>{t.label}</Text>
        </Pressable>
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
    alignItems: 'center',
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
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
