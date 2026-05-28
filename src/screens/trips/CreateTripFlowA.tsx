// =============================================================================
// CreateTripFlowA — sheet-driven create-trip wizard (May 2026 reshuffle).
//
// New 5-step list (no conditional stay step):
//   1. audience  — "Who is it for?"
//   2. basics    — "Basic deets"
//   3. vibez     — "Trip vibez"            (specific-stay details open via sheet)
//   4. budget    — "Budget"
//   5. preview   — "Preview"
//
// Most inputs are now summary rows that open a WizardBottomSheet. Trip name,
// description, cover photo, and the specific-stay Yes/No gate stay inline.
//
// Persistence, validation, draft autosave, edit-mode rules, and budget estimate
// behavior all preserved from the prior implementation.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  HostingStyle,
  SurfLevel,
  SurfStyle,
  WaveShapeKind,
  CreateGroupTripInput,
  UpdateGroupTripInput,
  GroupTrip,
  TripStructureSlug,
  TripVibeSlug,
  TRIP_STRUCTURE_OPTIONS,
  TRIP_VIBE_OPTIONS,
  createGroupTrip,
  updateGroupTrip,
  setTripDestination,
  estimateTripBudget,
  BudgetEstimate,
} from '../../services/trips/groupTripsService';
import { uploadTripImage } from '../../services/storage/storageService';
import { HomeBreakSearchSheet, HomeBreakSelection } from '../../components/HomeBreakSearchSheet';

// Stream A — chrome + draft + validation + discard guard
import { CreateTripWizardChrome } from '../../components/trips/CreateTripWizardChrome';
import { useTripWizardDraft } from '../../hooks/useTripWizardDraft';
import { useFieldErrors } from '../../hooks/useFieldErrors';
import { useDiscardConfirm } from '../../hooks/useDiscardConfirm';

// Stream A — bottom sheet shell + the new wave-shape slider + big budget cards
import { WizardBottomSheet } from '../../components/trips/WizardBottomSheet';
import { WaveShapeSlider } from '../../components/trips/WaveShapeSlider';
import { BudgetTierCardsBig } from '../../components/trips/BudgetTierCardsBig';

// Sheet content modules
import { LevelsSheetContent } from '../../components/trips/sheets/LevelsSheetContent';
import { WaveSizeSheetContent } from '../../components/trips/sheets/WaveSizeSheetContent';
import { StyleSheetContent } from '../../components/trips/sheets/StyleSheetContent';
import { AgeSheetContent } from '../../components/trips/sheets/AgeSheetContent';
import { WhenSheetContent } from '../../components/trips/sheets/WhenSheetContent';
import { HowItWorksSheetContent } from '../../components/trips/sheets/HowItWorksSheetContent';
import { VibeSheetContent } from '../../components/trips/sheets/VibeSheetContent';
import { StayTypeSheetContent } from '../../components/trips/sheets/StayTypeSheetContent';
import { SpecificStaySheetContent } from '../../components/trips/sheets/SpecificStaySheetContent';

// Existing dependencies still used (preview card)
import { TripPreviewCard } from '../../components/trips/TripPreviewCard';
import { BoardSelectionPreview } from '../../components/trips/BoardSelectionPreview';
import { InfoCard } from '../../components/trips/InfoCard';
import { Images } from '../../assets/images';
import { WaveSheetContent } from '../../components/trips/sheets/WaveSheetContent';

// -----------------------------------------------------------------------------
// Local types / constants
// -----------------------------------------------------------------------------
type AccommodationKind =
  | 'villa'
  | 'hostel'
  | 'hotel'
  | 'surfcamp'
  | 'bungalow'
  | 'apartment'
  | 'guesthouse'
  | 'ecolodge'
  | 'other';
type Visibility = 'public' | 'friends' | 'private';
type BudgetTier = 'low' | 'medium' | 'high';

// Bump 20-char limit per spec.
const TRIP_TITLE_MAX_LENGTH = 20;
const DESCRIPTION_MAX_LENGTH = 500;
const DESCRIPTION_AMBER_THRESHOLD = 450;

// Bump this when WizardState shape changes incompatibly. The draft hook will
// drop drafts whose stored `version` doesn't match. v2 → v3: waveShapes (array)
// became waveShape (single value).
const WIZARD_STATE_VERSION = 3;

// Step KEYS — flat 5-step list, no conditional.
type StepKey = 'audience' | 'basics' | 'vibez' | 'budget' | 'preview';
const STEPS: StepKey[] = ['audience', 'basics', 'vibez', 'budget', 'preview'];

// DB constraint: minimum age-range span per hosting style.
const AGE_WINDOW_BY_STYLE: Record<HostingStyle, number> = { A: 7, B: 5, C: 2 };

// Step heading + subtitle copy.
const STEP_META: Record<StepKey, { title: string; subtitle: string }> = {
  audience: {
    title: 'Who is it for?',
    subtitle: 'The surfers, the levels, the wave.',
  },
  basics: { title: 'Basic deets', subtitle: 'Where, when, what to call it.' },
  vibez: { title: 'Trip vibez', subtitle: 'How it runs, the feel, the stay.' },
  budget: { title: 'Budget', subtitle: 'Per person, in USD.' },
  preview: { title: 'Almost there', subtitle: 'One last look before you publish.' },
};

const SKILL_LEVEL_OPTIONS: { key: SurfLevel; label: string }[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

const BOARD_TYPE_OPTIONS: { key: SurfStyle; label: string }[] = [
  { key: 'shortboard', label: 'Shortboard' },
  { key: 'midlength', label: 'Mid-length' },
  { key: 'softtop', label: 'Soft-top' },
  { key: 'longboard', label: 'Longboard' },
];

const VISIBILITIES: {
  key: Visibility;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'public', title: 'Public', desc: 'Anyone can find it', icon: 'globe-outline' },
  { key: 'friends', title: 'Friends', desc: 'Your connections', icon: 'people-outline' },
  { key: 'private', title: 'Private', desc: 'Invite only', icon: 'lock-closed-outline' },
];

const ACCOMMODATION_LABEL: Record<AccommodationKind, string> = {
  villa: 'Villa',
  hostel: 'Hostel',
  hotel: 'Hotel',
  surfcamp: 'Surf camp',
  bungalow: 'Bungalow',
  apartment: 'Apartment',
  guesthouse: 'Guesthouse',
  ecolodge: 'Eco lodge',
  other: 'Other',
};

const WAVE_SHAPE_TITLE: Record<WaveShapeKind, string> = {
  soft: 'Mellow',
  wally: 'Wally',
  barrel: 'Barrel',
};

// Short month labels used by the When summary value.
const MONTH_SHORT: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

// -----------------------------------------------------------------------------
// Field error keys (per spec). Used as keys in useFieldErrors.
// -----------------------------------------------------------------------------
type FieldKey =
  | 'title'
  | 'description'
  | 'heroImage'
  | 'destination'
  | 'when'
  | 'age'
  | 'skill'
  | 'waveShape'
  | 'accommodationKind'
  | 'accommodationGate'
  | 'specificStay'
  | 'budget';

// Component-only sheet keys (NOT serialized in draft state).
type SheetKey =
  | 'levels'
  | 'wave'        // merged shape + size sheet (Step 1)
  | 'waveSize'   // legacy — kept for back-compat
  | 'waveShape'  // legacy — kept for back-compat
  | 'style'
  | 'age'
  | 'when'
  | 'where'
  | 'howWorks'
  | 'vibe'
  | 'stayType'
  | 'specificStay';

// -----------------------------------------------------------------------------
// Wizard state shape (serializable so it round-trips through AsyncStorage).
// -----------------------------------------------------------------------------
interface WizardState extends Record<string, unknown> {
  version: number;

  // Step 1 — audience
  ageMin: string;
  ageMax: string;
  skillLevels: SurfLevel[];
  waveShape: WaveShapeKind | null;
  waveSizeMin: number;
  waveSizeMax: number;
  surfStyles: SurfStyle[];

  // Step 2 — basics
  destination: string;
  destinationGeo: HomeBreakSelection | null;
  datesMode: 'months' | 'exact';
  monthFrom: string; // YYYY-MM
  monthTo: string;
  startDateISO: string | null;
  endDateISO: string | null;
  durationDays: number | null;
  title: string;
  heroImageUri: string | null;
  description: string;

  // Step 3 — vibez
  tripStructure: TripStructureSlug[];
  tripVibes: TripVibeSlug[];
  accommodationKind: AccommodationKind | null;
  accommodationLocked: boolean | null;

  // Specific-stay details (lives on Step 3 now, opened via sheet).
  accommodationName: string;
  accommodationUrl: string;
  accommodationImageUri: string | null;

  // Step 4 — budget
  budgetTier: BudgetTier | null;
  manualBudget: boolean;
  budgetManualMin: string;
  budgetManualMax: string;

  // Step 5 — preview
  visibility: Visibility;
}

