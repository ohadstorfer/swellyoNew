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
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  HostingStyle,
  SurfLevel,
  SurfStyle,
  CreateGroupTripInput,
  createGroupTrip,
  TripVibe,
} from '../../services/trips/groupTripsService';
import { uploadTripImage } from '../../services/storage/storageService';

// ---------------------------------------------------------------------------
// Variant rules (see docs/create-group-surf-trip-flow.md)
// ---------------------------------------------------------------------------
const MIN_AGE_WINDOW: Record<HostingStyle, number> = { A: 7, B: 5, C: 2 };

const ACCOMMODATION_TYPES = ['hostel', 'bungalow', 'villa', 'hotel', 'eco lodge', 'other'];
const SURF_LEVELS: SurfLevel[] = ['beginner', 'intermediate', 'advanced', 'pro', 'all'];
const SURF_STYLES: SurfStyle[] = ['shortboard', 'midlength', 'longboard', 'softtop', 'all'];

interface CreateTripWizardProps {
  hostId: string | null;
  onCreated: () => void;
  onCancel: () => void;
}

interface WizardState {
  // Step 0
  hostingStyle: HostingStyle | null;
  // 1.1
  title: string;
  // 1.2
  heroImageUri: string | null;
  // 1.3
  description: string;
  // 1.4
  startDate: string; // YYYY-MM-DD
  endDate: string;
  datesSetInStone: boolean;
  dateMonths: string[]; // YYYY-MM
  // 1.5
  destinationCountry: string;
  destinationArea: string;
  destinationSpot: string;
  // 1.6
  accommodationType: string;
  accommodationName: string;
  accommodationUrl: string;
  accommodationImageUri: string | null;
  // 1.7 vibe
  vibeMorning: string;
  vibeAfternoon: string;
  vibeEvening: string;
  vibeNight: string;
  // 1.8
  surfSpotsText: string; // comma-separated
  // 2.1
  ageMin: string;
  ageMax: string;
  // 2.2
  targetSurfLevels: SurfLevel[];
  // 2.3
  targetSurfStyles: SurfStyle[];
  // 2.4
  waveFatToBarreling: string;
  waveSizeMin: string;
  waveSizeMax: string;
}

const INITIAL_STATE: WizardState = {
  hostingStyle: null,
  title: '',
  heroImageUri: null,
  description: '',
  startDate: '',
  endDate: '',
  datesSetInStone: true,
  dateMonths: [],
  destinationCountry: '',
  destinationArea: '',
  destinationSpot: '',
  accommodationType: '',
  accommodationName: '',
  accommodationUrl: '',
  accommodationImageUri: null,
  vibeMorning: '',
  vibeAfternoon: '',
  vibeEvening: '',
  vibeNight: '',
  surfSpotsText: '',
  ageMin: '',
  ageMax: '',
  targetSurfLevels: [],
  targetSurfStyles: [],
  waveFatToBarreling: '',
  waveSizeMin: '',
  waveSizeMax: '',
};

// Totalsteps: 0 hosting + 1-14 as per plan. Index into step list.
const STEPS = [
  'hostingStyle',
  'title',
  'heroImage',
  'description',
  'dates',
  'destination',
  'accommodation',
  'vibe',
  'surfSpots',
  'ageRange',
  'surfLevels',
  'surfStyles',
  'waveType',
  'review',
] as const;
type StepKey = (typeof STEPS)[number];

