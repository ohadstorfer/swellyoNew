import React from 'react';
import { Modal, Platform } from 'react-native';
import { VideoPreviewContent } from './VideoPreviewContent';

interface VideoPreviewModalProps {
  visible: boolean;
  videoUri: string;
  onSend: (caption?: string, overrideVideoUri?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  /** Overrides the default send-button color so the preview matches the host chat's theme. */
  primaryColor?: string;
}

/**
 * Standalone fullscreen video preview. Thin <Modal> shell around
 * VideoPreviewContent; the same content also renders inline inside
 * ChatCameraModal for the filmstrip flow.
 */
export const VideoPreviewModal: React.FC<VideoPreviewModalProps> = (props) => {
  return (
    <Modal
      visible={props.visible}
      animationType="fade"
      onRequestClose={() => {
        if (!props.isProcessing) props.onCancel();
      }}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <VideoPreviewContent {...props} />
    </Modal>
  );
};
