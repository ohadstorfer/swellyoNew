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

// --------------------------------------------------------------------------
// RangeSlider — dual-thumb range slider with floating value labels.
//
// Native (iOS / Android): react-native-gesture-handler v2 PanGesture +
//   Reanimated v3 shared values for UI-thread thumb movement. Fixes
//   friction-audit bug #5 (Android scroll-steal): the gesture is configured
//   with activeOffsetX(2) / failOffsetY(8) so the parent ScrollView wins
//   vertical scrolls.
//
// Web: GestureDetector's mouse handling is unreliable in older RNGH
//   builds; we fall back to PanResponder so mouse drag works. Floating
//   labels and brand fill all still work because they're driven from
//   React state on this path.
//
// Spec: docs/create-trip-redesign-spec.md §7.10 + §4.2.3.
// --------------------------------------------------------------------------

export interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  lower: number;
  upper: number;
  onChange: (next: { lower: number; upper: number }) => void;
}

const FONT_INTER =
  Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  brandTeal: '#0788B0',
  inkDark: '#212121',
  textMuted: '#7B7B7B',
  track: '#E0E0E0',
};

const THUMB = 28;
const TRACK_H = 6;
const LABEL_GAP = 10; // gap between label bottom and thumb top
const LABEL_H = 24;
const CONTAINER_H = THUMB + LABEL_H + LABEL_GAP + 8;
const TRACK_TOP = LABEL_H + LABEL_GAP + (THUMB - TRACK_H) / 2;
const THUMB_TOP = LABEL_H + LABEL_GAP;
const MERGE_THRESHOLD = 2; // when |upper - lower| <= 2 → single centered label

// --------------------------------------------------------------------------
// Dynamic native module load. Mirrors TravelExperienceSlider.tsx so
// type-check works even if RNGH/Reanimated native modules are missing on
// the current platform.
// --------------------------------------------------------------------------
let Gesture: any = null;
let GestureDetectorComp: any = null;
let ReanimatedAnimated: any = null;
let useSharedValue: any = null;
let useAnimatedStyle: any = null;
let runOnJS: any = null;
let useDerivedValue: any = null;
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

