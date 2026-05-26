import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import {
  HostingStyle,
  SurfLevel,
  SurfStyle,
  CreateGroupTripInput,
  UpdateGroupTripInput,
  GroupTrip,
  createGroupTrip,
  updateGroupTrip,
  setTripDestination,
  estimateTripBudget,
  BudgetEstimate,
} from '../../services/trips/groupTripsService';
import { uploadTripImage } from '../../services/storage/storageService';
import { HomeBreakSearchSheet, HomeBreakSelection } from '../../components/HomeBreakSearchSheet';

// ---------------------------------------------------------------------------
// New unified create-trip flow (wireframe stage)
// ---------------------------------------------------------------------------
// This replaces the previous A/B/C 16-step wizard with a single flow. Steps 3
// and 5 are not designed yet — only the 4 below exist, so the counter is
// dynamic ("Step X of 4") and will grow when the missing steps are added.
//
// Persistence: fields that map onto existing group_trips columns are saved;
// the new wireframe concepts (trip vibe preset, wave type, accommodation
// status, visibility) live in state only and are NOT persisted yet — no
// migration. They are wired so adding columns later is a small change.
// ---------------------------------------------------------------------------

type TripVibe = 'surf' | 'chill' | 'mixed';
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

const TRIP_VIBES: { key: TripVibe; title: string; desc: string }[] = [
  { key: 'surf', title: 'Surf-focused', desc: 'Dawn patrol and sunset sessions' },
  { key: 'chill', title: 'Chill', desc: 'Relaxed surf + explore' },
  { key: 'mixed', title: 'Mixed', desc: 'Flexible activities' },
];

// These three are valid SurfLevel values, so the single pick maps straight to
// target_surf_levels = [level].
const SKILL_LEVELS: { key: SurfLevel; label: string }[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

const SURF_STYLES: { key: SurfStyle; label: string }[] = [
  { key: 'shortboard', label: 'Shortboard' },
  { key: 'midlength', label: 'Mid-length' },
  { key: 'softtop', label: 'Soft-top' },
  { key: 'longboard', label: 'Longboard' },
];

const ACCOMMODATION_KINDS: { key: AccommodationKind; title: string; desc: string }[] = [
  { key: 'villa', title: 'Villa', desc: 'Shared house with private rooms' },
  { key: 'hostel', title: 'Hostel', desc: 'Budget-friendly, social vibe' },
  { key: 'hotel', title: 'Hotel', desc: 'Private rooms, more comfort' },
  { key: 'surfcamp', title: 'Surf camp', desc: 'Surf-focused, all-in package' },
  { key: 'bungalow', title: 'Bungalow', desc: 'Standalone, close to the beach' },
  { key: 'apartment', title: 'Apartment', desc: 'Self-catering, your own space' },
  { key: 'guesthouse', title: 'Guesthouse', desc: 'Homey, locally run' },
  { key: 'ecolodge', title: 'Eco lodge', desc: 'Off-grid, nature-immersed' },
  { key: 'other', title: 'Other', desc: 'Something else' },
];

const VISIBILITIES: { key: Visibility; title: string; desc: string }[] = [
  { key: 'public', title: 'Public', desc: 'Anyone can discover and request to join' },
  { key: 'friends', title: 'Friends', desc: 'Visible to your connections only' },
  { key: 'private', title: 'Private', desc: 'Only people you invite can see and join' },
];

const BUDGET_TIERS: { key: 'low' | 'medium' | 'high'; title: string }[] = [
  { key: 'low', title: 'Budget' },
  { key: 'medium', title: 'Mid-range' },
  { key: 'high', title: 'Premium' },
];

const DURATION_UNITS: { key: 'days' | 'weeks'; label: string }[] = [
  { key: 'days', label: 'Days' },
  { key: 'weeks', label: 'Weeks' },
];

const formatUsd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const formatRange = (r: { min: number; max: number }) =>
  `${formatUsd(r.min)} – ${formatUsd(r.max)}`;
const toDays = (value: string, unit: 'days' | 'weeks'): number => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return unit === 'weeks' ? n * 7 : n;
};

// DB constraint: minimum age-range span per hosting style (A:7, B:5, C:2).
const AGE_WINDOW_BY_STYLE: Record<HostingStyle, number> = { A: 7, B: 5, C: 2 };

const STEPS = ['basics', 'surfSetup', 'accommodation', 'budget', 'preview'] as const;
type StepKey = (typeof STEPS)[number];

interface CreateTripWizardProps {
  hostId: string | null;
  onCreated: () => void;
  onCancel: () => void;
  /** When provided, the wizard runs in edit mode (prefilled, partial update). */
  initialTrip?: GroupTrip;
  /** Hosting style this flow creates (create mode). Defaults to 'A'; 'B' reuses
   *  this same flow. Edit mode keeps the trip's existing style. */
  hostingStyle?: HostingStyle;
}

