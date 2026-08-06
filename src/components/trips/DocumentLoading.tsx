/**
 * DocumentLoading — what the viewer shows while a document is on its way.
 *
 * Replaces the bare `ActivityIndicator` that used to sit in the middle of a
 * black screen. Three things make this better than a spinner, and each one is
 * a loading-state rule rather than decoration:
 *
 * 1. **It has the shape of the thing that is coming.** A page-sized card at the
 *    document's own aspect ratio, with a photo block and text bars where the
 *    passport's photo and lines will be. The eye settles on the final layout
 *    before the bytes land, so the swap to the real document is a fill, not a
 *    jump. A centered spinner tells you only that something is happening.
 *
 * 2. **It tells the truth when it can.** A PDF is downloaded byte by byte, so
 *    the caller can hand us real `progress` and we draw a determinate ring.
 *    An image is decoded by `expo-image` with no progress to report, so there
 *    is no ring at all — an indeterminate ring is just a spinner wearing a
 *    circle, and a fake progress bar is worse than none.
 *
 * 3. **It does not flash.** Nothing is painted for the first 180ms. Most
 *    documents open faster than that, and a loader that appears and vanishes
 *    inside a fifth of a second reads as a glitch, not as feedback.
 *
 * The sweep is linear and loops forever — constant motion, so easing would
 * only make it pulse. Progress, which is a value moving to a new value, is
 * eased out. Both are honoured under reduced motion by falling back to a slow
 * opacity breath, because motion sickness is the thing being avoided, not
 * feedback.
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING_SIZE = 52;
const RING_STROKE = 3;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

/** Long enough that a fast open never paints, short enough to stay honest. */
const APPEAR_DELAY = 180;

export const DocumentLoading: React.FC<{
  /**
   * Shape of the page that is coming. A PDF is A4-ish and portrait; a photo of
   * a passport is landscape. Getting this roughly right is the whole point —
   * the placeholder has to occupy the space the document will occupy.
   */
  aspectRatio?: number;
  /**
   * 0..1 when the caller can measure it, `null` when it cannot. `null` draws no
   * ring: see rule 2 above.
   */
  progress?: number | null;
  /**
   * The document has arrived — fade out instead of vanishing.
   *
   * The caller keeps this mounted for the length of the fade. Without it the
   * placeholder disappears in the same frame `expo-image` STARTS its 140ms
   * cross-fade, so the user gets a black pane in between. The two overlap
   * instead: one fades out while the other fades in.
   */
  exiting?: boolean;
}> = ({ aspectRatio = 3 / 2, progress = null, exiting = false }) => {
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);

  const appear = useSharedValue(0);
  const sweep = useSharedValue(0);
  const breath = useSharedValue(0);
  const ring = useSharedValue(0);

  // Held back so a document that opens in 120ms shows nothing at all.
  useEffect(() => {
    appear.value = withDelay(
      APPEAR_DELAY,
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
    );
    return () => cancelAnimation(appear);
  }, [appear]);

  // Assigning a new animation cancels the pending entrance, so a document that
  // arrives inside APPEAR_DELAY fades from 0 to 0 — i.e. never shows at all,
  // which is the whole point of the delay.
  useEffect(() => {
    if (!exiting) return;
    appear.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.cubic) });
  }, [exiting, appear]);

  // The sweep travels past both edges, so the hard reset at the loop boundary
  // happens while the band is off the card and cannot be seen.
  useEffect(() => {
    if (reducedMotion || !width) return;
    sweep.value = 0;
    sweep.value = withRepeat(
      withTiming(1, { duration: 1150, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(sweep);
  }, [reducedMotion, width, sweep]);

  useEffect(() => {
    if (!reducedMotion) return;
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(breath);
  }, [reducedMotion, breath]);

  // Progress arrives in steps (one per download callback). Easing between them
  // keeps the ring from ticking; it never runs backwards because the download
  // never does.
  useEffect(() => {
    if (progress == null) return;
    ring.value = withTiming(Math.min(Math.max(progress, 0), 1), {
      duration: 240,
      easing: Easing.out(Easing.quad),
    });
    return () => cancelAnimation(ring);
  }, [progress, ring]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: appear.value }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion ? 0.55 + breath.value * 0.35 : 1,
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -width * 1.2 + sweep.value * width * 2.4 }],
  }));

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_C * (1 - ring.value),
  }));

  return (
    <Animated.View
      style={[styles.root, rootStyle]}
      accessibilityRole="progressbar"
      accessibilityLabel="Opening the document"
    >
      <Animated.View
        style={[styles.card, { aspectRatio }, cardStyle]}
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
      >
        {/* The bones of a document: a photo, a few fields, two code lines. */}
        <View style={styles.topRow}>
          <View style={styles.photo} />
          <View style={styles.fields}>
            <View style={[styles.bar, { width: '55%' }]} />
            <View style={[styles.bar, { width: '80%' }]} />
            <View style={[styles.bar, { width: '65%' }]} />
          </View>
        </View>
        <View style={styles.lines}>
          <View style={[styles.bar, { width: '92%' }]} />
          <View style={[styles.bar, { width: '78%' }]} />
          <View style={[styles.bar, { width: '86%' }]} />
        </View>
        <View style={styles.mrz}>
          <View style={[styles.bar, { width: '100%' }]} />
          <View style={[styles.bar, { width: '100%' }]} />
        </View>

        {!reducedMotion && width > 0 ? (
          <Animated.View style={[styles.sweepWrap, { width: width * 0.55 }, sweepStyle]}>
            <LinearGradient
              // Transparent at both ends so the band has no edge to catch on.
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}

        {progress != null ? (
          <View style={styles.ringWrap} pointerEvents="none">
            <Svg width={RING_SIZE} height={RING_SIZE}>
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                stroke="rgba(255,255,255,0.16)"
                strokeWidth={RING_STROKE}
                fill="none"
              />
              <AnimatedCircle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                stroke="#05BCD3"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={RING_C}
                animatedProps={ringProps}
                // Start the arc at 12 o'clock, not 3 o'clock.
                transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              />
            </Svg>
          </View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '86%',
    maxWidth: 520,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 18,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  topRow: { flexDirection: 'row', gap: 14 },
  photo: {
    width: '26%',
    aspectRatio: 3 / 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  fields: { flex: 1, gap: 10, paddingTop: 4 },
  lines: { gap: 10 },
  mrz: { gap: 8 },
  bar: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.08)' },
  sweepWrap: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  ringWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
