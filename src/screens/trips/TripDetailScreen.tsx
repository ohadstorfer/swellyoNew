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
  GroupPackingItem,
  GroupPackingClaim,
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
  setTripCommitment,
  setTripPackingList,
  setMyPackingList,
  setTripGroupPackingList,
  listTripGroupPackingClaims,
  claimGroupPackingItem,
  unclaimGroupPackingItem,
} from '../../services/trips/groupTripsService';
import ParticipantCard from '../../components/trips/ParticipantCard';
import PendingRequestCard from '../../components/trips/PendingRequestCard';
import TripParticipantsBreakdown from '../../components/trips/TripParticipantsBreakdown';
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

// ---------------------------------------------------------------------------
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
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
  const [togglingCommit, setTogglingCommit] = useState(false);
  const [editingPacking, setEditingPacking] = useState(false);
  const [packingDraft, setPackingDraft] = useState('');
  const [savingPacking, setSavingPacking] = useState(false);

  // Group packing list state
  const [packingView, setPackingView] = useState<'personal' | 'group'>('personal');
  const [groupClaims, setGroupClaims] = useState<GroupPackingClaim[]>([]);
  const [editingGroupPacking, setEditingGroupPacking] = useState(false);
  const [groupPackingDraft, setGroupPackingDraft] = useState<GroupPackingItem[]>([]);
  const [savingGroupPacking, setSavingGroupPacking] = useState(false);
  const [claimingItem, setClaimingItem] = useState<string | null>(null);

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
  const myCommitted = useMemo(
    () => !!participants.find(p => p.user_id === currentUserId)?.committed,
    [participants, currentUserId]
  );
  const myPackingList = useMemo<PackingItem[]>(
    () => participants.find(p => p.user_id === currentUserId)?.packing_list ?? [],
    [participants, currentUserId]
  );
  const claimsByItem = useMemo(() => {
    const m = new Map<string, GroupPackingClaim[]>();
    groupClaims.forEach(c => {
      const arr = m.get(c.item_name) ?? [];
      arr.push(c);
      m.set(c.item_name, arr);
    });
    return m;
  }, [groupClaims]);

  const loadAll = useCallback(async () => {
    const [tripData, participantsData, claimsData] = await Promise.all([
      getTripById(tripId),
      getTripParticipants(tripId),
      listTripGroupPackingClaims(tripId),
    ]);
    setTrip(tripData);
    setParticipants(participantsData);
    setGroupClaims(claimsData);

    if (currentUserId && tripData) {
      const userIsHost = tripData.host_id === currentUserId;
      if (userIsHost) {
        const pending = await listPendingRequests(tripId);
        setPendingRequests(pending);
        setMyRequest(null);
      } else {
        const req = await getMyJoinRequest(tripId, currentUserId);
        setMyRequest(req);
        setPendingRequests([]);
      }
    }
    setLoading(false);
  }, [tripId, currentUserId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const handleRequestToJoin = async () => {
    if (!currentUserId) return;
    setSubmitting(true);
    try {
      const newReq = await requestToJoinTrip(tripId, currentUserId);
      setMyRequest(newReq);
    } catch (e: any) {
      Alert.alert('Could not send request', e?.message || 'Please try again.');
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

  const handleToggleCommit = async () => {
    if (!currentUserId) return;
    const next = !myCommitted;
    // Optimistic flip
    setParticipants(prev => prev.map(p => (p.user_id === currentUserId ? { ...p, committed: next } : p)));
    setTogglingCommit(true);
    try {
      await setTripCommitment(tripId, currentUserId, next);
    } catch (e: any) {
      // Revert on failure
      setParticipants(prev => prev.map(p => (p.user_id === currentUserId ? { ...p, committed: !next } : p)));
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setTogglingCommit(false);
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

  const handleToggleGroupClaim = async (item: GroupPackingItem) => {
    if (!currentUserId) return;
    const claims = claimsByItem.get(item.name) ?? [];
    const myClaim = claims.find(c => c.user_id === currentUserId);
    const otherClaims = claims.filter(c => c.user_id !== currentUserId);

    // Single + already taken by someone else: button is disabled in the UI,
    // but guard here too in case a stale render slips through.
    if (item.single && !myClaim && otherClaims.length > 0) return;

    setClaimingItem(item.name);
    try {
      if (myClaim) {
        // Optimistic remove
        setGroupClaims(prev =>
          prev.filter(c => !(c.item_name === item.name && c.user_id === currentUserId))
        );
        try {
          await unclaimGroupPackingItem(tripId, currentUserId, item.name);
        } catch (e: any) {
          setGroupClaims(prev => [...prev, myClaim]);
          throw e;
        }
      } else {
        // Optimistic add — will be replaced by server name/avatar after refetch
        const myProfile = participants.find(p => p.user_id === currentUserId);
        const optimistic: GroupPackingClaim = {
          item_name: item.name,
          user_id: currentUserId,
          user_name: myProfile?.name ?? null,
          user_profile_image_url: myProfile?.profile_image_url ?? null,
        };
        setGroupClaims(prev => [...prev, optimistic]);
        try {
          await claimGroupPackingItem(tripId, currentUserId, item.name);
        } catch (e: any) {
          setGroupClaims(prev =>
            prev.filter(c => !(c.item_name === item.name && c.user_id === currentUserId))
          );
          throw e;
        }
      }
    } catch (e: any) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setClaimingItem(null);
    }
  };

  const handleStartEditGroupPacking = () => {
    if (!trip) return;
    setGroupPackingDraft((trip.group_packing_list ?? []).map(i => ({ ...i })));
    setEditingGroupPacking(true);
  };

  const handleCancelEditGroupPacking = () => {
    setEditingGroupPacking(false);
    setGroupPackingDraft([]);
  };

  const updateGroupDraftItem = (idx: number, patch: Partial<GroupPackingItem>) => {
    setGroupPackingDraft(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeGroupDraftItem = (idx: number) => {
    setGroupPackingDraft(prev => prev.filter((_, i) => i !== idx));
  };

  const addGroupDraftItem = () => {
    setGroupPackingDraft(prev => [...prev, { name: '', single: false }]);
  };

  const handleSaveGroupPacking = async () => {
    if (!trip) return;
    setSavingGroupPacking(true);
    try {
      await setTripGroupPackingList(tripId, groupPackingDraft);
      const [tripData, claimsData] = await Promise.all([
        getTripById(tripId),
        listTripGroupPackingClaims(tripId),
      ]);
      if (tripData) setTrip(tripData);
      setGroupClaims(claimsData);
      setEditingGroupPacking(false);
      setGroupPackingDraft([]);
    } catch (e: any) {
      Alert.alert('Could not save list', e?.message || 'Please try again.');
    } finally {
      setSavingGroupPacking(false);
    }
  };

  const handleSwitchPackingView = (next: 'personal' | 'group') => {
    // Defensive: cancel an open editor on the OTHER view to avoid a hidden draft.
    if (next !== packingView) {
      if (editingPacking) handleCancelEditPacking();
      if (editingGroupPacking) handleCancelEditGroupPacking();
    }
    setPackingView(next);
  };

  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <Header onBack={onBack} />
        <View style={styles.centered}>
          <ActivityIndicator color="#B72DF2" />
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

        {/* Hero */}
        {trip.hero_image_url ? (
          <Image source={{ uri: trip.hero_image_url }} style={styles.hero} />
        ) : (
          <View style={[styles.hero, styles.heroPlaceholder]}>
            <Ionicons name="image-outline" size={40} color="#B0B0B0" />
          </View>
        )}

        {/* Title & destination */}
        <View style={styles.titleBlock}>
          {!!trip.title && <Text style={styles.title}>{trip.title}</Text>}
          <Text style={styles.destination}>{formatDestination(trip)}</Text>
          <Text style={styles.dates}>{formatDates(trip)}</Text>
          {trip.host_been_there !== null && (
            <Text style={styles.dates}>
              {trip.host_been_there ? 'Host has been here before' : 'Host hasn’t been here yet'}
            </Text>
          )}
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

        {/* Group chat (local mode preview) — host always sees it; approved members see it after approval */}
        {IS_LOCAL_MODE && (isHost || isApprovedMember) && (
          <View style={styles.chatButtonWrapper}>
            <TouchableOpacity
              style={styles.chatButton}
              onPress={handleOpenGroupChat}
              disabled={openingChat}
              activeOpacity={0.8}
            >
              {openingChat ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="chatbubbles-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.chatButtonText}>Open group chat</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
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

        {/* Packing list — Personal (per-user done state) and Group (claim-able items) */}
        {(((trip.packing_list && trip.packing_list.length > 0) ||
           (trip.group_packing_list && trip.group_packing_list.length > 0) ||
           (isHost && !isCancelled))) && (
          <View style={styles.section}>
            <View style={styles.packingHeader}>
              <Text style={styles.sectionTitle}>Packing list</Text>
              {isHost && !isCancelled && !editingPacking && !editingGroupPacking && (
                <TouchableOpacity
                  onPress={packingView === 'personal' ? handleStartEditPacking : handleStartEditGroupPacking}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel={`Edit ${packingView} packing list`}
                >
                  <Ionicons name="create-outline" size={18} color="#7B7B7B" />
                </TouchableOpacity>
              )}
            </View>

            {/* View toggle */}
            <View style={styles.packingToggleRow}>
              {(['personal', 'group'] as const).map(v => {
                const active = packingView === v;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.packingToggleChip, active && styles.packingToggleChipActive]}
                    onPress={() => handleSwitchPackingView(v)}
                  >
                    <Text style={[styles.packingToggleText, active && styles.packingToggleTextActive]}>
                      {v === 'personal' ? 'Personal' : 'Group'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* PERSONAL VIEW */}
            {packingView === 'personal' && (
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
              ) : trip.packing_list && trip.packing_list.length > 0 ? (
                <>
                  {(isHost || isApprovedMember) ? (
                    <Text style={styles.muted}>Tap an item to mark it done.</Text>
                  ) : null}
                  {trip.packing_list.map(name => {
                    const myItem = myPackingList.find(it => it.name === name);
                    const done = !!myItem?.done;
                    const canToggle = !!currentUserId && (isHost || isApprovedMember) && !isCancelled;
                    return (
                      <TouchableOpacity
                        key={name}
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
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : (
                <Text style={styles.muted}>
                  {isHost ? 'No items yet — tap the pencil to add some.' : 'No items yet.'}
                </Text>
              )
            )}

            {/* GROUP VIEW */}
            {packingView === 'group' && (
              editingGroupPacking ? (
                <>
                  <Text style={styles.muted}>
                    One row per item. Toggle Single/Multi to control whether multiple users can claim it.
                  </Text>
                  {groupPackingDraft.map((it, idx) => (
                    <View key={idx} style={styles.groupEditRow}>
                      <TextInput
                        style={[styles.groupEditInput, { flex: 1 }]}
                        value={it.name}
                        onChangeText={t => updateGroupDraftItem(idx, { name: t })}
                        placeholder="e.g. tent, snacks, first aid kit"
                        placeholderTextColor="#B0B0B0"
                        editable={!savingGroupPacking}
                      />
                      <TouchableOpacity
                        style={[styles.singleMultiChip, it.single && styles.singleMultiChipActive]}
                        onPress={() => updateGroupDraftItem(idx, { single: !it.single })}
                        disabled={savingGroupPacking}
                      >
                        <Text style={[styles.singleMultiText, it.single && styles.singleMultiTextActive]}>
                          {it.single ? 'Single' : 'Multi'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => removeGroupDraftItem(idx)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        disabled={savingGroupPacking}
                        accessibilityLabel={`Remove ${it.name || 'item'}`}
                      >
                        <Ionicons name="trash-outline" size={20} color="#C0392B" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.addItemBtn}
                    onPress={addGroupDraftItem}
                    disabled={savingGroupPacking}
                  >
                    <Ionicons name="add-circle-outline" size={18} color="#B72DF2" />
                    <Text style={styles.addItemText}>Add item</Text>
                  </TouchableOpacity>
                  <View style={styles.packingActions}>
                    <TouchableOpacity
                      style={styles.packingCancel}
                      onPress={handleCancelEditGroupPacking}
                      disabled={savingGroupPacking}
                    >
                      <Text style={styles.packingCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.packingSave, savingGroupPacking && styles.manageBtnDisabled]}
                      onPress={handleSaveGroupPacking}
                      disabled={savingGroupPacking}
                    >
                      {savingGroupPacking ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.packingSaveText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : trip.group_packing_list && trip.group_packing_list.length > 0 ? (
                <>
                  {(isHost || isApprovedMember) ? (
                    <Text style={styles.muted}>Tap to claim. Single = one person; Multi = anyone.</Text>
                  ) : null}
                  {trip.group_packing_list.map(item => {
                    const claims = claimsByItem.get(item.name) ?? [];
                    const myClaim = claims.find(c => c.user_id === currentUserId);
                    const otherClaims = claims.filter(c => c.user_id !== currentUserId);
                    // Strikethrough rules:
                    // - Single: any claim → strike for everyone.
                    // - Multi: only strike for users who claimed it themselves.
                    const struck = item.single ? claims.length > 0 : !!myClaim;
                    const lockedSingle = item.single && !myClaim && otherClaims.length > 0;
                    const canToggle =
                      !!currentUserId && (isHost || isApprovedMember) && !isCancelled && !lockedSingle;
                    const busy = claimingItem === item.name;
                    return (
                      <TouchableOpacity
                        key={item.name}
                        style={styles.packingRow}
                        onPress={() => canToggle && !busy && handleToggleGroupClaim(item)}
                        disabled={!canToggle || busy}
                        activeOpacity={canToggle ? 0.6 : 1}
                      >
                        <Ionicons
                          name={struck ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={struck ? '#34C759' : '#B0B0B0'}
                        />
                        <Text style={[styles.packingItemText, struck && styles.packingItemTextDone]}>
                          {item.name}
                        </Text>
                        <View style={[styles.singleMultiChipSmall, item.single && styles.singleMultiChipSmallActive]}>
                          <Text style={[styles.singleMultiTextSmall, item.single && styles.singleMultiTextActive]}>
                            {item.single ? 'Single' : 'Multi'}
                          </Text>
                        </View>
                        {claims.length > 0 && (
                          <View style={styles.avatarStack}>
                            {claims.slice(0, 3).map(c => (
                              <View key={c.user_id} style={styles.avatarSmallWrap}>
                                {c.user_profile_image_url ? (
                                  <Image
                                    source={{ uri: c.user_profile_image_url }}
                                    style={styles.avatarSmall}
                                  />
                                ) : (
                                  <View style={[styles.avatarSmall, styles.avatarSmallPlaceholder]}>
                                    <Text style={styles.avatarSmallInitial}>
                                      {(c.user_name || 'U').charAt(0).toUpperCase()}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            ))}
                            {claims.length > 3 && (
                              <Text style={styles.avatarMoreText}>+{claims.length - 3}</Text>
                            )}
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : (
                <Text style={styles.muted}>
                  {isHost ? 'No group items yet — tap the pencil to add some.' : 'No group items yet.'}
                </Text>
              )
            )}
          </View>
        )}

        {/* Commitment toggle — visible to host + approved members on active trips */}
        {(isHost || isApprovedMember) && !isCancelled && (
          <View style={styles.commitWrapper}>
            <TouchableOpacity
              style={[styles.commitBtn, myCommitted && styles.commitBtnActive, togglingCommit && styles.manageBtnDisabled]}
              onPress={handleToggleCommit}
              disabled={togglingCommit}
              activeOpacity={0.85}
            >
              {togglingCommit ? (
                <ActivityIndicator color={myCommitted ? '#FFFFFF' : '#34C759'} />
              ) : (
                <>
                  <Ionicons
                    name={myCommitted ? 'checkmark-circle' : 'checkmark-circle-outline'}
                    size={18}
                    color={myCommitted ? '#FFFFFF' : '#34C759'}
                  />
                  <Text style={[styles.commitBtnText, myCommitted && styles.commitBtnTextActive]}>
                    {myCommitted ? "I'm committed" : "I'm in — mark me committed"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Participants */}
        <Section title={`Participants (${participants.length})`}>
          {participants.length === 0 ? (
            <Text style={styles.muted}>No participants yet.</Text>
          ) : (
            participants.map(p => (
              <ParticipantCard
                key={p.user_id}
                participant={p}
                onRemove={
                  isHost && !isCancelled && p.role !== 'host' && removingUserId !== p.user_id
                    ? handleRemoveParticipant
                    : undefined
                }
              />
            ))
          )}
        </Section>

        {/* Group breakdown — only when there's at least one member besides the host */}
        {hasNonHostMembers && (
          <Section title="Group breakdown">
            <TripParticipantsBreakdown participants={participants} />
          </Section>
        )}

        {/* Manage trip (host only, while active) */}
        {isHost && !isCancelled && (
          <Section title="Manage trip">
            <TouchableOpacity
              style={[styles.manageBtn, styles.manageBtnDanger, cancelling && styles.manageBtnDisabled]}
              onPress={handleCancelTrip}
              disabled={cancelling}
              activeOpacity={0.8}
            >
              {cancelling ? (
                <ActivityIndicator color="#C0392B" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={18} color="#C0392B" />
                  <Text style={styles.manageBtnDangerText}>Cancel trip</Text>
                </>
              )}
            </TouchableOpacity>
          </Section>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Sticky CTA — hidden for the host and for cancelled trips */}
      {!isHost && !isCancelled && (
        <View style={styles.cta}>
          <CtaButton
            isApprovedMember={isApprovedMember}
            myRequest={myRequest}
            submitting={submitting}
            leaving={leaving}
            onRequest={handleRequestToJoin}
            onWithdraw={handleWithdraw}
            onLeave={handleLeaveTrip}
          />
        </View>
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
      <Ionicons name="chevron-back" size={28} color="#222B30" />
    </TouchableOpacity>
    <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Trip'}</Text>
    <View style={styles.headerRight}>{rightAction}</View>
  </View>
);

const CtaButton: React.FC<{
  isApprovedMember: boolean;
  myRequest: GroupTripJoinRequest | null;
  submitting: boolean;
  leaving: boolean;
  onRequest: () => void;
  onWithdraw: () => void;
  onLeave: () => void;
}> = ({ isApprovedMember, myRequest, submitting, leaving, onRequest, onWithdraw, onLeave }) => {
  if (isApprovedMember || myRequest?.status === 'approved') {
    return (
      <View style={styles.ctaJoinedRow}>
        <View style={[styles.ctaBtn, styles.ctaJoined, { flex: 1 }]}>
          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
          <Text style={styles.ctaJoinedText}>Joined</Text>
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, styles.ctaLeave]}
          onPress={onLeave}
          disabled={leaving}
          activeOpacity={0.7}
        >
          {leaving ? (
            <ActivityIndicator color="#C0392B" />
          ) : (
            <Text style={styles.ctaLeaveText}>Leave</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }
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
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#7B7B7B' },

  scrollContent: { paddingBottom: 24 },
  hero: { width: '100%', height: 220, backgroundColor: '#F2F2F2' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },

  titleBlock: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#222B30',
    marginBottom: 6,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  destination: { fontSize: 15, color: '#555', marginBottom: 2 },
  dates: { fontSize: 13, color: '#7B7B7B' },

  section: { paddingHorizontal: 16, paddingTop: 36 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222B30',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  body: { fontSize: 14, color: '#333', lineHeight: 20 },
  muted: { fontSize: 13, color: '#7B7B7B' },

  infoRow: { flexDirection: 'row', paddingVertical: 6 },
  infoLabel: { width: 110, fontSize: 13, color: '#7B7B7B' },
  infoValue: { flex: 1, fontSize: 13, color: '#222B30' },

  // Sticky CTA
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
  ctaPrimary: { backgroundColor: '#B72DF2' },
  ctaPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  ctaJoined: { backgroundColor: '#34C759' },
  ctaJoinedText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginLeft: 6 },
  ctaPendingRow: { flexDirection: 'row', gap: 10 },
  ctaPending: { backgroundColor: '#F2F2F2' },
  ctaPendingText: { color: '#555', fontWeight: '600', fontSize: 14, marginLeft: 6 },
  ctaWithdraw: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDD', paddingHorizontal: 16 },
  ctaWithdrawText: { color: '#555', fontWeight: '600', fontSize: 14 },
  ctaDeclined: { backgroundColor: '#F2F2F2' },
  ctaDeclinedText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },

  headerRight: { width: 28, alignItems: 'flex-end' },
  cancelledBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FDECEA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cancelledText: { color: '#C0392B', fontSize: 13, fontWeight: '500', flex: 1 },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  manageBtnDanger: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C0392B',
  },
  manageBtnDangerText: { color: '#C0392B', fontWeight: '600', fontSize: 14 },
  manageBtnDisabled: { opacity: 0.6 },
  ctaJoinedRow: { flexDirection: 'row', gap: 10 },
  ctaLeave: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C0392B',
    paddingHorizontal: 18,
  },
  ctaLeaveText: { color: '#C0392B', fontWeight: '600', fontSize: 14 },
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
    borderColor: '#B72DF2',
    backgroundColor: '#F4E6FB',
  },
  packingToggleText: { fontSize: 13, fontWeight: '600', color: '#7B7B7B' },
  packingToggleTextActive: { color: '#B72DF2' },
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
    borderColor: '#B72DF2',
    backgroundColor: '#F4E6FB',
  },
  singleMultiText: { fontSize: 12, fontWeight: '600', color: '#7B7B7B' },
  singleMultiTextActive: { color: '#B72DF2' },
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
    borderColor: '#B72DF2',
    backgroundColor: '#F4E6FB',
  },
  singleMultiTextSmall: { fontSize: 11, fontWeight: '600', color: '#7B7B7B' },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  addItemText: { color: '#B72DF2', fontWeight: '600', fontSize: 13 },
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
    backgroundColor: '#B72DF2',
    alignItems: 'center',
  },
  packingSaveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  commitWrapper: { paddingHorizontal: 16, paddingTop: 24 },
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
  chatButtonWrapper: { paddingHorizontal: 16, paddingTop: 16 },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222B30',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  chatButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
});
