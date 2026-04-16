import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Text } from './Text';
import { colors, spacing, borderRadius } from '../styles/theme';

interface VideoPreviewModalProps {
  visible: boolean;
  videoUri: string;
  onSend: (caption?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = ({
  visible,
  videoUri,
  onSend,
  onCancel,
  isProcessing = false,
}) => {
  const [caption, setCaption] = useState('');

  const player = useVideoPlayer(visible ? videoUri : null, (p) => {
    p.loop = true;
    p.muted = false;
  });

  const handleSend = () => {
    onSend(caption.trim() || undefined);
    setCaption('');
  };

  const handleCancel = () => {
    setCaption('');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            {isProcessing ? (
              <View style={styles.cancelButton} />
            ) : (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancel}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.sendButton, isProcessing && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.sendButtonText}>Send</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Video Preview */}
          <View style={styles.videoContainer}>
            {visible && videoUri ? (
              <VideoView
                player={player}
                style={styles.video}
                contentFit="contain"
                nativeControls={true}
              />
            ) : null}
          </View>

          {/* Caption Input */}
          <View style={styles.captionContainer}>
            <TextInput
              style={styles.captionInput}
              placeholder="Add a caption (optional)"
              placeholderTextColor="#7B7B7B"
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={500}
              editable={!isProcessing}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '90%',
    maxWidth: 500,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.large,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  cancelButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  cancelButtonText: {
    fontSize: 16,
    color: colors.textSecondary,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  sendButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary || '#B72DF2',
    borderRadius: borderRadius.medium,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
  videoContainer: {
    width: '100%',
    height: 400,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  captionContainer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  captionInput: {
    minHeight: 60,
    maxHeight: 120,
    fontSize: 16,
    color: colors.textPrimary,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    textAlignVertical: 'top',
  },
});
