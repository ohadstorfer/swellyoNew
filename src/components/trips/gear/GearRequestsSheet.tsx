import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { EnrichedGearRequest } from '../../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  requests: EnrichedGearRequest[];
  processingId: string | null;
  onClose: () => void;
  onApprove: (request: EnrichedGearRequest, neededQty: number) => void;
  onDecline: (request: EnrichedGearRequest) => void;
}

export const GearRequestsSheet: React.FC<Props> = ({
  visible,
  requests,
  processingId,
  onClose,
  onApprove,
  onDecline,
}) => {
  // Per-request "how many needed" the host sets before approving. Defaults to 1.
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const getQty = (id: string) => qtys[id] ?? 1;
  const bumpQty = (id: string, delta: number) =>
    setQtys(prev => ({ ...prev, [id]: Math.max(1, (prev[id] ?? 1) + delta) }));

  // Reset the staged quantities whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) setQtys({});
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Gear requests</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={18} color="#222B30" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {requests.length === 0 ? (
              <Text style={styles.empty}>No pending requests.</Text>
            ) : (
              requests.map(r => {
                const isProcessing = processingId === r.id;
                const qty = getQty(r.id);
                return (
                  <View key={r.id} style={styles.row}>
                    <View style={styles.requesterRow}>
                      {r.requester.profile_image_url ? (
                        <Image source={{ uri: r.requester.profile_image_url }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarPlaceholder]} />
                      )}
                      <Text style={styles.requesterName}>{r.requester.name || 'Someone'}</Text>
                    </View>
                    <Text style={styles.itemName}>{r.item_name}</Text>
                    {r.note ? <Text style={styles.note}>"{r.note}"</Text> : null}

                    <View style={styles.qtyRow}>
                      <Text style={styles.qtyLabel}>How many needed?</Text>
                      <View style={styles.counter}>
                        <TouchableOpacity
                          style={[styles.counterBtn, qty <= 1 && styles.counterBtnDisabled]}
                          onPress={() => bumpQty(r.id, -1)}
                          disabled={qty <= 1 || isProcessing}
                          hitSlop={6}
                        >
                          <Text style={styles.counterBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.counterValue}>{qty}</Text>
                        <TouchableOpacity
                          style={styles.counterBtn}
                          onPress={() => bumpQty(r.id, 1)}
                          disabled={isProcessing}
                          hitSlop={6}
                        >
                          <Text style={styles.counterBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.btn, styles.declineBtn, isProcessing && styles.btnDisabled]}
                        onPress={() => onDecline(r)}
                        disabled={isProcessing}
                      >
                        <Text style={styles.declineText}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.approveBtn, isProcessing && styles.btnDisabled]}
                        onPress={() => onApprove(r, qty)}
                        disabled={isProcessing}
                      >
                        {isProcessing ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.approveText}>Approve</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#222B30' },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 16, paddingBottom: 24 },
  empty: { color: '#7B7B7B', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  row: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  requesterRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  avatar: { width: 24, height: 24, borderRadius: 12, marginRight: 8, backgroundColor: '#E5E7EB' },
  avatarPlaceholder: { borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FAFAFA' },
  requesterName: { fontSize: 13, color: '#4A5565', fontWeight: '600' },
  itemName: { fontSize: 16, fontWeight: '700', color: '#222B30' },
  note: { fontSize: 13, color: '#4A5565', fontStyle: 'italic', marginTop: 4 },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  qtyLabel: { fontSize: 13, fontWeight: '600', color: '#4A5565' },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FAFAFA',
  },
  counterBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  counterBtnDisabled: { opacity: 0.3 },
  counterBtnText: { fontSize: 22, fontWeight: '600', color: '#222B30' },
  counterValue: { minWidth: 28, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#222B30' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  approveBtn: { backgroundColor: '#0788B0' },
  approveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  declineBtn: { borderWidth: 1, borderColor: '#0788B0' },
  declineText: { color: '#0788B0', fontWeight: '700', fontSize: 14 },
});
