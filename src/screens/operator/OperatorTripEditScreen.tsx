import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { RootStackParamList } from '../../navigation/navigationRef';
import { EditSection } from '../../components/trips/edit/EditSection';
import { EditRow } from '../../components/trips/edit/EditRow';
import { EditFieldSheet, CANCELLED } from '../../components/trips/edit/EditFieldSheet';
import {
  EditTextSheet,
  EditCoverSheet,
  EditAccommodationSheet,
  EditDatesSheet,
  type AccommodationInitial,
  type DatesPatch,
} from '../../components/trips/TripEditSheets';
import { LevelsSheetContent } from '../../components/trips/sheets/LevelsSheetContent';
import { StyleSheetContent } from '../../components/trips/sheets/StyleSheetContent';
import { WaveSheetContent } from '../../components/trips/sheets/WaveSheetContent';
import { AgeSheetContent } from '../../components/trips/sheets/AgeSheetContent';
import { HowItWorksSheetContent } from '../../components/trips/sheets/HowItWorksSheetContent';
import { VibeSheetContent } from '../../components/trips/sheets/VibeSheetContent';
import { StayTypeSheetContent } from '../../components/trips/sheets/StayTypeSheetContent';
import { SpotsSheetContent } from '../../components/trips/sheets/SpotsSheetContent';
import { PriceSheetContent } from '../../components/trips/sheets/PriceSheetContent';
import {
  ActivitiesSheetContent,
  SurfFilmSheetContent,
  VideoAnalysisSheetContent,
  CustomInclusionSheetContent,
  WellnessSheetContent,
} from '../../components/trips/sheets/IncludesSheets';
import TripTagPicker from '../../components/trips/TripTagPicker';
import type { AccommodationKind } from '../../components/trips/AccommodationTypeGrid';
import { useTripCore, useTripRequirements } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { updateOperatorTrip, updateOperatorTripPrice } from '../../services/operator/operatorTripsService';
import { uploadTripImage } from '../../services/storage/storageService';
import {
  type UpdateGroupTripInput,
  type SurfLevel,
  type SurfStyle,
  type WaveShapeKind,
  type TripStructureSlug,
  type TripVibeSlug,
} from '../../services/trips/groupTripsService';
import { resolveDeadlineDate } from '../../services/trips/tripDocumentsService';
import { validateAgeRange, validateSpots, validatePrice, validateDeposit } from '../../services/trips/tripValidation';
import {
  type PriceInclusions,
  MEALS_OPTIONS,
  ACCOMMODATION_INCL_OPTIONS,
  TRANSPORTATION_OPTIONS,
  SURF_SESSIONS_OPTIONS,
  SURF_EQUIPMENT_OPTIONS,
  CATEGORY_TITLE,
  CATEGORY_ORDER,
  summarizeCategory,
  normalizePriceInclusions,
} from '../../services/trips/priceInclusions';
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

/** Drop any "Add your own" item with no title and no description before
 *  writing — same predicate CreateTripFlowA's closeCustomSheet uses
 *  (CreateTripFlowA.tsx:3126-3134) so tapping "Add an inclusion" and never
 *  filling it in doesn't leave a blank object in price_inclusions.custom
 *  forever (fix round 1, Finding 2). */
function pruneBlankCustomInclusions(inc: PriceInclusions): PriceInclusions {
  const custom = Array.isArray(inc.custom) ? inc.custom : [];
  const pruned = custom.filter((c) => c.title.trim() || c.description?.trim());
  return { ...inc, custom: pruned };
}

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorEditTrip'>;

/**
 * Which sheet is open. Tasks 6, 7, 9, 10, 11 and 12 each add their own keys to
 * this union as they wire their rows — if a `setSheet('x')` does not compile,
 * the key is missing from here.
 */
type SheetKey =
  | 'cover' | 'title' | 'description' | 'stay' | 'aboutYou'
  | 'when' | 'spots'
  | 'levels' | 'boards' | 'wave' | 'age'
  | 'howItWorks' | 'vibe' | 'stayType'
  | 'price' | 'includes'
  | null;

/** Flat multi-select categories inside price_inclusions — rendered with
 *  TripTagPicker, exactly like CreateTripFlowA's own pricing step
 *  (CreateTripFlowA.tsx:4162-4241). */
