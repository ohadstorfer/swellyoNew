import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { RootStackParamList } from '../../navigation/navigationRef';
import { EditSection } from '../../components/trips/edit/EditSection';
import { EditRow } from '../../components/trips/edit/EditRow';
import {
  EditTextSheet,
  EditCoverSheet,
  EditAccommodationSheet,
  type AccommodationInitial,
} from '../../components/trips/TripEditSheets';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { updateOperatorTrip } from '../../services/operator/operatorTripsService';
import { uploadTripImage } from '../../services/storage/storageService';
import type { UpdateGroupTripInput } from '../../services/trips/groupTripsService';
import { useOnboarding } from '../../context/OnboardingContext';
import { showErrorAlert } from '../../utils/friendlyError';
import { ff } from '../../theme/fonts';

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorEditTrip'>;

/**
 * Which sheet is open. Tasks 6, 7, 9, 10, 11 and 12 each add their own keys to
 * this union as they wire their rows — if a `setSheet('x')` does not compile,
 * the key is missing from here.
 */
type SheetKey = 'cover' | 'title' | 'description' | 'stay' | 'aboutYou' | null;

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
          <EditRow label="Surf level" onPress={noop} />
          <EditRow label="Boards" onPress={noop} />
          <EditRow label="The wave" onPress={noop} />
          <EditRow label="Age" onPress={noop} />
        </EditSection>

        <EditSection title="The trip">
          <EditRow label="How it works" onPress={noop} />
          <EditRow label="Vibe" onPress={noop} />
          <EditRow label="Stay type" onPress={noop} />
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
