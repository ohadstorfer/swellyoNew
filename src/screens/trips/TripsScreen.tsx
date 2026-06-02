import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  SectionList,
  Image,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '../../context/OnboardingContext';
import {
  GroupTrip,
  HostingStyle,
  MyTripsBuckets,
  listExploreTrips,
  listMyTripsByBucket,
} from '../../services/trips/groupTripsService';
import CreateTripWizard from './CreateTripWizard';
import TripDetailScreen from './TripDetailScreen';
import { Images } from '../../assets/images';

// Hosting-style chooser content. Lifted out of CreateTripWizard so the chooser
// can live inline on the Create tab and the wizard becomes a pure router.
const HOSTING_STYLE_OPTIONS: {
  key: HostingStyle;
  title: string;
  desc: string;
  image: number; // placeholder thumbnail (any local asset)
}[] = [
  {
    key: 'A',
    title: 'Planned Together',
    desc: 'Group votes on key decisions.\nYou approve what moves forward.',
    image: Images.whoIsItFor.surfLevel,
  },
  {
    key: 'B',
    title: 'Hosted (you lead decisions)',
    desc: 'You make the decisions.\nMembers join and support the plan.',
    image: Images.whoIsItFor.theWave,
  },
  {
    key: 'C',
    title: 'Trip Operator',
    desc: 'Everything is already decided.\nJoin knowing exactly what to expect.',
    image: Images.whoIsItFor.ageRange,
  },
];

export type TripsTab = 'explore' | 'my' | 'create';

interface TripsScreenProps {
  onBack: () => void;
  /** When provided (e.g. from a push tap), open the detail screen for this trip on mount. */
  initialTripId?: string | null;
  /** Open the group chat linked to a trip. Lifted to AppContent so it can swap to the DM overlay. */
  onOpenGroupChat?: (params: { conversationId: string; title: string; heroImageUrl?: string | null; tripId?: string }) => void;
  /** Tap on a participant inside a trip detail opens their profile. AppContent
   *  records the current trip so the profile back returns here. */
  onViewUserProfile?: (userId: string, fromTripId: string) => void;
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

const formatDestination = (trip: GroupTrip): string =>
  trip.destination?.short_label ||
  trip.destination?.name ||
  trip.destination?.country ||
  'Destination TBD';

type TripCardBadge = 'approved' | 'pending' | 'completed';

const BADGE_LABEL: Record<TripCardBadge, string> = {
  approved: 'Approved',
  pending: 'Pending',
  completed: 'Completed',
};

const TripCard: React.FC<{
  trip: GroupTrip;
  onPress?: () => void;
  badge?: TripCardBadge;
}> = ({ trip, onPress, badge }) => (
  <TouchableOpacity
    style={[styles.card, badge === 'completed' && styles.cardPast]}
    activeOpacity={onPress ? 0.85 : 1}
    onPress={onPress}
    disabled={!onPress}
  >
    {trip.hero_image_url ? (
      <Image source={{ uri: trip.hero_image_url }} style={styles.cardImage} />
    ) : (
      <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
        <Ionicons name="image-outline" size={32} color="#B0B0B0" />
      </View>
    )}
    <View style={styles.cardBody}>
      {badge && (
        <View style={[styles.badge, badge === 'completed' && styles.badgeCompleted]}>
          <Text style={[styles.badgeText, badge === 'completed' && styles.badgeTextCompleted]}>
            {BADGE_LABEL[badge]}
          </Text>
        </View>
      )}
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
  </TouchableOpacity>
);

// ---------------------------------------------------------------------------
// Explore view
// ---------------------------------------------------------------------------
const ExploreTripsView: React.FC<{ onOpenTrip: (tripId: string) => void }> = ({ onOpenTrip }) => {
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
        <ActivityIndicator color="#0788B0" />
      </View>
    );
  }

  return (
    <FlatList
      data={trips}
      keyExtractor={t => t.id}
      renderItem={({ item }) => <TripCard trip={item} onPress={() => onOpenTrip(item.id)} />}
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
interface TripSection {
  title: string;
  badge: TripCardBadge;
  data: GroupTrip[];
}

const MyTripsView: React.FC<{
  userId: string | null;
  onGoCreate: () => void;
  onOpenTrip: (tripId: string) => void;
}> = ({ userId, onGoCreate, onOpenTrip }) => {
  const [buckets, setBuckets] = useState<MyTripsBuckets>({ approved: [], pending: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const data = await listMyTripsByBucket(userId);
    setBuckets(data);
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const allSections: TripSection[] = [
    { title: 'APPROVED', badge: 'approved', data: buckets.approved },
    { title: 'PENDING APPROVAL', badge: 'pending', data: buckets.pending },
    { title: 'PAST TRIPS', badge: 'completed', data: buckets.past },
  ];
  const sections = allSections.filter(s => s.data.length > 0);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#0788B0" />
      </View>
    );
  }

  if (sections.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="airplane-outline" size={48} color="#B0B0B0" />
        <Text style={styles.emptyText}>You haven't joined or created any trips yet.</Text>
        <TouchableOpacity testID="trips-empty-create-button" style={styles.emptyCta} onPress={onGoCreate}>
          <Text style={styles.emptyCtaText}>Create your first trip</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={t => t.id}
      renderItem={({ item, section }) => (
        <TripCard
          trip={item}
          badge={(section as TripSection).badge}
          onPress={() => onOpenTrip(item.id)}
        />
      )}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionHeader}>
          {(section as TripSection).title} ({(section as TripSection).data.length})
        </Text>
      )}
      contentContainerStyle={styles.listContent}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    />
  );
};