type FlatIncludeKey =
  | 'meals' | 'accommodation' | 'transportation' | 'surfSessions' | 'surfEquipment';
const FLAT_INCLUDE_OPTIONS: Record<FlatIncludeKey, readonly { slug: string; label: string }[]> = {
  meals: MEALS_OPTIONS,
  accommodation: ACCOMMODATION_INCL_OPTIONS,
  transportation: TRANSPORTATION_OPTIONS,
  surfSessions: SURF_SESSIONS_OPTIONS,
  surfEquipment: SURF_EQUIPMENT_OPTIONS,
};
const FLAT_INCLUDE_KEYS = new Set<string>(Object.keys(FLAT_INCLUDE_OPTIONS));

/**
 * "What's included" editor. Every category body below — ActivitiesSheetContent,
 * WellnessSheetContent, SurfFilmSheetContent, VideoAnalysisSheetContent,
 * CustomInclusionSheetContent, and TripTagPicker for the flat categories — is
 * the exact component the create-wizard's pricing step renders
 * (CreateTripFlowA.tsx renderPricingStep, ~3136-3329 / 4162-4322), reused with
 * its real props. Nothing here reimplements one of those bodies.
 *
 * The wizard opens each category in its own nested bottom sheet. This screen
 * expands the category in place instead: EditFieldSheet already owns the one
 * Modal this row gets, and stacking a second Modal per category (nine of them)
 * on top of it is a lot of moving parts for the row that spec §7.2 explicitly
 * says is NOT the risky one — Price/Deposit is. An accordion keeps every
 * category inside the single surface EditFieldSheet already supplies, with no
 * second Modal at all.
 */
