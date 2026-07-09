/**
 * The honest fallback for a file we cannot render: a big icon, the name, and
 * the size. Used for unrenderable types, for a text file over the read cap,
 * for a PDF in Expo Go, and when the PDF view fails. A blank pane is never an
 * acceptable outcome — this is what we show instead.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
}

export function FileCard({ displayName, ext, sizeBytes, note }: FileCardProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name={iconForExt(ext)} size={56} color="#FFFFFF" />
      </View>
      <Text numberOfLines={2} style={styles.name}>
        {displayName}
      </Text>
      <Text style={styles.sub}>
        {note ?? `${ext.toUpperCase()} · ${formatBytes(sizeBytes)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
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