// ---------------------------------------------------------------------------
// Wrapper screen
// ---------------------------------------------------------------------------
export default function TripsScreen({ onBack, initialTripId, onOpenGroupChat, onViewUserProfile }: TripsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;

  const [activeTab, setActiveTab] = useState<TripsTab>('explore');
  const [myTripsVersion, setMyTripsVersion] = useState(0); // bump to refresh after create
  const [selectedTripId, setSelectedTripId] = useState<string | null>(initialTripId ?? null);
  const [editingTrip, setEditingTrip] = useState<GroupTrip | null>(null);
  // Which hosting style the user picked from the inline chooser on the Create
  // tab. null = chooser visible; non-null = wizard open in the create modal.
  const [pendingStyle, setPendingStyle] = useState<HostingStyle | null>(null);
  const [wizardStarted, setWizardStarted] = useState(false);

  const createModalVisible = pendingStyle !== null;

  // Deep-link into a trip from a push tap: when initialTripId changes, open it.
  useEffect(() => {
    if (initialTripId) setSelectedTripId(initialTripId);
  }, [initialTripId]);

  const closeCreateModal = () => {
    setPendingStyle(null);
    setWizardStarted(false);
  };

  const handleRequestCloseModal = () => {
    if (!wizardStarted) {
      closeCreateModal();
      return;
    }
    Alert.alert(
      'Discard trip?',
      "You'll lose your progress on this trip.",
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: closeCreateModal },
      ],
    );
  };

  const handleCreated = () => {
    setMyTripsVersion(v => v + 1);
    closeCreateModal();
    setActiveTab('my');
  };

  const handleSavedEdit = () => {
    setMyTripsVersion(v => v + 1);
    setEditingTrip(null);
    // Stay on detail screen so the host sees the updated trip immediately.
  };

  if (editingTrip) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={[styles.header, { paddingTop: 8 }]}>
          <TouchableOpacity
            onPress={() => setEditingTrip(null)}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={28} color="#222B30" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit trip</Text>
          <View style={{ width: 28 }} />
        </View>
        <CreateTripWizard
          hostId={currentUserId}
          hostingStyle={editingTrip.hosting_style}
          initialTrip={editingTrip}
          onCreated={handleSavedEdit}
          onCancel={() => setEditingTrip(null)}
        />
      </SafeAreaView>
    );
  }

  if (selectedTripId) {
    return (
      <TripDetailScreen
        tripId={selectedTripId}
        onBack={() => setSelectedTripId(null)}
        onOpenGroupChat={onOpenGroupChat}
        onEditTrip={setEditingTrip}
        onViewUserProfile={
          onViewUserProfile
            ? (userId: string) => onViewUserProfile(userId, selectedTripId)
            : undefined
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={[styles.header, { paddingTop: 8 }]}>
        <TouchableOpacity testID="trips-back-button" onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={28} color="#222B30" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Trips</Text>
        <View style={{ width: 28 }} />
      </View>

      <TripsSegmentBar active={activeTab} onChange={setActiveTab} />

      <View style={styles.body}>
        {activeTab === 'explore' && <ExploreTripsView onOpenTrip={setSelectedTripId} />}
        {activeTab === 'my' && (
          <MyTripsView
            key={myTripsVersion}
            userId={currentUserId}
            onGoCreate={() => setActiveTab('create')}
            onOpenTrip={setSelectedTripId}
          />
        )}
        {activeTab === 'create' && (
          <ScrollView
            contentContainerStyle={styles.chooserScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.chooserHeading}>Create a surf trip</Text>
            <Text style={styles.chooserSubheading}>
              Plan your next adventure and invite surfers to join you
            </Text>
            {HOSTING_STYLE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={styles.chooserCard}
                onPress={() => setPendingStyle(opt.key)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`${opt.title}. ${opt.desc}`}
              >
                <Image source={opt.image} style={styles.chooserThumb} resizeMode="cover" />
                <View style={styles.chooserBody}>
                  <Text style={styles.chooserCardTitle}>{opt.title}</Text>
                  <Text style={styles.chooserCardDesc}>{opt.desc}</Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color="#7B7B7B"
                  style={styles.chooserChevron}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      <Modal
        visible={createModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleRequestCloseModal}
      >
        {/* The wizard chrome owns the top safe-area + its own close X, so we
            mount it directly in the modal — no SafeAreaView edge, no extra header. */}
        <View style={{ flex: 1, backgroundColor: '#212121' }}>
          {pendingStyle && (
            <CreateTripWizard
              hostId={currentUserId}
              hostingStyle={pendingStyle}
              onCreated={handleCreated}
              onCancel={handleRequestCloseModal}
              onStartedChange={setWizardStarted}
            />
          )}
        </View>
      </Modal>
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

  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4A5565',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#EEE',
  },
  cardPast: { opacity: 0.6 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#0A0A0A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 8,
  },
  badgeCompleted: { backgroundColor: '#D1D5DC' },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  badgeTextCompleted: { color: '#0A0A0A' },
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
    backgroundColor: '#0788B0',
  },
  emptyCtaText: { color: '#FFFFFF', fontWeight: '600' },

  // Inline hosting-style chooser (moved out of CreateTripWizard).
  chooserScroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
  },
  chooserHeading: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 30,
    lineHeight: 39,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 12,
  },
  chooserSubheading: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '400',
    color: '#333333',
    marginBottom: 28,
  },
  chooserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    height: 94,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 12,
    marginBottom: 16,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  chooserThumb: {
    width: 84,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#EEF2F4',
  },
  chooserBody: {
    flex: 1,
    gap: 4,
  },
  chooserCardTitle: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: '#333333',
  },
  chooserCardDesc: {
    fontFamily: Platform.OS === 'web' ? 'Inter, sans-serif' : 'Inter',
    fontSize: 12,
    lineHeight: 18,
    color: '#333333',
  },
  chooserChevron: {
    marginRight: 4,
  },

  modalRoot: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  modalCloseBtn: { padding: 4 },
});
