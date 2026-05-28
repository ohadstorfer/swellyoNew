// WaveShapeSlider — continuous slider with 3 threshold zones
// (Mellow / Wally / Barrel). Behaviour mirrors TravelExperienceSlider:
//   - Thumb can stop at ANY point on the bar — it does not snap to a
//     fixed position on release.
//   - The active shape is derived from the thumb's position via thresholds
//     (0–⅓ → soft, ⅓–⅔ → wally, ⅔–1 → barrel). onChange fires only when
//     the threshold zone changes, so the parent's illustration / title
//     swap at specific points along the bar.
//   - Visuals match TravelExperienceSlider: gray track + teal gradient
//     fill + solid white thumb with a soft drop shadow.

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { WaveShapeKind } from '../../services/trips/groupTripsService';

const THUMB = 36;
const TRACK_H = 6;

const SHAPES: WaveShapeKind[] = ['soft', 'wally', 'barrel'];

let Gesture: any = null;
let GestureDetectorComp: any = null;
let ReanimatedAnimated: any = null;
let useSharedValue: any = null;
let useAnimatedStyle: any = null;
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
    runOnJS = reanimated.runOnJS;
    hasNativeGestures = !!(
      Gesture && GestureDetectorComp && ReanimatedAnimated && useSharedValue
    );
  } catch (_e) {
    hasNativeGestures = false;
  }
}

export interface WaveShapeSliderProps {
  value: WaveShapeKind | null;
  onChange: (next: WaveShapeKind) => void;
}

// Default thumb position when the slider mounts with a given shape — sits
// in the MIDDLE of that shape's zone so the user has equal room to drag
// either way before crossing into the next zone.
const centerPxForIndex = (idx: number, usable: number) => {
  'worklet';
  const ratio = idx === 0 ? 1 / 6 : idx === 1 ? 0.5 : 5 / 6;
  return ratio * usable;
};

const pxToShapeIndex = (px: number, usable: number) => {
  'worklet';
  if (usable <= 0) return 0;
  const ratio = px / usable;
  if (ratio < 1 / 3) return 0;
  if (ratio < 2 / 3) return 1;
  return 2;
};

