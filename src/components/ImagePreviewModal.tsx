import React from 'react';
import { Modal, Platform } from 'react-native';
import { ImagePreviewContent } from './ImagePreviewContent';

interface ImagePreviewModalProps {
  visible: boolean;
  imageUri: string;
  onSend: (caption?: string) => void;
  onCancel: () => void;
  /** When provided, shows an Edit button that opens a native crop/edit flow. */
  onEdit?: () => void;
  isProcessing?: boolean;
  /** Overrides the default send-button color so the preview matches the host chat's theme. */
  primaryColor?: string;
}

const DEBUG_IMAGE_PICKER = typeof __DEV__ !== 'undefined' && __DEV__ && Platform.OS === 'web';

/**
 * Standalone fullscreen image preview. Thin <Modal> shell around
 * ImagePreviewContent; the same content also renders inline inside
 * ChatCameraModal for the filmstrip flow.
 */
export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = (props) => {
  if (DEBUG_IMAGE_PICKER && props.visible) {
    console.log('[ImagePicker] checkpoint 6: ImagePreviewModal render with visible=true', {
      imageUriLength: props.imageUri?.length ?? 0,
    });
  }

  return (
    <Modal
      visible={props.visible}
      animationType="fade"
      onRequestClose={() => {
        if (!props.isProcessing) props.onCancel();
      }}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <ImagePreviewContent {...props} />
    </Modal>
  );
};