// --------------------------------------------------------------------------
// Helpers shared across both native / web paths.
// --------------------------------------------------------------------------
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
}) => {
  const [trackWidth, setTrackWidth] = useState(0);

  // Shared values for thumb positions in px (relative to track start).
  const lowerSV = useSharedValue(0);
  const upperSV = useSharedValue(0);
  // Per-gesture baseline captured on onBegin so translationX (which is the
  // *cumulative* offset since gesture start) maps correctly. Without this
  // the thumb would runaway because we'd be re-applying full translation
  // on every frame.
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

  // Sync SV with props (controlled component). Skip while user is dragging
  // that thumb to avoid fighting their finger.
  useEffect(() => {
    if (!draggingLower.value) {
      lowerSV.value = valueToPx(lower);
    }
    if (!draggingUpper.value) {
      upperSV.value = valueToPx(upper);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lower, upper, trackWidth, min, max]);

  // Last reported {lower, upper} so we don't spam onChange.
  const lastReportedRef = useRef({ lower, upper });
  lastReportedRef.current = { lower, upper };

  const emit = (nextLower: number, nextUpper: number) => {
    const last = lastReportedRef.current;
    if (nextLower !== last.lower || nextUpper !== last.upper) {
      lastReportedRef.current = { lower: nextLower, upper: nextUpper };
      onChange({ lower: nextLower, upper: nextUpper });
    }
  };

  // ---- Gestures ----
  // Use a horizontal-prioritized pan: parent scroll wins vertical motion,
  // slider wins horizontal motion. Closes friction-audit bug #5.
  //
  // The pixel <-> value transforms run on the UI thread inside gesture
  // worklets, so they're declared inline as worklet helpers (Reanimated
  // can't capture a non-worklet function reference).
  const snapPxWorklet = (px: number) => {
    'worklet';
    if (usable <= 0) return px;
    const range = max - min;
    const ratio = px / usable;
    const raw = min + ratio * range;
    const stepped = Math.round((raw - min) / step) * step + min;
    const cl = Math.min(Math.max(stepped, min), max);
    return ((cl - min) / range) * usable;
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
        // Capture starting px so translationX (cumulative from start)
        // maps correctly on every onUpdate frame.
        lowerStartSV.value = lowerSV.value;
      })
      .onUpdate((e: { translationX: number }) => {
        'worklet';
        const candidate = Math.min(
          Math.max(lowerStartSV.value + e.translationX, 0),
          upperSV.value,
        );
        lowerSV.value = snapPxWorklet(candidate);
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
        const candidate = Math.min(
          Math.max(upperStartSV.value + e.translationX, lowerSV.value),
          usable,
        );
        upperSV.value = snapPxWorklet(candidate);
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

  // Animated styles.
  const lowerThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lowerSV.value }],
  }));
  const upperThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: upperSV.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    left: lowerSV.value + THUMB / 2,
    width: Math.max(0, upperSV.value - lowerSV.value),
  }));

  // Floating value labels: show only while dragging that thumb.
  // useDerivedValue gives us cheap re-reads in animated styles.
  const lowerLabelStyle = useAnimatedStyle(() => {
    const visible = draggingLower.value === 1 || draggingUpper.value === 1;
    // Merge into one centered label when thumbs are within MERGE_THRESHOLD.
    const span = upperSV.value - lowerSV.value;
    const merged =
      usable > 0
        ? (span / usable) * (max - min) <= MERGE_THRESHOLD
        : false;
    return {
      opacity: visible && !merged ? 1 : 0,
      transform: [{ translateX: lowerSV.value - 16 + THUMB / 2 }],
    };
  });
  const upperLabelStyle = useAnimatedStyle(() => {
    const visible = draggingLower.value === 1 || draggingUpper.value === 1;
    const span = upperSV.value - lowerSV.value;
    const merged =
      usable > 0
        ? (span / usable) * (max - min) <= MERGE_THRESHOLD
        : false;
    return {
      opacity: visible && !merged ? 1 : 0,
      transform: [{ translateX: upperSV.value - 16 + THUMB / 2 }],
    };
  });
  const mergedLabelStyle = useAnimatedStyle(() => {
    const visible = draggingLower.value === 1 || draggingUpper.value === 1;
    const span = upperSV.value - lowerSV.value;
    const merged =
      usable > 0
        ? (span / usable) * (max - min) <= MERGE_THRESHOLD
        : false;
    return {
      opacity: visible && merged ? 1 : 0,
      transform: [
        { translateX: (lowerSV.value + upperSV.value) / 2 - 22 + THUMB / 2 },
      ],
    };
  });

  // Animated text values — useAnimatedProps requires Animated.Text which
  // is awkward; we cheat by deriving ints into React state at low cost
  // via useDerivedValue + runOnJS while dragging. We compare against the
  // last value via shared values to avoid stale-closure bugs.
  const [labelLower, setLabelLower] = useState(lower);
  const [labelUpper, setLabelUpper] = useState(upper);
  const lastLabelLowerSV = useSharedValue(lower);
  const lastLabelUpperSV = useSharedValue(upper);
  useDerivedValue(() => {
    const v = pxToValueWorklet(lowerSV.value);
    if (v !== lastLabelLowerSV.value) {
      lastLabelLowerSV.value = v;
      runOnJS(setLabelLower)(v);
    }
  });
  useDerivedValue(() => {
    const v = pxToValueWorklet(upperSV.value);
    if (v !== lastLabelUpperSV.value) {
      lastLabelUpperSV.value = v;
      runOnJS(setLabelUpper)(v);
    }
  });

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== trackWidth) setTrackWidth(w);
  };

  if (!hasNativeGestures) {
    // Defensive fallback: if native modules unexpectedly didn't load on
    // a non-web platform, render the web (PanResponder) variant.
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
      <View style={styles.track} pointerEvents="none">
        <A.View style={[styles.fill, fillStyle]} />
      </View>

      {/* Floating labels */}
      <A.View
        style={[styles.label, lowerLabelStyle]}
        pointerEvents="none"
      >
        <Text style={styles.labelText}>{labelLower}</Text>
      </A.View>
      <A.View
        style={[styles.label, upperLabelStyle]}
        pointerEvents="none"
      >
        <Text style={styles.labelText}>{labelUpper}</Text>
      </A.View>
      <A.View
        style={[styles.labelMerged, mergedLabelStyle]}
        pointerEvents="none"
      >
        <Text style={styles.labelText}>
          {labelLower}–{labelUpper}
        </Text>
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
        <Text style={styles.endpointText}>{min} ft</Text>
        <Text style={styles.endpointText}>{max} ft</Text>
      </View>
    </View>
  );
};