// ---------------------------------------------------------------------------
// Native variant — RNGH Pan + Reanimated worklets (UI-thread thumb drag).
// ---------------------------------------------------------------------------
const NativeWaveShapeSlider: React.FC<WaveShapeSliderProps> = ({
  value,
  onChange,
}) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const usable = Math.max(0, trackWidth);

  const thumbSV = useSharedValue(0);
  const lastEmittedIdxSV = useSharedValue(value ? SHAPES.indexOf(value) : 0);

  // Sync to controlled value ONLY when it changes externally (not from our
  // own emit). If `value` matches what we last emitted, the user is dragging
  // — leave the thumb where they put it.
  useEffect(() => {
    const idx = value ? SHAPES.indexOf(value) : 0;
    if (idx !== lastEmittedIdxSV.value) {
      lastEmittedIdxSV.value = idx;
      thumbSV.value = centerPxForIndex(Math.max(0, idx), usable);
    } else if (thumbSV.value === 0 && usable > 0) {
      // First layout pass — place thumb at the center of the current zone.
      thumbSV.value = centerPxForIndex(Math.max(0, idx), usable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, usable]);

  const emitIfChanged = (idx: number) => {
    const next = SHAPES[Math.max(0, Math.min(2, idx))];
    if (next !== value) onChange(next);
  };

  const gesture = useMemo(() => {
    if (!hasNativeGestures) return null;
    // Pointer-relative dragging (e.x) — tap-anywhere AND drag-anywhere
    // both work. Mirrors TravelExperienceSlider's gesture exactly. No snap
    // on release — the thumb stays where the finger leaves it. The active
    // shape category is derived from thumb position via thresholds, and
    // onChange fires the moment the zone changes (during drag).
    return Gesture.Pan()
      .minDistance(0)
      .onBegin((e: { x: number }) => {
        'worklet';
        thumbSV.value = Math.min(Math.max(e.x, 0), usable);
        const idx = pxToShapeIndex(thumbSV.value, usable);
        if (idx !== lastEmittedIdxSV.value) {
          lastEmittedIdxSV.value = idx;
          runOnJS(emitIfChanged)(idx);
        }
      })
      .onUpdate((e: { x: number }) => {
        'worklet';
        thumbSV.value = Math.min(Math.max(e.x, 0), usable);
        const idx = pxToShapeIndex(thumbSV.value, usable);
        if (idx !== lastEmittedIdxSV.value) {
          lastEmittedIdxSV.value = idx;
          runOnJS(emitIfChanged)(idx);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, value]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbSV.value - THUMB / 2 }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: thumbSV.value,
  }));

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== trackWidth) setTrackWidth(w);
  };

  if (!hasNativeGestures) {
    return <WebWaveShapeSlider value={value} onChange={onChange} />;
  }

  const A = ReanimatedAnimated;

  return (
    <GestureDetectorComp gesture={gesture}>
      <View style={styles.sliderWrapper} onLayout={onTrackLayout}>
        <View style={styles.trackBackground} pointerEvents="none" />
        <View style={styles.trackFillContainer} pointerEvents="none">
          <A.View style={[styles.trackFill, fillStyle]}>
            <LinearGradient
              colors={['#00A2B6', '#0788B0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </A.View>
        </View>
        <A.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
      </View>
    </GestureDetectorComp>
  );
};

// ---------------------------------------------------------------------------
// Web variant — PanResponder, React state drives the thumb.
// ---------------------------------------------------------------------------
const WebWaveShapeSlider: React.FC<WaveShapeSliderProps> = ({
  value,
  onChange,
}) => {
  const containerRef = useRef<View>(null);
  const layoutRef = useRef({ width: 0, pageX: 0 });
  const usable = () => Math.max(0, layoutRef.current.width);

  const initialIdx = value ? SHAPES.indexOf(value) : 0;
  const [thumbPx, setThumbPx] = useState<number>(() =>
    centerPxForIndex(Math.max(0, initialIdx), 0),
  );
  const lastEmittedIdxRef = useRef<number>(initialIdx);

  // Sync to controlled value only when it changes externally.
  useEffect(() => {
    const idx = value ? SHAPES.indexOf(value) : 0;
    if (idx !== lastEmittedIdxRef.current) {
      lastEmittedIdxRef.current = idx;
      setThumbPx(centerPxForIndex(Math.max(0, idx), usable()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, layoutRef.current.width]);

  const measure = (then: () => void) => {
    containerRef.current?.measure((_x, _y, width, _h, pageX) => {
      layoutRef.current = { width, pageX };
      then();
    });
  };

  const apply = (pageX: number) => {
    const trackX = pageX - layoutRef.current.pageX;
    const next = Math.min(Math.max(trackX, 0), usable());
    setThumbPx(next);
    const idx = pxToShapeIndex(next, usable());
    if (idx !== lastEmittedIdxRef.current) {
      lastEmittedIdxRef.current = idx;
      const shape = SHAPES[idx];
      if (shape !== value) onChange(shape);
    }
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          measure(() => apply(e.nativeEvent.pageX));
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          apply(e.nativeEvent.pageX);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value],
  );

  const onLayout = () => {
    containerRef.current?.measure((_x, _y, width, _h, pageX) => {
      layoutRef.current = { width, pageX };
      // Place thumb at the current zone's center on first layout.
      if (thumbPx === 0) {
        const idx = value ? SHAPES.indexOf(value) : 0;
        setThumbPx(centerPxForIndex(Math.max(0, idx), Math.max(0, width)));
      }
    });
  };

  const fillWidth = thumbPx;

  return (
    <View
      ref={containerRef}
      style={styles.sliderWrapper}
      onLayout={onLayout}
      {...responder.panHandlers}
    >
      <View style={styles.trackBackground} pointerEvents="none" />
      <View style={styles.trackFillContainer} pointerEvents="none">
        <View style={[styles.trackFill, { width: fillWidth }]}>
          <LinearGradient
            colors={['#00A2B6', '#0788B0']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </View>
      <View
        style={[
          styles.thumb,
          { transform: [{ translateX: thumbPx - THUMB / 2 }] },
        ]}
        pointerEvents="none"
      />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Public export — pick implementation per platform.
// ---------------------------------------------------------------------------
export const WaveShapeSlider: React.FC<WaveShapeSliderProps> = (props) => {
  if (Platform.OS === 'web' || !hasNativeGestures) {
    return <WebWaveShapeSlider {...props} />;
  }
  return <NativeWaveShapeSlider {...props} />;
};

export default WaveShapeSlider;

const styles = StyleSheet.create({
  sliderWrapper: {
    width: '100%',
    height: THUMB,
    position: 'relative',
    justifyContent: 'center',
  },
  trackBackground: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_H,
    backgroundColor: '#E1E1E1',
    borderRadius: 8,
    top: (THUMB - TRACK_H) / 2,
  },
  trackFillContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_H,
    top: (THUMB - TRACK_H) / 2,
    overflow: 'hidden',
    borderRadius: 8,
  },
  trackFill: {
    height: TRACK_H,
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    top: 0,
    left: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 12,
  },
});
