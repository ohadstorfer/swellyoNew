// GearRequestsSheet — host reviews members' "request item" submissions.
//
// Matches the other gear bottom sheets (AddPersonalGearSheet, ManageGearSheet
// "Edit Gear"): a custom Modal with a grabber, a title/subtitle row over a
// hairline (Host badge on the right), and the request list below. Motion is the
// shared sheet transition — backdrop FADES while the sheet SLIDES up.
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
  ScrollView,
  Dimensions,
} from 'react-native';
import { SHEET } from '../TripBottomSheet';
import { ff } from '../../../theme/fonts';
import { useSheetTransition } from '../../../hooks/useSheetTransition';
import type { EnrichedGearRequest } from '../../../services/trips/groupTripsService';

const SCREEN_H = Dimensions.get('window').height;

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

  // Fade the backdrop, slide the sheet (matches the other bottom sheets).
  const { mounted, backdropOpacity, translateY, onSheetLayout } = useSheetTransition(visible);

  // Reset the staged quantities whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) setQtys({});
  }, [visible]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.kavRoot}
      >
        <Pressable style={s.container} onPress={onClose}>
          <Animated.View pointerEvents="none" style={[s.backdrop, { opacity: backdropOpacity }]} />
          <Animated.View style={{ transform: [{ translateY }] }} onLayout={onSheetLayout}>
            <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
              {/* Grabber */}
              <View style={s.grabberRow}>
                <View style={s.grabber} />
              </View>

              {/* Title + subtitle, hairline underneath. */}
              <View style={s.titleRow}>
                <View style={s.titleCol}>
                  <Text style={s.title}>Gear requests</Text>
                  <Text style={s.subtitle}>Approve or decline what members asked for</Text>
                </View>
              </View>

              {requests.length === 0 ? (
                <Text style={s.empty}>No pending requests.</Text>
              ) : (
                <ScrollView
                  style={s.body}
                  contentContainerStyle={s.bodyContent}
                  showsVerticalScrollIndicator={false}
                >
                  {requests.map(r => {
                    const isProcessing = processingId === r.id;
                    const qty = qtys[r.id] ?? r.needed_qty ?? 1;
                    return (
                      <View key={r.id} style={s.row}>
                        <View style={s.requesterRow}>
                          {r.requester.profile_image_url ? (
                            <Image source={{ uri: r.requester.profile_image_url }} style={s.avatar} />
                          ) : (
                            <View style={[s.avatar, s.avatarPlaceholder]} />
                          )}
                          <Text style={s.requesterName}>{r.requester.name || 'Someone'}</Text>
                        </View>
                        <Text style={s.itemName}>{r.item_name}</Text>
                        {r.note ? <Text style={s.note}>"{r.note}"</Text> : null}

                        <View style={s.qtyRow}>
                          <Text style={s.qtyLabel}>How many needed?</Text>
                          <View style={s.counter}>
                            <TouchableOpacity
                              style={[s.counterBtn, qty <= 1 && s.counterBtnDisabled]}
                              onPress={() => bumpQty(r.id, -1, r.needed_qty ?? 1)}
                              disabled={qty <= 1 || isProcessing}
                              hitSlop={6}
                            >
                              <Text style={s.counterBtnText}>−</Text>
                            </TouchableOpacity>
                            <Text style={s.counterValue}>{qty}</Text>
                            <TouchableOpacity
                              style={s.counterBtn}
                              onPress={() => bumpQty(r.id, 1, r.needed_qty ?? 1)}
                              disabled={isProcessing}
                              hitSlop={6}
                            >
                              <Text style={s.counterBtnText}>+</Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        <View style={s.actions}>
                          <TouchableOpacity
                            style={[s.btn, s.declineBtn, isProcessing && s.btnDisabled]}
                            onPress={() => onDecline(r)}
                            disabled={isProcessing}
                          >
                            <Text style={s.declineText}>Decline</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[s.btn, s.approveBtn, isProcessing && s.btnDisabled]}
                            onPress={() => onApprove(r, qty)}
                            disabled={isProcessing}
                          >
                            {isProcessing ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <Text style={s.approveText}>Approve</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default GearRequestsSheet;

// Chrome mirrors AddPersonalGearSheet / ManageGearSheet "Edit Gear"; the request
// rows keep the SHEET design tokens they already used.
const s = StyleSheet.create({
  kavRoot: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(33,33,33,0.7)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 2,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  grabberRow: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  grabber: { width: 80, height: 4, borderRadius: 20, backgroundColor: '#7B7B7B' },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  titleCol: { flex: 1, justifyContent: 'center', gap: 4, paddingBottom: 16 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 18, lineHeight: 24, color: '#333333' },
  subtitle: { fontFamily: ff('Inter', '400'), fontSize: 14, lineHeight: 18, color: '#4A5565' },

  body: { maxHeight: SCREEN_H * 0.6, marginTop: 16 },
  bodyContent: { paddingBottom: 8 },
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
  approveBtn: { backgroundColor: '#212121' },
  approveText: { fontFamily: SHEET.fontBody, color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  declineBtn: { borderWidth: 1, borderColor: SHEET.danger },
  declineText: { fontFamily: SHEET.fontBody, color: SHEET.danger, fontWeight: '700', fontSize: 14 },
});
