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
import { MaterialCommunityIcons } from '@expo/vector-icons';

// --------------------------------------------------------------------------
// TripTagPicker — generic multi-select picker rendered as a vertical stack
// of full-width pills with a checkmark on the right when selected.
//
// Used for long-label tag groups that don't fit cleanly in a chip row:
//   • trip_structure ("How does the trip work?")
//   • trip_vibes     ("What's the general vibe?")
//
// Mutex pairs are silently enforced — selecting one option deselects its
// partner without a confirmation prompt. The DB has the same CHECK
// constraints, but client-side mutex keeps the UI in lock-step.
//
// Design tokens come from docs/design-language-snapshot.md. DO NOT import
// theme.ts colors — those tokens are stale.
// --------------------------------------------------------------------------

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';

// Design tokens (mirrors SurfChipPicker)
const C = {
  accent: '#05BCD3',
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkBody: '#333333',
  textMuted: '#7B7B7B',
  borderField: '#E0E0E0',
  surfaceCard: '#FFFFFF',
  checkboxOffBg: '#F7F7F7',
  checkboxOffBorder: '#CFCFCF',
  errorText: '#C0392B',
  meterFill: '#9CB6C0',
  meterEmpty: '#E0E0E0',
};

export interface TripTagPickerOption<TSlug extends string> {
  slug: TSlug;
  label: string;
  /**
   * Optional 1–4 surf-intensity level. When set, a 4-bar meter is rendered on
   * the pill (filled bars = level) so a top→bottom list reads as a scale.
   */
  intensity?: number;
}

// Small 4-bar meter (left→right, rising height). Filled bars = `level`.
function IntensityMeter({
  level,
  active,
}: {
  level: number;
  active: boolean;
}): React.ReactElement {
  return (
    <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1, 2, 3].map(i => {
        const filled = i < level;
        return (
          <View
            key={i}
            style={[
              styles.meterBar,
              { height: 6 + i * 4 },
              {
                backgroundColor: filled
                  ? active
                    ? C.brandTeal
                    : C.meterFill
                  : C.meterEmpty,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export interface TripTagPickerProps<TSlug extends string> {
  options: TripTagPickerOption<TSlug>[];
  selected: TSlug[];
  onChange: (next: TSlug[]) => void;
  /**
   * Pairs that may not co-exist. When the user picks one side of a pair, the
   * other side is silently dropped from the next array.
   */
  mutexPairs?: [TSlug, TSlug][];
  /**
   * Radio behavior — only one option at a time. Picking an option replaces the
   * selection; tapping the selected option clears it. `mutexPairs` is ignored.
   */
  singleSelect?: boolean;
  /** Inline error rendered below the list. */
  error?: string;
  /** Optional wrapper style override. */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label for the list container. */
  accessibilityLabel?: string;
}

export function TripTagPicker<TSlug extends string>({
  options,
  selected,
  onChange,
  mutexPairs,
  singleSelect,
  error,
  style,
  accessibilityLabel,
}: TripTagPickerProps<TSlug>): React.ReactElement {
  const toggle = useCallback(
    (slug: TSlug) => {
      const isSelected = selected.includes(slug);
      if (singleSelect) {
        onChange(isSelected ? [] : [slug]);
        return;
      }
      if (isSelected) {
        onChange(selected.filter(s => s !== slug));
        return;
      }
      // Compute the set of partners to drop because they conflict with `slug`.
      const conflicting = new Set<TSlug>();
      (mutexPairs ?? []).forEach(([a, b]) => {
        if (a === slug) conflicting.add(b);
        else if (b === slug) conflicting.add(a);
      });
      const next = selected.filter(s => !conflicting.has(s));
      next.push(slug);
      onChange(next);
    },
    [selected, onChange, mutexPairs, singleSelect],
  );

  return (
    <View style={style}>
      <View
        style={styles.list}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="list"
      >
        {options.map(opt => {
          const isSelected = selected.includes(opt.slug);
          return (
            <TouchableOpacity
              key={opt.slug}
              activeOpacity={0.85}
              onPress={() => toggle(opt.slug)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={opt.label}
              style={[styles.pill, isSelected && styles.pillSelected]}
            >
              <Text style={styles.label}>{opt.label}</Text>
              {opt.intensity != null ? (
                <IntensityMeter level={opt.intensity} active={isSelected} />
              ) : null}
              <View
                style={[
                  styles.checkbox,
                  isSelected ? styles.checkboxOn : styles.checkboxOff,
                ]}
              >
                {isSelected ? (
                  <MaterialCommunityIcons name="check-bold" size={14} color="#FFFFFF" />
                ) : null}
              </View>
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
  list: {
    gap: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent', // reserves space so the selected border adds no shift
    backgroundColor: C.surfaceCard,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  pillSelected: {
    borderColor: C.accent,
  },
  label: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    color: C.inkBody,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  checkboxOn: {
    backgroundColor: C.accent,
  },
  checkboxOff: {
    backgroundColor: C.checkboxOffBg,
    borderWidth: 1,
    borderColor: C.checkboxOffBorder,
  },
  meter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginLeft: 10,
    height: 18,
  },
  meterBar: {
    width: 3,
    borderRadius: 1.5,
  },
  error: {
    marginTop: 8,
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    color: C.errorText,
  },
});

export default TripTagPicker;
