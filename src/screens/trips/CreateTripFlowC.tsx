import React, { useState } from 'react';
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
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  SurfLevel,
  SurfStyle,
  CreateGroupTripInput,
  UpdateGroupTripInput,
  GroupTrip,
  createGroupTrip,
  updateGroupTrip,
  setTripDestination,
} from '../../services/trips/groupTripsService';
import { uploadTripImage } from '../../services/storage/storageService';
import { HomeBreakSearchSheet, HomeBreakSelection } from '../../components/HomeBreakSearchSheet';

// ---------------------------------------------------------------------------
// Flow C — fully-planned trip (exact dates + fixed pricing + trip structure).
// 5 steps: basics → surfSetup → tripStructure → pricing → review.
// Persists to group_trips incl. the pricing/structure columns (migration 20260525000001).
// ---------------------------------------------------------------------------

type TripVibe = 'surf' | 'chill' | 'mixed';
type WaveType = 'reef' | 'beach' | 'point';
type Visibility = 'public' | 'friends' | 'private';
type IncludedComponent = 'flights' | 'accommodation' | 'surf_spots' | 'meals' | 'activities';
type PriceInclude = 'accommodation' | 'surf_guide' | 'transport' | 'flights' | 'meals';

const TRIP_VIBES: { key: TripVibe; title: string; desc: string }[] = [
  { key: 'surf', title: 'Surf-focused', desc: 'Dawn patrol and sunset sessions' },
  { key: 'chill', title: 'Chill', desc: 'Relaxed surf + explore' },
  { key: 'mixed', title: 'Mixed', desc: 'Flexible activities' },
];

