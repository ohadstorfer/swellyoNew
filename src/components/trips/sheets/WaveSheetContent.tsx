// WaveSheetContent — wave shape + size in a single sheet.
// Matches Figma node 12492:12259 — a wave illustration up top that crossfades
// between the three shapes as the Shape slider moves, then two bordered cards
// ("Shape" / "Size"), each with a leading icon chip, title + subtitle, and a
// slider that shows the current value in a pill above the thumb.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, Platform, Animated, Easing } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WaveShapeKind } from '../../../services/trips/groupTripsService';
import { WaveShapeSlider } from '../WaveShapeSlider';
import { RangeSlider } from '../RangeSlider';
import { Images } from '../../../assets/images';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

const C = {
  ink: '#333333',
  textMuted: '#7B7B7B',
  border: '#EEEEEE',
  iconBg: '#F7F7F7',
  surface: '#FFFFFF',
};

const WAVE_SIZE_MIN = 1;
const WAVE_SIZE_MAX = 12;

const formatFt = (n: number): string =>
  n >= WAVE_SIZE_MAX ? `${WAVE_SIZE_MAX}+ ft` : `${n} ft`;

const SHAPES: readonly WaveShapeKind[] = ['soft', 'wally', 'barrel'] as const;

const SHAPE_LABEL: Record<WaveShapeKind, string> = {
  soft: 'Mellow',
  wally: 'Standing',
  barrel: 'Barrel',
};

const SHAPE_IMAGE: Record<WaveShapeKind, any> = {
  soft: Images.waveShapes.mellow,
  wally: Images.waveShapes.wally,
  barrel: Images.waveShapes.barrel,
};

// Per-shape illustration scale — the mellow/standing PNGs carry extra
// whitespace, so they're scaled up to read at a comparable visible size.
const SHAPE_SCALE: Record<WaveShapeKind, number> = {
  soft: 1.4,
  wally: 1.35,
  barrel: 1.35,
};

const CROSSFADE_DURATION_MS = 500;

export interface WaveSheetContentProps {
  shape: WaveShapeKind | null;
  onShapeChange: (next: WaveShapeKind) => void;
  sizeMin: number;
  sizeMax: number;
  onSizeChange: (next: { min: number; max: number }) => void;
}

export const WaveSheetContent: React.FC<WaveSheetContentProps> = ({
  shape,
  onShapeChange,
  sizeMin,
  sizeMax,
  onSizeChange,
}) => {
  const activeShape: WaveShapeKind = shape ?? 'soft';
  const lower = Math.max(WAVE_SIZE_MIN, Math.min(WAVE_SIZE_MAX, sizeMin));
  const upper = Math.max(WAVE_SIZE_MIN, Math.min(WAVE_SIZE_MAX, sizeMax));

  // One opacity per shape — all three images are mounted and crossfaded so the
  // illustration dissolves between shapes as the slider crosses a threshold.
  const opacities = useRef(
    SHAPES.map(s => new Animated.Value(s === activeShape ? 1 : 0)),
  ).current;

  useEffect(() => {
    SHAPES.forEach((s, i) => {
      Animated.timing(opacities[i], {
        toValue: s === activeShape ? 1 : 0,
        duration: CROSSFADE_DURATION_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [activeShape, opacities]);

  return (
    <View style={styles.container}>
      {/* Wave illustration — crossfades with the active shape */}
      <View style={styles.illustrationWrap}>
        {SHAPES.map((s, i) => (
          <Animated.View
            key={s}
            pointerEvents="none"
            style={[styles.illustrationLayer, { opacity: opacities[i] }]}
          >
            <Image
              source={SHAPE_IMAGE[s]}
              style={[styles.illustration, { transform: [{ scale: SHAPE_SCALE[s] }] }]}
              resizeMode="contain"
            />
          </Animated.View>
        ))}
      </View>

      {/* Shape card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconBox}>
            <MaterialCommunityIcons name="waves" size={18} color={C.ink} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.cardTitle}>Shape</Text>
            <Text style={styles.cardSubtitle}>How powerful the wave breaks</Text>
          </View>
        </View>
        <View style={styles.sliderArea}>
          <WaveShapeSlider
            value={shape}
            onChange={onShapeChange}
            bubbleLabel={SHAPE_LABEL[activeShape]}
            minLabel="Mellow"
            maxLabel="Barreling"
          />
        </View>
      </View>

      {/* Size card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconBox}>
            <MaterialCommunityIcons name="ruler" size={18} color={C.ink} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.cardTitle}>Size</Text>
            <Text style={styles.cardSubtitle}>Average wave height</Text>
          </View>
        </View>
        <View style={styles.sliderArea}>
          <RangeSlider
            min={WAVE_SIZE_MIN}
            max={WAVE_SIZE_MAX}
            step={1}
            lower={lower}
            upper={upper}
            minLabel={`${WAVE_SIZE_MIN} ft`}
            maxLabel={`${WAVE_SIZE_MAX}+ ft`}
            bubbleFormat={formatFt}
            maxSpan={6}
            onChange={({ lower: lo, upper: up }) => onSizeChange({ min: lo, max: up })}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'stretch',
    gap: 16,
  },
  illustrationWrap: {
    width: '100%',
    height: 175,
    marginBottom: 8,
    position: 'relative',
  },
  illustrationLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustration: {
    width: '100%',
    height: '100%',
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    padding: 8,
    gap: 8,
    marginHorizontal: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBox: {
    backgroundColor: C.iconBg,
    borderRadius: 8,
    padding: 10,
  },
  headerText: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    color: C.ink,
  },
  cardSubtitle: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: C.textMuted,
  },
  // Top padding leaves room for the value pill that floats above the thumb,
  // plus extra breathing room between that pill and the card's title row.
  sliderArea: {
    paddingTop: 44,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
});

export default WaveSheetContent;