interface WizardState {
  // Step 1 — Trip basics
  title: string;
  heroImageUri: string | null;
  destination: string; // display label, also mirrored to group_trips.destination_country
  destinationGeo: HomeBreakSelection | null; // precise geocode → group_trip_destinations
  datesMode: 'months' | 'exact';
  monthFrom: string; // YYYY-MM (months mode)
  monthTo: string; // YYYY-MM (months mode)
  startDate: Date | null; // exact mode
  endDate: Date | null; // exact mode
  durationValue: string; // estimate-only, not persisted
  durationUnit: 'days' | 'weeks';
  tripVibe: TripVibe | null;
  // Step 2 — Surf setup
  skillLevel: SurfLevel | null;
  waveFat: number; // 0–10 (fat ↔ barreling slider)
  waveSize: number; // ft (single size slider → stored as wave_size_min = wave_size_max)
  surfStyles: SurfStyle[]; // board types → target_surf_styles
  ageMin: string;
  ageMax: string;
  // Step 3 — Accommodation (all optional)
  accommodationKind: AccommodationKind | null;
  accommodationName: string;
  accommodationUrl: string;
  accommodationImageUri: string | null;
  // Step 5 — Budget (estimated via GPT, persisted to budget_min/max/currency)
  budgetEstimate: BudgetEstimate | null;
  budgetTier: 'low' | 'medium' | 'high' | null;
  budgetManualMin: string; // fallback when estimate fails
  budgetManualMax: string;
  budgetCurrency: string;
  // Step 6 — Visibility
  visibility: Visibility;
}

const INITIAL_STATE: WizardState = {
  title: '',
  heroImageUri: null,
  destination: '',
  destinationGeo: null,
  datesMode: 'months',
  monthFrom: '',
  monthTo: '',
  startDate: null,
  endDate: null,
  durationValue: '',
  durationUnit: 'days',
  tripVibe: null,
  skillLevel: null,
  waveFat: 5,
  waveSize: 6,
  surfStyles: [],
  ageMin: '',
  ageMax: '',
  accommodationKind: null,
  accommodationName: '',
  accommodationUrl: '',
  accommodationImageUri: null,
  budgetEstimate: null,
  budgetTier: null,
  budgetManualMin: '',
  budgetManualMax: '',
  budgetCurrency: 'USD',
  visibility: 'public',
};

const stateFromTrip = (trip: GroupTrip): WizardState => {
  const months = trip.date_months ?? [];
  const sorted = [...months].sort();
  const firstLevel = (trip.target_surf_levels ?? []).find(l =>
    SKILL_LEVELS.some(s => s.key === l)
  ) as SurfLevel | undefined;
  const firstKind = (trip.accommodation_type ?? []).find(t =>
    ACCOMMODATION_KINDS.some(k => k.key === t)
  ) as AccommodationKind | undefined;
  return {
    title: trip.title ?? '',
    heroImageUri: trip.hero_image_url ?? null,
    destination:
      trip.destination_area?.trim() ||
      trip.destination_country?.trim() ||
      '',
    destinationGeo: null, // not re-fetched in edit mode (destination is locked)
    datesMode: trip.start_date ? 'exact' : 'months',
    monthFrom: sorted[0] ?? '',
    monthTo: sorted.length > 1 ? sorted[sorted.length - 1] : '',
    startDate: parseISODate(trip.start_date),
    endDate: parseISODate(trip.end_date),
    durationValue: '', // not persisted; edit mode opens budget on manual fallback
    durationUnit: 'days',
    tripVibe: (trip.trip_vibe as TripVibe) ?? null,
    skillLevel: firstLevel ?? null,
    waveFat: trip.wave_fat_to_barreling ?? 5,
    waveSize: trip.wave_size_min ?? 6,
    surfStyles: (trip.target_surf_styles ?? []).filter(s =>
      SURF_STYLES.some(x => x.key === s)
    ) as SurfStyle[],
    ageMin: trip.age_min != null ? String(trip.age_min) : '',
    ageMax: trip.age_max != null ? String(trip.age_max) : '',
    accommodationKind: firstKind ?? null,
    accommodationName: trip.accommodation_name ?? '',
    accommodationUrl: trip.accommodation_url ?? '',
    accommodationImageUri: trip.accommodation_image_url ?? null,
    budgetEstimate: null,
    budgetTier: null,
    budgetManualMin: trip.budget_min != null ? String(trip.budget_min) : '',
    budgetManualMax: trip.budget_max != null ? String(trip.budget_max) : '',
    budgetCurrency: trip.budget_currency ?? 'USD',
    visibility: (trip.visibility as Visibility) ?? 'public',
  };
};

// ---------------------------------------------------------------------------
// Month helpers — the wireframe shows From/To month boxes; we store the
// inclusive range into date_months (capped) to keep "is past" logic working.
// ---------------------------------------------------------------------------
const upcomingMonths = (count = 12): { value: string; label: string }[] => {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  const thisYear = now.getFullYear();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const short = d.toLocaleString('en-US', { month: 'short' });
    const label = d.getFullYear() === thisYear ? short : `${short} '${String(d.getFullYear()).slice(2)}`;
    out.push({ value, label });
  }
  return out;
};

const monthLabel = (value: string): string => {
  if (!value) return '';
  const [y, m] = value.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  const short = d.toLocaleString('en-US', { month: 'short' });
  return d.getFullYear() === new Date().getFullYear() ? short : `${short} ${d.getFullYear()}`;
};

// Exact-date helpers (mirror FlowB)
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
const formatSingleDate = (d: Date | null): string =>
  d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
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

