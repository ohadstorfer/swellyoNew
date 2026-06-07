import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  submitCommitment,
  type CommitmentItem,
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
import { TripTabToggle, type TripTab } from '../../components/trips/TripTabToggle';
import { HostTag } from '../../components/trips/HostTag';
import { AdminUpdateSheet } from '../../components/trips/updates/AdminUpdateSheet';
import { AddPersonalGearSheet } from '../../components/trips/gear/AddPersonalGearSheet';
import { EditSuggestedGearSheet } from '../../components/trips/gear/EditSuggestedGearSheet';
import { PersonalGearSheet } from '../../components/trips/gear/PersonalGearSheet';
import ParticipantCard from '../../components/trips/ParticipantCard';
import PendingRequestCard from '../../components/trips/PendingRequestCard';
import TripParticipantsBreakdown from '../../components/trips/TripParticipantsBreakdown';
import { GearItemCard } from '../../components/trips/gear/GearItemCard';
import { GearItemSheet } from '../../components/trips/gear/GearItemSheet';
import { RequestGearSheet } from '../../components/trips/gear/RequestGearSheet';
import { ManageGearSheet } from '../../components/trips/gear/ManageGearSheet';
import { GearRequestsSheet } from '../../components/trips/gear/GearRequestsSheet';
import { CommitmentSheet } from '../../components/trips/commitment/CommitmentSheet';
import { RequestToJoinSheet } from '../../components/trips/joinRequest/RequestToJoinSheet';
import { supabase } from '../../config/supabase';
import { messagingService } from '../../services/messaging/messagingService';

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

