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
  ImageSourcePropType,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

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
import { FadeInView } from '../../components/FadeInView';
import { HomeBreakSearchSheet, HomeBreakSelection } from '../../components/HomeBreakSearchSheet';
import { InlineMapView } from '../../components/MapPickerModal';

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
import { TripIcon } from '../../components/trips/tripIcons';
import { StayTypeSheetContent } from '../../components/trips/sheets/StayTypeSheetContent';
import { SpecificStaySheetContent } from '../../components/trips/sheets/SpecificStaySheetContent';

// Existing dependencies still used (preview card)
import { TripPreviewCard } from '../../components/trips/TripPreviewCard';
import { type TripDetailVM } from '../../components/trips/TripDetailView';
import { TripDetailViewRedesigned } from '../../components/trips/TripDetailViewRedesigned';
import { TripPublishedScreen } from './TripPublishedScreen';
import { TripTagPicker } from '../../components/trips/TripTagPicker';
import {
  DESTINATION_FAMILIARITY_OPTIONS,
  STAY_FAMILIARITY_OPTIONS,
  type DestinationFamiliarity,
  type StayFamiliarity,
} from '../../services/trips/groupTripsService';
import { ProfileEditPanel } from '../../components/ProfileEditPanel/ProfileEditPanel';
import {
  type PriceInclusions,
  MEALS_OPTIONS,
  ACCOMMODATION_INCL_OPTIONS,
  TRANSPORTATION_OPTIONS,
  SURF_SESSIONS_OPTIONS,
  SURF_EQUIPMENT_OPTIONS,
  CATEGORY_TITLE,
  summarizeCategory,
  normalizePriceInclusions,
} from '../../services/trips/priceInclusions';
import {
  ActivitiesSheetContent,
  SurfFilmSheetContent,
  VideoAnalysisSheetContent,
  CustomInclusionSheetContent,
  WellnessSheetContent,
} from '../../components/trips/sheets/IncludesSheets';
import { supabase } from '../../config/supabase';
import { AudienceCard, type AudienceCardStatus } from '../../components/trips/AudienceCard';
import { WizardInfoOverlay } from '../../components/trips/WizardInfoOverlay';
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
// became waveShape (single value). v3 → v4: Flow C fixed pricing
// (costPerPerson + priceInclusions) added. v4 → v5: priceInclusions.custom
// changed from a string to an array of {title, description}.
// v5 -> v6: hostingStyle (A/B/C) is now stored in the draft so the resume prompt
// only offers to restore a draft into the same flow it was started in.
export const WIZARD_STATE_VERSION = 6;

// Step KEYS — flat step list. Preview is the final step (publishes directly).
type StepKey = 'audience' | 'basics' | 'vibez' | 'budget' | 'aboutYou' | 'preview';
// Flow A/C step order. Flow B inserts 'aboutYou' before 'preview' (see `steps`
// memo in the component) so the destination + stay names exist by the time the
// leader describes their familiarity with them.
const STEPS_BASE: StepKey[] = ['audience', 'basics', 'vibez', 'budget', 'preview'];

// DB constraint: minimum age-range span per hosting style.
const AGE_WINDOW_BY_STYLE: Record<HostingStyle, number> = { A: 4, B: 5, C: 2 };

