// Central font loading + helper for the app's two typefaces: Inter (body) and
// Montserrat (headings) — the families used across the app and in the Figma
// designs. Loaded at runtime via expo-font so NATIVE renders the real typefaces
// instead of falling back to the system font (San Francisco / Roboto), which
// renders noticeably larger and heavier at the same `fontSize` — the reason
// screens looked "bigger" than Figma.
//
// IMPORTANT (iOS): custom fonts do NOT combine `fontFamily` + `fontWeight`.
// `fontFamily: 'Inter'` + `fontWeight: '700'` renders Inter *Regular* — the
// weight is ignored. So every weight is registered under its own family name
// ('Inter-Bold', etc.) and the `ff()` helper returns that weight-specific name
// on native. On web we keep the CSS family + the style's own fontWeight (the
// browser already has the real fonts).
//
// Going forward — when implementing a Figma screen, set fonts with `ff(family,
// weight)` (NOT a bare `fontFamily: 'Inter'` + `fontWeight`), so the design's
// weights actually render on native.
import { Platform } from 'react-native';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
} from '@expo-google-fonts/montserrat';

/** Load all app font weights. Returns [loaded, error] like expo-font's useFonts. */
export const useAppFonts = () =>
  useFonts({
    'Inter-Regular': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
    'Montserrat-Regular': Montserrat_400Regular,
    'Montserrat-Medium': Montserrat_500Medium,
    'Montserrat-SemiBold': Montserrat_600SemiBold,
    'Montserrat-Bold': Montserrat_700Bold,
  });

export type FontFamily = 'Inter' | 'Montserrat';
export type FontWeight = '400' | '500' | '600' | '700';

const SUFFIX: Record<FontWeight, string> = {
  '400': 'Regular',
  '500': 'Medium',
  '600': 'SemiBold',
  '700': 'Bold',
};

/**
 * Figma-accurate font family string.
 * - Native → weight-specific registered name, e.g. `Inter-Bold` (weight is baked
 *   into the family because iOS ignores `fontWeight` for custom fonts).
 * - Web → CSS family, e.g. `Inter, sans-serif` (pair with the style's fontWeight).
 */
export const ff = (family: FontFamily, weight: FontWeight = '400'): string =>
  Platform.OS === 'web' ? `${family}, sans-serif` : `${family}-${SUFFIX[weight]}`;

/**
 * Android renders a given `fontSize` slightly larger than iOS — a genuine
 * font-metric overshoot (same Inter, bigger glyphs; NOT the user's font-scale,
 * which we disable globally). The overshoot is within tolerance on large text
 * (titles look right at nominal size) but conspicuous on small, tightly-packed
 * text like filter chips. So `fs()` leaves large sizes untouched and tapers
 * only small sizes down, on Android only. iOS + web are returned unchanged.
 *
 * Empirically (Trips tabs): sizes >= 13 look right at nominal; the 12px Explore
 * filter chips read too big. Hence the default band below.
 *
 * Tuning:
 *  - FS_NONE_AT     ↑ to also correct slightly-larger text (e.g. 14) if it reads big.
 *  - FS_FULL_AT     is where the full reduction kicks in (and below).
 *  - FS_SMALL_SCALE ↓ for a stronger shrink on small text.
 */
const FS_FULL_AT = 11;      // Android sizes <= this get the full FS_SMALL_SCALE
const FS_NONE_AT = 13;      // Android sizes >= this are untouched (look right)
const FS_SMALL_SCALE = 0.92;

export const fs = (size: number): number => {
  if (Platform.OS !== 'android') return size;
  if (size >= FS_NONE_AT) return size;
  if (size <= FS_FULL_AT) return size * FS_SMALL_SCALE;
  // Linear taper of the scale from FS_SMALL_SCALE (at FS_FULL_AT) up to 1 (at FS_NONE_AT).
  const t = (size - FS_FULL_AT) / (FS_NONE_AT - FS_FULL_AT);
  return size * (FS_SMALL_SCALE + (1 - FS_SMALL_SCALE) * t);
};
