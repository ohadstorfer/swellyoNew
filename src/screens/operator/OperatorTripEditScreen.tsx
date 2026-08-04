import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { RootStackParamList } from '../../navigation/navigationRef';
import { EditSection } from '../../components/trips/edit/EditSection';
import { EditRow } from '../../components/trips/edit/EditRow';
import { EditFieldSheet } from '../../components/trips/edit/EditFieldSheet';
import {
  EditTextSheet,
  EditCoverSheet,
  EditAccommodationSheet,
  type AccommodationInitial,
} from '../../components/trips/TripEditSheets';
import { LevelsSheetContent } from '../../components/trips/sheets/LevelsSheetContent';
import { StyleSheetContent } from '../../components/trips/sheets/StyleSheetContent';
import { WaveSheetContent } from '../../components/trips/sheets/WaveSheetContent';
import { AgeSheetContent } from '../../components/trips/sheets/AgeSheetContent';
import { HowItWorksSheetContent } from '../../components/trips/sheets/HowItWorksSheetContent';
import { VibeSheetContent } from '../../components/trips/sheets/VibeSheetContent';
import { StayTypeSheetContent } from '../../components/trips/sheets/StayTypeSheetContent';
import type { AccommodationKind } from '../../components/trips/AccommodationTypeGrid';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { updateOperatorTrip } from '../../services/operator/operatorTripsService';
import { uploadTripImage } from '../../services/storage/storageService';
import {
  type UpdateGroupTripInput,
  type SurfLevel,
  type SurfStyle,
  type WaveShapeKind,
  type TripStructureSlug,
  type TripVibeSlug,
} from '../../services/trips/groupTripsService';
import { validateAgeRange } from '../../services/trips/tripValidation';
import { AGE_WINDOW_BY_STYLE } from '../trips/CreateTripFlowA';
import { useOnboarding } from '../../context/OnboardingContext';
import { showErrorAlert } from '../../utils/friendlyError';
import { ff } from '../../theme/fonts';

/**
 * Order-insensitive equality for the multi-select array fields below
 * (target_surf_levels, target_surf_styles, trip_structure). Their sheet
 * bodies (SheetOptionCard lists, TripTagPicker) append a newly-picked value
 * to the END of the array — toggling the same set off and back on in a
 * different order changes array order without changing the content.
 * EditFieldSheet's default dirty check is `JSON.stringify(draft) !==
 * JSON.stringify(initial)`, which is order-sensitive, so without this the
 * Save button would light up on a no-op edit.
 */
function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorEditTrip'>;

/**
 * Which sheet is open. Tasks 6, 7, 9, 10, 11 and 12 each add their own keys to
 * this union as they wire their rows — if a `setSheet('x')` does not compile,
 * the key is missing from here.
 */
type SheetKey =
  | 'cover' | 'title' | 'description' | 'stay' | 'aboutYou'
  | 'levels' | 'boards' | 'wave' | 'age'
  | 'howItWorks' | 'vibe' | 'stayType'
  | null;

/** Extracted so the loading / not-found / loaded branches below can all show
 *  the same back button + title without repeating the JSX three times —
 *  mirrors TripDetailScreen's own `Header` subcomponent. */
const Header: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <View style={styles.header}>
    <TouchableOpacity
      onPress={onBack}
      style={styles.backBtn}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={28} color="#222B30" />
    </TouchableOpacity>
    <Text style={styles.headerTitle}>Edit trip</Text>
    <View style={{ width: 28 }} />
  </View>
);

