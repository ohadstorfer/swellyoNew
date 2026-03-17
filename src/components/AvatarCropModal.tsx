import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import Cropper from 'react-easy-crop';
import { Text } from './Text';

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AvatarCropModalProps {
  visible: boolean;
  imageUri: string;
  onConfirm: (croppedUri: string) => void;
  onCancel: () => void;
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<string> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
  });

  const canvas = document.createElement('canvas');
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );

  return canvas.toDataURL('image/jpeg', 0.9);
}

const AvatarCropModal: React.FC<AvatarCropModalProps> = ({
  visible,
  imageUri,
  onConfirm,
  onCancel,
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const cropDiameter = containerWidth > 0 ? containerWidth - 16 : 0;

  const onCropComplete = useCallback((_croppedArea: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const onMediaLoaded = useCallback((mediaSize: { naturalWidth: number; naturalHeight: number; width: number; height: number }) => {
    if (cropDiameter > 0) {
      // Scale so the image width fills the crop circle diameter.
      const requiredZoom = cropDiameter / mediaSize.width;
      const newMinZoom = Math.max(1, requiredZoom);
      setMinZoom(newMinZoom);
      setZoom(newMinZoom);
      setCrop({ x: 0, y: 0 });
    }
  }, [cropDiameter]);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    try {
      const croppedUri = await getCroppedImg(imageUri, croppedAreaPixels);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setMinZoom(1);
      onConfirm(croppedUri);
    } catch (e) {
      console.error('Failed to crop image:', e);
    }
  };

  const handleCancel = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setMinZoom(1);
    onCancel();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <Text style={styles.title}>Move and scale</Text>

        <View
          style={styles.cropperWrapper}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setContainerWidth(width);
            setContainerHeight(height);
          }}
        >
          {cropDiameter > 0 && (
            <Cropper
              image={imageUri}
              crop={crop}
              zoom={zoom}
              minZoom={minZoom}
              maxZoom={minZoom * 3}
              aspect={1}
              cropShape="round"
              showGrid={false}
              restrictPosition={false}
              cropSize={{ width: cropDiameter, height: cropDiameter }}
              onMediaLoaded={onMediaLoaded}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          )}
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleConfirm}>
            <Text style={styles.confirmText}>Choose</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000',
  },
  title: {
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center',
    color: '#fff',
    paddingTop: 60,
    paddingBottom: 20,
  },
  cropperWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 20,
    paddingBottom: 40,
  },
  cancelText: {
    fontSize: 17,
    color: '#fff',
  },
  confirmText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
});

export default AvatarCropModal;
