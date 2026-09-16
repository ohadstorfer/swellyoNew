// Figma type scale, in the MOBILE mode the app's frames use.
//
// Source: Figma file "Swellyo Data Entry App (V.1.3)", collection "Typography",
// mode "Mobile - 800". Read with the Plugin API on 2026-09-15.
//
// Why this file exists: the Typography collection's DEFAULT mode is
// "Desktop - 1440". Tools that don't know a frame's mode (get_design_context,
// Figma's style list) print desktop sizes — Size/lg shows as 20 when the phone
// frame really renders 16. Take sizes from here, never from an export.
//
// Usage:
//   import { textStyles, textStyle } from '../theme/typography';
//   title: { ...textStyles.H6, color: C.ink },
//   label: { ...textStyle('MB1', '700') },   // Body style with a bold override
//
// Every style runs the same recipe as hand-written text in this app:
// ff() for the family, fs() for the size, fontWeight on web only (native bakes
// the weight into the family; passing it on Android adds synthetic bold), and
// includeFontPadding: false.
import { Platform, TextStyle } from 'react-native';
import { ff, fs, FontFamily, FontWeight } from './fonts';

/** Figma `Size/*` variables, mobile mode. Also used as line heights. */
export const fontSize = {
  xxs: 9,
  xs: 10,
  s: 12,
  md: 14,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 24,
  '4xl': 32,
  '5xl': 40,
  '6xl': 48,
} as const;

type StyleSpec = {
  family: FontFamily;
  weight: FontWeight;
  size: number;
  /** undefined = Figma "Auto" line height. */
  lineHeight?: number;
  letterSpacing?: number;
};

// Figma text styles. Names follow Figma: "Body/M B-1" → MB1, "Headings/M H-3" → MH3.
// A line height given as a token is bound to a variable in Figma; a bare number
// is a fixed px (or a % computed against the mobile size) and is the same in every mode.
const SPECS = {
  // Headings — Montserrat Bold
  H1: { family: 'Montserrat', weight: '700', size: fontSize['5xl'], lineHeight: fontSize['6xl'] },
  H2: { family: 'Montserrat', weight: '700', size: fontSize['4xl'], lineHeight: 34.56 }, // 108%
  MH3: { family: 'Montserrat', weight: '700', size: fontSize['3xl'], lineHeight: 28.8, letterSpacing: -1 }, // 120%
  H4: { family: 'Montserrat', weight: '700', size: fontSize['2xl'], lineHeight: 32 },
  MH5: { family: 'Montserrat', weight: '700', size: fontSize.xl, lineHeight: fontSize['3xl'] },
  H6: { family: 'Montserrat', weight: '700', size: fontSize.md, lineHeight: fontSize['2xl'] },
  H7: { family: 'Montserrat', weight: '700', size: fontSize.s, lineHeight: fontSize.lg },

  // Body — Inter Regular
  MB1: { family: 'Inter', weight: '400', size: fontSize.lg, lineHeight: 24 },
  MB2: { family: 'Inter', weight: '400', size: fontSize.md, lineHeight: fontSize.xl },
  B3: { family: 'Inter', weight: '400', size: fontSize.s, lineHeight: 18 },
  B4: { family: 'Inter', weight: '400', size: fontSize.xs, lineHeight: 17 },
  B5: { family: 'Inter', weight: '400', size: fontSize.xxs, lineHeight: 14 },
  Message: { family: 'Inter', weight: '400', size: fontSize.md },
} satisfies Record<string, StyleSpec>;

export type TextStyleName = keyof typeof SPECS;

/** Figma style name → key in `textStyles`. */
export const figmaTextStyle: Record<string, TextStyleName> = {
  'Headings/H-1': 'H1',
  'Headings/H-2': 'H2',
  'Headings/M H-3': 'MH3',
  'Headings/H-4': 'H4',
  'Headings/M H-5': 'MH5',
  'Headings/H-6': 'H6',
  'Headings/H-7': 'H7',
  'Body/M B-1': 'MB1',
  'Body/M B-2': 'MB2',
  'Body/B-3': 'B3',
  'Body/B-4': 'B4',
  'Body/B-5': 'B5',
  'Body/Message': 'Message',
};

const build = ({ family, weight, size, lineHeight, letterSpacing }: StyleSpec): TextStyle => ({
  fontFamily: ff(family, weight),
  fontSize: fs(size),
  ...(lineHeight !== undefined && { lineHeight }),
  ...(letterSpacing !== undefined && { letterSpacing }),
  ...(Platform.OS === 'web' || weight === '400' ? { fontWeight: weight } : null),
  includeFontPadding: false,
});

/**
 * A Figma text style with a different weight. Designers make text bold by
 * overriding the weight on a Regular Body style — size and line height stay the
 * style's own.
 */
export const textStyle = (name: TextStyleName, weight?: FontWeight): TextStyle =>
  build(weight ? { ...SPECS[name], weight } : SPECS[name]);

/** Every Figma text style at its own weight. Spread into a StyleSheet entry. */
export const textStyles = Object.fromEntries(
  (Object.keys(SPECS) as TextStyleName[]).map((name) => [name, build(SPECS[name])]),
) as Record<TextStyleName, TextStyle>;
