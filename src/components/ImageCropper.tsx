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
// Calculate available space for crop area (screen height minus header and instructions)
const AVAILABLE_HEIGHT = SCREEN_HEIGHT - 200; // Reserve space for header and instructions
const MAX_CROP_SIZE = Math.min(SCREEN_WIDTH - 64, AVAILABLE_HEIGHT - 40);
const MIN_SCALE = 0.5; // Allow zooming out if needed
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
  // Shared values for crop dimensions
  const cropWidthShared = useSharedValue(MAX_CROP_SIZE);
  const cropHeightShared = useSharedValue(MAX_CROP_SIZE);

  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const imageRef = useRef<Animated.Image>(null);
  
  // Web-specific touch handlers for better compatibility
  const lastTouchDistance = useRef<number | null>(null);
  const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);

  // Calculate crop area dimensions - make it as large as possible
  const [cropDimensions, setCropDimensions] = useState({ width: MAX_CROP_SIZE, height: MAX_CROP_SIZE });
  
  // Calculate optimal crop size - make it as large as possible while fitting on screen
  const calculateOptimalCropSize = (imgWidth: number, imgHeight: number) => {
    if (!imgWidth || !imgHeight) return { width: MAX_CROP_SIZE, height: MAX_CROP_SIZE };
    
    const aspect = aspectRatio[0] / aspectRatio[1];
    const availableWidth = SCREEN_WIDTH - 64;
    const availableHeight = AVAILABLE_HEIGHT;
    
    // Calculate max size that fits both width and height constraints
    // Start with width constraint
    let cropW = availableWidth;
    let cropH = cropW / aspect;
    
    // If height exceeds available space, use height constraint instead
    if (cropH > availableHeight) {
      cropH = availableHeight;
      cropW = cropH * aspect;
    }
    
    // Ensure minimum size
    cropW = Math.max(200, cropW);
    cropH = Math.max(200, cropH);
    
    return { width: cropW, height: cropH };
  };

  // Web-specific zoom handlers - using React Native Web's event system
  const gestureContainerRef = useRef<View>(null);

  const handleWebTouchStart = (e: any) => {
    if (Platform.OS !== 'web' || !visible) return;
    
    console.log('[ImageCropper] Touch start event:', e);
    
    // React Native Web passes native events differently
    const nativeEvent = e.nativeEvent || e;
    
    // Try to get touches from various possible locations
    let touches = nativeEvent.touches;
    if (!touches && nativeEvent.changedTouches) {
      touches = nativeEvent.changedTouches;
    }
    if (!touches && (e as any).touches) {
      touches = (e as any).touches;
    }
    
    if (!touches || touches.length === 0) {
      console.log('[ImageCropper] No touches found in event');
      return;
    }
    
    console.log('[ImageCropper] Touch count:', touches.length);
    
    if (touches.length === 2) {
      e.preventDefault?.();
      const touch1 = touches[0];
      const touch2 = touches[1];
      const distance = Math.hypot(
        (touch2.pageX || touch2.clientX) - (touch1.pageX || touch1.clientX),
        (touch2.pageY || touch2.clientY) - (touch1.pageY || touch1.clientY)
      );
      lastTouchDistance.current = distance;
      lastTouchCenter.current = {
        x: ((touch1.pageX || touch1.clientX) + (touch2.pageX || touch2.clientX)) / 2,
        y: ((touch1.pageY || touch1.clientY) + (touch2.pageY || touch2.clientY)) / 2,
      };
      console.log('[ImageCropper] Pinch started, distance:', distance);
    } else if (touches.length === 1) {
      const touch = touches[0];
      lastTouchCenter.current = {
        x: touch.pageX || touch.clientX,
        y: touch.pageY || touch.clientY,
      };
      console.log('[ImageCropper] Pan started at:', lastTouchCenter.current);
    }
  };

  const handleWebTouchMove = (e: any) => {
    if (Platform.OS !== 'web' || !visible) return;
    
    const nativeEvent = e.nativeEvent || e;
    
    // Try to get touches from various possible locations
    let touches = nativeEvent.touches;
    if (!touches && nativeEvent.changedTouches) {
      touches = nativeEvent.changedTouches;
    }
    if (!touches && (e as any).touches) {
      touches = (e as any).touches;
    }
    
    if (!touches || touches.length === 0) return;
    
    if (touches.length === 2 && lastTouchDistance.current !== null) {
      e.preventDefault?.();
      const touch1 = touches[0];
      const touch2 = touches[1];
      const distance = Math.hypot(
        (touch2.pageX || touch2.clientX) - (touch1.pageX || touch1.clientX),
        (touch2.pageY || touch2.clientY) - (touch1.pageY || touch1.clientY)
      );
      
      const scaleChange = distance / lastTouchDistance.current;
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, savedScale.value * scaleChange)
      );
      
      scale.value = newScale;
      lastTouchDistance.current = distance;
    } else if (touches.length === 1 && lastTouchCenter.current) {
      e.preventDefault?.();
      const touch = touches[0];
      const currentX = touch.pageX || touch.clientX;
      const currentY = touch.pageY || touch.clientY;
      const deltaX = currentX - lastTouchCenter.current.x;
      const deltaY = currentY - lastTouchCenter.current.y;
      translateX.value = savedTranslateX.value + deltaX;
      translateY.value = savedTranslateY.value + deltaY;
      lastTouchCenter.current = { x: currentX, y: currentY };
    }
  };

  const handleWebTouchEnd = (e: any) => {
    if (Platform.OS !== 'web' || !visible) return;
    savedScale.value = scale.value;
    savedTranslateX.value = translateX.value;
    savedTranslateY.value = translateY.value;
    lastTouchDistance.current = null;
    lastTouchCenter.current = null;
    constrainPosition();
  };

  const handleWebWheel = (e: any) => {
    if (Platform.OS !== 'web' || !visible) return;
    
    const nativeEvent = e.nativeEvent || e;
    if (nativeEvent.ctrlKey || nativeEvent.metaKey) {
      e.preventDefault?.();
      const delta = nativeEvent.deltaY;
      const scaleFactor = delta > 0 ? 0.9 : 1.1;
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, savedScale.value * scaleFactor)
      );
      scale.value = newScale;
      savedScale.value = newScale;
      constrainPosition();
    }
  };


  // Prevent browser zoom on web
  React.useEffect(() => {
    if (visible && Platform.OS === 'web') {
      // Prevent default pinch zoom on the document
      const preventZoom = (e: TouchEvent) => {
        if (e.touches.length > 1) {
          e.preventDefault();
        }
      };
      
      const preventWheelZoom = (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
        }
      };

      document.addEventListener('touchstart', preventZoom, { passive: false });
      document.addEventListener('touchmove', preventZoom, { passive: false });
      document.addEventListener('wheel', preventWheelZoom, { passive: false });
      
      // Set viewport meta to prevent zoom
      const viewport = document.querySelector('meta[name=viewport]');
      if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
      }

      return () => {
        document.removeEventListener('touchstart', preventZoom);
        document.removeEventListener('touchmove', preventZoom);
        document.removeEventListener('wheel', preventWheelZoom);
        if (viewport) {
          viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, user-scalable=yes');
        }
      };
    }
  }, [visible]);

  // Load image dimensions
  React.useEffect(() => {
    if (imageUri && visible) {
      console.log('[ImageCropper] Loading image dimensions for:', imageUri);
      if (Platform.OS === 'web') {
        // For web, create an image element to get dimensions
        const img = new window.Image();
        img.onload = () => {
          const width = img.width;
          const height = img.height;
          console.log('[ImageCropper] Image loaded (web), dimensions:', width, 'x', height);
          setImageSize({ width, height });
          imageWidth.value = width;
          imageHeight.value = height;
          
          // Calculate optimal crop size
          const optimalCrop = calculateOptimalCropSize(width, height);
          setCropDimensions(optimalCrop);
          cropWidthShared.value = optimalCrop.width;
          cropHeightShared.value = optimalCrop.height;
          
          // Calculate initial scale to fit entire image within crop area
          const cropW = optimalCrop.width;
          const cropH = optimalCrop.height;
          
          // Calculate scale to fit the entire image within the crop area
          // We want the image to be fully visible, so scale it down if needed
          const scaleX = cropW / width;
          const scaleY = cropH / height;
          
          // Use the smaller scale to ensure image fits in both dimensions
          let initialScale = Math.min(scaleX, scaleY);
          
          // Never scale up beyond 1 (don't make image larger than original)
          initialScale = Math.min(initialScale, 1);
          
          // Ensure the scaled image fully fits within crop area
          const scaledWidth = width * initialScale;
          const scaledHeight = height * initialScale;
          
          // If scaled image is still larger than crop, scale down more
          if (scaledWidth > cropW || scaledHeight > cropH) {
            initialScale = Math.min(cropW / width, cropH / height);
          }
          
          // Reset transforms when new image loads - centered position
          translateX.value = 0;
          translateY.value = 0;
          scale.value = initialScale;
          savedScale.value = initialScale;
          savedTranslateX.value = 0;
          savedTranslateY.value = 0;
        };
         img.onerror = (error) => {
           console.error('Error loading image:', error);
           // Fallback size
           setImageSize({ width: MAX_CROP_SIZE, height: MAX_CROP_SIZE });
         };
        img.src = imageUri;
       } else {
         Image.getSize(
           imageUri,
           (width, height) => {
             console.log('[ImageCropper] Image loaded (native), dimensions:', width, 'x', height);
             setImageSize({ width, height });
             imageWidth.value = width;
             imageHeight.value = height;
            
            // Calculate optimal crop size
            const optimalCrop = calculateOptimalCropSize(width, height);
            setCropDimensions(optimalCrop);
            cropWidthShared.value = optimalCrop.width;
            cropHeightShared.value = optimalCrop.height;
            
            // Calculate initial scale to fit entire image within crop area
            const cropW = optimalCrop.width;
            const cropH = optimalCrop.height;
            
            // Calculate scale to fit the entire image within the crop area
            // We want the image to be fully visible, so scale it down if needed
            const scaleX = cropW / width;
            const scaleY = cropH / height;
            
            // Use the smaller scale to ensure image fits in both dimensions
            let initialScale = Math.min(scaleX, scaleY);
            
            // Never scale up beyond 1 (don't make image larger than original)
            initialScale = Math.min(initialScale, 1);
            
            // Ensure the scaled image fully fits within crop area
            const scaledWidth = width * initialScale;
            const scaledHeight = height * initialScale;
            
            // If scaled image is still larger than crop, scale down more
            if (scaledWidth > cropW || scaledHeight > cropH) {
              initialScale = Math.min(cropW / width, cropH / height);
            }
            
            // Reset transforms when new image loads - centered position
            translateX.value = 0;
            translateY.value = 0;
            scale.value = initialScale;
            savedScale.value = initialScale;
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
          },
           (error) => {
             console.error('Error getting image size:', error);
             // Fallback size
             setImageSize({ width: MAX_CROP_SIZE, height: MAX_CROP_SIZE });
           }
        );
      }
    }
  }, [imageUri, visible]);

  // Constrain image position within crop area
  const constrainPosition = () => {
    'worklet';
    if (!imageWidth.value || !imageHeight.value) {
      return;
    }
    
    const cropW = cropWidthShared.value;
    const cropH = cropHeightShared.value;
    const imageDisplayWidth = imageWidth.value * savedScale.value;
    const imageDisplayHeight = imageHeight.value * savedScale.value;
    
    const maxX = (imageDisplayWidth - cropW) / 2;
    const maxY = (imageDisplayHeight - cropH) / 2;
    
    if (imageDisplayWidth <= cropW) {
      savedTranslateX.value = 0;
    } else {
      savedTranslateX.value = Math.max(-maxX, Math.min(maxX, savedTranslateX.value));
    }
    
    if (imageDisplayHeight <= cropH) {
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
      'worklet';
      ctx.startScale = savedScale.value;
    },
    onActive: (event, ctx) => {
      'worklet';
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, ctx.startScale * event.scale)
      );
      scale.value = newScale;
    },
    onEnd: () => {
      'worklet';
      savedScale.value = scale.value;
      // Constrain position after zoom
      constrainPosition();
    },
  });

  // Pan gesture handler for moving
  const panHandler = useAnimatedGestureHandler({
    onStart: (_, ctx: any) => {
      'worklet';
      ctx.startX = savedTranslateX.value;
      ctx.startY = savedTranslateY.value;
    },
    onActive: (event, ctx) => {
      'worklet';
      translateX.value = ctx.startX + event.translationX;
      translateY.value = ctx.startY + event.translationY;
    },
    onEnd: () => {
      'worklet';
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
  }, []);

  // Calculate image display size based on initial scale
  const getImageDisplaySize = () => {
    if (!imageSize.width || !imageSize.height) {
      return { width: cropDimensions.width, height: cropDimensions.height };
    }
    
    // Use the saved scale to calculate display size
    const currentScale = savedScale.value || 1;
    return {
      width: imageSize.width * currentScale,
      height: imageSize.height * currentScale,
    };
  };

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

      const cropW = cropDimensions.width;
      const cropH = cropDimensions.height;
      
      // Calculate crop origin (top-left corner) in original image coordinates
      const cropOriginX = (imageSize.width / 2) + cropCenterX - (cropW / 2 / scaleFactor);
      const cropOriginY = (imageSize.height / 2) + cropCenterY - (cropH / 2 / scaleFactor);
      
      // Calculate crop dimensions in original image coordinates
      const cropWidthOriginal = cropW / scaleFactor;
      const cropHeightOriginal = cropH / scaleFactor;

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
            <View 
              style={[styles.cropArea, { width: cropDimensions.width, height: cropDimensions.height }]}
              {...(Platform.OS === 'web' && { 'data-testid': 'crop-area' })}
            >
              {/* Overlay - darken outside crop area */}
              <View style={styles.overlayTop} />
              <View style={styles.overlayBottom} />
              <View style={styles.overlayLeft} />
              <View style={styles.overlayRight} />

              {/* Image with gestures */}
              {Platform.OS === 'web' ? (
                // Web: Use React Native Web touch events
                <View 
                  ref={gestureContainerRef}
                  style={styles.gestureContainer}
                  onTouchStart={handleWebTouchStart}
                  onTouchMove={handleWebTouchMove}
                  onTouchEnd={handleWebTouchEnd}
                  onTouchCancel={handleWebTouchEnd}
                  onWheel={handleWebWheel}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                >
                  {imageSize.width > 0 && imageSize.height > 0 && (
                    <Animated.Image
                      ref={imageRef}
                      source={{ uri: imageUri }}
                      style={[
                        styles.image,
                        {
                          width: imageSize.width,
                          height: imageSize.height,
                        },
                        imageAnimatedStyle,
                      ]}
                      resizeMode="contain"
                    />
                  )}
                </View>
              ) : (
                // Native: Use gesture handlers
                <PanGestureHandler
                  ref={panRef}
                  onGestureEvent={panHandler}
                  simultaneousHandlers={pinchRef}
                  minPointers={1}
                  maxPointers={1}
                >
                  <Animated.View style={styles.gestureContainer}>
                    <PinchGestureHandler
                      ref={pinchRef}
                      onGestureEvent={pinchHandler}
                      simultaneousHandlers={panRef}
                      minPointers={2}
                      maxPointers={2}
                    >
                      <Animated.View style={styles.gestureContainer}>
                        {imageSize.width > 0 && imageSize.height > 0 && (
                          <Animated.Image
                            ref={imageRef}
                            source={{ uri: imageUri }}
                            style={[
                              styles.image,
                              {
                                width: imageSize.width,
                                height: imageSize.height,
                              },
                              imageAnimatedStyle,
                            ]}
                            resizeMode="contain"
                          />
                        )}
                      </Animated.View>
                    </PinchGestureHandler>
                  </Animated.View>
                </PanGestureHandler>
              )}

              {/* Crop frame border */}
              <View style={[styles.cropFrame, { width: cropDimensions.width, height: cropDimensions.height }]} />
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
    overflow: 'hidden',
    ...(Platform.OS === 'web' && {
      touchAction: 'none', // Prevent browser zoom/pan
    }),
  },
  gestureContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' && {
      touchAction: 'none', // Prevent browser zoom/pan
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
    }),
  },
  image: {
    position: 'absolute',
    // Center the image - transforms will be applied from center
    alignSelf: 'center',
    ...(Platform.OS === 'web' && {
      touchAction: 'none', // Prevent browser zoom/pan
      userSelect: 'none',
      WebkitUserSelect: 'none',
    }),
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

