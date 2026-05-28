// WaveSizeSheetContent — big-number wave-size range (1–15 ft) backed by the dual-handle RangeSlider.
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { RangeSlider } from '../RangeSlider';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  textMuted: '#7B7B7B',
};

const WAVE_MIN = 1;
const WAVE_MAX = 15;

export interface WaveSizeSheetContentProps {
  min: number;
  max: number;
  onChange: (next: { min: number; max: number }) => void;
}

export const WaveSizeSheetContent: React.FC<WaveSizeSheetContentProps> = ({
  min,
  max,
  onChange,
}) => {
  // Clamp incoming values so a stale state can't push the slider outside bounds.
  const lower = Math.min(Math.max(min, WAVE_MIN), WAVE_MAX);
  const upper = Math.min(Math.max(max, lower), WAVE_MAX);

  return (
    <View style={styles.container}>
      {/* Anchor pill — teal-tinted background hugging the range number. */}
      <View style={styles.pillWrap}>
        <View
          style={styles.pill}
          accessibilityLabel={`${lower} to ${upper} feet`}
          accessibilityRole="text"
        >
          <Text style={styles.pillNumber}>
            {lower}
            <Text style={styles.pillDash}> – </Text>
            {upper}
          </Text>
          <Text style={styles.pillUnit}> ft</Text>
        </View>
        <Text style={styles.subLabel}>Wave size range</Text>
      </View>

      <View style={styles.sliderWrap}>
        <RangeSlider
          min={WAVE_MIN}
          max={WAVE_MAX}
          step={1}
          lower={lower}
          upper={upper}
          onChange={next =>
            onChange({ min: next.lower, max: next.upper })
          }
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 4,
    gap: 20,
  },
  pillWrap: {
    alignItems: 'center',
    gap: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: C.brandTealTint,
  },
  pillNumber: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    color: C.brandTealText,
  },
  pillDash: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 24,
    lineHeight: 38,
    fontWeight: '700',
    color: C.brandTeal,
  },
  pillUnit: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 38,
    fontWeight: '700',
    color: C.brandTeal,
    marginLeft: 4,
  },
  subLabel: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sliderWrap: {
    paddingHorizontal: 4,
  },
});

export default WaveSizeSheetContent;
