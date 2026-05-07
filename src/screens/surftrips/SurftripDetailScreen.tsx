import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
  Modal,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../../components/Text';
import { SurftripParticipantRow } from '../../components/surftrips/SurftripParticipantRow';
import { PendingSurftripRequestCard } from '../../components/surftrips/PendingSurftripRequestCard';
import { ParticipantMenuSheet } from '../../components/surftrips/ParticipantMenuSheet';
import { CreateSurftripModal } from '../../components/surftrips/CreateSurftripModal';
import { AddMembersSheet } from '../../components/surftrips/AddMembersSheet';
import {
  addMembersFromDms,
  approveRequest,
  declineRequest,
  deleteSurftripGroup,
  demoteToMember,
  getMyRequest,
  getSurftripGroup,
  getSurftripInviteUrl,
  leaveGroup,
  listAddableDmPartners,
  listMembers,
  listPendingRequests,
  promoteToAdmin,
  removeMember,
  requestToJoin,
  withdrawRequest,
} from '../../services/surftrips/surftripsService';
import type {
  EnrichedSurftripMember,
  EnrichedSurftripRequest,
  SurftripGroup,
  SurftripJoinRequest,
  SurftripRole,
} from '../../types/surftrips';

interface SurftripDetailScreenProps {
  groupId: string;
  currentUserId: string | null;
  onBack: () => void;
  onOpenChat: (conversationId: string, title: string) => void;
}

