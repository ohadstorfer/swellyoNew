// Single-handle slider that snaps to one of 3 thirds → soft / wally / barrel.

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { WaveShapeKind } from '../../services/trips/groupTripsService';

const FONT_INTER =
  Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  track: '#E0E0E0',
  borderField: '#CFCFCF',
  borderDivider: '#E0E0E0',
  surface: '#FFFFFF',
};

const TRACK_WIDTH = 280;
const THUMB = 28;
const TRACK_H = 6;
const PLACEHOLDER_H = 132;

const SHAPES: WaveShapeKind[] = ['soft', 'wally', 'barrel'];
const LABELS: Record<WaveShapeKind, string> = {
  soft: 'Mellow',
  wally: 'Wally',
  barrel: 'Barrel',
};
const META: Record<
  WaveShapeKind,
  {
    title: string;
    description: string;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  soft: {
    title: 'Mellow',
    description: 'Gentle, rolling — fat shoulder, no curl',
    icon: 'water-outline',
  },
  wally: {
    title: 'Wally wave',
    description: 'Walled, fast face — punchy without barreling',
    icon: 'pulse-outline',
  },
  barrel: {
    title: 'Barrel wave',
    description: 'Hollow, throwing lip — proper tubes',
    icon: 'ellipse-outline',
  },
};

// ---------------------------------------------------------------------------
// Dynamic native module load. Mirrors RangeSlider.tsx so type-check works
// even if RNGH/Reanimated native modules are missing on the current platform.
// ---------------------------------------------------------------------------
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

// Each "third" maps to a center px along the usable track range.
// Index 0 → soft, 1 → wally, 2 → barrel.
// `'worklet'` directive lets this be called from both UI-thread worklets and JS.
const centerPxForIndex = (index: number, usable: number): number => {
  'worklet';
  if (usable <= 0) return 0;
  // Slice the usable range into 3 equal segments; the center of each segment
  // is the snap target. (1/6, 3/6, 5/6) of usable.
  const ratio = index === 0 ? 1 / 6 : index === 1 ? 3 / 6 : 5 / 6;
  return ratio * usable;
};

const pxToShapeIndex = (px: number, usable: number): number => {
  'worklet';
  if (usable <= 0) return 0;
  const ratio = Math.min(Math.max(px / usable, 0), 1);
  if (ratio < 1 / 3) return 0;
  if (ratio < 2 / 3) return 1;
  return 2;
};

