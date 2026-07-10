/**
 * FileViewerModal — opens a RECEIVED file in place (image / pdf / text) instead
 * of bouncing to the OS share sheet. A share button remains, as the escape hatch
 * to save to Files, open elsewhere, or forward.
 *
 * The file is already downloaded to the cache by the caller (FileBubble), which
 * also deletes it on close. This component only renders the local uri and shares
 * it; it owns no file lifecycle.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { FilePreviewShell } from './filePreview/FilePreviewShell';
import { friendlyErrorMessage } from '../utils/friendlyError';
import { ff, fs } from '../theme/fonts';

interface FileViewerModalProps {
  visible: boolean;
  uri: string;
  displayName: string;
  ext: string;
  sizeBytes: number;
  mimeType: string;
  caption?: string;
  onClose: () => void;
}

// Square-with-up-arrow — the platform "share" affordance.
const ShareIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 3v13M12 3l-4 4M12 3l4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
      stroke="#FFFFFF"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  visible,
  uri,
  displayName,
  ext,
  sizeBytes,
  mimeType,
  caption,
  onClose,
}) => {
  const insets = useSafeAreaInsets();

  const handleShare = async () => {
    try {
      const Sharing = require('expo-sharing');
      if (Sharing && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri, { mimeType });
        return;
      }
      const { Linking } = require('react-native');
      await Linking.openURL(uri);
    } catch (e: any) {
      const { Alert } = require('react-native');
      Alert.alert('Could not share', friendlyErrorMessage(e, 'Failed to share the file.'));
    }
  };

  return (
    <FilePreviewShell
      visible={visible}
      title={displayName}
      uri={uri}
      ext={ext}
      sizeBytes={sizeBytes}
      onDismiss={onClose}
    >
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {!!caption?.trim() && (
          <Text style={styles.caption} numberOfLines={4}>
            {caption}
          </Text>
        )}
        <TouchableOpacity style={styles.shareButton} onPress={handleShare} activeOpacity={0.85}>
          <ShareIcon />
        </TouchableOpacity>
      </View>
    </FilePreviewShell>
  );
};

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  caption: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: fs(15),
    lineHeight: 20,
    color: 'rgba(255,255,255,0.9)',
    includeFontPadding: false,
  },
  shareButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#05BCD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
