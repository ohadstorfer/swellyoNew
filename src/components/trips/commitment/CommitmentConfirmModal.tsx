import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  /** Name of the requesting member, used in the title and copy. */
  requesterName: string;
  onCancel: () => void;
  onApprove: () => Promise<void>;
}

export const CommitmentConfirmModal: React.FC<Props> = ({
  visible,
  requesterName,
  onCancel,
  onApprove,
}) => {
  const [approving, setApproving] = useState(false);

  const handleApprove = async () => {
    if (approving) return;
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };

  const handleCancel = () => {
    if (approving) return;
    onCancel();
  };

  const safeName = requesterName?.trim() || 'this member';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={styles.backdrop} onPress={handleCancel}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Approve {safeName}&rsquo;s commitment?</Text>
          <Text style={styles.body}>
            Before approving, check in with {safeName} and make sure they&rsquo;re genuinely
            locked in for this trip. The rest of the group will plan around it.
          </Text>

          <View style={styles.warningBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#7A5C00" />
            <Text style={styles.warningText}>
              Once approved, {safeName} appears as committed to everyone on the trip. Only
              approve if you&rsquo;re confident.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btnPrimary, approving && styles.btnDisabled]}
            onPress={handleApprove}
            disabled={approving}
            activeOpacity={0.85}
          >
            {approving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>Approve</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnSecondary, approving && styles.btnDisabled]}
            onPress={handleCancel}
            disabled={approving}
            activeOpacity={0.85}
          >
            <Text style={styles.btnSecondaryText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#222B30',
    textAlign: 'center',
  },
  body: {
    fontSize: 13.5,
    color: '#4A5565',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFF7E0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 14,
    alignItems: 'flex-start',
  },
  warningText: { flex: 1, fontSize: 12.5, color: '#7A5C00', lineHeight: 17 },
  btnPrimary: {
    backgroundColor: '#222B30',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  btnPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  btnSecondaryText: { color: '#222B30', fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});
