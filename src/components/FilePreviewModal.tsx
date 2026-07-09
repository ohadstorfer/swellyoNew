/**
 * FilePreviewModal — the WhatsApp-style review screen for a picked document.
 * Cancel sends nothing and uploads nothing; the upload only starts on send.
 *
 * Structurally a clone of ImagePreviewModal: the Modal → GestureHandlerRootView
 * → GestureDetector → Animated.View → KeyboardAvoidingView nesting is load-
 * bearing. RNGH gestures never fire inside an Android Modal without a local
 * GestureHandlerRootView.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
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
import { FilePreviewBody } from './filePreview/FilePreviewBody';
import { ff, fs } from '../theme/fonts';

export interface PickedFilePreview {
  uri: string;
  display_name: string;
  ext: string;
  mime_type: string;
  size_bytes: number;
}

interface FilePreviewModalProps {
  visible: boolean;
  file: PickedFilePreview;
  onSend: (caption?: string) => void;
  onCancel: () => void;
  isProcessing?: boolean;
  primaryColor?: string;
}

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

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  visible,
  file,
  onSend,
  onCancel,
  isProcessing = false,
  primaryColor = '#B72DF2',
}) => {
  const insets = useSafeAreaInsets();
  const [caption, setCaption] = useState('');
  const translateY = useSharedValue(0);
  // onSend is async and the modal stays mounted across the round-trip, so state
  // updates too slowly to block a double-tap. A ref blocks it in the same tick.
  const sendingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      translateY.value = 0;
      sendingRef.current = false;
    }
  }, [visible, translateY]);

  const handleSend = () => {
    if (isProcessing) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    onSend(caption.trim() || undefined);
    setCaption('');
  };

  const handleCancel = () => {
    if (isProcessing) return;
    setCaption('');
    onCancel();
  };

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
                <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={handleCancel}
                    disabled={isProcessing}
                    hitSlop={10}
                  >
                    <CloseIcon />
                  </TouchableOpacity>
                  <Text numberOfLines={1} style={styles.title}>
                    {file.display_name}
                  </Text>
                  {/* Balances the close button so the title stays centered. */}
                  <View style={styles.closeButton} />
                </View>

                <View style={styles.body}>
                  <FilePreviewBody
                    uri={file.uri}
                    displayName={file.display_name}
                    ext={file.ext}
                    sizeBytes={file.size_bytes}
                  />
                </View>

                <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                  <ChatTextInput
                    value={caption}
                    onChangeText={setCaption}
                    onSend={handleSend}
                    placeholder="Add a comment…"
                    allowEmpty
                    disabled={isProcessing}
                    primaryColor={primaryColor}
                    backgroundColor="#2A2A2A"
                    textColor="#FFFFFF"
                    placeholderColor="rgba(255,255,255,0.5)"
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
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: ff('Inter', '600'),
    fontSize: fs(16),
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  body: { flex: 1 },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    minHeight: 64,
  },
});
