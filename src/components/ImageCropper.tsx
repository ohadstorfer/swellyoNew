import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Image,
  TouchableOpacity,
  Dimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text } from './Text';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useAnimatedGestureHandler,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import {
  PinchGestureHandler,
  PanGestureHandler,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import * as ImageManipulator from 'expo-image-manipulator';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CROP_SIZE = Math.min(SCREEN_WIDTH - 64, 320); // Max 320px, with padding
const MIN_SCALE = 1;
const MAX_SCALE = 3;

interface ImageCropperProps {
  visible: boolean;
  imageUri: string;
  onCancel: () => void;
  onSave: (croppedImageUri: string) => void;
  aspectRatio?: [number, number]; // [width, height]
}

export const ImageCropper: React.FC<ImageCropperProps> = ({
  visible,
  imageUri,
  onCancel,
  onSave,
  aspectRatio = [1, 1], // Square by default
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  
  // Animation values
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // Shared values for image size (worklets can access these)
  const imageWidth = useSharedValue(0);
  const imageHeight = useSharedValue(0);

  const pinchRef = useRef(null);
  const panRef = useRef(null);

  // Calculate crop area dimensions
  const cropWidth = CROP_SIZE;
  const cropHeight = CROP_SIZE * (aspectRatio[1] / aspectRatio[0]);

  // Load image dimensions
  React.useEffect(() => {
    if (imageUri && visible) {
      if (Platform.OS === 'web') {
        // For web, create an image element to get dimensions
        const img = new window.Image();
        img.onload = () => {
          setImageSize({ width: img.width, height: img.height });
          imageWidth.value = img.width;
          imageHeight.value = img.height;
          // Reset transforms when new image loads
          translateX.value = 0;
          translateY.value = 0;
          scale.value = 1;
          savedScale.value = 1;
          savedTranslateX.value = 0;
          savedTranslateY.value = 0;
        };
        img.onerror = (error) => {
          console.error('Error loading image:', error);
          // Fallback size
          setImageSize({ width: CROP_SIZE, height: CROP_SIZE });
        };
        img.src = imageUri;
      } else {
        Image.getSize(
          imageUri,
          (width, height) => {
            setImageSize({ width, height });
            imageWidth.value = width;
            imageHeight.value = height;
            // Reset transforms when new image loads
            translateX.value = 0;
            translateY.value = 0;
            scale.value = 1;
            savedScale.value = 1;
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
          },
          (error) => {
            console.error('Error getting image size:', error);
            // Fallback size
            setImageSize({ width: CROP_SIZE, height: CROP_SIZE });
          }
        );
      }
    }
  }, [imageUri, visible]);

  // Constrain image position within crop area
  const constrainPosition = () => {
    'worklet';
    if (!imageWidth.value || !imageHeight.value) return;
    
    const imageDisplayWidth = imageWidth.value * savedScale.value;
    const imageDisplayHeight = imageHeight.value * savedScale.value;
    
    const maxX = (imageDisplayWidth - cropWidth) / 2;
    const maxY = (imageDisplayHeight - cropHeight) / 2;
    
    if (imageDisplayWidth <= cropWidth) {
      savedTranslateX.value = 0;
    } else {
      savedTranslateX.value = Math.max(-maxX, Math.min(maxX, savedTranslateX.value));
    }
    
    if (imageDisplayHeight <= cropHeight) {
      savedTranslateY.value = 0;
    } else {
      savedTranslateY.value = Math.max(-maxY, Math.min(maxY, savedTranslateY.value));
    }
    
    translateX.value = savedTranslateX.value;
    translateY.value = savedTranslateY.value;
  };

  // Pinch gesture handler for zoom
  const pinchHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: any) => {
      ctx.startScale = savedScale.value;
    },
    onActive: (event, ctx) => {
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, ctx.startScale * event.scale)
      );
      scale.value = newScale;
    },
    onEnd: () => {
      savedScale.value = scale.value;
      // Constrain position after zoom
      constrainPosition();
    },
  });

  // Pan gesture handler for moving
  const panHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: any) => {
      ctx.startX = savedTranslateX.value;
      ctx.startY = savedTranslateY.value;
    },
    onActive: (event, ctx) => {
      translateX.value = ctx.startX + event.translationX;
      translateY.value = ctx.startY + event.translationY;
    },
    onEnd: () => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      constrainPosition();
    },
  });

  // Animated style for the image
  const imageAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  // Handle crop and save
  const handleSave = async () => {
    if (!imageUri || isProcessing || !imageSize.width || !imageSize.height) return;

    setIsProcessing(true);
    try {
      const currentScale = savedScale.value;
      const currentTranslateX = savedTranslateX.value;
      const currentTranslateY = savedTranslateY.value;

      // Calculate the visible crop area in image coordinates
      // The image is centered, so we need to account for translation and scale
      const scaleFactor = currentScale;
      const scaledImageWidth = imageSize.width * scaleFactor;
      const scaledImageHeight = imageSize.height * scaleFactor;

      // Calculate the center of the crop area relative to the image center
      // translateX/Y are relative to the image center (0,0)
      const cropCenterX = -currentTranslateX / scaleFactor;
      const cropCenterY = -currentTranslateY / scaleFactor;

      // Calculate crop origin (top-left corner) in original image coordinates
      const cropOriginX = (imageSize.width / 2) + cropCenterX - (cropWidth / 2 / scaleFactor);
      const cropOriginY = (imageSize.height / 2) + cropCenterY - (cropHeight / 2 / scaleFactor);
      
      // Calculate crop dimensions in original image coordinates
      const cropWidthOriginal = cropWidth / scaleFactor;
      const cropHeightOriginal = cropHeight / scaleFactor;

      // Ensure crop region is within image bounds
      const finalOriginX = Math.max(0, Math.min(imageSize.width - cropWidthOriginal, cropOriginX));
      const finalOriginY = Math.max(0, Math.min(imageSize.height - cropHeightOriginal, cropOriginY));
      const finalWidth = Math.min(cropWidthOriginal, imageSize.width - finalOriginX);
      const finalHeight = Math.min(cropHeightOriginal, imageSize.height - finalOriginY);

      // Crop the image
      const manipResult = await ImageManipulator.manipulateAsync(
        imageUri,
        [
          {
            crop: {
              originX: finalOriginX,
              originY: finalOriginY,
              width: finalWidth,
              height: finalHeight,
            },
          },
          {
            resize: {
              width: 400, // High quality output
              height: 400 * (aspectRatio[1] / aspectRatio[0]),
            },
          },
        ],
        {
          compress: 0.9,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );

      onSave(manipResult.uri);
    } catch (error) {
      console.error('Error cropping image:', error);
      // Fallback: use original image
      onSave(imageUri);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!visible || !imageUri) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.container}>
        <View style={styles.overlay}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={onCancel}
              style={styles.cancelButton}
              disabled={isProcessing}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Adjust Photo</Text>
            <TouchableOpacity
              onPress={handleSave}
              style={styles.saveButton}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.saveText}>Done</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Crop Area */}
          <View style={styles.cropContainer}>
            <View style={[styles.cropArea, { width: cropWidth, height: cropHeight }]}>
              {/* Overlay - darken outside crop area */}
              <View style={styles.overlayTop} />
              <View style={styles.overlayBottom} />
              <View style={styles.overlayLeft} />
              <View style={styles.overlayRight} />

              {/* Image with gestures */}
              <PinchGestureHandler
                ref={pinchRef}
                onGestureEvent={pinchHandler}
                simultaneousHandlers={panRef}
              >
                <Animated.View style={styles.gestureContainer}>
                  <PanGestureHandler
                    ref={panRef}
                    onGestureEvent={panHandler}
                    simultaneousHandlers={pinchRef}
                  >
                    <Animated.View style={styles.gestureContainer}>
                      <Animated.Image
                        source={{ uri: imageUri }}
                        style={[
                          styles.image,
                          {
                            width: imageSize.width || CROP_SIZE,
                            height: imageSize.height || CROP_SIZE,
                          },
                          imageAnimatedStyle,
                        ]}
                        resizeMode="contain"
                      />
                    </Animated.View>
                  </PanGestureHandler>
                </Animated.View>
              </PinchGestureHandler>

              {/* Crop frame border */}
              <View style={[styles.cropFrame, { width: cropWidth, height: cropHeight }]} />
            </View>
          </View>

          {/* Instructions */}
          <View style={styles.instructions}>
            <Ionicons name="hand-left-outline" size={20} color="#FFFFFF" />
            <Text style={styles.instructionText}>
              Pinch to zoom • Drag to move
            </Text>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 20,
    zIndex: 10,
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#4A90E2',
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cropContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  cropArea: {
    position: 'relative',
    alignSelf: 'center',
  },
  gestureContainer: {
    width: '100%',
    height: '100%',
  },
  image: {
    position: 'absolute',
  },
  overlayTop: {
    position: 'absolute',
    top: -SCREEN_HEIGHT,
    left: -SCREEN_WIDTH,
    width: SCREEN_WIDTH * 2,
    height: SCREEN_HEIGHT,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  overlayBottom: {
    position: 'absolute',
    bottom: -SCREEN_HEIGHT,
    left: -SCREEN_WIDTH,
    width: SCREEN_WIDTH * 2,
    height: SCREEN_HEIGHT,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  overlayLeft: {
    position: 'absolute',
    top: -SCREEN_HEIGHT,
    left: -SCREEN_WIDTH,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 2,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  overlayRight: {
    position: 'absolute',
    top: -SCREEN_HEIGHT,
    right: -SCREEN_WIDTH,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 2,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  cropFrame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 0,
    zIndex: 5,
  },
  instructions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    gap: 8,
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 14,
    opacity: 0.8,
  },
});