// ---------------------------------------------------------------------------
// Native implementation — Reanimated + RNGH Pan gesture.
// ---------------------------------------------------------------------------
const NativeWaveShapeSlider: React.FC<WaveShapeSliderProps> = ({
  value,
  onChange,
}) => {
  const [trackWidth, setTrackWidth] = useState(TRACK_WIDTH);
  const usable = Math.max(0, trackWidth - THUMB);

  const thumbSV = useSharedValue(0);
  const thumbStartSV = useSharedValue(0);

  // Keep SV in sync with controlled `value` (unless user is mid-drag).
  const draggingSV = useSharedValue(0);
  useEffect(() => {
    if (draggingSV.value) return;
    const idx = value ? SHAPES.indexOf(value) : 0;
    thumbSV.value = centerPxForIndex(Math.max(0, idx), usable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, usable]);

  const commit = (idx: number) => {
    const next = SHAPES[Math.max(0, Math.min(2, idx))];
    if (next !== value) onChange(next);
  };

  const gesture = useMemo(() => {
    if (!hasNativeGestures) return null;
    return Gesture.Pan()
      .activeOffsetX([-2, 2])
      .failOffsetY([-8, 8])
      .onBegin(() => {
        'worklet';
        draggingSV.value = 1;
        thumbStartSV.value = thumbSV.value;
      })
      .onUpdate((e: { translationX: number }) => {
        'worklet';
        const candidate = Math.min(
          Math.max(thumbStartSV.value + e.translationX, 0),
          usable,
        );
        thumbSV.value = candidate;
      })
      .onEnd(() => {
        'worklet';
        draggingSV.value = 0;
        // Snap to the center of the third the thumb sits in.
        const ratio = usable > 0 ? thumbSV.value / usable : 0;
        let idx = 0;
        if (ratio >= 2 / 3) idx = 2;
        else if (ratio >= 1 / 3) idx = 1;
        thumbSV.value = centerPxForIndex(idx, usable);
        runOnJS(commit)(idx);
      })
      .onFinalize(() => {
        'worklet';
        draggingSV.value = 0;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, value]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbSV.value }],
  }));

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== trackWidth) setTrackWidth(w);
  };

  if (!hasNativeGestures) {
    return <WebWaveShapeSlider value={value} onChange={onChange} />;
  }

  const A = ReanimatedAnimated;
  const activeIndex = value ? SHAPES.indexOf(value) : 0;
  const meta = META[SHAPES[activeIndex] ?? 'soft'];

  return (
    <View style={styles.container}>
      {/* Placeholder area (future animation). Subtle teal gradient + icon so
          it reads as an intentional preview surface, not a missing image. */}
      <View style={styles.placeholder}>
        <LinearGradient
          colors={['#F5FBFD', '#E6F4F8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.placeholderIconWrap}>
          <Ionicons
            name={meta.icon}
            size={26}
            color={C.brandTeal}
          />
        </View>
        <Text style={styles.placeholderTitle}>{meta.title}</Text>
        <Text style={styles.placeholderDesc}>{meta.description}</Text>
      </View>

      {/* Slider track */}
      <View style={styles.trackWrap} onLayout={onTrackLayout}>
        <View style={styles.track} pointerEvents="none">
          {/* Tick marks at thirds */}
          <View style={[styles.tick, { left: '33.33%' }]} pointerEvents="none" />
          <View style={[styles.tick, { left: '66.66%' }]} pointerEvents="none" />
        </View>
        <GestureDetectorComp gesture={gesture}>
          <A.View style={[styles.thumb, thumbStyle]} />
        </GestureDetectorComp>
      </View>

      {/* Labels under the track */}
      <View style={styles.labelRow}>
        {SHAPES.map((s, i) => (
          <Text
            key={s}
            style={[
              styles.labelText,
              i === activeIndex && styles.labelTextActive,
            ]}
          >
            {LABELS[s]}
          </Text>
        ))}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Web implementation — PanResponder so mouse drag works without RNGH web quirks.
// ---------------------------------------------------------------------------
const WebWaveShapeSlider: React.FC<WaveShapeSliderProps> = ({
  value,
  onChange,
}) => {
  const containerRef = useRef<View>(null);
  const layoutRef = useRef({ width: TRACK_WIDTH, pageX: 0 });
  const usable = () => Math.max(0, layoutRef.current.width - THUMB);

  const initialIdx = value ? SHAPES.indexOf(value) : 0;
  const [thumbPx, setThumbPx] = useState<number>(() =>
    centerPxForIndex(Math.max(0, initialIdx), TRACK_WIDTH - THUMB),
  );
  const thumbPxRef = useRef<number>(thumbPx);
  thumbPxRef.current = thumbPx;
  const draggingRef = useRef(false);

  // Sync to controlled value when not dragging.
  useEffect(() => {
    if (draggingRef.current) return;
    const idx = value ? SHAPES.indexOf(value) : 0;
    setThumbPx(centerPxForIndex(Math.max(0, idx), usable()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, layoutRef.current.width]);

  const measure = (then: () => void) => {
    containerRef.current?.measure((_x, _y, width, _h, pageX) => {
      layoutRef.current = { width, pageX };
      then();
    });
  };

  const apply = (pageX: number) => {
    const trackX = pageX - (layoutRef.current.pageX + THUMB / 2);
    const next = Math.min(Math.max(trackX, 0), usable());
    setThumbPx(next);
  };

  const settle = () => {
    draggingRef.current = false;
    const idx = pxToShapeIndex(thumbPxRef.current, usable());
    const snapped = centerPxForIndex(idx, usable());
    setThumbPx(snapped);
    const next = SHAPES[idx];
    if (next !== value) onChange(next);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          measure(() => {
            draggingRef.current = true;
            apply(e.nativeEvent.pageX);
          });
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          apply(e.nativeEvent.pageX);
        },
        onPanResponderRelease: () => {
          settle();
        },
        onPanResponderTerminate: () => {
          settle();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value],
  );

  const onLayout = () => {
    containerRef.current?.measure((_x, _y, width, _h, pageX) => {
      layoutRef.current = { width, pageX };
      if (!draggingRef.current) {
        const idx = value ? SHAPES.indexOf(value) : 0;
        setThumbPx(centerPxForIndex(Math.max(0, idx), Math.max(0, width - THUMB)));
      }
    });
  };

  const activeIdx = value ? SHAPES.indexOf(value) : 0;
  const meta = META[SHAPES[activeIdx] ?? 'soft'];

  return (
    <View style={styles.container}>
      <View style={styles.placeholder}>
        <LinearGradient
          colors={['#F5FBFD', '#E6F4F8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.placeholderIconWrap}>
          <Ionicons
            name={meta.icon}
            size={26}
            color={C.brandTeal}
          />
        </View>
        <Text style={styles.placeholderTitle}>{meta.title}</Text>
        <Text style={styles.placeholderDesc}>{meta.description}</Text>
      </View>

      <View
        ref={containerRef}
        style={styles.trackWrap}
        onLayout={onLayout}
        {...responder.panHandlers}
      >
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.tick, { left: '33.33%' }]} pointerEvents="none" />
          <View style={[styles.tick, { left: '66.66%' }]} pointerEvents="none" />
        </View>
        <View
          style={[styles.thumb, { transform: [{ translateX: thumbPx }] }]}
          pointerEvents="none"
        />
      </View>

      <View style={styles.labelRow}>
        {SHAPES.map((s, i) => (
          <Text
            key={s}
            style={[
              styles.labelText,
              i === activeIdx && styles.labelTextActive,
            ]}
          >
            {LABELS[s]}
          </Text>
        ))}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Public export — picks the right implementation per platform.
// ---------------------------------------------------------------------------
export const WaveShapeSlider: React.FC<WaveShapeSliderProps> = (props) => {
  if (Platform.OS === 'web' || !hasNativeGestures) {
    return <WebWaveShapeSlider {...props} />;
  }
  return <NativeWaveShapeSlider {...props} />;
};

export default WaveShapeSlider;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  placeholder: {
    width: '100%',
    height: PLACEHOLDER_H,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.borderDivider,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  placeholderIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  placeholderTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: C.inkBody,
    marginBottom: 4,
    textAlign: 'center',
  },
  placeholderDesc: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    color: C.textMuted,
    textAlign: 'center',
  },
  trackWrap: {
    width: TRACK_WIDTH,
    height: THUMB,
    justifyContent: 'center',
    position: 'relative',
  },
  track: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    top: (THUMB - TRACK_H) / 2,
    height: TRACK_H,
    backgroundColor: C.track,
    borderRadius: TRACK_H / 2,
  },
  tick: {
    position: 'absolute',
    width: 2,
    height: TRACK_H + 4,
    top: -2,
    backgroundColor: C.borderField,
    marginLeft: -1,
  },
  thumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: C.brandTeal,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: TRACK_WIDTH,
    marginTop: 12,
    paddingHorizontal: 0,
  },
  labelText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONT_INTER,
    fontSize: 13,
    fontWeight: '500',
    color: C.textMuted,
  },
  labelTextActive: {
    color: C.inkDark,
    fontWeight: '700',
  },
});