// Step heading + subtitle copy.
const STEP_META: Record<StepKey, { title: string; subtitle: string }> = {
  audience: {
    title: 'Who is it for?',
    subtitle: 'The surfers, the levels, the wave.',
  },
  basics: { title: 'Trip details', subtitle: 'Where, when, what to call it.' },
  vibez: { title: 'Trip Vibe', subtitle: 'How it runs, the feel, the stay.' },
  budget: { title: 'Budget', subtitle: 'Per person, in USD.' },
  aboutYou: { title: 'About you', subtitle: 'Why you’re the right Captain for this.' },
  preview: { title: 'Preview', subtitle: 'How your trip will look.' },
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

// Compact board labels for the audience-step chips (Figma uses "Short", not
// "Shortboard"). Falls back to the full label for the rest.
const SHORT_BOARD_LABEL: Record<SurfStyle, string> = {
  shortboard: 'Short',
  midlength: 'Mid-length',
  softtop: 'Soft-top',
  longboard: 'Longboard',
  all: 'All',
};

// Audience step — the four cards fill strictly in this order. A card unlocks
// only once the one above it has been set (its sheet opened + closed).
type AudienceCardKey = 'levels' | 'boards' | 'wave' | 'age';
const AUDIENCE_ORDER: AudienceCardKey[] = ['levels', 'boards', 'wave', 'age'];

// One-time nudge shown the first time the host opens the Surf level card. The
// goal: stop strong surfers from just picking their own level — these choices
// describe the crew they want to travel with, not themselves.
const AUDIENCE_INTRO_TITLE = 'Pick for the GROUP, not yourself';
const AUDIENCE_INTRO_MESSAGE =
  'These choices decide who can request to join - not your level. Who do you actually want to surf with?';

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
  wally: 'Standing',
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
  | 'audience'
  | 'age'
  | 'skill'
  | 'waveShape'
  | 'accommodationKind'
  | 'accommodationGate'
  | 'specificStay'
  | 'budget'
  | 'price'
  | 'hostDestFamiliarity'
  | 'hostStayFamiliarity';

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
  | 'specificStay'
  | 'destFamiliarity'
  | 'stayFamiliarity'
  // Flow C — "What's included" category sheets.
  | 'incMeals'
  | 'incAccommodation'
  | 'incTransportation'
  | 'incSurfSessions'
  | 'incSurfEquipment'
  | 'incSurfFilm'
  | 'incVideoAnalysis'
  | 'incActivities'
  | 'incWellness'
  | 'incCustom';

// -----------------------------------------------------------------------------
// Wizard state shape (serializable so it round-trips through AsyncStorage).
// -----------------------------------------------------------------------------
interface WizardState extends Record<string, unknown> {
  version: number;
  // Which flow this draft belongs to (A/B/C). Used to gate the resume prompt so
  // a draft started in one flow isn't restored into another.
  hostingStyle: HostingStyle;

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
  maxParticipants: string; // '' = no limit; otherwise a number as string



  // Step 3 — vibez
  tripStructure: TripStructureSlug[];
  tripVibes: TripVibeSlug[];
  accommodationKind: AccommodationKind | null;
  accommodationLocked: boolean | null;

  // Specific-stay details (lives on Step 3 now, opened via sheet).
  accommodationName: string;
  accommodationUrl: string;
  accommodationImageUri: string | null;

  // Flow B — "About you" leader step.
  hostDestFamiliarity: DestinationFamiliarity | null;
  hostStayFamiliarity: StayFamiliarity | null;
  hostLeadNote: string;

  // Step 4 — budget
  budgetTier: BudgetTier | null;
  manualBudget: boolean;
  budgetManualMin: string;
  budgetManualMax: string;

  // Step 4 (Flow C only) — fixed pricing instead of the AI budget tiers.
  costPerPerson: string;
  priceInclusions: PriceInclusions;

  // Step 5 — preview
  visibility: Visibility;
}

const INITIAL_STATE: WizardState = {
  version: WIZARD_STATE_VERSION,
  // Overwritten with the real flow when the wizard mounts (see initialState memo).
  hostingStyle: 'A',
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
  maxParticipants: '',
  tripStructure: [],
  tripVibes: [],
  accommodationKind: null,
  accommodationLocked: null,
  accommodationName: '',
  accommodationUrl: '',
  accommodationImageUri: null,
  hostDestFamiliarity: null,
  hostStayFamiliarity: null,
  hostLeadNote: '',
  budgetTier: null,
  manualBudget: false,
  budgetManualMin: '',
  budgetManualMax: '',
  costPerPerson: '',
  priceInclusions: {},
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

const capitalizeFirst = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// Age in whole years from a YYYY-MM-DD (or ISO) DOB string. Null on bad input.
const ageFromDob = (dob: string): number | null => {
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
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
  `${formatUsd(r.min)} - ${formatUsd(r.max)}`;
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
    // The system photo picker (iOS PHPicker, Android 13+ Photo Picker) runs
    // out-of-process and needs NO library permission. Requesting it anyway adds
    // a native round-trip (slow) and — because dismissing the permission dialog
    // blocks presenting the picker on the same runloop tick — forces a second
    // tap. So only the legacy pre-13 Android path requests permission.
    const usePhotoPicker =
      Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version >= 33);
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
    hostingStyle: trip.hosting_style ?? 'A',
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
      trip.destination?.short_label ||
      trip.destination?.name ||
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
    maxParticipants: trip.max_participants != null ? String(trip.max_participants) : '',
    tripStructure,
    tripVibes,
    accommodationKind: firstKind ?? null,
    accommodationLocked: trip.accommodation_name ? true : false,
    accommodationName: trip.accommodation_name ?? '',
    accommodationUrl: trip.accommodation_url ?? '',
    accommodationImageUri: trip.accommodation_image_url ?? null,
    hostDestFamiliarity: trip.host_destination_familiarity ?? null,
    hostStayFamiliarity: trip.host_stay_familiarity ?? null,
    hostLeadNote: trip.host_lead_note ?? '',
    budgetTier: null,
    // Edit mode skips the estimate; preload manual.
    manualBudget: true,
    budgetManualMin: trip.budget_min != null ? String(trip.budget_min) : '',
    budgetManualMax: trip.budget_max != null ? String(trip.budget_max) : '',
    costPerPerson: trip.cost_per_person != null ? String(trip.cost_per_person) : '',
    priceInclusions: trip.price_inclusions ?? {},
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
  /** Optional left icon — rendered inside a grey bubble (Figma vibez list). */
  icon?: React.ReactNode;
  /** When true, the "Tap to set" placeholder uses the teal accent (Figma vibez). */
  placeholderAccent?: boolean;
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
  icon,
  placeholderAccent,
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
        <View style={rowStyles.leftGroup}>
          {icon ? <View style={rowStyles.iconBubble}>{icon}</View> : null}
          <Text style={[rowStyles.label, disabled && rowStyles.labelDisabled]}>{label}</Text>
        </View>
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
            <Text
              style={[rowStyles.placeholder, placeholderAccent && rowStyles.placeholderAccent]}
              numberOfLines={1}
            >
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
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  iconBubble: {
    backgroundColor: '#F7F7F7',
    borderRadius: 8,
    padding: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.inkBody,
    marginRight: 44,
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
  placeholderAccent: {
    color: '#05BCD3',
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
// Deets row — a standalone tappable card (Where? / When?). Same "floating card"
// language as the AudienceCard on the "Who is it for" step: white surface,
// 20px radius, Box Shadow 01, with a gray icon box on the left.
// -----------------------------------------------------------------------------
interface DeetsRowProps {
  icon: ImageSourcePropType;
  label: string;
  value?: string | null;
  placeholder?: string;
  onPress: () => void;
  error?: string;
  disabled?: boolean;
}

const DeetsRow: React.FC<DeetsRowProps> = ({
  icon,
  label,
  value,
  placeholder = 'Tap to set',
  onPress,
  error,
  disabled,
}) => {
  const hasValue = !!(value && value.trim().length > 0);
  const [pressed, setPressed] = useState(false);
  return (
    <View>
      <TouchableOpacity
        activeOpacity={1}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => !disabled && setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${hasValue ? value : placeholder}`}
        style={[
          deetsStyles.card,
          pressed && deetsStyles.cardPressed,
          !!error && deetsStyles.cardError,
          disabled && deetsStyles.cardDisabled,
        ]}
      >
        <View style={deetsStyles.iconBox}>
          <Image source={icon} style={deetsStyles.iconImage} resizeMode="contain" />
        </View>
        <Text style={deetsStyles.label}>{label}</Text>
        <View style={deetsStyles.valueWrap}>
          <Text
            style={hasValue ? deetsStyles.value : deetsStyles.placeholder}
            numberOfLines={1}
          >
            {hasValue ? value : placeholder}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={disabled ? COLORS.textPlaceholder : COLORS.textMuted}
            style={{ marginLeft: 6 }}
          />
        </View>
      </TouchableOpacity>
      {error ? <Text style={deetsStyles.error}>{error}</Text> : null}
    </View>
  );
};

const deetsStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: COLORS.surfaceCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderHairline,
  },
  cardPressed: {
    backgroundColor: '#F8FAFB',
  },
  cardError: {
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#F7F7F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconImage: {
    width: 22,
    height: 22,
  },
  label: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    color: COLORS.inkBody,
    flexShrink: 0,
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
  // "Tap to set" hint uses the Figma accent cyan.
  placeholder: {
    flex: 1,
    textAlign: 'right',
    fontFamily: FONT_INTER,
    fontSize: 14,
    fontWeight: '400',
    color: '#05BCD3',
  },
  error: {
    marginTop: 6,
    marginLeft: 4,
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: COLORS.errorText,
  },
});

// -----------------------------------------------------------------------------
// Destination map preview — shows the picked spot on a real map with a marker.
// Same static-map pattern as HomeBreakViewSheet (WebView + Google Maps JS).
// -----------------------------------------------------------------------------
const DEST_MAP_HEIGHT = 160;

function getDestinationMapHtml(apiKey: string, lat: number, lng: number, label: string): string {
  const safeKey = apiKey.replace(/[<>"']/g, '');
  const safeLabel = label.replace(/[<>"'\\]/g, '');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
    #map { width: 100%; height: 100%; position: absolute; left: 0; top: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function() {
      var API_KEY = '${safeKey}';
      var center = { lat: ${lat}, lng: ${lng} };
      function initMap() {
        var map = new google.maps.Map(document.getElementById('map'), {
          center: center,
          zoom: 11,
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          zoomControl: false,
          gestureHandling: 'none',
          disableDefaultUI: true,
        });
        new google.maps.Marker({ position: center, map: map, title: '${safeLabel}' });
      }
      window.initMap = initMap;
      var s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + API_KEY + '&callback=initMap';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    })();
  </script>
</body>
</html>`;
}

interface DestinationMapPreviewProps {
  geo: HomeBreakSelection;
  /** Tap to re-open the destination picker. Omitted/disabled in edit mode. */
  onPress?: () => void;
  disabled?: boolean;
}

const DestinationMapPreview: React.FC<DestinationMapPreviewProps> = ({ geo, onPress, disabled }) => {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
  const [width, setWidth] = useState(0);

  if (!apiKey || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') return null;

  const html = getDestinationMapHtml(apiKey, geo.lat, geo.lng, geo.name || geo.short || '');

  return (
    <View
      style={mapStyles.card}
      onLayout={e => {
        const w = Math.round(e.nativeEvent.layout.width);
        setWidth(prev => (prev === w ? prev : w));
      }}
    >
      {width > 0 ? (
        <InlineMapView htmlContent={html} width={width} height={DEST_MAP_HEIGHT} />
      ) : null}
      {/* The WebView has gestureHandling:'none', but a transparent overlay
          guarantees a tap re-opens the picker rather than hitting the map. */}
      {!disabled && onPress ? (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={0.85}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel="Change destination"
        >
          <View style={mapStyles.changePill}>
            <Image
              source={Images.tripDeets.pencil}
              style={mapStyles.changePillIcon}
              tintColor="#FFFFFF"
              resizeMode="contain"
            />
            <Text style={mapStyles.changePillText}>Change</Text>
          </View>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const mapStyles = StyleSheet.create({
  card: {
    marginTop: 8,
    height: DEST_MAP_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#F0F0F0',
  },
  changePill: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  changePillIcon: {
    width: 14,
    height: 14,
  },
  changePillText: {
    color: '#FFFFFF',
    fontFamily: FONT_INTER,
    fontSize: 12,
    fontWeight: '600',
  },
});

// -----------------------------------------------------------------------------
// Summary value formatters
// -----------------------------------------------------------------------------
const formatAgeSummary = (min: string, max: string): string => {
  if (min && max) return `${min} - ${max}`;
  if (min) return `${min}+`;
  if (max) return `Up to ${max}`;
  // Default "any age" — rendered as a real value (same bold styling as a
  // number) instead of as the italic "tap to set" hint.
  return 'Any';
};

// -----------------------------------------------------------------------------
// Audience-card chip helpers — each returns one pill per selection (collapsing
// "everything selected" to a single Any/All pill).
// -----------------------------------------------------------------------------
const levelChips = (levels: SurfLevel[]): string[] => {
  const real = levels.filter(l => l !== 'all' && l !== 'pro');
  if (real.length === 0 || real.length >= 3) return ['Any'];
  return real.map(k => SKILL_LEVEL_OPTIONS.find(o => o.key === k)?.label ?? k);
};

const styleChips = (styles: SurfStyle[]): string[] => {
  const real = styles.filter(s => s !== 'all');
  if (real.length === 0 || real.length >= 4) return ['All'];
  return real.map(k => SHORT_BOARD_LABEL[k]);
};

const waveChips = (state: WizardState): string[] => {
  const chips: string[] = [];
  if (state.waveShape) chips.push(WAVE_SHAPE_TITLE[state.waveShape]);
  const minStr = state.waveSizeMin >= 12 ? '12+' : `${state.waveSizeMin}`;
  const maxStr = state.waveSizeMax >= 12 ? '12+' : `${state.waveSizeMax}`;
  chips.push(
    state.waveSizeMin === state.waveSizeMax ? `${maxStr} ft` : `${minStr} - ${maxStr} ft`,
  );
  return chips;
};

const ageChips = (min: string, max: string): string[] => [formatAgeSummary(min, max)];

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
    return `${startMonthDay} - ${endMonthDay}, ${endYear}`;
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
      ? `${monthShort(from)} - ${monthShort(to)} ${monthYear(to)}`
      : `${monthShort(from)} ${monthYear(from)} - ${monthShort(to)} ${monthYear(to)}`;
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
    // Some labels carry extra context after a " - " separator — keep the head.
    .map(l => l.split(' - ')[0].split(' — ')[0].split(' – ')[0]);
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

// Stay-card subtext — names which pieces are filled, e.g. "Name added",
// "Name & link added", "Name, link & photo added". Grows as fields are entered.
const formatStayProgress = (state: WizardState): string => {
  const bits: string[] = [];
  if (state.accommodationName.trim()) bits.push('Name');
  if (state.accommodationUrl.trim()) bits.push('Link');
  if (state.accommodationImageUri) bits.push('Photo');
  if (bits.length === 0) return '';
  const norm = bits.map((b, i) => (i === 0 ? b : b.toLowerCase()));
  const joined =
    norm.length === 1
      ? norm[0]
      : `${norm.slice(0, -1).join(', ')} & ${norm[norm.length - 1]}`;
  return `${joined} added`;
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
  /** When true, load the saved draft into state on mount (the chooser already
   *  confirmed "Continue your trip?"). Ignored in edit mode. */
  resumeDraft?: boolean;
}

export default function CreateTripFlowA({
  hostId,
  onCreated,
  onCancel,
  initialTrip,
  hostingStyle = 'A',
  resumeDraft = false,
}: CreateTripFlowAProps): React.ReactElement {
  const editMode = !!initialTrip;
  const effectiveStyle: HostingStyle = initialTrip?.hosting_style ?? hostingStyle;
  const ageWindow = AGE_WINDOW_BY_STYLE[effectiveStyle];
  // Flow B is the "leader" flow: it adds the 'aboutYou' step and requires a
  // specific stay (no Yes/No gate).
  const isLeaderFlow = effectiveStyle === 'B';
  // Flow C is the "fully-planned" flow: exact dates only (no months toggle) and
  // a fixed per-person price + rich "What's included" instead of the AI budget.
  const isFixedFlow = effectiveStyle === 'C';
  // B and C both lock in a specific stay — no Yes/No gate, the stay card is
  // always shown and its details are required. Only A uses the gate.
  const requiresSpecificStay = isLeaderFlow || isFixedFlow;
  // B and C both show the "About you" step (host profile + familiarity + lead
  // note). Only A skips it.
  const hasAboutYou = isLeaderFlow || isFixedFlow;

  // Step order — B & C insert 'aboutYou' after 'budget' (dest + stay are known
  // by then, so the familiarity fields can name them).
  const steps = useMemo<StepKey[]>(() => {
    if (!hasAboutYou) return STEPS_BASE;
    const idx = STEPS_BASE.indexOf('preview');
    return [...STEPS_BASE.slice(0, idx), 'aboutYou', ...STEPS_BASE.slice(idx)];
  }, [hasAboutYou]);

  // ---- Wizard state (draft-backed) ----------------------------------------
  const initialState = useMemo<WizardState>(
    () =>
      initialTrip
        ? stateFromTrip(initialTrip)
        : { ...INITIAL_STATE, hostingStyle: effectiveStyle },
    // initialTrip is stable for the wizard's lifetime; intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const { state, setState, clearDraft, startSaving, saveNow } =
    useTripWizardDraft<WizardState>(initialState, {
      editMode,
      tripId: initialTrip?.id ?? null,
      resume: resumeDraft,
    });

  // ---- Validation registry ------------------------------------------------
  const { errors, setError, clearErrors, firstErrorField } = useFieldErrors<FieldKey>();

  // ---- Step navigation ---------------------------------------------------
  const [step, setStep] = useState<StepKey>('audience');
  const stepIdx = useMemo(() => Math.max(0, steps.indexOf(step)), [step, steps]);

  // ---- Sheet management --------------------------------------------------
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);

  // ---- Keyboard avoidance for inline text fields -------------------------
  // The chrome scrolls whichever input is in `focusedInputRef` clear of the
  // keyboard + floating footer on keyboard-show.
  const titleInputRef = useRef<TextInput | null>(null);
  const descInputRef = useRef<TextInput | null>(null);
  const focusedInputRef = useRef<TextInput | null>(null);
  // The chrome assigns its keyboard-scroll function here; inputs call it on
  // focus so it works even when the keyboard is already open.
  const keyboardScrollRef = useRef<(() => void) | null>(null);
  const handleFieldFocus = useCallback((ref: React.RefObject<TextInput | null>) => {
    focusedInputRef.current = ref.current;
    // Defer so focus/layout settles, then ask the chrome to scroll it into view.
    requestAnimationFrame(() => keyboardScrollRef.current?.());
  }, []);

  // ---- Audience strict-sequential progress -------------------------------
  // A card is "done" once its sheet has been opened + closed. Edit mode and
  // resumed drafts treat every card as already done (show their chips), so the
  // guided gating only applies to a fresh trip.
  const [audienceDone, setAudienceDone] = useState<Set<AudienceCardKey>>(
    () => (editMode || resumeDraft ? new Set(AUDIENCE_ORDER) : new Set()),
  );
  const markAudienceDone = useCallback(
    (key: AudienceCardKey) => {
      setAudienceDone(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
      setError('audience', null);
    },
    [setError],
  );

  // First tap on the Surf level card pops a one-time "this is about the group"
  // reminder before the sheet opens. Skipped in edit/resume (already past intro).
  const [showAudienceIntro, setShowAudienceIntro] = useState(false);
  const audienceIntroSeenRef = useRef(editMode || resumeDraft);

  // Opening the Surf level card: show the intro on the very first tap, then open
  // the levels sheet once it's dismissed. Every later tap opens the sheet directly.
  const handleSurfLevelPress = useCallback(() => {
    if (!audienceIntroSeenRef.current) {
      setShowAudienceIntro(true);
      return;
    }
    setOpenSheet('levels');
  }, []);

  const dismissAudienceIntro = useCallback(() => {
    audienceIntroSeenRef.current = true;
    setShowAudienceIntro(false);
    setOpenSheet('levels');
  }, []);

  // ---- Dirty tracking (drives discard-confirm prompt) ---------------------
  const [hasBeenTouched, setHasBeenTouched] = useState(false);
  const draftStartedRef = useRef(false);

  // ---- Submit / budget UI state ------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  // Set after a successful publish (create only) → shows the Published / invite
  // screen instead of closing immediately.
  const [published, setPublished] = useState<{
    id: string;
    title: string | null;
    hero: string | null;
  } | null>(null);

  // Flow B "About you" — the host's own surfer profile (for the embedded card)
  // and the slide-up editor.
  const [hostSurfer, setHostSurfer] = useState<any | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  // Flow C — which "add your own" inclusion the bottom sheet is editing.
  const [customEditIndex, setCustomEditIndex] = useState<number | null>(null);

  const loadHostSurfer = useCallback(async () => {
    if (!hostId) return;
    const { data } = await supabase
      .from('surfers')
      .select('*')
      .eq('user_id', hostId)
      .maybeSingle();
    if (data) setHostSurfer(data);
  }, [hostId]);

  // Load the host's surfer profile for every flow — the preview renders the real
  // visitor overview, which shows the host as a participant (and, for operator
  // trips, the "About <host>" block).
  useEffect(() => {
    void loadHostSurfer();
  }, [loadHostSurfer]);

  // Flow C is exact-dates only — pin datesMode to 'exact' (covers initial mount
  // and any restored draft that carried 'months').
  useEffect(() => {
    if (isFixedFlow && state.datesMode !== 'exact') {
      setState(s => ({ ...s, datesMode: 'exact' }));
    }
  }, [isFixedFlow, state.datesMode, setState]);

  // Budget estimate (transient — not persisted)
  const [budgetEstimate, setBudgetEstimate] = useState<BudgetEstimate | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [lastEstimateKey, setLastEstimateKey] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Helpers tied to component scope
  // -----------------------------------------------------------------------
  const update = useCallback(
    <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
      setState(prev => ({ ...prev, [key]: value }));
      if (!hasBeenTouched) {
        setHasBeenTouched(true);
        // Begin autosave the moment anything changes, so a crash / app-close
        // before reaching "Next" still leaves a restorable draft.
        if (!editMode) startSaving();
      }
    },
    [setState, hasBeenTouched, editMode, startSaving],
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

  const tripTravelMonth = useCallback((): string | null => {
    if (state.datesMode === 'exact' && startDateObj) {
      const d = startDateObj;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    return state.monthFrom || null;
  }, [state.datesMode, startDateObj, state.monthFrom]);

  const estimateKey = useCallback(() => {
    return [
      state.destination,
      state.destinationGeo?.country ?? '',
      tripDurationDays(),
      state.accommodationKind ?? '',
      tripTravelMonth() ?? '',
    ].join('|');
  }, [state.destination, state.destinationGeo, state.accommodationKind, tripDurationDays, tripTravelMonth]);

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
        travelMonth: tripTravelMonth(),
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
    tripTravelMonth,
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
        // Must open + set all four cards before advancing — every card has a
        // valid default, so without this the host could skip straight past.
        if (!AUDIENCE_ORDER.every(k => audienceDone.has(k))) {
          fail('audience', 'Tap through all four to continue');
        }
        // One-sided (only min OR only max) is valid — interpreted as "no
        // upper limit" / "no lower limit". Both empty is also valid ("Any").
        const minRaw = state.ageMin ? parseInt(state.ageMin, 10) : null;
        const maxRaw = state.ageMax ? parseInt(state.ageMax, 10) : null;
        const minOk = minRaw == null || (minRaw >= 16 && minRaw <= 99);
        const maxOk = maxRaw == null || (maxRaw >= 16 && maxRaw <= 99);
        if (!minOk || !maxOk) {
          fail('age', 'Ages must be 16-99');
        } else if (minRaw != null && maxRaw != null) {
          if (maxRaw < minRaw) {
            fail('age', 'Maximum age must be at least the minimum');
          } else if (maxRaw - minRaw < ageWindow) {
            fail(
              'age',
              `Age range must span at least ${ageWindow} years (currently ${maxRaw - minRaw}).`,
            );
          }
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
        const stayDetailsMissing =
          !state.accommodationName.trim() ||
          !state.accommodationUrl.trim() ||
          !state.accommodationImageUri;
        if (requiresSpecificStay) {
          // Flow B & C always have a specific stay — details required, no gate.
          if (stayDetailsMissing) fail('specificStay', 'Add the stay name, link, and a photo');
        } else {
          if (state.accommodationLocked === null)
            fail('accommodationGate', 'Choose yes or no');
          // All three details required when the gate is Yes.
          if (state.accommodationLocked === true && stayDetailsMissing) {
            fail('specificStay', 'Add the stay name, link, and a photo');
          }
        }
        return ok;
      }
      case 'budget': {
        if (isFixedFlow) {
          // Flow C — a single fixed per-person price is required.
          const price = state.costPerPerson ? parseInt(state.costPerPerson, 10) : null;
          if (price == null || Number.isNaN(price) || price <= 0) {
            fail('price', 'Enter a price per person');
          }
          return ok;
        }
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
      case 'aboutYou': {
        if (!state.hostDestFamiliarity)
          fail('hostDestFamiliarity', 'Pick how well you know the destination');
        if (!state.hostStayFamiliarity)
          fail('hostStayFamiliarity', 'Pick how well you know the stay');
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
    isLeaderFlow,
    isFixedFlow,
    audienceDone,
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

    const idx = steps.indexOf(step);
    const next = steps[idx + 1];
    if (!next) return;
    if (next === 'budget' && !editMode && !isFixedFlow) {
      void maybeEstimateBudget();
    }
    setStep(next);
  }, [validateStep, step, steps, editMode, isFixedFlow, startSaving, maybeEstimateBudget]);

  const handleBack = useCallback(() => {
    const idx = steps.indexOf(step);
    if (idx <= 0) return;
    setStep(steps[idx - 1]);
  }, [step, steps]);

  // Exit guard — confirms before leaving, then SAVES the draft (never deletes).
  // The draft is only cleared by publishing or by "Start fresh" in the resume
  // prompt. In edit mode there's no draft, so we just close.
  const { guardedCancel } = useDiscardConfirm({
    dirty: hasBeenTouched && !editMode,
    title: 'Are you sure you want to exit?',
    message: 'Your progress will be saved - you can pick it back up next time.',
    discardLabel: 'Yes, exit',
    keepEditingLabel: 'No',
    onDiscard: async () => {
      if (!editMode && hasBeenTouched) await saveNow();
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

      // Accommodation photo upload (only when host locked in a stay). Flow B & C
      // always have a specific stay (no Yes/No gate), so it's always committed.
      const accommodationCommitted = requiresSpecificStay || state.accommodationLocked === true;

      // Host credibility fields (B & C have the "About you" step; null for A).
      const leaderFields = hasAboutYou
        ? {
            host_destination_familiarity: state.hostDestFamiliarity,
            host_stay_familiarity: state.hostStayFamiliarity,
            host_lead_note: state.hostLeadNote.trim() || null,
          }
        : {
            host_destination_familiarity: null,
            host_stay_familiarity: null,
            host_lead_note: null,
          };
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
      // Flow C uses a fixed per-person price + rich inclusions, no budget range.
      const budget = isFixedFlow
        ? { min: null, max: null, currency: 'USD' }
        : resolveBudget();
      const fixedPrice =
        isFixedFlow && state.costPerPerson ? parseInt(state.costPerPerson, 10) : null;
      const priceInclusions = isFixedFlow
        ? normalizePriceInclusions(state.priceInclusions)
        : null;
      const descriptionText = state.description.trim();
      const maxParticipants = state.maxParticipants
        ? parseInt(state.maxParticipants, 10)
        : null;
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
          dates_set_in_stone: exactDates,
          date_months: dateMonths.length ? dateMonths : null,
          duration_days: state.durationDays,
          max_participants: maxParticipants,
          age_min: state.ageMin ? parseInt(state.ageMin, 10) : null,
          age_max: state.ageMax ? parseInt(state.ageMax, 10) : null,
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
          budget_tier: state.manualBudget ? null : state.budgetTier,
          cost_per_person: fixedPrice,
          price_inclusions: priceInclusions,
          trip_structure: state.tripStructure.length ? state.tripStructure : null,
          trip_vibes: state.tripVibes.length ? state.tripVibes : null,
          wave_shapes: waveShapesArray,
          wave_size_min: state.waveSizeMin,
          wave_size_max: state.waveSizeMax,
          target_surf_styles: state.surfStyles.length ? state.surfStyles : ['all'],
          // Whether the host picked a specific stay (the step-3 Yes/No gate).
          // Guaranteed non-null by the time this saves (vibez-step validation).
          specific_stay_selected: requiresSpecificStay ? true : state.accommodationLocked,
          ...leaderFields,
          // All trips are public — no visibility UI. Always write 'public'.
          visibility: 'public',
        };
        await updateGroupTrip(initialTrip.id, editable);
        onCreated();
      } else {
        const input: CreateGroupTripInput = {
          hosting_style: hostingStyle,
          status: 'active',
          title: state.title.trim() || null,
          description: descriptionText,
          hero_image_url: heroUrl,

          start_date: startISO,
          end_date: endISO,
          dates_set_in_stone: exactDates,
          date_months: dateMonths.length ? dateMonths : null,
          duration_days: state.durationDays,
          max_participants: maxParticipants,

          accommodation_type: state.accommodationKind ? [state.accommodationKind] : null,
          accommodation_name: accommodationCommitted
            ? state.accommodationName.trim() || null
            : null,
          accommodation_url: accommodationCommitted
            ? state.accommodationUrl.trim() || null
            : null,
          accommodation_image_url: accommodationCommitted ? accommodationImageUrl : null,

          age_min: state.ageMin ? parseInt(state.ageMin, 10) : null,
          age_max: state.ageMax ? parseInt(state.ageMax, 10) : null,
          target_surf_levels: skillLevels,
          target_surf_styles: state.surfStyles.length ? state.surfStyles : ['all'],
          wave_shapes: waveShapesArray,
          wave_size_min: state.waveSizeMin,
          wave_size_max: state.waveSizeMax,

          budget_min: budget.min,
          budget_max: budget.max,
          budget_currency: budget.currency,
          budget_tier: state.manualBudget ? null : state.budgetTier,

          trip_structure: state.tripStructure.length ? state.tripStructure : null,
          trip_vibes: state.tripVibes.length ? state.tripVibes : null,
          cost_per_person: fixedPrice,
          price_inclusions: priceInclusions,

          // Whether the host picked a specific stay (the step-3 Yes/No gate).
          // Guaranteed non-null by the time this saves (vibez-step validation).
          specific_stay_selected: requiresSpecificStay ? true : state.accommodationLocked,
          ...leaderFields,
          // All trips are public — no visibility UI. Always write 'public'.
          visibility: 'public',

          personal_gear_host_suggestion: [],
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
        // Show the Published / invite-friends screen. onCreated() fires when
        // the host taps Done there.
        setPublished({ id: trip.id, title: trip.title ?? state.title ?? null, hero: heroUrl });
      }
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
    isLeaderFlow,
    isFixedFlow,
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
      // Preview is the final step — publish straight into the share screen.
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
    // Preview is the final action; every other step is just "Next".
    if (step === 'preview') return editMode ? 'Save changes' : 'Publish';
    return 'Next';
  }, [step, editMode]);

  const meta = STEP_META[step];
  const stepTitle =
    step === 'budget' && isFixedFlow ? 'Pricing' : meta.title;
  const subtitle =
    step === 'budget'
      ? isFixedFlow
        ? 'A fixed price per person, in USD.'
        : editMode
          ? 'Confirm the range for your trip.'
          : meta.subtitle
      : step === 'aboutYou' && isFixedFlow
        ? 'Why surfers can trust your operation.'
        : meta.subtitle;

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
      case 'aboutYou':
        return renderAboutYouStep();
      case 'preview':
        return renderPreviewStep();
    }
  };

  // -----------------------------------------------------------------------
  // STEP 1 — AUDIENCE (all rows open sheets)
  // -----------------------------------------------------------------------
  const renderAudienceStep = () => {
    // First card not yet done is the "active" one; everything below it is
    // locked. -1 means all four are done (every card shows its chips).
    const activeIdx = AUDIENCE_ORDER.findIndex(k => !audienceDone.has(k));
    const statusFor = (key: AudienceCardKey): AudienceCardStatus => {
      if (audienceDone.has(key) || activeIdx === -1) return 'completed';
      return AUDIENCE_ORDER.indexOf(key) === activeIdx ? 'active' : 'locked';
    };

    return (
      <View style={localStyles.audienceStack}>
        <AudienceCard
          title="Surf level"
          description="Select the level of surfing your trip will be built for."
          chips={levelChips(state.skillLevels)}
          image={Images.whoIsItFor.surfLevel}
          status={statusFor('levels')}
          onPress={handleSurfLevelPress}
        />
        <AudienceCard
          title="Board Types"
          description="Select the range of boards your group will be riding."
          chips={styleChips(state.surfStyles)}
          image={Images.whoIsItFor.boardTypes}
          status={statusFor('boards')}
          onPress={() => setOpenSheet('style')}
        />
        <AudienceCard
          title="The Wave"
          description="What type of waves are you looking to surf on this trip?"
          chips={waveChips(state)}
          image={Images.whoIsItFor.theWave}
          status={statusFor('wave')}
          onPress={() => setOpenSheet('wave')}
        />
        <AudienceCard
          title="Age Range"
          description="Select the age range of travelers your trip is built for."
          chips={ageChips(state.ageMin, state.ageMax)}
          image={Images.whoIsItFor.ageRange}
          imageZoom={1.4}
          status={statusFor('age')}
          onPress={() => setOpenSheet('age')}
        />
        {errors.audience ? (
          <Text style={localStyles.errorText}>{errors.audience}</Text>
        ) : null}
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
        {/* Where — its own card, with a map directly beneath it. */}
        <DeetsRow
          icon={Images.tripDeets.location}
          label="Where?"
          value={state.destination}
          placeholder={editMode ? 'Locked' : 'Tap to set'}
          onPress={() => {
            if (!editMode) setOpenSheet('where');
          }}
          error={errors.destination ?? undefined}
          disabled={editMode}
        />

        {/* Before a destination is set: a gray map placeholder with a pin.
            Once picked, it becomes the real map with a marker. */}
        {state.destinationGeo ? (
          <DestinationMapPreview
            geo={state.destinationGeo}
            disabled={editMode}
            onPress={() => setOpenSheet('where')}
          />
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={editMode}
            onPress={() => {
              if (!editMode) setOpenSheet('where');
            }}
            accessibilityRole="button"
            accessibilityLabel="Set destination"
            style={localStyles.mapPlaceholder}
          >
            <View style={localStyles.mapPlaceholderPin}>
              <Ionicons name="location" size={26} color={COLORS.cyan} />
            </View>
            <Text style={localStyles.mapPlaceholderText}>
              Tap to drop your destination pin
            </Text>
          </TouchableOpacity>
        )}

        {editMode ? (
          <Text style={localStyles.helperRowFootnote}>
            Destination can't be changed after a trip is created.
          </Text>
        ) : null}

        {/* When — separate card below the map. */}
        <View style={localStyles.whenGap}>
          <DeetsRow
            icon={Images.tripDeets.dates}
            label="When?"
            value={formatWhenSummary(state)}
            onPress={() => setOpenSheet('when')}
            error={errors.when ?? undefined}
          />
        </View>

        {/* Trip name (inline) */}
        <View style={[localStyles.labelRow, localStyles.groupTopGap]}>
          <Text style={localStyles.fieldLabel}>Trip name</Text>
          <Text style={[localStyles.counter, { color: titleCounterColor }]}>
            {titleLen} / {TRIP_TITLE_MAX_LENGTH}
          </Text>
        </View>
        <View style={[localStyles.inputWrap, !!errors.title && localStyles.inputError]}>
          <Image
            source={Images.tripDeets.pencil}
            style={localStyles.inputPencil}
            resizeMode="contain"
          />
          <TextInput
            ref={titleInputRef}
            style={localStyles.inputField}
            value={state.title}
            onChangeText={t => {
              update('title', t);
              if (errors.title) setError('title', null);
            }}
            onFocus={() => handleFieldFocus(titleInputRef)}
            onBlur={() => {
              if (focusedInputRef.current === titleInputRef.current) {
                focusedInputRef.current = null;
              }
            }}
            placeholder="Bali and Barrels"
            placeholderTextColor={COLORS.textPlaceholder}
            maxLength={TRIP_TITLE_MAX_LENGTH}
            returnKeyType="done"
          />
        </View>
        {errors.title ? (
          <Text style={localStyles.errorText}>{errors.title}</Text>
        ) : null}

        {/* Description — sits between Trip name and Max participants */}
        <View style={[localStyles.labelRow, localStyles.fieldTopGap]}>
          <Text style={localStyles.fieldLabel}>Description</Text>
          <Text style={[localStyles.counter, { color: descCounterColor }]}>
            {descLen} / {DESCRIPTION_MAX_LENGTH}
          </Text>
        </View>
        <View
          style={[
            localStyles.inputWrap,
            localStyles.inputWrapTextarea,
            !!errors.description && localStyles.inputError,
          ]}
        >
          <Image
            source={Images.tripDeets.pencil}
            style={localStyles.inputPencil}
            resizeMode="contain"
          />
          <TextInput
            ref={descInputRef}
            style={[localStyles.inputField, localStyles.inputFieldTextarea]}
            value={state.description}
            onChangeText={t => {
              const next =
                t.length > DESCRIPTION_MAX_LENGTH ? t.slice(0, DESCRIPTION_MAX_LENGTH) : t;
              update('description', next);
              if (errors.description) setError('description', null);
            }}
            onFocus={() => handleFieldFocus(descInputRef)}
            onBlur={() => {
              if (focusedInputRef.current === descInputRef.current) {
                focusedInputRef.current = null;
              }
            }}
            placeholder="Tell people what makes this trip special - the surf, the crew, the place."
            placeholderTextColor={COLORS.textPlaceholder}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            maxLength={DESCRIPTION_MAX_LENGTH}
          />
        </View>
        {errors.description ? (
          <Text style={localStyles.errorText}>{errors.description}</Text>
        ) : null}

        {/* Max participants (inline stepper) */}
        <Text style={[localStyles.fieldLabel, localStyles.fieldTopGap]}>Max participants</Text>
        <Text style={[localStyles.helper, localStyles.helperTight]}>Leave at "Any" for no limit</Text>
        <View style={localStyles.stepperRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Decrease max participants"
            onPress={() => {
              const n = parseInt(state.maxParticipants || '0', 10);
              update('maxParticipants', n <= 2 ? '' : String(n - 1));
            }}
            style={localStyles.stepperBtn}
          >
            <Ionicons name="remove" size={24} color={COLORS.inkBody} />
          </TouchableOpacity>
          <View style={localStyles.stepperValueBox}>
            <Text
              style={[
                localStyles.stepperValue,
                !state.maxParticipants && localStyles.stepperValueAny,
              ]}
            >
              {state.maxParticipants ? state.maxParticipants : 'Any'}
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Increase max participants"
            onPress={() => {
              const n = parseInt(state.maxParticipants || '0', 10);
              update('maxParticipants', String(n < 2 ? 2 : Math.min(n + 1, 50)));
            }}
            style={localStyles.stepperBtn}
          >
            <Ionicons name="add" size={24} color={COLORS.inkBody} />
          </TouchableOpacity>
        </View>

        {/* Cover photo (inline) */}
        <Text style={[localStyles.fieldLabel, localStyles.fieldTopGap]}>Cover photo</Text>
        <Text style={[localStyles.helper, localStyles.coverHelper]}>Keep your subject centered</Text>
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
            const uri = await pickImage([1, 1]);
            if (uri) {
              update('heroImageUri', uri);
              if (errors.heroImage) setError('heroImage', null);
            }
          }}
          style={[
            localStyles.photoZone,
            // Filled cover renders 1:1 (matches the crop + the trip pages); the
            // empty dashed frame keeps its original wide size.
            !!state.heroImageUri && localStyles.photoZoneFilled,
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
              <Image
                source={Images.tripDeets.coverPhoto}
                style={localStyles.photoEmptyIcon}
                resizeMode="contain"
              />
              <Text style={localStyles.photoEmptyText}>Tap to add cover photo</Text>
            </View>
          )}
        </TouchableOpacity>
        {errors.heroImage ? <Text style={localStyles.errorText}>{errors.heroImage}</Text> : null}
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // STEP 3 — VIBEZ (sheets + inline Yes/No gate + conditional details row)
  // -----------------------------------------------------------------------
  const renderVibezStep = () => {
    const lockedAnswer = state.accommodationLocked;
    const canToggle = !editMode;
    const hasStayInfo =
      !!state.accommodationName.trim() ||
      !!state.accommodationUrl.trim() ||
      !!state.accommodationImageUri;

    return (
      <View>
        <View style={localStyles.summaryGroup}>
          <SummaryRow
            label="How it works"
            value={formatTagsSummary(state.tripStructure, TRIP_STRUCTURE_OPTIONS)}
            onPress={() => setOpenSheet('howWorks')}
            noTopDivider
            placeholderAccent
            icon={<Ionicons name="list-outline" size={18} color={COLORS.inkBody} />}
          />
          <SummaryRow
            label="Vibe"
            value={formatTagsSummary(state.tripVibes, TRIP_VIBE_OPTIONS)}
            onPress={() => setOpenSheet('vibe')}
            placeholderAccent
            icon={<TripIcon name="sun-setting-03" size={18} />}
          />
          <SummaryRow
            label="Stay type"
            value={state.accommodationKind ? ACCOMMODATION_LABEL[state.accommodationKind] : ''}
            onPress={() => setOpenSheet('stayType')}
            error={errors.accommodationKind ?? undefined}
            placeholderAccent
            icon={<TripIcon name="home-03" size={18} />}
          />
        </View>

        {/* Specific-stay: B & C always have one (no gate); A uses the Yes/No gate. */}
        {requiresSpecificStay ? (
          <>
            <Text style={[localStyles.fieldLabel, localStyles.groupTopGap]}>Your stay</Text>
            <Text style={localStyles.helper}>
              {isLeaderFlow
                ? 'As the Captain, add the place you’ll all stay at.'
                : 'Add the place everyone will stay at.'}
            </Text>
          </>
        ) : (
          <>
        <Text style={[localStyles.gateSectionTitle, localStyles.groupTopGap]}>
          Did you decide on a specific stay?
        </Text>
        <Text style={localStyles.helper}>
          {editMode
            ? 'Locked from when you first published.'
            : "You can't change this after you publish."}
        </Text>
        <View style={localStyles.gateList}>
          {(
            [
              {
                key: false as const,
                icon: 'marker-pin-05' as const,
                title: 'No',
                subtitle: 'Still looking - flexible',
              },
              {
                key: true as const,
                icon: 'home-03' as const,
                title: 'Yes',
                subtitle: 'I have a place locked in',
              },
            ] as {
              key: boolean;
              icon: 'marker-pin-05' | 'home-03';
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
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${opt.title} — ${opt.subtitle}`}
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
                  localStyles.gateCardRow,
                  selected && localStyles.gateCardRowActive,
                  dimmed && localStyles.gateCardDisabled,
                ]}
              >
                <View style={localStyles.gateCardInner}>
                  <View style={localStyles.gateIconBubble}>
                    <TripIcon name={opt.icon} size={18} color={COLORS.inkBody} />
                  </View>
                  <View style={localStyles.gateTextCol}>
                    <Text style={localStyles.gateRowTitle}>{opt.title}</Text>
                    <Text style={localStyles.gateRowSubtitle}>{opt.subtitle}</Text>
                  </View>
                  <View
                    style={[
                      localStyles.gateCheckbox,
                      selected ? localStyles.gateCheckboxOn : localStyles.gateCheckboxOff,
                    ]}
                  >
                    {selected ? (
                      <MaterialCommunityIcons name="check-bold" size={14} color="#FFFFFF" />
                    ) : null}
                  </View>
                </View>

                {/* Stay preview — nested inside the Yes card once details are added. */}
                {opt.key === true && selected && hasStayInfo ? (
                  <View style={localStyles.stayPreview}>
                    {state.accommodationImageUri ? (
                      <Image
                        source={{ uri: state.accommodationImageUri }}
                        style={localStyles.stayPreviewPhoto}
                        resizeMode="cover"
                      />
                    ) : null}
                    <View style={localStyles.stayPreviewInfo}>
                      <View style={localStyles.stayPreviewIconCircle}>
                        <TripIcon name="home-03" size={18} color={COLORS.inkBody} />
                      </View>
                      <View style={localStyles.stayPreviewTextCol}>
                        <Text style={localStyles.stayPreviewName} numberOfLines={1}>
                          {state.accommodationName.trim() || 'Your stay'}
                        </Text>
                        {state.accommodationUrl.trim() ? (
                          <Text style={localStyles.stayPreviewUrl} numberOfLines={1}>
                            {state.accommodationUrl.trim()}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
        {errors.accommodationGate ? (
          <Text style={localStyles.errorText}>{errors.accommodationGate}</Text>
        ) : null}
          </>
        )}
        {errors.specificStay ? (
          <Text style={localStyles.errorText}>{errors.specificStay}</Text>
        ) : null}

        {/* Stay details — B & C. Wears the same gate-card language as the Flow A
            Yes/No buttons: white card + shadow, grey icon bubble, title +
            subtitle, and a circular affordance on the right. Empty = "+" to add;
            filled = the stay name/url, a pencil, and the photo nested below
            (same big preview the Flow A Yes card uses). */}
        {requiresSpecificStay ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              setOpenSheet('specificStay');
              if (errors.specificStay) setError('specificStay', null);
            }}
            accessibilityRole="button"
            accessibilityLabel={hasStayInfo ? 'Edit stay details' : 'Add stay details'}
            style={[
              localStyles.gateCardRow,
              localStyles.stayGateCard,
              hasStayInfo && localStyles.gateCardRowActive,
            ]}
          >
            <View style={localStyles.gateCardInner}>
              <View style={localStyles.stayIconBubble}>
                <TripIcon name="home-03" size={26} color={COLORS.inkBody} />
              </View>
              <View style={localStyles.gateTextCol}>
                <Text style={localStyles.stayGateTitle} numberOfLines={1}>
                  {hasStayInfo
                    ? state.accommodationName.trim() || 'Your stay'
                    : 'Add stay details'}
                </Text>
                <Text style={localStyles.gateRowSubtitle} numberOfLines={1}>
                  {hasStayInfo
                    ? formatStayProgress(state)
                    : 'Add the name, link and a photo'}
                </Text>
              </View>
              {hasStayInfo ? (
                // Bare pencil — same asset as the stay sheet, no surrounding box.
                <Image
                  source={Images.tripDeets.pencil}
                  style={localStyles.stayEditIcon}
                  resizeMode="contain"
                />
              ) : (
                // Bare cyan "+" — same affordance as the "Who is it for?" cards.
                <Ionicons name="add" size={24} color="#05BCD3" />
              )}
            </View>

            {hasStayInfo && state.accommodationImageUri ? (
              <Image
                source={{ uri: state.accommodationImageUri }}
                style={localStyles.stayPreviewPhoto}
                resizeMode="cover"
              />
            ) : null}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // STEP 4 (Flow C) — PRICING (fixed per-person price + "What's included")
  // -----------------------------------------------------------------------
  const setInclusions = (patch: Partial<PriceInclusions>) => {
    setState(s => ({ ...s, priceInclusions: { ...s.priceInclusions, ...patch } }));
    if (!hasBeenTouched) setHasBeenTouched(true);
  };

  // Guard against legacy/garbage shapes (e.g. an old draft where custom was a
  // string) so nothing ever crashes on `.map`.
  const customList: PriceInclusions['custom'] = Array.isArray(state.priceInclusions.custom)
    ? state.priceInclusions.custom
    : [];

  // Closing the "add your own" sheet — drop the item if it was left blank
  // (an abandoned "+ Add" shouldn't leave an empty row behind).
  const closeCustomSheet = () => {
    setState(s => {
      const list = Array.isArray(s.priceInclusions.custom) ? s.priceInclusions.custom : [];
      const pruned = list.filter(c => c.title.trim() || c.description?.trim());
      return { ...s, priceInclusions: { ...s.priceInclusions, custom: pruned } };
    });
    setCustomEditIndex(null);
    setOpenSheet(null);
  };

  const renderPricingStep = () => {
    const inc = state.priceInclusions;
    const customItems = customList;
    const rows: {
      key: keyof PriceInclusions;
      sheet: SheetKey;
      icon: keyof typeof Ionicons.glyphMap;
    }[] = [
      { key: 'meals', sheet: 'incMeals', icon: 'restaurant-outline' },
      { key: 'accommodation', sheet: 'incAccommodation', icon: 'bed-outline' },
      { key: 'transportation', sheet: 'incTransportation', icon: 'car-outline' },
      { key: 'surfSessions', sheet: 'incSurfSessions', icon: 'water-outline' },
      { key: 'surfEquipment', sheet: 'incSurfEquipment', icon: 'construct-outline' },
      { key: 'surfFilm', sheet: 'incSurfFilm', icon: 'film-outline' },
      { key: 'videoAnalysis', sheet: 'incVideoAnalysis', icon: 'videocam-outline' },
      { key: 'activities', sheet: 'incActivities', icon: 'compass-outline' },
      { key: 'wellness', sheet: 'incWellness', icon: 'leaf-outline' },
    ];

    return (
      <View>
        <Text style={localStyles.fieldLabel}>Price per person · USD</Text>
        <View style={localStyles.priceRow}>
          <View style={localStyles.priceIconBubble}>
            <TripIcon name="currency-dollar-circle" size={22} color={COLORS.inkBody} />
          </View>
          <TextInput
            style={[
              localStyles.input,
              { flex: 1 },
              !!errors.price && localStyles.inputError,
            ]}
            value={state.costPerPerson}
            onChangeText={t => {
              update('costPerPerson', t.replace(/[^0-9]/g, ''));
              if (errors.price) setError('price', null);
            }}
            placeholder="3000"
            placeholderTextColor={COLORS.textPlaceholder}
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>
        {errors.price ? <Text style={localStyles.errorText}>{errors.price}</Text> : null}

        <Text style={[localStyles.sectionTitle, localStyles.groupTopGap]}>What's included</Text>
        <Text style={localStyles.helper}>
          Tap each to set what the price covers. Everything here is optional.
        </Text>
        <View style={[localStyles.summaryGroup, { marginTop: 12 }]}>
          {rows.map((r, i) => (
            <SummaryRow
              key={r.key}
              label={CATEGORY_TITLE[r.key]}
              value={summarizeCategory(inc, r.key)}
              placeholder="Not included"
              placeholderAccent
              onPress={() => setOpenSheet(r.sheet)}
              noTopDivider={i === 0}
              icon={<Ionicons name={r.icon} size={18} color={COLORS.inkBody} />}
            />
          ))}
        </View>

        <Text style={[localStyles.fieldLabel, localStyles.fieldTopGap]}>Add your own</Text>
        {customItems.length > 0 ? (
          <View style={[localStyles.summaryGroup, { marginTop: 12 }]}>
            {customItems.map((item, i) => (
              <SummaryRow
                key={i}
                label={item.title.trim() || 'Untitled'}
                value={item.description?.trim() || ''}
                placeholder="Tap to edit"
                onPress={() => {
                  setCustomEditIndex(i);
                  setOpenSheet('incCustom');
                }}
                noTopDivider={i === 0}
              />
            ))}
          </View>
        ) : null}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            const next = [...customItems, { title: '', description: '' }];
            setInclusions({ custom: next });
            setCustomEditIndex(next.length - 1);
            setOpenSheet('incCustom');
          }}
          style={[localStyles.gateCardRow, localStyles.stayGateCard]}
          accessibilityRole="button"
          accessibilityLabel="Add your own inclusion"
        >
          <View style={localStyles.gateCardInner}>
            <View style={localStyles.stayIconBubble}>
              <Ionicons name="sparkles-outline" size={24} color={COLORS.inkBody} />
            </View>
            <View style={localStyles.gateTextCol}>
              <Text style={localStyles.stayGateTitle}>
                {customItems.length > 0 ? 'Add another' : 'Add an inclusion'}
              </Text>
              <Text style={localStyles.gateRowSubtitle}>
                Anything extra the price covers.
              </Text>
            </View>
            <Ionicons name="add" size={24} color="#05BCD3" />
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // STEP 4 — BUDGET
  // -----------------------------------------------------------------------
  const renderBudgetStep = () => {
    if (isFixedFlow) return renderPricingStep();
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
                We couldn't estimate this one - enter a range yourself.
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
        <View style={localStyles.budgetLoading}>
          <Ionicons
            name="sparkles"
            size={36}
            color="#212121"
            style={localStyles.budgetLoadingIcon}
          />
          <Text style={localStyles.budgetLoadingTitle}>Estimating your budget…</Text>
          <Text style={localStyles.budgetLoadingSub}>
            Crunching your destination, dates and stay.
          </Text>
          <ActivityIndicator
            color="#05BCD3"
            style={{ marginTop: 20 }}
          />
        </View>
      );
    }

    const days = tripDurationDays();
    const accKind = state.accommodationKind ? ACCOMMODATION_LABEL[state.accommodationKind] : '';
    const basedOnTags = [
      state.destination || 'your destination',
      `${days} day${days === 1 ? '' : 's'}`,
      ...(accKind ? [accKind.toLowerCase()] : []),
    ];

    return (
      <FadeInView style={localStyles.budgetWrap}>
        <BudgetTierCardsBig
          ranges={budgetEstimate.ranges}
          selected={state.budgetTier}
          onChange={tier => {
            update('budgetTier', tier);
            if (errors.budget) setError('budget', null);
          }}
          basedOnTags={basedOnTags}
          error={errors.budget ?? undefined}
        />
      </FadeInView>
    );
  };

  // -----------------------------------------------------------------------
  // STEP (Flow B) — ABOUT YOU (the leader): embedded profile + trip expertise
  // -----------------------------------------------------------------------
  const renderAboutYouStep = () => {
    const s = hostSurfer;
    const age = s?.date_of_birth ? ageFromDob(s.date_of_birth) : null;
    const levelLabel = s?.surf_level_category ? capitalizeFirst(String(s.surf_level_category)) : null;
    const boardLabel = s?.surfboard_type
      ? BOARD_TYPE_OPTIONS.find(o => o.key === s.surfboard_type)?.label ??
        capitalizeFirst(String(s.surfboard_type))
      : null;
    const trips = typeof s?.travel_experience === 'number' ? s.travel_experience : null;
    const destLabel = state.destination || 'the destination';
    const stayLabel = state.accommodationName || 'your stay';
    const destFamLabel = state.hostDestFamiliarity
      ? DESTINATION_FAMILIARITY_OPTIONS.find(o => o.slug === state.hostDestFamiliarity)?.label ?? ''
      : '';
    const stayFamLabel = state.hostStayFamiliarity
      ? STAY_FAMILIARITY_OPTIONS.find(o => o.slug === state.hostStayFamiliarity)?.label ?? ''
      : '';
    // Two lines of pills: top = trips + board, bottom = level, age, origin.
    const tagsTop = [
      trips != null ? `${trips} Surf Trips` : null,
      boardLabel,
    ].filter(Boolean) as string[];
    const tagsBottom = [
      levelLabel,
      age != null ? `${age}` : null,
      s?.country_from || null,
    ].filter(Boolean) as string[];

    return (
      <View>
        {/* Floating, tappable profile card — same language as the "Who is it
            for?" cards: circle avatar, name header, gray info tags. Tapping the
            card opens the profile editor (no separate "Edit profile" link). */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setEditingProfile(true)}
          style={localStyles.leaderCard}
          accessibilityRole="button"
          accessibilityLabel="Edit your profile"
        >
          {s?.profile_image_url ? (
            <Image source={{ uri: s.profile_image_url }} style={localStyles.leaderAvatar} />
          ) : (
            <View style={[localStyles.leaderAvatar, localStyles.leaderAvatarEmpty]}>
              <Ionicons name="person" size={28} color="#FFFFFF" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={localStyles.leaderName} numberOfLines={1}>
              {s?.name || 'You'}
            </Text>
            {tagsTop.length ? (
              <View style={localStyles.leaderTagsRow}>
                {tagsTop.map((t, i) => (
                  <View key={`top-${t}-${i}`} style={localStyles.leaderTag}>
                    <Text style={localStyles.leaderTagText} numberOfLines={1}>
                      {t}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {tagsBottom.length ? (
              <View style={[localStyles.leaderTagsRow, localStyles.leaderTagsRowSecond]}>
                {tagsBottom.map((t, i) => (
                  <View key={`bot-${t}-${i}`} style={localStyles.leaderTag}>
                    <Text style={localStyles.leaderTagText} numberOfLines={1}>
                      {t}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </TouchableOpacity>

        <Text style={[localStyles.fieldLabel, localStyles.aboutSectionGap]}>Trip expertise</Text>
        <Text style={localStyles.aboutSubtitle}>
          How well you know the destination and stay.
        </Text>
        <View style={localStyles.summaryGroup}>
          <SummaryRow
            label={destLabel}
            value={destFamLabel}
            placeholder="Tap to set"
            placeholderAccent
            icon={<TripIcon name="marker-pin-05" size={18} />}
            onPress={() => {
              setOpenSheet('destFamiliarity');
              if (errors.hostDestFamiliarity) setError('hostDestFamiliarity', null);
            }}
            error={errors.hostDestFamiliarity ?? undefined}
            noTopDivider
          />
          <SummaryRow
            label={stayLabel}
            value={stayFamLabel}
            placeholder="Tap to set"
            placeholderAccent
            icon={<TripIcon name="home-03" size={18} />}
            onPress={() => {
              setOpenSheet('stayFamiliarity');
              if (errors.hostStayFamiliarity) setError('hostStayFamiliarity', null);
            }}
            error={errors.hostStayFamiliarity ?? undefined}
          />
        </View>

        <Text style={[localStyles.fieldLabel, localStyles.aboutSectionGap]}>
          {isFixedFlow ? 'Why surfers can trust your operation' : 'Why you’re the right Captain'}
        </Text>
        <Text
          style={[
            localStyles.counter,
            localStyles.leadCounter,
            { color: state.hostLeadNote.length >= 250 ? COLORS.errorText : COLORS.textMuted },
          ]}
        >
          {state.hostLeadNote.length}/250
        </Text>
        <View style={[localStyles.inputWrap, localStyles.inputWrapTextarea]}>
          <Image
            source={Images.tripDeets.pencil}
            style={localStyles.inputPencil}
            resizeMode="contain"
          />
          <TextInput
            style={[localStyles.inputField, localStyles.inputFieldTextarea]}
            value={state.hostLeadNote}
            onChangeText={t => update('hostLeadNote', t.slice(0, 250))}
            placeholder="Mention anything that brings credibility to your experience here"
            placeholderTextColor={COLORS.textPlaceholder}
            multiline
            maxLength={250}
            textAlignVertical="top"
          />
        </View>
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // STEP 5 — PREVIEW (identical to the live non-member view: TripDetailViewRedesigned)
  // -----------------------------------------------------------------------
  const renderPreviewStep = () => {
    const previewVM: TripDetailVM = {
      heroImageUri: state.heroImageUri,
      title: state.title || null,
      destinationLabel: state.destination || null,
      startDateISO: state.datesMode === 'exact' ? state.startDateISO : null,
      endDateISO: state.datesMode === 'exact' ? state.endDateISO : null,
      dateMonths:
        state.datesMode === 'months'
          ? expandMonthRange(state.monthFrom, state.monthTo)
          : null,
      durationDays: state.durationDays,
      skillLevels: state.skillLevels,
      ageMin: state.ageMin ? parseInt(state.ageMin, 10) : null,
      ageMax: state.ageMax ? parseInt(state.ageMax, 10) : null,
      participantCount: 1, // pre-publish: just the host
      maxParticipants: state.maxParticipants ? parseInt(state.maxParticipants, 10) : null,
      description: state.description || '',
      vibeSlug: state.tripVibes[0] ?? null,
      surfStyles: state.surfStyles,
      structureSlugs: state.tripStructure,
      waveSizeMin: state.waveSizeMin,
      waveSizeMax: state.waveSizeMax,
      waveShapeLabel: state.waveShape ? WAVE_SHAPE_TITLE[state.waveShape] : null,
      specificStaySelected: requiresSpecificStay ? true : state.accommodationLocked,
      accommodationKindLabel: state.accommodationKind
        ? ACCOMMODATION_LABEL[state.accommodationKind]
        : null,
      accommodationName:
        requiresSpecificStay || state.accommodationLocked
          ? state.accommodationName || null
          : null,
      accommodationImageUri:
        requiresSpecificStay || state.accommodationLocked ? state.accommodationImageUri : null,
      accommodationUrl:
        requiresSpecificStay || state.accommodationLocked
          ? state.accommodationUrl || null
          : null,
      costPerPerson:
        isFixedFlow && state.costPerPerson ? parseInt(state.costPerPerson, 10) : null,
      priceInclusions: isFixedFlow
        ? normalizePriceInclusions(state.priceInclusions)
        : null,
      budgetMin: isFixedFlow ? null : resolveBudget().min,
      budgetMax: isFixedFlow ? null : resolveBudget().max,
      budgetTier: isFixedFlow || state.manualBudget ? null : state.budgetTier,
      hostingStyle: effectiveStyle,
      leader: hasAboutYou
        ? {
            name: hostSurfer?.name ?? null,
            avatarUrl: hostSurfer?.profile_image_url ?? null,
            age: hostSurfer?.date_of_birth ? ageFromDob(hostSurfer.date_of_birth) : null,
            countryFrom: hostSurfer?.country_from ?? null,
            surfLevelLabel: hostSurfer?.surf_level_category
              ? capitalizeFirst(String(hostSurfer.surf_level_category))
              : null,
            tripsCount:
              typeof hostSurfer?.travel_experience === 'number'
                ? hostSurfer.travel_experience
                : null,
            destinationFamiliarityLabel: state.hostDestFamiliarity
              ? DESTINATION_FAMILIARITY_OPTIONS.find(o => o.slug === state.hostDestFamiliarity)
                  ?.label ?? null
              : null,
            stayFamiliarityLabel: state.hostStayFamiliarity
              ? STAY_FAMILIARITY_OPTIONS.find(o => o.slug === state.hostStayFamiliarity)?.label ??
                null
              : null,
            leadNote: state.hostLeadNote.trim() || null,
          }
        : null,
    };

    // Render the EXACT component a non-member sees on the live trip screen
    // (TripDetailViewRedesigned), in visitor configuration: no host edit pills,
    // no Overview/Plan toggle. The "Request to join" CTA lives on TripDetailScreen
    // (not this component), so it never appears here — the wizard footer keeps the
    // "Publish" button instead.
    return (
      <TripDetailViewRedesigned
        vm={previewVM}
        participants={
          hostSurfer
            ? [
                {
                  id: hostId ?? 'host',
                  avatarUrl: hostSurfer.profile_image_url ?? null,
                  name: hostSurfer.name ?? null,
                },
              ]
            : []
        }
        isHost={false}
        aboutHost={{
          name: hostSurfer?.name ?? null,
          avatarUrl: hostSurfer?.profile_image_url ?? null,
          bio: state.hostLeadNote.trim() || null,
          age: hostSurfer?.date_of_birth ? ageFromDob(hostSurfer.date_of_birth) : null,
          countryFrom: hostSurfer?.country_from ?? null,
          surfLevelLabel: hostSurfer?.surf_level_category
            ? capitalizeFirst(String(hostSurfer.surf_level_category))
            : null,
          boardLabel: hostSurfer?.surfboard_type
            ? BOARD_TYPE_OPTIONS.find(o => o.key === hostSurfer.surfboard_type)?.label ??
              capitalizeFirst(String(hostSurfer.surfboard_type))
            : null,
          surfTrips:
            typeof hostSurfer?.travel_experience === 'number'
              ? hostSurfer.travel_experience
              : null,
          destinationFamiliarityLabel: state.hostDestFamiliarity
            ? DESTINATION_FAMILIARITY_OPTIONS.find(o => o.slug === state.hostDestFamiliarity)
                ?.label ?? null
            : null,
          stayFamiliarityLabel: state.hostStayFamiliarity
            ? STAY_FAMILIARITY_OPTIONS.find(o => o.slug === state.hostStayFamiliarity)?.label ??
              null
            : null,
        }}
      />
    );
  };

  // Suppress unused-variable warning while keeping the read for future use.
  void firstErrorField;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const closeSheet = () => {
    // Closing an audience sheet marks its card done, which unlocks the next
    // card in the strict-sequential audience flow.
    if (openSheet === 'levels') markAudienceDone('levels');
    else if (openSheet === 'style') markAudienceDone('boards');
    else if (openSheet === 'wave') markAudienceDone('wave');
    else if (openSheet === 'age') markAudienceDone('age');
    setOpenSheet(null);
  };

  // "Select" footer for the audience sheets (Figma node 12656:4247). Confirms +
  // closes — which also marks the card done via closeSheet.
  const sheetSelectFooter = (
    <TouchableOpacity
      onPress={closeSheet}
      activeOpacity={0.85}
      style={localStyles.sheetSelectBtn}
      accessibilityRole="button"
      accessibilityLabel="Select"
    >
      <Text style={localStyles.sheetSelectBtnText}>Select</Text>
    </TouchableOpacity>
  );

  // Post-publish: show the Published / invite-friends screen until Done.
  if (published) {
    return (
      <TripPublishedScreen
        tripId={published.id}
        tripTitle={published.title}
        heroImageUri={published.hero}
        onDone={onCreated}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <CreateTripWizardChrome
        stepIndex={stepIdx}
        stepCount={steps.length}
        stepTitle={step === 'preview' ? state.title || 'Preview' : stepTitle}
        stepSubtitle={subtitle}
        primaryLabel={ctaLabel}
        secondaryLabel={stepIdx === 0 ? 'Cancel' : 'Back'}
        onPrimary={onPrimary}
        onSecondary={onSecondary}
        onClose={guardedCancel}
        submitting={submitting}
        hideProgress
        flushContent={step === 'preview'}
        focusedInputRef={focusedInputRef}
        keyboardScrollRef={keyboardScrollRef}
        suppressKeyboardScroll={openSheet !== null}
      >
        {renderStep()}
      </CreateTripWizardChrome>

      {/* One-time "this is about the group" reminder (first Surf level tap). */}
      <WizardInfoOverlay
        visible={showAudienceIntro}
        title={AUDIENCE_INTRO_TITLE}
        message={AUDIENCE_INTRO_MESSAGE}
        onDismiss={dismissAudienceIntro}
      />

      {/* ------- Sheets ------- */}

      {/* Step 1 sheets */}
      <WizardBottomSheet
        visible={openSheet === 'levels'}
        title="Surf Level"
        subtitle="You can select more than one"
        largeTitle
        titleAlign="left"
        hideHeaderDivider
        footer={sheetSelectFooter}
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
        titleAlign="left"
        hideHeaderDivider
        footer={sheetSelectFooter}
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
        title="Boards we will ride."
        subtitle="You can select more than one"
        largeTitle
        titleAlign="left"
        hideHeaderDivider
        footer={sheetSelectFooter}
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
        subtitle={`Must span at least ${ageWindow} ${ageWindow === 1 ? 'year' : 'years'}`}
        largeTitle
        hideHeaderDivider
        extendBehindKeyboard
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
          onClose={closeSheet}
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
        titleAlign="left"
        onClose={closeSheet}
        heightMode="full"
        extendBehindKeyboard
        footer={
          <TouchableOpacity
            onPress={closeSheet}
            activeOpacity={0.85}
            style={localStyles.sheetSelectBtn}
            accessibilityRole="button"
            accessibilityLabel="Set dates and close"
          >
            <Text style={localStyles.sheetSelectBtnText}>Set</Text>
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
          lockCalendar={isFixedFlow}
        />
      </WizardBottomSheet>

      {/* Step 3 sheets */}
      <WizardBottomSheet
        visible={openSheet === 'howWorks'}
        title="How does it work?"
        titleAlign="left"
        hideHeaderDivider
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
        titleAlign="left"
        hideHeaderDivider
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
        titleAlign="left"
        hideHeaderDivider
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
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
        heightMode="full"
        extendBehindKeyboard
        footer={
          <TouchableOpacity
            onPress={closeSheet}
            activeOpacity={0.85}
            style={localStyles.sheetSetBtn}
            accessibilityRole="button"
            accessibilityLabel="Save stay details and close"
          >
            <Text style={localStyles.sheetSetBtnText}>Save</Text>
          </TouchableOpacity>
        }
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

      {/* Flow B — familiarity pickers (single-select) */}
      <WizardBottomSheet
        visible={openSheet === 'destFamiliarity'}
        title="How well do you know the destination?"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <TripTagPicker<DestinationFamiliarity>
          options={DESTINATION_FAMILIARITY_OPTIONS}
          selected={state.hostDestFamiliarity ? [state.hostDestFamiliarity] : []}
          singleSelect
          onChange={next => {
            update('hostDestFamiliarity', next[0] ?? null);
            if (errors.hostDestFamiliarity) setError('hostDestFamiliarity', null);
            if (!hasBeenTouched) setHasBeenTouched(true);
            closeSheet();
          }}
          accessibilityLabel="Destination familiarity"
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'stayFamiliarity'}
        title="How well do you know the stay?"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <TripTagPicker<StayFamiliarity>
          options={STAY_FAMILIARITY_OPTIONS}
          selected={state.hostStayFamiliarity ? [state.hostStayFamiliarity] : []}
          singleSelect
          onChange={next => {
            update('hostStayFamiliarity', next[0] ?? null);
            if (errors.hostStayFamiliarity) setError('hostStayFamiliarity', null);
            if (!hasBeenTouched) setHasBeenTouched(true);
            closeSheet();
          }}
          accessibilityLabel="Stay familiarity"
        />
      </WizardBottomSheet>

      {/* Flow C — "What's included" category sheets */}
      <WizardBottomSheet
        visible={openSheet === 'incMeals'}
        title="Meals"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <TripTagPicker<string>
          options={[...MEALS_OPTIONS]}
          selected={state.priceInclusions.meals ?? []}
          onChange={next => setInclusions({ meals: next })}
          accessibilityLabel="Meals included"
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incAccommodation'}
        title="Accommodation"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <TripTagPicker<string>
          options={[...ACCOMMODATION_INCL_OPTIONS]}
          selected={state.priceInclusions.accommodation ?? []}
          onChange={next => setInclusions({ accommodation: next })}
          accessibilityLabel="Accommodation included"
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incTransportation'}
        title="Transportation"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <TripTagPicker<string>
          options={[...TRANSPORTATION_OPTIONS]}
          selected={state.priceInclusions.transportation ?? []}
          onChange={next => setInclusions({ transportation: next })}
          accessibilityLabel="Transportation included"
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incSurfSessions'}
        title="Surf sessions"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <TripTagPicker<string>
          options={[...SURF_SESSIONS_OPTIONS]}
          selected={state.priceInclusions.surfSessions ?? []}
          onChange={next => setInclusions({ surfSessions: next })}
          accessibilityLabel="Surf sessions included"
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incSurfEquipment'}
        title="Surf equipment"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <TripTagPicker<string>
          options={[...SURF_EQUIPMENT_OPTIONS]}
          selected={state.priceInclusions.surfEquipment ?? []}
          onChange={next => setInclusions({ surfEquipment: next })}
          accessibilityLabel="Surf equipment included"
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incSurfFilm'}
        title="Filmed surf sessions"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <SurfFilmSheetContent
          value={state.priceInclusions.surfFilm ?? {}}
          onChange={next => setInclusions({ surfFilm: next })}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incVideoAnalysis'}
        title="Video analysis"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <VideoAnalysisSheetContent
          value={state.priceInclusions.videoAnalysis ?? {}}
          onChange={next => setInclusions({ videoAnalysis: next })}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incActivities'}
        title="Activities & excursions"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <ActivitiesSheetContent
          value={state.priceInclusions.activities ?? []}
          onChange={next => setInclusions({ activities: next })}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incWellness'}
        title="Wellness & recovery"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeSheet}
      >
        <WellnessSheetContent
          value={state.priceInclusions.wellness ?? []}
          onChange={next => setInclusions({ wellness: next })}
        />
      </WizardBottomSheet>

      <WizardBottomSheet
        visible={openSheet === 'incCustom'}
        title="Add your own"
        titleAlign="left"
        hideHeaderDivider
        onClose={closeCustomSheet}
        heightMode="full"
        extendBehindKeyboard
      >
        <CustomInclusionSheetContent
          value={
            customEditIndex != null
              ? customList[customEditIndex] ?? { title: '', description: '' }
              : { title: '', description: '' }
          }
          onChange={next => {
            if (customEditIndex == null) return;
            setInclusions({
              custom: customList.map((c, j) => (j === customEditIndex ? next : c)),
            });
          }}
          onRemove={() => {
            if (customEditIndex == null) return;
            setInclusions({ custom: customList.filter((_, j) => j !== customEditIndex) });
            setCustomEditIndex(null);
            setOpenSheet(null);
          }}
        />
      </WizardBottomSheet>

      {/* Flow B — edit-profile takeover (slides over the wizard). */}
      {hostSurfer ? (
        <ProfileEditPanel
          visible={editingProfile}
          onClose={() => {
            setEditingProfile(false);
            void loadHostSurfer();
          }}
          surfer={hostSurfer}
        />
      ) : null}
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
  // Audience step — full-width cards stacked vertically (Figma 12650:4011).
  audienceStack: {
    gap: 16,
    marginHorizontal: 4,
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
  // Audience-sheet "Select" footer button — Figma node 12656:4247.
  sheetSelectBtn: {
    backgroundColor: '#212121',
    height: 62,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 28,
  },
  sheetSelectBtnText: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    color: '#FFFFFF',
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
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
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
  // About-you step — roomier gap between sections + a gray subtitle under each
  // header for breathing space.
  aboutSectionGap: {
    marginTop: 44,
  },
  aboutSubtitle: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: COLORS.textMuted,
    marginTop: -2,
    marginBottom: 14,
  },
  // Char counter for the lead note — right-aligned, just above the bubble.
  leadCounter: {
    alignSelf: 'flex-end',
    marginBottom: 6,
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
  // Pulls a helper tight under its title (same 4px gap as Cover photo).
  helperTight: {
    marginTop: -4,
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
  // Gap between the Where map and the separate When card.
  whenGap: {
    marginTop: 16,
  },
  // Gray "map" placeholder shown under Where before a destination is picked.
  mapPlaceholder: {
    marginTop: 8,
    height: DEST_MAP_HEIGHT,
    borderRadius: 20,
    backgroundColor: '#EDEFF1',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mapPlaceholderPin: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  mapPlaceholderText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  input: {
    height: 56,
    borderWidth: 1,
    borderColor: COLORS.borderHairline,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontFamily: FONT_INTER,
    fontSize: 16,
    color: COLORS.inkBody,
    backgroundColor: COLORS.surfaceCard,
  },
  // Bordered field with a leading pencil icon (Trip name + Description),
  // matching the Figma data-entry inputs.
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    borderWidth: 1,
    borderColor: COLORS.borderHairline,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.surfaceCard,
  },
  inputWrapTextarea: {
    height: 150,
    alignItems: 'flex-start',
    paddingVertical: 16,
  },
  inputPencil: {
    width: 22,
    height: 22,
  },
  inputField: {
    flex: 1,
    // Let the row's `alignItems: 'center'` center the single line; an explicit
    // lineHeight gives descenders room so nothing clips (the reason the old
    // stretch hack existed). No alignSelf stretch — that left iOS text sitting
    // low and out of line with the pencil icon.
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 20,
    color: COLORS.inkBody,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  inputFieldTextarea: {
    height: 118,
    alignSelf: 'auto',
    textAlignVertical: 'top',
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

  // Flow C — fixed price input with a $ prefix.
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priceIconBubble: {
    backgroundColor: '#F7F7F7',
    borderRadius: 10,
    padding: 11,
    alignItems: 'center',
    justifyContent: 'center',
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
  // Once a cover is picked, the frame becomes square to match the 1:1 crop and
  // how it renders on the trip pages.
  photoZoneFilled: {
    aspectRatio: 1,
  },
  photoZoneEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.borderField,
    backgroundColor: COLORS.surfaceCard,
  },
  photoZoneError: {
    borderColor: COLORS.errorBorder,
  },
  photoFilled: {
    width: '100%',
    height: '100%',
  },
  photoEmptyInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  photoEmptyIcon: {
    width: 40,
    height: 36,
  },
  // Cover-photo subtitle: tucked closer to the title, with breathing room
  // before the dashed drop zone.
  coverHelper: {
    marginTop: -4,
    marginBottom: 14,
  },
  photoEmptyText: {
    fontFamily: FONT_INTER,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: '#05BCD3',
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

  // Accommodation gate — full-width stacked cards (Figma node 12635:3734)
  gateSectionTitle: {
    fontFamily: FONT_INTER,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: COLORS.inkBody,
    marginBottom: 4,
  },
  gateList: {
    gap: 16,
    marginTop: 16,
  },
  // Single gate-style stay card (B & C) — sits below the "Your stay" helper.
  // Roomier padding than the Yes/No gate cards to breathe around the bigger
  // icon box + the right-side affordance.
  stayGateCard: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  // Bigger grey icon box than the Yes/No gate bubble (the stay card's own).
  stayIconBubble: {
    width: 56,
    height: 56,
    backgroundColor: '#F7F7F7',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Title sized to match the "Who is it for?" audience-card headers (17px).
  stayGateTitle: {
    fontFamily: FONT_INTER,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: COLORS.inkBody,
  },
  // Bare edit pencil — same asset the stay bottom sheet uses on its fields.
  stayEditIcon: {
    width: 22,
    height: 22,
  },
  gateCardRow: {
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent', // reserves space so the selected border adds no shift
    backgroundColor: COLORS.surfaceCard,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  gateCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  gateCardRowActive: {
    borderColor: '#05BCD3',
  },
  gateCardDisabled: {
    opacity: 0.35,
  },
  gateIconBubble: {
    backgroundColor: '#F7F7F7',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateTextCol: {
    flex: 1,
    gap: 4,
  },
  gateRowTitle: {
    fontFamily: FONT_INTER,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: COLORS.inkBody,
  },
  gateRowSubtitle: {
    fontFamily: FONT_INTER,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
    color: COLORS.textMuted,
  },
  gateCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateCheckboxOn: {
    backgroundColor: '#05BCD3',
  },
  gateCheckboxOff: {
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#CFCFCF',
  },
  // Nested stay preview (Figma node 12509:17367) — photo + name/URL pill.
  stayPreview: {
    gap: 12,
  },
  stayPreviewPhoto: {
    width: '100%',
    height: 198,
    borderRadius: 24,
    backgroundColor: '#F2F2F2',
  },
  stayPreviewInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F7F7F7',
    borderRadius: 32,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  stayPreviewIconCircle: {
    backgroundColor: COLORS.surfaceCard,
    borderRadius: 32,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stayPreviewTextCol: {
    flex: 1,
    paddingRight: 4,
  },
  stayPreviewName: {
    fontFamily: FONT_INTER,
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  stayPreviewUrl: {
    fontFamily: FONT_INTER,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '400',
    color: '#05BCD3',
  },

  // Max-participants stepper — square −/+ buttons flanking a wide "Any" pill.
  stepperRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperBtn: {
    width: 54,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderHairline,
    backgroundColor: COLORS.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValueBox: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderHairline,
    backgroundColor: COLORS.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    textAlign: 'center',
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.inkBody,
  },
  // "Any" (no limit) reads in the Figma accent cyan, same as "Tap to set".
  stepperValueAny: {
    fontFamily: FONT_INTER,
    fontWeight: '400',
    color: '#05BCD3',
  },

  // Flow B "About you" — floating, tappable profile card (Box Shadow 01),
  // same language as the "Who is it for?" audience cards.
  leaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingLeft: 16,
    paddingRight: 18,
    paddingVertical: 22,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceCard,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  leaderAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.surfaceMuted,
  },
  leaderAvatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9CB6C0',
  },
  leaderName: {
    fontFamily: FONT_INTER,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: COLORS.inkBody,
  },
  // Gray info pills (age, country, level, board, trips) — match the audience
  // card's completed-state chips.
  leaderTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  leaderTagsRowSecond: {
    marginTop: 8,
  },
  leaderTag: {
    backgroundColor: '#EEEEEE',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    borderRadius: 15,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  leaderTagText: {
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '400',
    color: '#333333',
  },

  // Yes → inline stay-details preview card (name, pic, url).
  stayCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.borderCard,
    backgroundColor: COLORS.surfaceCard,
    gap: 10,
  },
  stayCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stayCardName: {
    flex: 1,
    fontFamily: FONT_MONTSERRAT,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.inkBody,
  },
  stayPhoto: {
    width: '100%',
    height: 150,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceMuted,
  },
  stayUrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stayUrl: {
    flex: 1,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.brandTealText,
  },

  // Budget — center-stage container with breathing room above/below.
  budgetWrap: {
    paddingVertical: 8,
  },

  // Budget — "AI is estimating" loading state.
  budgetLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 72,
    paddingHorizontal: 24,
  },
  budgetLoadingIcon: {
    marginBottom: 18,
  },
  budgetLoadingTitle: {
    fontFamily: FONT_MONTSERRAT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: COLORS.inkBody,
    textAlign: 'center',
  },
  budgetLoadingSub: {
    marginTop: 6,
    fontFamily: FONT_INTER,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: COLORS.textMuted,
    textAlign: 'center',
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
