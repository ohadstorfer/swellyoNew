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
import { Ionicons } from '@expo/vector-icons';

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
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#E0E0E0',
  surfaceCard: '#FFFFFF',
  errorText: '#C0392B',
};

export interface TripTagPickerOption<TSlug extends string> {
  slug: TSlug;
  label: string;
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
  error,
  style,
  accessibilityLabel,
}: TripTagPickerProps<TSlug>): React.ReactElement {
  const toggle = useCallback(
    (slug: TSlug) => {
      const isSelected = selected.includes(slug);
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
    [selected, onChange, mutexPairs],
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
              style={[
                styles.pill,
                {
                  borderColor: isSelected ? C.brandTeal : C.borderField,
                  backgroundColor: isSelected ? C.brandTealTint : C.surfaceCard,
                },
              ]}
            >
              <Text
                style={[
                  styles.label,
                  { color: isSelected ? C.brandTealText : C.inkBody },
                ]}
              >
                {opt.label}
              </Text>
              {isSelected ? (
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={C.brandTeal}
                  style={styles.check}
                />
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
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 12,
  },
  label: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  check: {
    marginLeft: 8,
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
