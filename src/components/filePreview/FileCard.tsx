/**
 * The honest fallback for a file we cannot render: a big icon, the name, and
 * the size. Used for unrenderable types, for a text file over the read cap,
 * for a PDF in Expo Go, and when the PDF view fails. A blank pane is never an
 * acceptable outcome — this is what we show instead.
 *
 * When `onPress` is set, the card becomes a tap target (e.g. iOS Office docs
 * that open in QuickLook) and shows an affordance pill so the action is
 * discoverable rather than hidden behind an invisible tap.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconForExt } from '../messages/fileIcon';
import { formatBytes } from '../../services/messaging/fileAttachmentPolicy';
import { ff, fs } from '../../theme/fonts';

interface FileCardProps {
  displayName: string;
  ext: string;
  sizeBytes: number;
  /** Replaces the "EXT · size" sub-label when we owe the user an explanation. */
  note?: string;
  /** When set, the whole card is tappable — used to open the file in QuickLook. */
  onPress?: () => void;
  /** Affordance shown under the file meta when the card is tappable. */
  actionLabel?: string;
}

export function FileCard({ displayName, ext, sizeBytes, note, onPress, actionLabel }: FileCardProps) {
  const body = (
    <>
      <View style={styles.iconCircle}>
        <Ionicons name={iconForExt(ext)} size={56} color="#FFFFFF" />
      </View>
      <Text numberOfLines={2} style={styles.name}>
        {displayName}
      </Text>
      <Text style={styles.sub}>
        {note ?? `${ext.toUpperCase()} · ${formatBytes(sizeBytes)}`}
      </Text>
      {onPress && actionLabel ? (
        <View style={styles.actionPill}>
          <Ionicons name="eye-outline" size={16} color="#FFFFFF" />
          <Text style={styles.actionText}>{actionLabel}</Text>
        </View>
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.wrap}>{body}</View>;
  }

  // Dim on press for instant feedback — the card is a large tap target, so an
  // opacity dip reads more clearly than a subtle scale would.
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, pressed && styles.wrapPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Preview ${displayName}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  wrapPressed: {
    opacity: 0.6,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  actionText: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(14),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  name: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(17),
    color: '#FFFFFF',
    textAlign: 'center',
    includeFontPadding: false,
  },
  sub: {
    fontFamily: ff('Inter', '400'),
    fontSize: fs(13),
    color: 'rgba(255,255,255,0.6)',
    marginTop: 6,
    includeFontPadding: false,
  },
});
