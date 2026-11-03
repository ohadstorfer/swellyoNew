import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, type TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { RootStackParamList } from '../../navigation/navigationRef';
import { CreateTripWizardChrome } from '../../components/trips/CreateTripWizardChrome';
import { ItineraryDayEditor, ItineraryDayList } from '../../components/trips/create/ItineraryEditor';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { useDiscardConfirm } from '../../hooks/useDiscardConfirm';
import { useOnboarding } from '../../context/OnboardingContext';
import { updateOperatorTrip } from '../../services/operator/operatorTripsService';
import { uploadTripImage } from '../../services/storage/storageService';
import {
  cleanDay,
  cleanItinerary,
  dayHasContent,
  dayLabel,
  isDayPlanned,
  normalizeItinerary,
  tripCalendarDays,
  uploadItineraryPhotos,
  upsertDay,
  type ItineraryDay,
} from '../../services/trips/itinerary';
import { showErrorAlert } from '../../utils/friendlyError';

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorEditItinerary'>;

/**
 * The itinerary after publish: the wizard's step on its own screen, so an
 * operator who skipped it can still add one. Unlike the Edit trip sheets it saves
 * once, at the end, because a plan is written across several days.
 */
export default function OperatorEditItineraryScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const queryClient = useQueryClient();
  const { user } = useOnboarding();
  const currentUserId = user?.id?.toString() ?? null;
  const { data, isLoading, isPlaceholderData } = useTripCore(tripId, currentUserId);
  // A placeholder comes from a feed row, which has no itinerary: seeding from it
  // would start the editor empty and overwrite the plan on Save.
  const trip = isPlaceholderData ? null : (data?.trip ?? null);

  const [days, setDays] = useState<ItineraryDay[] | null>(null);
  const [editing, setEditing] = useState<ItineraryDay | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const focusedInputRef = useRef<TextInput | null>(null);
  const keyboardScrollRef = useRef<(() => void) | null>(null);

  // Seeded once. A refetch while the operator types must not replace their work.
  useEffect(() => {
    if (trip && days === null) setDays(normalizeItinerary(trip.itinerary));
  }, [trip, days]);

  const { guardedCancel } = useDiscardConfirm({
    dirty,
    title: 'Discard your changes?',
    message: 'Your itinerary changes have not been saved.',
    discardLabel: 'Discard',
    keepEditingLabel: 'Keep editing',
    onDiscard: () => navigation.goBack(),
  });

  const closeDay = useCallback(() => {
    if (!editing) return;
    setDays(prev => upsertDay(prev ?? [], editing));
    setEditing(null);
  }, [editing]);

  const handleSave = useCallback(async () => {
    if (!days || !currentUserId) return;
    setSaving(true);
    try {
      const itinerary = await uploadItineraryPhotos(cleanItinerary(days), async uri => {
        const res = await uploadTripImage(uri, currentUserId, 'hero');
        if (!res.success || !res.url) throw new Error(res.error || 'Failed to upload photo');
        return res.url;
      });
      await updateOperatorTrip(tripId, { itinerary });
      await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.all });
      navigation.goBack();
    } catch (e) {
      showErrorAlert('Could not save', e, 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [days, currentUserId, tripId, queryClient, navigation]);

  const copyFrom = useMemo(
    () => (days ?? []).filter(d => isDayPlanned(d) && d.day !== editing?.day),
    [days, editing],
  );

  if (!trip || days === null) {
    return (
      <View style={styles.loading}>
        {isLoading ? <ActivityIndicator color="#333333" /> : null}
      </View>
    );
  }

  const totalDays = tripCalendarDays(trip.start_date, trip.end_date);
  const cleanedEditing = editing ? cleanDay(editing) : null;
  const needsTitle = !!cleanedEditing && dayHasContent(cleanedEditing) && !isDayPlanned(cleanedEditing);

  return (
    <CreateTripWizardChrome
      stepIndex={editing ? editing.day : 0}
      stepCount={1}
      stepTitle={editing ? dayLabel(trip.start_date, editing.day) : 'Trip itinerary'}
      primaryLabel={editing ? 'Done' : 'Save'}
      secondaryLabel="Back"
      onPrimary={editing ? closeDay : handleSave}
      onSecondary={editing ? closeDay : guardedCancel}
      onClose={guardedCancel}
      submitting={saving}
      primaryDisabled={needsTitle}
      focusedInputRef={focusedInputRef}
      keyboardScrollRef={keyboardScrollRef}
    >
      {editing ? (
        <ItineraryDayEditor
          day={editing}
          copyFrom={copyFrom}
          onChange={next => {
            setEditing(next);
            setDirty(true);
          }}
          onInputFocus={input => {
            focusedInputRef.current = input;
            requestAnimationFrame(() => keyboardScrollRef.current?.());
          }}
        />
      ) : (
        <ItineraryDayList
          days={days}
          totalDays={totalDays}
          startISO={trip.start_date}
          endISO={trip.end_date}
          onOpenDay={setEditing}
          onRemoveDay={day => {
            setDays(prev => (prev ?? []).filter(d => d.day !== day));
            setDirty(true);
          }}
        />
      )}
    </CreateTripWizardChrome>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
  },
});
