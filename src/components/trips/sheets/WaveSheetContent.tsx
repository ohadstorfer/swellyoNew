// WaveSheetContent — combined wave shape + wave size in a single sheet.
// Matches Figma node 12255:1809 — illustration centered up top, "Shape name"
// + "Wave Shape" labels below the illustration, then the shape slider, then
// "X – Y ft" + "Wave Size" labels, then the range slider.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, Platform, Animated, Easing } from 'react-native';
import type { WaveShapeKind } from '../../../services/trips/groupTripsService';
import { WaveShapeSlider } from '../WaveShapeSlider';
import { RangeSlider } from '../RangeSlider';
import { Images } from '../../../assets/images';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  inkDark: '#333333',
  textMuted: '#7B7B7B',
};

const WAVE_SIZE_MIN = 1;
const WAVE_SIZE_MAX = 12;

// Format a single endpoint of the size range. The top of the scale (12)
// is shown as "12+" because picking the max really means "12 ft or
// bigger" — we don't track sizes above that.
const formatFt = (n: number): string =>
  n >= WAVE_SIZE_MAX ? `${WAVE_SIZE_MAX}+ ft` : `${n} ft`;
const formatFtBare = (n: number): string =>
  n >= WAVE_SIZE_MAX ? `${WAVE_SIZE_MAX}+` : `${n}`;

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

// Per-shape visual scale for the illustration. Mellow + Standing PNGs
// have white space baked in around the wave drawing, so they need to be
// scaled UP more than the barrel (which is tightly cropped) to read at
// a comparable visible size.
const SHAPE_SCALE: Record<WaveShapeKind, number> = {
  soft: 1.6,
  wally: 1.55,
  barrel: 1.55,
};

// Per-shape vertical nudge — negative shifts the image UP. Mellow's PNG
// has a tall whitespace strip above the wave drawing; nudging it up
// brings the drawing visually closer to "The Wave" header.
const SHAPE_TRANSLATE_Y: Record<WaveShapeKind, number> = {
  soft: -22,
  wally: 0,
  barrel: 0,
};

const CROSSFADE_DURATION_MS = 700;

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
  const sizeLabel =
    sizeMin === sizeMax
      ? formatFt(sizeMin)
      : `${formatFtBare(sizeMin)} – ${formatFt(sizeMax)}`;

  // One opacity value per shape. All three Image layers are mounted at the
  // same time and stacked; opacity drives the crossfade so we never get a
  // hard swap as the user crosses a threshold on the shape slider.
  const opacities = useRef(
    SHAPES.map(s => new Animated.Value(s === activeShape ? 1 : 0)),
  ).current;

  useEffect(() => {
    SHAPES.forEach((s, i) => {
      Animated.timing(opacities[i], {
        toValue: s === activeShape ? 1 : 0,
        duration: CROSSFADE_DURATION_MS,
        // Ease-in-out cubic — slow start, slow end, smooth middle. Reads
        // as a gentle dissolve rather than a linear ramp.
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [activeShape, opacities]);

  return (
    <View style={styles.container}>
      {/* Wave illustration — all three images mounted; opacity crossfades
          between them as the active shape changes. */}
      <View style={styles.illustrationWrap}>
        {SHAPES.map((s, i) => (
          <Animated.View
            key={s}
            pointerEvents="none"
            style={[styles.illustrationLayer, { opacity: opacities[i] }]}
          >
            <Image
              source={SHAPE_IMAGE[s]}
              style={[
                styles.illustration,
                {
                  transform: [
                    { translateY: SHAPE_TRANSLATE_Y[s] },
                    { scale: SHAPE_SCALE[s] },
                  ],
                },
              ]}
              resizeMode="contain"
            />
          </Animated.View>
        ))}
      </View>

      {/* Shape name + "Wave Shape" sublabel */}
      <View style={styles.labelBlock}>
        <Text style={styles.primaryLabel}>{SHAPE_LABEL[activeShape]}</Text>
        <Text style={styles.subLabel}>Wave Shape</Text>
      </View>

      {/* Shape slider */}
      <View style={styles.sliderWrap}>
        <WaveShapeSlider value={shape} onChange={onShapeChange} />
      </View>

      {/* Size value + "Wave Size" sublabel */}
      <View style={[styles.labelBlock, styles.sizeLabelBlock]}>
        <Text style={styles.primaryLabelLarge}>{sizeLabel}</Text>
        <Text style={styles.subLabel}>Wave Size</Text>
      </View>

      {/* Range slider */}
      <View style={styles.rangeWrap}>
        <RangeSlider
          min={WAVE_SIZE_MIN}
          max={WAVE_SIZE_MAX}
          step={1}
          lower={Math.max(WAVE_SIZE_MIN, Math.min(WAVE_SIZE_MAX, sizeMin))}
          upper={Math.max(WAVE_SIZE_MIN, Math.min(WAVE_SIZE_MAX, sizeMax))}
          minLabel={`${WAVE_SIZE_MIN} ft`}
          maxLabel={`${WAVE_SIZE_MAX}+ ft`}
          onChange={({ lower, upper }) =>
            onSizeChange({ min: lower, max: upper })
          }
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'stretch',
  },
  // overflow:'visible' lets the per-shape scale transform extend beyond
  // the wrap if needed.
  illustrationWrap: {
    width: '100%',
    height: 220,
    overflow: 'visible',
    marginBottom: 40,
    position: 'relative',
  },
  // Each shape's image fills the wrap. They're stacked absolutely so the
  // crossfade is a pure opacity blend with zero layout shift.
  illustrationLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustration: {
    width: '100%',
    height: '100%',
  },
  labelBlock: {
    alignItems: 'center',
    gap: 4,
    marginBottom: 20,
  },
  sizeLabelBlock: {
    marginTop: 120,
  },
  primaryLabel: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: C.inkDark,
    textAlign: 'center',
  },
  primaryLabelLarge: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '700',
    color: C.inkDark,
    textAlign: 'center',
  },
  subLabel: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    color: C.textMuted,
    textAlign: 'center',
  },
  // 24pt side inset so neither slider hugs the edge of the sheet.
  sliderWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: 24,
  },
  rangeWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: 24,
  },
});

export default WaveSheetContent;