const IncludesEditorContent: React.FC<{
  value: PriceInclusions;
  onChange: (next: PriceInclusions) => void;
}> = ({ value, onChange }) => {
  const [expanded, setExpanded] = useState<keyof PriceInclusions | null>(null);

  const setCategory = (key: keyof PriceInclusions, v: unknown) => {
    onChange({ ...value, [key]: v } as PriceInclusions);
  };

  const customList = Array.isArray(value.custom) ? value.custom : [];

  return (
    <View style={includesStyles.wrap}>
      {CATEGORY_ORDER.map((key) => {
        const isOpen = expanded === key;
        const summary = summarizeCategory(value, key);
        return (
          <View key={key} style={includesStyles.card}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={includesStyles.rowHeader}
              onPress={() => setExpanded(isOpen ? null : key)}
              accessibilityRole="button"
              accessibilityLabel={CATEGORY_TITLE[key]}
              accessibilityState={{ expanded: isOpen }}
            >
              <View style={{ flex: 1 }}>
                <Text style={includesStyles.rowTitle}>{CATEGORY_TITLE[key]}</Text>
                {!!summary && (
                  <Text style={includesStyles.rowSummary} numberOfLines={1}>{summary}</Text>
                )}
              </View>
              <Ionicons
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#7B7B7B"
              />
            </TouchableOpacity>

            {isOpen && (
              <View style={includesStyles.rowBody}>
                {FLAT_INCLUDE_KEYS.has(key) ? (
                  <TripTagPicker<string>
                    options={[...FLAT_INCLUDE_OPTIONS[key as FlatIncludeKey]]}
                    selected={(value[key] as string[] | undefined) ?? []}
                    onChange={(next) => setCategory(key, next)}
                    accessibilityLabel={`${CATEGORY_TITLE[key]} included`}
                  />
                ) : key === 'surfFilm' ? (
                  <SurfFilmSheetContent
                    value={value.surfFilm ?? {}}
                    onChange={(next) => setCategory('surfFilm', next)}
                  />
                ) : key === 'videoAnalysis' ? (
                  <VideoAnalysisSheetContent
                    value={value.videoAnalysis ?? {}}
                    onChange={(next) => setCategory('videoAnalysis', next)}
                  />
                ) : key === 'activities' ? (
                  <ActivitiesSheetContent
                    value={value.activities ?? []}
                    onChange={(next) => setCategory('activities', next)}
                  />
                ) : key === 'wellness' ? (
                  <WellnessSheetContent
                    value={value.wellness ?? []}
                    onChange={(next) => setCategory('wellness', next)}
                  />
                ) : null}
              </View>
            )}
          </View>
        );
      })}

      <Text style={includesStyles.customHeader}>Add your own</Text>
      {customList.map((item, i) => (
        <View key={i} style={includesStyles.card}>
          <CustomInclusionSheetContent
            value={item}
            onChange={(next) => {
              setCategory('custom', customList.map((c, j) => (j === i ? next : c)));
            }}
            onRemove={() => {
              setCategory('custom', customList.filter((_, j) => j !== i));
            }}
          />
        </View>
      ))}
      <TouchableOpacity
        activeOpacity={0.85}
        style={includesStyles.addBtn}
        onPress={() => setCategory('custom', [...customList, { title: '', description: '' }])}
        accessibilityRole="button"
        accessibilityLabel="Add an inclusion"
      >
        <Ionicons name="add" size={20} color="#0788B0" />
        <Text style={includesStyles.addBtnText}>
          {customList.length > 0 ? 'Add another' : 'Add an inclusion'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const includesStyles = StyleSheet.create({
  wrap: { paddingVertical: 8, gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  rowTitle: { fontFamily: ff('Inter', '700'), fontSize: 15, color: '#222B30' },
  rowSummary: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: 2 },
  rowBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E4E4E4',
    paddingTop: 14,
  },
  customHeader: {
    fontFamily: ff('Inter', '700'),
    fontSize: 14,
    color: '#222B30',
    marginTop: 8,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderWidth: 1,
    borderColor: '#0788B0',
    borderRadius: 12,
  },
  addBtnText: { fontFamily: ff('Inter', '700'), fontSize: 14, color: '#0788B0' },
});

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

  /**
   * Two helpers, two families — fix round 1, Finding 1.
   *
   * `EditFieldSheet.write()` (EditFieldSheet.tsx:76-86) already shows an error
   * alert itself when its `onSave` throws. The `TripEditSheets` family
   * (EditCoverSheet, EditTextSheet, EditDatesSheet, EditAccommodationSheet)
   * does the opposite — their own onSave catch blocks are deliberately empty
   * with the comment "onSave surfaces its own error alert"
   * (TripEditSheets.tsx:184-185,274,415,517), so THEY depend on whatever they
   * call to alert on failure.
   *
   * One shared write-and-rethrow helper used by both families would either
   * alert twice (EditFieldSheet rows, if the helper alerts) or alert zero
   * times (TripEditSheets rows, if it doesn't) — there's no single behavior
   * that's correct for both. So there are two helpers, named for the family
   * each is for, and every call site below picks the one that matches its
   * sheet.
   */

  /** For the TripEditSheets family ONLY (Cover, Trip name, Description, About
   *  you, When, Your stay). Alerts once on failure, then rethrows so the sheet
   *  stays open with the draft intact. Do NOT wire an EditFieldSheet row to
   *  this — see `saveField` below, which is what those need instead. */
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

  /** For EditFieldSheet rows ONLY (Spots, Surf level, Boards, The wave, Age,
   *  How it works, Vibe, Stay type, What's included). Writes, refreshes the
   *  caches, and rethrows on failure with NO alert of its own —
   *  EditFieldSheet.write() already shows one. Calling `save` above from one
   *  of these rows would show that alert AND this one, stacked. */
  const saveField = useCallback(
    async (patch: UpdateGroupTripInput) => {
      await updateOperatorTrip(tripId, patch);
      await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.all });
    },
    [tripId, queryClient],
  );

  // This screen is only reachable from TripDetailScreen's "Edit trip" menu
  // entry, itself gated on `isTripOwner` (TripDetailScreen.tsx:554,1735) — so
  // the current user is always the host here. Recomputed the same way rather
  // than assumed `true`, since `trip` can still be null pre-load.
  const isHost = !!currentUserId && trip?.host_id === currentUserId;

  // participant_count includes the host. It is what max_participants is
  // compared against everywhere else (isFull, the join trigger), so the spots
  // floor has to use this exact number — see spec §7.1.
  const participantCount = trip?.participant_count ?? 0;
  // Everyone who is not the host: the people a material change needs telling.
  const joinedCount = Math.max(0, participantCount - 1);

  // Host-only: the stored requirement rows, so a date change can report what
  // it does to their deadlines. Same query TripDetailScreen's own requirements
  // editor uses (useTripDetail.ts:211) — no new fetch shape invented here.
  const requirementsQuery = useTripRequirements(tripId, isHost);

  /**
   * One sentence about what a new start date does to the requirement
   * deadlines, or '' when there is nothing to say. Spec §9.
   *
   * Only counts ACTIVE, SKIPPABLE requirements. A must-have row (passport,
   * waiver, deposit) has `deadline_days_before = null` in the DB — no real due
   * date — the `daysBefore` `fetchTripRequirements` fills in for it is a UI
   * stepper default, not a deadline (tripDocumentsService.ts:485-491). Feeding
   * that fabricated number into `resolveDeadlineDate` would report a deadline
   * moving that never existed, so must-have rows are excluded.
   *
   * `requirementsQuery.data === undefined` (still loading, or errored with no
   * cached data) is reported as such rather than silently folded into "no
   * deadlines move" — those two are not the same claim, and an operator who
   * confirms quickly, before the fetch lands, deserves to know which one is
   * true. Does not block or await the fetch; the confirm popup opens either
   * way.
   *
   * It only reports; it does not change anything. Whether a deadline that has
   * already passed re-opens when the trip moves later is still an OPEN
   * question (spec §11 #3) — do not decide it here.
   */
  const describeDeadlineShift = useCallback(
    (patch: { start_date?: string | null }): string => {
      const nextStart = patch.start_date ?? null;
      if (!nextStart || !trip?.start_date || nextStart === trip.start_date) return '';
      if (requirementsQuery.data === undefined) return 'Deadline changes are still loading.';
      const rows = requirementsQuery.data.filter(r => r.isActive && r.skippable);
      if (rows.length === 0) return '';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let moved = 0;
      let inThePast = 0;
      for (const row of rows) {
        const next = resolveDeadlineDate(nextStart, row.daysBefore);
        if (!next) continue;
        moved += 1;
        if (next.getTime() < today.getTime()) inThePast += 1;
      }
      if (moved === 0) return '';
      const head = `${moved} ${moved === 1 ? 'deadline moves' : 'deadlines move'}.`;
      if (inThePast === 0) return head;
      return `${head} ${inThePast} ${inThePast === 1 ? 'lands' : 'land'} in the past.`;
    },
    [requirementsQuery.data, trip?.start_date],
  );

  /**
   * EditDatesSheet's own reset effect (TripEditSheets.tsx:365-370) resets its
   * local draft on every render where `initial` has a new reference — unlike
   * EditFieldSheet, it has no closed->open edge guard (no `prevVisible` ref).
   * Building this object with an inline IIFE in the JSX below gave it a new
   * identity on EVERY render of this screen, for ANY reason — including
   * `requirementsQuery` (a wholly separate hook) resolving in the background
   * while the operator has the sheet open. That reseeds the sheet's local
   * `startDate`/`endDate` state back to the trip's stored dates, silently
   * discarding an in-progress pick with no error and no cue.
   *
   * Memoized and keyed on the trip's actual date fields, NOT on `trip` itself
   * — keying on the whole object would still churn identity on every refetch
   * that returns an equivalent-but-new `trip`, defeating the point.
   */
  const datesInitial = useMemo(() => {
    const months = [...(trip?.date_months ?? [])].sort();
    return {
      datesMode: trip?.start_date ? ('exact' as const) : ('months' as const),
      startDateISO: trip?.start_date ?? null,
      endDateISO: trip?.end_date ?? null,
      monthFrom: months[0] ?? '',
      monthTo: months[months.length - 1] ?? '',
      durationDays: trip?.duration_days ?? null,
    };
  }, [
    trip?.start_date,
    trip?.end_date,
    trip?.dates_set_in_stone,
    trip?.date_months,
    trip?.duration_days,
  ]);

  /**
   * Same class of bug as `datesInitial` above, and the same fix: audited
   * every other sheet on this screen (see Task 7 fix-round-1 report) and
   * `EditAccommodationSheet` is the only other one whose own reset effect
   * (TripEditSheets.tsx, its `useEffect(() => { if (visible) {...} },
   * [visible, initial])`) lacks a closed->open guard. Every `EditFieldSheet`
   * row below is safe as-is — EditFieldSheet's own effect is guarded by a
   * `prevVisible` ref (EditFieldSheet.tsx:57-63), so a churned `initial`
   * reference while it stays open does not reseed the draft. EditCoverSheet's
   * `currentUri` and every `EditTextSheet`'s `initialValue` are plain strings
   * (value-compared, not reference-compared), so they cannot churn identity
   * on an unrelated re-render either way.
   */
  const accommodationInitial = useMemo<AccommodationInitial>(() => ({
    kind: (trip?.accommodation_type?.[0] ?? null) as AccommodationInitial['kind'],
    name: trip?.accommodation_name ?? '',
    url: trip?.accommodation_url ?? '',
    photoUri: trip?.accommodation_image_url ?? null,
  }), [
    trip?.accommodation_type,
    trip?.accommodation_name,
    trip?.accommodation_url,
    trip?.accommodation_image_url,
  ]);

  // Per the note above, EditFieldSheet itself doesn't need this memo to stay
  // correct (its own prevVisible guard covers a churning reference) — this is
  // just to stop the 'price' and 'includes' sheets from doing a pointless
  // JSON.stringify dirty-check + re-render of their children on every
  // unrelated re-render of this screen (Global Constraints: memoise
  // object/array props passed to children that reset on reference change).
  const priceInitial = useMemo(() => ({
    costPerPerson: trip?.cost_per_person ?? null,
    depositAmount: trip?.deposit_amount ?? null,
  }), [trip?.cost_per_person, trip?.deposit_amount]);

  const includesInitial = useMemo<PriceInclusions>(
    () => trip?.price_inclusions ?? {},
    [trip?.price_inclusions],
  );

  /**
   * Spec §3.5. Ask before writing a field people joined on the basis of.
   *
   * Returns a promise that REJECTS on Cancel, because every sheet in this
   * screen treats a rejected onSave as "stay open, keep the draft" — which is
   * exactly what Cancel should do. The rejection carries a marker (CANCELLED)
   * so the error alert can be skipped; a cancel is not a failure.
   *
   * `{ cancelable: false }` is load-bearing, not decorative: it is what makes
   * every dismissal path settle the promise. On Android it disables both the
   * back button and tap-outside-to-dismiss, so the alert can only close via
   * one of the two buttons below, each of which resolves or rejects. On iOS
   * `cancelable` is a no-op — Alert.alert there has no back-button or
   * tap-outside dismissal to begin with. Without this flag, an Android back
   * press would close the dialog without firing either onPress and leave the
   * promise — and the sheet's `saving` spinner — hanging forever.
   *
   * Skips the popup entirely when the operator is the only person on the trip.
   */
  const confirmMaterialChange = useCallback(
    (title: string, message: string, confirmLabel: string, run: () => Promise<void>) => {
      if (joinedCount === 0) return run();
      return new Promise<void>((resolve, reject) => {
        Alert.alert(title, message, [
          { text: 'Cancel', style: 'cancel', onPress: () => reject(CANCELLED) },
          {
            text: confirmLabel,
            style: 'destructive',
            onPress: () => { run().then(resolve, reject); },
          },
        ], { cancelable: false });
      });
    },
    [joinedCount],
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
          <EditRow
            label="Where"
            onPress={() => navigation.navigate('OperatorEditDestination', { tripId })}
          />
          <EditRow label="When" onPress={() => setSheet('when')} />
          <EditRow label="Spots" onPress={() => setSheet('spots')} />
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
          <EditRow label="Price per person" onPress={() => setSheet('price')} />
          <EditRow label="Deposit" onPress={() => setSheet('price')} />
          <EditRow label="What's included" onPress={() => setSheet('includes')} />
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

      <EditDatesSheet
        visible={sheet === 'when'}
        initial={datesInitial}
        onClose={close}
        onSave={(patch: DatesPatch) => confirmMaterialChange(
          'Change the dates?',
          [
            `${joinedCount} ${joinedCount === 1 ? 'traveler' : 'travelers'} joined on the old dates. Make sure you tell them about this change.`,
            describeDeadlineShift(patch),
          ].filter(Boolean).join('\n\n'),
          'Change it',
          () => save(patch),
        )}
      />

      <EditFieldSheet<number | null>
        visible={sheet === 'spots'}
        title="Spots"
        initial={trip.max_participants}
        onClose={close}
        // participant_count only — never broaden this patch. The Task 2
        // trigger has no `old` term in its condition, so it also rejects a
        // no-op rewrite of an already-over-capacity value; this row's Save
        // is dirty-gated (EditFieldSheet's default JSON compare) and writes
        // max_participants alone, so a re-save of an untouched value never
        // reaches the trigger in the first place.
        onSave={(next) => saveField({ max_participants: next })}
        validate={(next) => validateSpots(next, participantCount)}
      >
        {(draft, setDraft) => (
          <SpotsSheetContent
            value={draft}
            participantCount={participantCount}
            onChange={setDraft}
          />
        )}
      </EditFieldSheet>

      <EditAccommodationSheet
        visible={sheet === 'stay'}
        initial={accommodationInitial}
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
        onSave={(next) => saveField({ target_surf_levels: next })}
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
        onSave={(next) => saveField({ target_surf_styles: next.length ? next : ['all'] })}
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
        onSave={(next) => saveField({
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
        onSave={(next) => saveField({ age_min: next.ageMin, age_max: next.ageMax })}
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
        onSave={(next) => saveField({ trip_structure: next.length ? next : null })}
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
        onSave={(next) => saveField({ trip_vibes: next.length ? next : null })}
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
        onSave={(next) => saveField({ accommodation_type: next ? [next] : null })}
        validate={(next) => (next === null ? 'Pick an accommodation type.' : null)}
      >
        {(draft, setDraft) => (
          <StayTypeSheetContent selected={draft} onChange={setDraft} />
        )}
      </EditFieldSheet>

      {/* Price + Deposit share ONE sheet on purpose (spec §7.2): the DB CHECK
          deposit_amount <= cost_per_person ties them, so splitting the rows
          would let an operator save a deposit the very next price edit
          invalidates. THE rule for this row: cost_per_person/deposit_amount
          must never reach the database through anything but
          updateOperatorTripPrice — it freezes every already-joined
          traveler's price (trg_freeze_traveler_price only does this at join
          time on a 'managed' trip; this is what covers everyone who joined
          while the trip was 'offline') BEFORE the new number is written. The
          screen's generic `save()` above calls updateOperatorTrip and must
          never be used for these two fields.
          onSave deliberately does NOT catch/alert here — EditFieldSheet's own
          `write()` already does that once on a thrown error; save() above
          also alerts, so routing this through save() (or duplicating its
          try/catch here) would show the failure twice. */}
      <EditFieldSheet<{ costPerPerson: number | null; depositAmount: number | null }>
        visible={sheet === 'price'}
        title="Price"
        initial={priceInitial}
        onClose={close}
        onSave={async (next) => {
          await updateOperatorTripPrice(tripId, {
            cost_per_person: next.costPerPerson,
            deposit_amount: next.depositAmount,
          });
          await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
          queryClient.invalidateQueries({ queryKey: tripsKeys.all });
        }}
        validate={(next) =>
          validatePrice(next.costPerPerson)
          ?? validateDeposit(next.depositAmount, next.costPerPerson)
        }
      >
        {(draft, setDraft) => (
          <PriceSheetContent
            costPerPerson={draft.costPerPerson}
            depositAmount={draft.depositAmount}
            currency={trip.budget_currency}
            onChange={setDraft}
            // No `error` here — EditFieldSheet already shows the `validate`
            // message once (see PriceSheetContent's own doc comment / Task 6).
          />
        )}
      </EditFieldSheet>

      {/* price_inclusions has nothing to do with the price number — its own
          sheet, own row. Empty inclusions is a legitimate answer, so no
          `validate` here. pruneBlankCustomInclusions drops any never-filled-in
          "Add your own" item (fix round 1, Finding 2) before
          normalizePriceInclusions collapses an all-untouched `{}` back to
          null, so an operator who opens and closes this sheet without picking
          anything — or adds a blank custom row and saves anyway — doesn't
          leave junk behind in the column. Uses saveField, not save — this is
          an EditFieldSheet row (see the two-helper note above `save`). */}
      <EditFieldSheet<PriceInclusions>
        visible={sheet === 'includes'}
        title="What's included"
        initial={includesInitial}
        onClose={close}
        onSave={(next) => saveField({
          price_inclusions: normalizePriceInclusions(pruneBlankCustomInclusions(next)),
        })}
      >
        {(draft, setDraft) => (
          <IncludesEditorContent value={draft} onChange={setDraft} />
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
