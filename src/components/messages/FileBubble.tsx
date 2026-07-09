/**
 * FileBubble — renders a chat file attachment (type='file'). Shows a file-type
 * icon, the sanitized display name, and a human-readable size. Tapping fetches a
 * short-lived presigned GET and opens the file through the OS share/open sheet —
 * the file is NEVER rendered or executed inside the app.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Message } from '../../services/messaging/messagingService';
import { formatBytes } from '../../services/messaging/fileAttachmentPolicy';
import { getFileDownloadUrl } from '../../services/messaging/fileUploadService';
import { friendlyErrorMessage } from '../../utils/friendlyError';
import { ff, fs } from '../../theme/fonts';

interface FileBubbleProps {
  message: Message;
  isOwn: boolean;
  onLongPress?: (e: any) => void;
}

function iconForExt(ext: string): keyof typeof Ionicons.glyphMap {
  if (['pdf'].includes(ext)) return 'document-text';
  if (['doc', 'docx', 'rtf', 'txt'].includes(ext)) return 'document';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'grid';
  if (['ppt', 'pptx'].includes(ext)) return 'easel';
  if (['zip'].includes(ext)) return 'archive';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (['mp3', 'm4a', 'wav'].includes(ext)) return 'musical-notes';
  if (['mp4', 'mov'].includes(ext)) return 'videocam';
  return 'document-attach';
}

export function FileBubble({ message, isOwn, onLongPress }: FileBubbleProps) {
  const [busy, setBusy] = useState(false);
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
      // Native: download to cache, then hand to the OS share/open sheet. Fall
      // back to opening the signed URL directly if expo-sharing's native module
      // isn't in this build (require returns a lazy proxy that throws on access).
      const LegacyFS = require('expo-file-system/legacy');
      const target = `${LegacyFS.cacheDirectory}${message.id}-${meta.display_name}`;
      const { uri: localUri } = await LegacyFS.downloadAsync(url, target);
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

  return (
    <Pressable onPress={handleOpen} onLongPress={onLongPress} delayLongPress={300} style={styles.row}>
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
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 176,
    maxWidth: 240,
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
});
