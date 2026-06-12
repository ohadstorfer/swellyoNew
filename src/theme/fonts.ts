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
