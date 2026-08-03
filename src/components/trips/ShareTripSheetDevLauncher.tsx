// ShareTripSheetDevLauncher — DEV ONLY (LOCAL_MODE). Opens ShareTripSheet for a
// real trip looked up by title, so the post-publish share design can be checked
// without walking the whole create-trip wizard.
//
// The trip is resolved by title at tap time rather than by a hardcoded UUID, so
// this keeps working if the test trip is deleted and recreated.
//
// Mount it while you want the flow open and it calls `onDone` once the host has
// closed everything. It owns the whole lifecycle on purpose: tapping Instagram
// closes the share sheet and opens the story sheet, so the parent must NOT
// unmount on the first close or the story sheet would never appear.
//
// Nothing here ships to users — ConversationsScreen renders it behind the same
// EXPO_PUBLIC_LOCAL_MODE gate as the rest of its dev shortcuts.

import React, { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { supabase } from '../../config/supabase';
import { ShareTripSheet, type TripShareDetails } from './ShareTripSheet';
import { ShareTripStorySheet, type TripStoryVM } from './ShareTripStorySheet';
import { isExpoGo } from '../../utils/keyboardAvoidingView';

interface DevTrip {
  id: string;
  title: string | null;
  vm: TripStoryVM;
  details: TripShareDetails;
}

interface ShareTripSheetDevLauncherProps {
  /** Trip title to look up, e.g. "El Salvador 26". Matched case-insensitively. */
  tripTitle: string;
  /** Fires when the host has closed the flow (or the trip couldn't be found). */
  onDone: () => void;
}

export const ShareTripSheetDevLauncher: React.FC<ShareTripSheetDevLauncherProps> = ({
  tripTitle,
  onDone,
}) => {
  const [trip, setTrip] = useState<DevTrip | null>(null);
  const [sheetVisible, setSheetVisible] = useState(true);
  const [storyVisible, setStoryVisible] = useState(false);
  const [storyPending, setStoryPending] = useState(false);

  const canCreatePost = Platform.OS !== 'web' && !isExpoGo;

  // Keep the latest onDone without re-running the fetch when the parent
  // re-renders with a fresh inline callback.
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('group_trips')
        .select(
          'id, title, hero_image_url, start_date, end_date, duration_days, ' +
            'trip_structure, participant_count, max_participants, ' +
            'destination:group_trip_destinations(name, short_label)'
        )
        .ilike('title', tripTitle)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        Alert.alert('Trip not found', `No trip titled "${tripTitle}" is visible to this account.`);
        onDoneRef.current();
        return;
      }

      const row = data as any;
      // PostgREST returns a to-one embed as an object, but as an array when it
      // can't prove uniqueness — handle both.
      const dest = Array.isArray(row.destination) ? row.destination[0] : row.destination;

      setTrip({
        id: row.id,
        title: row.title ?? null,
        vm: {
          heroImageUri: row.hero_image_url ?? null,
          title: row.title ?? null,
          destinationLabel: dest?.short_label || dest?.name || null,
          startDateISO: row.start_date ? String(row.start_date).slice(0, 10) : null,
          endDateISO: row.end_date ? String(row.end_date).slice(0, 10) : null,
          durationDays: row.duration_days ?? null,
          dateMonths: null,
        },
        details: {
          startDate: row.start_date ?? null,
          endDate: row.end_date ?? null,
          structureSlugs: row.trip_structure ?? null,
          participantCount: row.participant_count ?? null,
          maxParticipants: row.max_participants ?? null,
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [tripTitle]);

  const handleCreatePost = () => {
    if (!canCreatePost) {
      Alert.alert(
        'Not available here',
        'The story card needs react-native-view-shot, which is missing in Expo Go. Try a dev build.'
      );
      return;
    }
    setStoryPending(true);
    setSheetVisible(false);
  };

  // Unmount ourselves only when the HOST closed the sheet, and only after the
  // exit animation (220ms) has played. Deliberately NOT driven by onDismissed:
  // a Modal that fails to present also reports a dismiss, which would tear the
  // whole launcher down the instant it opened.
  const handleClose = () => {
    setSheetVisible(false);
    setTimeout(() => onDoneRef.current(), 300);
  };

  // onDismissed is used for one thing only — handing off to the story sheet
  // once this Modal is fully gone (iOS won't present while one is dismissing).
  const handleSheetDismissed = () => {
    if (!storyPending) return;
    setStoryPending(false);
    setStoryVisible(true);
  };

  return (
    <>
      <ShareTripSheet
        visible={sheetVisible && !!trip}
        onClose={handleClose}
        onDismissed={handleSheetDismissed}
        tripId={trip?.id ?? ''}
        tripTitle={trip?.title ?? tripTitle}
        details={trip?.details}
        onCreatePost={handleCreatePost}
      />

      {storyVisible && !!trip && (
        <ShareTripStorySheet
          visible={storyVisible}
          tripId={trip.id}
          vm={trip.vm}
          onClose={() => {
            setStoryVisible(false);
            onDoneRef.current();
          }}
        />
      )}
    </>
  );
};

export default ShareTripSheetDevLauncher;
