import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  LayoutChangeEvent,
  PanResponder,
  GestureResponderEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// --------------------------------------------------------------------------
// RangeSlider — dual-thumb range slider, smooth drag, live onChange.
//
// Native (iOS / Android): RNGH v2 Pan gesture + Reanimated v3 shared values.
//   Drag is smooth (no snap mid-drag). onChange fires live whenever the
//   integer value changes so the parent can render a "X – Y ft" pill above
//   the slider that updates live.
//
// Web: PanResponder so mouse drag works without RNGH web quirks.
// --------------------------------------------------------------------------

export interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  lower: number;
  upper: number;
  onChange: (next: { lower: number; upper: number }) => void;
  /** Custom text for the left endpoint label. Defaults to `${min} ft`. */
  minLabel?: string;
  /** Custom text for the right endpoint label. Defaults to `${max} ft`. */
  maxLabel?: string;
}

const FONT_INTER =
  Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  textMuted: '#7B7B7B',
  track: '#E1E1E1', // same as WaveShapeSlider
};

// Geometry matches WaveShapeSlider exactly so the two bars read as a pair.
const THUMB = 36;
const TRACK_H = 6;
const CONTAINER_H = THUMB + 8 + 18; // thumb + small gap + endpoint label row
const TRACK_TOP = (THUMB - TRACK_H) / 2;
const THUMB_TOP = 0;

let Gesture: any = null;
let GestureDetectorComp: any = null;
let ReanimatedAnimated: any = null;
let useSharedValue: any = null;
let useAnimatedStyle: any = null;
let useDerivedValue: any = null;
let runOnJS: any = null;
let hasNativeGestures = false;