const INITIAL_STATE: WizardState = {
  version: WIZARD_STATE_VERSION,
  // Age has no default — host must enter.
  ageMin: '',
  ageMax: '',
  // Levels default to all 3 → renders "Any" on the card.
  skillLevels: ['beginner', 'intermediate', 'advanced'],
  // Wave defaults: Mellow shape + 2-4 ft size.
  waveShape: 'soft',
  waveSizeMin: 2,
  waveSizeMax: 4,
  // Boards default to all 4 → renders "All" on the card.
  surfStyles: ['shortboard', 'midlength', 'softtop', 'longboard'],
  destination: '',
  destinationGeo: null,
  datesMode: 'months',
  monthFrom: '',
  monthTo: '',
  startDateISO: null,
  endDateISO: null,
  durationDays: null,
  title: '',
  heroImageUri: null,
  description: '',
  tripStructure: [],
  tripVibes: [],
  accommodationKind: null,
  accommodationLocked: null,
  accommodationName: '',
  accommodationUrl: '',
  accommodationImageUri: null,
  budgetTier: null,
  manualBudget: false,
  budgetManualMin: '',
  budgetManualMax: '',
  visibility: 'public',
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
const FONT_INTER = Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter';
const FONT_MONTSERRAT = Platform.OS === 'web' ? 'Montserrat, sans-serif' : 'Montserrat';

const COLORS = {
  brandTeal: '#0788B0',
  brandTealText: '#066b8c',
  brandTealTint: '#E6F4F8',
  cyan: '#05BCD3',
  inkDark: '#212121',
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  textPlaceholder: '#B0B0B0',
  borderField: '#CFCFCF',
  borderCard: '#E0E0E0',
  borderHairline: '#EEEEEE',
  surfaceCard: '#FFFFFF',
  surfaceMuted: '#F2F2F2',
  errorBorder: '#FF0000',
  errorText: '#C0392B',
  errorBg: '#FDECEA',
  success: '#34C759',
  amber: '#E5A100',
};

const startOfDay = (d: Date): Date => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};
const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISODate = (s: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};
const dayCount = (start: Date | null, end: Date | null): number => {
  if (!start || !end) return 0;
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return ms < 0 ? 0 : Math.round(ms / 86400000);
};
const expandMonthRange = (from: string, to: string, cap = 6): string[] => {
  if (!from) return to ? [to] : [];
  if (!to || to === from) return [from];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let start = fy * 12 + (fm - 1);
  let end = ty * 12 + (tm - 1);
  if (end < start) [start, end] = [end, start];
  const out: string[] = [];
  for (let i = start; i <= end && out.length < cap; i++) {
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return out;
};
const formatUsd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const formatRange = (r: { min: number; max: number }) =>
  `${formatUsd(r.min)} – ${formatUsd(r.max)}`;
const isRemoteUrl = (uri: string | null): boolean => !!uri && /^https?:\/\//.test(uri);

// Short label for a YYYY-MM string. Empty input returns ''.
const monthShort = (ym: string): string => {
  if (!ym || ym.length < 7) return '';
  return MONTH_SHORT[ym.slice(5, 7)] ?? '';
};
const monthYear = (ym: string): string => {
  if (!ym || ym.length < 7) return '';
  return ym.slice(0, 4);
};

// Format a YYYY-MM-DD ISO date as "Jun 15, 2027".
const formatLongDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = parseISODate(iso);
  if (!d) return '';
  return `${MONTH_SHORT[String(d.getMonth() + 1).padStart(2, '0')]} ${d.getDate()}, ${d.getFullYear()}`;
};

// -----------------------------------------------------------------------------
// Image picker (mirrors the previous wizard behavior)
// -----------------------------------------------------------------------------
const pickImage = async (aspect: [number, number] = [12, 5]): Promise<string | null> => {
  try {
    const ImagePicker = require('expo-image-picker');
    const usePhotoPicker = Platform.OS === 'android' && Platform.Version >= 33;
    if (!usePhotoPicker) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'We need photo library access to pick an image.');
        return null;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect,
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      return result.assets[0].uri;
    }
  } catch (e) {
    console.error('[CreateTripFlowA] pickImage error:', e);
  }
  return null;
};

// -----------------------------------------------------------------------------
// State <-> GroupTrip mapping
// -----------------------------------------------------------------------------
const stateFromTrip = (trip: GroupTrip): WizardState => {
  const months = trip.date_months ?? [];
  const sorted = [...months].sort();
  const skillLevels = (trip.target_surf_levels ?? []).filter(l =>
    SKILL_LEVEL_OPTIONS.some(s => s.key === l)
  ) as SurfLevel[];
  const firstKind = (trip.accommodation_type ?? []).find(t =>
    Object.keys(ACCOMMODATION_LABEL).includes(t)
  ) as AccommodationKind | undefined;
  // Filter incoming slugs to known values so a stale row can't poison the UI.
  const validStructureSlugs = new Set(TRIP_STRUCTURE_OPTIONS.map(o => o.slug));
  const validVibeSlugs = new Set(TRIP_VIBE_OPTIONS.map(o => o.slug));
  const tripStructure = (trip.trip_structure ?? []).filter((s): s is TripStructureSlug =>
    validStructureSlugs.has(s as TripStructureSlug),
  );
  const tripVibes = (trip.trip_vibes ?? []).filter((v): v is TripVibeSlug =>
    validVibeSlugs.has(v as TripVibeSlug),
  );
  const validWaveShapes = (trip.wave_shapes ?? []).filter(w =>
    ['soft', 'wally', 'barrel'].includes(w as string)
  ) as WaveShapeKind[];
  return {
    version: WIZARD_STATE_VERSION,
    ageMin: trip.age_min != null ? String(trip.age_min) : '',
    ageMax: trip.age_max != null ? String(trip.age_max) : '',
    skillLevels,
    // Trip rows still store an array; we keep the first entry as the single value.
    waveShape: validWaveShapes[0] ?? null,
    waveSizeMin: trip.wave_size_min ?? 4,
    waveSizeMax: trip.wave_size_max ?? 8,
    surfStyles: (trip.target_surf_styles ?? []).filter(s =>
      BOARD_TYPE_OPTIONS.some(b => b.key === s)
    ) as SurfStyle[],
    destination:
      trip.destination_area?.trim() ||
      trip.destination_country?.trim() ||
      '',
    destinationGeo: null,
    datesMode: trip.start_date ? 'exact' : 'months',
    monthFrom: sorted[0] ?? '',
    monthTo: sorted.length > 1 ? sorted[sorted.length - 1] : '',
    startDateISO: trip.start_date ?? null,
    endDateISO: trip.end_date ?? null,
    durationDays: null,
    title: trip.title ?? '',
    heroImageUri: trip.hero_image_url ?? null,
    description: trip.description ?? '',
    tripStructure,
    tripVibes,
    accommodationKind: firstKind ?? null,
    accommodationLocked: trip.accommodation_name ? true : false,
    accommodationName: trip.accommodation_name ?? '',
    accommodationUrl: trip.accommodation_url ?? '',
    accommodationImageUri: trip.accommodation_image_url ?? null,
    budgetTier: null,
    // Edit mode skips the estimate; preload manual.
    manualBudget: true,
    budgetManualMin: trip.budget_min != null ? String(trip.budget_min) : '',
    budgetManualMax: trip.budget_max != null ? String(trip.budget_max) : '',
    visibility: (trip.visibility as Visibility) ?? 'public',
  };
};

// -----------------------------------------------------------------------------
// Summary-row helper
// -----------------------------------------------------------------------------
interface SummaryRowProps {
  label: string;
  value?: string | null;
  placeholder?: string;
  onPress: () => void;
  error?: string;
  optional?: boolean;
  disabled?: boolean;
  /** When true, the top divider is hidden (use on the first row of a group). */
  noTopDivider?: boolean;
}

