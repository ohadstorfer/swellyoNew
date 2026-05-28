import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  StyleProp,
  ViewStyle,
} from 'react-native';

// --------------------------------------------------------------------------
// SurfChipPicker — generic multi-select chip row.
//
// Used for:
//   • Skill levels (3 options: Beginner / Intermediate / Advanced)
//   • Board types (4 options: Shortboard / Mid-length / Soft-top / Longboard)
//
// Tokens come from `docs/design-language-snapshot.md` and the redesign spec
// (`docs/create-trip-redesign-spec.md` §2 + §7.4). DO NOT import theme.ts
// colors — those tokens are stale.
// --------------------------------------------------------------------------

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

// Design tokens (spec §2)
const C = {
  brandTeal: '#0788B0',
  brandTealTint: '#E6F4F8',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  surfaceCard: '#FFFFFF',
  errorText: '#C0392B',
};

export interface SurfChipPickerOption<T extends string> {
  key: T;
  label: string;
}

export interface SurfChipPickerProps<T extends string> {
  options: SurfChipPickerOption<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  /** Allow chips to wrap to a 2nd row. Default true. */
  multiline?: boolean;
  /** Chip height + horizontal padding density. Default 'comfortable'. */
  size?: 'compact' | 'comfortable';
  /** Optional inline error rendered below the row. */
  error?: string;
  /** Optional wrapper style override (e.g. for layout context). */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label for the chip row container. */
  accessibilityLabel?: string;
}

export function SurfChipPicker<T extends string>({
  options,
  selected,
  onChange,
  multiline = true,
  size = 'comfortable',
  error,
  style,
  accessibilityLabel,
}: SurfChipPickerProps<T>) {
  const toggle = useCallback(
    (key: T) => {
      const isSelected = selected.includes(key);
      const next = isSelected ? selected.filter((k) => k !== key) : [...selected, key];
      onChange(next);
    },
    [selected, onChange],
  );

  const chipHeight = size === 'compact' ? 40 : 48;
  const chipPaddingH = size === 'compact' ? 14 : 18;

  return (
    <View style={style}>
      <View
        style={[
          styles.row,
          {
            flexWrap: multiline ? 'wrap' : 'nowrap',
          },
        ]}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="radiogroup"
      >
        {options.map((opt) => {
          const isSelected = selected.includes(opt.key);
          return (
            <TouchableOpacity
              key={opt.key}
              activeOpacity={0.85}
              onPress={() => toggle(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={opt.label}
              style={[
                styles.chip,
                {
                  minHeight: chipHeight,
                  paddingHorizontal: chipPaddingH,
                  backgroundColor: isSelected ? C.brandTeal : C.surfaceCard,
                  borderColor: isSelected ? C.brandTeal : C.borderField,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipLabel,
                  { color: isSelected ? '#FFFFFF' : C.inkBody },
                ]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
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
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    rowGap: 8,
  },
  chip: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 80,
    borderWidth: 1,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  chipLabel: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
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

export default SurfChipPicker;
