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
  Modal,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useOnboarding } from '../../context/OnboardingContext';
import {
  GroupTrip,
  HostingStyle,
  MyTripsBuckets,
  TripCardMeta,
  getTripCardMeta,
  listExploreTrips,
  listMyTripsByBucket,
} from '../../services/trips/groupTripsService';
import CreateTripWizard from './CreateTripWizard';
import { WIZARD_STATE_VERSION } from './CreateTripFlowA';
import {
  peekTripWizardDraft,
  clearTripWizardDraft,
} from '../../hooks/useTripWizardDraft';
import TripDetailScreen from './TripDetailScreen';
import { Images } from '../../assets/images';
import { Logo } from '../../components/Logo';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';

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
// Header tabs (underline style, sit inside the dark header — per Figma)
// ---------------------------------------------------------------------------
const TripsHeaderTabs: React.FC<{
  active: TripsTab;
  onChange: (tab: TripsTab) => void;
}> = ({ active, onChange }) => {
  const tabs: { key: TripsTab; label: string }[] = [
    { key: 'my', label: 'My Trips' },
    { key: 'explore', label: 'Explore' },
    { key: 'create', label: 'Create' },
  ];
  return (
    <View style={styles.tabsRow}>
      {tabs.map(t => {
        const isActive = active === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, isActive ? styles.tabBtnActive : styles.tabBtnInactive]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : styles.tabLabelInactive]}>
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

// Status drives the colored badge under the card image (mirrors the Figma
// Upcoming / Requested / Completed variants).
type TripCardStatus = 'upcoming' | 'requested' | 'completed';

const STATUS_BADGE: Record<
  TripCardStatus,
  { bg: string; icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  upcoming: { bg: '#84EBB4', icon: 'briefcase-outline', label: 'Upcoming' },
  requested: { bg: '#FFB443', icon: 'chatbox-ellipses-outline', label: 'Requested' },
  completed: { bg: '#F7F7F7', icon: 'checkmark-circle-outline', label: 'Completed' },
};

const TripCard: React.FC<{
  trip: GroupTrip;
  status: TripCardStatus;
  meta?: TripCardMeta;
  onPress?: () => void;
}> = ({ trip, status, meta, onPress }) => {
  const badge = STATUS_BADGE[status];
  const avatars = meta?.memberAvatars ?? [];
  const total = meta?.totalCount ?? trip.participant_count ?? 0;
  const overflow = total - avatars.length;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={onPress ? 0.9 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.cardImageWrap}>
        {trip.hero_image_url ? (
          <Image source={{ uri: trip.hero_image_url }} style={styles.cardImageBg} />
        ) : (
          <View style={[styles.cardImageBg, styles.cardImagePlaceholder]}>
            <Ionicons name="image-outline" size={32} color="#B0B0B0" />
          </View>
        )}

        {/* Host row (top-left) */}
        <View style={styles.hostRow}>
          {meta?.hostAvatar ? (
            <Image source={{ uri: meta.hostAvatar }} style={styles.hostAvatar} />
          ) : (
            <View style={[styles.hostAvatar, styles.hostAvatarPlaceholder]}>
              <Ionicons name="person" size={18} color="#FFFFFF" />
            </View>
          )}
          {!!meta?.hostName && (
            <Text style={styles.hostName} numberOfLines={1}>
              {meta.hostName}
            </Text>
          )}
        </View>

        {/* Bottom darkening so the title/description stay legible on any photo */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)']}
          style={styles.cardGradient}
          pointerEvents="none"
        />

        <View style={styles.cardTextBlock}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {formatDestination(trip)}
          </Text>
          {!!trip.description && (
            <Text style={styles.cardDesc} numberOfLines={2}>
              {trip.description}
            </Text>
          )}
        </View>

        {/* Participant cluster (bottom-right). Falls back to an icon + count when
            no avatars are available (e.g. Explore trips the viewer isn't in). */}
        {avatars.length > 0 ? (
          <View style={styles.avatarCluster}>
            {avatars.map((uri, i) => (
              <Image
                key={`${uri}-${i}`}
                source={{ uri }}
                style={[styles.clusterAvatar, i > 0 && styles.clusterAvatarOverlap]}
              />
            ))}
            {overflow > 0 && <Text style={styles.clusterMore}>+{overflow}</Text>}
          </View>
        ) : total > 0 ? (
          <View style={[styles.avatarCluster, styles.avatarClusterCount]}>
            <Ionicons name="people" size={16} color="#7B7B7B" />
            <Text style={styles.clusterMore}>{total}</Text>
          </View>
        ) : null}
      </View>

      {/* Status badge */}
      <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
        <View style={styles.statusIcon}>
          <Ionicons name={badge.icon} size={16} color="#0A0A0A" />
        </View>
        <View style={styles.statusTextRow}>
          <Text style={styles.statusLabel}>{badge.label}</Text>
          <Text style={styles.statusDate}>{formatTripDates(trip)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

// ---------------------------------------------------------------------------
// Filter pills (My Trips) — All / Upcoming (n) / Requested (n) / Completed (n)
// ---------------------------------------------------------------------------
type TripFilter = 'all' | 'upcoming' | 'requested' | 'completed';

const TripFilterBar: React.FC<{
  active: TripFilter;
  counts: { upcoming: number; requested: number; completed: number };
  onChange: (f: TripFilter) => void;
}> = ({ active, counts, onChange }) => {
  const items: { key: TripFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'upcoming', label: `Upcoming (${counts.upcoming})` },
    { key: 'requested', label: `Requested (${counts.requested})` },
    { key: 'completed', label: `Completed (${counts.completed})` },
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
    >
      {items.map(it => {
        const isActive = active === it.key;
        return (
          <TouchableOpacity
            key={it.key}
            style={[styles.filterPill, isActive ? styles.filterPillActive : styles.filterPillInactive]}
            onPress={() => onChange(it.key)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.filterText, isActive ? styles.filterTextActive : styles.filterTextInactive]}>
              {it.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

// ---------------------------------------------------------------------------
// Explore view
// ---------------------------------------------------------------------------
const ExploreTripsView: React.FC<{ onOpenTrip: (tripId: string) => void }> = ({ onOpenTrip }) => {
  const [trips, setTrips] = useState<GroupTrip[]>([]);
  const [meta, setMeta] = useState<Map<string, TripCardMeta>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await listExploreTrips();
    setTrips(data);
    setMeta(await getTripCardMeta(data));
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
      renderItem={({ item }) => (
        <TripCard
          trip={item}
          status={item.status === 'completed' ? 'completed' : 'upcoming'}
          meta={meta.get(item.id)}
          onPress={() => onOpenTrip(item.id)}
        />
      )}
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
// Bucket → card status: approved trips are upcoming, pending join requests are
// "requested", past trips are completed.
const BUCKET_STATUS: Record<'approved' | 'pending' | 'past', TripCardStatus> = {
  approved: 'upcoming',
  pending: 'requested',
  past: 'completed',
};

const MyTripsView: React.FC<{
  userId: string | null;
  onGoCreate: () => void;
  onOpenTrip: (tripId: string) => void;
}> = ({ userId, onGoCreate, onOpenTrip }) => {
  const [buckets, setBuckets] = useState<MyTripsBuckets>({ approved: [], pending: [], past: [] });
  const [meta, setMeta] = useState<Map<string, TripCardMeta>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<TripFilter>('all');

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const data = await listMyTripsByBucket(userId);
    setBuckets(data);
    setMeta(await getTripCardMeta([...data.approved, ...data.pending, ...data.past]));
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Flatten buckets into one tagged list, then filter by the active pill.
  const tagged: { trip: GroupTrip; status: TripCardStatus }[] = [
    ...buckets.approved.map(trip => ({ trip, status: BUCKET_STATUS.approved })),
    ...buckets.pending.map(trip => ({ trip, status: BUCKET_STATUS.pending })),
    ...buckets.past.map(trip => ({ trip, status: BUCKET_STATUS.past })),
  ];
  const counts = {
    upcoming: buckets.approved.length,
    requested: buckets.pending.length,
    completed: buckets.past.length,
  };
  const visible = filter === 'all' ? tagged : tagged.filter(x => x.status === filter);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#0788B0" />
      </View>
    );
  }

  if (tagged.length === 0) {
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
    <FlatList
      data={visible}
      keyExtractor={x => x.trip.id}
      ListHeaderComponent={
        <TripFilterBar active={filter} counts={counts} onChange={setFilter} />
      }
      renderItem={({ item }) => (
        <TripCard
          trip={item.trip}
          status={item.status}
          meta={meta.get(item.trip.id)}
          onPress={() => onOpenTrip(item.trip.id)}
        />
      )}
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        <View style={styles.filterEmpty}>
          <Text style={styles.emptyText}>Nothing here yet.</Text>
        </View>
      }
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
  // true when the wizard should load the saved draft (user tapped "Continue" on
  // the resume prompt). Reset to false for a fresh start.
  const [resumeDraft, setResumeDraft] = useState(false);

  const createModalVisible = pendingStyle !== null;

  // Tapping a flow card: if there's a saved draft for THIS flow, ask whether to
  // resume it before opening the wizard. A draft from a different flow is left
  // untouched (it gets overwritten only once this flow first saves).
  const openWizard = (key: HostingStyle, resume: boolean) => {
    setResumeDraft(resume);
    setPendingStyle(key);
  };

  const onPickStyle = async (key: HostingStyle) => {
    const draft = await peekTripWizardDraft();
    const hasResumableDraft =
      !!draft && draft.version === WIZARD_STATE_VERSION && draft.hostingStyle === key;
    if (!hasResumableDraft) {
      openWizard(key, false);
      return;
    }
    if (Platform.OS === 'web') {
      // RN Alert ignores custom buttons on web — use the native confirm.
      const cont = window.confirm(
        'You have an unfinished trip. Continue where you left off?\n\n(Cancel to start fresh.)',
      );
      if (!cont) await clearTripWizardDraft();
      openWizard(key, cont);
      return;
    }
    Alert.alert(
      'Continue your trip?',
      'You have an unfinished trip. Pick up where you left off?',
      [
        {
          text: 'Start fresh',
          style: 'destructive',
          onPress: async () => {
            await clearTripWizardDraft();
            openWizard(key, false);
          },
        },
        { text: 'Continue', onPress: () => openWizard(key, true) },
      ],
      { cancelable: false },
    );
  };

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
    // Android hardware-back / swipe path. The wizard autosaves as you go, so
    // closing keeps the draft (restorable next time) — it never discards.
    Alert.alert(
      'Are you sure you want to exit?',
      'Your progress will be saved — you can pick it back up next time.',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes, exit', onPress: closeCreateModal },
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
      <View style={styles.tripsHeader}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              testID="trips-back-button"
              onPress={onBack}
              style={styles.backBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            <Logo size={36} iconOnly />
            <Text style={styles.tripsHeaderTitle}>Trips</Text>
          </View>
          <NotificationCenter userId={currentUserId} />
        </View>

        <TripsHeaderTabs active={activeTab} onChange={setActiveTab} />
      </View>

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
                onPress={() => void onPickStyle(opt.key)}
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
              // The wizard runs its own discard confirm (the X / Cancel button)
              // before calling onCancel — so here we just close. The Modal's
              // onRequestClose still routes hardware-back / swipe through the
              // confirming handler.
              onCancel={closeCreateModal}
              onStartedChange={setWizardStarted}
              resumeDraft={resumeDraft}
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#212121' },

  // White header reused only by the "Edit trip" sub-screen.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#222B30' },

  // Dark header (Figma): logo + "Trips" + notification bell, underline tabs below.
  tripsHeader: {
    backgroundColor: '#212121',
    paddingTop: 4,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tripsHeaderTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  tabsRow: {
    flexDirection: 'row',
    paddingTop: 4,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  tabBtnActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#05BCD3',
  },
  tabBtnInactive: {
    borderBottomWidth: 2,
    borderBottomColor: '#7B7B7B',
  },
  tabLabel: { fontSize: 16, lineHeight: 22 },
  tabLabelActive: { color: '#05BCD3', fontWeight: '600' },
  tabLabelInactive: { color: '#FFFFFF', fontWeight: '500' },

  body: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  listContent: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },

  // Filter pills (My Trips).
  filterRow: { flexDirection: 'row', gap: 11, paddingBottom: 12 },
  filterPill: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  filterPillActive: { backgroundColor: '#212121' },
  filterPillInactive: {
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#EEEEEE',
  },
  filterText: { fontSize: 14, lineHeight: 20 },
  filterTextActive: { color: '#FFFFFF' },
  filterTextInactive: { color: '#333333' },
  filterEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },

  // Trip card (Figma): photo with overlaid host/title/avatars + status badge.
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 8,
    marginBottom: 16,
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 3,
  },
  cardImageWrap: {
    width: '100%',
    aspectRatio: 328 / 246,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#F2F2F2',
  },
  cardImageBg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },

  hostRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  hostAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: '#3A3A3A',
  },
  hostAvatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  hostName: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 130,
  },
  cardTextBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 20,
    paddingRight: 92, // leave room for the avatar cluster
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cardDesc: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  avatarCluster: {
    position: 'absolute',
    right: 12,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 56,
    paddingVertical: 2,
    paddingLeft: 2,
    paddingRight: 8,
  },
  clusterAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#DDDDDD',
  },
  clusterAvatarOverlap: { marginLeft: -12 },
  avatarClusterCount: { gap: 4, paddingLeft: 8 },
  clusterMore: {
    marginLeft: 6,
    fontSize: 14,
    color: '#7B7B7B',
    fontWeight: '500',
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 22,
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
  },
  statusLabel: { color: '#0A0A0A', fontSize: 15 },
  statusDate: { color: '#4A5565', fontSize: 14 },

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
