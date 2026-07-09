/**
 * AttachSheet — WhatsApp-style attachment menu opened from the composer "+".
 * A 2×2 grid of options that dismisses itself before invoking the chosen
 * handler (so the sheet is gone before the OS picker / permission dialog opens).
 * Built on BottomSheetShell so it inherits the global fade + slide + swipe and
 * the Android edge-to-edge nav-bar handling.
 *
 * The chosen handler runs on the shell's `onDismissed`, i.e. only once the Modal's
 * UIViewController is fully torn down. A timer raced against the slide-out here and
 * fired while iOS was still dismissing: the camera and document pickers survived it
 * (in-process presentations), but the photo library — PHPicker, which lives in
 * another process — blocked the main thread and the OS killed the app.
 */

import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from './BottomSheetShell';
import { ff, fs } from '../theme/fonts';

interface AttachSheetProps {
  visible: boolean;
  onClose: () => void;
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

export function AttachSheet({
  visible,
  onClose,
  onPhotos,
  onCamera,
  onDocument,
  onContact,
}: AttachSheetProps) {
  const insets = useSafeAreaInsets();

  // Close first; the handler runs from onDismissed, once the Modal is really gone.
  const pendingAction = useRef<(() => void) | null>(null);
  const choose = (fn: () => void) => () => {
    if (pendingAction.current) return; // ignore a second tile tapped mid-dismiss
    pendingAction.current = fn;
    onClose();
  };

  const runPendingAction = () => {
    const fn = pendingAction.current;
    pendingAction.current = null;
    fn?.();
  };

  // WhatsApp light menu: grey sheet, white circles; only the glyph color changes
  // per action.
  const tiles: Tile[] = [
    { key: 'photos', label: 'Photos', icon: 'images', color: '#2E6FF2', onPress: choose(onPhotos) },
    { key: 'camera', label: 'Camera', icon: 'camera', color: '#3C4043', onPress: choose(onCamera), hidden: Platform.OS === 'web' },
    { key: 'document', label: 'Document', icon: 'document-text', color: '#4E9BFF', onPress: choose(onDocument) },
    { key: 'contact', label: 'Contact', icon: 'person', color: '#5A616B', onPress: choose(onContact) },
  ];

  return (
    <BottomSheetShell visible={visible} onClose={onClose} onDismissed={runPendingAction}>
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabber} />
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
      </View>
    </BottomSheetShell>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: '#D9D9D9',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#B8B8B8',
    marginBottom: 18,
  },
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