// --------------------------------------------------------------------------
// Web implementation — PanResponder so mouse drag works without RNGH web
// quirks. No worklets; React state drives the thumb. Acceptable on web
// because there's no Android-scroll-steal concern.
// --------------------------------------------------------------------------
const WebRangeSlider: React.FC<RangeSliderProps> = ({
  min,
  max,
  step = 1,
  lower,
  upper,
  onChange,
}) => {
  const containerRef = useRef<View>(null);
  const layoutRef = useRef({ width: 0, pageX: 0 });
  const valuesRef = useRef({ lower, upper });
  valuesRef.current = { lower, upper };
  const activeRef = useRef<'lower' | 'upper' | null>(null);
  const [active, setActive] = useState<'lower' | 'upper' | null>(null);

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
            setActive(which);
            apply(e.nativeEvent.pageX);
          });
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          apply(e.nativeEvent.pageX);
        },
        onPanResponderRelease: () => {
          activeRef.current = null;
          setActive(null);
        },
        onPanResponderTerminate: () => {
          activeRef.current = null;
          setActive(null);
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
  const span = upper - lower;
  const merged = span <= MERGE_THRESHOLD;
  const showLabels = active !== null;

  return (
    <View
      ref={containerRef}
      style={styles.container}
      onLayout={onLayout}
      {...responder.panHandlers}
    >
      <View style={styles.track} pointerEvents="none">
        <View
          style={[
            styles.fill,
            { left: lowerPx + THUMB / 2, width: Math.max(0, upperPx - lowerPx) },
          ]}
        />
      </View>
      {showLabels && !merged ? (
        <>
          <View
            style={[
              styles.label,
              { left: lowerPx - 16 + THUMB / 2 },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.labelText}>{lower}</Text>
          </View>
          <View
            style={[
              styles.label,
              { left: upperPx - 16 + THUMB / 2 },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.labelText}>{upper}</Text>
          </View>
        </>
      ) : null}
      {showLabels && merged ? (
        <View
          style={[
            styles.labelMerged,
            { left: (lowerPx + upperPx) / 2 - 22 + THUMB / 2 },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.labelText}>
            {lower}–{upper}
          </Text>
        </View>
      ) : null}
      <View
        style={[styles.thumb, { transform: [{ translateX: lowerPx }] }]}
        pointerEvents="none"
      />
      <View
        style={[styles.thumb, { transform: [{ translateX: upperPx }] }]}
        pointerEvents="none"
      />
      <View style={styles.endpointRow} pointerEvents="none">
        <Text style={styles.endpointText}>{min} ft</Text>
        <Text style={styles.endpointText}>{max} ft</Text>
      </View>
    </View>
  );
};

// --------------------------------------------------------------------------
// Public export — picks the right implementation for the platform.
// --------------------------------------------------------------------------
export const RangeSlider: React.FC<RangeSliderProps> = (props) => {
  if (Platform.OS === 'web' || !hasNativeGestures) {
    return <WebRangeSlider {...props} />;
  }
  return <NativeRangeSlider {...props} />;
};

export default RangeSlider;

// --------------------------------------------------------------------------
// Styles — shared between native + web variants. The thumb / track / label
// geometry is identical so they look the same on every platform.
// --------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    height: CONTAINER_H,
    position: 'relative',
    justifyContent: 'flex-start',
    paddingBottom: 18, // room for endpoint labels under the track
  },
  track: {
    position: 'absolute',
    top: TRACK_TOP,
    left: THUMB / 2,
    right: THUMB / 2,
    height: TRACK_H,
    backgroundColor: C.track,
    borderRadius: TRACK_H / 2,
  },
  fill: {
    position: 'absolute',
    top: TRACK_TOP,
    height: TRACK_H,
    backgroundColor: C.brandTeal,
    borderRadius: TRACK_H / 2,
  },
  thumb: {
    position: 'absolute',
    top: THUMB_TOP,
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: C.brandTeal,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  label: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 32,
    height: LABEL_H,
    borderRadius: 8,
    backgroundColor: C.inkDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  labelMerged: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 44,
    height: LABEL_H,
    borderRadius: 8,
    backgroundColor: C.inkDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  labelText: {
    color: '#FFFFFF',
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
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
