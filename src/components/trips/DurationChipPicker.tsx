// Preset trip-length chips with an "Other" inline-number-input fallback.
import React, { useEffect, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export interface DurationChipPickerProps {
  value: number | null;
  onChange: (days: number | null) => void;
  presets?: number[];
  error?: string;
}

const FONT_INTER =
  Platform.OS === 'web' ? ('Inter, sans-serif' as const) : ('Inter' as const);

const COLORS = {
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  textPlaceholder: '#B0B0B0',
  borderField: '#CFCFCF',
  surfaceCard: '#FFFFFF',
  brandTeal: '#0788B0',
  errorBorder: '#FF0000',
  errorText: '#C0392B',
};

const DEFAULT_PRESETS = [3, 5, 7, 10, 14];

export const DurationChipPicker: React.FC<DurationChipPickerProps> = ({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  error,
}) => {
  const valueIsPreset = value !== null && presets.includes(value);
  const initialOther = value !== null && !valueIsPreset;
  const [otherActive, setOtherActive] = useState<boolean>(initialOther);
  const [otherText, setOtherText] = useState<string>(
    initialOther ? String(value) : ''
  );

  // Sync external value → internal "Other" mode when an external change drops
  // the value off the preset list.
  useEffect(() => {
    if (value !== null && !presets.includes(value)) {
      setOtherActive(true);
      setOtherText(String(value));
    }
    if (value === null) {
      setOtherText('');
    }
  }, [value, presets]);

  const handlePresetTap = (n: number) => {
    setOtherActive(false);
    setOtherText('');
    onChange(n);
  };

  const handleOtherTap = () => {
    setOtherActive(true);
    // If we already had a non-preset value, keep it; else clear selection.
    if (value !== null && !presets.includes(value)) {
      setOtherText(String(value));
    } else {
      onChange(null);
    }
  };

  const handleOtherChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 2);
    setOtherText(digits);
    if (digits === '') {
      onChange(null);
      return;
    }
    const n = parseInt(digits, 10);
    if (Number.isFinite(n) && n > 0) {
      onChange(n);
    } else {
      onChange(null);
    }
  };

  return (
    <View>
      <View style={styles.chipRow}>
        {presets.map(n => {
          const selected = !otherActive && value === n;
          return (
            <TouchableOpacity
              key={n}
              activeOpacity={0.7}
              onPress={() => handlePresetTap(n)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
              >
                {n}d
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handleOtherTap}
          style={[styles.chip, otherActive && styles.chipSelected]}
        >
          <Text
            style={[styles.chipText, otherActive && styles.chipTextSelected]}
          >
            Other
          </Text>
        </TouchableOpacity>
      </View>

      {otherActive && (
        <View style={styles.otherRow}>
          <TextInput
            value={otherText}
            onChangeText={handleOtherChange}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="—"
            placeholderTextColor={COLORS.textPlaceholder}
            style={[styles.otherInput, !!error && styles.otherInputError]}
          />
          <Text style={styles.otherUnit}>days</Text>
        </View>
      )}

      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    height: 44,
    minWidth: 60,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.borderField,
    backgroundColor: COLORS.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: COLORS.brandTeal,
    borderColor: COLORS.brandTeal,
  },
  chipText: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: COLORS.inkBody,
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  otherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  otherInput: {
    width: 60,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderField,
    backgroundColor: COLORS.surfaceCard,
    paddingHorizontal: 12,
    fontFamily: FONT_INTER,
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.inkBody,
    textAlign: 'center',
  },
  otherInputError: {
    borderColor: COLORS.errorBorder,
  },
  otherUnit: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: COLORS.textMuted,
  },
  errorText: {
    marginTop: 8,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: COLORS.errorText,
  },
});