// ---------------------------------------------------------------------------
// Image picker (mirrors the previous wizard / OnboardingStep4Screen usage)
// ---------------------------------------------------------------------------
const pickImage = async (): Promise<string | null> => {
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
      aspect: [16, 9],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      return result.assets[0].uri;
    }
  } catch (e) {
    console.error('[CreateTripWizard] pickImage error:', e);
  }
  return null;
};

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------
export default function CreateTripFlowA({
  hostId,
  onCreated,
  onCancel,
  initialTrip,
  hostingStyle = 'A',
}: CreateTripWizardProps) {
  const editMode = !!initialTrip;
  const effectiveStyle: HostingStyle = initialTrip?.hosting_style ?? hostingStyle;
  const ageWindow = AGE_WINDOW_BY_STYLE[effectiveStyle];
  const [state, setState] = useState<WizardState>(
    initialTrip ? stateFromTrip(initialTrip) : INITIAL_STATE
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [openMonthPicker, setOpenMonthPicker] = useState<'from' | 'to' | null>(null);
  const [androidPicker, setAndroidPicker] = useState<null | 'start' | 'end'>(null);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [lastEstimateKey, setLastEstimateKey] = useState<string | null>(null);

  const step: StepKey = STEPS[stepIdx];
  const months = useMemo(() => upcomingMonths(12), []);

  const update = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState(s => ({ ...s, [key]: value }));

  const onChangeDate = (which: 'start' | 'end', d?: Date) => {
    if (!d) return;
    if (which === 'start') {
      setState(s => {
        const next: WizardState = { ...s, startDate: d };
        if (s.endDate && startOfDay(s.endDate) < startOfDay(d)) next.endDate = null;
        return next;
      });
    } else {
      update('endDate', d);
    }
  };

  const renderDateField = (which: 'start' | 'end') => {
    const value = which === 'start' ? state.startDate : state.endDate;
    const min = which === 'end' ? state.startDate ?? undefined : undefined;
    if (Platform.OS === 'ios') {
      return (
        <View style={styles.dateField}>
          <Text style={styles.dateFieldLabel}>{which === 'start' ? 'Start' : 'End'}</Text>
          <DateTimePicker
            value={value ?? new Date()}
            mode="date"
            display="compact"
            minimumDate={min}
            onChange={(_, d) => onChangeDate(which, d)}
          />
        </View>
      );
    }
    return (
      <TouchableOpacity style={styles.dateBox} onPress={() => setAndroidPicker(which)}>
        <Text style={[styles.dateBoxText, !value && styles.dateBoxPlaceholder]}>
          {value ? formatSingleDate(value) : which === 'start' ? 'Start date' : 'End date'}
        </Text>
      </TouchableOpacity>
    );
  };

  // Fingerprint of the inputs the budget estimate depends on. Used to skip a
  // redundant re-fetch when the user revisits the budget step unchanged.
  // Exact dates → derive duration from start/end; months mode → the duration field.
  const tripDurationDays = (): number =>
    state.datesMode === 'exact'
      ? dayCount(state.startDate, state.endDate)
      : toDays(state.durationValue, state.durationUnit);

  const estimateKey = () =>
    [
      state.destination,
      state.destinationGeo?.country ?? '',
      tripDurationDays(),
      state.accommodationKind ?? '',
    ].join('|');

  // Fetch the GPT budget estimate (called when leaving the accommodation step,
  // and by the "Retry estimate" button). Reuses the cache if inputs are unchanged.
  const maybeEstimateBudget = async () => {
    const key = estimateKey();
    if (state.budgetEstimate && lastEstimateKey === key && !budgetError) return;

    const durationDays = tripDurationDays();
    const destination =
      state.destinationGeo?.short || state.destinationGeo?.name || state.destination;
    if (!destination || durationDays < 1) {
      setBudgetError('Missing trip details');
      setState(s => ({ ...s, budgetEstimate: null }));
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
      setState(s => ({ ...s, budgetEstimate: est }));
      setLastEstimateKey(key);
    } catch (e: any) {
      console.warn('[CreateTripFlowA] budget estimate failed:', e);
      setBudgetError(e?.message || 'Could not estimate budget');
      setState(s => ({ ...s, budgetEstimate: null }));
    } finally {
      setBudgetLoading(false);
    }
  };

  // Resolve the budget to persist: selected tier, else manual fallback fields.
  const resolveBudget = (): { min: number | null; max: number | null; currency: string | null } => {
    if (state.budgetEstimate && state.budgetTier) {
      const r = state.budgetEstimate.ranges[state.budgetTier];
      return { min: Math.round(r.min), max: Math.round(r.max), currency: 'USD' };
    }
    const min = state.budgetManualMin ? parseInt(state.budgetManualMin, 10) : null;
    const max = state.budgetManualMax ? parseInt(state.budgetManualMax, 10) : null;
    return { min, max, currency: min != null || max != null ? 'USD' : null };
  };

  // Per-step validation — returns error message or null if valid.
  const validateStep = (): string | null => {
    const s = state;
    switch (step) {
      case 'basics':
        if (!s.title.trim()) return 'Please add a trip name.';
        if (!s.heroImageUri) return 'Please add a cover photo.';
        if (!editMode && !s.destination.trim()) return 'Please pick a destination.';
        // Duration feeds the budget estimate. In months mode it's a required
        // field; in exact mode it's derived from the dates, so it's not asked.
        if (!editMode && s.datesMode === 'months' && toDays(s.durationValue, s.durationUnit) < 1)
          return 'Please enter a trip duration.';
        if (
          s.datesMode === 'exact' &&
          s.startDate &&
          s.endDate &&
          startOfDay(s.endDate) < startOfDay(s.startDate)
        )
          return 'End date must be on or after the start date.';
        return null;
      case 'surfSetup': {
        if (!s.skillLevel) return 'Please pick a skill level.';
        const min = parseInt(s.ageMin, 10);
        const max = parseInt(s.ageMax, 10);
        if (Number.isNaN(min) || Number.isNaN(max)) return 'Please enter an age range.';
        if (min < 16 || max > 99) return 'Ages must be between 16 and 99.';
        if (max < min) return 'Max age must be ≥ min age.';
        if (max - min < ageWindow) return `Age range must span at least ${ageWindow} years.`;
        return null;
      }
      case 'accommodation':
        return null; // optional — Continue acts as Skip
      case 'budget': {
        if (s.budgetEstimate) {
          if (!s.budgetTier) return 'Please pick a budget tier.';
          return null;
        }
        // Fallback manual path
        if (!s.budgetManualMin || !s.budgetManualMax)
          return 'Please enter a budget min and max.';
        const min = parseInt(s.budgetManualMin, 10);
        const max = parseInt(s.budgetManualMax, 10);
        if (Number.isNaN(min) || Number.isNaN(max)) return 'Budget must be numeric.';
        if (min < 0 || max < 0) return 'Budget must be ≥ 0.';
        if (min > max) return 'Min must be ≤ max.';
        return null;
      }
      case 'preview':
        return null;
    }
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) {
      Alert.alert('Hold on', err);
      return;
    }
    // Kick off the budget estimate when leaving accommodation (skip in edit mode
    // — there the budget step opens on the manual fallback prefilled from the trip).
    if (step === 'accommodation' && !editMode) {
      maybeEstimateBudget();
    }
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
  };

  const handleBack = () => {
    if (stepIdx === 0) {
      onCancel();
      return;
    }
    setStepIdx(stepIdx - 1);
  };

  const handleSubmit = async () => {
    if (!hostId) {
      Alert.alert('Not signed in', 'Please sign in again.');
      return;
    }
    setSubmitting(true);
    try {
      const isRemoteUrl = (uri: string | null): boolean => !!uri && /^https?:\/\//.test(uri);

      // Upload hero image only if it's a freshly-picked local file.
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

      // Upload accommodation photo if a fresh local file was picked.
      let accommodationImageUrl: string | null = null;
      if (state.accommodationImageUri) {
        if (isRemoteUrl(state.accommodationImageUri)) {
          accommodationImageUrl = state.accommodationImageUri;
        } else {
          const accRes = await uploadTripImage(state.accommodationImageUri, hostId, 'accommodation');
          if (accRes.success && accRes.url) accommodationImageUrl = accRes.url;
        }
      }

      const exactDates = state.datesMode === 'exact';
      const dateMonths = exactDates ? [] : expandMonthRange(state.monthFrom, state.monthTo);
      const startISO = exactDates && state.startDate ? toISODate(state.startDate) : null;
      const endISO = exactDates && state.endDate ? toISODate(state.endDate) : null;
      const skillLevel = state.skillLevel ?? 'all';
      const budget = resolveBudget();

      if (editMode && initialTrip) {
        // Partial update — only fields the new flow edits. Everything else
        // (description, age range, budget, etc.) is preserved in the DB.
        const editable: UpdateGroupTripInput = {
          title: state.title.trim() || null,
          hero_image_url: heroUrl,
          start_date: startISO,
          end_date: endISO,
          dates_set_in_stone: exactDates ? true : null,
          date_months: dateMonths.length ? dateMonths : null,
          age_min: parseInt(state.ageMin, 10),
          age_max: parseInt(state.ageMax, 10),
          target_surf_levels: [skillLevel],
          accommodation_type: state.accommodationKind ? [state.accommodationKind] : null,
          accommodation_name: state.accommodationName.trim() || null,
          accommodation_url: state.accommodationUrl.trim() || null,
          accommodation_image_url: accommodationImageUrl,
          budget_min: budget.min,
          budget_max: budget.max,
          budget_currency: budget.currency,
          trip_vibe: state.tripVibe,
          wave_type: null,
          wave_fat_to_barreling: Math.round(state.waveFat),
          wave_size_min: state.waveSize,
          wave_size_max: state.waveSize,
          target_surf_styles: state.surfStyles.length ? state.surfStyles : ['all'],
          surf_style: null,
          accommodation_status: null,
          visibility: state.visibility,
        };
        await updateGroupTrip(initialTrip.id, editable);
      } else {
        // Defaults fill the NOT-NULL columns the new flow doesn't collect yet.
        const input: CreateGroupTripInput = {
          hosting_style: hostingStyle,
          status: 'active',
          title: state.title.trim() || null,
          description: '',
          hero_image_url: heroUrl,

          start_date: startISO,
          end_date: endISO,
          dates_set_in_stone: exactDates ? true : null,
          date_months: dateMonths.length ? dateMonths : null,

          destination_country: state.destination.trim() || null,
          destination_area: null,
          destination_spot: null,

          accommodation_type: state.accommodationKind ? [state.accommodationKind] : null,
          accommodation_name: state.accommodationName.trim() || null,
          accommodation_url: state.accommodationUrl.trim() || null,
          accommodation_image_url: accommodationImageUrl,

          vibe: null,
          surf_spots: null,

          age_min: parseInt(state.ageMin, 10),
          age_max: parseInt(state.ageMax, 10),
          target_surf_levels: [skillLevel],
          target_surf_styles: state.surfStyles.length ? state.surfStyles : ['all'],
          wave_fat_to_barreling: Math.round(state.waveFat),
          wave_size_min: state.waveSize,
          wave_size_max: state.waveSize,

          host_been_there: null,
          budget_min: budget.min,
          budget_max: budget.max,
          budget_currency: budget.currency,

          // Flow B columns — A persists vibe; wave uses the old fat/size columns above.
          trip_vibe: state.tripVibe,
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

        // Persist the precise geocode into group_trip_destinations. Best-effort:
        // the trip already exists, so a geo failure shouldn't block creation.
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
            console.warn('[CreateTripWizard] setTripDestination failed:', geoErr);
          }
        }

        setState(INITIAL_STATE);
        setStepIdx(0);
      }
      onCreated();
    } catch (e: any) {
      console.error('[CreateTripWizard] submit error:', e);
      Alert.alert(
        editMode ? 'Could not save trip' : 'Could not create trip',
        e?.message || 'Unknown error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const stepMeta = useMemo(() => {
    const meta: Record<StepKey, { title: string; subtitle: string }> = {
      basics: { title: 'Trip basics', subtitle: 'Where and when are you going?' },
      surfSetup: { title: 'Surf setup', subtitle: 'What kind of waves and level?' },
      accommodation: { title: 'Accommodation', subtitle: 'Optional — add if already decided' },
      budget: { title: 'Budget', subtitle: 'Estimated per person, in USD' },
      preview: { title: 'Preview', subtitle: 'Who can see and join this trip?' },
    };
    return meta[step];
  }, [step]);

  // --- reusable bits -------------------------------------------------------
  const renderOptionCards = <T extends string>(
    options: { key: T; title: string; desc: string }[],
    selected: T | null,
    onSelect: (key: T) => void
  ) => (
    <View>
      {options.map(opt => {
        const active = selected === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[styles.optionCard, active && styles.optionCardActive]}
            onPress={() => onSelect(opt.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{opt.title}</Text>
            <Text style={[styles.optionDesc, active && styles.optionDescActive]}>{opt.desc}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderSegmented = <T extends string>(
    options: { key: T; label: string }[],
    selected: T | null,
    onSelect: (key: T) => void
  ) => (
    <View style={styles.segment}>
      {options.map((opt, i) => {
        const active = selected === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[
              styles.segmentBtn,
              i > 0 && styles.segmentBtnDivider,
              active && styles.segmentBtnActive,
            ]}
            onPress={() => onSelect(opt.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // --- step content --------------------------------------------------------
  const renderStep = () => {
    switch (step) {
      case 'basics':
        return (
          <View>
            <Text style={styles.label}>Trip name</Text>
            <TextInput
              style={styles.input}
              value={state.title}
              onChangeText={t => update('title', t)}
              placeholder="e.g. Bali and Barrels"
              placeholderTextColor="#B0B0B0"
            />

            <Text style={styles.label}>Cover photo</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={async () => {
                const uri = await pickImage();
                if (uri) update('heroImageUri', uri);
              }}
            >
              {state.heroImageUri ? (
                <Image source={{ uri: state.heroImageUri }} style={styles.heroPreview} />
              ) : (
                <View style={[styles.heroPreview, styles.heroPlaceholder]}>
                  <Ionicons name="image-outline" size={28} color="#0788B0" />
                  <Text style={styles.heroPlaceholderText}>Add cover photo</Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={styles.label}>Destination</Text>
            <TouchableOpacity
              style={[styles.input, styles.pickerBox, editMode && styles.inputDisabled]}
              activeOpacity={editMode ? 1 : 0.7}
              onPress={() => {
                if (editMode) return;
                setShowDestPicker(true);
              }}
            >
              <Text
                style={[styles.pickerBoxText, !state.destination && styles.pickerBoxPlaceholder]}
                numberOfLines={1}
              >
                {state.destination || 'e.g. Uluwatu, Bali'}
              </Text>
              {!editMode && <Ionicons name="location-outline" size={18} color="#0788B0" />}
            </TouchableOpacity>
            {editMode && (
              <Text style={styles.helper}>Destination is locked once a trip is created.</Text>
            )}

            <Text style={styles.label}>Dates</Text>
            {renderSegmented(
              [
                { key: 'months' as const, label: 'Months' },
                { key: 'exact' as const, label: 'Exact dates' },
              ],
              state.datesMode,
              k => update('datesMode', k)
            )}

            {state.datesMode === 'exact' ? (
              <>
                <View style={[styles.row, { marginTop: 10 }]}>
                  <View style={{ flex: 1, marginRight: 8 }}>{renderDateField('start')}</View>
                  <View style={{ flex: 1 }}>{renderDateField('end')}</View>
                </View>
                {state.startDate && state.endDate && (
                  <Text style={styles.helper}>
                    {formatSingleDate(state.startDate)} → {formatSingleDate(state.endDate)}
                  </Text>
                )}
                {Platform.OS === 'android' && androidPicker && (
                  <DateTimePicker
                    value={(androidPicker === 'start' ? state.startDate : state.endDate) ?? new Date()}
                    mode="date"
                    display="default"
                    minimumDate={androidPicker === 'end' ? state.startDate ?? undefined : undefined}
                    onChange={(_, d) => {
                      const w = androidPicker;
                      setAndroidPicker(null);
                      onChangeDate(w, d);
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <View style={[styles.row, { marginTop: 10 }]}>
                  <TouchableOpacity
                    style={[styles.dateBox, { flex: 1, marginRight: 8 }, openMonthPicker === 'from' && styles.dateBoxActive]}
                    onPress={() => setOpenMonthPicker(openMonthPicker === 'from' ? null : 'from')}
                  >
                    <Text style={[styles.dateBoxText, !state.monthFrom && styles.dateBoxPlaceholder]}>
                      {state.monthFrom ? monthLabel(state.monthFrom) : 'From'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dateBox, { flex: 1 }, openMonthPicker === 'to' && styles.dateBoxActive]}
                    onPress={() => setOpenMonthPicker(openMonthPicker === 'to' ? null : 'to')}
                  >
                    <Text style={[styles.dateBoxText, !state.monthTo && styles.dateBoxPlaceholder]}>
                      {state.monthTo ? monthLabel(state.monthTo) : 'To'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {openMonthPicker && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll}>
                    {months.map(m => {
                      const active =
                        (openMonthPicker === 'from' && state.monthFrom === m.value) ||
                        (openMonthPicker === 'to' && state.monthTo === m.value);
                      return (
                        <TouchableOpacity
                          key={m.value}
                          style={[styles.chip, active && styles.chipActive]}
                          onPress={() => {
                            update(openMonthPicker === 'from' ? 'monthFrom' : 'monthTo', m.value);
                            setOpenMonthPicker(null);
                          }}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </>
            )}

            {state.datesMode !== 'exact' && (
              <>
                <Text style={styles.label}>Estimated trip duration</Text>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginRight: 8 }]}
                    value={state.durationValue}
                    onChangeText={t => update('durationValue', t.replace(/[^0-9]/g, ''))}
                    placeholder="e.g. 10"
                    placeholderTextColor="#B0B0B0"
                    keyboardType="number-pad"
                  />
                  <View style={{ flex: 1 }}>
                    {renderSegmented(DURATION_UNITS, state.durationUnit, k => update('durationUnit', k))}
                  </View>
                </View>
              </>
            )}

            <Text style={styles.label}>Trip vibe</Text>
            {renderOptionCards(TRIP_VIBES, state.tripVibe, k => update('tripVibe', k))}
          </View>
        );

      case 'surfSetup':
        return (
          <View>
            <Text style={styles.label}>Skill level</Text>
            {renderSegmented(SKILL_LEVELS, state.skillLevel, k => update('skillLevel', k))}

            <View style={styles.labelRow}>
              <Text style={styles.label}>Fat ↔ barreling</Text>
              <Text style={styles.sliderValue}>{state.waveFat}/10</Text>
            </View>
            <Slider
              minimumValue={0}
              maximumValue={10}
              step={1}
              value={state.waveFat}
              onValueChange={v => update('waveFat', v)}
              minimumTrackTintColor="#0788B0"
              maximumTrackTintColor="#E0E0E0"
              thumbTintColor="#0788B0"
            />

            <View style={styles.labelRow}>
              <Text style={styles.label}>Wave size</Text>
              <Text style={styles.sliderValue}>{state.waveSize} ft</Text>
            </View>
            <Slider
              minimumValue={1}
              maximumValue={20}
              step={1}
              value={state.waveSize}
              onValueChange={v => update('waveSize', v)}
              minimumTrackTintColor="#0788B0"
              maximumTrackTintColor="#E0E0E0"
              thumbTintColor="#0788B0"
            />

            <View style={styles.labelRow}>
              <Text style={styles.label}>Surf style</Text>
              <Text style={styles.optionalTag}>Optional</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {SURF_STYLES.map(opt => {
                const active = state.surfStyles.includes(opt.key);
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.chip, { marginBottom: 8 }, active && styles.chipActive]}
                    onPress={() =>
                      setState(s => ({
                        ...s,
                        surfStyles: active
                          ? s.surfStyles.filter(x => x !== opt.key)
                          : [...s.surfStyles, opt.key],
                      }))
                    }
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Age range</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1, marginRight: 8 }]}
                value={state.ageMin}
                onChangeText={t => update('ageMin', t.replace(/[^0-9]/g, ''))}
                placeholder="Min"
                placeholderTextColor="#B0B0B0"
                keyboardType="number-pad"
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={state.ageMax}
                onChangeText={t => update('ageMax', t.replace(/[^0-9]/g, ''))}
                placeholder="Max"
                placeholderTextColor="#B0B0B0"
                keyboardType="number-pad"
              />
            </View>
            <Text style={styles.helper}>Ages 16–99. Must span at least {ageWindow} years.</Text>
          </View>
        );

      case 'accommodation':
        return (
          <View>
            <Text style={styles.label}>Type</Text>
            {renderOptionCards(ACCOMMODATION_KINDS, state.accommodationKind, k =>
              update('accommodationKind', k)
            )}

            <View style={styles.labelRow}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.optionalTag}>Optional</Text>
            </View>
            <TextInput
              style={styles.input}
              value={state.accommodationName}
              onChangeText={t => update('accommodationName', t)}
              placeholder="e.g. Beachfront Villa Uluwatu"
              placeholderTextColor="#B0B0B0"
            />

            <View style={styles.labelRow}>
              <Text style={styles.label}>URL</Text>
              <Text style={styles.optionalTag}>Optional</Text>
            </View>
            <TextInput
              style={styles.input}
              value={state.accommodationUrl}
              onChangeText={t => update('accommodationUrl', t)}
              placeholder="https://…"
              placeholderTextColor="#B0B0B0"
              autoCapitalize="none"
              keyboardType="url"
            />

            <View style={styles.labelRow}>
              <Text style={styles.label}>Photo</Text>
              <Text style={styles.optionalTag}>Optional</Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={async () => {
                const uri = await pickImage();
                if (uri) update('accommodationImageUri', uri);
              }}
            >
              {state.accommodationImageUri ? (
                <Image source={{ uri: state.accommodationImageUri }} style={styles.heroPreview} />
              ) : (
                <View style={[styles.heroPreview, styles.heroPlaceholder]}>
                  <Ionicons name="image-outline" size={28} color="#0788B0" />
                  <Text style={styles.heroPlaceholderText}>Add photo</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        );

      case 'budget': {
        if (budgetLoading) {
          return (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <ActivityIndicator color="#0788B0" />
              <Text style={[styles.helper, { marginTop: 10 }]}>Estimating budget…</Text>
            </View>
          );
        }

        if (state.budgetEstimate) {
          const r = state.budgetEstimate.ranges;
          return (
            <View>
              <Text style={styles.label}>Estimated budget per person (USD)</Text>
              <Text style={styles.helper}>Pick the tier that fits your trip.</Text>
              {BUDGET_TIERS.map(tier => {
                const range = r[tier.key];
                const active = state.budgetTier === tier.key;
                return (
                  <TouchableOpacity
                    key={tier.key}
                    style={[styles.optionCard, active && styles.optionCardActive]}
                    onPress={() => update('budgetTier', tier.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>
                      {tier.title} · {formatRange(range)}
                    </Text>
                    {!!range.label && (
                      <Text style={[styles.optionDesc, active && styles.optionDescActive]}>
                        {range.label}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        }

        // Fallback: error / no key / offline → manual entry + retry
        return (
          <View>
            {!!budgetError && (
              <Text style={[styles.helper, { color: '#C0392B' }]}>
                Couldn’t estimate automatically. Enter an approximate budget per person.
              </Text>
            )}
            <Text style={styles.label}>Budget per person (USD)</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1, marginRight: 8 }]}
                value={state.budgetManualMin}
                onChangeText={t => update('budgetManualMin', t.replace(/[^0-9]/g, ''))}
                placeholder="Min"
                placeholderTextColor="#B0B0B0"
                keyboardType="number-pad"
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={state.budgetManualMax}
                onChangeText={t => update('budgetManualMax', t.replace(/[^0-9]/g, ''))}
                placeholder="Max"
                placeholderTextColor="#B0B0B0"
                keyboardType="number-pad"
              />
            </View>
            <TouchableOpacity
              style={[styles.secondaryBtn, { marginTop: 16 }]}
              onPress={maybeEstimateBudget}
            >
              <Text style={styles.secondaryBtnText}>Retry estimate</Text>
            </TouchableOpacity>
          </View>
        );
      }

      case 'preview': {
        const dateText =
          state.datesMode === 'exact'
            ? state.startDate
              ? `${formatSingleDate(state.startDate)}${
                  state.endDate ? ` – ${formatSingleDate(state.endDate)}` : ''
                }`
              : ''
            : state.monthFrom && state.monthTo && state.monthFrom !== state.monthTo
            ? `${monthLabel(state.monthFrom)} – ${monthLabel(state.monthTo)}`
            : monthLabel(state.monthFrom || state.monthTo);
        const skill = SKILL_LEVELS.find(s => s.key === state.skillLevel)?.label;
        const vibe = TRIP_VIBES.find(v => v.key === state.tripVibe)?.title;
        const chips = [skill, vibe].filter(Boolean) as string[];
        const b = resolveBudget();
        const budgetText =
          b.min != null && b.max != null ? `${formatRange({ min: b.min, max: b.max })} USD` : null;
        return (
          <View>
            <Text style={styles.previewKicker}>PREVIEW</Text>
            <View style={styles.previewCard}>
              {state.heroImageUri ? (
                <Image source={{ uri: state.heroImageUri }} style={styles.previewImage} />
              ) : (
                <View style={[styles.previewImage, styles.heroPlaceholder]}>
                  <Text style={styles.heroPlaceholderText}>Cover image</Text>
                </View>
              )}
              <Text style={styles.previewTitle}>{state.title || 'Untitled trip'}</Text>
              {!!state.destination && <Text style={styles.previewLine}>{state.destination}</Text>}
              {!!dateText && <Text style={styles.previewLine}>{dateText}</Text>}
              {!!budgetText && <Text style={styles.previewLine}>Budget: {budgetText}</Text>}
              {chips.length > 0 && (
                <View style={styles.previewChipRow}>
                  {chips.map(c => (
                    <View key={c} style={styles.previewChip}>
                      <Text style={styles.previewChipText}>{c}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <Text style={styles.sectionTitle}>Visibility & invite</Text>
            {renderOptionCards(VISIBILITIES, state.visibility, k => update('visibility', k))}
          </View>
        );
      }
    }
  };

  const isFinalStep = step === 'preview';

  return (
    <View style={styles.root}>
      <View style={styles.progressBar}>
        <Text style={styles.progressText}>
          Step {stepIdx + 1} of {STEPS.length}
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${((stepIdx + 1) / STEPS.length) * 100}%` }]}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>{stepMeta.title}</Text>
        <Text style={styles.subheading}>{stepMeta.subtitle}</Text>
        {renderStep()}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.backBtnBar} onPress={handleBack} disabled={submitting}>
          <Text style={styles.backBtnText}>{stepIdx === 0 ? 'Cancel' : 'Back'}</Text>
        </TouchableOpacity>
        {isFinalStep ? (
          <TouchableOpacity
            style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.primaryBtnText}>{editMode ? 'Save changes' : 'Publish trip'}</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
            <Text style={styles.primaryBtnText}>
              {step === 'accommodation' ? 'Continue' : 'Next'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <HomeBreakSearchSheet
        visible={showDestPicker}
        title="Select destination"
        confirmTitle="Confirm destination"
        searchPlaceholder="Search destinations, towns, spots..."
        nameOnly
        onClose={() => setShowDestPicker(false)}
        onSelect={sel => {
          setState(s => ({ ...s, destination: sel.name || sel.short, destinationGeo: sel }));
          setShowDestPicker(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  progressBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  progressText: { fontSize: 12, color: '#7B7B7B', fontWeight: '600', textAlign: 'center', marginBottom: 6 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: '#EEE', overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: '#0788B0' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  heading: { fontSize: 22, fontWeight: '700', color: '#222B30', marginBottom: 4 },
  subheading: { fontSize: 14, color: '#7B7B7B', marginBottom: 12 },

  label: { fontSize: 13, fontWeight: '600', color: '#222B30', marginTop: 16, marginBottom: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionalTag: { fontSize: 12, color: '#B0B0B0', marginTop: 16 },
  sliderValue: { fontSize: 13, color: '#0788B0', fontWeight: '700', marginTop: 16 },
  helper: { fontSize: 12, color: '#7B7B7B', marginTop: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#222B30', marginTop: 24, marginBottom: 10 },

  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#222B30',
    backgroundColor: '#FFF',
  },
  inputDisabled: { backgroundColor: '#F4F4F4', color: '#7B7B7B' },

  pickerBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerBoxText: { flex: 1, fontSize: 15, color: '#222B30' },
  pickerBoxPlaceholder: { color: '#B0B0B0' },

  row: { flexDirection: 'row' },

  // Date boxes (From / To)
  dateBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#FFF',
  },
  dateBoxActive: { borderColor: '#0788B0' },
  dateBoxText: { fontSize: 15, color: '#222B30' },
  dateBoxPlaceholder: { color: '#B0B0B0' },
  monthScroll: { marginTop: 10, flexGrow: 0 },
  dateField: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateFieldLabel: { fontSize: 13, color: '#7B7B7B', fontWeight: '600' },

  // Option cards (vibe, wave type, accommodation type, visibility)
  optionCard: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  optionCardActive: { borderColor: '#0788B0', backgroundColor: '#E6F4F8' },
  optionTitle: { fontSize: 15, fontWeight: '600', color: '#222B30', marginBottom: 4 },
  optionTitleActive: { color: '#066b8c' },
  optionDesc: { fontSize: 13, color: '#7B7B7B' },
  optionDescActive: { color: '#3a8aa3' },

  // Segmented control (skill level, accommodation status)
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  segmentBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: '#FFF' },
  segmentBtnDivider: { borderLeftWidth: 1, borderLeftColor: '#E0E0E0' },
  segmentBtnActive: { backgroundColor: '#0788B0' },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#555' },
  segmentTextActive: { color: '#FFF' },

  // Chips (month picker)
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginRight: 8,
    backgroundColor: '#FFF',
  },
  chipActive: { backgroundColor: '#0788B0', borderColor: '#0788B0' },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { color: '#FFF', fontWeight: '600' },

  secondaryBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0788B0',
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#0788B0', fontWeight: '600' },

  heroPreview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: '#F2F2F2',
  },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroPlaceholderText: { fontSize: 14, color: '#7B7B7B', marginTop: 6, fontWeight: '600' },

  // Preview card
  previewKicker: { fontSize: 12, fontWeight: '700', color: '#7B7B7B', letterSpacing: 1, marginBottom: 8 },
  previewCard: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 14,
    padding: 12,
  },
  previewImage: { width: '100%', height: 160, borderRadius: 10, backgroundColor: '#F2F2F2', marginBottom: 12 },
  previewTitle: { fontSize: 18, fontWeight: '700', color: '#222B30', marginBottom: 4 },
  previewLine: { fontSize: 14, color: '#555', marginBottom: 2 },
  previewChipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  previewChip: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  previewChipText: { fontSize: 13, color: '#222B30' },

  footer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    gap: 10,
  },
  backBtnBar: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#F2F2F2',
  },
  backBtnText: { color: '#222B30', fontWeight: '600' },
  primaryBtn: {
    flex: 2,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#0788B0',
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFF', fontWeight: '700' },
});