export default function SurftripDetailScreen({
  groupId,
  currentUserId,
  onBack,
}: SurftripDetailScreenProps) {
  const [group, setGroup] = useState<SurftripGroup | null>(null);
  const [members, setMembers] = useState<EnrichedSurftripMember[]>([]);
  const [pendingRequests, setPendingRequests] = useState<EnrichedSurftripRequest[]>([]);
  const [myRequest, setMyRequest] = useState<SurftripJoinRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<EnrichedSurftripMember | null>(null);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestNote, setRequestNote] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);

  const myMember = useMemo(
    () => (currentUserId ? members.find(m => m.user_id === currentUserId) : null) || null,
    [members, currentUserId]
  );
  const myRole: SurftripRole | null = myMember?.role ?? null;
  const isMember = !!myMember;
  const isHost = myRole === 'host';
  const isAdmin = myRole === 'admin';
  const canManage = isHost || isAdmin;

  const load = useCallback(async () => {
    try {
      const g = await getSurftripGroup(groupId);
      setGroup(g);
      const [ms, prs, mine] = await Promise.all([
        listMembers(groupId),
        listPendingRequests(groupId),
        currentUserId ? getMyRequest(groupId, currentUserId) : Promise.resolve(null),
      ]);
      setMembers(ms);
      setPendingRequests(prs);
      setMyRequest(mine);
    } finally {
      setLoading(false);
    }
  }, [groupId, currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- Join / leave / request -------------------------------------------------

  const handleRequestToJoin = async () => {
    if (!currentUserId) return;
    setShowRequestModal(false);
    setSubmitting(true);
    try {
      const note = requestNote.trim();
      await requestToJoin(groupId, currentUserId, note || undefined);
      setRequestNote('');
      await load();
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
      await withdrawRequest(myRequest.id);
      await load();
    } catch (e: any) {
      Alert.alert('Could not withdraw', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLeave = () => {
    if (!currentUserId) return;
    Alert.alert(
      'Leave surftrip?',
      'You will lose access to the group chat. You can request to join again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              await leaveGroup(groupId, currentUserId);
              onBack();
            } catch (e: any) {
              Alert.alert('Could not leave', e?.message || 'Please try again.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const handleShareInvite = async () => {
    if (!group) return;
    let url: string;
    try {
      url = await getSurftripInviteUrl(group.id);
    } catch (e: any) {
      Alert.alert('Could not create invite link', e?.message || 'Please try again.');
      return;
    }
    const message = `Join "${group.name}" on Swellyo: ${url}`;

    try {
      if (Platform.OS === 'web') {
        const nav = (typeof navigator !== 'undefined' ? navigator : null) as
          | (Navigator & { share?: (data: any) => Promise<void> })
          | null;
        if (nav && typeof nav.share === 'function') {
          await nav.share({ title: group.name, text: message, url });
          return;
        }
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(url);
          Alert.alert('Link copied', 'Invite link copied to clipboard.');
          return;
        }
        Alert.alert('Invite link', url);
        return;
      }

      await Share.share({ message, url });
    } catch (e) {
      // User cancelled — silent. Other errors → log.
      console.warn('[SurftripDetailScreen] share failed:', e);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete surftrip?',
      'This deletes the group and the chat for everyone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSurftripGroup(groupId);
              onBack();
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  // ---- Approval actions -------------------------------------------------------

  const handleApprove = async (requestId: string) => {
    setProcessingRequestId(requestId);
    try {
      await approveRequest(requestId);
      await load();
    } catch (e: any) {
      Alert.alert('Could not approve', e?.message || 'Please try again.');
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleDecline = async (requestId: string) => {
    setProcessingRequestId(requestId);
    try {
      await declineRequest(requestId);
      await load();
    } catch (e: any) {
      Alert.alert('Could not decline', e?.message || 'Please try again.');
    } finally {
      setProcessingRequestId(null);
    }
  };

  // ---- Member admin actions ---------------------------------------------------

  const handlePromote = async (userId: string) => {
    try {
      await promoteToAdmin(groupId, userId);
      await load();
    } catch (e: any) {
      Alert.alert('Could not promote', e?.message || 'Please try again.');
    }
  };

  const handleDemote = async (userId: string) => {
    try {
      await demoteToMember(groupId, userId);
      await load();
    } catch (e: any) {
      Alert.alert('Could not change role', e?.message || 'Please try again.');
    }
  };

  const handleRemove = async (userId: string) => {
    Alert.alert(
      'Remove member?',
      'They will lose access to the group chat.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeMember(groupId, userId);
              await load();
            } catch (e: any) {
              Alert.alert('Could not remove', e?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  // ---- Render -----------------------------------------------------------------

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <FallbackHeader onBack={onBack} />
        <View style={styles.center}>
          <ActivityIndicator color="#0788B0" />
        </View>
      </SafeAreaView>
    );
  }
  if (!group) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <FallbackHeader onBack={onBack} title="Not found" />
        <View style={styles.center}>
          <Text style={styles.helper}>This surftrip is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const showPendingSection = canManage && pendingRequests.length > 0;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero with floating header overlay + circular avatar overlapping bottom edge */}
        <View style={styles.heroContainer}>
          {group.hero_image_url ? (
            <Image source={{ uri: group.hero_image_url }} style={styles.hero} />
          ) : (
            <View style={[styles.hero, styles.heroPlaceholder]}>
              <Ionicons name="image-outline" size={36} color="#FFFFFF" />
            </View>
          )}

          {/* Bottom gradient for legibility behind title overlay */}
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']}
            locations={[0, 1]}
            style={styles.heroGradient}
            pointerEvents="none"
          />

          {/* Title + meta overlaid on bottom of hero */}
          <View style={styles.heroOverlay} pointerEvents="none">
            <Text style={styles.heroTitle} numberOfLines={2}>
              {group.name}
            </Text>
            <View style={styles.heroMetaRow}>
              <Ionicons name="people-outline" size={13} color="rgba(255,255,255,0.9)" />
              <Text style={styles.heroMetaText}>
                {members.length === 1 ? '1 member' : `${members.length} members`}
              </Text>
            </View>
          </View>

          <SafeAreaView edges={['top']} style={styles.floatingHeader} pointerEvents="box-none">
            <View style={styles.floatingHeaderRow}>
              <TouchableOpacity
                style={styles.headerOrb}
                onPress={onBack}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.floatingHeaderActions}>
                {canManage ? (
                  <TouchableOpacity
                    style={styles.headerOrb}
                    onPress={() => setShowEditModal(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Edit surftrip"
                  >
                    <Ionicons name="create-outline" size={20} color="#FFFFFF" />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </SafeAreaView>

        </View>

        {/* About — iOS grouped: label outside, rounded white card body */}
        {group.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>About</Text>
            <View style={styles.sectionBody}>
              <Text style={styles.description}>{group.description}</Text>
            </View>
          </View>
        ) : null}

        {/* Pending requests (admin/host only) */}
        {showPendingSection ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Requests to join · {pendingRequests.length}
            </Text>
            <View style={styles.sectionBody}>
              {pendingRequests.map(r => (
                <PendingSurftripRequestCard
                  key={r.id}
                  request={r}
                  onApprove={handleApprove}
                  onDecline={handleDecline}
                  isProcessing={processingRequestId === r.id}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Members — rounded card, hairline dividers between rows */}
        <View style={styles.section}>
          <View style={styles.membersHeader}>
            <Text style={styles.sectionLabel}>Members</Text>
            {canManage && group.max_members > members.length ? (
              <TouchableOpacity
                style={styles.addMembersBtn}
                onPress={() => setShowAddMembers(true)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityLabel="Add members from your chats"
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={16} color="#0788B0" />
                <Text style={styles.addMembersBtnText}>Add</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.sectionBody}>
            {members.map((m, idx) => (
              <View key={m.user_id}>
                <SurftripParticipantRow
                  participant={m}
                  isMe={m.user_id === currentUserId}
                  onMenuPress={
                    canManage && m.user_id !== currentUserId
                      ? (p) => setMenuTarget(p)
                      : undefined
                  }
                />
                {idx < members.length - 1 && <View style={styles.memberDivider} />}
              </View>
            ))}
          </View>
        </View>

        {/* Destructive — left-aligned red text in a rounded card */}
        {isMember && (
          <View style={styles.destructiveCard}>
            <TouchableOpacity
              style={styles.destructiveLink}
              onPress={handleLeave}
              activeOpacity={0.6}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FF3B30" />
              ) : (
                <Text style={styles.destructiveText}>Leave group</Text>
              )}
            </TouchableOpacity>
            {isHost && (
              <TouchableOpacity
                style={[styles.destructiveLink, styles.destructiveLinkDivider]}
                onPress={handleDelete}
                activeOpacity={0.6}
              >
                <Text style={styles.destructiveText}>Delete group</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Sticky CTA — only for non-members in the join flow */}
      {!isMember && (
        <View style={styles.ctaBar}>
          <CtaButton
            myRequest={myRequest}
            submitting={submitting}
            onRequest={() => setShowRequestModal(true)}
            onWithdraw={handleWithdraw}
          />
        </View>
      )}

      <ParticipantMenuSheet
        visible={!!menuTarget}
        participant={menuTarget}
        viewerRole={myRole}
        onClose={() => setMenuTarget(null)}
        onPromoteToAdmin={handlePromote}
        onDemoteToMember={handleDemote}
        onRemoveMember={handleRemove}
      />

      <CreateSurftripModal
        visible={showEditModal}
        currentUserId={currentUserId}
        initialGroup={group}
        onClose={() => setShowEditModal(false)}
        onUpdated={(updated) => {
          setShowEditModal(false);
          setGroup(updated);
        }}
      />

      <AddMembersSheet
        visible={showAddMembers}
        loadPartners={() => listAddableDmPartners(groupId)}
        commitSelection={(ids) => addMembersFromDms(groupId, ids)}
        remainingSlots={Math.max(0, group.max_members - members.length)}
        onClose={() => setShowAddMembers(false)}
        onCommitted={(applied) => {
          setShowAddMembers(false);
          if (applied.length > 0) {
            // Refresh members list (and pending requests, in case added users had pending rows).
            load();
          }
        }}
      />

      <Modal
        visible={showRequestModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRequestModal(false)}
      >
        <View style={styles.requestBackdrop}>
          <View style={styles.requestSheet}>
            <Text style={styles.requestTitle}>Request to join</Text>
            <Text style={styles.requestHelper}>
              Add a short note for the host (optional).
            </Text>
            <TextInput
              value={requestNote}
              onChangeText={setRequestNote}
              placeholder="Hey! I'd love to join this trip…"
              placeholderTextColor="#9AA3A8"
              style={styles.requestInput}
              multiline
              maxLength={300}
              autoFocus
            />
            <View style={styles.requestActions}>
              <TouchableOpacity
                style={[styles.requestBtn, styles.requestCancel]}
                onPress={() => setShowRequestModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.requestCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.requestBtn, styles.requestSubmit]}
                onPress={handleRequestToJoin}
                activeOpacity={0.85}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.requestSubmitText}>Send request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------

const FallbackHeader: React.FC<{ onBack: () => void; title?: string }> = ({ onBack, title }) => (
  <View style={styles.fallbackHeader}>
    <TouchableOpacity
      onPress={onBack}
      style={styles.backBtn}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="chevron-back" size={28} color="#222B30" />
    </TouchableOpacity>
    {title ? <Text style={styles.fallbackHeaderTitle} numberOfLines={1}>{title}</Text> : null}
  </View>
);

const CtaButton: React.FC<{
  myRequest: SurftripJoinRequest | null;
  submitting: boolean;
  onRequest: () => void;
  onWithdraw: () => void;
}> = ({ myRequest, submitting, onRequest, onWithdraw }) => {
  if (myRequest?.status === 'pending') {
    return (
      <View style={styles.ctaRow}>
        <View style={[styles.ctaBtn, styles.ctaPending, { flex: 1 }]}>
          <Ionicons name="time-outline" size={18} color="#555" />
          <Text style={styles.ctaPendingText}>Request pending</Text>
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, styles.ctaSecondary]}
          onPress={onWithdraw}
          activeOpacity={0.7}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#7B7B7B" />
          ) : (
            <Text style={styles.ctaWithdrawText}>Withdraw</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }
  if (myRequest?.status === 'declined') {
    return (
      <View style={styles.ctaColumn}>
        <View style={[styles.ctaBtn, styles.ctaDeclined]}>
          <Text style={styles.ctaDeclinedText}>Request declined</Text>
        </View>
        <TouchableOpacity
          style={[styles.ctaBtn, styles.ctaPrimary]}
          onPress={onRequest}
          activeOpacity={0.85}
          disabled={submitting}
        >
          <Text style={styles.ctaPrimaryText}>Request again</Text>
        </TouchableOpacity>
      </View>
    );
  }
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
        <>
          <Ionicons name="paper-plane-outline" size={18} color="#FFFFFF" />
          <Text style={styles.ctaPrimaryText}>Request to join</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F0F2F5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  helper: { fontSize: 14, color: '#7B7B7B' },

  // Fallback header (loading / not-found states only)
  fallbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  backBtn: { padding: 6 },
  fallbackHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#222B30',
    marginLeft: 4,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },

  body: { paddingBottom: 40 },

  // Hero + floating header overlay + circular avatar overlap
  heroContainer: {
    position: 'relative',
    backgroundColor: '#F4F4F4',
  },
  hero: {
    width: '100%',
    aspectRatio: 16 / 10,
    backgroundColor: '#F4F4F4',
  },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#A8DDE0' },

  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  floatingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  floatingHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  headerOrb: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  description: {
    fontSize: 15,
    color: '#222B30',
    lineHeight: 21,
  },

  // Title + meta overlaid on the bottom of the hero (with gradient for legibility)
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },
  heroOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
    ...(Platform.OS === 'web' ? { fontFamily: 'Montserrat, sans-serif' } : {}),
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  heroMetaText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.92)',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Sticky CTA (join flow only) at the bottom of the screen
  ctaBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EEE',
  },
  ctaRow: { flexDirection: 'row', gap: 10 },
  ctaColumn: { gap: 10 },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    minHeight: 46,
  },
  ctaPrimary: { backgroundColor: '#0788B0' },
  ctaPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  ctaSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E1E1E1',
    paddingHorizontal: 18,
  },
  ctaSecondaryText: { color: '#7B7B7B', fontWeight: '700', fontSize: 14 },
  ctaPending: { backgroundColor: '#F2F2F2' },
  ctaPendingText: { color: '#555', fontWeight: '600' },
  ctaWithdrawText: { color: '#7B7B7B', fontWeight: '600', fontSize: 14 },
  ctaDeclined: { backgroundColor: '#FBECEC' },
  ctaDeclinedText: { color: '#C0392B', fontWeight: '600' },

  // iOS-grouped sections: small label outside + rounded white card body
  section: {
    marginTop: 26,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#7B7B7B',
    paddingHorizontal: 32,
    marginBottom: 6,
  },
  membersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 32,
  },
  addMembersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 6,
  },
  addMembersBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0788B0',
  },
  sectionBody: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    overflow: 'hidden',
  },
  memberDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ECECEC',
    marginLeft: 60,
  },

  // Destructive — left-aligned red text in a rounded white card
  destructiveCard: {
    backgroundColor: '#FFFFFF',
    marginTop: 26,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  destructiveLink: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  destructiveLinkDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ECECEC',
  },
  destructiveText: { color: '#FF3B30', fontSize: 16, fontWeight: '400' },

  // Request modal
  requestBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  requestSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 10,
  },
  requestTitle: { fontSize: 17, fontWeight: '700', color: '#222B30' },
  requestHelper: { fontSize: 13, color: '#7B7B7B' },
  requestInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: '#E1E1E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    fontSize: 15,
    color: '#222B30',
    textAlignVertical: 'top',
  },
  requestActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  requestBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestCancel: { backgroundColor: '#F2F2F2' },
  requestCancelText: { color: '#222B30', fontWeight: '600' },
  requestSubmit: { backgroundColor: '#0788B0' },
  requestSubmitText: { color: '#FFFFFF', fontWeight: '700' },
});
