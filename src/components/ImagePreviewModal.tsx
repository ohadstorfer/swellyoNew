import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Text } from './Text';
import { colors, spacing, borderRadius } from '../styles/theme';
import { Ionicons } from '@expo/vector-icons';

interface ImagePreviewModalProps {
  visible: boolean;
  imageUri: string;
  onSend: (caption?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  visible,
  imageUri,
  onSend,
  onCancel,
  isProcessing = false,
}) => {
  const [caption, setCaption] = useState('');

  const handleSend = () => {
    onSend(caption.trim() || undefined);
    setCaption(''); // Reset caption after send
  };

  const handleCancel = () => {
    setCaption(''); // Reset caption on cancel
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
              disabled={isProcessing}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Preview</Text>
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

          {/* Image Preview */}
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: imageUri }}
              style={styles.image}
              resizeMode="contain"
            />
            {isProcessing && (
              <View style={styles.processingOverlay}>
                <ActivityIndicator size="large" color="#FFFFFF" />
                <Text style={styles.processingText}>Processing image...</Text>
              </View>
            )}
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
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
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
  },
  imageContainer: {
    width: '100%',
    height: 400,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    marginTop: spacing.sm,
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
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
    color: colors.text,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : undefined,
    textAlignVertical: 'top',
  },
});