if (Platform.OS !== 'web') {
  try {
    const gh = require('react-native-gesture-handler');
    Gesture = gh.Gesture;
    GestureDetectorComp = gh.GestureDetector;
    const reanimated = require('react-native-reanimated');
    ReanimatedAnimated = reanimated.default;
    useSharedValue = reanimated.useSharedValue;
    useAnimatedStyle = reanimated.useAnimatedStyle;
    useDerivedValue = reanimated.useDerivedValue;
    runOnJS = reanimated.runOnJS;
    hasNativeGestures = !!(
      Gesture && GestureDetectorComp && ReanimatedAnimated && useSharedValue
    );
  } catch (_e) {
    hasNativeGestures = false;
  }
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

const snap = (v: number, step: number, min: number) =>
  Math.round((v - min) / step) * step + min;

// --------------------------------------------------------------------------
// Native implementation
// --------------------------------------------------------------------------
const NativeRangeSlider: React.FC<RangeSliderProps> = ({
  min,
  max,
  step = 1,
  lower,
  upper,
  onChange,
  minLabel,
  maxLabel,
}) => {
  const [trackWidth, setTrackWidth] = useState(0);

  const lowerSV = useSharedValue(0);
  const upperSV = useSharedValue(0);
  const lowerStartSV = useSharedValue(0);
  const upperStartSV = useSharedValue(0);
  const draggingLower = useSharedValue(0);
  const draggingUpper = useSharedValue(0);

  const usable = Math.max(0, trackWidth - THUMB);

  const valueToPx = (v: number) => {
    const range = max - min;
    if (range <= 0 || usable <= 0) return 0;
    return ((v - min) / range) * usable;
  };

  useEffect(() => {
    if (!draggingLower.value) lowerSV.value = valueToPx(lower);
    if (!draggingUpper.value) upperSV.value = valueToPx(upper);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lower, upper, trackWidth, min, max]);

  const lastReportedRef = useRef({ lower, upper });
  lastReportedRef.current = { lower, upper };

  const emit = (nextLower: number, nextUpper: number) => {
    const last = lastReportedRef.current;
    if (nextLower !== last.lower || nextUpper !== last.upper) {
      lastReportedRef.current = { lower: nextLower, upper: nextUpper };
      onChange({ lower: nextLower, upper: nextUpper });
    }
  };

  const pxToValueWorklet = (px: number) => {
    'worklet';
    if (usable <= 0) return min;
    const range = max - min;
    const ratio = Math.min(Math.max(px / usable, 0), 1);
    const raw = min + ratio * range;
    const stepped = Math.round((raw - min) / step) * step + min;
    return Math.min(Math.max(stepped, min), max);
  };

  const lowerGesture = useMemo(() => {
    if (!hasNativeGestures) return null;
    return Gesture.Pan()
      .activeOffsetX([-2, 2])
      .failOffsetY([-8, 8])
      .onBegin(() => {
        'worklet';
        draggingLower.value = 1;
        lowerStartSV.value = lowerSV.value;
      })
      .onUpdate((e: { translationX: number }) => {
        'worklet';
        // Smooth movement — no snap during drag. Clamp only.
        lowerSV.value = Math.min(
          Math.max(lowerStartSV.value + e.translationX, 0),
          upperSV.value,
        );
      })
      .onEnd(() => {
        'worklet';
        draggingLower.value = 0;
        const nextLower = pxToValueWorklet(lowerSV.value);
        const nextUpper = pxToValueWorklet(upperSV.value);
        const range = max - min;
        if (range > 0 && usable > 0) {
          lowerSV.value = ((nextLower - min) / range) * usable;
        }
        runOnJS(emit)(nextLower, nextUpper);
      })
      .onFinalize(() => {
        'worklet';
        draggingLower.value = 0;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, min, max, step]);

  const upperGesture = useMemo(() => {
    if (!hasNativeGestures) return null;
    return Gesture.Pan()
      .activeOffsetX([-2, 2])
      .failOffsetY([-8, 8])
      .onBegin(() => {
        'worklet';
        draggingUpper.value = 1;
        upperStartSV.value = upperSV.value;
      })
      .onUpdate((e: { translationX: number }) => {
        'worklet';
        upperSV.value = Math.min(
          Math.max(upperStartSV.value + e.translationX, lowerSV.value),
          usable,
        );
      })
      .onEnd(() => {
        'worklet';
        draggingUpper.value = 0;
        const nextLower = pxToValueWorklet(lowerSV.value);
        const nextUpper = pxToValueWorklet(upperSV.value);
        const range = max - min;
        if (range > 0 && usable > 0) {
          upperSV.value = ((nextUpper - min) / range) * usable;
        }
        runOnJS(emit)(nextLower, nextUpper);
      })
      .onFinalize(() => {
        'worklet';
        draggingUpper.value = 0;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, min, max, step]);

  const lowerThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lowerSV.value }],
  }));
  const upperThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: upperSV.value }],
  }));
  // Fill is a sibling of the track (NOT a child) so its left/top are in
  // container coords — matching where the track itself is positioned.
  const fillStyle = useAnimatedStyle(() => ({
    left: lowerSV.value + THUMB / 2,
    width: Math.max(0, upperSV.value - lowerSV.value),
  }));

  // Live emit during drag — pushes integer values to the parent so the
  // top-of-sheet "X – Y ft" pill updates as you drag. Skipped while the
  // track hasn't been measured yet, otherwise the first paint with
  // usable=0 would emit (min, min) and wipe the parent's default range
  // (e.g. 2–4 ft → 1–1 ft).
  const lastIntLowerSV = useSharedValue(lower);
  const lastIntUpperSV = useSharedValue(upper);
  useDerivedValue(() => {
    if (usable <= 0) return;
    const nextLower = pxToValueWorklet(lowerSV.value);
    const nextUpper = pxToValueWorklet(upperSV.value);
    if (
      nextLower !== lastIntLowerSV.value ||
      nextUpper !== lastIntUpperSV.value
    ) {
      lastIntLowerSV.value = nextLower;
      lastIntUpperSV.value = nextUpper;
      runOnJS(emit)(nextLower, nextUpper);
    }
  });

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== trackWidth) setTrackWidth(w);
  };

  if (!hasNativeGestures) {
    return (
      <WebRangeSlider
        min={min}
        max={max}
        step={step}
        lower={lower}
        upper={upper}
        onChange={onChange}
      />
    );
  }

  const A = ReanimatedAnimated;

  return (
    <View style={styles.container} onLayout={onTrackLayout}>
      {/* Track */}
      <View style={styles.track} pointerEvents="none" />
      {/* Fill — sibling of track so left/top are in container coords.
          Uses the same teal gradient as WaveShapeSlider for visual parity. */}
      <A.View style={[styles.fill, fillStyle]} pointerEvents="none">
        <LinearGradient
          colors={['#00A2B6', '#0788B0']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </A.View>

      {/* Thumbs */}
      <GestureDetectorComp gesture={lowerGesture}>
        <A.View style={[styles.thumb, lowerThumbStyle]} />
      </GestureDetectorComp>
      <GestureDetectorComp gesture={upperGesture}>
        <A.View style={[styles.thumb, upperThumbStyle]} />
      </GestureDetectorComp>

      {/* Static endpoint labels */}
      <View style={styles.endpointRow} pointerEvents="none">
        <Text style={styles.endpointText}>{minLabel ?? `${min} ft`}</Text>
        <Text style={styles.endpointText}>{maxLabel ?? `${max} ft`}</Text>
      </View>
    </View>
  );
};

