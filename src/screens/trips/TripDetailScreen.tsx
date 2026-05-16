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
  PackingItem,
  PersonalGearItem,
  AdminUpdate,
  EnrichedGearItem,
  EnrichedGearRequest,
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
  getTripParticipants,
  getMyJoinRequest,
  listPendingRequests,
  requestToJoinTrip,
  withdrawJoinRequest,
  approveJoinRequest,
  declineJoinRequest,
  cancelTrip,
  leaveTrip,
  removeParticipant,
  submitCommitment,
  type CommitmentItem,
  type CommitmentStatus,
  setTripPackingList,
  setMyPackingList,
  setMyPersonalGearList,
  listAdminUpdates,
  addAdminUpdate,
  updateAdminUpdate,
  deleteAdminUpdate,
} from '../../services/trips/groupTripsService';
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

const IS_LOCAL_MODE = process.env.EXPO_PUBLIC_LOCAL_MODE === 'true';

interface TripDetailScreenProps {
  tripId: string;
  onBack: () => void;
  onOpenGroupChat?: (params: { conversationId: string; title: string; heroImageUrl?: string | null; tripId?: string }) => void;
  onEditTrip?: (trip: GroupTrip) => void;
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

const formatDestination = (trip: GroupTrip): string => {
  const parts = [trip.destination_area, trip.destination_country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Destination TBD';
};

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
export default function TripDetailScreen({ tripId, onBack, onOpenGroupChat, onEditTrip }: TripDetailScreenProps) {
  const { user: contextUser } = useOnboarding();
  const currentUserId = contextUser?.id?.toString() ?? null;

  const [trip, setTrip] = useState<GroupTrip | null>(null);
  const [participants, setParticipants] = useState<EnrichedParticipant[]>([]);
  const [myRequest, setMyRequest] = useState<GroupTripJoinRequest | null>(null);
  const [pendingRequests, setPendingRequests] = useState<EnrichedJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [commitSheetOpen, setCommitSheetOpen] = useState(false);
  const [joinSheetOpen, setJoinSheetOpen] = useState(false);
  const [myJoinProfile, setMyJoinProfile] = useState<{
    name: string | null;
    avatarUrl: string | null;
    surfLevel: string | null;
  } | null>(null);
  const [editingPacking, setEditingPacking] = useState(false);
  const [packingDraft, setPackingDraft] = useState('');
  const [savingPacking, setSavingPacking] = useState(false);
  // Member-private gear: each user adds/removes only their own; host items
  // live in trip.packing_list and aren't editable from here.
  const [addingPersonalItem, setAddingPersonalItem] = useState(false);
  const [personalItemDraft, setPersonalItemDraft] = useState('');
  const [savingPersonalItem, setSavingPersonalItem] = useState(false);
  const [muted, setMuted] = useState(false);

  // Group Gear — shared items with required quantities + request flow.
  // Replaces the old (group_packing_list jsonb + group_trip_group_packing_claims) model.
  const [gearItems, setGearItems] = useState<EnrichedGearItem[]>([]);
  const [gearRequests, setGearRequests] = useState<EnrichedGearRequest[]>([]); // host only
  const [gearItemSheetItem, setGearItemSheetItem] = useState<EnrichedGearItem | null>(null);
  const [requestSheetVisible, setRequestSheetVisible] = useState(false);
  const [manageSheetVisible, setManageSheetVisible] = useState(false);
  const [requestsSheetVisible, setRequestsSheetVisible] = useState(false);
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
  const myPackingList = useMemo<PackingItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.packing_list ?? [],
    [participants, currentUserId]
  );
  const myPersonalGear = useMemo<PersonalGearItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.personal_gear ?? [],
    [participants, currentUserId]
  );
  const gearTotalCount = (trip?.packing_list?.length ?? 0) + myPersonalGear.length;
  const gearDoneCount =
    myPackingList.filter(it => it.done && (trip?.packing_list ?? []).includes(it.name)).length +
    myPersonalGear.filter(it => it.done).length;
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
        const [pending, gearReqs] = await Promise.all([
          listPendingRequests(tripId),
          listGearRequests(tripId, 'pending'),
        ]);
        setPendingRequests(pending);
        setGearRequests(gearReqs);
        setMyRequest(null);
      } else {
        const req = await getMyJoinRequest(tripId, currentUserId);
        setMyRequest(req);
        setPendingRequests([]);
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
      // Optimistic: remove from pending and refetch participants
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
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
      await declineJoinRequest(requestId);
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
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

  const handleTogglePackingItem = async (itemName: string) => {
    if (!currentUserId) return;
    const current = myPackingList;
    const next: PackingItem[] = current.map(it =>
      it.name === itemName ? { ...it, done: !it.done } : it
    );
    // Optimistic
    setParticipants(prev =>
      prev.map(p => (p.user_id === currentUserId ? { ...p, packing_list: next } : p))
    );
    try {
      await setMyPackingList(tripId, currentUserId, next);
    } catch (e: any) {
      // Revert
      setParticipants(prev =>
        prev.map(p => (p.user_id === currentUserId ? { ...p, packing_list: current } : p))
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
      prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear: next } : p))
    );
    try {
      await setMyPersonalGearList(tripId, currentUserId, next);
    } catch (e: any) {
      setParticipants(prev =>
        prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear: previous } : p))
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
    const hostNames = (trip?.packing_list ?? []).map(n => n.toLowerCase());
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
        prev.map(p => (p.user_id === currentUserId ? { ...p, personal_gear: next } : p))
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
    setPackingDraft((trip.packing_list ?? []).join('\n'));
    setEditingPacking(true);
  };

  const handleCancelEditPacking = () => {
    setEditingPacking(false);
    setPackingDraft('');
  };

  const handleSavePacking = async () => {
    if (!trip) return;
    const names = packingDraft
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    setSavingPacking(true);
    try {
      await setTripPackingList(tripId, names);
      // The DB trigger has now synced participant lists; refetch both.
      const [tripData, participantsData] = await Promise.all([
        getTripById(tripId),
        getTripParticipants(tripId),
      ]);
      if (tripData) setTrip(tripData);
      setParticipants(participantsData);
      setEditingPacking(false);
      setPackingDraft('');
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

  const handleApproveGearRequest = async (request: EnrichedGearRequest) => {
    setProcessingGearRequestId(request.id);
    try {
      await approveGearRequest(request.id, 1);
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

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header
        onBack={onBack}
        title={trip.title || 'Trip'}
        rightAction={
          isHost && !isCancelled ? (
            <TouchableOpacity
              onPress={handleEdit}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Edit trip"
            >
              <Ionicons name="create-outline" size={24} color="#222B30" />
            </TouchableOpacity>
          ) : null
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {isCancelled && (
          <View style={styles.cancelledBanner}>
            <Ionicons name="alert-circle-outline" size={18} color="#C0392B" />
            <Text style={styles.cancelledText}>This trip has been cancelled by the host.</Text>
          </View>
        )}

        {/* Top card — hero, title, action row (WhatsApp-style group header) */}
        <View style={styles.topCard}>
          {trip.hero_image_url ? (
            <Image source={{ uri: trip.hero_image_url }} style={styles.hero} />
          ) : (
            <View style={[styles.hero, styles.heroPlaceholder]}>
              <Ionicons name="image-outline" size={40} color="#B0B0B0" />
            </View>
          )}

          <View style={styles.titleBlock}>
            {!!trip.title && <Text style={styles.title}>{trip.title}</Text>}
            <View style={styles.metaRow}>
              <Ionicons name="people" size={14} color="#7B7B7B" />
              <Text style={styles.metaText}>
                {participants.length} {participants.length === 1 ? 'member' : 'members'}
              </Text>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.metaText} numberOfLines={1}>
                {formatDestination(trip)}
              </Text>
            </View>
            <Text style={styles.dates}>{formatDates(trip)}</Text>
            {trip.host_been_there !== null && (
              <Text style={styles.dates}>
                {trip.host_been_there ? 'Host has been here before' : 'Host hasn’t been here yet'}
              </Text>
            )}
          </View>

          <View style={styles.actionRow}>
            {IS_LOCAL_MODE && (isHost || isApprovedMember) && (
              <ActionButton
                icon="chatbubbles"
                label="Chat"
                onPress={handleOpenGroupChat}
                loading={openingChat}
              />
            )}
            <ActionButton icon="share-outline" label="Share" onPress={handleShare} />
            {(isHost || isApprovedMember) && (
              <ActionButton
                icon={muted ? 'notifications-off' : 'notifications-outline'}
                label={muted ? 'Muted' : 'Mute'}
                onPress={handleToggleMute}
              />
            )}
          </View>
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

        {/* About */}
        <Section title="About this trip">
          <Text style={styles.body}>{trip.description}</Text>
        </Section>

        {/* Accommodation */}
        {(trip.accommodation_name || trip.accommodation_type) && (
          <Section title="Accommodation">
            {!!trip.accommodation_name && <InfoRow label="Name" value={trip.accommodation_name} />}
            {!!trip.accommodation_type && (
              <InfoRow
                label="Type"
                value={
                  Array.isArray(trip.accommodation_type)
                    ? trip.accommodation_type.join(', ')
                    : String(trip.accommodation_type)
                }
              />
            )}
            {!!trip.accommodation_url && <InfoRow label="Link" value={trip.accommodation_url} />}
          </Section>
        )}

        {/* Budget */}
        {(trip.budget_min != null || trip.budget_max != null) && (
          <Section title="Approximate budget">
            <InfoRow
              label="Per person"
              value={`${trip.budget_min ?? '?'}–${trip.budget_max ?? '?'} ${trip.budget_currency ?? 'USD'}`}
            />
          </Section>
        )}

        {/* Vibe */}
        {trip.vibe &&
          ((trip.vibe.morning?.length ?? 0) +
            (trip.vibe.afternoon?.length ?? 0) +
            (trip.vibe.evening?.length ?? 0) +
            (trip.vibe.night?.length ?? 0) >
            0) && (
            <Section title="Vibe">
              {trip.vibe.morning?.length ? (
                <InfoRow label="Morning" value={trip.vibe.morning.join(', ')} />
              ) : null}
              {trip.vibe.afternoon?.length ? (
                <InfoRow label="Afternoon" value={trip.vibe.afternoon.join(', ')} />
              ) : null}
              {trip.vibe.evening?.length ? (
                <InfoRow label="Evening" value={trip.vibe.evening.join(', ')} />
              ) : null}
              {trip.vibe.night?.length ? (
                <InfoRow label="Night" value={trip.vibe.night.join(', ')} />
              ) : null}
            </Section>
          )}

        {/* Surf spots */}
        {trip.surf_spots && trip.surf_spots.length > 0 && (
          <Section title="Surf spots">
            <Text style={styles.body}>
              {trip.surf_spots
                .map(s => (s.country ? `${s.name} (${s.country})` : s.name))
                .join(', ')}
            </Text>
          </Section>
        )}

        {/* Who it's for */}
        <Section title="Who it's for">
          <InfoRow label="Ages" value={`${trip.age_min}–${trip.age_max} yrs`} />
          {trip.target_surf_levels?.length > 0 && (
            <InfoRow label="Levels" value={trip.target_surf_levels.join(', ')} />
          )}
          {trip.target_surf_styles?.length > 0 && (
            <InfoRow label="Boards" value={trip.target_surf_styles.join(', ')} />
          )}
        </Section>

        {/* Wave */}
        {(trip.wave_size_min != null ||
          trip.wave_size_max != null ||
          trip.wave_fat_to_barreling != null) && (
          <Section title="Wave">
            {trip.wave_size_min != null && trip.wave_size_max != null && (
              <InfoRow label="Size" value={`${trip.wave_size_min}–${trip.wave_size_max} ft`} />
            )}
            {trip.wave_fat_to_barreling != null && (
              <InfoRow label="Fat ↔ Barreling" value={`${trip.wave_fat_to_barreling}/10`} />
            )}
          </Section>
        )}

        {/* Group Gear — shared items the host wants the group to bring. */}
        {(gearItems.length > 0 || isHost) && !isCancelled && (
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

            {(isApprovedMember || isHost) && (
              <TouchableOpacity
                style={styles.requestLinkBtn}
                onPress={() => setRequestSheetVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.requestLinkText}>Missing something? Request item</Text>
              </TouchableOpacity>
            )}

            {isHost && gearRequests.length > 0 && (
              <TouchableOpacity
                style={styles.gearReqsBadge}
                onPress={() => setRequestsSheetVisible(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="notifications-outline" size={16} color="#222B30" />
                <Text style={styles.gearReqsBadgeText}>
                  {gearRequests.length} pending {gearRequests.length === 1 ? 'request' : 'requests'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#222B30" />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Personal packing list — per-user items with done state. */}
        {((trip.packing_list && trip.packing_list.length > 0) || (isHost && !isCancelled)) && (
          <View style={styles.section}>
            <View style={styles.packingHeader}>
              <Text style={styles.sectionTitle}>Your gear</Text>
              {isHost && !isCancelled && !editingPacking && (
                <TouchableOpacity
                  onPress={handleStartEditPacking}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Edit personal packing list"
                >
                  <Ionicons name="create-outline" size={18} color="#7B7B7B" />
                </TouchableOpacity>
              )}
            </View>

            {(
              editingPacking ? (
                <>
                  <Text style={styles.muted}>One item per line.</Text>
                  <TextInput
                    style={styles.packingTextarea}
                    multiline
                    value={packingDraft}
                    onChangeText={setPackingDraft}
                    placeholder={'wax\nsunscreen\npassport\nboard bag'}
                    placeholderTextColor="#B0B0B0"
                    autoCapitalize="none"
                    editable={!savingPacking}
                  />
                  <View style={styles.packingActions}>
                    <TouchableOpacity
                      style={styles.packingCancel}
                      onPress={handleCancelEditPacking}
                      disabled={savingPacking}
                    >
                      <Text style={styles.packingCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.packingSave, savingPacking && styles.manageBtnDisabled]}
                      onPress={handleSavePacking}
                      disabled={savingPacking}
                    >
                      {savingPacking ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.packingSaveText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  {gearTotalCount > 0 ? (
                    <Text style={styles.muted}>
                      {gearTotalCount} items · {gearDoneCount} done
                    </Text>
                  ) : (
                    <Text style={styles.muted}>
                      {isHost ? 'No items yet — tap the pencil to add suggestions.' : 'No items yet — tap "Add item" to start.'}
                    </Text>
                  )}

                  {/* Host items — shown to all participants with the "Host suggestion" tag. */}
                  {(trip.packing_list ?? []).map(name => {
                    const myItem = myPackingList.find(it => it.name === name);
                    const done = !!myItem?.done;
                    const canToggle = !!currentUserId && (isHost || isApprovedMember) && !isCancelled;
                    return (
                      <TouchableOpacity
                        key={`host-${name}`}
                        style={styles.packingRow}
                        onPress={() => canToggle && handleTogglePackingItem(name)}
                        disabled={!canToggle}
                        activeOpacity={canToggle ? 0.6 : 1}
                      >
                        <Ionicons
                          name={done ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={done ? '#34C759' : '#B0B0B0'}
                        />
                        <Text style={[styles.packingItemText, done && styles.packingItemTextDone]}>
                          {name}
                        </Text>
                        <Text style={styles.hostSuggestionTag}>Host suggestion</Text>
                      </TouchableOpacity>
                    );
                  })}

                  {/* Personal items — visible only to the user who added them. Trash icon to remove. */}
                  {myPersonalGear.map(item => {
                    const canToggle = !!currentUserId && (isHost || isApprovedMember) && !isCancelled;
                    return (
                      <View key={`mine-${item.name}`} style={styles.packingRow}>
                        <TouchableOpacity
                          style={styles.personalToggleHit}
                          onPress={() => canToggle && handleTogglePersonalItem(item.name)}
                          disabled={!canToggle}
                          activeOpacity={canToggle ? 0.6 : 1}
                        >
                          <Ionicons
                            name={item.done ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={item.done ? '#34C759' : '#B0B0B0'}
                          />
                          <Text
                            style={[styles.packingItemText, item.done && styles.packingItemTextDone]}
                          >
                            {item.name}
                          </Text>
                        </TouchableOpacity>
                        {canToggle && (
                          <TouchableOpacity
                            onPress={() => handleRemovePersonalItem(item.name)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityLabel={`Remove ${item.name}`}
                          >
                            <Ionicons name="trash-outline" size={18} color="#C0392B" />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}

                  {/* Inline "+ Add item" editor for the current user. */}
                  {(isHost || isApprovedMember) && !isCancelled && (
                    addingPersonalItem ? (
                      <View style={styles.personalAddEditor}>
                        <TextInput
                          style={styles.personalAddInput}
                          value={personalItemDraft}
                          onChangeText={setPersonalItemDraft}
                          placeholder="e.g. passport, phone charger"
                          placeholderTextColor="#9AA0A6"
                          autoFocus
                          editable={!savingPersonalItem}
                          onSubmitEditing={handleSavePersonalItem}
                          returnKeyType="done"
                        />
                        <View style={styles.personalAddActions}>
                          <TouchableOpacity
                            onPress={handleCancelAddPersonalItem}
                            disabled={savingPersonalItem}
                            style={styles.personalAddCancel}
                          >
                            <Text style={styles.personalAddCancelText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleSavePersonalItem}
                            disabled={!personalItemDraft.trim() || savingPersonalItem}
                            style={[
                              styles.personalAddSave,
                              (!personalItemDraft.trim() || savingPersonalItem) && styles.btnDisabled,
                            ]}
                          >
                            {savingPersonalItem ? (
                              <ActivityIndicator color="#FFFFFF" size="small" />
                            ) : (
                              <Text style={styles.personalAddSaveText}>Add</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.personalAddBtn}
                        onPress={handleStartAddPersonalItem}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="add" size={18} color="#0788B0" />
                        <Text style={styles.personalAddBtnText}>Add item</Text>
                      </TouchableOpacity>
                    )
                  )}
                </>
              )
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

        {/* Members (WhatsApp-style: count in title, rows separated by dividers) */}
        <Section title={`${participants.length} ${participants.length === 1 ? 'Member' : 'Members'}`}>
          {participants.length === 0 ? (
            <Text style={styles.muted}>No participants yet.</Text>
          ) : (
            participants.map((p, idx) => (
              <View key={p.user_id}>
                <ParticipantCard
                  participant={p}
                  isMe={p.user_id === currentUserId}
                  onRemove={
                    isHost && !isCancelled && p.role !== 'host' && removingUserId !== p.user_id
                      ? handleRemoveParticipant
                      : undefined
                  }
                />
                {idx < participants.length - 1 && <View style={styles.memberDivider} />}
              </View>
            ))
          )}
        </Section>

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
              isHost && !addingUpdate && !editingUpdateId ? (
                <TouchableOpacity
                  style={styles.addUpdateBtn}
                  onPress={handleStartAddUpdate}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={14} color="#222B30" />
                  <Text style={styles.addUpdateBtnText}>Add update</Text>
                </TouchableOpacity>
              ) : null
            }
          >
            {(addingUpdate || editingUpdateId) && (
              <View style={styles.updateEditor}>
                <TextInput
                  style={styles.updateEditorInput}
                  value={updateDraft}
                  onChangeText={setUpdateDraft}
                  placeholder="e.g. Updated accommodation"
                  placeholderTextColor="#9AA0A6"
                  multiline
                  autoFocus
                  editable={!savingUpdate}
                />
                <View style={styles.updateEditorActions}>
                  <TouchableOpacity
                    style={styles.updateEditorCancel}
                    onPress={handleCancelUpdateDraft}
                    disabled={savingUpdate}
                  >
                    <Text style={styles.updateEditorCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.updateEditorSave,
                      (!updateDraft.trim() || savingUpdate) && styles.updateEditorSaveDisabled,
                    ]}
                    onPress={handleSubmitUpdate}
                    disabled={!updateDraft.trim() || savingUpdate}
                  >
                    {savingUpdate ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.updateEditorSaveText}>
                        {editingUpdateId ? 'Save' : 'Post'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {adminUpdates.length === 0 && !addingUpdate && !editingUpdateId ? (
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
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

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
      <Ionicons name="chevron-back" size={28} color="#222B30" />
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
    return (
      <View style={[styles.ctaBtn, styles.ctaDeclined]}>
        <Text style={styles.ctaDeclinedText}>Request declined</Text>
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
  root: { flex: 1, backgroundColor: '#F0F2F5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#222B30',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerRight: { width: 28, alignItems: 'flex-end' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  errorText: { color: '#7B7B7B' },

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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    backgroundColor: '#FFFFFF',
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 6,
  },
  ctaPrimary: { backgroundColor: '#0788B0' },
  ctaPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  ctaPendingRow: { flexDirection: 'row', gap: 10 },
  ctaPending: { backgroundColor: '#F2F2F2' },
  ctaPendingText: { color: '#555', fontWeight: '600', fontSize: 14, marginLeft: 6 },
  ctaWithdraw: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDD', paddingHorizontal: 16 },
  ctaWithdrawText: { color: '#555', fontWeight: '600', fontSize: 14 },
  ctaDeclined: { backgroundColor: '#F2F2F2' },
  ctaDeclinedText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },

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
  manageBtnDisabled: { opacity: 0.6 },

  packingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
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
