// AgeSheetContent — side-by-side Min/Max number cubes with validation against an ageWindow span.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Keyboard,
  InputAccessoryView,
  Platform,
} from 'react-native';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  brandTealTint: '#E6F4F8',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  borderDivider: '#E0E0E0',
  surfaceCard: '#FFFFFF',
  accessoryBg: '#F2F2F2',
  errorText: '#C0392B',
};

const AGE_ACCESSORY_ID = 'ageDoneAccessory';

const DEFAULT_MIN = 21;
const DEFAULT_MAX = 35;
const ABS_MIN = 16;
const ABS_MAX = 99;

export interface AgeSheetContentProps {
  ageMin: number | null;
  ageMax: number | null;
  /** Required span between max and min (varies by hosting style). */
  ageWindow: number;
  onChange: (next: { ageMin: number | null; ageMax: number | null }) => void;
  error?: string;
}

const parseAge = (raw: string): number | null => {
  const cleaned = raw.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), hi);

export const AgeSheetContent: React.FC<AgeSheetContentProps> = ({
  ageMin,
  ageMax,
  ageWindow,
  onChange,
  error,
}) => {
  const minRef = useRef<TextInput>(null);
  const maxRef = useRef<TextInput>(null);

  // Local string state so the user can clear/type freely without props fighting back.
  const [minStr, setMinStr] = useState<string>(
    ageMin != null ? String(ageMin) : String(DEFAULT_MIN),
  );
  const [maxStr, setMaxStr] = useState<string>(
    ageMax != null ? String(ageMax) : String(DEFAULT_MAX),
  );
  const [focused, setFocused] = useState<'min' | 'max' | null>(null);

  // Auto-focus the Min input when the sheet mounts so the keyboard opens
  // immediately. Small delay lets the sheet's slide-in animation settle.
  useEffect(() => {
    const t = setTimeout(() => minRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  // If parent props change from outside (e.g. reset), pull them into local state.
  useEffect(() => {
    if (focused !== 'min') {
      setMinStr(ageMin != null ? String(ageMin) : '');
    }
    if (focused !== 'max') {
      setMaxStr(ageMax != null ? String(ageMax) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageMin, ageMax]);

  // Emit a normalized {min, max} to the parent. Called on commit (blur / Done).
  const emitNormalized = (rawMin: string, rawMax: string) => {
    const parsedMin = parseAge(rawMin);
    const parsedMax = parseAge(rawMax);

    let nextMin = parsedMin;
    let nextMax = parsedMax;

    if (nextMin != null) nextMin = clamp(nextMin, ABS_MIN, ABS_MAX);
    if (nextMax != null) nextMax = clamp(nextMax, ABS_MIN, ABS_MAX);

    // If both present, ensure max >= min and span >= ageWindow.
    if (nextMin != null && nextMax != null) {
      if (nextMax < nextMin) {
        nextMax = nextMin;
      }
      if (nextMax - nextMin < ageWindow) {
        nextMax = clamp(nextMin + ageWindow, ABS_MIN, ABS_MAX);
        // If clamping the top hit ABS_MAX, pull min back down to satisfy span.
        if (nextMax - nextMin < ageWindow) {
          nextMin = clamp(nextMax - ageWindow, ABS_MIN, ABS_MAX);
        }
      }
    }

    if (nextMin !== ageMin || nextMax !== ageMax) {
      onChange({ ageMin: nextMin, ageMax: nextMax });
    }
    if (nextMin != null) setMinStr(String(nextMin));
    if (nextMax != null) setMaxStr(String(nextMax));
  };

  return (
    <View>
      <View style={styles.row}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.cube, focused === 'min' && styles.cubeActive]}
          onPress={() => minRef.current?.focus()}
        >
          <Text
            style={[
              styles.cubeLabel,
              focused === 'min' && styles.cubeLabelActive,
            ]}
          >
            Min
          </Text>
          <TextInput
            ref={minRef}
            value={minStr}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={2}
            onChangeText={t => {
              const cleaned = t.replace(/[^0-9]/g, '');
              setMinStr(cleaned);
              // Auto-jump to Max once Min has 2 digits (all valid ages are 2 digits).
              if (cleaned.length === 2) maxRef.current?.focus();
            }}
            onFocus={() => setFocused('min')}
            onBlur={() => {
              setFocused(null);
              emitNormalized(minStr, maxStr);
            }}
            style={styles.cubeInput}
            accessibilityLabel="Minimum age"
            returnKeyType="done"
            inputAccessoryViewID={
              Platform.OS === 'ios' ? AGE_ACCESSORY_ID : undefined
            }
          />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.cube, focused === 'max' && styles.cubeActive]}
          onPress={() => maxRef.current?.focus()}
        >
          <Text
            style={[
              styles.cubeLabel,
              focused === 'max' && styles.cubeLabelActive,
            ]}
          >
            Max
          </Text>
          <TextInput
            ref={maxRef}
            value={maxStr}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={2}
            onChangeText={t => setMaxStr(t.replace(/[^0-9]/g, ''))}
            onFocus={() => setFocused('max')}
            onBlur={() => {
              setFocused(null);
              emitNormalized(minStr, maxStr);
            }}
            style={styles.cubeInput}
            accessibilityLabel="Maximum age"
            returnKeyType="done"
            inputAccessoryViewID={
              Platform.OS === 'ios' ? AGE_ACCESSORY_ID : undefined
            }
          />
        </TouchableOpacity>
      </View>

      <Text style={styles.helper}>
        Must span at least {ageWindow} {ageWindow === 1 ? 'year' : 'years'}.
      </Text>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {/* iOS-only Done bar above the number pad. */}
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={AGE_ACCESSORY_ID}>
          <View style={styles.accessoryBar}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => Keyboard.dismiss()}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text style={styles.accessoryDone}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 4,
  },
  cube: {
    width: 112,
    minHeight: 104,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: C.borderField,
    borderRadius: 16,
    backgroundColor: C.surfaceCard,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
    // Subtle elevation so the cubes read as cards, not flat boxes.
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cubeActive: {
    borderWidth: 2,
    borderColor: C.brandTeal,
    backgroundColor: C.brandTealTint,
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  cubeLabel: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cubeLabelActive: {
    color: C.brandTeal,
  },
  cubeInput: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '800',
    color: C.inkBody,
    textAlign: 'center',
    minWidth: 72,
    padding: 0,
    paddingTop: 2,
  },
  helper: {
    marginTop: 10,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: C.textMuted,
    textAlign: 'center',
  },
  error: {
    marginTop: 6,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: C.errorText,
    textAlign: 'center',
  },
  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.accessoryBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.borderDivider,
  },
  accessoryDone: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    fontWeight: '700',
    color: C.brandTeal,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});

export default AgeSheetContent;