// --------------------------------------------------------------------------
// Web implementation — PanResponder
// --------------------------------------------------------------------------
const WebRangeSlider: React.FC<RangeSliderProps> = ({
  min,
  max,
  step = 1,
  lower,
  upper,
  onChange,
  minLabel,
  maxLabel,
}) => {
  const containerRef = useRef<View>(null);
  const layoutRef = useRef({ width: 0, pageX: 0 });
  const valuesRef = useRef({ lower, upper });
  valuesRef.current = { lower, upper };
  const activeRef = useRef<'lower' | 'upper' | null>(null);

  const usable = () => Math.max(0, layoutRef.current.width - THUMB);

  const valueToPx = (v: number) => {
    const range = max - min;
    if (range <= 0 || usable() <= 0) return 0;
    return ((v - min) / range) * usable();
  };

  const pxToValue = (px: number) => {
    const u = usable();
    if (u <= 0) return min;
    const range = max - min;
    const ratio = clamp(px / u, 0, 1);
    const raw = min + ratio * range;
    return clamp(snap(raw, step, min), min, max);
  };

  const measure = (then: () => void) => {
    containerRef.current?.measure((_x, _y, width, _h, pageX) => {
      layoutRef.current = { width, pageX };
      then();
    });
  };

  const apply = (pageX: number) => {
    const trackX = pageX - (layoutRef.current.pageX + THUMB / 2);
    const v = pxToValue(trackX);
    const cur = valuesRef.current;
    if (activeRef.current === 'lower') {
      const next = Math.min(v, cur.upper);
      if (next !== cur.lower) onChange({ lower: next, upper: cur.upper });
    } else if (activeRef.current === 'upper') {
      const next = Math.max(v, cur.lower);
      if (next !== cur.upper) onChange({ lower: cur.lower, upper: next });
    }
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          measure(() => {
            const trackX =
              e.nativeEvent.pageX - (layoutRef.current.pageX + THUMB / 2);
            const lp = valueToPx(valuesRef.current.lower);
            const up = valueToPx(valuesRef.current.upper);
            const which: 'lower' | 'upper' =
              Math.abs(trackX - lp) <= Math.abs(trackX - up) ? 'lower' : 'upper';
            activeRef.current = which;
            apply(e.nativeEvent.pageX);
          });
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          apply(e.nativeEvent.pageX);
        },
        onPanResponderRelease: () => {
          activeRef.current = null;
        },
        onPanResponderTerminate: () => {
          activeRef.current = null;
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step],
  );

  const onLayout = () => {
    containerRef.current?.measure((_x, _y, width, _h, pageX) => {
      layoutRef.current = { width, pageX };
    });
  };

  const lowerPx = valueToPx(lower);
  const upperPx = valueToPx(upper);

  return (
    <View
      ref={containerRef}
      style={styles.container}
      onLayout={onLayout}
      {...responder.panHandlers}
    >
      <View style={styles.track} pointerEvents="none" />
      <View
        style={[
          styles.fill,
          { left: lowerPx + THUMB / 2, width: Math.max(0, upperPx - lowerPx) },
        ]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={['#00A2B6', '#0788B0']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View
        style={[styles.thumb, { transform: [{ translateX: lowerPx }] }]}
        pointerEvents="none"
      />
      <View
        style={[styles.thumb, { transform: [{ translateX: upperPx }] }]}
        pointerEvents="none"
      />
      <View style={styles.endpointRow} pointerEvents="none">
        <Text style={styles.endpointText}>{minLabel ?? `${min} ft`}</Text>
        <Text style={styles.endpointText}>{maxLabel ?? `${max} ft`}</Text>
      </View>
    </View>
  );
};

export const RangeSlider: React.FC<RangeSliderProps> = (props) => {
  if (Platform.OS === 'web' || !hasNativeGestures) {
    return <WebRangeSlider {...props} />;
  }
  return <NativeRangeSlider {...props} />;
};

export default RangeSlider;

const styles = StyleSheet.create({
  container: {
    height: CONTAINER_H,
    position: 'relative',
    justifyContent: 'flex-start',
    paddingBottom: 18,
  },
  track: {
    position: 'absolute',
    top: TRACK_TOP,
    left: THUMB / 2,
    right: THUMB / 2,
    height: TRACK_H,
    backgroundColor: C.track,
    borderRadius: 8,
  },
  fill: {
    position: 'absolute',
    top: TRACK_TOP,
    height: TRACK_H,
    borderRadius: 8,
    overflow: 'hidden', // clip the gradient to the rounded bar
  },
  // Identical to WaveShapeSlider's thumb so both bars feel like the same
  // control rendered twice.
  thumb: {
    position: 'absolute',
    top: THUMB_TOP,
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 12,
  },
  endpointRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  endpointText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    color: C.textMuted,
  },
});
