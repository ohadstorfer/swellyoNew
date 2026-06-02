import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { EnrichedJoinRequest } from '../../services/trips/groupTripsService';
import ParticipantCard from './ParticipantCard';

interface PendingRequestCardProps {
  request: EnrichedJoinRequest;
  onApprove: (requestId: string) => void;
  onDecline: (requestId: string) => void;
  isProcessing?: boolean;
  /** Hide the Decline button + relabel Approve — used for the "Declined" list,
   *  where the only meaningful action is reversing the decision. */
  hideDecline?: boolean;
  approveLabel?: string;
}

export const PendingRequestCard: React.FC<PendingRequestCardProps> = ({
  request,
  onApprove,
  onDecline,
  isProcessing,
  hideDecline,
  approveLabel = 'Approve',
}) => {
  return (
    <View style={styles.wrap}>
      <ParticipantCard
        participant={request.requester}
        rightSlot={
          isProcessing ? (
            <ActivityIndicator color="#0788B0" />
          ) : (
            <View style={styles.actions}>
              {!hideDecline && (
                <TouchableOpacity
                  style={[styles.btn, styles.declineBtn]}
                  onPress={() => onDecline(request.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.declineText}>Decline</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.btn, styles.approveBtn]}
                onPress={() => onApprove(request.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.approveText}>{approveLabel}</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />
      {request.request_note ? (
        <Text style={styles.note} numberOfLines={3}>
          “{request.request_note}”
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  actions: { flexDirection: 'row', gap: 6 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 6,
  },
  approveBtn: { backgroundColor: '#0788B0' },
  approveText: { color: '#FFFFFF', fontWeight: '600', fontSize: 12 },
  declineBtn: { backgroundColor: '#F2F2F2' },
  declineText: { color: '#555', fontWeight: '600', fontSize: 12 },
  note: {
    fontSize: 12,
    color: '#555',
    fontStyle: 'italic',
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 8,
  },
});

export default PendingRequestCard;
