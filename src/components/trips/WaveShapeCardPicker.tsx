import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WaveShapeKind } from '../../services/trips/groupTripsService';

// --------------------------------------------------------------------------
// WaveShapeCardPicker — multi-select stack of 3 title+description cards for
// the wave shape question on Step 2 of CreateTripFlowA.
//
// Spec: docs/create-trip-redesign-spec.md §4 Step 2.2 + §7.5
// Tokens: docs/design-language-snapshot.md
// --------------------------------------------------------------------------

const FONT_INTER =
  Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealTint: '#E6F4F8',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderCard: '#E0E0E0',
  surfaceCard: '#FFFFFF',
  errorText: '#C0392B',
};

interface WaveShapeOption {
  key: WaveShapeKind;
  title: string;
  description: string;
}

// Copy is locked by spec §4.2.2 / §6 microcopy.
const WAVE_SHAPES: WaveShapeOption[] = [
  {
    key: 'soft',
    title: 'Soft wave',
    description: 'Gentle, rolling — fat shoulder, no curl',
  },
  {
    key: 'wally',
    title: 'Wally wave',
    description: 'Walled, fast face — punchy without barreling',
  },
  {
    key: 'barrel',
    title: 'Barrel wave',
    description: 'Hollow, throwing lip — proper tubes',
  },
];

export interface WaveShapeCardPickerProps {
  selected: WaveShapeKind[];
  onChange: (next: WaveShapeKind[]) => void;
  error?: string;
}

export const WaveShapeCardPicker: React.FC<WaveShapeCardPickerProps> = ({
  selected,
  onChange,
  error,
}) => {
  const toggle = useCallback(
    (key: WaveShapeKind) => {
      const isSelected = selected.includes(key);
      const next = isSelected
        ? selected.filter((k) => k !== key)
        : [...selected, key];
      onChange(next);
    },
    [selected, onChange],
  );

  return (
    <View>
      <View style={styles.stack}>
        {WAVE_SHAPES.map((shape) => {
          const isSelected = selected.includes(shape.key);
          return (
            <TouchableOpacity
              key={shape.key}
              activeOpacity={0.85}
              onPress={() => toggle(shape.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${shape.title}. ${shape.description}`}
              style={[
                styles.card,
                {
                  backgroundColor: isSelected ? C.brandTealTint : C.surfaceCard,
                  borderColor: isSelected ? C.brandTeal : C.borderCard,
                  borderWidth: isSelected ? 2 : 1,
                  // Compensate inner padding so selected vs unselected cards
                  // don't visually jump by 1px when the border thickens.
                  paddingVertical: isSelected ? 15 : 16,
                  paddingHorizontal: isSelected ? 15 : 16,
                },
              ]}
            >
              <View style={styles.cardContent}>
                <Text
                  style={[
                    styles.title,
                    { color: isSelected ? '#066b8c' : C.inkBody },
                  ]}
                >
                  {shape.title}
                </Text>
                <Text style={styles.desc}>{shape.description}</Text>
              </View>
              {isSelected ? (
                <View style={styles.check}>
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={C.brandTeal}
                  />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: 10,
  },
  card: {
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardContent: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  desc: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: C.textMuted,
  },
  check: {
    marginLeft: 8,
    marginTop: 2,
  },
  error: {
    marginTop: 6,
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    color: C.errorText,
  },
});

export default WaveShapeCardPicker;
