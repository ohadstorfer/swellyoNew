/**
 * FileBubble — renders a chat file attachment (type='file'). Shows a file-type
 * icon, the sanitized display name, and a human-readable size.
 *
 * Tapping downloads the file to the cache (named by message id, never the
 * sender's display_name — unescaped chars break a file:// uri on Android) and
 * then, for an image / pdf / text file, opens it in-app via FileViewerModal.
 * Everything else is handed to the OS share sheet as before.
 *
 * Security note: rendering a RECEIVED file in-app is a deliberate reversal of
 * the old "never render" posture. Images already decode in-process via
 * expo-image for type='image' messages; text has no parser; a PDF is the only
 * new attack surface, and it runs through the SYSTEM parsers (PDFKit / PDFium)
 * — the same ones the OS share sheet would use — which are patched by OS
 * updates, not ours. A render failure lands on FileCard, never a crash.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Message } from '../../services/messaging/messagingService';
import { formatBytes, previewKindForExt } from '../../services/messaging/fileAttachmentPolicy';
import { getFileDownloadUrl } from '../../services/messaging/fileUploadService';
import { friendlyErrorMessage } from '../../utils/friendlyError';
import { ff, fs } from '../../theme/fonts';
import { iconForExt } from './fileIcon';
import { FileViewerModal } from '../FileViewerModal';

interface FileBubbleProps {
  message: Message;
  isOwn: boolean;
  onLongPress?: (e: any) => void;
  /** Computed by the screen (getBodyTextAlign is screen-private). */
  textAlign?: 'left' | 'right';
  /** Content-area max width of a regular text bubble, so file cards line up with it. */
  maxWidth?: number;
}

export function FileBubble({ message, isOwn, onLongPress, textAlign, maxWidth = 240 }: FileBubbleProps) {
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<{ uri: string } | null>(null);
  const meta = message.file_metadata;
  if (!meta) return null;

  const tint = isOwn ? '#FFFFFF' : '#05BCD3';
  const nameColor = isOwn ? '#FFFFFF' : '#1A1A1A';
  const subColor = isOwn ? 'rgba(255,255,255,0.85)' : '#6B7076';

  const handleOpen = async () => {
    if (busy) return;
    if (!meta.storage_path) {
      Alert.alert('Not ready', 'This file is still uploading.');
      return;
    }
    setBusy(true);
    try {
      const url = await getFileDownloadUrl(message.conversation_id, meta.storage_path);
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.open(url, '_blank');
        return;
      }

      const LegacyFS = require('expo-file-system/legacy');
      const kind = previewKindForExt(meta.ext);
      // The in-app readers (pdf/text/image) reject a file:// uri whose name carries
      // spaces/accents/#, so renderable files get an id-only cache name. The share
      // sheet has no such limit, so a shared file keeps its human-readable name.
      const target = kind !== 'none'
        ? `${LegacyFS.cacheDirectory}${message.id}.${meta.ext}`
        : `${LegacyFS.cacheDirectory}${message.id}-${meta.display_name}`;
      const { uri: localUri } = await LegacyFS.downloadAsync(url, target);

      if (kind !== 'none') {
        setViewer({ uri: localUri });
        return;
      }

      let shared = false;
      try {
        const Sharing = require('expo-sharing');
        if (Sharing && (await Sharing.isAvailableAsync())) {
          await Sharing.shareAsync(localUri, { mimeType: meta.mime_type, UTI: undefined });
          shared = true;
        }
      } catch { /* expo-sharing missing/unavailable — fall through to Linking */ }
      if (!shared) {
        const { Linking } = require('react-native');
        await Linking.openURL(url);
      }
    } catch (e: any) {
      Alert.alert('Could not open file', friendlyErrorMessage(e, 'Failed to open the file.'));
    } finally {
      setBusy(false);
    }
  };

  const closeViewer = () => {
    const open = viewer;
    setViewer(null);
    // Delete the cached copy of the received file. Best-effort: a failed delete
    // is not worth surfacing (the OS clears cacheDirectory under pressure anyway).
    if (open) {
      try {
        const { File } = require('expo-file-system');
        new File(open.uri).delete();
      } catch { /* already gone, or module unavailable — ignore */ }
    }
  };

  return (
    <View>
      <Pressable onPress={handleOpen} onLongPress={onLongPress} delayLongPress={300} style={[styles.row, { width: maxWidth }]}>
        <View style={[styles.iconBox, { backgroundColor: isOwn ? 'rgba(255,255,255,0.18)' : '#E9F8FB' }]}>
          {busy ? (
            <ActivityIndicator size="small" color={tint} />
          ) : (
            <Ionicons name={iconForExt(meta.ext)} size={22} color={tint} />
          )}
        </View>
        <View style={styles.textCol}>
          <Text numberOfLines={1} style={[styles.name, { color: nameColor }]}>
            {meta.display_name}
          </Text>
          <Text style={[styles.sub, { color: subColor }]}>
            {meta.ext.toUpperCase()} · {formatBytes(meta.size_bytes)}
          </Text>
        </View>
      </Pressable>
      {!!message.body?.trim() && (
        <Text style={[styles.caption, { color: nameColor, textAlign: textAlign ?? 'left', width: maxWidth }]}>
          {message.body}
        </Text>
      )}
      {viewer && (
        <FileViewerModal
          visible={true}
          uri={viewer.uri}
          displayName={meta.display_name}
          ext={meta.ext}
          sizeBytes={meta.size_bytes}
          mimeType={meta.mime_type}
          caption={message.body ?? undefined}
          onClose={closeViewer}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  textCol: { flex: 1 },
  name: {
    fontFamily: ff('Inter', '600'),
    fontSize: fs(14),
    includeFontPadding: false,
  },
  sub: {
    fontFamily: ff('Inter', '400'),
    fontSize: fs(11),
    marginTop: 2,
    includeFontPadding: false,
  },
  caption: {
    fontFamily: ff('Inter', '400'),
    fontSize: fs(15),
    lineHeight: 20,
    marginTop: 6,
    paddingHorizontal: 2,
    includeFontPadding: false,
  },
});
