/**
 * FilePreviewModal — the WhatsApp-style review screen for a picked document,
 * before sending. Cancel sends nothing; the upload only starts on send.
 * The dark chrome (header, swipe-dismiss, body) lives in FilePreviewShell.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatTextInput } from './ChatTextInput';
import { FilePreviewShell } from './filePreview/FilePreviewShell';

export interface PickedFilePreview {
  uri: string;
  display_name: string;
  ext: string;
  mime_type: string;
  size_bytes: number;
}

interface FilePreviewModalProps {
  visible: boolean;
  file: PickedFilePreview;
  onSend: (caption?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  primaryColor?: string;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  visible,
  file,
  onSend,
  onCancel,
  isProcessing = false,
  primaryColor = '#B72DF2',
}) => {
  const insets = useSafeAreaInsets();
  const [caption, setCaption] = useState('');
  // onSend is async and the modal stays mounted across the round-trip, so state
  // updates too slowly to block a double-tap. A ref blocks it in the same tick.
  const sendingRef = useRef(false);

  useEffect(() => {
    if (visible) sendingRef.current = false;
  }, [visible]);

  const handleSend = () => {
    if (isProcessing) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    onSend(caption.trim() || undefined);
    setCaption('');
  };

  const handleCancel = () => {
    if (isProcessing) return;
    setCaption('');
    onCancel();
  };

  return (
    <FilePreviewShell
      visible={visible}
      title={file.display_name}
      uri={file.uri}
      ext={file.ext}
      sizeBytes={file.size_bytes}
      onDismiss={handleCancel}
      dismissDisabled={isProcessing}
    >
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <ChatTextInput
          value={caption}
          onChangeText={setCaption}
          onSend={handleSend}
          placeholder="Add a comment…"
          allowEmpty
          disabled={isProcessing}
          primaryColor={primaryColor}
          backgroundColor="#2A2A2A"
          textColor="#FFFFFF"
          placeholderColor="rgba(255,255,255,0.5)"
        />
      </View>
    </FilePreviewShell>
  );
};

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    minHeight: 64,
  },
});
