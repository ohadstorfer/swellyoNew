import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';
import { HostTag } from '../HostTag';
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
  // Per-request "how many needed" the host can adjust before approving. Defaults
  // to the quantity the requester asked for (needed_qty), not 1.
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const bumpQty = (id: string, delta: number, base: number) =>
    setQtys(prev => ({ ...prev, [id]: Math.max(1, (prev[id] ?? base) + delta) }));

  // Reset the staged quantities whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) setQtys({});
  }, [visible]);

  return (
    <TripBottomSheet
      visible={visible}
      onClose={onClose}
      title="Gear requests"
      subtitle="Approve or decline what members asked for"
      headerRight={<HostTag />}
    >
      {requests.length === 0 ? (
        <Text style={styles.empty}>No pending requests.</Text>
      ) : (
        requests.map(r => {
          const isProcessing = processingId === r.id;
          const qty = qtys[r.id] ?? r.needed_qty ?? 1;
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
                    onPress={() => bumpQty(r.id, -1, r.needed_qty ?? 1)}
                    disabled={qty <= 1 || isProcessing}
                    hitSlop={6}
                  >
                    <Text style={styles.counterBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.counterValue}>{qty}</Text>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => bumpQty(r.id, 1, r.needed_qty ?? 1)}
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
    </TripBottomSheet>
  );
};

export default GearRequestsSheet;

const styles = StyleSheet.create({
  empty: {
    color: SHEET.textMuted,
    fontFamily: SHEET.fontBody,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
  },
  row: {
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  requesterRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  avatar: { width: 24, height: 24, borderRadius: 12, marginRight: 8, backgroundColor: SHEET.border },
  avatarPlaceholder: { borderWidth: 1, borderColor: SHEET.border, backgroundColor: SHEET.surfaceMuted },
  requesterName: { fontFamily: SHEET.fontBody, fontSize: 13, color: SHEET.inkBody, fontWeight: '600' },
  itemName: { fontFamily: SHEET.fontHead, fontSize: 16, fontWeight: '700', color: SHEET.inkDark },
  note: { fontFamily: SHEET.fontBody, fontSize: 13, color: SHEET.inkBody, fontStyle: 'italic', marginTop: 4 },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  qtyLabel: { fontFamily: SHEET.fontBody, fontSize: 13, fontWeight: '600', color: SHEET.inkBody },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 10,
    backgroundColor: SHEET.surfaceMuted,
  },
  counterBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  counterBtnDisabled: { opacity: 0.3 },
  counterBtnText: { fontFamily: SHEET.fontBody, fontSize: 22, fontWeight: '600', color: SHEET.inkDark },
  counterValue: {
    fontFamily: SHEET.fontBody,
    minWidth: 28,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: SHEET.inkDark,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  approveBtn: { backgroundColor: SHEET.brandTeal },
  approveText: { fontFamily: SHEET.fontBody, color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  declineBtn: { borderWidth: 1, borderColor: SHEET.danger },
  declineText: { fontFamily: SHEET.fontBody, color: SHEET.danger, fontWeight: '700', fontSize: 14 },
});
