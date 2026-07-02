// AgeSheetContent — side-by-side Min/Max number cubes. If the typed pair
// is closer together than `ageWindow`, the field NOT just edited is pushed
// out to close the gap automatically (never blocks with an error).
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
} from 'react-native';

const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT =
  Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const C = {
  brandTeal: '#0788B0',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  surfaceCard: '#FFFFFF',
  errorText: '#C0392B',
};

const ABS_MIN = 16;
const ABS_MAX = 99;

export interface AgeSheetContentProps {
  ageMin: number | null;
  ageMax: number | null;
  /** Required span between max and min (varies by hosting style). */
  ageWindow: number;
  onChange: (next: { ageMin: number | null; ageMax: number | null }) => void;
  /** Called when the user has filled both fields (2 digits in Max) so the
   *  parent can dismiss the sheet. */
  onClose?: () => void;
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
  onClose,
  error,
}) => {
  const minRef = useRef<TextInput>(null);
  const maxRef = useRef<TextInput>(null);

  // Local string state so the user can clear/type freely without props
  // fighting back. Empty default — one-sided ranges (min only / max only)
  // are explicitly allowed, so we don't prefill anything the user didn't
  // type.
  const [minStr, setMinStr] = useState<string>(
    ageMin != null ? String(ageMin) : '',
  );
  const [maxStr, setMaxStr] = useState<string>(
    ageMax != null ? String(ageMax) : '',
  );
  const [focused, setFocused] = useState<'min' | 'max' | null>(null);

  // Auto-focus the Min input as soon as the first frame paints — the
  // keyboard then rises in lockstep with the sheet's slide-in, so the
  // two read as one moving brick (open AND close).
  useEffect(() => {
    const id = requestAnimationFrame(() => minRef.current?.focus());
    return () => cancelAnimationFrame(id);
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

  // Emit raw values to the parent on every keystroke so it always reflects
  // what the user typed. No clamping / span enforcement here — that
  // happens at submit time in the wizard's validateStep.
  const emitLive = (rawMin: string, rawMax: string) => {
    const nextMin = parseAge(rawMin);
    const nextMax = parseAge(rawMax);
    if (nextMin !== ageMin || nextMax !== ageMax) {
      onChange({ ageMin: nextMin, ageMax: nextMax });
    }
  };

  // Final normalization on commit — clamps to ABS_MIN/MAX and enforces the
  // minimum span. Called when the user blurs a field, or when a field hits
  // its 2-digit length. `editedField` is whichever value the user just
  // typed — if the span comes up short, we push the *other* field out to
  // close the gap instead of showing a blocking error, so the pair is
  // always valid the moment both fields have a value. When min is the
  // field just typed, max is what moves (and vice versa); if a field is
  // pinned at an ABS bound and can't move far enough, the just-typed field
  // gives way instead so the window is always satisfied.
  const emitNormalized = (
    rawMin: string,
    rawMax: string,
    editedField: 'min' | 'max' = 'max',
  ) => {
    const parsedMin = parseAge(rawMin);
    const parsedMax = parseAge(rawMax);
    let nextMin = parsedMin != null ? clamp(parsedMin, ABS_MIN, ABS_MAX) : null;
    let nextMax = parsedMax != null ? clamp(parsedMax, ABS_MIN, ABS_MAX) : null;

    if (nextMin != null && nextMax != null && nextMax - nextMin < ageWindow) {
      if (editedField === 'min') {
        nextMax = clamp(nextMin + ageWindow, ABS_MIN, ABS_MAX);
        if (nextMax - nextMin < ageWindow) nextMin = clamp(nextMax - ageWindow, ABS_MIN, ABS_MAX);
      } else {
        nextMin = clamp(nextMax - ageWindow, ABS_MIN, ABS_MAX);
        if (nextMax - nextMin < ageWindow) nextMax = clamp(nextMin + ageWindow, ABS_MIN, ABS_MAX);
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
              emitLive(cleaned, maxStr);
              // Once Min has 2 digits: if Max is already set (e.g. editing an
              // existing trip) and the pair is now too close, push Max out to
              // close the gap. Then auto-jump to Max.
              if (cleaned.length === 2) {
                emitNormalized(cleaned, maxStr, 'min');
                maxRef.current?.focus();
              }
            }}
            onFocus={() => setFocused('min')}
            onBlur={() => {
              setFocused(null);
              emitNormalized(minStr, maxStr, 'min');
            }}
            style={styles.cubeInput}
            accessibilityLabel="Minimum age"
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
            onChangeText={t => {
              const cleaned = t.replace(/[^0-9]/g, '');
              setMaxStr(cleaned);
              emitLive(minStr, cleaned);
              // Both fields filled (Min has any digits, Max hit 2 digits).
              // If the typed Max is too close to Min, correct it (push it
              // out to close the gap) but keep the sheet open so the host
              // sees the corrected number land — only auto-dismiss when the
              // typed value was already valid as-is.
              if (cleaned.length === 2) {
                const parsedMin = parseAge(minStr);
                const parsedMax = parseAge(cleaned);
                const needsCorrection =
                  parsedMin != null &&
                  parsedMax != null &&
                  clamp(parsedMax, ABS_MIN, ABS_MAX) - clamp(parsedMin, ABS_MIN, ABS_MAX) < ageWindow;
                emitNormalized(minStr, cleaned, 'max');
                if (!needsCorrection) onClose?.();
              }
            }}
            onFocus={() => setFocused('max')}
            onBlur={() => {
              setFocused(null);
              emitNormalized(minStr, maxStr, 'max');
            }}
            style={styles.cubeInput}
            accessibilityLabel="Maximum age"
          />
        </TouchableOpacity>
      </View>

      {/* "Must span N years" lives on the sheet header as a subtitle now,
          to match the styling of the other sheets. */}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
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
  // borderWidth stays at 2 in both states (color swaps) so the cube's
  // outer dimensions never change between focus states — otherwise the
  // sheet auto-height oscillates by 1-2pt when focus moves Min → Max.
  cube: {
    width: 112,
    minHeight: 104,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 2,
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
  // Focused state: only the border + label colors swap to teal. Same
  // borderWidth as default so layout doesn't shift.
  cubeActive: {
    borderColor: C.brandTeal,
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
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '600',
    color: C.inkBody,
    textAlign: 'center',
    minWidth: 72,
    padding: 0,
    paddingTop: 2,
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
});

export default AgeSheetContent;
