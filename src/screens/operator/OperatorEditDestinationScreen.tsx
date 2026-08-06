import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { RootStackParamList } from '../../navigation/navigationRef';
import { useTripCore } from '../../hooks/trips/useTripDetail';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import { useOnboarding } from '../../context/OnboardingContext';
import { setOperatorTripDestination } from '../../services/operator/operatorTripsService';
import { destinationLabel } from '../../services/trips/groupTripsService';
import { HomeBreakSearchSheet, type HomeBreakSelection } from '../../components/HomeBreakSearchSheet';
import { InlineMapView } from '../../components/MapPickerModal';
import { showErrorAlert } from '../../utils/friendlyError';
import { ff } from '../../theme/fonts';

type Props = NativeStackScreenProps<RootStackParamList, 'OperatorEditDestination'>;

const MAP_HEIGHT = 160;

/**
 * Static one-marker preview, centered on lat/lng, no interaction. Both
 * CreateTripFlowA (getDestinationMapHtml) and HomeBreakSearchSheet
 * (getPreviewMapHtml) already build the same tiny HTML string inline, but
 * neither is exported — copying markup out of CreateTripFlowA's destination
 * step is explicitly off-limits, so this is its own minimal copy rather than
 * a re-export.
 */
function previewMapHtml(apiKey: string, lat: number, lng: number, label: string): string {
  const safeKey = apiKey.replace(/[<>"']/g, '');
  const safeLabel = label.replace(/[<>"'\\]/g, '');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; height: 100%; }
    #map { width: 100%; height: 100%; position: absolute; left: 0; top: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function() {
      var center = { lat: ${lat}, lng: ${lng} };
      function initMap() {
        var map = new google.maps.Map(document.getElementById('map'), {
          center: center,
          zoom: 12,
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
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + '${safeKey}' + '&callback=initMap';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    })();
  </script>
</body>
</html>`;
}

/** Same header shape as OperatorTripEditScreen's own Header subcomponent —
 *  back chevron, centered title, no third element. */
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
    <Text style={styles.headerTitle}>Where</Text>
    <View style={{ width: 28 }} />
  </View>
);

type Display = { title: string; subtitle: string | null; lat: number | null; lng: number | null };

export default function OperatorEditDestinationScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const queryClient = useQueryClient();
  const { user } = useOnboarding();
  const currentUserId = user?.id?.toString() ?? null;

  const { data, isLoading, isPlaceholderData } = useTripCore(tripId, currentUserId);
  const trip = data?.trip ?? null;

  // The operator's fresh pick from the sheet below. Deliberately NOT seeded
  // from the trip's existing destination — `canSave` gates on this being
  // non-null, and seeding it would light up Save before any real choice was
  // made, inviting an accidental no-op write that still fires the confirm
  // popup. The existing destination is shown separately, from `trip`.
  const [picked, setPicked] = useState<HomeBreakSelection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Belt-and-suspenders against a double-tap firing two writes: `saving`
  // (state) gates the button visually, but two onPress calls in the same
  // tick can both read the pre-update value. This ref is checked and set
  // synchronously, so only the first call ever reaches the network.
  const savingRef = useRef(false);

  const [mapWidth, setMapWidth] = useState(0);
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

  // participant_count includes the host (same field, same reasoning as
  // OperatorTripEditScreen's joinedCount) — no extra query.
  const joinedCount = Math.max(0, (trip?.participant_count ?? 0) - 1);

  const display: Display | null = useMemo(() => {
    if (picked) {
      const title = picked.name || picked.short;
      const subtitle = picked.full && picked.full !== title ? picked.full : null;
      return { title, subtitle, lat: picked.lat, lng: picked.lng };
    }
    if (trip?.destination) {
      const d = trip.destination;
      const title = destinationLabel(d) ?? 'Unnamed place';
      const subtitle = d.short_label && d.short_label !== title ? d.short_label : null;
      return { title, subtitle, lat: d.lat, lng: d.lng };
    }
    return null;
  }, [picked, trip?.destination]);

  const canSave = !!picked && !saving;

  const write = useCallback(async () => {
    if (!picked || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await setOperatorTripDestination(tripId, {
        place_id: picked.placeId ?? null,
        name: picked.name ?? null,
        short_label: picked.short ?? null,
        formatted_address: picked.full ?? null,
        locality: picked.locality ?? null,
        country: picked.country ?? null,
        lat: picked.lat ?? null,
        lng: picked.lng ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.all });
      navigation.goBack();
    } catch (e) {
      // `picked` is left untouched on failure — the operator's selection
      // survives so they don't have to search again to retry.
      showErrorAlert('Could not save', e, 'Something went wrong saving this change.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [picked, tripId, queryClient, navigation]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    if (joinedCount === 0) {
      void write();
      return;
    }
    // Spec §3.5 / §6.1: a country change can invalidate an existing visa
    // requirement. Warning only — this screen never touches requirements.
    //
    // `{ cancelable: false }` mirrors OperatorTripEditScreen's
    // confirmMaterialChange: it disables Android back / tap-outside so the
    // dialog can only close via one of the two buttons below. Not strictly
    // load-bearing here — unlike confirmMaterialChange this Alert isn't
    // wrapped in a Promise and `saving` is only ever set inside write()
    // itself, so a bare dismiss would just close the dialog with no state
    // touched and Save would stay tappable either way — but it keeps the
    // dismissal behavior identical to the rest of this screen's material-change
    // popups instead of leaving one that behaves differently.
    Alert.alert(
      'Change where the trip goes?',
      `${joinedCount} ${joinedCount === 1 ? 'traveler' : 'travelers'} joined for the old place. Make sure you tell them about this change.\n\nA visa requirement may no longer be right.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change it', style: 'destructive', onPress: () => void write() },
      ],
      { cancelable: false },
    );
  }, [canSave, joinedCount, write]);

  const insets = useSafeAreaInsets();

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

      <View style={styles.body}>
        <Text style={styles.sectionLabel}>Destination</Text>

        {display ? (
          <View style={styles.card}>
            {display.lat != null && display.lng != null && apiKey ? (
              <View
                style={styles.mapWrap}
                onLayout={e => {
                  const w = Math.round(e.nativeEvent.layout.width);
                  setMapWidth(prev => (prev === w ? prev : w));
                }}
              >
                {mapWidth > 0 ? (
                  <InlineMapView
                    htmlContent={previewMapHtml(apiKey, display.lat, display.lng, display.title)}
                    width={mapWidth}
                    height={MAP_HEIGHT}
                  />
                ) : null}
              </View>
            ) : null}

            <View style={styles.cardMeta}>
              <Text style={styles.cardTitle} numberOfLines={2}>{display.title}</Text>
              {display.subtitle ? (
                <Text style={styles.cardSubtitle} numberOfLines={2}>{display.subtitle}</Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.changeBtn}
              onPress={() => setPickerOpen(true)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Change destination"
            >
              <Text style={styles.changeBtnText}>Change destination</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.emptyCard}
            onPress={() => setPickerOpen(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Set destination"
          >
            <Ionicons name="location-outline" size={22} color="#7B7B7B" />
            <Text style={styles.emptyText}>Tap to set the destination</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <Pressable
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save"
        >
          {saving
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>

      <HomeBreakSearchSheet
        visible={pickerOpen}
        title="Pick destination"
        confirmTitle="Use this destination"
        searchPlaceholder="Search beaches, towns, breaks…"
        nameOnly
        onClose={() => setPickerOpen(false)}
        onSelect={sel => {
          setPicked(sel);
          setPickerOpen(false);
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
  body: { flex: 1, padding: 20 },
  sectionLabel: {
    fontFamily: ff('Inter', '600'),
    fontSize: 13,
    color: '#7B7B7B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
  },
  mapWrap: {
    height: MAP_HEIGHT,
    backgroundColor: '#F0F0F0',
  },
  cardMeta: { padding: 16 },
  cardTitle: {
    fontFamily: ff('Inter', '700'),
    fontSize: 16,
    color: '#222B30',
  },
  cardSubtitle: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#7B7B7B',
    marginTop: 4,
  },
  changeBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeBtnText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    color: '#212121',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    borderStyle: 'dashed',
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontFamily: ff('Inter', '500'),
    fontSize: 14,
    color: '#7B7B7B',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#F6F6F6',
  },
  // The app's one primary CTA — same as onboarding's Next. See TravelerPriceSheet.
  saveBtn: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#CFCFCF' },
  saveText: { fontFamily: ff('Montserrat', '600'), fontSize: 16, color: '#FFFFFF' },
});