export default function OperatorTripEditScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;
  const queryClient = useQueryClient();

  const { data, isLoading, isPlaceholderData } = useTripCore(tripId, currentUserId);
  const trip = data?.trip ?? null;

  const [sheet, setSheet] = useState<SheetKey>(null);
  const close = useCallback(() => setSheet(null), []);
  // Rows Tasks 6–12 haven't wired yet.
  const noop = () => {};

  /** One place every row's save goes through: write, then refresh what the rest
   *  of the app is showing. Alerts on failure and rethrows — EditFieldSheet and
   *  the TripEditSheets both keep themselves open when onSave rejects, so the
   *  operator's draft survives a failed write. */
  const save = useCallback(
    async (patch: UpdateGroupTripInput) => {
      try {
        await updateOperatorTrip(tripId, patch);
        await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
        queryClient.invalidateQueries({ queryKey: tripsKeys.all });
      } catch (e) {
        showErrorAlert('Could not save', e, 'Please try again.');
        throw e;
      }
    },
    [tripId, queryClient],
  );

  // Every row below reads `trip` to seed its sheet, and EditAccommodationSheet
  // in particular has no `dirty` check — an operator filling in a kind + name
  // on a null-seeded sheet would silently overwrite the real stay fields with
  // a half-empty patch. So, same as TripDetailScreen (:1597-1627), no row or
  // sheet renders until `trip` is confirmed non-null.
  if (isLoading && !data) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator color="#0788B0" />
        </View>
      </SafeAreaView>
    );
  }

  // Core query has actually resolved (not loading, not placeholder-seeded) and
  // trip is still null — deleted/not found. Minimal fallback, no sheets mounted.
  if (!trip && !isLoading && !isPlaceholderData) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>This trip is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Still in-flight but no placeholder seed available yet.
  if (!trip) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator color="#0788B0" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <EditSection title="Photos">
          <EditRow label="Cover photo" onPress={() => setSheet('cover')} />
        </EditSection>

        <EditSection title="The basics">
          <EditRow label="Trip name" onPress={() => setSheet('title')} />
          <EditRow label="Description" onPress={() => setSheet('description')} />
          <EditRow label="Where" onPress={noop} />
          <EditRow label="When" onPress={noop} />
          <EditRow label="Spots" onPress={noop} />
        </EditSection>

        <EditSection title="Who it's for">
          <EditRow label="Surf level" onPress={() => setSheet('levels')} />
          <EditRow label="Boards" onPress={() => setSheet('boards')} />
          <EditRow label="The wave" onPress={() => setSheet('wave')} />
          <EditRow label="Age" onPress={() => setSheet('age')} />
        </EditSection>

        <EditSection title="The trip">
          <EditRow label="How it works" onPress={() => setSheet('howItWorks')} />
          <EditRow label="Vibe" onPress={() => setSheet('vibe')} />
          <EditRow label="Stay type" onPress={() => setSheet('stayType')} />
          <EditRow label="Your stay" onPress={() => setSheet('stay')} />
          <EditRow label="About you" onPress={() => setSheet('aboutYou')} />
        </EditSection>

        <EditSection title="Price">
          <EditRow label="Price per person" onPress={noop} />
          <EditRow label="Deposit" onPress={noop} />
          <EditRow label="What's included" onPress={noop} />
        </EditSection>

        <EditSection title="Visibility">
          <EditRow label="Listed in explore" onPress={noop} />
        </EditSection>

        <EditSection title="Manage">
          <EditRow label="Requirements" onPress={noop} />
          <EditRow label="Group gear" onPress={noop} />
          <EditRow label="Packing suggestions" onPress={noop} />
          <EditRow label="Admin updates" onPress={noop} />
        </EditSection>

        <View style={{ height: 40 }} />
      </ScrollView>

      <EditCoverSheet
        visible={sheet === 'cover'}
        currentUri={trip.hero_image_url ?? null}
        onClose={close}
        onSave={async (localUri) => {
          // Upload first, then write the row — same order as the wizard
          // (CreateTripFlowA.tsx). A file uploaded before a failed row update
          // is orphaned in storage; harmless, and a retry reuses the remote URL.
          if (!currentUserId) {
            const err = new Error('Not signed in');
            showErrorAlert('Could not save', err, 'Please try again.');
            throw err;
          }
          const res = await uploadTripImage(localUri, currentUserId, 'hero');
          if (!res.success || !res.url) {
            const err = new Error(res.error || 'Failed to upload cover');
            showErrorAlert('Could not upload photo', err, 'Please try again.');
            throw err;
          }
          await save({ hero_image_url: res.url });
        }}
      />

      <EditTextSheet
        visible={sheet === 'title'}
        title="Trip name"
        label="Trip name"
        initialValue={trip.title ?? ''}
        maxLength={80}
        onClose={close}
        onSave={(value) => save({ title: value.trim() })}
      />

      <EditTextSheet
        visible={sheet === 'description'}
        title="Description"
        label="Description"
        initialValue={trip.description ?? ''}
        maxLength={2000}
        onClose={close}
        onSave={(value) => save({ description: value.trim() })}
      />

      <EditTextSheet
        visible={sheet === 'aboutYou'}
        title="About you"
        label="About you"
        initialValue={trip.host_lead_note ?? ''}
        maxLength={1000}
        onClose={close}
        onSave={(value) => save({ host_lead_note: value.trim() || null })}
      />

      <EditAccommodationSheet
        visible={sheet === 'stay'}
        initial={{
          kind: (trip.accommodation_type?.[0] ?? null) as AccommodationInitial['kind'],
          name: trip.accommodation_name ?? '',
          url: trip.accommodation_url ?? '',
          photoUri: trip.accommodation_image_url ?? null,
        }}
        onClose={close}
        onSave={async (next) => {
          // photoUri is either a freshly-picked local uri (needs uploading) or
          // the existing remote url left untouched — only upload the former.
          let imageUrl = next.photoUri;
          if (next.photoUri && !/^https?:\/\//.test(next.photoUri)) {
            if (!currentUserId) {
              const err = new Error('Not signed in');
              showErrorAlert('Could not save', err, 'Please try again.');
              throw err;
            }
            const res = await uploadTripImage(next.photoUri, currentUserId, 'accommodation');
            if (!res.success || !res.url) {
              const err = new Error(res.error || 'Failed to upload stay photo');
              showErrorAlert('Could not upload photo', err, 'Please try again.');
              throw err;
            }
            imageUrl = res.url;
          }
          await save({
            accommodation_type: next.kind ? [next.kind] : null,
            accommodation_name: next.name || null,
            accommodation_url: next.url || null,
            accommodation_image_url: imageUrl,
            specific_stay_selected: true,
          });
        }}
      />

      <EditFieldSheet<SurfLevel[]>
        visible={sheet === 'levels'}
        title="Surf level"
        initial={trip.target_surf_levels}
        onClose={close}
        onSave={(next) => save({ target_surf_levels: next })}
        validate={(next) => (next.length === 0 ? 'Pick at least one surf level.' : null)}
        isDirty={(draft, initial) => !sameStringSet(draft, initial)}
      >
        {(draft, setDraft) => (
          <LevelsSheetContent selected={draft} onChange={setDraft} />
        )}
      </EditFieldSheet>

      {/* target_surf_styles is NOT required to publish (CreateTripFlowA has no
          `fail()` for it) — an empty pick is a valid "any board" state. The
          wizard writes ['all'] rather than [] for that state (both write
          sites: CreateTripFlowA.tsx:2039,2076), so this mirrors that instead
          of introducing a second "empty means what?" answer for the same
          column. */}
      <EditFieldSheet<SurfStyle[]>
        visible={sheet === 'boards'}
        title="Boards"
        initial={trip.target_surf_styles}
        onClose={close}
        onSave={(next) => save({ target_surf_styles: next.length ? next : ['all'] })}
        isDirty={(draft, initial) => !sameStringSet(draft, initial)}
      >
        {(draft, setDraft) => (
          <StyleSheetContent selected={draft} onChange={setDraft} />
        )}
      </EditFieldSheet>

      {/* WaveSheetContent renders BOTH the shape slider and the size range
          slider itself (see the component's own "Shape card" / "Size card") —
          there is no separate mount needed for size. WaveSizeSheetContent
          exists as a sibling file but CreateTripFlowA imports it and never
          renders it (dead import there too), so it is not used here either.
          `wave_shapes` is a DB array column but every write site (this one and
          CreateTripFlowA) treats it as a single value wrapped in a 0/1-length
          array — WaveSheetContent's own prop is `shape: WaveShapeKind | null`. */}
      <EditFieldSheet<{ shape: WaveShapeKind | null; sizeMin: number; sizeMax: number }>
        visible={sheet === 'wave'}
        title="The wave"
        initial={{
          shape: trip.wave_shapes?.[0] ?? null,
          // Same fallback CreateTripFlowA uses when resuming an edit
          // (CreateTripFlowA.tsx:655-656) — wave_size_min/max are nullable
          // columns but the slider needs concrete numbers to render.
          sizeMin: trip.wave_size_min ?? 4,
          sizeMax: trip.wave_size_max ?? 8,
        }}
        onClose={close}
        onSave={(next) => save({
          wave_shapes: next.shape ? [next.shape] : null,
          wave_size_min: next.sizeMin,
          wave_size_max: next.sizeMax,
        })}
        validate={(next) => (next.shape === null ? 'Pick a wave shape.' : null)}
      >
        {(draft, setDraft) => (
          <WaveSheetContent
            shape={draft.shape}
            onShapeChange={(shape) => setDraft({ ...draft, shape })}
            sizeMin={draft.sizeMin}
            sizeMax={draft.sizeMax}
            onSizeChange={({ min, max }) => setDraft({ ...draft, sizeMin: min, sizeMax: max })}
          />
        )}
      </EditFieldSheet>

      <EditFieldSheet<{ ageMin: number | null; ageMax: number | null }>
        visible={sheet === 'age'}
        title="Age"
        initial={{ ageMin: trip.age_min, ageMax: trip.age_max }}
        onClose={close}
        onSave={(next) => save({ age_min: next.ageMin, age_max: next.ageMax })}
        validate={(next) =>
          validateAgeRange(next.ageMin, next.ageMax, AGE_WINDOW_BY_STYLE[trip.hosting_style])
        }
      >
        {(draft, setDraft) => (
          <AgeSheetContent
            ageMin={draft.ageMin}
            ageMax={draft.ageMax}
            ageWindow={AGE_WINDOW_BY_STYLE[trip.hosting_style]}
            onChange={setDraft}
            // Deliberately no `onClose` here. AgeSheetContent's onClose is an
            // auto-dismiss-when-both-fields-filled convenience the create
            // wizard's own step-level sheet chrome uses — wiring it to this
            // screen's `close` would dismiss EditFieldSheet the moment both
            // digits are typed, discarding the draft instead of going through
            // the Save button every other row here requires.
            error={validateAgeRange(
              draft.ageMin,
              draft.ageMax,
              AGE_WINDOW_BY_STYLE[trip.hosting_style],
            ) ?? undefined}
          />
        )}
      </EditFieldSheet>

      {/* trip_structure is NOT required to publish either — same reasoning as
          boards above, mirroring CreateTripFlowA.tsx:2034,2087 (empty -> null,
          not []). */}
      <EditFieldSheet<TripStructureSlug[]>
        visible={sheet === 'howItWorks'}
        title="How it works"
        initial={(trip.trip_structure ?? []) as TripStructureSlug[]}
        onClose={close}
        onSave={(next) => save({ trip_structure: next.length ? next : null })}
        isDirty={(draft, initial) => !sameStringSet(draft, initial)}
      >
        {(draft, setDraft) => (
          <HowItWorksSheetContent selected={draft} onChange={setDraft} />
        )}
      </EditFieldSheet>

      {/* trip_vibes is single-select (VibeSheetContent picks 0 or 1 slug) and
          NOT required to publish (CreateTripFlowA.tsx:2035,2088: empty ->
          null). A 0/1-length array has only one possible order, so the
          default JSON-compare dirty check is fine here — no isDirty needed. */}
      <EditFieldSheet<TripVibeSlug[]>
        visible={sheet === 'vibe'}
        title="Vibe"
        initial={(trip.trip_vibes ?? []) as TripVibeSlug[]}
        onClose={close}
        onSave={(next) => save({ trip_vibes: next.length ? next : null })}
      >
        {(draft, setDraft) => (
          <VibeSheetContent selected={draft} onChange={setDraft} />
        )}
      </EditFieldSheet>

      {/* accommodation_type IS required to publish (CreateTripFlowA.tsx:1730:
          `fail('accommodationKind', 'Pick an accommodation type')`), unlike
          the two rows above. Single value (AccommodationKind | null), not an
          array, so no order-sensitivity concern either. */}
      <EditFieldSheet<AccommodationKind | null>
        visible={sheet === 'stayType'}
        title="Stay type"
        initial={(trip.accommodation_type?.[0] ?? null) as AccommodationKind | null}
        onClose={close}
        onSave={(next) => save({ accommodation_type: next ? [next] : null })}
        validate={(next) => (next === null ? 'Pick an accommodation type.' : null)}
      >
        {(draft, setDraft) => (
          <StayTypeSheetContent selected={draft} onChange={setDraft} />
        )}
      </EditFieldSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F6F6' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: ff('Inter', '700'),
    fontSize: 17,
    color: '#222B30',
  },
  scroll: { paddingBottom: 24 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    color: '#7B7B7B',
    textAlign: 'center',
  },
});
