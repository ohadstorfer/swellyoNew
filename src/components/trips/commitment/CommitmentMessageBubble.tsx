import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CommitmentMetadata } from '../../../services/messaging/messagingService';
import { CommitmentConfirmModal } from './CommitmentConfirmModal';

const ITEM_LABELS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  flight_booked: { label: 'Flight booked', icon: 'airplane-outline' },
  insurance_sorted: { label: 'Insurance sorted', icon: 'shield-checkmark-outline' },
  something_else: { label: 'Something else', icon: 'ellipsis-horizontal' },
};

interface Props {
  metadata: CommitmentMetadata;
  /** Name to show in the system line above the bubble ("X requested to be Committed"). */
  senderName?: string | null;
  /** True when current viewer is the sender (member) — used for alignment. */
  isOwn?: boolean;
  /** Provided only when viewer is the host moderating this DM. When both
   *  callbacks are supplied and status is 'pending', Approve/Reject buttons
   *  render inline on the bubble. Approve opens a confirm modal first; Reject
   *  fires immediately. */
  onApprove?: () => Promise<void>;
  onDecline?: () => Promise<void>;
}

export const CommitmentMessageBubble: React.FC<Props> = ({
  metadata,
  senderName,
  isOwn,
  onApprove,
  onDecline,
}) => {
  const items = metadata.items ?? [];
  const note = metadata.note ?? '';
  const status = metadata.status ?? 'pending';
  const safeName = (senderName ?? '').trim() || 'Someone';

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'approve' | 'decline'>(null);

  const canModerate = !isOwn && status === 'pending' && !!onApprove && !!onDecline;

  const handleApprove = async () => {
    if (busy || !onApprove) return;
    setBusy('approve');
    try {
      await onApprove();
      setConfirmOpen(false);
    } catch (e: any) {
      Alert.alert('Could not approve', e?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const handleDecline = async () => {
    if (busy || !onDecline) return;
    setBusy('decline');
    try {
      await onDecline();
    } catch (e: any) {
      Alert.alert('Could not reject', e?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.wrap, isOwn ? styles.wrapRight : styles.wrapLeft]}>
      <View style={styles.systemChip}>
        <Text style={styles.systemChipText}>
          {safeName} requested to be Committed
        </Text>
      </View>

      <View style={[styles.bubble, isOwn && styles.bubbleOwn]}>
        {items.length === 0 ? (
          <Text style={[styles.itemLabel, isOwn && styles.itemLabelOwn]}>Committing to the trip</Text>
        ) : (
          items.map((key) => {
            const cfg = ITEM_LABELS[key] ?? { label: key, icon: 'checkmark-outline' as const };
            return (
              <View key={key} style={styles.itemRow}>
                <Ionicons
                  name={cfg.icon}
                  size={15}
                  color={isOwn ? '#FFFFFF' : '#0788B0'}
                />
                <Text style={[styles.itemLabel, isOwn && styles.itemLabelOwn]}>{cfg.label}</Text>
              </View>
            );
          })
        )}
        {note ? (
          <Text style={[styles.note, isOwn && styles.noteOwn]} numberOfLines={6}>
            {note}
          </Text>
        ) : null}

        {status === 'approved' ? (
          <View style={styles.approvedRow}>
            <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
            <Text style={styles.approvedText}>Approved</Text>
          </View>
        ) : status === 'declined' ? (
          <View style={styles.approvedRow}>
            <Ionicons name="close-circle" size={14} color="#DC2626" />
            <Text style={styles.declinedText}>Declined</Text>
          </View>
        ) : status === 'superseded' ? (
          <Text style={[styles.statusMuted, isOwn && styles.statusMutedOwn]}>
            Replaced by a newer submission
          </Text>
        ) : null}

        {canModerate ? (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.btnReject, busy !== null && styles.btnDisabled]}
              onPress={handleDecline}
              disabled={busy !== null}
              activeOpacity={0.85}
            >
              {busy === 'decline' ? (
                <ActivityIndicator color="#DC2626" size="small" />
              ) : (
                <Text style={styles.btnRejectText}>Reject</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnApprove, busy !== null && styles.btnDisabled]}
              onPress={() => setConfirmOpen(true)}
              disabled={busy !== null}
              activeOpacity={0.85}
            >
              {busy === 'approve' ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.btnApproveText}>Approve</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {canModerate ? (
        <CommitmentConfirmModal
          visible={confirmOpen}
          requesterName={safeName}
          onCancel={() => {
            if (busy === 'approve') return;
            setConfirmOpen(false);
          }}
          onApprove={handleApprove}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginVertical: 6,
    maxWidth: '85%',
  },
  wrapLeft: { alignSelf: 'flex-start' },
  wrapRight: { alignSelf: 'flex-end' },
  systemChip: {
    alignSelf: 'center',
    backgroundColor: '#F1F3F4',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 6,
  },
  systemChipText: { fontSize: 11.5, color: '#4A5565', fontWeight: '500' },
  bubble: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  bubbleOwn: {
    backgroundColor: '#0788B0',
    borderColor: '#0788B0',
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemLabel: { fontSize: 14, color: '#222B30' },
  itemLabelOwn: { color: '#FFFFFF' },
  note: {
    fontSize: 13,
    color: '#4A5565',
    marginTop: 4,
    fontStyle: 'italic',
  },
  noteOwn: { color: '#E5F3F8' },
  approvedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  approvedText: { fontSize: 12, color: '#16A34A', fontWeight: '600' },
  declinedText: { fontSize: 12, color: '#DC2626', fontWeight: '600' },
  statusMuted: { fontSize: 11.5, color: '#9AA0A6', marginTop: 4 },
  statusMutedOwn: { color: '#CBE3EC' },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  btnReject: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  btnRejectText: { color: '#DC2626', fontWeight: '600', fontSize: 13 },
  btnApprove: {
    flex: 1,
    backgroundColor: '#0788B0',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  btnApproveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
});
