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
}

const CROP_PADDING = 16;

const AvatarCropModal: React.FC<AvatarCropModalProps> = ({
  visible,
  imageUri,
  onConfirm,
  onCancel,
}) => {
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const cropDiameter = Math.max(
    0,
    Math.min(containerWidth, containerHeight) - CROP_PADDING * 2,
  );

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
  const cropDSv = useSharedValue(0);

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
    if (!imageSize || cropDiameter <= 0) return;
    const minS = cropDiameter / Math.min(imageSize.width, imageSize.height);
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
    cropDSv.value = cropDiameter;
  }, [imageSize, cropDiameter]);

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
          const maxTx = (imageWSv.value * s - cropDSv.value) / 2;
          const maxTy = (imageHSv.value * s - cropDSv.value) / 2;
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
          const maxTx = (imageWSv.value * s - cropDSv.value) / 2;
          const maxTy = (imageHSv.value * s - cropDSv.value) / 2;
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
    if (!imageSize || cropDiameter <= 0 || busy) return;
    setBusy(true);
    try {
      const s = scale.value;
      const tx = translateX.value;
      const ty = translateY.value;

      const cropSizePx = cropDiameter / s;
      const centerX = imageSize.width / 2 - tx / s;
      const centerY = imageSize.height / 2 - ty / s;

      const size = Math.round(cropSizePx);
      let originX = Math.round(centerX - cropSizePx / 2);
      let originY = Math.round(centerY - cropSizePx / 2);
      originX = Math.max(0, Math.min(originX, imageSize.width - size));
      originY = Math.max(0, Math.min(originY, imageSize.height - size));

      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ crop: { originX, originY, width: size, height: size } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      onConfirm(result.uri);
    } catch (e) {
      console.error('[AvatarCropModal] crop failed:', e);
    } finally {
      setBusy(false);
    }
  }, [imageSize, cropDiameter, imageUri, onConfirm, busy]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <Text style={styles.title}>Move and scale</Text>

        <View
          style={styles.cropperWrapper}
          onLayout={(e) => {
            setContainerWidth(e.nativeEvent.layout.width);
            setContainerHeight(e.nativeEvent.layout.height);
          }}
        >
          {cropDiameter > 0 && imageSize && (
            <GestureDetector gesture={composedGesture}>
              <View style={StyleSheet.absoluteFill}>
                <View
                  style={[
                    styles.cropSquare,
                    {
                      width: cropDiameter,
                      height: cropDiameter,
                      borderRadius: cropDiameter / 2,
                      left: (containerWidth - cropDiameter) / 2,
                      top: (containerHeight - cropDiameter) / 2,
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
                        left: (cropDiameter - imageSize.width) / 2,
                        top: (cropDiameter - imageSize.height) / 2,
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