// ---------------------------------------------------------------------------
// Image picker helper (mirrors OnboardingStep4Screen usage)
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
export default function CreateTripWizard({ hostId, onCreated, onCancel }: CreateTripWizardProps) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const hostingStyle = state.hostingStyle;
  const step: StepKey = STEPS[stepIdx];

  const update = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState(s => ({ ...s, [key]: value }));

  const toggleInArray = <T extends string>(arr: T[], value: T): T[] =>
    arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value];

  // Per-step validation — returns error message or null if valid.
  const validateStep = (): string | null => {
    const s = state;
    switch (step) {
      case 'hostingStyle':
        return s.hostingStyle ? null : 'Please pick a hosting style.';
      case 'title':
        if (hostingStyle === 'A' && !s.title.trim()) return 'Trip name is required for style A.';
        return null;
      case 'heroImage':
        return s.heroImageUri ? null : 'Hero image is required.';
      case 'description':
        return s.description.trim() ? null : 'Description is required.';
      case 'dates':
        if (hostingStyle === 'A') {
          if (s.dateMonths.length === 0) return 'Pick at least 1 month.';
          if (s.dateMonths.length > 3) return 'Max 3 months for style A.';
          return null;
        }
        if (!s.startDate || !s.endDate) return 'Start and end dates are required.';
        if (new Date(s.startDate) > new Date(s.endDate)) return 'End date must be after start date.';
        return null;
      case 'destination':
        if (hostingStyle === 'B' && !s.destinationCountry.trim())
          return 'Destination country is required for style B.';
        if (hostingStyle === 'C') {
          if (!s.destinationCountry.trim()) return 'Destination country is required for style C.';
          if (!s.destinationSpot.trim()) return 'Spot is required for style C.';
        }
        return null;
      case 'accommodation':
        if (hostingStyle === 'A' && !s.accommodationType)
          return 'Pick an accommodation type.';
        if (hostingStyle === 'B') {
          if (!s.accommodationType) return 'Pick a style.';
          if (!s.accommodationName.trim()) return 'Accommodation name is required.';
        }
        if (hostingStyle === 'C' && !s.accommodationName.trim())
          return 'Accommodation name is required for style C.';
        return null;
      case 'vibe':
      case 'surfSpots':
        return null; // optional in all variants
      case 'ageRange': {
        const min = parseInt(s.ageMin, 10);
        const max = parseInt(s.ageMax, 10);
        if (isNaN(min) || isNaN(max)) return 'Enter valid ages.';
        if (min < 16 || max > 99) return 'Ages must be 16–99.';
        if (max < min) return 'Max age must be ≥ min age.';
        const required = MIN_AGE_WINDOW[hostingStyle!];
        if (max - min < required)
          return `Age range must span at least ${required} years for style ${hostingStyle}.`;
        return null;
      }
      case 'surfLevels':
        return s.targetSurfLevels.length >= 1 ? null : 'Pick at least one surf level.';
      case 'surfStyles':
        return s.targetSurfStyles.length >= 1 ? null : 'Pick at least one surf style.';
      case 'waveType':
        return null; // skippable
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
    if (!hostingStyle) return;
    setSubmitting(true);
    try {
      // Upload hero image (required)
      const heroRes = await uploadTripImage(state.heroImageUri!, hostId, 'hero');
      if (!heroRes.success || !heroRes.url) {
        throw new Error(heroRes.error || 'Failed to upload hero image');
      }

      // Upload accommodation image if provided
      let accommodationImageUrl: string | null = null;
      if (state.accommodationImageUri) {
        const accRes = await uploadTripImage(state.accommodationImageUri, hostId, 'accommodation');
        if (accRes.success && accRes.url) accommodationImageUrl = accRes.url;
      }

      const vibe: TripVibe | null =
        state.vibeMorning || state.vibeAfternoon || state.vibeEvening || state.vibeNight
          ? {
              morning: state.vibeMorning ? state.vibeMorning.split(',').map(s => s.trim()).filter(Boolean) : undefined,
              afternoon: state.vibeAfternoon ? state.vibeAfternoon.split(',').map(s => s.trim()).filter(Boolean) : undefined,
              evening: state.vibeEvening ? state.vibeEvening.split(',').map(s => s.trim()).filter(Boolean) : undefined,
              night: state.vibeNight ? state.vibeNight.split(',').map(s => s.trim()).filter(Boolean) : undefined,
            }
          : null;

      const surfSpots = state.surfSpotsText.trim()
        ? state.surfSpotsText.split(',').map(s => ({ name: s.trim() })).filter(s => s.name)
        : null;

      const input: CreateGroupTripInput = {
        hosting_style: hostingStyle,
        title: state.title.trim() || null,
        description: state.description.trim(),
        hero_image_url: heroRes.url,

        start_date: hostingStyle === 'A' ? null : state.startDate || null,
        end_date: hostingStyle === 'A' ? null : state.endDate || null,
        dates_set_in_stone: hostingStyle === 'A' ? null : state.datesSetInStone,
        date_months: hostingStyle === 'A' ? state.dateMonths : null,

        destination_country: state.destinationCountry.trim() || null,
        destination_area: state.destinationArea.trim() || null,
        destination_spot: state.destinationSpot.trim() || null,

        accommodation_type: state.accommodationType || null,
        accommodation_name: state.accommodationName.trim() || null,
        accommodation_url: state.accommodationUrl.trim() || null,
        accommodation_image_url: accommodationImageUrl,

        vibe,
        surf_spots: surfSpots,

        age_min: parseInt(state.ageMin, 10),
        age_max: parseInt(state.ageMax, 10),
        target_surf_levels: state.targetSurfLevels,
        target_surf_styles: state.targetSurfStyles,
        wave_fat_to_barreling: state.waveFatToBarreling ? parseInt(state.waveFatToBarreling, 10) : null,
        wave_size_min: state.waveSizeMin ? parseFloat(state.waveSizeMin) : null,
        wave_size_max: state.waveSizeMax ? parseFloat(state.waveSizeMax) : null,
      };

      await createGroupTrip(hostId, input);
      setState(INITIAL_STATE);
      setStepIdx(0);
      onCreated();
    } catch (e: any) {
      console.error('[CreateTripWizard] submit error:', e);
      Alert.alert('Could not create trip', e?.message || 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  // Step labels for header
  const stepLabel = useMemo(() => {
    const labels: Record<StepKey, string> = {
      hostingStyle: 'Hosting style',
      title: 'Trip name',
      heroImage: 'Hero image',
      description: 'Description',
      dates: 'Dates',
      destination: 'Destination',
      accommodation: 'Accommodation',
      vibe: 'Trip vibe (optional)',
      surfSpots: 'Surf spots (optional)',
      ageRange: 'Age range',
      surfLevels: 'Surf levels',
      surfStyles: 'Surf styles',
      waveType: 'Wave type (optional)',
      review: 'Review & submit',
    };
    return labels[step];
  }, [step]);

  // Render step content
  const renderStep = () => {
    switch (step) {
      case 'hostingStyle':
        return (
          <View>
            <Text style={styles.question}>Do you want to…</Text>
            {(['A', 'B', 'C'] as HostingStyle[]).map(v => (
              <TouchableOpacity
                key={v}
                style={[styles.optionCard, state.hostingStyle === v && styles.optionCardActive]}
                onPress={() => update('hostingStyle', v)}
              >
                <Text style={styles.optionTitle}>
                  {v === 'A' && 'A. Create a group with a general idea'}
                  {v === 'B' && 'B. Lead on most topics, discuss some'}
                  {v === 'C' && 'C. Create a full trip for others to join your vision'}
                </Text>
                <Text style={styles.optionDesc}>
                  {v === 'A' && 'Loose & collaborative — many fields can stay fuzzy.'}
                  {v === 'B' && 'Semi-structured — real dates, destination required.'}
                  {v === 'C' && 'Fully prescriptive — everything locked in.'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        );

      case 'title':
        return (
          <View>
            <Text style={styles.label}>
              Trip name {hostingStyle === 'A' ? '(required)' : '(optional)'}
            </Text>
            <TextInput
              style={styles.input}
              value={state.title}
              onChangeText={t => update('title', t)}
              placeholder="e.g. Hidden lefts in Morocco"
              placeholderTextColor="#B0B0B0"
            />
          </View>
        );

      case 'heroImage':
        return (
          <View>
            <Text style={styles.label}>Hero image (required)</Text>
            {state.heroImageUri ? (
              <Image source={{ uri: state.heroImageUri }} style={styles.heroPreview} />
            ) : (
              <View style={[styles.heroPreview, styles.heroPlaceholder]}>
                <Ionicons name="image-outline" size={36} color="#B0B0B0" />
              </View>
            )}
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={async () => {
                const uri = await pickImage();
                if (uri) update('heroImageUri', uri);
              }}
            >
              <Text style={styles.secondaryBtnText}>
                {state.heroImageUri ? 'Change image' : 'Pick image'}
              </Text>
            </TouchableOpacity>
          </View>
        );

      case 'description':
        return (
          <View>
            <Text style={styles.label}>Description (required)</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              value={state.description}
              onChangeText={t => update('description', t)}
              placeholder="Tell travelers what this trip is about…"
              placeholderTextColor="#B0B0B0"
            />
          </View>
        );

      case 'dates':
        if (hostingStyle === 'A') {
          return (
            <View>
              <Text style={styles.label}>Target month(s) — up to 3</Text>
              <Text style={styles.helper}>
                Enter as YYYY-MM, comma-separated. e.g. 2026-05, 2026-06
              </Text>
              <TextInput
                style={styles.input}
                value={state.dateMonths.join(', ')}
                onChangeText={t =>
                  update(
                    'dateMonths',
                    t.split(',').map(x => x.trim()).filter(Boolean)
                  )
                }
                placeholder="2026-05, 2026-06"
                placeholderTextColor="#B0B0B0"
                autoCapitalize="none"
              />
            </View>
          );
        }
        return (
          <View>
            <Text style={styles.label}>Start date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={state.startDate}
              onChangeText={t => update('startDate', t)}
              placeholder="2026-06-01"
              placeholderTextColor="#B0B0B0"
              autoCapitalize="none"
            />
            <Text style={styles.label}>End date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={state.endDate}
              onChangeText={t => update('endDate', t)}
              placeholder="2026-06-10"
              placeholderTextColor="#B0B0B0"
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => update('datesSetInStone', !state.datesSetInStone)}
            >
              <Ionicons
                name={state.datesSetInStone ? 'checkbox' : 'square-outline'}
                size={22}
                color="#B72DF2"
              />
              <Text style={styles.toggleLabel}>Dates are set in stone</Text>
            </TouchableOpacity>
          </View>
        );

      case 'destination':
        return (
          <View>
            <Text style={styles.label}>
              Country {hostingStyle === 'A' ? '(optional)' : '(required)'}
            </Text>
            <TextInput
              style={styles.input}
              value={state.destinationCountry}
              onChangeText={t => update('destinationCountry', t)}
              placeholder="Morocco"
              placeholderTextColor="#B0B0B0"
            />
            <Text style={styles.label}>Area (optional)</Text>
            <TextInput
              style={styles.input}
              value={state.destinationArea}
              onChangeText={t => update('destinationArea', t)}
              placeholder="Taghazout"
              placeholderTextColor="#B0B0B0"
            />
            <Text style={styles.label}>
              Spot {hostingStyle === 'C' ? '(required)' : '(optional)'}
            </Text>
            <TextInput
              style={styles.input}
              value={state.destinationSpot}
              onChangeText={t => update('destinationSpot', t)}
              placeholder="Anchor Point"
              placeholderTextColor="#B0B0B0"
            />
          </View>
        );

      case 'accommodation':
        return (
          <View>
            {(hostingStyle === 'A' || hostingStyle === 'B') && (
              <>
                <Text style={styles.label}>Type</Text>
                <View style={styles.chipRow}>
                  {ACCOMMODATION_TYPES.map(t => {
                    const active = state.accommodationType === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => update('accommodationType', t)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
            {(hostingStyle === 'B' || hostingStyle === 'C') && (
              <>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={state.accommodationName}
                  onChangeText={t => update('accommodationName', t)}
                  placeholder="Surf House Taghazout"
                  placeholderTextColor="#B0B0B0"
                />
                <Text style={styles.label}>Website (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={state.accommodationUrl}
                  onChangeText={t => update('accommodationUrl', t)}
                  placeholder="https://..."
                  placeholderTextColor="#B0B0B0"
                  autoCapitalize="none"
                />
                <Text style={styles.label}>Image (optional)</Text>
                {state.accommodationImageUri && (
                  <Image source={{ uri: state.accommodationImageUri }} style={styles.accPreview} />
                )}
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={async () => {
                    const uri = await pickImage();
                    if (uri) update('accommodationImageUri', uri);
                  }}
                >
                  <Text style={styles.secondaryBtnText}>
                    {state.accommodationImageUri ? 'Change image' : 'Pick image'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );

      case 'vibe':
        return (
          <View>
            <Text style={styles.helper}>Optional. Comma-separate activities per day-part.</Text>
            {[
              { key: 'vibeMorning', label: 'Morning' },
              { key: 'vibeAfternoon', label: 'Afternoon' },
              { key: 'vibeEvening', label: 'Evening' },
              { key: 'vibeNight', label: 'Night' },
            ].map(({ key, label }) => (
              <View key={key}>
                <Text style={styles.label}>{label}</Text>
                <TextInput
                  style={styles.input}
                  value={(state as any)[key]}
                  onChangeText={t => update(key as keyof WizardState, t as any)}
                  placeholder="surf, yoga, ..."
                  placeholderTextColor="#B0B0B0"
                />
              </View>
            ))}
          </View>
        );

      case 'surfSpots':
        return (
          <View>
            <Text style={styles.label}>Surf spots list (optional)</Text>
            <Text style={styles.helper}>Comma-separated spot names.</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              value={state.surfSpotsText}
              onChangeText={t => update('surfSpotsText', t)}
              placeholder="Anchor Point, Killer Point, Boilers"
              placeholderTextColor="#B0B0B0"
            />
          </View>
        );

      case 'ageRange':
        return (
          <View>
            <Text style={styles.label}>
              Age range (min window: {MIN_AGE_WINDOW[hostingStyle!]} years for style {hostingStyle})
            </Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1, marginRight: 8 }]}
                value={state.ageMin}
                onChangeText={t => update('ageMin', t)}
                placeholder="Min"
                placeholderTextColor="#B0B0B0"
                keyboardType="number-pad"
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={state.ageMax}
                onChangeText={t => update('ageMax', t)}
                placeholder="Max"
                placeholderTextColor="#B0B0B0"
                keyboardType="number-pad"
              />
            </View>
          </View>
        );

      case 'surfLevels':
        return (
          <View>
            <Text style={styles.label}>Target surf levels (pick 1 or more)</Text>
            <View style={styles.chipRow}>
              {SURF_LEVELS.map(l => {
                const active = state.targetSurfLevels.includes(l);
                return (
                  <TouchableOpacity
                    key={l}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() =>
                      update('targetSurfLevels', toggleInArray(state.targetSurfLevels, l))
                    }
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );

      case 'surfStyles':
        return (
          <View>
            <Text style={styles.label}>Target surf styles (pick 1 or more)</Text>
            <View style={styles.chipRow}>
              {SURF_STYLES.map(s => {
                const active = state.targetSurfStyles.includes(s);
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() =>
                      update('targetSurfStyles', toggleInArray(state.targetSurfStyles, s))
                    }
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );

      case 'waveType':
        return (
          <View>
            <Text style={styles.helper}>
              Optional. If you have multiple levels, consider skipping this step.
            </Text>
            <Text style={styles.label}>Fat ↔ barreling (0 = fat, 10 = barreling)</Text>
            <TextInput
              style={styles.input}
              value={state.waveFatToBarreling}
              onChangeText={t => update('waveFatToBarreling', t)}
              placeholder="5"
              placeholderTextColor="#B0B0B0"
              keyboardType="number-pad"
            />
            <Text style={styles.label}>Size min (ft)</Text>
            <TextInput
              style={styles.input}
              value={state.waveSizeMin}
              onChangeText={t => update('waveSizeMin', t)}
              placeholder="2"
              placeholderTextColor="#B0B0B0"
              keyboardType="decimal-pad"
            />
            <Text style={styles.label}>Size max (ft)</Text>
            <TextInput
              style={styles.input}
              value={state.waveSizeMax}
              onChangeText={t => update('waveSizeMax', t)}
              placeholder="6"
              placeholderTextColor="#B0B0B0"
              keyboardType="decimal-pad"
            />
          </View>
        );

      case 'review':
        return (
          <View>
            <Text style={styles.label}>Review</Text>
            <Text style={styles.reviewLine}>Style: {state.hostingStyle}</Text>
            {!!state.title && <Text style={styles.reviewLine}>Title: {state.title}</Text>}
            <Text style={styles.reviewLine}>Description: {state.description}</Text>
            <Text style={styles.reviewLine}>
              Destination: {state.destinationCountry || '—'}
              {state.destinationArea ? `, ${state.destinationArea}` : ''}
              {state.destinationSpot ? ` (${state.destinationSpot})` : ''}
            </Text>
            <Text style={styles.reviewLine}>
              Dates:{' '}
              {hostingStyle === 'A'
                ? state.dateMonths.join(', ')
                : `${state.startDate} → ${state.endDate}`}
            </Text>
            <Text style={styles.reviewLine}>
              Age: {state.ageMin}–{state.ageMax}
            </Text>
            <Text style={styles.reviewLine}>
              Levels: {state.targetSurfLevels.join(', ')}
            </Text>
            <Text style={styles.reviewLine}>
              Styles: {state.targetSurfStyles.join(', ')}
            </Text>
          </View>
        );
    }
  };

  const isFinalStep = step === 'review';

  return (
    <View style={styles.root}>
      <View style={styles.progressBar}>
        <Text style={styles.progressText}>
          Step {stepIdx + 1} / {STEPS.length} · {stepLabel}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
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
              <Text style={styles.primaryBtnText}>Create trip</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
            <Text style={styles.primaryBtnText}>Next</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  progressBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  progressText: { fontSize: 12, color: '#7B7B7B', fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },

  question: { fontSize: 18, fontWeight: '600', color: '#222B30', marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#222B30', marginTop: 12, marginBottom: 6 },
  helper: { fontSize: 12, color: '#7B7B7B', marginBottom: 6 },

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
  textarea: { minHeight: 100, textAlignVertical: 'top' },

  row: { flexDirection: 'row' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  toggleLabel: { fontSize: 14, color: '#222B30', marginLeft: 8 },

  optionCard: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  optionCardActive: { borderColor: '#B72DF2', backgroundColor: '#FAF2FE' },
  optionTitle: { fontSize: 15, fontWeight: '600', color: '#222B30', marginBottom: 4 },
  optionDesc: { fontSize: 13, color: '#7B7B7B' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#FFF',
  },
  chipActive: { backgroundColor: '#B72DF2', borderColor: '#B72DF2' },
  chipText: { fontSize: 13, color: '#555', textTransform: 'capitalize' },
  chipTextActive: { color: '#FFF', fontWeight: '600' },

  heroPreview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    backgroundColor: '#F2F2F2',
    marginBottom: 12,
  },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  accPreview: { width: '100%', height: 140, borderRadius: 10, marginBottom: 12 },

  secondaryBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B72DF2',
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#B72DF2', fontWeight: '600' },

  reviewLine: { fontSize: 13, color: '#444', marginBottom: 4 },

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
    backgroundColor: '#B72DF2',
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFF', fontWeight: '700' },
});
