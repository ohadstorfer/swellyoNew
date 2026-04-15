import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '../../context/OnboardingContext';
import {
  GroupTrip,
  listExploreTrips,
  listMyTrips,
} from '../../services/trips/groupTripsService';
import CreateTripWizard from './CreateTripWizard';

export type TripsTab = 'explore' | 'my' | 'create';

interface TripsScreenProps {
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Segmented tab bar
// ---------------------------------------------------------------------------
const TripsSegmentBar: React.FC<{
  active: TripsTab;
  onChange: (tab: TripsTab) => void;
}> = ({ active, onChange }) => {
  const tabs: { key: TripsTab; label: string }[] = [
    { key: 'my', label: 'MY TRIPS' },
    { key: 'explore', label: 'EXPLORE' },
    { key: 'create', label: 'CREATE' },
  ];
  return (
    <View style={styles.segmentBar}>
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.segmentBtn, isActive && styles.segmentBtnActive]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Trip card (shared by Explore + My Trips)
// ---------------------------------------------------------------------------
const formatTripDates = (trip: GroupTrip): string => {
  if (trip.start_date && trip.end_date) {
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const setInStone = trip.dates_set_in_stone ? '' : ' (flexible)';
    return `${fmt(trip.start_date)} – ${fmt(trip.end_date)}${setInStone}`;
  }
  if (trip.date_months && trip.date_months.length > 0) {
    return trip.date_months
      .map(m => {
        const [y, mo] = m.split('-');
        const date = new Date(Number(y), Number(mo) - 1, 1);
        return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      })
      .join(' / ');
  }
  return 'Dates TBD';
};

const formatDestination = (trip: GroupTrip): string => {
  const parts = [trip.destination_area, trip.destination_country].filter(Boolean);
  if (parts.length === 0) return 'Destination TBD';
  return parts.join(', ');
};

const TripCard: React.FC<{ trip: GroupTrip }> = ({ trip }) => (
  <View style={styles.card}>
    {trip.hero_image_url ? (
      <Image source={{ uri: trip.hero_image_url }} style={styles.cardImage} />
    ) : (
      <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
        <Ionicons name="image-outline" size={32} color="#B0B0B0" />
      </View>
    )}
    <View style={styles.cardBody}>
      {!!trip.title && <Text style={styles.cardTitle}>{trip.title}</Text>}
      <Text style={styles.cardDest}>{formatDestination(trip)}</Text>
      <Text style={styles.cardDates}>{formatTripDates(trip)}</Text>
      <View style={styles.tagRow}>
        <View style={styles.tag}>
          <Text style={styles.tagText}>
            {trip.age_min}–{trip.age_max} yrs
          </Text>
        </View>
        {trip.target_surf_levels.slice(0, 2).map(l => (
          <View key={l} style={styles.tag}>
            <Text style={styles.tagText}>{l}</Text>
          </View>
        ))}
      </View>
    </View>
  </View>
);

// ---------------------------------------------------------------------------
// Explore view
// ---------------------------------------------------------------------------
const ExploreTripsView: React.FC = () => {
  const [trips, setTrips] = useState<GroupTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await listExploreTrips();
    setTrips(data);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#B72DF2" />
      </View>
    );
  }

  return (
    <FlatList
      data={trips}
      keyExtractor={t => t.id}
      renderItem={({ item }) => <TripCard trip={item} />}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Ionicons name="compass-outline" size={48} color="#B0B0B0" />
          <Text style={styles.emptyText}>No group trips yet. Be the first to create one!</Text>
        </View>
      }
    />
  );
};

// ---------------------------------------------------------------------------
// My Trips view
// ---------------------------------------------------------------------------
const MyTripsView: React.FC<{ userId: string | null; onGoCreate: () => void }> = ({
  userId,
  onGoCreate,
}) => {
  const [trips, setTrips] = useState<GroupTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const data = await listMyTrips(userId);
    setTrips(data);
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#B72DF2" />
      </View>
    );
  }

  return (
    <FlatList
      data={trips}
      keyExtractor={t => t.id}
      renderItem={({ item }) => <TripCard trip={item} />}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Ionicons name="airplane-outline" size={48} color="#B0B0B0" />
          <Text style={styles.emptyText}>You haven't created any trips yet.</Text>
          <TouchableOpacity style={styles.emptyCta} onPress={onGoCreate}>
            <Text style={styles.emptyCtaText}>Create your first trip</Text>
          </TouchableOpacity>
        </View>
      }
    />
  );
};

// ---------------------------------------------------------------------------
// Wrapper screen
// ---------------------------------------------------------------------------
export default function TripsScreen({ onBack }: TripsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;

  const [activeTab, setActiveTab] = useState<TripsTab>('explore');
  const [myTripsVersion, setMyTripsVersion] = useState(0); // bump to refresh after create

  const handleCreated = () => {
    setMyTripsVersion(v => v + 1);
    setActiveTab('my');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={[styles.header, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={28} color="#222B30" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trips</Text>
        <View style={{ width: 28 }} />
      </View>

      <TripsSegmentBar active={activeTab} onChange={setActiveTab} />

      <View style={styles.body}>
        {activeTab === 'explore' && <ExploreTripsView />}
        {activeTab === 'my' && (
          <MyTripsView
            key={myTripsVersion}
            userId={currentUserId}
            onGoCreate={() => setActiveTab('create')}
          />
        )}
        {activeTab === 'create' && (
          <CreateTripWizard
            hostId={currentUserId}
            onCreated={handleCreated}
            onCancel={() => setActiveTab('explore')}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#222B30' },

  segmentBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#F2F2F2',
    padding: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentLabel: { fontSize: 12, fontWeight: '600', color: '#7B7B7B', letterSpacing: 0.5 },
  segmentLabelActive: { color: '#222B30' },

  body: { flex: 1, marginTop: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EEE',
  },
  cardImage: { width: '100%', height: 160, backgroundColor: '#F2F2F2' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#222B30', marginBottom: 4 },
  cardDest: { fontSize: 14, color: '#555', marginBottom: 2 },
  cardDates: { fontSize: 13, color: '#7B7B7B', marginBottom: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    backgroundColor: '#F2F2F2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 4,
  },
  tagText: { fontSize: 11, color: '#555', fontWeight: '500' },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  emptyText: { fontSize: 14, color: '#7B7B7B', marginTop: 12, textAlign: 'center' },
  emptyCta: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#B72DF2',
  },
  emptyCtaText: { color: '#FFFFFF', fontWeight: '600' },
});
