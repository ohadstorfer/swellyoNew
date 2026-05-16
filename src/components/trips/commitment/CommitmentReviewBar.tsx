import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CommitmentConfirmModal } from './CommitmentConfirmModal';
import type { PendingCommitmentToReview } from '../../../services/trips/groupTripsService';

interface Props {
  /** Pending requests from this DM partner that the host can approve. */
  pending: PendingCommitmentToReview[];
  requesterName: string;
  onApprove: (request: PendingCommitmentToReview) => Promise<void>;
}

/**
 * Sticky bar shown above the message composer when the current user (host)
 * has one or more pending commitment requests from the DM partner.
 *
 * If there are multiple, we surface the most recent and label it with the
 * trip title so the host knows which one they're approving.
 */
export const CommitmentReviewBar: React.FC<Props> = ({ pending, requesterName, onApprove }) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  if (!pending || pending.length === 0) return null;

  const active = pending[0]; // already ordered newest-first by the service
  const tripLabel = active.trip_title?.trim() || 'this trip';
  const extraCount = pending.length - 1;

  const doApprove = async () => {
    if (approving) return;
    setApproving(true);
    try {
      await onApprove(active);
      setConfirmOpen(false);
    } finally {
      setApproving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.title}>Review commitment</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {tripLabel}
            {extraCount > 0 ? ` · +${extraCount} more` : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => setConfirmOpen(true)}
          disabled={approving}
          activeOpacity={0.85}
        >
          {approving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.btnText}>Approve</Text>
          )}
        </TouchableOpacity>
      </View>

      <CommitmentConfirmModal
        visible={confirmOpen}
        requesterName={requesterName}
        onCancel={() => setConfirmOpen(false)}
        onApprove={doApprove}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  copy: { flex: 1, paddingRight: 12 },
  title: { fontSize: 14, fontWeight: '700', color: '#222B30' },
  sub: { fontSize: 12, color: '#7B7B7B', marginTop: 2 },
  btn: {
    backgroundColor: '#222B30',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 96,
    alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
});
