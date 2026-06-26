import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  Share,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { FadeInUp, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '../../context/OnboardingContext';
import {
  GroupTrip,
  EnrichedParticipant,
  EnrichedJoinRequest,
  GroupTripJoinRequest,
  GroupGearItem,
  PersonalGearItem,
  AdminUpdate,
  EnrichedGearItem,
  EnrichedGearRequest,
  TRIP_STRUCTURE_OPTIONS,
  TRIP_VIBE_OPTIONS,
  DESTINATION_FAMILIARITY_OPTIONS,
  STAY_FAMILIARITY_OPTIONS,
  listGearItems,
  addGearItem,
  updateGearItem,
  deleteGearItem,
  setMyGearClaim,
  listGearRequests,
  createGearRequest,
  approveGearRequest,
  declineGearRequest,
  getTripById,
  updateGroupTrip,
  getGroupTripInviteUrl,
  getTripParticipants,
  getMyJoinRequest,
  listPendingRequests,
  listDeclinedRequests,
  requestToJoinTrip,
  withdrawJoinRequest,
  approveJoinRequest,
  declineJoinRequest,
  cancelTrip,
  completeTrip,
  isTripPast,
  leaveTrip,
  removeParticipant,
  type CommitmentStatus,
  setTripGroupGear,
  setMyGroupGear,
  setMyPersonalGearList,
  listAdminUpdates,
  addAdminUpdate,
  updateAdminUpdate,
  deleteAdminUpdate,
  type SurfStyle,
  type WaveShapeKind,
} from '../../services/trips/groupTripsService';
import { type TripDetailVM, BOARD_SHORT } from '../../components/trips/TripDetailView';
import { TripDetailViewRedesigned } from '../../components/trips/TripDetailViewRedesigned';
import {
  EditTextSheet,
  EditCoverSheet,
  EditDatesSheet,
  EditAccommodationSheet,
  type DatesPatch,
  type AccommodationInitial,
} from '../../components/trips/TripEditSheets';
import { uploadTripImage } from '../../services/storage/storageService';
import { logEvent, logEventThrottled } from '../../services/analytics/eventLogger';
import { TripTabToggle, type TripTab } from '../../components/trips/TripTabToggle';
import { NotificationCenter } from '../../components/notifications/NotificationCenter';
import type { TripDetailFocus } from '../../services/notifications/notificationsService';
import { HostTag } from '../../components/trips/HostTag';
import { AdminUpdateSheet } from '../../components/trips/updates/AdminUpdateSheet';
import { AddPersonalGearSheet } from '../../components/trips/gear/AddPersonalGearSheet';
import { ReportTripSheet } from '../../components/ReportTripSheet';
import { PersonalGearSheet } from '../../components/trips/gear/PersonalGearSheet';
import ParticipantCard from '../../components/trips/ParticipantCard';
import PendingRequestCard from '../../components/trips/PendingRequestCard';
import { GearItemSheet } from '../../components/trips/gear/GearItemSheet';
import { RequestGearSheet } from '../../components/trips/gear/RequestGearSheet';
import { ManageGearSheet } from '../../components/trips/gear/ManageGearSheet';
import { GearRequestsSheet } from '../../components/trips/gear/GearRequestsSheet';
import {
  CommitPill,
  TripMemberSection,
  AdminUpdatesCard,
  GroupGearCard,
  YourGearCard,
} from '../../components/trips/plan/PlanSections';
import { ff } from '../../theme/fonts';
import { supabase } from '../../config/supabase';
import { messagingService } from '../../services/messaging/messagingService';
import { useQueryClient } from '@tanstack/react-query';
import { tripsKeys } from '../../hooks/trips/useTripQueries';
import {
  useTripCore,
  useTripAdminUpdates,
  useTripGear,
  useTripRequests,
  useTripGearRequests,
} from '../../hooks/trips/useTripDetail';
import { useTripRealtime } from '../../hooks/trips/useTripRealtime';
import { TripDetailSkeleton } from '../../components/skeletons';

interface TripDetailScreenProps {
  tripId: string;
  onBack: () => void;
  onOpenGroupChat?: (params: { conversationId: string; title: string; heroImageUrl?: string | null; tripId?: string }) => void;
  onEditTrip?: (trip: GroupTrip) => void;
  /** Tap on a participant opens their profile. Back from the profile returns here. */
  onViewUserProfile?: (userId: string) => void;
  /** Optional — wires the header notification bell (Figma). Bell is hidden when
   *  not provided, since a non-functional bell is worse than none. */
  onOpenNotifications?: () => void;
  /** Tap on a bell notification deep-links to its trip (may be another trip). */
  onOpenTrip?: (tripId: string, focus?: TripDetailFocus) => void;
  /**
   * Deep-link landing spot (from a notification tap). Switches to the Plan tab
   * and scrolls to the section once data + layout are ready. Silently falls
   * back to Overview when the viewer can't see Plan (non-member, locked trip)
   * or the target section isn't rendered.
   */
  initialFocus?: TripDetailFocus | null;
  /** "View all" on the admin-updates preview pushes the full Updates list. */
  onViewAllUpdates?: () => void;
  /** "View all" on the Members section / Overview Participants row pushes the full
   *  Members list (permission layers resolved inside that screen). */
  onViewAllMembers?: () => void;
  /** "View all" on the Group Gear preview pushes the full Packing & Gear list. */
  onViewAllGroupGear?: () => void;
  onViewAllYourGear?: () => void;
  /** Host "Manage" on the Your Gear section pushes the full suggested-gear editor. */
  onManageSuggestedGear?: () => void;
  /** Host "Manage" on the Group Gear card pushes the full-screen Manage Gear editor. */
  onManageGroupGear?: () => void;
  /** Member "Commit to this trip" → pushes the full-screen commitment flow. */
  onOpenCommitment?: (args: { tripTitle: string | null; initialItems: string[]; initialNote: string | null }) => void;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors TripsScreen formatting so cards and details stay in sync)
// ---------------------------------------------------------------------------
const formatDates = (trip: GroupTrip): string => {
  if (trip.start_date && trip.end_date) {
    const fmt = (d: string) =>
      new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const setInStone = trip.dates_set_in_stone ? '' : ' (flexible)';
    return `${fmt(trip.start_date)} – ${fmt(trip.end_date)}${setInStone}`;
  }
  if (trip.date_months && trip.date_months.length > 0) {
    return trip.date_months
      .map(m => {
        const [y, mo] = m.split('-');
        return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, {
          month: 'short',
          year: 'numeric',
        });
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

const WAVE_SHAPE_LABEL: Record<WaveShapeKind, string> = {
  soft: 'Mellow',
  wally: 'Standing',
  barrel: 'Barreling',
};

const titleCase = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Build the shared TripDetailView model from a real trip + its participants.
const buildTripDetailVM = (
  trip: GroupTrip,
  participantCount: number,
  host?: EnrichedParticipant | null,
): TripDetailVM => ({
  heroImageUri: trip.hero_image_url || null,
  title: trip.title,
  destinationLabel:
    trip.destination?.short_label ||
    trip.destination?.name ||
    trip.destination?.country ||
    null,
  startDateISO: trip.start_date,
  endDateISO: trip.end_date,
  dateMonths: trip.date_months,
  durationDays: trip.duration_days,
  skillLevels: trip.target_surf_levels ?? [],
  ageMin: trip.age_min ?? null,
  ageMax: trip.age_max ?? null,
  participantCount: participantCount || trip.participant_count || 1,
  maxParticipants: trip.max_participants,
  description: trip.description ?? '',
  vibeSlug: trip.trip_vibes?.[0] ?? null,
  surfStyles: (trip.target_surf_styles ?? []) as SurfStyle[],
  structureSlugs: trip.trip_structure ?? [],
  waveSizeMin: trip.wave_size_min,
  waveSizeMax: trip.wave_size_max,
  waveShapeLabel: trip.wave_shapes?.length
    ? WAVE_SHAPE_LABEL[trip.wave_shapes[0] as WaveShapeKind] ?? null
    : null,
  specificStaySelected: trip.specific_stay_selected,
  accommodationKindLabel: trip.accommodation_type?.length
    ? titleCase(String(trip.accommodation_type[0]))
    : null,
  accommodationName: trip.accommodation_name,
  accommodationImageUri: trip.accommodation_image_url,
  accommodationUrl: trip.accommodation_url,
  costPerPerson: trip.cost_per_person,
  priceInclusions: trip.price_inclusions,
  budgetMin: trip.budget_min,
  budgetMax: trip.budget_max,
  budgetTier: (trip.budget_tier as 'low' | 'medium' | 'high' | null) ?? null,
  hostingStyle: trip.hosting_style,
  leader:
    trip.hosting_style === 'B'
      ? {
          name: host?.name ?? null,
          avatarUrl: host?.profile_image_url ?? null,
          age: host?.age ?? null,
          countryFrom: null, // not in participant data; shown when available
          surfLevelLabel: host?.surf_level_category
            ? titleCase(host.surf_level_category)
            : null,
          tripsCount: null, // travel_experience not in participant data
          destinationFamiliarityLabel: trip.host_destination_familiarity
            ? DESTINATION_FAMILIARITY_OPTIONS.find(
                o => o.slug === trip.host_destination_familiarity,
              )?.label ?? null
            : null,
          stayFamiliarityLabel: trip.host_stay_familiarity
            ? STAY_FAMILIARITY_OPTIONS.find(o => o.slug === trip.host_stay_familiarity)?.label ??
              null
            : null,
          leadNote: trip.host_lead_note ?? null,
        }
      : null,
});

const formatRelativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
};

// ---------------------------------------------------------------------------
const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}> = ({ title, children, headerRight }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {headerRight ? <View>{headerRight}</View> : null}
    </View>
    {children}
  </View>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const DangerRow: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  showDivider?: boolean;
}> = ({ icon, label, onPress, loading, showDivider }) => (
  <TouchableOpacity
    style={[styles.dangerRow, showDivider && styles.dangerRowDivider]}
    onPress={onPress}
    disabled={loading}
    activeOpacity={0.6}
  >
    {loading ? (
      <ActivityIndicator color="#C0392B" />
    ) : (
      <>
        <Ionicons name={icon} size={20} color="#C0392B" />
        <Text style={styles.dangerRowText}>{label}</Text>
      </>
    )}
  </TouchableOpacity>
);

// ---------------------------------------------------------------------------
export default function TripDetailScreen({ tripId, onBack, onOpenGroupChat, onEditTrip, onViewUserProfile, onOpenNotifications, onOpenTrip, initialFocus, onViewAllUpdates, onViewAllMembers, onViewAllGroupGear, onViewAllYourGear, onManageSuggestedGear, onManageGroupGear, onOpenCommitment }: TripDetailScreenProps) {
  const { user: contextUser } = useOnboarding();
  const insets = useSafeAreaInsets();
  const currentUserId = contextUser?.id?.toString() ?? null;
  const queryClient = useQueryClient();

  // Data from react-query cache (survives screen unmount → instant reopen).
  const coreQuery = useTripCore(tripId, currentUserId);
  const trip = coreQuery.data?.trip ?? null;
  const participants = coreQuery.data?.participants ?? [];
  const myRequest = coreQuery.data?.myRequest ?? null;

  // Discreet "report this whole trip" flow — available to members and non-members alike.
  const [reportSheetVisible, setReportSheetVisible] = useState(false);
  // Header kebab (⋮) overflow menu: Chat / Report / Share for everyone, plus
  // Complete / Cancel for the host.
  const [menuVisible, setMenuVisible] = useState(false);
  // placeholderData seeds the trip from the list cache with participants: []
  // and myRequest: null, so until the real fetch lands we DON'T know whether
  // the viewer is a member. Member-dependent chrome (join CTA, deep-link
  // fallback) must wait for this — otherwise members see a "Request to Join"
  // flash on every open.
  const membershipKnown = !!coreQuery.data && !coreQuery.isPlaceholderData;

  // isHostDerived must be derived before any hook that depends on it so hook
  // call order stays stable across renders (no conditional hooks).
  const isHostDerived = !!trip && !!currentUserId && trip.host_id === currentUserId;

  const updatesQuery = useTripAdminUpdates(tripId);
  const adminUpdates = updatesQuery.data ?? [];

  const gearQuery = useTripGear(tripId, currentUserId);
  const gearItems = gearQuery.data ?? [];

  const requestsQuery = useTripRequests(tripId, isHostDerived);
  const pendingRequests = requestsQuery.data?.pending ?? [];
  const declinedRequests = requestsQuery.data?.declined ?? [];

  const gearRequestsQuery = useTripGearRequests(tripId, isHostDerived);
  const gearRequests = gearRequestsQuery.data ?? [];

  // Live refresh while the screen is open — other users' approvals, joins,
  // leaves, trip edits and admin updates invalidate the queries above.
  useTripRealtime(tripId);

  const [submitting, setSubmitting] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [editingPacking, setEditingPacking] = useState(false);
  const [groupGearDraft, setGroupGearDraft] = useState('');
  const [savingPacking, setSavingPacking] = useState(false);
  // Member-private gear: each user adds/removes only their own; host items
  // live in trip.personal_gear_host_suggestion and aren't editable from here.
  const [addingPersonalItem, setAddingPersonalItem] = useState(false);
  const [personalItemDraft, setPersonalItemDraft] = useState('');
  const [savingPersonalItem, setSavingPersonalItem] = useState(false);
  // Overview = public read-only facts; Plan = interactive (members only).
  const [activeTab, setActiveTab] = useState<TripTab>('overview');
  // Host-only inline edit sheets (Figma admin view): cover / about-host / description / dates / accommodation.
  const [editSheet, setEditSheet] = useState<
    'cover' | 'about' | 'description' | 'dates' | 'accommodation' | null
  >(null);

  // Shared gear — items with required quantities + request flow
  // (group_trip_gear_items / _gear_claims / _gear_requests). Distinct from
  // the host's checklist (which lives on group_trips.personal_gear_host_suggestion).
  // gearItems + gearRequests now come from react-query (declared above).
  const [gearItemSheetItem, setGearItemSheetItem] = useState<EnrichedGearItem | null>(null);
  const [requestSheetVisible, setRequestSheetVisible] = useState(false);
  const [manageSheetVisible, setManageSheetVisible] = useState(false);
  // Group Gear "+ Add item" — opens the add-item sheet in place (Figma
  // 12919-32232), without leaving for the "Edit Group Gear" screen.
  const [addGroupGearSheetOpen, setAddGroupGearSheetOpen] = useState(false);
  const [requestsSheetVisible, setRequestsSheetVisible] = useState(false);
  // New gear/update sheets (Plan tab redesign)
  const [personalGearSheetOpen, setPersonalGearSheetOpen] = useState(false);
  const [addPersonalSheetOpen, setAddPersonalSheetOpen] = useState(false);
  const [processingGearRequestId, setProcessingGearRequestId] = useState<string | null>(null);

  // Admin updates — host-posted free-text lines, visible to all members.
  // adminUpdates now comes from react-query (declared above).
  const [addingUpdate, setAddingUpdate] = useState(false);
  const [updateTitleDraft, setUpdateTitleDraft] = useState('');
  const [updateDraft, setUpdateDraft] = useState('');
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);

  const isHost = isHostDerived;
  const isApprovedMember = useMemo(
    () =>
      !!currentUserId &&
      participants.some(p => p.user_id === currentUserId && p.role !== 'host'),
    [participants, currentUserId]
  );
  const hasNonHostMembers = useMemo(
    () => participants.some(p => p.role !== 'host'),
    [participants]
  );

  // ── Notification deep-link: land on the right tab + section ───────────────
  // Plan sections register their content-relative Y here as they lay out; the
  // focus effect scrolls once the target exists. 'your-gear' is nested inside
  // the 'gear' section, so its absolute Y is the sum of both.
  const scrollRef = useRef<ScrollView>(null);
  // Sticky Overview/Plan toggle: track scroll position and the toggle's resting
  // Y so a clone can clip under the black header once the real one scrolls past.
  const scrollY = useRef(new Animated.Value(0)).current;
  const toggleYRef = useRef(0);
  const [toggleY, setToggleY] = useState(0);
  const [toggleStuck, setToggleStuck] = useState(false);
  const sectionYs = useRef<Record<string, number>>({});
  const appliedFocusRef = useRef<string | null>(null);
  const registerSection = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      sectionYs.current[key] = e.nativeEvent.layout.y;
    },
    []
  );
  useEffect(() => {
    sectionYs.current = {}; // stale Ys from another trip must not be scroll targets
  }, [tripId]);

  // Flip the sticky toggle on/off only as the scroll crosses the toggle's resting
  // Y (not every frame) — the clone's opacity itself is driven natively below.
  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      const next = toggleYRef.current > 0 && value >= toggleYRef.current;
      setToggleStuck(prev => (prev !== next ? next : prev));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  // Analytics: "active in this trip today" (chart C). Throttled per (user, trip).
  useEffect(() => {
    logEventThrottled('trip_opened', { tripId });
  }, [tripId]);

  useEffect(() => {
    // membershipKnown: placeholder-seeded data has participants: [] — deciding
    // the Plan-vs-Overview fallback on it would dump members on Overview.
    if (!trip || !initialFocus || !membershipKnown) return;
    const token = `${tripId}:${initialFocus}`;
    if (appliedFocusRef.current === token) return; // once per (trip, focus)
    appliedFocusRef.current = token;

    const locked = trip.status === 'cancelled' || trip.status === 'completed' || isTripPast(trip);
    const canSeePlanNow = (isHost || isApprovedMember) && !locked;
    if (initialFocus === 'overview' || !canSeePlanNow) return; // fallback: Overview

    setActiveTab('plan');
    if (initialFocus === 'gear-requests' && isHost) setRequestsSheetVisible(true);

    // Scroll once the Plan sections have mounted and reported layout. If the
    // target never renders (e.g. no commit pill for hosts, no pending
    // requests), give up quietly — the user is at the top of Plan, which is
    // the right fallback.
    let attempts = 0;
    let cancelled = false;
    const tryScroll = () => {
      if (cancelled) return;
      const ys = sectionYs.current;
      const y =
        initialFocus === 'your-gear'
          ? ys['gear'] != null && ys['your-gear'] != null
            ? ys['gear'] + ys['your-gear']
            : undefined
          : ys[initialFocus];
      if (y != null) {
        scrollRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
      } else if (attempts++ < 30) {
        requestAnimationFrame(tryScroll);
      }
    };
    requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [trip, tripId, initialFocus, isHost, isApprovedMember, membershipKnown]);
  const meParticipant = useMemo(
    () => participants.find(p => p.user_id === currentUserId),
    [participants, currentUserId]
  );
  const myCommitmentStatus: CommitmentStatus = meParticipant?.commitment_status ?? 'none';
  const myCommitmentItems = meParticipant?.commitment_items ?? [];
  const myCommitmentNote = meParticipant?.commitment_note ?? null;
  // Members section (Plan tab) — avatars + committed-to-trip count. The passport
  // badge tracks the `committed` flag (host counts as committed by default).
  const memberList = useMemo(
    () =>
      participants.map(p => ({
        id: p.user_id,
        name: p.name ?? null,
        avatarUrl: p.profile_image_url ?? null,
        committed: !!p.committed,
        isHost: p.role === 'host',
      })),
    [participants]
  );
  const committedCount = useMemo(
    () => participants.filter(p => p.committed).length,
    [participants]
  );
  const myGroupGear = useMemo<GroupGearItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.personal_gear_by_host ?? [],
    [participants, currentUserId]
  );
  const myPersonalGear = useMemo<PersonalGearItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.personal_gear_by_me ?? [],
    [participants, currentUserId]
  );
  const gearTotalCount = (trip?.personal_gear_host_suggestion?.length ?? 0) + myPersonalGear.length;
  // Combined rows (host-suggested + my own) for the "Your gear" summary preview.
  const gearAllRows = [
    ...(trip?.personal_gear_host_suggestion ?? []).map(name => ({
      kind: 'host' as const,
      name,
      done: myGroupGear.find(it => it.name === name)?.done ?? false,
    })),
    ...myPersonalGear.map(it => ({ kind: 'mine' as const, name: it.name, done: it.done })),
  ];
  // Data is now managed by react-query hooks above.
  // refreshGear / refreshGearRequests replaced by queryClient.invalidateQueries.

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  // Tapping "Request to join" sends the request straight away — no note sheet.
  const handleRequestToJoin = async () => {
    if (!currentUserId) return;
    setSubmitting(true);
    try {
      const newReq = await requestToJoinTrip(tripId, currentUserId);
      queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
        tripsKeys.detail(tripId),
        prev => (prev ? { ...prev, myRequest: newReq } : prev)
      );
    } catch (e: any) {
      Alert.alert('Could not send request', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!myRequest) return;
    const prevStatus = myRequest.status;
    const reqId = myRequest.id;

    // Flip the CTA to "Request to join" immediately, then fire the write in the
    // background. Withdrawing a pending request is a fire-and-forget status
    // change: server-side the UPDATE is ~10ms, but awaiting the REST round trip
    // showed a 6-8s spinner whenever the call stalled (cold realtime socket /
    // token-refresh auth-lock on RN). Optimistic update + rollback removes the
    // wait without losing correctness — the realtime broadcast reconciles the
    // cache once the write commits.
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
      tripsKeys.detail(tripId),
      prev =>
        prev && prev.myRequest
          ? { ...prev, myRequest: { ...prev.myRequest, status: 'withdrawn' } }
          : prev
    );

    try {
      await withdrawJoinRequest(reqId);
    } catch (e: any) {
      // Roll back so the CTA reflects reality (write never committed).
      queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
        tripsKeys.detail(tripId),
        prev =>
          prev && prev.myRequest
            ? { ...prev, myRequest: { ...prev.myRequest, status: prevStatus } }
            : prev
      );
      Alert.alert('Could not withdraw', e?.message || 'Please try again.');
    }
  };

  const handleApprove = async (requestId: string) => {
    setProcessingRequestId(requestId);
    try {
      await approveJoinRequest(requestId);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailRequests(tripId) });
      queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
    } catch (e: any) {
      Alert.alert('Could not approve', e?.message || 'Please try again.');
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleOpenGroupChat = async () => {
    if (!trip || !onOpenGroupChat) return;
    setOpeningChat(true);
    try {
      let conv = await messagingService.getConversationByTripId(trip.id);
      if (!conv) {
        // Legacy trip created before this feature shipped — create the conversation lazily.
        conv = await messagingService.createGroupConversation(
          trip.title || 'Surftrip',
          [],
          { trip_id: trip.id }
        );
      }
      onOpenGroupChat({
        conversationId: conv.id,
        title: trip.title || 'Surftrip',
        heroImageUrl: trip.hero_image_url ?? null,
        tripId: trip.id,
      });
    } catch (e: any) {
      Alert.alert('Could not open chat', e?.message || 'Please try again.');
    } finally {
      setOpeningChat(false);
    }
  };

  const handleDecline = async (requestId: string) => {
    setProcessingRequestId(requestId);
    try {
      const moved = pendingRequests.find(r => r.id === requestId);
      await declineJoinRequest(requestId);
      queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripRequestsData>(
        tripsKeys.detailRequests(tripId),
        prev => {
          if (!prev) return prev;
          return {
            pending: prev.pending.filter(r => r.id !== requestId),
            declined: moved
              ? [{ ...moved, status: 'declined' as const }, ...prev.declined.filter(r => r.id !== requestId)]
              : prev.declined,
          };
        }
      );
    } catch (e: any) {
      Alert.alert('Could not decline', e?.message || 'Please try again.');
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleRemoveParticipant = (userId: string) => {
    const target = participants.find(p => p.user_id === userId);
    const name = target?.name || 'this participant';
    Alert.alert(
      'Remove from trip',
      `Are you sure you want to remove ${name}? They'll be notified and removed from the group chat.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingUserId(userId);
            try {
              await removeParticipant(tripId, userId);
              queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
                tripsKeys.detail(tripId),
                prev =>
                  prev ? { ...prev, participants: prev.participants.filter(p => p.user_id !== userId) } : prev
              );
            } catch (e: any) {
              Alert.alert('Could not remove', e?.message || 'Please try again.');
            } finally {
              setRemovingUserId(null);
            }
          },
        },
      ]
    );
  };

  const handleCancelTrip = () => {
    Alert.alert(
      'Cancel trip',
      'This will hide the trip from Explore. Existing participants will see it as cancelled. You can\'t undo this.',
      [
        { text: 'Keep trip', style: 'cancel' },
        {
          text: 'Cancel trip',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelTrip(tripId);
              queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
                tripsKeys.detail(tripId),
                prev => (prev && prev.trip ? { ...prev, trip: { ...prev.trip, status: 'cancelled' } } : prev)
              );
              queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
              queryClient.invalidateQueries({ queryKey: tripsKeys.explore });
            } catch (e: any) {
              Alert.alert('Could not cancel', e?.message || 'Please try again.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const handleCompleteTrip = () => {
    Alert.alert(
      'Mark trip as completed?',
      "This closes the trip. Members keep the group chat and overview, but the plan is locked. You can't undo this.",
      [
        { text: 'Keep open', style: 'cancel' },
        {
          text: 'Mark completed',
          style: 'destructive',
          onPress: async () => {
            setCompleting(true);
            try {
              await completeTrip(tripId);
              queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
                tripsKeys.detail(tripId),
                prev => (prev && prev.trip ? { ...prev, trip: { ...prev.trip, status: 'completed' } } : prev)
              );
              queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
              setActiveTab('overview');
            } catch (e: any) {
              Alert.alert('Could not complete', e?.message || 'Please try again.');
            } finally {
              setCompleting(false);
            }
          },
        },
      ]
    );
  };

  const handleLeaveTrip = () => {
    if (!currentUserId) return;
    Alert.alert(
      'Leave trip',
      "You'll be removed from the group chat. You can request to join again later.",
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveTrip(tripId, currentUserId);
              queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
                tripsKeys.detail(tripId),
                prev =>
                  prev ? { ...prev, participants: prev.participants.filter(p => p.user_id !== currentUserId) } : prev
              );
              queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
            } catch (e: any) {
              Alert.alert('Could not leave', e?.message || 'Please try again.');
            } finally {
              setLeaving(false);
            }
          },
        },
      ]
    );
  };


  // ---- Host-only inline edits (Figma admin view). Each persists one field via
  // updateGroupTrip and merges it locally (updateGroupTrip returns only the base
  // row, so we keep the existing joined `destination`/host data on `trip`).
  const patchTripCache = (patch: Partial<GroupTrip>) => {
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
      tripsKeys.detail(tripId),
      prev => (prev && prev.trip ? { ...prev, trip: { ...prev.trip, ...patch } } : prev)
    );
    queryClient.invalidateQueries({ queryKey: ['trips', 'my'] });
  };

  const handleSaveCover = async (localUri: string) => {
    if (!trip || !currentUserId) return;
    const res = await uploadTripImage(localUri, currentUserId, 'hero');
    if (!res.success || !res.url) throw new Error(res.error || 'Failed to upload cover');
    await updateGroupTrip(trip.id, { hero_image_url: res.url });
    patchTripCache({ hero_image_url: res.url });
  };

  const handleSaveAboutHost = async (text: string) => {
    if (!trip) return;
    const next = text || null;
    await updateGroupTrip(trip.id, { host_lead_note: next });
    patchTripCache({ host_lead_note: next });
  };

  const handleSaveDescription = async (text: string) => {
    if (!trip) return;
    await updateGroupTrip(trip.id, { description: text });
    patchTripCache({ description: text });
  };

  const handleSaveDates = async (patch: DatesPatch) => {
    if (!trip) return;
    await updateGroupTrip(trip.id, patch);
    patchTripCache(patch);
  };

  const handleSaveAccommodation = async (next: AccommodationInitial) => {
    if (!trip || !currentUserId) return;
    let imageUrl = next.photoUri;
    if (next.photoUri && !/^https?:\/\//.test(next.photoUri)) {
      const res = await uploadTripImage(next.photoUri, currentUserId, 'accommodation');
      if (!res.success || !res.url) throw new Error(res.error || 'Failed to upload stay photo');
      imageUrl = res.url;
    }
    const patch = {
      accommodation_type: next.kind ? [next.kind] : null,
      accommodation_name: next.name || null,
      accommodation_url: next.url || null,
      accommodation_image_url: imageUrl,
      specific_stay_selected: true,
    };
    await updateGroupTrip(trip.id, patch);
    patchTripCache(patch);
  };

  const handleShare = async () => {
    if (!trip) return;
    try {
      const url = getGroupTripInviteUrl(trip.id);
      const name = trip.title?.trim() || 'my surf trip';
      // Keep the URL in `message` so it survives apps that ignore the `url`
      // field (WhatsApp, etc.); `url` gives iOS a rich link target. Without
      // this the share pasted as plain text with no link.
      await Share.share({
        message: `Yo! checkout my trip "${name}" on Swellyo! 🌊\n${url}`,
        url,
      });
      logEvent('trip_invite_shared', { tripId: trip.id });
    } catch {
      // user cancelled or platform unavailable — silently no-op
    }
  };


  const handleOpenCommitSheet = () => {
    if (!currentUserId) return;
    onOpenCommitment?.({
      tripTitle: trip?.title ?? null,
      initialItems: myCommitmentItems,
      initialNote: myCommitmentNote,
    });
  };

  const patchParticipantsCache = (updater: (p: EnrichedParticipant) => EnrichedParticipant) => {
    queryClient.setQueryData<import('../../hooks/trips/useTripDetail').TripCoreData>(
      tripsKeys.detail(tripId),
      prev =>
        prev ? { ...prev, participants: prev.participants.map(p => p.user_id === currentUserId ? updater(p) : p) } : prev
    );
  };

  const handleToggleGroupGearItem = async (itemName: string) => {
    if (!currentUserId) return;
    const current = myGroupGear;
    const next: GroupGearItem[] = current.map(it =>
      it.name === itemName ? { ...it, done: !it.done } : it
    );
    patchParticipantsCache(p => ({ ...p, personal_gear_by_host: next }));
    try {
      await setMyGroupGear(tripId, currentUserId, next);
    } catch (e: any) {
      patchParticipantsCache(p => ({ ...p, personal_gear_by_host: current }));
      Alert.alert('Could not update', e?.message || 'Please try again.');
    }
  };

  // -------------------------------------------------------------------------
  // Personal gear (member-private) handlers
  // -------------------------------------------------------------------------
  const persistPersonalGear = async (next: PersonalGearItem[], previous: PersonalGearItem[]) => {
    if (!currentUserId) return;
    patchParticipantsCache(p => ({ ...p, personal_gear_by_me: next }));
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
    } catch (e: any) {
      patchParticipantsCache(p => ({ ...p, personal_gear_by_me: previous }));
      Alert.alert('Could not update', e?.message || 'Please try again.');
    }
  };

  const handleTogglePersonalItem = (itemName: string) => {
    const current = myPersonalGear;
    const next = current.map(it => (it.name === itemName ? { ...it, done: !it.done } : it));
    persistPersonalGear(next, current);
  };

  const handleRemovePersonalItem = (itemName: string) => {
    const current = myPersonalGear;
    const next = current.filter(it => it.name !== itemName);
    persistPersonalGear(next, current);
  };

  const handleStartAddPersonalItem = () => {
    setPersonalItemDraft('');
    setAddingPersonalItem(true);
  };

  const handleCancelAddPersonalItem = () => {
    setAddingPersonalItem(false);
    setPersonalItemDraft('');
  };

  const handleSavePersonalItem = async () => {
    if (!currentUserId) return;
    const name = personalItemDraft.trim();
    if (!name) {
      handleCancelAddPersonalItem();
      return;
    }
    // Reject duplicates against host list or my own list.
    const hostNames = (trip?.personal_gear_host_suggestion ?? []).map(n => n.toLowerCase());
    const myNames = myPersonalGear.map(i => i.name.toLowerCase());
    if (hostNames.includes(name.toLowerCase()) || myNames.includes(name.toLowerCase())) {
      Alert.alert('Already on your list', `"${name}" is already in your gear.`);
      return;
    }
    setSavingPersonalItem(true);
    const current = myPersonalGear;
    const next: PersonalGearItem[] = [...current, { name, done: false }];
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
      patchParticipantsCache(p => ({ ...p, personal_gear_by_me: next }));
      handleCancelAddPersonalItem();
    } catch (e: any) {
      Alert.alert('Could not add', e?.message || 'Please try again.');
    } finally {
      setSavingPersonalItem(false);
    }
  };

  const handleStartEditPacking = () => {
    if (!trip) return;
    setGroupGearDraft((trip.personal_gear_host_suggestion ?? []).join('\n'));
    setEditingPacking(true);
  };

  const handleCancelEditPacking = () => {
    setEditingPacking(false);
    setGroupGearDraft('');
  };

  const handleSavePacking = async () => {
    if (!trip) return;
    const names = groupGearDraft
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    setSavingPacking(true);
    try {
      await setTripGroupGear(tripId, names);
      // Trigger refetches for both trip (personal_gear_host_suggestion) and participants.
      queryClient.invalidateQueries({ queryKey: tripsKeys.detail(tripId) });
      setEditingPacking(false);
      setGroupGearDraft('');
    } catch (e: any) {
      Alert.alert('Could not save list', e?.message || 'Please try again.');
    } finally {
      setSavingPacking(false);
    }
  };

  // -------------------------------------------------------------------------
  // Group Gear handlers
  // -------------------------------------------------------------------------
  const handleSetGearClaim = async (itemId: string, quantity: number) => {
    if (!currentUserId) return;
    try {
      await setMyGearClaim(itemId, currentUserId, quantity);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
    } catch (e: any) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    }
  };

  const handleSubmitGearRequest = async (itemName: string, note: string) => {
    if (!currentUserId) return;
    try {
      await createGearRequest(tripId, currentUserId, itemName, note || undefined);
      Alert.alert('Request sent', 'The host will review your request.');
    } catch (e: any) {
      Alert.alert('Could not send request', e?.message || 'Please try again.');
      throw e;
    }
  };

  const handleSaveGearItem = async (
    patch: { name: string; needed_qty: number },
    itemId?: string
  ) => {
    if (!currentUserId) return;
    if (itemId) {
      await updateGearItem(itemId, patch);
    } else {
      await addGearItem(tripId, currentUserId, patch.name, patch.needed_qty);
    }
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
  };

  const handleDeleteGearItem = async (itemId: string) => {
    await deleteGearItem(itemId);
    queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
  };

  const handleApproveGearRequest = async (request: EnrichedGearRequest, neededQty: number, itemName: string) => {
    setProcessingGearRequestId(request.id);
    try {
      await approveGearRequest(request.id, neededQty, itemName);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGear(tripId) });
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGearRequests(tripId) });
    } catch (e: any) {
      Alert.alert('Could not approve', e?.message || 'Please try again.');
    } finally {
      setProcessingGearRequestId(null);
    }
  };

  const handleDeclineGearRequest = async (request: EnrichedGearRequest) => {
    setProcessingGearRequestId(request.id);
    try {
      await declineGearRequest(request.id);
      queryClient.invalidateQueries({ queryKey: tripsKeys.detailGearRequests(tripId) });
    } catch (e: any) {
      Alert.alert('Could not decline', e?.message || 'Please try again.');
    } finally {
      setProcessingGearRequestId(null);
    }
  };

  // -------------------------------------------------------------------------
  // Admin updates handlers
  // -------------------------------------------------------------------------
  const handleStartAddUpdate = () => {
    setEditingUpdateId(null);
    setUpdateTitleDraft('');
    setUpdateDraft('');
    setAddingUpdate(true);
  };

  const handleCancelUpdateDraft = () => {
    setAddingUpdate(false);
    setEditingUpdateId(null);
    setUpdateTitleDraft('');
    setUpdateDraft('');
  };

  const patchUpdatesCache = (updater: (prev: AdminUpdate[]) => AdminUpdate[]) => {
    queryClient.setQueryData<AdminUpdate[]>(tripsKeys.detailUpdates(tripId), prev =>
      updater(prev ?? [])
    );
  };

  const handleEditUpdate = (update: AdminUpdate) => {
    setAddingUpdate(false);
    setEditingUpdateId(update.id);
    setUpdateTitleDraft(update.title);
    setUpdateDraft(update.body);
  };

  const handleDeleteUpdate = (update: AdminUpdate) => {
    Alert.alert('Delete update', 'This update will be removed for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAdminUpdate(update.id);
            patchUpdatesCache(prev => prev.filter(u => u.id !== update.id));
            if (editingUpdateId === update.id) handleCancelUpdateDraft();
          } catch (e: any) {
            Alert.alert('Could not delete', e?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  const handleLongPressUpdate = (update: AdminUpdate) => {
    if (!isHost) return;
    Alert.alert('Update', undefined, [
      { text: 'Edit', onPress: () => handleEditUpdate(update) },
      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteUpdate(update) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // -------------------------------------------------------------------------
  // Sheet-driven handlers (Plan tab redesign — bottom sheets replace the old
  // inline editors).
  // -------------------------------------------------------------------------
  const handleSubmitUpdateBody = async (title: string, body: string) => {
    if (!currentUserId) return;
    const titleText = title.trim();
    if (!titleText) {
      handleCancelUpdateDraft();
      return;
    }
    const bodyText = body.trim();
    setSavingUpdate(true);
    try {
      if (editingUpdateId) {
        const updated = await updateAdminUpdate(editingUpdateId, titleText, bodyText);
        patchUpdatesCache(prev => prev.map(u => (u.id === updated.id ? updated : u)));
      } else {
        const created = await addAdminUpdate(tripId, currentUserId, titleText, bodyText);
        patchUpdatesCache(prev => [created, ...prev]);
      }
      handleCancelUpdateDraft();
    } catch (e: any) {
      Alert.alert('Could not save update', e?.message || 'Please try again.');
    } finally {
      setSavingUpdate(false);
    }
  };

  // Host edits the suggested gear list — called with the full new array after
  // each add/edit/delete. Persists then refetches so member copies stay in sync.

  const handleAddPersonalSubmit = async (name: string) => {
    if (!currentUserId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingPersonalItem(true);
    const current = myPersonalGear;
    const next: PersonalGearItem[] = [...current, { name: trimmed, done: false }];
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
      patchParticipantsCache(p => ({ ...p, personal_gear_by_me: next }));
      setAddPersonalSheetOpen(false);
    } catch (e: any) {
      Alert.alert('Could not add', e?.message || 'Please try again.');
    } finally {
      setSavingPersonalItem(false);
    }
  };

  // -------------------------------------------------------------------------
  if (coreQuery.isLoading && !coreQuery.data) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <TripDetailSkeleton />
      </SafeAreaView>
    );
  }

  // Once the core query has actually resolved (not loading, not placeholder-seeded)
  // and trip is still null, the trip was deleted/not found — show a minimal fallback.
  if (!trip && !coreQuery.isLoading && !coreQuery.isPlaceholderData) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>This trip is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Still in-flight but trip is null (no placeholder seed available) — show skeleton.
  if (!trip) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <TripDetailSkeleton />
      </SafeAreaView>
    );
  }

  const isCancelled = trip.status === 'cancelled';
  const isCompleted = trip.status === 'completed';
  // A trip that has ended by date is treated like a completed one: the plan is
  // locked, only the overview + group chat stay active. Explicit completion or
  // cancellation lock it the same way.
  const isLocked = isCancelled || isCompleted || isTripPast(trip);

  // Whether a floating sticky CTA (join request / trip chat) is showing — drives
  // the extra scroll bottom padding so content clears the floating button.
  // Both CTAs wait for membershipKnown: with placeholder data every viewer
  // looks like a non-member, and members would see "Request to Join" flash.
  // A short blank beats a wrong button.
  const showJoinCta =
    membershipKnown &&
    !isHost && !isCancelled && !isApprovedMember && myRequest?.status !== 'approved';
  // Trip full = a cap is set and it's reached. participant_count is the
  // trigger-maintained denormalized count (incl. host) shown as "X/Y going" —
  // reliable even for non-members whose `participants` array is RLS-trimmed.
  const isFull =
    trip?.max_participants != null &&
    (trip?.participant_count ?? 0) >= trip.max_participants;
  // isHost derives from trip.host_id, which the placeholder DOES carry — hosts
  // get their chat CTA immediately; members wait one fetch.
  const showChatCta = (isHost || (membershipKnown && isApprovedMember)) && !isCancelled;
  const stickyCtaVisible = showJoinCta || showChatCta;

  // Has the trip started yet? Gates "Mark as completed" — a host can close a
  // trip that's underway, not an upcoming one.
  const tripHasStarted = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (trip.start_date) {
      const s = new Date(trip.start_date);
      s.setHours(0, 0, 0, 0);
      return s <= today;
    }
    if (trip.date_months && trip.date_months.length > 0) {
      const earliest = [...trip.date_months].sort()[0];
      const [y, m] = earliest.split('-').map(Number);
      return new Date() >= new Date(y, m - 1, 1);
    }
    return true; // no dates set — let the host decide
  })();

  // Tabs: only members (host + approved) get the Plan tab, and only while the
  // trip is live. Once locked (completed / ended / cancelled) the toggle is gone
  // and everyone sees just the Overview.
  const canSeePlan = (isHost || isApprovedMember) && !isLocked;
  const showPlan = canSeePlan && activeTab === 'plan';

  // Alias for the bottom-spacer below; kept identical to stickyCtaVisible.
  const hasStickyFooter = stickyCtaVisible;

  // Header kebab menu. `group` drives the dividers (chat / report+share /
  // host actions) so they collapse cleanly when a section isn't shown.
  type TripMenuEntry = {
    key: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    group: number;
    onPress: () => void;
    /** Destructive actions render in red (Figma: Exit / Cancel trip). */
    destructive?: boolean;
  };
  const menuItems: TripMenuEntry[] = (
    [
      // Chat — members + host, while the trip isn't cancelled (chat lives on
      // even once a trip is completed).
      ((isHost || isApprovedMember) && !isCancelled) && {
        key: 'chat',
        icon: 'chatbubble-outline',
        label: 'Trip Chat',
        group: 0,
        onPress: handleOpenGroupChat,
      },
      // Report + Share — everyone, members and non-members alike.
      { key: 'report', icon: 'warning-outline', label: 'Report Trip', group: 1, onPress: () => setReportSheetVisible(true) },
      { key: 'share', icon: 'paper-plane-outline', label: 'Share Trip', group: 1, onPress: handleShare },
      // Complete — host only, once the trip is underway and still live.
      (isHost && tripHasStarted && !isLocked) && {
        key: 'complete',
        icon: 'checkmark-circle-outline',
        label: 'Complete trip',
        group: 2,
        onPress: handleCompleteTrip,
      },
      // Cancel — host only, while the trip is still live.
      (isHost && !isLocked) && {
        key: 'cancel',
        icon: 'ban-outline',
        label: 'Cancel trip',
        group: 2,
        onPress: handleCancelTrip,
        destructive: true,
      },
      // Exit — approved member (not the host); replaces the old bottom-of-Plan
      // destructive card.
      (isApprovedMember && !isHost) && {
        key: 'exit',
        icon: 'exit-outline',
        label: 'Exit trip',
        group: 2,
        onPress: handleLeaveTrip,
        destructive: true,
      },
    ] as (TripMenuEntry | false)[]
  ).filter(Boolean) as TripMenuEntry[];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header
        onBack={onBack}
        title={trip.title || 'Trip'}
        rightAction={
          <View style={styles.headerActions}>
            {/* Notifications — self-contained bell + unread badge; opens the
                panel ROUTE (same component the other headers use). */}
            {currentUserId ? (
              <NotificationCenter userId={currentUserId} bare />
            ) : null}
            {/* Overflow (⋮) — Chat / Report / Share for everyone, plus
                Complete / Cancel for the host. */}
            <TouchableOpacity
              onPress={() => setMenuVisible(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Trip options"
            >
              {cancelling || completing || openingChat ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="ellipsis-vertical" size={22} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        }
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          stickyCtaVisible && { paddingBottom: Math.max(insets.bottom, 16) + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        {isCancelled && (
          <View style={styles.cancelledBanner}>
            <Ionicons name="alert-circle-outline" size={18} color="#C0392B" />
            <Text style={styles.cancelledText}>This trip has been cancelled by the host.</Text>
          </View>
        )}

        {!isCancelled && isLocked && (
          <View style={styles.endedBanner}>
            <Ionicons name="checkmark-done-outline" size={18} color="#445" />
            <Text style={styles.endedText}>
              {isCompleted
                ? 'This trip has been completed. The chat stays open below.'
                : 'This trip has ended. The chat stays open below.'}
            </Text>
          </View>
        )}

        {/* Rich trip-detail layout (shared with the create-trip preview). The
            Overview/Plan toggle is injected as shared chrome under the hero;
            bodyHidden hides the read-only overview body when Plan is active. */}
        <TripDetailViewRedesigned
          vm={buildTripDetailVM(
            trip,
            participants.length,
            participants.find(p => p.role === 'host') ?? null,
          )}
          participants={participants.map(p => ({
            id: p.user_id,
            avatarUrl: p.profile_image_url ?? null,
            name: p.name ?? null,
          }))}
          onParticipantPress={
            onViewUserProfile
              ? userId => {
                  if (userId !== currentUserId) onViewUserProfile(userId);
                }
              : undefined
          }
          onSeeAllParticipants={onViewAllMembers}
          onLeaderPress={
            onViewUserProfile && trip.host_id && trip.host_id !== currentUserId
              ? () => onViewUserProfile(trip.host_id)
              : undefined
          }
          afterHeroSlot={
            canSeePlan ? (
              <View
                onLayout={e => {
                  // Y is relative to the white header zone, which starts at the
                  // top of the scroll content (no banners while the toggle shows),
                  // so this equals the scroll offset where it reaches the header.
                  const y = e.nativeEvent.layout.y;
                  toggleYRef.current = y;
                  setToggleY(y);
                }}
              >
                <TripTabToggle value={activeTab} onChange={setActiveTab} />
              </View>
            ) : null
          }
          bodyHidden={showPlan}
          // Members who have the Plan tab now see the participants there (Figma
          // 13455-38686), so drop the Overview Participants row for them. Locked
          // trips (no Plan tab) and non-members keep it as the only member view.
          hideParticipants={canSeePlan}
          // Host edit affordances (Figma admin view) — only while the trip is
          // still live (locked trips are read-only, mirroring the header pencil).
          isHost={isHost && !isLocked}
          aboutHost={(() => {
            const hostP = participants.find(p => p.role === 'host') ?? null;
            return {
              name: hostP?.name ?? null,
              avatarUrl: hostP?.profile_image_url ?? null,
              bio: trip.host_lead_note ?? null,
              // Profile detail badges — surfaced in the "About <host>" block for
              // Trip Operator trips (mirror the create-trip "About you" stats).
              age: hostP?.age ?? null,
              countryFrom: hostP?.country_from ?? null,
              surfLevelLabel: hostP?.surf_level_category
                ? titleCase(String(hostP.surf_level_category))
                : null,
              boardLabel: hostP?.surfboard_type
                ? BOARD_SHORT[hostP.surfboard_type as keyof typeof BOARD_SHORT] ??
                  titleCase(String(hostP.surfboard_type))
                : null,
              surfTrips:
                typeof hostP?.travel_experience === 'number' ? hostP.travel_experience : null,
              // Local-knowledge lines (Captain + Operator): how well the host
              // knows the destination + the stay.
              destinationFamiliarityLabel: trip.host_destination_familiarity
                ? DESTINATION_FAMILIARITY_OPTIONS.find(
                    o => o.slug === trip.host_destination_familiarity,
                  )?.label ?? null
                : null,
              stayFamiliarityLabel: trip.host_stay_familiarity
                ? STAY_FAMILIARITY_OPTIONS.find(o => o.slug === trip.host_stay_familiarity)
                    ?.label ?? null
                : null,
            };
          })()}
          onAboutHostPress={
            onViewUserProfile && trip.host_id && trip.host_id !== currentUserId
              ? () => onViewUserProfile(trip.host_id)
              : undefined
          }
          onShare={handleShare}
          onEditCover={() => setEditSheet('cover')}
          onEditAboutHost={() => setEditSheet('about')}
          onEditDescription={() => setEditSheet('description')}
          onEditDates={() => setEditSheet('dates')}
          onEditAccommodation={() => setEditSheet('accommodation')}
        />

        {/* ============================== PLAN ============================== */}
        {/* Interactive / operational content — members only. */}
        {showPlan && (
        <>
        {/* Redesigned Plan (Figma 12557-5860 / 12716-6927): commit pill →
            admin updates → Packing & Gear. Operational/host sections (join
            requests, breakdown, destructive actions) stay below — they're not
            in the Figma frames and live only here, not in Overview. */}

        {/* 1) Members — moved here from the Overview body (members-only;
            non-members still see the simpler Participants row in Overview). */}
        <View onLayout={registerSection('members')}>
          <TripMemberSection
            members={memberList}
            participantCount={participants.length}
            maxParticipants={trip.max_participants}
            committedCount={committedCount}
            onViewAll={onViewAllMembers}
            pendingCount={isHost ? pendingRequests.length : 0}
            onMemberPress={
              onViewUserProfile
                ? userId => {
                    if (userId !== currentUserId) onViewUserProfile(userId);
                  }
                : undefined
            }
          />
        </View>

        {/* 1.5) Commit pill — below the members + commitment bar (approved
            members only; the host can't commit). */}
        {isApprovedMember && (
          <View onLayout={registerSection('commit')}>
            <CommitPill status={myCommitmentStatus} onPress={handleOpenCommitSheet} />
          </View>
        )}

        {/* 2) Recent admin updates — always shown (members see a read-only
            "No updates yet" placeholder; only the host gets "+ Add update").
            The Members section above provides the spacing under the toggle. */}
        {(
          <View onLayout={registerSection('updates')} style={{ marginTop: 16 }}>
            <AdminUpdatesCard
              updates={adminUpdates}
              isHost={isHost}
              formatTime={formatRelativeTime}
              onAddUpdate={handleStartAddUpdate}
              onViewAll={onViewAllUpdates}
            />
          </View>
        )}

        {/* 3) Packing & Gear — Group Gear + Your Gear */}
        <View style={styles.planSection} onLayout={registerSection('gear')}>
          <GroupGearCard
            items={gearItems}
            isHost={isHost}
            isApprovedMember={isApprovedMember}
            currentUserId={currentUserId}
            onPressItem={item => setGearItemSheetItem(item)}
            onManage={onManageGroupGear ?? (() => setManageSheetVisible(true))}
            onAddItem={() => setAddGroupGearSheetOpen(true)}
            onRequestItem={() => setRequestSheetVisible(true)}
            onViewAll={onViewAllGroupGear}
          />
          <View onLayout={registerSection('your-gear')}>
            <YourGearCard
              rows={gearAllRows}
              totalCount={gearTotalCount}
              mode={isHost ? 'personal' : 'member'}
              onOpen={onViewAllYourGear ?? (() => setPersonalGearSheetOpen(true))}
              onToggleItem={row =>
                row.kind === 'host'
                  ? handleToggleGroupGearItem(row.name)
                  : handleTogglePersonalItem(row.name)
              }
              onAddItem={
                (isHost || isApprovedMember) && !isCancelled
                  ? () => setAddPersonalSheetOpen(true)
                  : undefined
              }
            />
          </View>
          {/* Host only — a separate section for the gear the host suggests that
              members pack for themselves (kept apart from the host's own gear). */}
          {isHost && (
            <View onLayout={registerSection('members-gear')}>
              <YourGearCard
                rows={gearAllRows}
                totalCount={gearTotalCount}
                mode="suggestions"
                onOpen={onManageSuggestedGear ?? (() => {})}
                onToggleItem={() => {}}
                onAddItem={!isCancelled ? (onManageSuggestedGear ?? undefined) : undefined}
              />
            </View>
          )}
        </View>

        {/* ---- Operational sections (kept at the bottom of Plan; not in Figma) ---- */}

        {/* Gear suggestions (host) — review members' "suggest item" submissions.
            Only shown when there are pending suggestions to act on. */}
        {isHost && gearRequests.length > 0 && (
          <View style={styles.planSection} onLayout={registerSection('gear-requests')}>
            <TouchableOpacity
              style={styles.gearReqsBadge}
              onPress={() => setRequestsSheetVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="notifications-outline" size={16} color="#222B30" />
              <Text style={styles.gearReqsBadgeText}>
                {`${gearRequests.length} pending gear ${gearRequests.length === 1 ? 'suggestion' : 'suggestions'}`}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#222B30" />
            </TouchableOpacity>
          </View>
        )}

        {/* Pending requests + member management now live in the full Members
            view ("View all" / "Requests pending" on the Members section). */}

        {/* Declined requests (host only) — lets the host reverse a decision. */}
        {isHost && declinedRequests.length > 0 && (
          <Section title={`Declined requests (${declinedRequests.length})`}>
            {declinedRequests.map(r => (
              <PendingRequestCard
                key={r.id}
                request={r}
                onApprove={handleApprove}
                onDecline={handleDecline}
                isProcessing={processingRequestId === r.id}
                hideDecline
                approveLabel="Approve anyway"
              />
            ))}
          </Section>
        )}

        {/* "Exit trip" now lives in the header overflow (⋮) menu, alongside the
            host's Cancel / Complete. */}
        </>
        )}

        {/* Share + Report now live in the header overflow (⋮) menu; Share also
            keeps its floating button on the hero cover (TripDetailViewRedesigned
            `onShare`). */}

        {/* Clearance for the floating sticky footer (Trip Chat / Join a Trip)
            so the last content isn't hidden behind it; smaller otherwise. */}
        <View style={{ height: hasStickyFooter ? insets.bottom + 96 : 40 }} />
      </Animated.ScrollView>

      {/* Sticky Overview/Plan toggle — a clone that clips under the black header
          once the real toggle scrolls past its resting Y, so members can switch
          tabs without scrolling back to the top. Crisp opacity swap at the
          threshold (native-driven) so it hands off seamlessly from the real one. */}
      {canSeePlan && (
        <Animated.View
          pointerEvents={toggleStuck ? 'auto' : 'none'}
          style={[
            styles.stickyToggle,
            {
              opacity: scrollY.interpolate({
                inputRange: [Math.max(toggleY - 1, 0), Math.max(toggleY, 1)],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
        >
          <TripTabToggle value={activeTab} onChange={setActiveTab} />
        </Animated.View>
      )}
      </KeyboardAvoidingView>

      {/* Sticky CTA — floating pill over a foggy fade (mirrors the profile
          "Connect to …" button). The overlay fades scroll content into the
          background behind the button; the button itself keeps its own
          colour + label. */}
      {stickyCtaVisible && (
        <View style={styles.ctaOverlay} pointerEvents="none">
          {/* Plain white fade (mirrors the profile "Connect to …" overlay) —
              content dissolves into the background behind the button. A blurred
              variant was tried but read blotchy over the colourful hero/avatars,
              so we keep the clean gradient. */}
          <LinearGradient
            colors={['rgba(250, 250, 250, 0)', 'rgba(250, 250, 250, 0.4)', 'rgba(250, 250, 250, 0.75)', '#FAFAFA']}
            locations={[0, 0.4, 0.72, 1]}
            style={styles.ctaOverlayGradient}
          />
        </View>
      )}

      {/* Join flow (non-host, non-member, active trip). Fades in because it
          mounts only after membership resolves — a pop would read as a glitch. */}
      {showJoinCta && (
        <Reanimated.View
          entering={FadeInUp.duration(220)}
          style={[styles.ctaFloat, { bottom: Math.max(insets.bottom, 16) + 12 }]}
        >
          <CtaButton
            myRequest={myRequest}
            isFull={isFull}
            submitting={submitting}
            onRequest={handleRequestToJoin}
            onWithdraw={handleWithdraw}
          />
        </Reanimated.View>
      )}

      {/* Members get quick access to the group chat (Figma "Trip Chat", accent). */}
      {showChatCta && (
        <Reanimated.View
          entering={FadeInUp.duration(220)}
          style={[styles.ctaFloat, { bottom: Math.max(insets.bottom, 16) + 12 }]}
        >
          <TouchableOpacity
            style={[styles.ctaBtn, styles.ctaChat]}
            onPress={handleOpenGroupChat}
            disabled={openingChat}
            activeOpacity={0.85}
          >
            {openingChat ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="chatbubble-outline" size={18} color="#FFFFFF" />
                <Text style={styles.ctaPrimaryText}>Trip Chat</Text>
              </>
            )}
          </TouchableOpacity>
        </Reanimated.View>
      )}

      {/* Gear bottom sheets */}
      <GearItemSheet
        visible={!!gearItemSheetItem}
        item={gearItemSheetItem}
        currentUserId={currentUserId}
        onClose={() => setGearItemSheetItem(null)}
        onSetClaim={handleSetGearClaim}
      />
      <RequestGearSheet
        visible={requestSheetVisible}
        onClose={() => setRequestSheetVisible(false)}
        onSubmit={handleSubmitGearRequest}
      />
      <ManageGearSheet
        visible={manageSheetVisible}
        items={gearItems}
        onClose={() => setManageSheetVisible(false)}
        onSave={handleSaveGearItem}
        onDelete={handleDeleteGearItem}
      />
      {/* Host "+ Add item" on the Group Gear preview — straight into the add
          form (Figma 12919-32232), no detour through "Edit Group Gear". */}
      <ManageGearSheet
        visible={addGroupGearSheetOpen}
        items={gearItems}
        formOnly
        editItem={null}
        onClose={() => setAddGroupGearSheetOpen(false)}
        onSave={handleSaveGearItem}
        onDelete={handleDeleteGearItem}
      />
      <GearRequestsSheet
        visible={requestsSheetVisible}
        requests={gearRequests}
        processingId={processingGearRequestId}
        onClose={() => setRequestsSheetVisible(false)}
        onApprove={handleApproveGearRequest}
        onDecline={handleDeclineGearRequest}
      />
      {/* Admin update — host writes/edits an announcement. Driven by the same
          addingUpdate / editingUpdateId state the list uses. */}
      <AdminUpdateSheet
        visible={addingUpdate || !!editingUpdateId}
        mode={editingUpdateId ? 'edit' : 'add'}
        initialTitle={editingUpdateId ? (updateTitleDraft ?? '') : ''}
        initialBody={editingUpdateId ? (updateDraft ?? '') : ''}
        saving={savingUpdate}
        onClose={handleCancelUpdateDraft}
        onSubmit={handleSubmitUpdateBody}
        onDelete={
          editingUpdateId
            ? () => {
                const u = adminUpdates.find(x => x.id === editingUpdateId);
                if (u) handleDeleteUpdate(u);
              }
            : undefined
        }
      />

      {/* Your gear — full personal list (check / remove), opens Add from here. */}
      <PersonalGearSheet
        visible={personalGearSheetOpen}
        onClose={() => setPersonalGearSheetOpen(false)}
        hostItems={trip.personal_gear_host_suggestion ?? []}
        myHostState={myGroupGear}
        myItems={myPersonalGear}
        canEdit={(isHost || isApprovedMember) && !isCancelled}
        onToggleHostItem={handleToggleGroupGearItem}
        onTogglePersonalItem={handleTogglePersonalItem}
        onRemovePersonalItem={handleRemovePersonalItem}
        onAddPersonal={() => {
          setPersonalGearSheetOpen(false);
          setAddPersonalSheetOpen(true);
        }}
      />

      {/* Add one item to my own personal list. */}
      <AddPersonalGearSheet
        visible={addPersonalSheetOpen}
        onClose={() => setAddPersonalSheetOpen(false)}
        existingNames={[
          ...(trip.personal_gear_host_suggestion ?? []),
          ...myPersonalGear.map(i => i.name),
        ]}
        saving={savingPersonalItem}
        onSubmit={handleAddPersonalSubmit}
      />

      {/* Host-only inline edit sheets (Figma admin view). */}
      <EditCoverSheet
        visible={editSheet === 'cover'}
        currentUri={trip.hero_image_url ?? null}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveCover}
      />
      <EditTextSheet
        visible={editSheet === 'about'}
        title="About you"
        subtitle={
          trip.hosting_style === 'C'
            ? 'Why surfers can trust your operation.'
            : 'Why you’re the right Captain for this.'
        }
        label={
          trip.hosting_style === 'C'
            ? 'Why surfers can trust your operation'
            : 'Why you’re the right Captain'
        }
        initialValue={trip.host_lead_note ?? ''}
        placeholder="Mention anything that brings credibility to your experience here"
        maxLength={250}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveAboutHost}
      />
      <EditTextSheet
        visible={editSheet === 'description'}
        title="About this trip"
        subtitle="What surfers should know about this trip."
        label="Trip description"
        initialValue={trip.description ?? ''}
        placeholder="Describe the surf, the vibe, the plan…"
        maxLength={1000}
        rows={8}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveDescription}
      />
      <EditDatesSheet
        visible={editSheet === 'dates'}
        initial={(() => {
          const months = [...(trip.date_months ?? [])].sort();
          return {
            datesMode: trip.start_date ? ('exact' as const) : ('months' as const),
            startDateISO: trip.start_date ?? null,
            endDateISO: trip.end_date ?? null,
            monthFrom: months[0] ?? '',
            monthTo: months[months.length - 1] ?? '',
            durationDays: trip.duration_days ?? null,
          };
        })()}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveDates}
      />
      <EditAccommodationSheet
        visible={editSheet === 'accommodation'}
        specificOnly
        initial={{
          kind: (trip.accommodation_type?.[0] ?? null) as AccommodationInitial['kind'],
          name: trip.accommodation_name ?? '',
          url: trip.accommodation_url ?? '',
          photoUri: trip.accommodation_image_url ?? null,
        }}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveAccommodation}
      />

      {/* Report this whole trip */}
      <ReportTripSheet
        visible={reportSheetVisible}
        tripId={tripId}
        tripTitle={trip.title ?? ''}
        hostId={trip.host_id}
        hostName={participants.find(p => p.role === 'host')?.name ?? ''}
        onClose={() => setReportSheetVisible(false)}
      />

      {/* Header overflow (⋮) menu. Rendered at the SafeAreaView root (not inside
          the header) so it isn't clipped, and above everything via zIndex. A
          full-screen transparent backdrop dismisses it on any outside tap. */}
      {menuVisible && (
        <>
          <TouchableOpacity
            style={styles.menuBackdrop}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          />
          {/* Open just BELOW the kebab. Absolute `top` is measured from the
              screen's border edge (RN ignores SafeAreaView's inset padding for
              absolute children), so add the inset + header height ourselves. */}
          <Reanimated.View
            entering={FadeInDown.duration(160)}
            style={[styles.menuDropdown, { top: insets.top + 56 }]}
          >
            {menuItems.map((item, i) => {
              const showDivider = i > 0 && item.group !== menuItems[i - 1].group;
              return (
                <React.Fragment key={item.key}>
                  {showDivider && <View style={styles.menuDivider} />}
                  <TouchableOpacity
                    style={styles.menuItem}
                    activeOpacity={0.6}
                    onPress={() => {
                      setMenuVisible(false);
                      item.onPress();
                    }}
                  >
                    <Ionicons name={item.icon} size={22} color={item.destructive ? '#FF5367' : '#222B30'} />
                    <Text style={[styles.menuItemText, item.destructive && styles.menuItemTextDestructive]}>{item.label}</Text>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </Reanimated.View>
        </>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
const Header: React.FC<{ onBack: () => void; title?: string; rightAction?: React.ReactNode }> = ({
  onBack,
  title,
  rightAction,
}) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
    </TouchableOpacity>
    <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Trip'}</Text>
    <View style={styles.headerRight}>{rightAction}</View>
  </View>
);

const CtaButton: React.FC<{
  myRequest: GroupTripJoinRequest | null;
  isFull: boolean;
  submitting: boolean;
  onRequest: () => void;
  onWithdraw: () => void;
}> = ({ myRequest, isFull, submitting, onRequest, onWithdraw }) => {
  // Trip is full and the user hasn't already got a request in flight → show a
  // non-pressable "Trip full" state instead of letting them request a spot that
  // can't be granted. Pending requesters keep their pending/withdraw row.
  if (isFull && myRequest?.status !== 'pending') {
    return (
      <View style={[styles.ctaBtn, styles.ctaPending]}>
        <Ionicons name="people" size={18} color="#555" />
        <Text style={styles.ctaPendingText}>Trip full</Text>
      </View>
    );
  }
  if (myRequest?.status === 'pending') {
    // Already requested → yellow "Requested" button. Tapping it withdraws the
    // pending request (no confirm sheet — same tap that sent it cancels it).
    return (
      <Pressable
        style={({ pressed }) => [styles.ctaBtn, styles.ctaRequested, pressed && styles.ctaPressed]}
        onPress={onWithdraw}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.ctaPrimaryText}>Requested</Text>
        )}
      </Pressable>
    );
  }
  if (myRequest?.status === 'declined') {
    // Previously declined → let them try again. A fresh request replaces the
    // old declined row (see requestToJoinTrip), so the host sees a new pending.
    return (
      <View style={styles.ctaDeclinedRow}>
        <Text style={styles.ctaDeclinedNote}>Your last request was declined.</Text>
        <Pressable
          style={({ pressed }) => [styles.ctaBtn, styles.ctaPrimary, pressed && styles.ctaPressed]}
          onPress={onRequest}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaPrimaryText}>Request again</Text>
          )}
        </Pressable>
      </View>
    );
  }
  // No request yet, or withdrawn → allow new request
  return (
    <Pressable
      style={({ pressed }) => [styles.ctaBtn, styles.ctaPrimary, pressed && styles.ctaPressed]}
      onPress={onRequest}
      disabled={submitting}
    >
      {submitting ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.ctaPrimaryText}>Request to join</Text>
      )}
    </Pressable>
  );
};

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // Dark top chrome (Figma 12557-3316). Root paints the status-bar inset dark;
  // the scroll area below paints itself light (#FAFAFA).
  root: { flex: 1, backgroundColor: '#212121' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#212121',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'left',
    marginLeft: 8,
    fontFamily: ff('Montserrat', '700'),
  },
  headerRight: { minWidth: 28, alignItems: 'flex-end' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  // Header overflow (⋮) menu — anchored under the kebab, top-right.
  menuBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 9998 },
  menuDropdown: {
    position: 'absolute',
    // `top` is set inline (insets.top + header height) so it clears the kebab.
    right: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    minWidth: 224,
    paddingVertical: 8,
    shadowColor: '#596E7C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 999,
    zIndex: 9999,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 28,
    paddingVertical: 14,
    gap: 14,
  },
  menuItemText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    color: '#222B30',
    flex: 1,
  },
  // Destructive menu items — Exit / Cancel trip (Figma red).
  menuItemTextDestructive: { color: '#FF5367' },
  menuDivider: { height: 1, backgroundColor: '#ECECEC', marginVertical: 4 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  errorText: { color: '#7B7B7B' },

  keyboardAvoider: { flex: 1, backgroundColor: '#FAFAFA' },
  scrollContent: { paddingBottom: 24 },

  // Sticky Overview/Plan clone — pinned to the top of the scroll area (right
  // under the black header). paddingHorizontal cancels the toggle's -16 bleed so
  // it spans edge-to-edge; a soft shadow lifts it above the scrolling content.
  stickyToggle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    zIndex: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 4 },
      default: {},
    }),
  },
  // Redesigned Plan tab (Figma) — light wrappers around the PlanSections cards.
  planSection: { paddingHorizontal: 16, paddingTop: 20 },
  planSectionHeading: {
    // Inter Bold 20 (Figma) — was Montserrat, which rendered oversized. 16px gap
    // down to "Group Gear" matches the section's internal spacing.
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: '#222B30',
    marginBottom: 16,
    fontFamily: ff('Inter', '700'),
  },

  // Top card — hero, title, action row (WhatsApp group header)
  topCard: { backgroundColor: '#FFFFFF', paddingBottom: 4 },
  hero: { width: '100%', height: 220, backgroundColor: '#F2F2F2' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },

  titleBlock: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#222B30',
    marginBottom: 6,
    textAlign: 'center',
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 4,
  },
  metaText: { fontSize: 14, color: '#7B7B7B' },
  metaDot: { fontSize: 14, color: '#7B7B7B', marginHorizontal: 2 },
  dates: { fontSize: 13, color: '#7B7B7B', textAlign: 'center', marginTop: 2 },

  // Action row (Chat / Share / Mute) — circular brand-tinted icons
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    marginTop: 8,
  },
  actionBtn: { flex: 1, alignItems: 'center' },
  actionBtnDisabled: { opacity: 0.5 },
  reportTripLink: {
    alignSelf: 'center',
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  reportTripLinkText: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: '#B0B0B0',
  },
  actionIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E6F4F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  actionLabel: { fontSize: 12, color: '#0788B0', fontWeight: '600' },

  // Sectioned cards on light gray bg (WhatsApp pattern)
  section: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222B30',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  body: { fontSize: 14, color: '#333', lineHeight: 20 },
  muted: { fontSize: 13, color: '#7B7B7B' },

  infoRow: { flexDirection: 'row', paddingVertical: 6 },
  infoLabel: { width: 110, fontSize: 13, color: '#7B7B7B' },
  infoValue: { flex: 1, fontSize: 13, color: '#222B30' },

  // Tag chips (trip_structure / trip_vibes) — light pill, matches the existing
  // detail-row density. Wraps across rows when many tags are selected.
  tagsBlock: { marginTop: 12 },
  tagsLabel: {
    fontSize: 12,
    color: '#7B7B7B',
    marginBottom: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: {
    backgroundColor: '#F2F2F2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagChipText: { fontSize: 12, color: '#222B30', fontWeight: '500' },

  memberDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ECECEC',
    marginLeft: 60,
  },

  // Bottom destructive card — Exit / Cancel rows
  destructiveCard: {
    backgroundColor: '#FFFFFF',
    marginTop: 12,
    paddingVertical: 4,
  },
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dangerRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ECECEC',
  },
  dangerRowText: { color: '#C0392B', fontSize: 15, fontWeight: '500' },

  // Sticky CTA (join flow only)
  // Foggy fade behind the floating CTA — fades scroll content into #FAFAFA
  // (mirrors the profile "Connect to …" overlay, incl. the web blur mask).
  ctaOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 215,
    zIndex: 9,
    overflow: 'hidden',
    ...(Platform.OS === 'web' && {
      backdropFilter: 'blur(6px)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 45%)',
      maskImage: 'linear-gradient(to bottom, transparent 0%, black 45%)',
    }),
  },
  ctaOverlayGradient: { flex: 1 },
  // Floating button wrapper — pinned above the home indicator. Inset wider than
  // the old full-width bar so the button reads "narrower", matching the create
  // flow's "Next" CTA.
  ctaFloat: {
    position: 'absolute',
    left: 56,
    right: 56,
    zIndex: 10,
  },
  // Shape copied from the create-flow "Next" button: taller (64), softer-but-
  // not-pill corners (14).
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 64,
    borderRadius: 14,
    paddingHorizontal: 24,
    gap: 6,
  },
  ctaPrimary: { backgroundColor: '#212121' },
  // Subtle press feedback — same scale dip used on the other trip buttons.
  ctaPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  ctaChat: { backgroundColor: '#05BCD3' },
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
    fontFamily: ff('Montserrat', '600'),
  },
  ctaPending: { backgroundColor: '#F2F2F2' },
  ctaPendingText: { color: '#555', fontWeight: '600', fontSize: 14, marginLeft: 6 },
  ctaRequested: { backgroundColor: '#FFB443' },
  ctaDeclined: { backgroundColor: '#F2F2F2' },
  ctaDeclinedText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },
  ctaDeclinedRow: { gap: 8 },
  ctaDeclinedNote: { color: '#7B7B7B', fontSize: 12, textAlign: 'center' },

  cancelledBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FDECEA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cancelledText: { color: '#C0392B', fontSize: 13, fontWeight: '500', flex: 1 },
  endedBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#EEF1F3',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  endedText: { color: '#445', fontSize: 13, fontWeight: '500', flex: 1 },
  manageBtnDisabled: { opacity: 0.6 },

  packingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  // "Edit suggested" host button (header of Your gear)
  editSuggestedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editSuggestedBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0788B0',
  },
  // Your gear — compact summary card (tap → full PersonalGearSheet)
  gearSummaryCard: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  gearSummaryCount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7B7B7B',
  },
  gearSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gearSummaryItem: {
    flex: 1,
    fontSize: 15,
    color: '#222B30',
  },
  gearSummaryItemDone: {
    textDecorationLine: 'line-through',
    color: '#9AA0A6',
  },
  gearSummaryMore: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7B7B7B',
    marginLeft: 28,
  },
  gearSummaryViewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  gearSummaryViewAll: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0788B0',
  },
  packingToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  packingToggleChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFFFFF',
  },
  packingToggleChipActive: {
    borderColor: '#0788B0',
    backgroundColor: '#E6F4F8',
  },
  packingToggleText: { fontSize: 13, fontWeight: '600', color: '#7B7B7B' },
  packingToggleTextActive: { color: '#0788B0' },
  groupEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  groupEditInput: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#222B30',
    backgroundColor: '#FFFFFF',
  },
  singleMultiChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFFFFF',
  },
  singleMultiChipActive: {
    borderColor: '#0788B0',
    backgroundColor: '#E6F4F8',
  },
  singleMultiText: { fontSize: 12, fontWeight: '600', color: '#7B7B7B' },
  singleMultiTextActive: { color: '#0788B0' },
  singleMultiChipSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#FFFFFF',
    marginLeft: 4,
  },
  singleMultiChipSmallActive: {
    borderColor: '#0788B0',
    backgroundColor: '#E6F4F8',
  },
  singleMultiTextSmall: { fontSize: 11, fontWeight: '600', color: '#7B7B7B' },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  addItemText: { color: '#0788B0', fontWeight: '600', fontSize: 13 },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 6,
  },
  avatarSmallWrap: { marginLeft: -6 },
  avatarSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#F2F2F2',
  },
  avatarSmallPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A8DDE0',
  },
  avatarSmallInitial: { color: '#FFFFFF', fontWeight: '700', fontSize: 10 },
  avatarMoreText: { fontSize: 11, color: '#7B7B7B', marginLeft: 4 },
  packingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  packingItemText: { fontSize: 14, color: '#222B30', flex: 1 },
  packingItemTextDone: { color: '#7B7B7B', textDecorationLine: 'line-through' },
  packingTextarea: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 120,
    fontSize: 14,
    color: '#222B30',
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
    marginTop: 6,
  },
  packingActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  packingCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDD',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  packingCancelText: { color: '#555', fontWeight: '600', fontSize: 14 },
  packingSave: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#0788B0',
    alignItems: 'center',
  },
  packingSaveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  commitWrapper: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 12,
  },
  commitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#34C759',
  },
  commitBtnActive: {
    backgroundColor: '#34C759',
    borderColor: '#34C759',
  },
  commitBtnText: { color: '#34C759', fontWeight: '600', fontSize: 14 },
  commitBtnTextActive: { color: '#FFFFFF' },
  commitCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
    backgroundColor: '#222B30',
  },
  commitCtaPending: { backgroundColor: '#7B7B7B' },
  commitCtaApproved: { backgroundColor: '#16A34A' },
  commitCtaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  commitCtaCaption: {
    textAlign: 'center',
    fontSize: 12,
    color: '#7B7B7B',
    marginTop: 8,
  },

  // Personal gear extras (host suggestion tag + add button + inline editor)
  hostSuggestionTag: {
    marginLeft: 'auto',
    fontSize: 11,
    color: '#7B7B7B',
    fontStyle: 'italic',
  },
  personalToggleHit: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  personalAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
  },
  personalAddBtnText: {
    color: '#0788B0',
    fontSize: 14,
    fontWeight: '600',
  },
  personalAddEditor: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FAFAFA',
    padding: 10,
  },
  personalAddInput: {
    fontSize: 14,
    color: '#222B30',
    padding: 0,
    minHeight: 32,
  },
  personalAddActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  personalAddCancel: { paddingHorizontal: 12, paddingVertical: 8 },
  personalAddCancelText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },
  personalAddSave: {
    backgroundColor: '#0788B0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  personalAddSaveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },

  // Group Gear section
  gearHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  gearHeaderTitle: { fontSize: 12, fontWeight: '700', color: '#4A5565', letterSpacing: 0.5 },
  gearHeaderSub: { fontSize: 13, color: '#7B7B7B', marginTop: 2 },
  gearManageBtn: {
    borderWidth: 1,
    borderColor: '#0788B0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  gearManageBtnText: { fontSize: 13, fontWeight: '700', color: '#0788B0' },
  requestLinkBtn: { paddingVertical: 12, alignItems: 'center' },
  requestLinkText: {
    color: '#0788B0',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  gearReqsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEEEEE',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
    gap: 8,
  },
  gearReqsBadgeText: { flex: 1, color: '#222B30', fontWeight: '700', fontSize: 13 },

  // Admin updates
  addUpdateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0788B0',
  },
  addUpdateBtnText: { fontSize: 13, fontWeight: '600', color: '#0788B0' },

  updateEditor: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    backgroundColor: '#FAFAFA',
  },
  updateEditorInput: {
    fontSize: 14,
    color: '#222B30',
    minHeight: 44,
    padding: 0,
    textAlignVertical: 'top',
  },
  updateEditorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  updateEditorCancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  updateEditorCancelText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },
  updateEditorSave: {
    backgroundColor: '#0788B0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  updateEditorSaveDisabled: { opacity: 0.4 },
  updateEditorSaveText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },

  updatesEmpty: { color: '#7B7B7B', fontSize: 14, fontStyle: 'italic' },

  updateRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  updateBullet: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#0788B0',
    marginTop: 4,
    marginRight: 12,
  },
  updateBody: { flex: 1 },
  updateText: { fontSize: 15, color: '#222B30', lineHeight: 20 },
  updateAuthor: { fontWeight: '700' },
  updateTime: { fontSize: 12, color: '#7B7B7B', marginTop: 2 },
});
