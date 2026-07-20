/**
 * WhatsApp-style in-app banner. Mounted ONCE at AppContent root, above the
 * navigator and activeOverlay. Fed exclusively by inAppBannerBus — the app
 * tree never re-renders for a banner, only this host does.
 *
 * Motion (emil-design-eng): transform/opacity only. Enter is an iOS-style
 * spring (interruptible, retargets on replace, barely-visible settle) with a
 * faster opacity fade so the motion reads as a slide, not a fade. Exit is
 * deliberately snappier than the enter (180ms strong ease-out). Swipe-up
 * dismiss is velocity-based and keeps the drag offset so the exit continues
 * from the finger's position; a released (non-dismissing) drag springs back
 * with a soft bounce. Reduced-motion → fade only.
 *
 * Known v1 limitation: RN Modal sheets render in their own window and cover
 * this banner. Accepted (spec).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { subscribeInAppBanner, InAppBannerPayload } from '../../services/notifications/inAppBannerBus';
import { ff, fs } from '../../theme/fonts';
import { Images } from '../../assets/images';

const ENTER_FADE_MS = 200; // opacity resolves early so the spring reads as a slide
const EXIT_MS = 260; // still shorter than the ~520ms enter spring, but unhurried
const AUTO_DISMISS_MS = 5000;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const HIDDEN_Y = -220; // safely above the (taller, WhatsApp-sized) banner + any notch inset
// iOS-banner feel: settles ~500ms with a barely-visible overshoot. Springs
// (unlike timings) keep their velocity when a replacement retargets mid-flight.
const ENTER_SPRING = { duration: 520, dampingRatio: 0.82 } as const;
// Released-but-not-dismissed drag: soft bounce back under the finger's intent.
const SNAP_BACK_SPRING = { duration: 420, dampingRatio: 0.7 } as const;

export const InAppBannerHost: React.FC = () => {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [payload, setPayload] = useState<InAppBannerPayload | null>(null);
  const translateY = useSharedValue(HIDDEN_Y);
  const opacity = useSharedValue(0);
  const dragY = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const payloadRef = useRef<InAppBannerPayload | null>(null);
  payloadRef.current = payload;
  const mountedRef = useRef(true);

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  const handleFadeOutComplete = useCallback(() => {
    if (mountedRef.current) setPayload(null);
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    if (!reducedMotion) {
      // withTiming retargets smoothly if we're mid-enter (interruptible).
      translateY.value = withTiming(HIDDEN_Y, { duration: EXIT_MS, easing: EASE_OUT });
    }
    // Reduced motion: fade only — translateY stays put and is reset on next show.
    opacity.value = withTiming(0, { duration: EXIT_MS }, (finished) => {
      if (finished) runOnJS(handleFadeOutComplete)();
    });
  }, [opacity, translateY, reducedMotion, handleFadeOutComplete]);

  const armTimer = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(hide, AUTO_DISMISS_MS);
  }, [hide]);

  useEffect(() => {
    const unsub = subscribeInAppBanner((p) => {
      setPayload(p);
      // Replace-mid-drag: ease the drag offset home instead of snapping.
      dragY.value = dragY.value === 0 ? 0 : withSpring(0, SNAP_BACK_SPRING);
      if (reducedMotion) {
        translateY.value = 0;
        opacity.value = 0;
        opacity.value = withTiming(1, { duration: ENTER_FADE_MS });
      } else {
        // Replace policy: the spring retargets from wherever we are, keeping
        // its velocity — no restart-from-zero, no dead frame.
        translateY.value = withSpring(0, ENTER_SPRING);
        opacity.value = withTiming(1, { duration: ENTER_FADE_MS, easing: EASE_OUT });
      }
      armTimer();
    });
    return () => { unsub(); clearTimer(); mountedRef.current = false; };
  }, [armTimer, dragY, opacity, reducedMotion, translateY]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Upward free, downward damped (friction, not a wall).
      dragY.value = e.translationY < 0 ? e.translationY : e.translationY / 8;
    })
    .onEnd((e) => {
      const flungUp = e.velocityY < -500 || e.translationY < -40;
      if (flungUp) {
        // dragY keeps the finger's offset, so hide()'s translate continues
        // from where the flick left the banner — momentum, not a restart.
        runOnJS(hide)();
      } else {
        dragY.value = withSpring(0, SNAP_BACK_SPRING);
        runOnJS(armTimer)();
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value + dragY.value }],
    opacity: opacity.value,
  }));

  if (Platform.OS === 'web' || !payload) return null;

  const onPress = () => {
    const p = payloadRef.current;
    hide();
    p?.onPress?.();
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingTop: insets.top + 6 }]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.banner, animatedStyle]}>
          {/* WhatsApp-style material: real blur on iOS; Android's BlurView is
              unreliable, so the solid translucent bannerAndroid bg covers it. */}
          {Platform.OS === 'ios' && (
            <BlurView intensity={60} tint="systemChromeMaterialDark" style={StyleSheet.absoluteFill} />
          )}
          <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            {payload.avatarUrl ? (
              <ExpoImage source={{ uri: payload.avatarUrl }} style={styles.avatar} />
            ) : (
              <ExpoImage source={Images.defaultAvatar} style={styles.avatar} />
            )}
            <View style={styles.texts}>
              <Text style={styles.title} numberOfLines={1}>{payload.title}</Text>
              <Text style={styles.body} numberOfLines={2}>{payload.body}</Text>
            </View>
          </Pressable>
          <View style={styles.grabber} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  banner: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 26,
    // iOS: light dark wash OVER the BlurView (real material, like WhatsApp).
    // Android: BlurView is unreliable, so this is the whole background there.
    // Lifted to a lighter slate (was ~rgb(32-38)) so the banner reads as
    // floating ABOVE the near-black #212121 header instead of camouflaging into it.
    backgroundColor: Platform.OS === 'ios' ? 'rgba(72,74,82,0.55)' : 'rgba(72,74,82,0.97)',
    overflow: 'hidden', // clips the BlurView to the rounded corners
    paddingTop: 14,
    paddingBottom: 9,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  pressed: { opacity: 0.85 },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  texts: { flex: 1, marginLeft: 12 },
  title: { color: '#FFFFFF', fontSize: fs(16), fontFamily: ff('Inter', '600'), includeFontPadding: false },
  body: { color: 'rgba(255,255,255,0.8)', fontSize: fs(15), fontFamily: ff('Inter', '400'), includeFontPadding: false, marginTop: 2 },
  grabber: {
    alignSelf: 'center',
    width: 56,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginTop: 10,
  },
});
