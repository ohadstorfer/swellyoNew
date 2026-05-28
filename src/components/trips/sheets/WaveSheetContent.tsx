// WaveSheetContent — combined wave shape + wave size in a single sheet.
// Replaces WaveShapeSheetContent + WaveSizeSheetContent for the new
// "The Wave" card on Step 1 of the create-trip flow.

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import type { WaveShapeKind } from '../../../services/trips/groupTripsService';
import { WaveShapeSlider } from '../WaveShapeSlider';
import { RangeSlider } from '../RangeSlider';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealTint: '#E6F4F8',
  brandTealText: '#066b8c',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
};

const WAVE_SIZE_MIN = 1;
const WAVE_SIZE_MAX = 15;

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
  const sizeLabel =
    sizeMin === sizeMax
      ? `${sizeMin} ft`
      : `${sizeMin} – ${sizeMax} ft`;

  return (
    <View style={styles.container}>
      {/* --- Wave shape --- */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>SHAPE</Text>
        <WaveShapeSlider value={shape} onChange={onShapeChange} />
      </View>

      {/* --- Wave size --- */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>SIZE</Text>
        <View style={styles.sizePill}>
          <Text style={styles.sizePillText}>{sizeLabel}</Text>
        </View>
        <View style={styles.rangeWrap}>
          <RangeSlider
            min={WAVE_SIZE_MIN}
            max={WAVE_SIZE_MAX}
            step={1}
            lower={Math.max(WAVE_SIZE_MIN, Math.min(WAVE_SIZE_MAX, sizeMin))}
            upper={Math.max(WAVE_SIZE_MIN, Math.min(WAVE_SIZE_MAX, sizeMax))}
            onChange={({ lower, upper }) =>
              onSizeChange({ min: lower, max: upper })
            }
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 28,
  },
  section: {
    gap: 12,
    alignItems: 'center',
  },
  sectionLabel: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 1.2,
    alignSelf: 'flex-start',
  },
  sizePill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: C.brandTealTint,
  },
  sizePillText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
    color: C.brandTealText,
    textAlign: 'center',
  },
  // alignItems:center MUST NOT be set here — the RangeSlider's container has
  // only absolutely-positioned children, so it would shrink to 0 width under
  // cross-axis center alignment and become an invisible / dead slider.
  rangeWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: 8,
  },
});

export default WaveSheetContent;
