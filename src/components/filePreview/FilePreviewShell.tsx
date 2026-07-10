/**
 * FilePreviewShell — the dark full-screen chrome shared by the send-side
 * FilePreviewModal and the receive-side FileViewerModal: a close X, a centered
 * filename, swipe-down-to-dismiss, and FilePreviewBody. The footer is a slot.
 *
 * The Modal → GestureHandlerRootView → GestureDetector → Animated.View →
 * KeyboardAvoidingView nesting is load-bearing: RNGH gestures never fire inside
 * an Android Modal without a local GestureHandlerRootView.
 */
import React from 'react';
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
import { FilePreviewBody } from './FilePreviewBody';
import { ff, fs } from '../../theme/fonts';

export interface FilePreviewShellProps {
  visible: boolean;
  title: string;
  uri: string;
  ext: string;
  sizeBytes: number;
  onDismiss: () => void;
  dismissDisabled?: boolean;
  children?: React.ReactNode;
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

export const FilePreviewShell: React.FC<FilePreviewShellProps> = ({
  visible,
  title,
  uri,
  ext,
  sizeBytes,
  onDismiss,
  dismissDisabled = false,
  children,
}) => {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);

  // Reset the drag offset whenever the shell reopens.
  React.useEffect(() => {
    if (visible) translateY.value = 0;
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
        const destination = e.translationY > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT;
        translateY.value = withTiming(destination, { duration: 220 }, (finished) => {
          if (finished) {
            runOnJS(onDismiss)();
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
      onRequestClose={onDismiss}
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
                    onPress={onDismiss}
                    disabled={dismissDisabled}
                    hitSlop={10}
                  >
                    <CloseIcon />
                  </TouchableOpacity>
                  <Text numberOfLines={1} style={styles.title}>
                    {title}
                  </Text>
                  {/* Balances the close button so the title stays centered. */}
                  <View style={styles.closeButtonSpacer} />
                </View>

                <View style={styles.body}>
                  <FilePreviewBody
                    uri={uri}
                    displayName={title}
                    ext={ext}
                    sizeBytes={sizeBytes}
                  />
                </View>

                {children}
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
  closeButtonSpacer: {
    width: 36,
    height: 36,
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
});
