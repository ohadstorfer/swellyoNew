import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Text } from './Text';
import { spacing } from '../styles/theme';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

interface FullscreenImageViewerProps {
  visible: boolean;
  imageUrl: string;
  thumbnailUrl?: string;
  onClose: () => void;
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

export const FullscreenImageViewer: React.FC<FullscreenImageViewerProps> = ({
  visible,
  imageUrl,
  thumbnailUrl,
  onClose,
}) => {
  const [hasError, setHasError] = useState(false);
  const { height: screenHeight } = useWindowDimensions();
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setHasError(false);
    }
    translateY.value = 0;
  }, [visible, translateY]);

  const panGesture = Gesture.Pan()
    .activeOffsetY([-15, 15])
    .failOffsetX([-25, 25])
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const distance = Math.abs(e.translationY);
      const velocity = Math.abs(e.velocityY);
      if (distance > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) {
        const destination = e.translationY > 0 ? screenHeight : -screenHeight;
        translateY.value = withTiming(destination, { duration: 220 }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 180 });
      }
    });

  const animatedContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(
      Math.abs(translateY.value),
      [0, screenHeight * 0.4],
      [1, 0.6],
      Extrapolation.CLAMP,
    ),
  }));

  const content = (
    <>
      {/* Close button */}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        activeOpacity={0.7}
      >
        <Ionicons name="close" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Image container — only render when there's a URL to show. On close,
          the parent resets imageUrl to '' while the Modal fades out; rendering
          an <Image> with an empty uri would fire onError and flicker the
          "Failed to load image" view during the fade. */}
      <View style={styles.imageContainer}>
        {imageUrl ? (
          <>
            {/* The bubble already fetched this exact thumbnail URL through
                expo-image's memory-disk cache, so it paints instantly here —
                no spinner. It stays mounted underneath while the full-res
                fades in on top, so there's never a blank frame. */}
            {thumbnailUrl && (
              <ExpoImage
                source={{ uri: thumbnailUrl }}
                style={styles.thumbnailImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
              />
            )}

            {hasError ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={48} color="#FFFFFF" />
                <Text style={styles.errorText}>Failed to load image</Text>
              </View>
            ) : (
              <ExpoImage
                source={{ uri: imageUrl }}
                style={styles.fullImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                priority="high"
                transition={200}
                onError={() => setHasError(true)}
              />
            )}
          </>
        ) : null}
      </View>
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {Platform.OS === 'web' ? (
          content
        ) : (
          <GestureHandlerRootView style={styles.flex}>
            <GestureDetector gesture={panGesture}>
              <Animated.View style={[styles.flex, animatedContentStyle]}>
                {content}
              </Animated.View>
            </GestureDetector>
          </GestureHandlerRootView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  closeButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: spacing.md,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailImage: {
    // Thumbnail renders at full screen size (same as fullImage) so the image
    // starts visually full-size and only the pixel density improves when the
    // real URL loads. Previously it sat at 50% and popped to 100%.
    ...StyleSheet.absoluteFillObject,
  },
  fullImage: {
    ...StyleSheet.absoluteFillObject,
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
  },
});