const ActionButton: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}> = ({ icon, label, onPress, loading, disabled }) => (
  <TouchableOpacity
    style={[styles.actionBtn, disabled && styles.actionBtnDisabled]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={0.7}
    accessibilityLabel={label}
  >
    <View style={styles.actionIconCircle}>
      {loading ? (
        <ActivityIndicator size="small" color="#0788B0" />
      ) : (
        <Ionicons name={icon} size={20} color="#0788B0" />
      )}
    </View>
    <Text style={styles.actionLabel}>{label}</Text>
  </TouchableOpacity>
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
export default function TripDetailScreen({ tripId, onBack, onOpenGroupChat, onEditTrip, onViewUserProfile, onOpenNotifications }: TripDetailScreenProps) {
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;

  const [trip, setTrip] = useState<GroupTrip | null>(null);
  const [participants, setParticipants] = useState<EnrichedParticipant[]>([]);
  const [myRequest, setMyRequest] = useState<GroupTripJoinRequest | null>(null);
  const [pendingRequests, setPendingRequests] = useState<EnrichedJoinRequest[]>([]);
  const [declinedRequests, setDeclinedRequests] = useState<EnrichedJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [commitSheetOpen, setCommitSheetOpen] = useState(false);
  const [joinSheetOpen, setJoinSheetOpen] = useState(false);
  const [myJoinProfile, setMyJoinProfile] = useState<{
    name: string | null;
    avatarUrl: string | null;
    surfLevel: string | null;
  } | null>(null);
  const [editingPacking, setEditingPacking] = useState(false);
  const [groupGearDraft, setGroupGearDraft] = useState('');
  const [savingPacking, setSavingPacking] = useState(false);
  // Member-private gear: each user adds/removes only their own; host items
  // live in trip.personal_gear_host_suggestion and aren't editable from here.
  const [addingPersonalItem, setAddingPersonalItem] = useState(false);
  const [personalItemDraft, setPersonalItemDraft] = useState('');
  const [savingPersonalItem, setSavingPersonalItem] = useState(false);
  const [muted, setMuted] = useState(false);
  // Overview = public read-only facts; Plan = interactive (members only).
  const [activeTab, setActiveTab] = useState<TripTab>('overview');
  // Host-only inline edit sheets (Figma admin view): cover / about-host / description / dates / accommodation.
  const [editSheet, setEditSheet] = useState<
    'cover' | 'about' | 'description' | 'dates' | 'accommodation' | null
  >(null);

  // Shared gear — items with required quantities + request flow
  // (group_trip_gear_items / _gear_claims / _gear_requests). Distinct from
  // the host's checklist (which lives on group_trips.personal_gear_host_suggestion).
  const [gearItems, setGearItems] = useState<EnrichedGearItem[]>([]);
  const [gearRequests, setGearRequests] = useState<EnrichedGearRequest[]>([]); // host only
  const [gearItemSheetItem, setGearItemSheetItem] = useState<EnrichedGearItem | null>(null);
  const [requestSheetVisible, setRequestSheetVisible] = useState(false);
  const [manageSheetVisible, setManageSheetVisible] = useState(false);
  const [requestsSheetVisible, setRequestsSheetVisible] = useState(false);
  // New gear/update sheets (Plan tab redesign)
  const [personalGearSheetOpen, setPersonalGearSheetOpen] = useState(false);
  const [addPersonalSheetOpen, setAddPersonalSheetOpen] = useState(false);
  const [editSuggestedSheetOpen, setEditSuggestedSheetOpen] = useState(false);
  const [processingGearRequestId, setProcessingGearRequestId] = useState<string | null>(null);

  // Admin updates — host-posted free-text lines, visible to all members.
  const [adminUpdates, setAdminUpdates] = useState<AdminUpdate[]>([]);
  const [addingUpdate, setAddingUpdate] = useState(false);
  const [updateDraft, setUpdateDraft] = useState('');
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);

  const isHost = !!trip && !!currentUserId && trip.host_id === currentUserId;
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
  const meParticipant = useMemo(
    () => participants.find(p => p.user_id === currentUserId),
    [participants, currentUserId]
  );
  const myCommitmentStatus: CommitmentStatus = meParticipant?.commitment_status ?? 'none';
  const myCommitmentItems = meParticipant?.commitment_items ?? [];
  const myCommitmentNote = meParticipant?.commitment_note ?? null;
  const myGroupGear = useMemo<GroupGearItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.personal_gear_by_host ?? [],
    [participants, currentUserId]
  );
  const myPersonalGear = useMemo<PersonalGearItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.personal_gear_by_me ?? [],
    [participants, currentUserId]
  );
  const gearTotalCount = (trip?.personal_gear_host_suggestion?.length ?? 0) + myPersonalGear.length;
  const gearDoneCount =
    myGroupGear.filter(it => it.done && (trip?.personal_gear_host_suggestion ?? []).includes(it.name)).length +
    myPersonalGear.filter(it => it.done).length;
  // Combined rows (host-suggested + my own) for the "Your gear" summary preview.
  const gearAllRows = [
    ...(trip?.personal_gear_host_suggestion ?? []).map(name => ({
      kind: 'host' as const,
      name,
      done: myGroupGear.find(it => it.name === name)?.done ?? false,
    })),
    ...myPersonalGear.map(it => ({ kind: 'mine' as const, name: it.name, done: it.done })),
  ];
  const gearPreview = gearAllRows.slice(0, 3);
  const gearHiddenCount = Math.max(0, gearAllRows.length - gearPreview.length);
  const loadAll = useCallback(async () => {
    const [tripData, participantsData, updatesData, gearItemsData] = await Promise.all([
      getTripById(tripId),
      getTripParticipants(tripId),
      listAdminUpdates(tripId),
      listGearItems(tripId, currentUserId),
    ]);
    setTrip(tripData);
    setParticipants(participantsData);
    setAdminUpdates(updatesData);
    setGearItems(gearItemsData);

    if (currentUserId && tripData) {
      const userIsHost = tripData.host_id === currentUserId;
      if (userIsHost) {
        const [pending, declined, gearReqs] = await Promise.all([
          listPendingRequests(tripId),
          listDeclinedRequests(tripId),
          listGearRequests(tripId, 'pending'),
        ]);
        setPendingRequests(pending);
        setDeclinedRequests(declined);
        setGearRequests(gearReqs);
        setMyRequest(null);
      } else {
        const req = await getMyJoinRequest(tripId, currentUserId);
        setMyRequest(req);
        setPendingRequests([]);
        setDeclinedRequests([]);
        setGearRequests([]);
      }
    }
    setLoading(false);
  }, [tripId, currentUserId]);

  const refreshGear = useCallback(async () => {
    const items = await listGearItems(tripId, currentUserId);
    setGearItems(items);
  }, [tripId, currentUserId]);

  const refreshGearRequests = useCallback(async () => {
    if (!isHost) return;
    const reqs = await listGearRequests(tripId, 'pending');
    setGearRequests(reqs);
  }, [tripId, isHost]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Lazy-fetch the user's own profile preview the first time it could be shown
  // in the join sheet. Skipped for host/approved-member; cached after first load.
  useEffect(() => {
    let cancelled = false;
    if (!currentUserId || isHost || isApprovedMember || myJoinProfile) return;
    supabase
      .from('surfers')
      .select('name, profile_image_url, surf_level_category')
      .eq('user_id', currentUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setMyJoinProfile({
          name: (data as any).name ?? null,
          avatarUrl: (data as any).profile_image_url ?? null,
          surfLevel: (data as any).surf_level_category ?? null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, isHost, isApprovedMember, myJoinProfile]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const handleOpenJoinSheet = () => {
    if (!currentUserId) return;
    setJoinSheetOpen(true);
  };

  const handleSubmitJoinRequest = async (note: string) => {
    if (!currentUserId) return;
    setSubmitting(true);
    try {
      const newReq = await requestToJoinTrip(tripId, currentUserId, note || undefined);
      setMyRequest(newReq);
    } catch (e: any) {
      Alert.alert('Could not send request', e?.message || 'Please try again.');
      throw e;
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!myRequest) return;
    setSubmitting(true);
    try {
      await withdrawJoinRequest(myRequest.id);
      setMyRequest({ ...myRequest, status: 'withdrawn' });
    } catch (e: any) {
      Alert.alert('Could not withdraw', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setProcessingRequestId(requestId);
    try {
      await approveJoinRequest(requestId);
      // Optimistic: remove from pending/declined and refetch participants. The
      // same handler reverses a previously-declined request (declined → approved).
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
      setDeclinedRequests(prev => prev.filter(r => r.id !== requestId));
      const updated = await getTripParticipants(tripId);
      setParticipants(updated);
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
      // Move it out of pending and into the declined list so the host can still
      // reverse the decision later.
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
      if (moved) {
        setDeclinedRequests(prev => [
          { ...moved, status: 'declined' as const },
          ...prev.filter(r => r.id !== requestId),
        ]);
      }
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
              setParticipants(prev => prev.filter(p => p.user_id !== userId));
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
              setTrip(prev => (prev ? { ...prev, status: 'cancelled' } : prev));
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
              setTrip(prev => (prev ? { ...prev, status: 'completed' } : prev));
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
              setParticipants(prev => prev.filter(p => p.user_id !== currentUserId));
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

  const handleEdit = () => {
    if (!trip || !onEditTrip) return;
    onEditTrip(trip);
  };

  // ---- Host-only inline edits (Figma admin view). Each persists one field via
  // updateGroupTrip and merges it locally (updateGroupTrip returns only the base
  // row, so we keep the existing joined `destination`/host data on `trip`).
  const handleSaveCover = async (localUri: string) => {
    if (!trip || !currentUserId) return;
    const res = await uploadTripImage(localUri, currentUserId, 'hero');
    if (!res.success || !res.url) throw new Error(res.error || 'Failed to upload cover');
    await updateGroupTrip(trip.id, { hero_image_url: res.url });
    setTrip(prev => (prev ? { ...prev, hero_image_url: res.url! } : prev));
  };

  const handleSaveAboutHost = async (text: string) => {
    if (!trip) return;
    const next = text || null;
    await updateGroupTrip(trip.id, { host_lead_note: next });
    setTrip(prev => (prev ? { ...prev, host_lead_note: next } : prev));
  };

  const handleSaveDescription = async (text: string) => {
    if (!trip) return;
    await updateGroupTrip(trip.id, { description: text });
    setTrip(prev => (prev ? { ...prev, description: text } : prev));
  };

  const handleSaveDates = async (patch: DatesPatch) => {
    if (!trip) return;
    await updateGroupTrip(trip.id, patch);
    setTrip(prev => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSaveAccommodation = async (next: AccommodationInitial) => {
    if (!trip || !currentUserId) return;
    // A freshly-picked photo is a local file URI — upload it first. An existing
    // remote URL is left untouched.
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
    setTrip(prev => (prev ? { ...prev, ...patch } : prev));
  };

  const handleShare = async () => {
    if (!trip) return;
    try {
      const message = `${trip.title || 'Surftrip'} — ${formatDestination(trip)} · ${formatDates(trip)}`;
      await Share.share({ message });
    } catch {
      // user cancelled or platform unavailable — silently no-op
    }
  };

  const handleToggleMute = () => setMuted(m => !m);

  const handleOpenCommitSheet = () => {
    if (!currentUserId) return;
    setCommitSheetOpen(true);
  };

  const handleSubmitCommitment = async (items: CommitmentItem[], note: string) => {
    if (!currentUserId) return;
    // Optimistic: flip the local participant to pending so the button updates
    // immediately. If the request fails we restore the prior status.
    const prior = {
      status: myCommitmentStatus,
      items: myCommitmentItems,
      note: myCommitmentNote,
    };
    setParticipants(prev =>
      prev.map(p =>
        p.user_id === currentUserId
          ? {
              ...p,
              commitment_status: 'pending',
              commitment_items: items,
              commitment_note: note || null,
            }
          : p
      )
    );
    try {
      await submitCommitment(tripId, currentUserId, items, note || null);
    } catch (e: any) {
      setParticipants(prev =>
        prev.map(p =>
          p.user_id === currentUserId
            ? {
                ...p,
                commitment_status: prior.status,
                commitment_items: prior.items,
                commitment_note: prior.note,
              }
            : p
        )
      );
      Alert.alert('Could not submit', e?.message || 'Please try again.');
      throw e;
    }
  };

  const handleToggleGroupGearItem = async (itemName: string) => {
    if (!currentUserId) return;
    const current = myGroupGear;
    const next: GroupGearItem[] = current.map(it =>
      it.name === itemName ? { ...it, done: !it.done } : it
    );
    // Optimistic
    setParticipants(prev =>
      prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear_by_host: next } : p))
    );
    try {
      await setMyGroupGear(tripId, currentUserId, next);
    } catch (e: any) {
      // Revert
      setParticipants(prev =>
        prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear_by_host: current } : p))
      );
      Alert.alert('Could not update', e?.message || 'Please try again.');
    }
  };

  // -------------------------------------------------------------------------
  // Personal gear (member-private) handlers
  // -------------------------------------------------------------------------
  const persistPersonalGear = async (next: PersonalGearItem[], previous: PersonalGearItem[]) => {
    if (!currentUserId) return;
    // Optimistic
    setParticipants(prev =>
      prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear_by_me: next } : p))
    );
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
    } catch (e: any) {
      setParticipants(prev =>
        prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear_by_me: previous } : p))
      );
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
      setParticipants(prev =>
        prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear_by_me: next } : p))
      );
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
      // The DB trigger has now synced participant lists; refetch both.
      const [tripData, participantsData] = await Promise.all([
        getTripById(tripId),
        getTripParticipants(tripId),
      ]);
      if (tripData) setTrip(tripData);
      setParticipants(participantsData);
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
      await refreshGear();
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
    await refreshGear();
  };

  const handleDeleteGearItem = async (itemId: string) => {
    await deleteGearItem(itemId);
    await refreshGear();
  };

  const handleApproveGearRequest = async (request: EnrichedGearRequest, neededQty: number) => {
    setProcessingGearRequestId(request.id);
    try {
      await approveGearRequest(request.id, neededQty);
      await Promise.all([refreshGear(), refreshGearRequests()]);
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
      await refreshGearRequests();
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
    setUpdateDraft('');
    setAddingUpdate(true);
  };

  const handleCancelUpdateDraft = () => {
    setAddingUpdate(false);
    setEditingUpdateId(null);
    setUpdateDraft('');
  };

  const handleSubmitUpdate = async () => {
    if (!currentUserId) return;
    const body = updateDraft.trim();
    if (!body) {
      handleCancelUpdateDraft();
      return;
    }
    setSavingUpdate(true);
    try {
      if (editingUpdateId) {
        const updated = await updateAdminUpdate(editingUpdateId, body);
        setAdminUpdates(prev => prev.map(u => (u.id === updated.id ? updated : u)));
      } else {
        const created = await addAdminUpdate(tripId, currentUserId, body);
        setAdminUpdates(prev => [created, ...prev]);
      }
      handleCancelUpdateDraft();
    } catch (e: any) {
      Alert.alert('Could not save update', e?.message || 'Please try again.');
    } finally {
      setSavingUpdate(false);
    }
  };

  const handleEditUpdate = (update: AdminUpdate) => {
    setAddingUpdate(false);
    setEditingUpdateId(update.id);
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
            setAdminUpdates(prev => prev.filter(u => u.id !== update.id));
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
  const handleSubmitUpdateBody = async (body: string) => {
    if (!currentUserId) return;
    const text = body.trim();
    if (!text) {
      handleCancelUpdateDraft();
      return;
    }
    setSavingUpdate(true);
    try {
      if (editingUpdateId) {
        const updated = await updateAdminUpdate(editingUpdateId, text);
        setAdminUpdates(prev => prev.map(u => (u.id === updated.id ? updated : u)));
      } else {
        const created = await addAdminUpdate(tripId, currentUserId, text);
        setAdminUpdates(prev => [created, ...prev]);
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
  const handleSaveSuggestedGear = async (names: string[]) => {
    if (!trip) return;
    const cleaned = names.map(n => n.trim()).filter(Boolean);
    try {
      await setTripGroupGear(tripId, cleaned);
      const [tripData, participantsData] = await Promise.all([
        getTripById(tripId),
        getTripParticipants(tripId),
      ]);
      if (tripData) setTrip(tripData);
      setParticipants(participantsData);
    } catch (e: any) {
      Alert.alert('Could not save list', e?.message || 'Please try again.');
    }
  };

  const handleAddPersonalSubmit = async (name: string) => {
    if (!currentUserId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingPersonalItem(true);
    const current = myPersonalGear;
    const next: PersonalGearItem[] = [...current, { name: trimmed, done: false }];
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
      setParticipants(prev =>
        prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear_by_me: next } : p))
      );
      setAddPersonalSheetOpen(false);
    } catch (e: any) {
      Alert.alert('Could not add', e?.message || 'Please try again.');
    } finally {
      setSavingPersonalItem(false);
    }
  };

  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <View style={styles.centered}>
          <ActivityIndicator color="#0788B0" />
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Trip not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isCancelled = trip.status === 'cancelled';
  const isCompleted = trip.status === 'completed';
  // A trip that has ended by date is treated like a completed one: the plan is
  // locked, only the overview + group chat stay active. Explicit completion or
  // cancellation lock it the same way.
  const isLocked = isCancelled || isCompleted || isTripPast(trip);

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
  const showOverview = !showPlan; // overview-only extras (Share, budget, members)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header
        onBack={onBack}
        title={trip.title || 'Trip'}
        rightAction={
          <View style={styles.headerActions}>
            {/* Group chat — members only. Stays available even when the trip is
                completed / ended (plan is locked, but chat lives on). */}
            {(isHost || isApprovedMember) && !isCancelled ? (
              <TouchableOpacity
                onPress={handleOpenGroupChat}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Open group chat"
                disabled={openingChat}
              >
                {openingChat ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="chatbubble-outline" size={24} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            ) : null}
            {/* Edit — host only, while the trip is still live. */}
            {isHost && !isLocked ? (
              <TouchableOpacity
                onPress={handleEdit}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Edit trip"
              >
                <Ionicons name="create-outline" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
            {/* Notification bell (Figma) — only when the navigator wires it. */}
            {onOpenNotifications ? (
              <TouchableOpacity
                onPress={onOpenNotifications}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Open notifications"
              >
                <Ionicons name="notifications-outline" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
          onLeaderPress={
            onViewUserProfile && trip.host_id && trip.host_id !== currentUserId
              ? () => onViewUserProfile(trip.host_id)
              : undefined
          }
          afterHeroSlot={
            canSeePlan ? (
              <TripTabToggle value={activeTab} onChange={setActiveTab} />
            ) : null
          }
          bodyHidden={showPlan}
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
            };
          })()}
          onEditCover={() => setEditSheet('cover')}
          onEditAboutHost={() => setEditSheet('about')}
          onEditDescription={() => setEditSheet('description')}
          onEditDates={() => setEditSheet('dates')}
          onEditAccommodation={() => setEditSheet('accommodation')}
        />

        {/* ============================ OVERVIEW ============================ */}
        {/* Public, read-only extra below the TripDetailView body. The members
            list lives in the Participants section now (tappable avatars). */}
        {showOverview && (
          <View style={[styles.actionRow, { marginTop: 20, paddingHorizontal: 16 }]}>
            <ActionButton icon="share-outline" label="Share" onPress={handleShare} />
          </View>
        )}

        {/* ============================== PLAN ============================== */}
        {/* Interactive / operational content — members only. */}
        {showPlan && (
        <>
        {/* Action row — Share / Mute (member actions). Chat now lives in the
            header (top-right) so it stays reachable when the plan is locked. */}
        <View style={[styles.actionRow, { marginTop: 20, paddingHorizontal: 16 }]}>
          <ActionButton icon="share-outline" label="Share" onPress={handleShare} />
          <ActionButton
            icon={muted ? 'notifications-off' : 'notifications-outline'}
            label={muted ? 'Muted' : 'Mute'}
            onPress={handleToggleMute}
          />
        </View>

        {/* Pending requests (host only) */}
        {isHost && pendingRequests.length > 0 && (
          <Section title={`Pending requests (${pendingRequests.length})`}>
            {pendingRequests.map(r => (
              <PendingRequestCard
                key={r.id}
                request={r}
                onApprove={handleApprove}
                onDecline={handleDecline}
                isProcessing={processingRequestId === r.id}
              />
            ))}
          </Section>
        )}

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

        {/* About, Focus vibe, How it works, Accommodation, Who it's for, Wave
            info, approximate budget and the members list now live in the
            Overview tab (above / read-only). Everything below is Plan-only. */}

        {/* Group Gear — shared items the host wants the group to bring. Shown to
            approved members even when empty so they can still request an item. */}
        {(gearItems.length > 0 || isHost || isApprovedMember) && !isCancelled && (
          <View style={styles.section}>
            <View style={styles.gearHeaderRow}>
              <View>
                <Text style={styles.gearHeaderTitle}>GROUP GEAR</Text>
                <Text style={styles.gearHeaderSub}>Shared items for the trip</Text>
              </View>
              {isHost && (
                <TouchableOpacity
                  style={styles.gearManageBtn}
                  onPress={() => setManageSheetVisible(true)}
                >
                  <Text style={styles.gearManageBtnText}>Manage</Text>
                </TouchableOpacity>
              )}
            </View>

            {gearItems.length === 0 ? (
              <Text style={styles.muted}>
                {isHost ? 'No items yet — tap Manage to add some.' : 'No items yet.'}
              </Text>
            ) : (
              gearItems.map(item => (
                <GearItemCard
                  key={item.id}
                  item={item}
                  onPress={() => setGearItemSheetItem(item)}
                />
              ))
            )}

            {isApprovedMember && (
              <TouchableOpacity
                style={styles.requestLinkBtn}
                onPress={() => setRequestSheetVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.requestLinkText}>Missing something? Request item</Text>
              </TouchableOpacity>
            )}

            {isHost && (
              <TouchableOpacity
                style={styles.gearReqsBadge}
                onPress={() => setRequestsSheetVisible(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="notifications-outline" size={16} color="#222B30" />
                <Text style={styles.gearReqsBadgeText}>
                  {gearRequests.length > 0
                    ? `${gearRequests.length} pending ${gearRequests.length === 1 ? 'request' : 'requests'}`
                    : 'Gear requests'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#222B30" />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Personal packing list — per-user items with done state. Always shown
            to the host and approved members so they can add their own items even
            when the host hasn't suggested any. */}
        {(isHost || isApprovedMember) && !isCancelled && (
          <View style={styles.section}>
            <View style={styles.packingHeader}>
              <Text style={styles.sectionTitle}>Your gear</Text>
              {isHost && !isCancelled && (
                <TouchableOpacity
                  style={styles.editSuggestedBtn}
                  onPress={() => setEditSuggestedSheetOpen(true)}
                  activeOpacity={0.7}
                  accessibilityLabel="Edit suggested gear"
                >
                  <Ionicons name="create-outline" size={15} color="#0788B0" />
                  <Text style={styles.editSuggestedBtnText}>Edit suggested</Text>
                  <HostTag />
                </TouchableOpacity>
              )}
            </View>

            {/* Compact summary — tap to open the full list (check / add). */}
            <TouchableOpacity
              style={styles.gearSummaryCard}
              onPress={() => setPersonalGearSheetOpen(true)}
              activeOpacity={0.7}
            >
              {gearTotalCount > 0 ? (
                <>
                  <Text style={styles.gearSummaryCount}>
                    {gearTotalCount} {gearTotalCount === 1 ? 'item' : 'items'} · {gearDoneCount} packed
                  </Text>
                  {gearPreview.map(row => (
                    <View key={`${row.kind}-${row.name}`} style={styles.gearSummaryRow}>
                      <Ionicons
                        name={row.done ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={row.done ? '#34C759' : '#B0B0B0'}
                      />
                      <Text
                        style={[styles.gearSummaryItem, row.done && styles.gearSummaryItemDone]}
                        numberOfLines={1}
                      >
                        {row.name}
                      </Text>
                      {row.kind === 'host' ? <HostTag /> : null}
                    </View>
                  ))}
                  {gearHiddenCount > 0 ? (
                    <Text style={styles.gearSummaryMore}>+{gearHiddenCount} more</Text>
                  ) : null}
                  <View style={styles.gearSummaryViewAllRow}>
                    <Text style={styles.gearSummaryViewAll}>View all</Text>
                    <Ionicons name="chevron-forward" size={14} color="#0788B0" />
                  </View>
                </>
              ) : (
                <Text style={styles.muted}>
                  {isHost
                    ? 'No gear yet — add suggestions for everyone or your own items.'
                    : 'No gear yet — tap to start your list.'}
                </Text>
              )}
            </TouchableOpacity>

            {(isHost || isApprovedMember) && !isCancelled && (
              <TouchableOpacity
                style={styles.personalAddBtn}
                onPress={() => setAddPersonalSheetOpen(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={18} color="#0788B0" />
                <Text style={styles.personalAddBtnText}>Add my item</Text>
              </TouchableOpacity>
            )}

          </View>
        )}

        {/* Commitment CTA — only approved members. The host doesn't commit to
            their own trip (nobody to approve them; semantically meaningless). */}
        {isApprovedMember && !isCancelled && (
          <View style={styles.commitWrapper}>
            <TouchableOpacity
              style={[
                styles.commitCta,
                myCommitmentStatus === 'approved' && styles.commitCtaApproved,
                myCommitmentStatus === 'pending' && styles.commitCtaPending,
              ]}
              onPress={handleOpenCommitSheet}
              activeOpacity={0.85}
            >
              {myCommitmentStatus === 'approved' && (
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
              )}
              <Text style={styles.commitCtaText}>
                {myCommitmentStatus === 'approved'
                  ? 'Committed'
                  : myCommitmentStatus === 'pending'
                  ? 'Commitment Pending…'
                  : 'Committed to this trip'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.commitCtaCaption}>
              {myCommitmentStatus === 'approved'
                ? "You're locked in. Tap to update your details."
                : myCommitmentStatus === 'pending'
                ? 'Waiting for the host to approve. Tap to update.'
                : "Let the host know how you're committed"}
            </Text>
          </View>
        )}

        {/* Group breakdown — only when there's at least one member besides the host */}
        {hasNonHostMembers && (
          <Section title="Group breakdown">
            <TripParticipantsBreakdown participants={participants} />
          </Section>
        )}

        {/* Admin updates — host-posted free-text lines, visible to all members. */}
        {(adminUpdates.length > 0 || isHost) && (
          <Section
            title="Recent admin updates"
            headerRight={
              isHost ? (
                <TouchableOpacity
                  style={styles.addUpdateBtn}
                  onPress={handleStartAddUpdate}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={14} color="#222B30" />
                  <Text style={styles.addUpdateBtnText}>Add update</Text>
                  <HostTag />
                </TouchableOpacity>
              ) : null
            }
          >
            {adminUpdates.length === 0 ? (
              <Text style={styles.updatesEmpty}>No updates yet.</Text>
            ) : (
              adminUpdates.map(u => (
                <TouchableOpacity
                  key={u.id}
                  style={styles.updateRow}
                  onLongPress={() => handleLongPressUpdate(u)}
                  activeOpacity={isHost ? 0.7 : 1}
                  disabled={!isHost}
                >
                  <View style={styles.updateBullet} />
                  <View style={styles.updateBody}>
                    <Text style={styles.updateText}>
                      <Text style={styles.updateAuthor}>Host </Text>
                      {u.body}
                    </Text>
                    <Text style={styles.updateTime}>{formatRelativeTime(u.created_at)}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </Section>
        )}

        {/* Bottom destructive — Exit (member) / Cancel (host), WhatsApp-style red rows */}
        {!isCancelled && (isApprovedMember || isHost) && (
          <View style={styles.destructiveCard}>
            {isApprovedMember && !isHost && (
              <DangerRow
                icon="exit-outline"
                label="Exit trip"
                onPress={handleLeaveTrip}
                loading={leaving}
              />
            )}
            {isHost && (
              <DangerRow
                icon="close-circle-outline"
                label="Cancel trip"
                onPress={handleCancelTrip}
                loading={cancelling}
              />
            )}
            {/* Mark completed — host only, once the trip is underway. Closes the
                trip: it moves to "Past trips" and the plan locks (overview +
                chat stay). Hidden for upcoming trips. */}
            {isHost && tripHasStarted && (
              <DangerRow
                icon="checkmark-done-outline"
                label="Mark trip as completed"
                onPress={handleCompleteTrip}
                loading={completing}
                showDivider
              />
            )}
          </View>
        )}
        </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky CTA — only for the join flow (non-host, non-member, active trip) */}
      {!isHost && !isCancelled && !isApprovedMember && myRequest?.status !== 'approved' && (
        <View style={styles.cta}>
          <CtaButton
            myRequest={myRequest}
            submitting={submitting}
            onRequest={handleOpenJoinSheet}
            onWithdraw={handleWithdraw}
          />
        </View>
      )}

      {/* Sticky CTA — members get quick access to the group chat (Figma
          "Trip Chat", accent). Mirrors the chat icon in the header. */}
      {(isHost || isApprovedMember) && !isCancelled && (
        <View style={styles.cta}>
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
        </View>
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
      <GearRequestsSheet
        visible={requestsSheetVisible}
        requests={gearRequests}
        processingId={processingGearRequestId}
        onClose={() => setRequestsSheetVisible(false)}
        onApprove={handleApproveGearRequest}
        onDecline={handleDeclineGearRequest}
      />
      <CommitmentSheet
        visible={commitSheetOpen}
        onClose={() => setCommitSheetOpen(false)}
        initialItems={myCommitmentItems}
        initialNote={myCommitmentNote}
        onSubmit={handleSubmitCommitment}
      />
      <RequestToJoinSheet
        visible={joinSheetOpen}
        onClose={() => setJoinSheetOpen(false)}
        profile={myJoinProfile}
        onSubmit={handleSubmitJoinRequest}
      />

      {/* Admin update — host writes/edits an announcement. Driven by the same
          addingUpdate / editingUpdateId state the list uses. */}
      <AdminUpdateSheet
        visible={addingUpdate || !!editingUpdateId}
        mode={editingUpdateId ? 'edit' : 'add'}
        initialBody={editingUpdateId ? (updateDraft ?? '') : ''}
        saving={savingUpdate}
        onClose={handleCancelUpdateDraft}
        onSubmit={handleSubmitUpdateBody}
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

      {/* Host edits the suggested gear list (everyone's checklist). */}
      <EditSuggestedGearSheet
        visible={editSuggestedSheetOpen}
        onClose={() => setEditSuggestedSheetOpen(false)}
        items={trip.personal_gear_host_suggestion ?? []}
        onSave={handleSaveSuggestedGear}
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
        subtitle="Why you’re the right person to lead this."
        label="Why you’re the right person to lead"
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
        initial={{
          kind: (trip.accommodation_type?.[0] ?? null) as AccommodationInitial['kind'],
          name: trip.accommodation_name ?? '',
          url: trip.accommodation_url ?? '',
          photoUri: trip.accommodation_image_url ?? null,
        }}
        onClose={() => setEditSheet(null)}
        onSave={handleSaveAccommodation}
      />
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
  submitting: boolean;
  onRequest: () => void;
  onWithdraw: () => void;
}> = ({ myRequest, submitting, onRequest, onWithdraw }) => {
  if (myRequest?.status === 'pending') {
    return (
      <View style={styles.ctaPendingRow}>
        <View style={[styles.ctaBtn, styles.ctaPending, { flex: 1 }]}>
          <Ionicons name="time-outline" size={18} color="#555" />
          <Text style={styles.ctaPendingText}>Request pending</Text>
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, styles.ctaWithdraw]}
          onPress={onWithdraw}
          disabled={submitting}
          activeOpacity={0.7}
        >
          {submitting ? (
            <ActivityIndicator color="#555" />
          ) : (
            <Text style={styles.ctaWithdrawText}>Withdraw</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }
  if (myRequest?.status === 'declined') {
    // Previously declined → let them try again. A fresh request replaces the
    // old declined row (see requestToJoinTrip), so the host sees a new pending.
    return (
      <View style={styles.ctaDeclinedRow}>
        <Text style={styles.ctaDeclinedNote}>Your last request was declined.</Text>
        <TouchableOpacity
          style={[styles.ctaBtn, styles.ctaPrimary]}
          onPress={onRequest}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaPrimaryText}>Request again</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }
  // No request yet, or withdrawn → allow new request
  return (
    <TouchableOpacity
      style={[styles.ctaBtn, styles.ctaPrimary]}
      onPress={onRequest}
      disabled={submitting}
      activeOpacity={0.85}
    >
      {submitting ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.ctaPrimaryText}>Request to join</Text>
      )}
    </TouchableOpacity>
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
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : { fontFamily: 'Montserrat' }),
  },
  headerRight: { minWidth: 28, alignItems: 'flex-end' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  errorText: { color: '#7B7B7B' },

  keyboardAvoider: { flex: 1, backgroundColor: '#FAFAFA' },
  scrollContent: { paddingBottom: 24 },

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
  cta: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#FAFAFA',
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 12,
    gap: 6,
  },
  ctaPrimary: { backgroundColor: '#212121' },
  ctaChat: { backgroundColor: '#05BCD3' },
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : { fontFamily: 'Montserrat' }),
  },
  ctaPendingRow: { flexDirection: 'row', gap: 10 },
  ctaPending: { backgroundColor: '#F2F2F2' },
  ctaPendingText: { color: '#555', fontWeight: '600', fontSize: 14, marginLeft: 6 },
  ctaWithdraw: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDD', paddingHorizontal: 16 },
  ctaWithdrawText: { color: '#555', fontWeight: '600', fontSize: 14 },
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
    backgroundColor: '#FFF7E6',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
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
