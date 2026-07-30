/**
 * DocumentViewer — full-screen look at one traveler document.
 *
 * Used by the traveler (their own passport) and by the host (reviewing, with
 * Approve / Reject).
 *
 * Four rules, all security-shaped rather than cosmetic:
 *
 * 1. The signed URL is minted here, per open, and lives about 60 seconds. It is
 *    held in local state that dies with the component and is never written to
 *    react-query, AsyncStorage, or a log. A signed URL is a bearer token.
 * 2. `cachePolicy="none"`. `expo-image` disk-caches by default, which would leave
 *    a plain unencrypted copy of a passport in the app's cache directory —
 *    outliving the URL, the 30-day purge, and logout.
 * 3. No share button, no save button, no "open in". The operator can still
 *    screenshot; we are not building a one-tap export.
 * 4. Pinch and pan to zoom is required, not a nicety — someone is reading a
 *    passport number off a phone screen.
 *
 * Spec: docs/specs/operator-trips/passport-upload-v1.md §4.6
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ff } from '../../theme/fonts';
import { getViewUrl } from '../../services/trips/tripDocumentsService';
import { friendlyErrorMessage } from '../../utils/friendlyError';

export const DocumentViewer: React.FC<{
  visible: boolean;
  onClose: () => void;
  storagePath: string | null;
  title?: string;
  /** Host review actions. Omit both to render a read-only viewer. */
  onApprove?: () => void;
  onReject?: () => void;
  busy?: boolean;
}> = ({ visible, onClose, storagePath, title = 'Passport', onApprove, onReject, busy }) => {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const resetZoom = useCallback(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
  }, [scale, savedScale, tx, ty, savedTx, savedTy]);

  // Mint a fresh URL every time the viewer opens. Never reuse one.
  useEffect(() => {
    if (!visible || !storagePath) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    resetZoom();
    (async () => {
      try {
        const signed = await getViewUrl(storagePath);
        if (!cancelled) setUrl(signed);
      } catch (e) {
        // Do not log the path or the error object — either can carry the key.
        console.error('[DocumentViewer] could not mint a view URL');
        if (!cancelled) setError(friendlyErrorMessage(e, 'Could not open this document.'));
      }
    })();
    return () => {
      cancelled = true;
      // Drop the token as soon as the viewer goes away.
      setUrl(null);
    };
  }, [visible, storagePath, resetZoom]);

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), 6);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.01) {
        // Snapping home needs to feel like a release, so it is fast and eased out.
        scale.value = withTiming(1, { duration: 160 });
        tx.value = withTiming(0, { duration: 160 });
        ty.value = withTiming(0, { duration: 160 });
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate(e => {
      // Only pans once zoomed in; otherwise it fights the close gesture.
      if (savedScale.value <= 1) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomed = savedScale.value > 1.01;
      const to = zoomed ? 1 : 2.5;
      scale.value = withTiming(to, { duration: 180 });
      savedScale.value = to;
      if (zoomed) {
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      // Android: without this the system nav bar stays opaque over the sheet.
      {...(Platform.OS === 'android' ? { navigationBarTranslucent: true } : {})}
    >
      {/* Android needs its own root for gestures inside a Modal, or pinch is
          silently dead. */}
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.headerTitle}>{title}</Text>
          {/* Deliberately empty: no share, no save, no "open in". */}
          <View style={styles.closeBtn} />
        </View>

        <View style={styles.body}>
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : !url ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <GestureDetector gesture={composed}>
              <Animated.View style={[styles.imageWrap, imageStyle]}>
                <Image
                  source={{ uri: url }}
                  style={styles.image}
                  contentFit="contain"
                  cachePolicy="none"
                  transition={140}
                />
              </Animated.View>
            </GestureDetector>
          )}
        </View>

        {onApprove || onReject ? (
          <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
            {onReject ? (
              <Pressable
                onPress={onReject}
                disabled={busy}
                style={[styles.rejectBtn, busy && styles.btnDisabled]}
              >
                <Text style={styles.rejectText}>Ask for a new photo</Text>
              </Pressable>
            ) : null}
            {onApprove ? (
              <Pressable
                onPress={onApprove}
                disabled={busy}
                style={[styles.approveBtn, busy && styles.btnDisabled]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.approveText}>Approve</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B0B' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: ff('Inter', '600'),
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  imageWrap: { width: '100%', height: '100%' },
  image: { width: '100%', height: '100%' },
  error: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  rejectBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#5A5A5A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  approveBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#05BCD3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  btnDisabled: { opacity: 0.6 },
});
