import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image as RNImage,
  Platform,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import { Text } from './Text';

interface AvatarCropModalProps {
  visible: boolean;
  imageUri: string;
  onConfirm: (croppedUri: string) => void;
  onCancel: () => void;
  aspect?: number; // width / height. Defaults to 1 (square).
  cropShape?: 'round' | 'rect'; // Defaults to 'round'.
  title?: string;
}

const CROP_PADDING = 16;

const AvatarCropModal: React.FC<AvatarCropModalProps> = ({
  visible,
  imageUri,
  onConfirm,
  onCancel,
  aspect = 1,
  cropShape = 'round',
  title = 'Move and scale',
}) => {
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Fit a `aspect`-shaped frame inside the available container.
  const availW = Math.max(0, containerWidth - CROP_PADDING * 2);
  const availH = Math.max(0, containerHeight - CROP_PADDING * 2);
  let cropWidth = 0;
  let cropHeight = 0;
  if (availW > 0 && availH > 0) {
    if (availW / aspect <= availH) {
      cropWidth = availW;
      cropHeight = availW / aspect;
    } else {
      cropHeight = availH;
      cropWidth = availH * aspect;
    }
  }

  // Shared values mirror the React state above so worklets on the UI thread
  // can read them without stale-closure issues.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const minScaleSv = useSharedValue(1);
  const maxScaleSv = useSharedValue(3);
  const imageWSv = useSharedValue(0);
  const imageHSv = useSharedValue(0);
  const cropWSv = useSharedValue(0);
  const cropHSv = useSharedValue(0);

  useEffect(() => {
    if (!visible || !imageUri) {
      setImageSize(null);
      return;
    }
    let cancelled = false;
    RNImage.getSize(
      imageUri,
      (w, h) => {
        if (!cancelled) setImageSize({ width: w, height: h });
      },
      (err) => {
        console.warn('[AvatarCropModal] getSize failed:', err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUri, visible]);

  // Initialize transform state once image + crop area are both known.
  useEffect(() => {
    if (!imageSize || cropWidth <= 0 || cropHeight <= 0) return;
    // minScale must cover both axes of the (possibly non-square) crop frame.
    const minS = Math.max(
      cropWidth / imageSize.width,
      cropHeight / imageSize.height,
    );
    minScaleSv.value = minS;
    maxScaleSv.value = minS * 3;
    scale.value = minS;
    savedScale.value = minS;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    imageWSv.value = imageSize.width;
    imageHSv.value = imageSize.height;
    cropWSv.value = cropWidth;
    cropHSv.value = cropHeight;
  }, [imageSize, cropWidth, cropHeight]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        })
        .onUpdate((e) => {
          translateX.value = savedTranslateX.value + e.translationX;
          translateY.value = savedTranslateY.value + e.translationY;
        })
        .onEnd(() => {
          const s = scale.value;
          const maxTx = (imageWSv.value * s - cropWSv.value) / 2;
          const maxTy = (imageHSv.value * s - cropHSv.value) / 2;
          if (translateX.value > maxTx) translateX.value = withTiming(maxTx);
          else if (translateX.value < -maxTx) translateX.value = withTiming(-maxTx);
          if (translateY.value > maxTy) translateY.value = withTiming(maxTy);
          else if (translateY.value < -maxTy) translateY.value = withTiming(-maxTy);
        }),
    [],
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          savedScale.value = scale.value;
        })
        .onUpdate((e) => {
          const next = savedScale.value * e.scale;
          scale.value = Math.min(
            Math.max(next, minScaleSv.value),
            maxScaleSv.value,
          );
        })
        .onEnd(() => {
          const s = scale.value;
          const maxTx = (imageWSv.value * s - cropWSv.value) / 2;
          const maxTy = (imageHSv.value * s - cropHSv.value) / 2;
          if (translateX.value > maxTx) translateX.value = withTiming(maxTx);
          else if (translateX.value < -maxTx) translateX.value = withTiming(-maxTx);
          if (translateY.value > maxTy) translateY.value = withTiming(maxTy);
          else if (translateY.value < -maxTy) translateY.value = withTiming(-maxTy);
        }),
    [],
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture),
    [pinchGesture, panGesture],
  );

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const handleConfirm = useCallback(async () => {
    if (!imageSize || cropWidth <= 0 || cropHeight <= 0 || busy) return;
    setBusy(true);
    try {
      const s = scale.value;
      const tx = translateX.value;
      const ty = translateY.value;

      const cropWPx = cropWidth / s;
      const cropHPx = cropHeight / s;
      const centerX = imageSize.width / 2 - tx / s;
      const centerY = imageSize.height / 2 - ty / s;

      const w = Math.round(cropWPx);
      const h = Math.round(cropHPx);
      let originX = Math.round(centerX - cropWPx / 2);
      let originY = Math.round(centerY - cropHPx / 2);
      originX = Math.max(0, Math.min(originX, imageSize.width - w));
      originY = Math.max(0, Math.min(originY, imageSize.height - h));

      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ crop: { originX, originY, width: w, height: h } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      onConfirm(result.uri);
    } catch (e) {
      console.error('[AvatarCropModal] crop failed:', e);
    } finally {
      setBusy(false);
    }
  }, [imageSize, cropWidth, cropHeight, imageUri, onConfirm, busy]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <Text style={styles.title}>{title}</Text>

        <View
          style={styles.cropperWrapper}
          onLayout={(e) => {
            setContainerWidth(e.nativeEvent.layout.width);
            setContainerHeight(e.nativeEvent.layout.height);
          }}
        >
          {cropWidth > 0 && cropHeight > 0 && imageSize && (
            <GestureDetector gesture={composedGesture}>
              <View style={StyleSheet.absoluteFill}>
                <View
                  style={[
                    styles.cropSquare,
                    {
                      width: cropWidth,
                      height: cropHeight,
                      borderRadius: cropShape === 'round' ? Math.min(cropWidth, cropHeight) / 2 : 0,
                      left: (containerWidth - cropWidth) / 2,
                      top: (containerHeight - cropHeight) / 2,
                    },
                  ]}
                >
                  <Animated.Image
                    source={{ uri: imageUri }}
                    style={[
                      {
                        position: 'absolute',
                        width: imageSize.width,
                        height: imageSize.height,
                        left: (cropWidth - imageSize.width) / 2,
                        top: (cropHeight - imageSize.height) / 2,
                      },
                      animatedImageStyle,
                    ]}
                  />
                </View>
              </View>
            </GestureDetector>
          )}
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity onPress={onCancel} disabled={busy}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleConfirm} disabled={busy}>
            <Text style={[styles.confirmText, busy && styles.confirmTextDisabled]}>
              {busy ? 'Saving…' : 'Choose'}
            </Text>
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
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 20,
  },
  cropperWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  cropSquare: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
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
  confirmTextDisabled: {
    opacity: 0.5,
  },
});

export default AvatarCropModal;