const SKILL_LEVELS: { key: SurfLevel; label: string }[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

const WAVE_TYPES: { key: WaveType; title: string; desc: string }[] = [
  { key: 'reef', title: 'Reef break', desc: 'Hollow, powerful waves' },
  { key: 'beach', title: 'Beach break', desc: 'Sandy bottom, forgiving' },
  { key: 'point', title: 'Point break', desc: 'Long, peeling waves' },
];

const SURF_STYLES: { key: SurfStyle; label: string }[] = [
  { key: 'shortboard', label: 'Shortboard' },
  { key: 'midlength', label: 'Mid-length' },
  { key: 'softtop', label: 'Soft-top' },
  { key: 'longboard', label: 'Longboard' },
];

const VISIBILITIES: { key: Visibility; title: string; desc: string }[] = [
  { key: 'public', title: 'Public', desc: 'Anyone can discover and request to join' },
  { key: 'friends', title: 'Friends', desc: 'Visible to your connections only' },
  { key: 'private', title: 'Private', desc: 'Only people you invite can see and join' },
];

const TRIP_STRUCTURE: { key: IncludedComponent; title: string; desc: string }[] = [
  { key: 'flights', title: 'Flights', desc: 'Round-trip airfare' },
  { key: 'accommodation', title: 'Accommodation', desc: 'Lodging for the trip' },
  { key: 'surf_spots', title: 'Surf spots / locations', desc: 'Beaches and breaks' },
  { key: 'meals', title: 'Meals', desc: 'Breakfast, lunch, dinner' },
  { key: 'activities', title: 'Activities', desc: 'Tours, lessons, excursions' },
];

const PRICE_INCLUDES: { key: PriceInclude; label: string }[] = [
  { key: 'accommodation', label: 'Accommodation (7 nights)' },
  { key: 'surf_guide', label: 'Surf guide' },
  { key: 'transport', label: 'Transport to surf spots' },
  { key: 'flights', label: 'Flights' },
  { key: 'meals', label: 'Meals' },
];

const PRICE_LABEL: Record<PriceInclude, string> = {
  accommodation: 'Accommodation (7 nights)',
  surf_guide: 'Surf guide',
  transport: 'Transport to surf spots',
  flights: 'Flights',
  meals: 'Meals',
};

// DB constraint: for hosting_style 'C', age_max - age_min must be >= 2.
const AGE_WINDOW = 2;

const STEPS = ['basics', 'surfSetup', 'tripStructure', 'pricing', 'review'] as const;
type StepKey = (typeof STEPS)[number];

interface CreateTripFlowCProps {
  hostId: string | null;
  onCreated: () => void;
  onCancel: () => void;
  initialTrip?: GroupTrip;
}

interface WizardState {
  // Step 1 — basics
  title: string;
  heroImageUri: string | null;
  destination: string;
  destinationGeo: HomeBreakSelection | null;
  startDate: Date | null;
  endDate: Date | null;
  tripVibe: TripVibe | null;
  // Step 2 — surf setup
  skillLevel: SurfLevel | null;
  waveType: WaveType | null;
  surfStyles: SurfStyle[];
  ageMin: string;
  ageMax: string;
  // Step 3 — trip structure
  included: Record<IncludedComponent, boolean>;
  // Step 4 — pricing
  totalCost: string;
  costPerPerson: string;
  priceIncludes: Record<PriceInclude, boolean>;
  // Step 5 — review
  visibility: Visibility;
}

const INITIAL_STATE: WizardState = {
  title: '',
  heroImageUri: null,
  destination: '',
  destinationGeo: null,
  startDate: null,
  endDate: null,
  tripVibe: null,
  skillLevel: null,
  waveType: null,
  surfStyles: [],
  ageMin: '',
  ageMax: '',
  included: { flights: false, accommodation: false, surf_spots: false, meals: false, activities: false },
  totalCost: '',
  costPerPerson: '',
  priceIncludes: { accommodation: false, surf_guide: false, transport: false, flights: false, meals: false },
  visibility: 'public',
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
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
// Exclusive (nights): Jun 15 → Jun 22 = 7, matching the wireframe "• 7 days".
const dayCount = (start: Date | null, end: Date | null): number => {
  if (!start || !end) return 0;
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return ms < 0 ? 0 : Math.round(ms / 86400000);
};
const formatSingleDate = (d: Date | null): string =>
  d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const formatDateRange = (start: Date | null, end: Date | null): string => {
  if (!start) return '';
  const mo = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
  if (!end || toISODate(start) === toISODate(end)) return `${mo(start)} ${start.getDate()}, ${start.getFullYear()}`;
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth())
    return `${mo(start)} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
  if (start.getFullYear() === end.getFullYear())
    return `${mo(start)} ${start.getDate()} - ${mo(end)} ${end.getDate()}, ${end.getFullYear()}`;
  return `${mo(start)} ${start.getDate()}, ${start.getFullYear()} - ${mo(end)} ${end.getDate()}, ${end.getFullYear()}`;
};

const stateFromTrip = (trip: GroupTrip): WizardState => {
  const firstLevel = (trip.target_surf_levels ?? []).find(l =>
    SKILL_LEVELS.some(s => s.key === l)
  ) as SurfLevel | undefined;
  const inc = (k: IncludedComponent) => !!trip.included_components?.includes(k);
  const pi = (k: PriceInclude) => !!trip.price_includes?.includes(k);
  return {
    title: trip.title ?? '',
    heroImageUri: trip.hero_image_url ?? null,
    destination: trip.destination_area?.trim() || trip.destination_country?.trim() || '',
    destinationGeo: null, // locked in edit mode
    startDate: parseISODate(trip.start_date),
    endDate: parseISODate(trip.end_date),
    tripVibe: (trip.trip_vibe as TripVibe) ?? null,
    skillLevel: firstLevel ?? null,
    waveType: (trip.wave_type as WaveType) ?? null,
    surfStyles: (trip.target_surf_styles ?? []).filter(s =>
      SURF_STYLES.some(x => x.key === s)
    ) as SurfStyle[],
    ageMin: trip.age_min != null ? String(trip.age_min) : '',
    ageMax: trip.age_max != null ? String(trip.age_max) : '',
    included: {
      flights: inc('flights'),
      accommodation: inc('accommodation'),
      surf_spots: inc('surf_spots'),
      meals: inc('meals'),
      activities: inc('activities'),
    },
    totalCost: trip.total_cost != null ? String(trip.total_cost) : '',
    costPerPerson: trip.cost_per_person != null ? String(trip.cost_per_person) : '',
    priceIncludes: {
      accommodation: pi('accommodation'),
      surf_guide: pi('surf_guide'),
      transport: pi('transport'),
      flights: pi('flights'),
      meals: pi('meals'),
    },
    visibility: (trip.visibility as Visibility) ?? 'public',
  };
};

// ---------------------------------------------------------------------------
// Image picker (mirrors FlowA)
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
    console.error('[CreateTripFlowC] pickImage error:', e);
  }
  return null;
};

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------
export default function CreateTripFlowC({
  hostId,
  onCreated,
  onCancel,
  initialTrip,
}: CreateTripFlowCProps) {
  const editMode = !!initialTrip;
  const [state, setState] = useState<WizardState>(
    initialTrip ? stateFromTrip(initialTrip) : INITIAL_STATE
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [androidPicker, setAndroidPicker] = useState<null | 'start' | 'end'>(null);

  const step: StepKey = STEPS[stepIdx];

  const update = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState(s => ({ ...s, [key]: value }));
  const toggleIncluded = (k: IncludedComponent) =>
    setState(s => ({ ...s, included: { ...s.included, [k]: !s.included[k] } }));
  const togglePrice = (k: PriceInclude) =>
    setState(s => ({ ...s, priceIncludes: { ...s.priceIncludes, [k]: !s.priceIncludes[k] } }));

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

  // Per-step validation — error message or null.
  const validateStep = (): string | null => {
    const s = state;
    switch (step) {
      case 'basics':
        if (!s.title.trim()) return 'Please add a trip name.';
        if (!s.heroImageUri) return 'Please add a cover photo.';
        if (!editMode && !s.destination.trim()) return 'Please pick a destination.';
        if (!s.startDate || !s.endDate) return 'Please pick start and end dates.';
        if (startOfDay(s.endDate) < startOfDay(s.startDate))
          return 'End date must be on or after the start date.';
        if (!s.tripVibe) return 'Please pick a trip vibe.';
        return null;
      case 'surfSetup': {
        if (!s.skillLevel) return 'Please pick a skill level.';
        const min = parseInt(s.ageMin, 10);
        const max = parseInt(s.ageMax, 10);
        if (Number.isNaN(min) || Number.isNaN(max)) return 'Please enter an age range.';
        if (min < 16 || max > 99) return 'Ages must be between 16 and 99.';
        if (max < min) return 'Max age must be ≥ min age.';
        if (max - min < AGE_WINDOW) return `Age range must span at least ${AGE_WINDOW} years.`;
        return null;
      }
      case 'tripStructure':
        return null;
      case 'pricing': {
        if (!s.totalCost.trim()) return 'Please enter the total trip cost.';
        const total = parseInt(s.totalCost, 10);
        if (Number.isNaN(total) || total < 0) return 'Total cost must be a number ≥ 0.';
        if (s.costPerPerson.trim()) {
          const pp = parseInt(s.costPerPerson, 10);
          if (Number.isNaN(pp) || pp < 0) return 'Cost per person must be a number ≥ 0.';
        }
        return null;
      }
      case 'review':
        return null;
    }
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) {
      Alert.alert('Hold on', err);
      return;
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

      const skillLevel = state.skillLevel ?? 'all';
      const includedComponents = (Object.keys(state.included) as IncludedComponent[]).filter(
        k => state.included[k]
      );
      const priceIncludes = (Object.keys(state.priceIncludes) as PriceInclude[]).filter(
        k => state.priceIncludes[k]
      );
      const totalCost = state.totalCost.trim() ? parseInt(state.totalCost, 10) : null;
      const perPerson = state.costPerPerson.trim() ? parseInt(state.costPerPerson, 10) : null;
      const startISO = state.startDate ? toISODate(state.startDate) : null;
      const endISO = state.endDate ? toISODate(state.endDate) : null;

      if (editMode && initialTrip) {
        const editable: UpdateGroupTripInput = {
          title: state.title.trim() || null,
          hero_image_url: heroUrl,
          start_date: startISO,
          end_date: endISO,
          dates_set_in_stone: true,
          date_months: null,
          age_min: parseInt(state.ageMin, 10),
          age_max: parseInt(state.ageMax, 10),
          target_surf_levels: [skillLevel],
          target_surf_styles: state.surfStyles.length ? state.surfStyles : ['all'],
          trip_vibe: state.tripVibe,
          wave_type: state.waveType,
          included_components: includedComponents.length ? includedComponents : null,
          total_cost: totalCost,
          cost_per_person: perPerson,
          price_includes: priceIncludes.length ? priceIncludes : null,
          budget_currency: 'USD',
          surf_style: null,
          visibility: state.visibility,
        };
        await updateGroupTrip(initialTrip.id, editable);
      } else {
        const input: CreateGroupTripInput = {
          hosting_style: 'C',
          status: 'active',
          title: state.title.trim() || null,
          description: '',
          hero_image_url: heroUrl,

          start_date: startISO,
          end_date: endISO,
          dates_set_in_stone: true,
          date_months: null,

          destination_country: state.destination.trim() || null,
          destination_area: null,
          destination_spot: null,

          accommodation_type: null,
          accommodation_name: null,
          accommodation_url: null,
          accommodation_image_url: null,

          vibe: null,
          surf_spots: null,

          age_min: parseInt(state.ageMin, 10),
          age_max: parseInt(state.ageMax, 10),
          target_surf_levels: [skillLevel],
          target_surf_styles: state.surfStyles.length ? state.surfStyles : ['all'],
          wave_fat_to_barreling: null,
          wave_size_min: null,
          wave_size_max: null,

          host_been_there: null,
          budget_min: null,
          budget_max: null,
          budget_currency: 'USD',

          trip_vibe: state.tripVibe,
          wave_type: state.waveType,
          included_components: includedComponents.length ? includedComponents : null,
          total_cost: totalCost,
          cost_per_person: perPerson,
          price_includes: priceIncludes.length ? priceIncludes : null,

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
            console.warn('[CreateTripFlowC] setTripDestination failed:', geoErr);
          }
        }

        setState(INITIAL_STATE);
        setStepIdx(0);
      }
      onCreated();
    } catch (e: any) {
      console.error('[CreateTripFlowC] submit error:', e);
      Alert.alert(
        editMode ? 'Could not save trip' : 'Could not create trip',
        e?.message || 'Unknown error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const stepMeta: Record<StepKey, { title: string; subtitle: string }> = {
    basics: { title: 'Trip basics', subtitle: 'Where and when are you going?' },
    surfSetup: { title: 'Surf setup', subtitle: 'What kind of waves and level?' },
    tripStructure: { title: 'Trip structure', subtitle: "What's included in this trip?" },
    pricing: { title: 'Pricing', subtitle: 'Set your trip cost' },
    review: { title: 'Review & publish', subtitle: 'Who can see and join this trip?' },
  };

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
            style={[styles.segmentBtn, i > 0 && styles.segmentBtnDivider, active && styles.segmentBtnActive]}
            onPress={() => onSelect(opt.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

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
              placeholder="e.g. Uluwatu, Bali"
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
            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>{renderDateField('start')}</View>
              <View style={{ flex: 1 }}>{renderDateField('end')}</View>
            </View>
            {state.startDate && state.endDate && (
              <Text style={styles.helper}>
                {formatDateRange(state.startDate, state.endDate)} • {dayCount(state.startDate, state.endDate)} days
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

            <Text style={styles.label}>Trip vibe</Text>
            {renderOptionCards(TRIP_VIBES, state.tripVibe, k => update('tripVibe', k))}
          </View>
        );

      case 'surfSetup':
        return (
          <View>
            <Text style={styles.label}>Skill level</Text>
            {renderSegmented(SKILL_LEVELS, state.skillLevel, k => update('skillLevel', k))}

            <Text style={styles.label}>Wave type</Text>
            {renderOptionCards(WAVE_TYPES, state.waveType, k => update('waveType', k))}

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
                    style={[styles.chip, active && styles.chipActive]}
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
            <Text style={styles.helper}>Ages 16–99. Must span at least {AGE_WINDOW} years.</Text>
          </View>
        );

      case 'tripStructure':
        return (
          <View>
            {TRIP_STRUCTURE.map(item => (
              <View key={item.key} style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.toggleTitle}>{item.title}</Text>
                  <Text style={styles.toggleDesc}>{item.desc}</Text>
                </View>
                <Switch
                  value={state.included[item.key]}
                  onValueChange={() => toggleIncluded(item.key)}
                  trackColor={{ false: '#E0E0E0', true: '#0788B0' }}
                  thumbColor="#FFF"
                  ios_backgroundColor="#E0E0E0"
                />
              </View>
            ))}
          </View>
        );

      case 'pricing':
        return (
          <View>
            <Text style={styles.label}>Total trip cost</Text>
            <View style={styles.dollarRow}>
              <Text style={styles.dollarPrefix}>$</Text>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={state.totalCost}
                onChangeText={t => update('totalCost', t.replace(/[^0-9]/g, ''))}
                placeholder="1,200"
                placeholderTextColor="#B0B0B0"
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.labelRow}>
              <Text style={styles.label}>Cost per person</Text>
              <Text style={styles.optionalTag}>Optional</Text>
            </View>
            <View style={styles.dollarRow}>
              <Text style={styles.dollarPrefix}>$</Text>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={state.costPerPerson}
                onChangeText={t => update('costPerPerson', t.replace(/[^0-9]/g, ''))}
                placeholder="600"
                placeholderTextColor="#B0B0B0"
                keyboardType="number-pad"
              />
            </View>
            <Text style={styles.helper}>Based on 2 people minimum</Text>

            <Text style={[styles.label, { marginTop: 20 }]}>What's included</Text>
            {PRICE_INCLUDES.map(item => {
              const checked = state.priceIncludes[item.key];
              return (
                <TouchableOpacity
                  key={item.key}
                  style={styles.checkboxRow}
                  onPress={() => togglePrice(item.key)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked && <Ionicons name="checkmark" size={14} color="#FFF" />}
                  </View>
                  <Text style={styles.checkboxLabel}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );

      case 'review': {
        const dateText = state.startDate
          ? `${formatDateRange(state.startDate, state.endDate)} • ${dayCount(state.startDate, state.endDate)} days`
          : '';
        const skill = SKILL_LEVELS.find(s => s.key === state.skillLevel)?.label;
        const wave = WAVE_TYPES.find(w => w.key === state.waveType)?.title;
        const chips = [skill, wave].filter(Boolean) as string[];
        const priceText = state.costPerPerson.trim()
          ? `From $${parseInt(state.costPerPerson, 10).toLocaleString('en-US')} per person`
          : state.totalCost.trim()
          ? `$${parseInt(state.totalCost, 10).toLocaleString('en-US')} total`
          : null;
        const includes = (Object.keys(state.priceIncludes) as PriceInclude[]).filter(
          k => state.priceIncludes[k]
        );
        return (
          <View>
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
              {chips.length > 0 && (
                <View style={styles.previewChipRow}>
                  {chips.map(c => (
                    <View key={c} style={styles.previewChip}>
                      <Text style={styles.previewChipText}>{c}</Text>
                    </View>
                  ))}
                </View>
              )}
              {!!priceText && <Text style={styles.previewPrice}>{priceText}</Text>}
              {includes.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.previewKicker}>WHAT'S INCLUDED</Text>
                  {includes.map(k => (
                    <Text key={k} style={styles.previewLine}>• {PRICE_LABEL[k]}</Text>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.editRow}>
              <TouchableOpacity onPress={() => setStepIdx(0)}>
                <Text style={styles.editLink}>Edit details</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStepIdx(STEPS.indexOf('pricing'))}>
                <Text style={styles.editLink}>Edit pricing</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Visibility & invite</Text>
            {renderOptionCards(VISIBILITIES, state.visibility, k => update('visibility', k))}
          </View>
        );
      }
    }
  };

  const isFinalStep = step === 'review';

  return (
    <View style={styles.root}>
      <View style={styles.progressBar}>
        <Text style={styles.progressText}>
          Step {stepIdx + 1} of {STEPS.length}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((stepIdx + 1) / STEPS.length) * 100}%` }]} />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>{stepMeta[step].title}</Text>
        <Text style={styles.subheading}>{stepMeta[step].subtitle}</Text>
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
            <Text style={styles.primaryBtnText}>Next</Text>
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
  progressBar: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEE' },
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

  // Date fields
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
  dateBox: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: '#FFF',
  },
  dateBoxText: { fontSize: 15, color: '#222B30' },
  dateBoxPlaceholder: { color: '#B0B0B0' },

  // Option cards
  optionCard: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, padding: 14, marginBottom: 10 },
  optionCardActive: { borderColor: '#0788B0', backgroundColor: '#E6F4F8' },
  optionTitle: { fontSize: 15, fontWeight: '600', color: '#222B30', marginBottom: 4 },
  optionTitleActive: { color: '#066b8c' },
  optionDesc: { fontSize: 13, color: '#7B7B7B' },
  optionDescActive: { color: '#3a8aa3' },

  // Segmented
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, overflow: 'hidden' },
  segmentBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: '#FFF' },
  segmentBtnDivider: { borderLeftWidth: 1, borderLeftColor: '#E0E0E0' },
  segmentBtnActive: { backgroundColor: '#0788B0' },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#555' },
  segmentTextActive: { color: '#FFF' },

  // Chips (multi-select surf styles)
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#FFF',
  },
  chipActive: { backgroundColor: '#0788B0', borderColor: '#0788B0' },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { color: '#FFF', fontWeight: '600' },

  // Trip structure toggles
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  toggleTitle: { fontSize: 15, fontWeight: '600', color: '#222B30', marginBottom: 2 },
  toggleDesc: { fontSize: 13, color: '#7B7B7B' },

  // Pricing
  dollarRow: { flexDirection: 'row', alignItems: 'center' },
  dollarPrefix: { fontSize: 18, fontWeight: '700', color: '#222B30', marginRight: 8 },

  // Checkboxes
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#0788B0', borderColor: '#0788B0' },
  checkboxLabel: { fontSize: 15, color: '#222B30' },

  heroPreview: { width: '100%', height: 180, borderRadius: 12, backgroundColor: '#F2F2F2' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroPlaceholderText: { fontSize: 14, color: '#7B7B7B', marginTop: 6, fontWeight: '600' },

  // Preview card
  previewKicker: { fontSize: 12, fontWeight: '700', color: '#7B7B7B', letterSpacing: 1, marginBottom: 6 },
  previewCard: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 14, padding: 12 },
  previewImage: { width: '100%', height: 160, borderRadius: 10, backgroundColor: '#F2F2F2', marginBottom: 12 },
  previewTitle: { fontSize: 18, fontWeight: '700', color: '#222B30', marginBottom: 4 },
  previewLine: { fontSize: 14, color: '#555', marginBottom: 2 },
  previewPrice: { fontSize: 17, fontWeight: '700', color: '#222B30', marginTop: 10 },
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

  editRow: { flexDirection: 'row', gap: 24, marginTop: 12 },
  editLink: { fontSize: 14, color: '#0788B0', fontWeight: '600' },

  footer: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#EEE', gap: 10 },
  backBtnBar: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 10, backgroundColor: '#F2F2F2' },
  backBtnText: { color: '#222B30', fontWeight: '600' },
  primaryBtn: { flex: 2, paddingVertical: 14, alignItems: 'center', borderRadius: 10, backgroundColor: '#0788B0' },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFF', fontWeight: '700' },
});
