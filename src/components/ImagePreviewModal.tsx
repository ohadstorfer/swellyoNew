import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import Svg, { Path } from 'react-native-svg';
import { ChatTextInput } from './ChatTextInput';
import { colors } from '../styles/theme';

interface ImagePreviewModalProps {
  visible: boolean;
  imageUri: string;
  onSend: (caption?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  /** Overrides the default send-button color so the preview matches the host chat's theme. */
  primaryColor?: string;
}

const DEBUG_IMAGE_PICKER = typeof __DEV__ !== 'undefined' && __DEV__ && Platform.OS === 'web';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_DISTANCE = 120; // px — past this, release dismisses
const DISMISS_VELOCITY = 800; // px/s — past this, release dismisses regardless of distance

const CloseIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 6L6 18M6 6l12 12"
      stroke="#FFFFFF"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  visible,
  imageUri,
  onSend,
  onCancel,
  isProcessing = false,
  primaryColor = '#B72DF2',
}) => {
  if (DEBUG_IMAGE_PICKER && visible) {
    console.log('[ImagePicker] checkpoint 6: ImagePreviewModal render with visible=true', { imageUriLength: imageUri?.length ?? 0 });
  }

  const insets = useSafeAreaInsets();
  const [caption, setCaption] = useState('');

  const translateY = useSharedValue(0);

  // Reset the animated offset every time the modal opens so re-opens start centered.
  useEffect(() => {
    if (visible) {
      translateY.value = 0;
    }
  }, [visible, translateY]);

  const handleSend = () => {
    if (isProcessing) return;
    onSend(caption.trim() || undefined);
    setCaption('');
  };

  const handleCancel = () => {
    if (isProcessing) return;
    setCaption('');
    onCancel();
  };

  // Pan-to-dismiss — vertical swipe (up or down) past the threshold closes the modal.
  // `activeOffsetY` requires a real vertical motion before activating, so taps on the
  // caption input still focus normally. `failOffsetX` bails on mostly-horizontal drags.
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
        const destination = e.translationY > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT;
        translateY.value = withTiming(destination, { duration: 220 }, (finished) => {
          if (finished) {
            runOnJS(handleCancel)();
          }
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 180 });
      }
    });

  const animatedContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(
      Math.abs(translateY.value),
      [0, SCREEN_HEIGHT * 0.4],
      [1, 0.6],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.container}>
          <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.flex, animatedContentStyle]}>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.flex}
              >
                {/* Image fills the available space */}
                <View style={styles.imageContainer}>
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.image}
                    resizeMode="contain"
                  />

                  {isProcessing && (
                    <View style={styles.processingOverlay} pointerEvents="none">
                      <ActivityIndicator size="large" color="#FFFFFF" />
                    </View>
                  )}
                </View>

                {/* Close button — circular, top-left, above the status bar */}
                <TouchableOpacity
                  style={[styles.closeButton, { top: insets.top + 12 }]}
                  onPress={handleCancel}
                  disabled={isProcessing}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <CloseIcon />
                </TouchableOpacity>

                {/* Caption bar — reuses ChatTextInput so behaviour matches the DM composer exactly */}
                <View style={[styles.inputWrapper, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                  <ChatTextInput
                    value={caption}
                    onChangeText={setCaption}
                    onSend={handleSend}
                    disabled={isProcessing}
                    placeholder="Add a caption..."
                    maxLength={500}
                    primaryColor={primaryColor}
                    backgroundColor="#2B2B2B"
                    textColor="#FFFFFF"
                    placeholderColor="rgba(255, 255, 255, 0.5)"
                    allowEmpty
                  />
                </View>
              </KeyboardAvoidingView>
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  closeButton: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(40, 40, 40, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
});