const SummaryRow: React.FC<SummaryRowProps> = ({
  label,
  value,
  placeholder = 'Tap to set',
  onPress,
  error,
  optional,
  disabled,
  noTopDivider,
}) => {
  const hasValue = !!(value && value.trim().length > 0);
  const [pressed, setPressed] = useState(false);
  return (
    <View>
      {!noTopDivider ? <View style={rowStyles.divider} /> : null}
      <TouchableOpacity
        activeOpacity={1}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => !disabled && setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${hasValue ? value : placeholder}`}
        style={[
          rowStyles.row,
          pressed && rowStyles.rowPressed,
          !!error && rowStyles.rowError,
          disabled && rowStyles.rowDisabled,
        ]}
      >
        <Text style={[rowStyles.label, disabled && rowStyles.labelDisabled]}>{label}</Text>
        <View style={rowStyles.valueWrap}>
          {hasValue ? (
            <Text
              style={[rowStyles.value, disabled && rowStyles.valueDisabled]}
              numberOfLines={1}
            >
              {value}
            </Text>
          ) : optional ? (
            <Text style={rowStyles.placeholderOptional} numberOfLines={1}>
              Optional · Tap to set
            </Text>
          ) : (
            <Text style={rowStyles.placeholder} numberOfLines={1}>
              {placeholder}
            </Text>
          )}
          <Ionicons
            name="chevron-forward"
            size={18}
            color={disabled ? COLORS.textPlaceholder : COLORS.textMuted}
            style={{ marginLeft: 8 }}
          />
        </View>
      </TouchableOpacity>
      {error ? <Text style={rowStyles.error}>{error}</Text> : null}
    </View>
  );
};

const rowStyles = StyleSheet.create({
  // Hairline at the top of each row creates a clean list rhythm without
  // boxing every row in a 1px border.
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.borderHairline,
    marginHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: COLORS.surfaceCard,
    borderRadius: 10,
  },
  rowPressed: {
    backgroundColor: '#F8FAFB',
  },
  rowError: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.errorBorder,
    paddingLeft: 9,
  },
  rowDisabled: {
    opacity: 0.6,
  },
  label: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.inkBody,
    marginRight: 12,
    flexShrink: 0,
  },
  labelDisabled: {
    color: COLORS.textMuted,
  },
  valueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  value: {
    flex: 1,
    textAlign: 'right',
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.inkBody,
  },
  valueDisabled: {
    color: COLORS.textMuted,
  },
  placeholder: {
    flex: 1,
    textAlign: 'right',
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.textPlaceholder,
  },
  placeholderOptional: {
    flex: 1,
    textAlign: 'right',
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.textMuted,
  },
  error: {
    marginTop: 4,
    marginLeft: 12,
    marginBottom: 4,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: COLORS.errorText,
  },
});

// -----------------------------------------------------------------------------
// Summary value formatters
// -----------------------------------------------------------------------------
const formatLevelsSummary = (levels: SurfLevel[]): string => {
  if (levels.length === 0) return '';
  // Real selectable levels are beginner / intermediate / advanced (3).
  // When all 3 are selected → collapse to "Any" for a clean value display.
  const realLevels = levels.filter(l => l !== 'all' && l !== 'pro');
  if (realLevels.length >= 3) return 'Any';
  // Stack level names vertically (one per line).
  return realLevels
    .map(k => SKILL_LEVEL_OPTIONS.find(o => o.key === k)?.label ?? k)
    .join('\n');
};

const formatWaveSizeSummary = (min: number, max: number): string => {
  if (min === max) return `${min} ft`;
  return `${min} – ${max} ft`;
};

const formatStyleSummary = (styles: SurfStyle[]): string => {
  if (styles.length === 0) return '';
  // Real selectable types are shortboard / midlength / softtop / longboard (4).
  // When the host picks all 4 → collapse to "All" for a clean value display.
  const realStyles = styles.filter(s => s !== 'all');
  if (realStyles.length >= 4) return 'All';
  // Stack board names vertically (one per line) — per Eyal's spec.
  return realStyles
    .map(k => BOARD_TYPE_OPTIONS.find(o => o.key === k)?.label ?? k)
    .join('\n');
};

const formatAgeSummary = (min: string, max: string): string => {
  if (!min || !max) return '';
  return `${min} - ${max}`;
};

const formatWhenSummary = (state: WizardState): string => {
  if (state.datesMode === 'exact') {
    if (!state.startDateISO) return '';
    const start = state.startDateISO;
    const end = state.endDateISO;
    const startD = parseISODate(start);
    const endD = parseISODate(end);
    const days = dayCount(startD, endD);
    if (!end || !endD) {
      return formatLongDate(start);
    }
    const startMonthDay = `${MONTH_SHORT[String(startD!.getMonth() + 1).padStart(2, '0')]} ${startD!.getDate()}`;
    const endMonthDay = `${MONTH_SHORT[String(endD.getMonth() + 1).padStart(2, '0')]} ${endD.getDate()}`;
    const endYear = endD.getFullYear();
    // Specific dates already encode the length — no need to show " · N days".
    return `${startMonthDay} – ${endMonthDay}, ${endYear}`;
  }
  // months mode
  const from = state.monthFrom;
  const to = state.monthTo;
  const days = state.durationDays ?? 0;
  if (!from && !to) {
    if (days > 0) return `${days} day${days === 1 ? '' : 's'}`;
    return '';
  }
  if (from && !to) {
    const part = `${monthShort(from)} ${monthYear(from)}`.trim();
    if (days > 0) return `${part} · ${days} day${days === 1 ? '' : 's'}`;
    return part;
  }
  if (from && to) {
    const sameYear = monthYear(from) === monthYear(to);
    const part = sameYear
      ? `${monthShort(from)} – ${monthShort(to)} ${monthYear(to)}`
      : `${monthShort(from)} ${monthYear(from)} – ${monthShort(to)} ${monthYear(to)}`;
    if (days > 0) return `${part} · ${days} day${days === 1 ? '' : 's'}`;
    return part;
  }
  return '';
};

const formatTagsSummary = <T extends string>(
  selected: T[],
  options: { slug: T; label: string }[],
  truncateAt = 2,
): string => {
  if (selected.length === 0) return '';
  const labels = selected
    .map(s => options.find(o => o.slug === s)?.label ?? s)
    // Some labels have an em-dash with extra context — keep just the head.
    .map(l => l.split(' — ')[0].split(' – ')[0]);
  if (labels.length <= truncateAt) return labels.join(', ');
  const head = labels.slice(0, truncateAt).join(', ');
  return `${head} +${labels.length - truncateAt}`;
};

const formatSpecificStaySummary = (state: WizardState): string => {
  const parts: string[] = [];
  if (state.accommodationName.trim()) parts.push(state.accommodationName.trim());
  if (state.accommodationUrl.trim()) parts.push('URL set');
  if (state.accommodationImageUri) parts.push('Photo set');
  return parts.join(' · ');
};

// =============================================================================
// Component
// =============================================================================
export interface CreateTripFlowAProps {
  hostId: string | null;
  onCreated: () => void;
  onCancel: () => void;
  initialTrip?: GroupTrip;
  hostingStyle?: HostingStyle;
}

export default function CreateTripFlowA({
  hostId,
  onCreated,
  onCancel,
  initialTrip,
  hostingStyle = 'A',
}: CreateTripFlowAProps): React.ReactElement {
  const editMode = !!initialTrip;
  const effectiveStyle: HostingStyle = initialTrip?.hosting_style ?? hostingStyle;
  const ageWindow = AGE_WINDOW_BY_STYLE[effectiveStyle];

  // ---- Wizard state (draft-backed) ----------------------------------------
  const initialState = useMemo<WizardState>(
    () => (initialTrip ? stateFromTrip(initialTrip) : INITIAL_STATE),
    // initialTrip is stable for the wizard's lifetime; intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const { state, setState, hasRestoredDraft, clearDraft, startSaving } =
    useTripWizardDraft<WizardState>(initialState, {
      editMode,
      tripId: initialTrip?.id ?? null,
    });

  // ---- Validation registry ------------------------------------------------
  const { errors, setError, clearErrors, firstErrorField } = useFieldErrors<FieldKey>();

  // ---- Step navigation ---------------------------------------------------
  const [step, setStep] = useState<StepKey>('audience');
  const stepIdx = useMemo(() => Math.max(0, STEPS.indexOf(step)), [step]);

  // ---- Sheet management --------------------------------------------------
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);

  // ---- Dirty tracking (drives discard-confirm prompt) ---------------------
  const [hasBeenTouched, setHasBeenTouched] = useState(false);
  const draftStartedRef = useRef(false);

  // ---- Submit / budget UI state ------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [showResumeBanner, setShowResumeBanner] = useState(false);

  // Budget estimate (transient — not persisted)
  const [budgetEstimate, setBudgetEstimate] = useState<BudgetEstimate | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [lastEstimateKey, setLastEstimateKey] = useState<string | null>(null);

  // Show the resume banner whenever a draft restore is detected — but if the
  // restored draft is from a stale schema version, drop it instead.
  useEffect(() => {
    if (!hasRestoredDraft) return;
    const v = (state as WizardState).version;
    if (v !== WIZARD_STATE_VERSION) {
      void clearDraft();
      setState(initialState);
      setShowResumeBanner(false);
      return;
    }
    setShowResumeBanner(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRestoredDraft]);

  // -----------------------------------------------------------------------
  // Helpers tied to component scope
  // -----------------------------------------------------------------------
  const update = useCallback(
    <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
      setState(prev => ({ ...prev, [key]: value }));
      if (!hasBeenTouched) setHasBeenTouched(true);
    },
    [setState, hasBeenTouched],
  );

  const startDateObj = useMemo(() => parseISODate(state.startDateISO), [state.startDateISO]);
  const endDateObj = useMemo(() => parseISODate(state.endDateISO), [state.endDateISO]);

  // -----------------------------------------------------------------------
  // Budget estimate
  // -----------------------------------------------------------------------
  const tripDurationDays = useCallback((): number => {
    if (state.datesMode === 'exact') {
      const d = dayCount(startDateObj, endDateObj);
      return d > 0 ? d : 0;
    }
    return state.durationDays ?? 0;
  }, [state.datesMode, state.durationDays, startDateObj, endDateObj]);

  const estimateKey = useCallback(() => {
    return [
      state.destination,
      state.destinationGeo?.country ?? '',
      tripDurationDays(),
      state.accommodationKind ?? '',
    ].join('|');
  }, [state.destination, state.destinationGeo, state.accommodationKind, tripDurationDays]);

  const maybeEstimateBudget = useCallback(async () => {
    if (editMode) return;
    const key = estimateKey();
    if (budgetEstimate && lastEstimateKey === key && !budgetError) return;

    const durationDays = tripDurationDays();
    const destination =
      state.destinationGeo?.short || state.destinationGeo?.name || state.destination;
    if (!destination || durationDays < 1) {
      setBudgetError('Missing trip details');
      setBudgetEstimate(null);
      return;
    }

    setBudgetLoading(true);
    setBudgetError(null);
    try {
      const est = await estimateTripBudget({
        destination,
        country: state.destinationGeo?.country ?? null,
        formattedAddress: state.destinationGeo?.full ?? null,
        durationDays,
        accommodationType: state.accommodationKind ?? null,
      });
      setBudgetEstimate(est);
      setLastEstimateKey(key);
    } catch (e: any) {
      console.warn('[CreateTripFlowA] budget estimate failed:', e);
      setBudgetError(e?.message || 'Could not estimate budget');
      setBudgetEstimate(null);
    } finally {
      setBudgetLoading(false);
    }
  }, [
    editMode,
    estimateKey,
    budgetEstimate,
    lastEstimateKey,
    budgetError,
    tripDurationDays,
    state.destination,
    state.destinationGeo,
    state.accommodationKind,
  ]);

  const resolveBudget = useCallback((): {
    min: number | null;
    max: number | null;
    currency: string | null;
  } => {
    if (budgetEstimate && state.budgetTier && !state.manualBudget) {
      const r = budgetEstimate.ranges[state.budgetTier];
      return { min: Math.round(r.min), max: Math.round(r.max), currency: 'USD' };
    }
    const min = state.budgetManualMin ? parseInt(state.budgetManualMin, 10) : null;
    const max = state.budgetManualMax ? parseInt(state.budgetManualMax, 10) : null;
    return { min, max, currency: min != null || max != null ? 'USD' : null };
  }, [
    budgetEstimate,
    state.budgetTier,
    state.manualBudget,
    state.budgetManualMin,
    state.budgetManualMax,
  ]);

  // -----------------------------------------------------------------------
  // Validation — per-step. Returns true if step is valid (no errors emitted).
  // -----------------------------------------------------------------------
  const validateStep = useCallback((): boolean => {
    clearErrors();
    let ok = true;
    const fail = (field: FieldKey, msg: string) => {
      setError(field, msg);
      ok = false;
    };

    switch (step) {
      case 'audience': {
        const min = parseInt(state.ageMin, 10);
        const max = parseInt(state.ageMax, 10);
        if (Number.isNaN(min) || Number.isNaN(max)) {
          fail('age', 'Add a minimum and maximum age');
        } else if (min < 16 || max > 99 || min > 99 || max < 16) {
          fail('age', 'Ages must be 16–99');
        } else if (max < min) {
          fail('age', 'Maximum age must be at least the minimum');
        } else if (max - min < ageWindow) {
          fail(
            'age',
            `Age range must span at least ${ageWindow} years (currently ${max - min}).`,
          );
        }
        if (state.skillLevels.length === 0) fail('skill', 'Pick at least one skill level');
        if (state.waveShape === null) fail('waveShape', 'Pick a wave shape');
        return ok;
      }
      case 'basics': {
        if (!editMode && !state.destination.trim())
          fail('destination', 'Pick a destination for your trip');

        if (state.datesMode === 'months') {
          if (!state.monthFrom) fail('when', 'Pick at least one month for your trip');
          else if (!state.durationDays || state.durationDays < 1)
            fail('when', 'Pick a trip length');
        } else {
          if (!state.startDateISO) fail('when', 'Pick a start date');
          else if (
            state.endDateISO &&
            startDateObj &&
            endDateObj &&
            startOfDay(endDateObj) < startOfDay(startDateObj)
          ) {
            fail('when', 'End date must be on or after the start date');
          }
        }

        if (!state.title.trim()) fail('title', 'Your trip needs a name');
        if (!state.heroImageUri) fail('heroImage', 'Add a cover photo to publish your trip');
        if (!state.description.trim())
          fail('description', 'Add a description so people know what to expect');
        return ok;
      }
      case 'vibez': {
        if (!state.accommodationKind) fail('accommodationKind', 'Pick an accommodation type');
        if (state.accommodationLocked === null)
          fail('accommodationGate', 'Choose yes or no');
        if (state.accommodationLocked === true) {
          // All three details required when the gate is Yes.
          if (
            !state.accommodationName.trim() ||
            !state.accommodationUrl.trim() ||
            !state.accommodationImageUri
          ) {
            fail('specificStay', 'Add the stay name, link, and a photo');
          }
        }
        return ok;
      }
      case 'budget': {
        const usingManual = state.manualBudget || !budgetEstimate;
        if (usingManual) {
          if (!state.budgetManualMin || !state.budgetManualMax) {
            fail('budget', 'Enter both a minimum and maximum');
            return ok;
          }
          const mn = parseInt(state.budgetManualMin, 10);
          const mx = parseInt(state.budgetManualMax, 10);
          if (Number.isNaN(mn) || Number.isNaN(mx) || mn < 0 || mx < 0) {
            fail('budget', 'Enter both a minimum and maximum');
          } else if (mn > mx) {
            fail('budget', 'Maximum must be at least the minimum');
          }
        } else {
          if (!state.budgetTier) fail('budget', 'Pick a budget tier or enter a range');
        }
        return ok;
      }
      case 'preview':
        return true;
    }
  }, [
    step,
    state,
    editMode,
    ageWindow,
    startDateObj,
    endDateObj,
    budgetEstimate,
    clearErrors,
    setError,
  ]);

  // -----------------------------------------------------------------------
  // Navigation handlers
  // -----------------------------------------------------------------------
  const handleNext = useCallback(() => {
    if (!validateStep()) return;

    // First successful Next → enable draft autosave.
    if (!draftStartedRef.current && !editMode) {
      draftStartedRef.current = true;
      startSaving();
      setHasBeenTouched(true);
    }

    const idx = STEPS.indexOf(step);
    const next = STEPS[idx + 1];
    if (!next) return;
    if (next === 'budget' && !editMode) {
      void maybeEstimateBudget();
    }
    setStep(next);
  }, [validateStep, step, editMode, startSaving, maybeEstimateBudget]);

  const handleBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx <= 0) return;
    setStep(STEPS[idx - 1]);
  }, [step]);

  // Discard guard — only triggers if the user has interacted with the form.
  const { guardedCancel } = useDiscardConfirm({
    dirty: hasBeenTouched,
    onDiscard: async () => {
      await clearDraft();
      onCancel();
    },
  });

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (!validateStep()) return;
    if (!hostId) {
      Alert.alert('Not signed in', 'Please sign in again.');
      return;
    }
    setSubmitting(true);
    try {
      // Hero image upload (skip if it's already remote).
      let heroUrl: string;
      if (isRemoteUrl(state.heroImageUri)) {
        heroUrl = state.heroImageUri!;
      } else {
        const heroRes = await uploadTripImage(state.heroImageUri!, hostId, 'hero');
        if (!heroRes.success || !heroRes.url) {
          throw new Error(heroRes.error || 'Failed to upload hero image');
        }
        heroUrl = heroRes.url;
      }

      // Accommodation photo upload (only when host locked in a stay).
      const accommodationCommitted = state.accommodationLocked === true;
      let accommodationImageUrl: string | null = null;
      if (accommodationCommitted && state.accommodationImageUri) {
        if (isRemoteUrl(state.accommodationImageUri)) {
          accommodationImageUrl = state.accommodationImageUri;
        } else {
          const accRes = await uploadTripImage(
            state.accommodationImageUri,
            hostId,
            'accommodation',
          );
          if (!accRes.success || !accRes.url) {
            throw new Error(accRes.error || 'Failed to upload accommodation photo');
          }
          accommodationImageUrl = accRes.url;
        }
      }

      const exactDates = state.datesMode === 'exact';
      const dateMonths = exactDates ? [] : expandMonthRange(state.monthFrom, state.monthTo);
      const startISO = exactDates && startDateObj ? toISODate(startDateObj) : null;
      const endISO = exactDates && endDateObj ? toISODate(endDateObj) : null;
      const skillLevels: SurfLevel[] = state.skillLevels.length
        ? state.skillLevels
        : (['all'] as SurfLevel[]);
      const budget = resolveBudget();
      const descriptionText = state.description.trim();
      // DB still expects an array of wave shapes — wrap our single value.
      const waveShapesArray: WaveShapeKind[] | null = state.waveShape
        ? [state.waveShape]
        : null;

      if (editMode && initialTrip) {
        const editable: UpdateGroupTripInput = {
          title: state.title.trim() || null,
          description: descriptionText,
          hero_image_url: heroUrl,
          start_date: startISO,
          end_date: endISO,
          dates_set_in_stone: exactDates ? true : null,
          date_months: dateMonths.length ? dateMonths : null,
          age_min: parseInt(state.ageMin, 10),
          age_max: parseInt(state.ageMax, 10),
          target_surf_levels: skillLevels,
          accommodation_type: state.accommodationKind ? [state.accommodationKind] : null,
          accommodation_name: accommodationCommitted
            ? state.accommodationName.trim() || null
            : null,
          accommodation_url: accommodationCommitted
            ? state.accommodationUrl.trim() || null
            : null,
          accommodation_image_url: accommodationCommitted ? accommodationImageUrl : null,
          budget_min: budget.min,
          budget_max: budget.max,
          budget_currency: budget.currency,
          trip_structure: state.tripStructure.length ? state.tripStructure : null,
          trip_vibes: state.tripVibes.length ? state.tripVibes : null,
          wave_type: null,
          wave_shapes: waveShapesArray,
          wave_size_min: state.waveSizeMin,
          wave_size_max: state.waveSizeMax,
          target_surf_styles: state.surfStyles.length ? state.surfStyles : ['all'],
          surf_style: null,
          accommodation_status: null,
          visibility: state.visibility,
        };
        await updateGroupTrip(initialTrip.id, editable);
      } else {
        const input: CreateGroupTripInput = {
          hosting_style: hostingStyle,
          status: 'active',
          title: state.title.trim() || null,
          description: descriptionText,
          hero_image_url: heroUrl,

          start_date: startISO,
          end_date: endISO,
          dates_set_in_stone: exactDates ? true : null,
          date_months: dateMonths.length ? dateMonths : null,

          destination_country: state.destination.trim() || null,
          destination_area: null,
          destination_spot: null,

          accommodation_type: state.accommodationKind ? [state.accommodationKind] : null,
          accommodation_name: accommodationCommitted
            ? state.accommodationName.trim() || null
            : null,
          accommodation_url: accommodationCommitted
            ? state.accommodationUrl.trim() || null
            : null,
          accommodation_image_url: accommodationCommitted ? accommodationImageUrl : null,

          vibe: null,
          surf_spots: null,

          age_min: parseInt(state.ageMin, 10),
          age_max: parseInt(state.ageMax, 10),
          target_surf_levels: skillLevels,
          target_surf_styles: state.surfStyles.length ? state.surfStyles : ['all'],
          wave_shapes: waveShapesArray,
          wave_size_min: state.waveSizeMin,
          wave_size_max: state.waveSizeMax,

          host_been_there: null,
          budget_min: budget.min,
          budget_max: budget.max,
          budget_currency: budget.currency,

          trip_structure: state.tripStructure.length ? state.tripStructure : null,
          trip_vibes: state.tripVibes.length ? state.tripVibes : null,
          wave_type: null,
          included_components: null,
          total_cost: null,
          cost_per_person: null,
          price_includes: null,

          surf_style: null,
          accommodation_status: null,
          visibility: state.visibility,

          packing_list: [],
          group_packing_list: [],
        };
        const trip = await createGroupTrip(hostId, input);

        if (state.destinationGeo) {
          const g = state.destinationGeo;
          try {
            await setTripDestination(trip.id, {
              place_id: g.placeId ?? null,
              name: g.name ?? null,
              short_label: g.short ?? null,
              formatted_address: g.full ?? null,
              locality: g.locality ?? null,
              country: g.country ?? null,
              lat: g.lat ?? null,
              lng: g.lng ?? null,
            });
          } catch (geoErr) {
            console.warn('[CreateTripFlowA] setTripDestination failed:', geoErr);
          }
        }

        await clearDraft();
      }
      onCreated();
    } catch (e: any) {
      console.error('[CreateTripFlowA] submit error:', e);
      Alert.alert(
        editMode ? 'Could not save trip' : 'Could not publish',
        e?.message || 'Unknown error',
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    validateStep,
    hostId,
    state,
    editMode,
    initialTrip,
    hostingStyle,
    startDateObj,
    endDateObj,
    resolveBudget,
    clearDraft,
    onCreated,
  ]);

  // -----------------------------------------------------------------------
  // Primary / secondary button handlers
  // -----------------------------------------------------------------------
  const onPrimary = useCallback(() => {
    if (step === 'preview') {
      void handleSubmit();
    } else {
      handleNext();
    }
  }, [step, handleSubmit, handleNext]);

  const onSecondary = useCallback(() => {
    if (stepIdx === 0) {
      guardedCancel();
    } else {
      handleBack();
    }
  }, [stepIdx, guardedCancel, handleBack]);

  // CTA label per step (per spec).
  const ctaLabel: string = useMemo(() => {
    if (step === 'preview') return editMode ? 'Save changes' : 'Publish trip';
    if (step === 'audience') return 'Next · basic deets';
    if (step === 'basics') return 'Next · trip vibez';
    if (step === 'vibez') return 'Next · budget';
    if (step === 'budget') return 'Next · preview';
    return 'Next';
  }, [step, editMode]);

  const meta = STEP_META[step];
  const subtitle =
    step === 'budget' && editMode ? 'Confirm the range for your trip.' : meta.subtitle;

  const renderStep = () => {
    switch (step) {
      case 'audience':
        return renderAudienceStep();
      case 'basics':
        return renderBasicsStep();
      case 'vibez':
        return renderVibezStep();
      case 'budget':
        return renderBudgetStep();
      case 'preview':
        return renderPreviewStep();
    }
  };

  // -----------------------------------------------------------------------
  // STEP 1 — AUDIENCE (all rows open sheets)
  // -----------------------------------------------------------------------
  const renderResumeBanner = () =>
    showResumeBanner ? (
      <View style={localStyles.resumeBanner}>
        <View style={localStyles.resumeBannerIconWrap}>
          <Ionicons name="bookmark-outline" size={18} color={COLORS.brandTeal} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={localStyles.resumeBannerTitle}>Pick up where you left off?</Text>
          <Text style={localStyles.resumeBannerBody}>Your unsaved draft was restored.</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Start fresh"
          onPress={async () => {
            await clearDraft();
            setState(INITIAL_STATE);
            setShowResumeBanner(false);
            setHasBeenTouched(false);
            draftStartedRef.current = false;
            clearErrors();
          }}
          style={localStyles.resumeBannerBtn}
        >
          <Text style={localStyles.resumeBannerBtnText}>Start fresh</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => setShowResumeBanner(false)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ marginLeft: 8 }}
        >
          <Ionicons name="close" size={20} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>
    ) : null;

  const renderAudienceStep = () => {
    // The Wave card combines shape + size into a single value per the Figma:
    // "Wally, 4 - 8 ft".
    const waveValue = (() => {
      const shape = state.waveShape ? WAVE_SHAPE_TITLE[state.waveShape] : '';
      const size =
        state.waveSizeMin === state.waveSizeMax
          ? `${state.waveSizeMin} ft`
          : `${state.waveSizeMin} - ${state.waveSizeMax} ft`;
      if (!shape) return size;
      return `${shape}, ${size}`;
    })();
    const waveError = errors.waveShape ?? undefined;

    return (
      <View>
        {renderResumeBanner()}
        <View style={localStyles.cardStack}>
          {/* Top row — two narrow side-by-side cards (Figma node 12216:25261). */}
          <View style={localStyles.topRow}>
            <InfoCard
              title="Surf Level"
              variant="photo-top"
              value={formatLevelsSummary(state.skillLevels)}
              image={Images.whoIsItFor.surfLevel}
              imageZoom={1.4}
              onPress={() => setOpenSheet('levels')}
            />
            <InfoCard
              title="Board Style"
              variant="photo-bottom"
              value={formatStyleSummary(state.surfStyles)}
              imageContent={
                <BoardSelectionPreview
                  selected={state.surfStyles}
                  height={272}
                  embedded
                />
              }
              onPress={() => setOpenSheet('style')}
            />
          </View>

          {/* Bottom — full-width horizontal cards. */}
          <InfoCard
            title="The Wave"
            value={waveValue}
            image={Images.whoIsItFor.theWave}
            onPress={() => setOpenSheet('wave')}
          />
          {waveError ? (
            <Text style={localStyles.cardError}>{waveError}</Text>
          ) : null}
          <InfoCard
            title="Age Range"
            value={formatAgeSummary(state.ageMin, state.ageMax)}
            image={Images.whoIsItFor.ageRange}
            imageZoom={1.4}
            onPress={() => setOpenSheet('age')}
          />
        </View>
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // STEP 2 — BASICS (mixed sheets + inline)
  // -----------------------------------------------------------------------
  const renderBasicsStep = () => {
    const titleLen = state.title.length;
    const titleCounterColor =
      titleLen >= TRIP_TITLE_MAX_LENGTH
        ? COLORS.errorText
        : titleLen >= TRIP_TITLE_MAX_LENGTH - 5
          ? COLORS.amber
          : COLORS.textMuted;

    const descLen = state.description.length;
    const descCounterColor =
      descLen >= DESCRIPTION_MAX_LENGTH
        ? COLORS.errorText
        : descLen >= DESCRIPTION_AMBER_THRESHOLD
          ? COLORS.amber
          : COLORS.textMuted;

    return (
      <View>
        {/* Where + When grouped */}
        <View style={localStyles.summaryGroup}>
          <SummaryRow
            label="Where?"
            value={state.destination}
            placeholder={editMode ? 'Locked' : 'Tap to set'}
            onPress={() => {
              if (!editMode) setOpenSheet('where');
            }}
            error={errors.destination ?? undefined}
            disabled={editMode}
            noTopDivider
          />
          <SummaryRow
            label="When?"
            value={formatWhenSummary(state)}
            onPress={() => setOpenSheet('when')}
            error={errors.when ?? undefined}
          />
        </View>
        {editMode ? (
          <Text style={localStyles.helperRowFootnote}>
            Destination can't be changed after a trip is created.
          </Text>
        ) : null}

        {/* Trip name (inline) */}
        <View style={[localStyles.labelRow, localStyles.groupTopGap]}>
          <Text style={localStyles.fieldLabel}>Trip name</Text>
          <Text style={[localStyles.counter, { color: titleCounterColor }]}>
            {titleLen} / {TRIP_TITLE_MAX_LENGTH}
          </Text>
        </View>
        <TextInput
          style={[localStyles.input, !!errors.title && localStyles.inputError]}
          value={state.title}
          onChangeText={t => {
            update('title', t);
            if (errors.title) setError('title', null);
          }}
          placeholder="Bali and Barrels"
          placeholderTextColor={COLORS.textPlaceholder}
          maxLength={TRIP_TITLE_MAX_LENGTH}
          returnKeyType="done"
        />
        {errors.title ? (
          <Text style={localStyles.errorText}>{errors.title}</Text>
        ) : null}

        {/* Cover photo (inline) */}
        <Text style={[localStyles.fieldLabel, localStyles.fieldTopGap]}>Cover photo</Text>
        <Text style={localStyles.helper}>
          Landscape looks best — we'll crop to 12:5.
        </Text>
        <TouchableOpacity
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={state.heroImageUri ? 'Change cover photo' : 'Add cover photo'}
          onLongPress={() => {
            if (!state.heroImageUri) return;
            Alert.alert('Remove cover photo?', '', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: () => update('heroImageUri', null),
              },
            ]);
          }}
          onPress={async () => {
            const uri = await pickImage([12, 5]);
            if (uri) {
              update('heroImageUri', uri);
              if (errors.heroImage) setError('heroImage', null);
            }
          }}
          style={[
            localStyles.photoZone,
            !state.heroImageUri && localStyles.photoZoneEmpty,
            !!errors.heroImage && localStyles.photoZoneError,
          ]}
        >
          {state.heroImageUri ? (
            <>
              <Image source={{ uri: state.heroImageUri }} style={localStyles.photoFilled} />
              <View style={localStyles.photoChangePill}>
                <Ionicons name="camera-reverse-outline" size={14} color="#FFFFFF" />
                <Text style={localStyles.photoChangePillText}>Change</Text>
              </View>
            </>
          ) : (
            <View style={localStyles.photoEmptyInner}>
              <View style={localStyles.photoIconCircle}>
                <Ionicons name="camera-outline" size={26} color={COLORS.brandTeal} />
              </View>
              <Text style={localStyles.photoEmptyText}>Tap to add cover photo</Text>
              <Text style={localStyles.photoEmptyHint}>Long-press to remove later</Text>
            </View>
          )}
        </TouchableOpacity>
        {errors.heroImage ? <Text style={localStyles.errorText}>{errors.heroImage}</Text> : null}

        {/* Description (inline) */}
        <View style={[localStyles.labelRow, localStyles.fieldTopGap]}>
          <Text style={localStyles.fieldLabel}>Description</Text>
          <Text style={[localStyles.counter, { color: descCounterColor }]}>
            {descLen} / {DESCRIPTION_MAX_LENGTH}
          </Text>
        </View>
        <TextInput
          style={[
            localStyles.input,
            localStyles.textarea,
            !!errors.description && localStyles.inputError,
          ]}
          value={state.description}
          onChangeText={t => {
            const next = t.length > DESCRIPTION_MAX_LENGTH
              ? t.slice(0, DESCRIPTION_MAX_LENGTH)
              : t;
            update('description', next);
            if (errors.description) setError('description', null);
          }}
          placeholder="Tell people what makes this trip special — the surf, the crew, the place."
          placeholderTextColor={COLORS.textPlaceholder}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          maxLength={DESCRIPTION_MAX_LENGTH}
        />
        <Text style={localStyles.helper}>Required · up to 500 characters.</Text>
        {errors.description ? (
          <Text style={localStyles.errorText}>{errors.description}</Text>
        ) : null}
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // STEP 3 — VIBEZ (sheets + inline Yes/No gate + conditional details row)
  // -----------------------------------------------------------------------
  const renderVibezStep = () => {
    const lockedAnswer = state.accommodationLocked;
    const canToggle = !editMode;

    return (
      <View>
        <View style={localStyles.summaryGroup}>
          <SummaryRow
            label="How it works"
            value={formatTagsSummary(state.tripStructure, TRIP_STRUCTURE_OPTIONS)}
            onPress={() => setOpenSheet('howWorks')}
            noTopDivider
          />
          <SummaryRow
            label="Vibe"
            value={formatTagsSummary(state.tripVibes, TRIP_VIBE_OPTIONS)}
            onPress={() => setOpenSheet('vibe')}
          />
          <SummaryRow
            label="Stay type"
            value={state.accommodationKind ? ACCOMMODATION_LABEL[state.accommodationKind] : ''}
            onPress={() => setOpenSheet('stayType')}
            error={errors.accommodationKind ?? undefined}
          />
        </View>

        {/* Specific-stay Yes/No gate — INLINE */}
        <Text style={[localStyles.fieldLabel, localStyles.groupTopGap]}>
          Did you decide on a specific stay?
        </Text>
        <Text style={localStyles.helper}>
          {editMode
            ? 'Locked from when you first published.'
            : "You can't change this after you publish."}
        </Text>
        <View style={localStyles.gateRow}>
          {(
            [
              {
                key: true as const,
                icon: 'lock-closed-outline' as const,
                title: 'Yes',
                subtitle: 'I have a place locked in.',
              },
              {
                key: false as const,
                icon: 'search-outline' as const,
                title: 'No',
                subtitle: 'Still looking — flexible.',
              },
            ] as {
              key: boolean;
              icon: keyof typeof Ionicons.glyphMap;
              title: string;
              subtitle: string;
            }[]
          ).map(opt => {
            const selected = lockedAnswer === opt.key;
            // Yes card stays tappable even in edit mode so the user can re-open
            // the sheet to view/edit the stay details. No card respects the lock.
            const tapDisabled = opt.key === false ? !canToggle : false;
            const dimmed = tapDisabled && !selected;
            return (
              <TouchableOpacity
                key={String(opt.key)}
                activeOpacity={tapDisabled ? 1 : 0.85}
                disabled={tapDisabled}
                onPress={() => {
                  if (opt.key === true) {
                    if (canToggle) update('accommodationLocked', true);
                    if (errors.accommodationGate) setError('accommodationGate', null);
                    // Open the bottom sheet directly — no inline "Stay details" row.
                    setOpenSheet('specificStay');
                  } else {
                    update('accommodationLocked', false);
                    if (errors.accommodationGate) setError('accommodationGate', null);
                    if (errors.specificStay) setError('specificStay', null);
                  }
                }}
                style={[
                  localStyles.gateCard,
                  selected && localStyles.gateCardActive,
                  dimmed && localStyles.gateCardDisabled,
                ]}
              >
                <Ionicons name={opt.icon} size={28} color={COLORS.brandTeal} />
                <Text
                  style={[
                    localStyles.gateCardTitle,
                    selected && localStyles.gateCardTitleActive,
                  ]}
                >
                  {opt.title}
                </Text>
                <Text style={localStyles.gateCardSubtitle}>{opt.subtitle}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {errors.accommodationGate ? (
          <Text style={localStyles.errorText}>{errors.accommodationGate}</Text>
        ) : null}
        {errors.specificStay ? (
          <Text style={localStyles.errorText}>{errors.specificStay}</Text>
        ) : null}
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // STEP 4 — BUDGET
  // -----------------------------------------------------------------------
  const renderBudgetStep = () => {
    if (editMode || state.manualBudget || (!budgetEstimate && !budgetLoading)) {
      const showEstimateError = !editMode && !!budgetError && !state.manualBudget;
      return (
        <View>
          {showEstimateError ? (
            <View style={localStyles.errorBanner}>
              <Ionicons
                name="alert-circle-outline"
                size={18}
                color={COLORS.errorText}
              />
              <Text style={localStyles.errorBannerText}>
                We couldn't estimate this one — enter a range yourself.
              </Text>
            </View>
          ) : null}
          {editMode ? (
            <Text style={localStyles.helper}>
              Enter the budget range for your trip.
            </Text>
          ) : null}

          <Text style={[localStyles.fieldLabel, localStyles.fieldTopGap]}>
            Budget per person · USD
          </Text>
          <View style={localStyles.row}>
            <TextInput
              style={[
                localStyles.input,
                { flex: 1, marginRight: 8, textAlign: 'center' },
                !!errors.budget && localStyles.inputError,
              ]}
              value={state.budgetManualMin}
              onChangeText={t => {
                update('budgetManualMin', t.replace(/[^0-9]/g, ''));
                if (errors.budget) setError('budget', null);
              }}
              placeholder="Min"
              placeholderTextColor={COLORS.textPlaceholder}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TextInput
              style={[
                localStyles.input,
                { flex: 1, marginLeft: 8, textAlign: 'center' },
                !!errors.budget && localStyles.inputError,
              ]}
              value={state.budgetManualMax}
              onChangeText={t => {
                update('budgetManualMax', t.replace(/[^0-9]/g, ''));
                if (errors.budget) setError('budget', null);
              }}
              placeholder="Max"
              placeholderTextColor={COLORS.textPlaceholder}
              keyboardType="number-pad"
              maxLength={6}
            />
          </View>
          {errors.budget ? (
            <Text style={localStyles.errorText}>{errors.budget}</Text>
          ) : null}

          {showEstimateError ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                setBudgetError(null);
                setLastEstimateKey(null);
                update('manualBudget', false);
                void maybeEstimateBudget();
              }}
              style={localStyles.retryBtn}
            >
              <Text style={localStyles.retryBtnText}>Try estimate again</Text>
            </TouchableOpacity>
          ) : null}
          {!editMode && state.manualBudget && budgetEstimate ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                update('manualBudget', false);
              }}
              style={[localStyles.retryBtn, { marginTop: 8 }]}
            >
              <Text style={localStyles.retryBtnText}>Back to AI estimate</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }

    if (budgetLoading || !budgetEstimate) {
      return (
        <View>
          <View style={localStyles.skeletonRow}>
            <View style={localStyles.skeletonCard} />
            <View style={localStyles.skeletonCard} />
            <View style={localStyles.skeletonCard} />
          </View>
          <View style={localStyles.spinnerRow}>
            <ActivityIndicator color={COLORS.brandTeal} />
          </View>
        </View>
      );
    }

    const days = tripDurationDays();
    const accKind = state.accommodationKind ? ACCOMMODATION_LABEL[state.accommodationKind] : '';
    const derivation = `Based on ${state.destination || 'your destination'}, ${days} day${
      days === 1 ? '' : 's'
    }${accKind ? `, ${accKind.toLowerCase()}` : ''}.`;

    return (
      <View style={localStyles.budgetWrap}>
        <BudgetTierCardsBig
          ranges={budgetEstimate.ranges}
          selected={state.budgetTier}
          onChange={tier => {
            update('budgetTier', tier);
            if (errors.budget) setError('budget', null);
          }}
          derivation={derivation}
          error={errors.budget ?? undefined}
          onManualOverride={() => {
            update('manualBudget', true);
            if (state.budgetTier && budgetEstimate) {
              const r = budgetEstimate.ranges[state.budgetTier];
              if (!state.budgetManualMin) update('budgetManualMin', String(Math.round(r.min)));
              if (!state.budgetManualMax) update('budgetManualMax', String(Math.round(r.max)));
            }
          }}
        />
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // STEP 5 — PREVIEW (unchanged behavior)
  // -----------------------------------------------------------------------
  const renderPreviewStep = () => {
    const synthesized: Partial<GroupTrip> = {
      title: state.title || null,
      description: state.description || '',
      hero_image_url: isRemoteUrl(state.heroImageUri) ? (state.heroImageUri as string) : '',
      destination_country: state.destination || null,
      destination_area: null,
      start_date: state.datesMode === 'exact' ? state.startDateISO : null,
      end_date: state.datesMode === 'exact' ? state.endDateISO : null,
      dates_set_in_stone: state.datesMode === 'exact' ? true : null,
      date_months:
        state.datesMode === 'months' ? expandMonthRange(state.monthFrom, state.monthTo) : null,
      target_surf_levels: state.skillLevels.length
        ? (state.skillLevels as SurfLevel[])
        : null,
      trip_structure: state.tripStructure.length ? state.tripStructure : null,
      trip_vibes: state.tripVibes.length ? state.tripVibes : null,
      age_min: state.ageMin ? parseInt(state.ageMin, 10) : undefined,
      age_max: state.ageMax ? parseInt(state.ageMax, 10) : undefined,
    } as Partial<GroupTrip>;

    const b = resolveBudget();
    const skillLabels = state.skillLevels
      .map(k => SKILL_LEVEL_OPTIONS.find(s => s.key === k)?.label)
      .filter(Boolean) as string[];
    const vibeLabel = state.tripVibes.length
      ? TRIP_VIBE_OPTIONS.find(v => v.slug === state.tripVibes[0])?.label ?? ''
      : '';

    const tierLabel =
      !state.manualBudget && state.budgetTier
        ? state.budgetTier === 'low'
          ? 'Budget'
          : state.budgetTier === 'medium'
            ? 'Mid-range'
            : 'Premium'
        : '';
    const budgetSummary =
      b.min != null && b.max != null
        ? `${tierLabel ? tierLabel + ' · ' : ''}${formatRange({ min: b.min, max: b.max })} per person`
        : null;

    const summaryRows: { key: string; value: string; goto: StepKey }[] = [
      {
        key: 'Wave shape',
        value: state.waveShape ? WAVE_SHAPE_TITLE[state.waveShape] : '—',
        goto: 'audience',
      },
      {
        key: 'Wave size',
        value:
          state.waveSizeMin === state.waveSizeMax
            ? `${state.waveSizeMin} ft`
            : `${state.waveSizeMin}–${state.waveSizeMax} ft`,
        goto: 'audience',
      },
      {
        key: 'Board types',
        value:
          state.surfStyles.length === 0
            ? 'Any'
            : state.surfStyles
                .map(s => BOARD_TYPE_OPTIONS.find(o => o.key === s)?.label || s)
                .join(', '),
        goto: 'audience',
      },
      {
        key: 'Accommodation',
        value:
          (state.accommodationKind ? ACCOMMODATION_LABEL[state.accommodationKind] : '—') +
          (state.accommodationLocked && state.accommodationName
            ? ` · ${state.accommodationName}`
            : ''),
        goto: 'vibez',
      },
      {
        key: 'Age range',
        value: state.ageMin && state.ageMax ? `${state.ageMin}–${state.ageMax}` : '—',
        goto: 'audience',
      },
    ];

    return (
      <View>
        <TripPreviewCard
          trip={synthesized}
          heroImageOverride={
            !isRemoteUrl(state.heroImageUri) ? state.heroImageUri ?? null : null
          }
        />

        {budgetSummary || vibeLabel || skillLabels.length > 0 ? (
          <View style={localStyles.previewExtraBlock}>
            {budgetSummary ? (
              <Text style={localStyles.previewBudget}>{budgetSummary}</Text>
            ) : null}
            {vibeLabel || skillLabels.length > 0 ? (
              <View style={localStyles.previewChipRow}>
                {vibeLabel ? (
                  <View style={localStyles.previewChip}>
                    <Text style={localStyles.previewChipText}>{vibeLabel}</Text>
                  </View>
                ) : null}
                {skillLabels.map(l => (
                  <View key={l} style={localStyles.previewChip}>
                    <Text style={localStyles.previewChipText}>{l}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={[localStyles.sectionTitle, { marginTop: 24 }]}>Trip details</Text>
        <View style={localStyles.summaryGrid}>
          {summaryRows.map((row, idx) => (
            <TouchableOpacity
              key={row.key}
              activeOpacity={0.7}
              onPress={() => setStep(row.goto)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${row.key}`}
              style={[
                localStyles.summaryGridCell,
                // Right column on odd index → no right border
                idx % 2 === 0 && localStyles.summaryGridCellLeft,
              ]}
            >
              <Text style={localStyles.summaryKey}>{row.key}</Text>
              <Text style={localStyles.summaryValue} numberOfLines={2}>
                {row.value}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[localStyles.sectionTitle, { marginTop: 24 }]}>Who can see this trip</Text>
        <View style={localStyles.visibilityRow}>
          {VISIBILITIES.map(opt => {
            const active = state.visibility === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                activeOpacity={0.85}
                onPress={() => update('visibility', opt.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${opt.title}. ${opt.desc}`}
                style={[localStyles.visibilityCard, active && localStyles.visibilityCardActive]}
              >
                <Ionicons
                  name={opt.icon}
                  size={22}
                  color={active ? COLORS.brandTealText : COLORS.inkBody}
                />
                <Text
                  style={[
                    localStyles.visibilityTitle,
                    active && localStyles.visibilityTitleActive,
                  ]}
                >
                  {opt.title}
                </Text>
                <Text style={localStyles.visibilityDesc} numberOfLines={2}>
                  {opt.desc}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  // Suppress unused-variable warning while keeping the read for future use.
  void firstErrorField;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const closeSheet = () => setOpenSheet(null);

  return (
    <View style={{ flex: 1 }}>
      <CreateTripWizardChrome
        stepIndex={stepIdx}
        stepCount={STEPS.length}
        stepTitle={meta.title}
        stepSubtitle={subtitle}
        primaryLabel={ctaLabel}
        secondaryLabel={stepIdx === 0 ? 'Cancel' : 'Back'}
        onPrimary={onPrimary}
        onSecondary={onSecondary}
        submitting={submitting}
        hideProgress
      >
        {renderStep()}
      </CreateTripWizardChrome>

      {/* ------- Sheets ------- */}

      {/* Step 1 sheets */}
      <WizardBottomSheet
        visible={openSheet === 'levels'}
        title="Surf levels"
        onClose={closeSheet}
      >
        <LevelsSheetContent
          selected={state.skillLevels}
          onChange={next => {
            update('skillLevels', next);
            if (errors.skill) setError('skill', null);
          }}
        />
      </WizardBottomSheet>

      {/* Merged Wave sheet — shape + size in one — per the new Figma. */}
      <WizardBottomSheet
        visible={openSheet === 'wave'}
        title="The Wave"
        subtitle="Pick the shape and size"
        largeTitle
        hideHeaderDivider
        onClose={closeSheet}
      >
        <WaveSheetContent
          shape={state.waveShape}
          onShapeChange={next => {
            update('waveShape', next);
            if (errors.waveShape) setError('waveShape', null);
          }}
          sizeMin={state.waveSizeMin}
          sizeMax={state.waveSizeMax}
          onSizeChange={({ min, max }) => {
            setState(s => ({ ...s, waveSizeMin: min, waveSizeMax: max }));
            if (!hasBeenTouched) setHasBeenTouched(true);
          }}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'style'}
        title="Board style"
        subtitle="You can select more than one"
        largeTitle
        hideHeaderDivider
        onClose={closeSheet}
      >
        <StyleSheetContent
          selected={state.surfStyles}
          onChange={next => update('surfStyles', next)}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'age'}
        title="Age range"
        onClose={closeSheet}
      >
        <AgeSheetContent
          ageMin={state.ageMin ? parseInt(state.ageMin, 10) : null}
          ageMax={state.ageMax ? parseInt(state.ageMax, 10) : null}
          ageWindow={ageWindow}
          onChange={({ ageMin, ageMax }) => {
            setState(s => ({
              ...s,
              ageMin: ageMin != null ? String(ageMin) : '',
              ageMax: ageMax != null ? String(ageMax) : '',
            }));
            if (!hasBeenTouched) setHasBeenTouched(true);
            if (errors.age) setError('age', null);
          }}
          error={errors.age ?? undefined}
        />
      </WizardBottomSheet>

      {/* Step 2 sheets */}
      <HomeBreakSearchSheet
        visible={openSheet === 'where'}
        title="Pick destination"
        confirmTitle="Use this destination"
        searchPlaceholder="Search beaches, towns, breaks…"
        nameOnly
        onClose={closeSheet}
        onSelect={sel => {
          setState(s => ({ ...s, destination: sel.name || sel.short, destinationGeo: sel }));
          if (!hasBeenTouched) setHasBeenTouched(true);
          if (errors.destination) setError('destination', null);
          closeSheet();
        }}
      />

      <WizardBottomSheet
        visible={openSheet === 'when'}
        title="When?"
        onClose={closeSheet}
        heightMode="full"
        footer={
          <TouchableOpacity
            onPress={closeSheet}
            activeOpacity={0.85}
            style={localStyles.sheetSetBtn}
            accessibilityRole="button"
            accessibilityLabel="Set dates and close"
          >
            <Text style={localStyles.sheetSetBtnText}>Set</Text>
          </TouchableOpacity>
        }
      >
        <WhenSheetContent
          mode={state.datesMode === 'exact' ? 'calendar' : 'months'}
          onModeChange={m => update('datesMode', m === 'calendar' ? 'exact' : 'months')}
          startDate={startDateObj}
          endDate={endDateObj}
          onCalendarChange={({ startDate, endDate }) => {
            setState(s => ({
              ...s,
              startDateISO: startDate ? toISODate(startDate) : null,
              endDateISO: endDate ? toISODate(endDate) : null,
            }));
            if (!hasBeenTouched) setHasBeenTouched(true);
            if (errors.when) setError('when', null);
          }}
          monthFrom={state.monthFrom}
          monthTo={state.monthTo}
          onMonthsChange={({ monthFrom, monthTo }) => {
            setState(s => ({ ...s, monthFrom, monthTo }));
            if (!hasBeenTouched) setHasBeenTouched(true);
            if (errors.when) setError('when', null);
          }}
          durationDays={state.durationDays}
          onDurationChange={n => {
            update('durationDays', n);
            if (errors.when) setError('when', null);
          }}
        />
      </WizardBottomSheet>

      {/* Step 3 sheets */}
      <WizardBottomSheet
        visible={openSheet === 'howWorks'}
        title="How does it work?"
        onClose={closeSheet}
        heightMode="full"
      >
        <HowItWorksSheetContent
          selected={state.tripStructure}
          onChange={next => update('tripStructure', next)}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'vibe'}
        title="Vibe"
        onClose={closeSheet}
        heightMode="full"
      >
        <VibeSheetContent
          selected={state.tripVibes}
          onChange={next => update('tripVibes', next)}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'stayType'}
        title="Stay type"
        onClose={closeSheet}
        heightMode="full"
      >
        <StayTypeSheetContent
          selected={state.accommodationKind}
          onChange={k => {
            update('accommodationKind', k);
            if (errors.accommodationKind) setError('accommodationKind', null);
          }}
          error={errors.accommodationKind ?? undefined}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'specificStay'}
        title="Stay details"
        onClose={closeSheet}
        heightMode="full"
      >
        <SpecificStaySheetContent
          name={state.accommodationName}
          url={state.accommodationUrl}
          photoUri={state.accommodationImageUri}
          onChange={next => {
            setState(s => ({
              ...s,
              accommodationName: next.name,
              accommodationUrl: next.url,
              accommodationImageUri: next.photoUri,
            }));
            if (!hasBeenTouched) setHasBeenTouched(true);
            if (errors.specificStay) setError('specificStay', null);
          }}
        />
      </WizardBottomSheet>
    </View>
  );
}

// =============================================================================
// Styles
// =============================================================================
const localStyles = StyleSheet.create({
  // Step 1 card stack — gap tuned so the bigger "floating" shadow has room
  // to bloom between adjacent cards without looking like the cards touch.
  // Card stack — inset horizontally so cards are narrower than the screen
  // (top vertical cards become taller/skinnier; bottom horizontal cards inherit
  // the same width so they sit flush with the top row).
  cardStack: {
    gap: 20,
    marginHorizontal: 12,
  },
  // Step 1 top row — Surf Level + Board Style side-by-side. Gap matches the
  // cardStack vertical gap so the rhythm reads as a clean grid.
  topRow: {
    flexDirection: 'row',
    gap: 20,
  },
  cardError: {
    marginTop: -8,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: '#C0392B',
    paddingHorizontal: 4,
  },
  // Sheet footer CTA — "Set" button to confirm + dismiss the sheet.
  sheetSetBtn: {
    backgroundColor: '#212121',
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSetBtnText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  // Common
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  fieldLabel: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: COLORS.inkBody,
    marginBottom: 8,
  },
  fieldTopGap: {
    marginTop: 20,
  },
  // Gap between two sections (groups). Per design language: ~24px between groups.
  groupTopGap: {
    marginTop: 24,
  },
  // Container that wraps a contiguous list of SummaryRows.
  summaryGroup: {
    backgroundColor: COLORS.surfaceCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderHairline,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  counter: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  helper: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: COLORS.textMuted,
    marginTop: 4,
  },
  // Tighter helper that sits directly under a SummaryRow.
  helperRowFootnote: {
    marginTop: -2,
    marginBottom: 10,
    marginLeft: 4,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: COLORS.textMuted,
  },
  errorText: {
    marginTop: 6,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: COLORS.errorText,
  },
  input: {
    height: 56,
    borderWidth: 1,
    borderColor: COLORS.borderField,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontFamily: FONT_INTER,
    fontSize: 16,
    color: COLORS.inkBody,
    backgroundColor: COLORS.surfaceCard,
  },
  textarea: {
    height: 140,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: COLORS.errorBorder,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Trip title preview line
  titlePreview: {
    marginTop: 8,
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: COLORS.inkBody,
  },

  // Resume banner
  resumeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 16,
    borderRadius: 14,
    backgroundColor: COLORS.brandTealTint,
    borderWidth: 1,
    borderColor: '#9ED1E2',
  },
  resumeBannerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  resumeBannerTitle: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.brandTealText,
  },
  resumeBannerBody: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    color: COLORS.inkBody,
    marginTop: 2,
  },
  resumeBannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceCard,
    borderWidth: 1,
    borderColor: COLORS.brandTeal,
    marginLeft: 8,
  },
  resumeBannerBtnText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.brandTeal,
  },

  // Photo zones
  photoZone: {
    width: '100%',
    aspectRatio: 12 / 5,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoZoneEmpty: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.borderField,
    backgroundColor: '#FAFAFA',
  },
  photoZoneError: {
    borderColor: COLORS.errorBorder,
  },
  photoFilled: {
    width: '100%',
    height: '100%',
    aspectRatio: 12 / 5,
  },
  photoEmptyInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  photoIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.brandTealTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  photoEmptyText: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: COLORS.brandTeal,
  },
  photoEmptyHint: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textMuted,
  },
  photoChangePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(33,33,33,0.85)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  photoChangePillText: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Legacy option cards (kept for compat — visibility now uses visibilityCard).
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderCard,
    backgroundColor: COLORS.surfaceCard,
    marginBottom: 10,
  },
  optionCardActive: {
    borderWidth: 2,
    borderColor: COLORS.brandTeal,
    backgroundColor: COLORS.brandTealTint,
    padding: 15,
  },
  optionTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.inkBody,
    marginBottom: 4,
  },
  optionTitleActive: {
    color: COLORS.brandTealText,
  },
  optionDesc: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: COLORS.textMuted,
  },
  sectionTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: COLORS.inkBody,
    marginBottom: 10,
  },

  // Accommodation gate
  gateRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  gateCard: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderField,
    backgroundColor: COLORS.surfaceCard,
    alignItems: 'center',
  },
  gateCardActive: {
    borderWidth: 2,
    borderColor: COLORS.brandTeal,
    backgroundColor: COLORS.brandTealTint,
    padding: 15,
  },
  gateCardDisabled: {
    opacity: 0.35,
  },
  gateCardTitle: {
    marginTop: 8,
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.inkBody,
  },
  gateCardTitleActive: {
    color: COLORS.brandTealText,
  },
  gateCardSubtitle: {
    marginTop: 4,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  // Budget — center-stage container with breathing room above/below.
  budgetWrap: {
    paddingVertical: 8,
  },

  // Budget — error banner / skeleton / retry
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.errorBg,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.errorText,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  skeletonCard: {
    flex: 1,
    height: 120,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceMuted,
  },
  spinnerRow: {
    marginTop: 16,
    alignItems: 'center',
  },
  retryBtn: {
    marginTop: 16,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.brandTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.brandTeal,
  },

  // Preview extras
  previewExtraBlock: {
    marginTop: 0,
    marginBottom: 12,
  },
  previewBudget: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    color: COLORS.inkBody,
    marginBottom: 6,
  },
  previewChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  previewChip: {
    backgroundColor: COLORS.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  previewChipText: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    color: '#555',
  },

  // Summary grid (preview step)
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    marginBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderHairline,
  },
  summaryGridCell: {
    width: '50%',
    paddingVertical: 12,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderHairline,
  },
  summaryGridCellLeft: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: COLORS.borderHairline,
    paddingLeft: 4,
    paddingRight: 12,
  },
  summaryKey: {
    fontFamily: FONT_INTER,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: COLORS.textMuted,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.inkBody,
  },

  // Visibility — 3-column row of cards.
  visibilityRow: {
    flexDirection: 'row',
    gap: 10,
  },
  visibilityCard: {
    flex: 1,
    minHeight: 96,
    paddingHorizontal: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.borderField,
    backgroundColor: COLORS.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityCardActive: {
    borderWidth: 2,
    borderColor: COLORS.brandTeal,
    backgroundColor: COLORS.brandTealTint,
    paddingHorizontal: 9,
    paddingVertical: 13,
  },
  visibilityTitle: {
    marginTop: 6,
    fontFamily: FONT_MONTSERRAT,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    color: COLORS.inkBody,
  },
  visibilityTitleActive: {
    color: COLORS.brandTealText,
  },
  visibilityDesc: {
    marginTop: 2,
    fontFamily: FONT_INTER,
    fontSize: 11,
    lineHeight: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
