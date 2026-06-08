import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TripBottomSheet } from '../TripBottomSheet';
import type { EnrichedGearItem } from '../../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  item: EnrichedGearItem | null;
  currentUserId: string | null;
  onClose: () => void;
  onSetClaim: (itemId: string, quantity: number) => Promise<void>;
}

// Figma gear-claim sheet (node 12833-12938) — exact tokens.
const C = {
  ink: '#333333',
  muted: '#6a7282',
  circleBg: '#f7f7f7',
  circleBorder: '#cfcfcf',
  dark: '#212121',
  accent: '#05BCD3',
  white: '#FFFFFF',
  fontHead: 'Montserrat',
  fontBody: 'Inter',
} as const;

export const GearItemSheet: React.FC<Props> = ({
  visible,
  item,
  onClose,
  onSetClaim,
}) => {
  const [draft, setDraft] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setDraft(item.my_claim_qty);
  }, [item?.id, item?.my_claim_qty]);

  if (!item) {
    return (
      <TripBottomSheet visible={visible} onClose={onClose} title="Group Gear" subtitle="Shared items for the trip">
        {null}
      </TripBottomSheet>
    );
  }

  const othersQty = item.claimed_qty - item.my_claim_qty;
  const maxForMe = Math.max(item.needed_qty - othersQty, 0); // most I could bring
  const isSingleSlot = maxForMe <= 1;
  const coveredByOthers = maxForMe <= 0 && item.my_claim_qty === 0;
  const iHaveIt = item.my_claim_qty > 0;

  const statusLine = (() => {
    if (item.claimed_qty >= item.needed_qty) return 'Covered · All set';
    if (item.claimed_qty === 0) return 'Not covered yet';
    return `${item.claimed_qty} / ${item.needed_qty} collected · ${item.needed_qty - item.claimed_qty} more needed`;
  })();

  const inc = () => setDraft(d => Math.min(maxForMe, d + 1));
  const dec = () => setDraft(d => Math.max(0, d - 1));

  const handleConfirm = async () => {
    if (saving) return;
    // "I got this" with no quantity picked defaults to bringing one.
    const qty = draft > 0 ? draft : Math.min(1, maxForMe);
    if (qty === item.my_claim_qty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSetClaim(item.id, qty);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const primaryLabel = !iHaveIt ? 'I got this' : draft === 0 ? 'Remove mine' : 'Update';
  const primaryDisabled = saving || (coveredByOthers && draft === 0);

  // Right-side control: a "+" circle that becomes a single-slot toggle or a
  // multi-quantity stepper depending on how many this item still needs.
  const renderControl = () => {
    if (coveredByOthers) return null; // nothing for me to bring
    if (draft === 0) {
      return (
        <TouchableOpacity
          style={styles.plusCircle}
          onPress={() => maxForMe >= 1 && setDraft(1)}
          activeOpacity={0.7}
          accessibilityLabel="Add me"
        >
          <Ionicons name="add" size={24} color={C.ink} />
        </TouchableOpacity>
      );
    }
    if (isSingleSlot) {
      return (
        <TouchableOpacity
          style={[styles.plusCircle, styles.plusCircleActive]}
          onPress={() => setDraft(0)}
          activeOpacity={0.7}
          accessibilityLabel="Remove me"
        >
          <Ionicons name="checkmark" size={24} color={C.white} />
        </TouchableOpacity>
      );
    }
    // Multi-quantity stepper
    return (
      <View style={styles.stepper}>
        <TouchableOpacity style={styles.stepBtn} onPress={dec} activeOpacity={0.7} accessibilityLabel="One less">
          <Ionicons name="remove" size={20} color={C.ink} />
        </TouchableOpacity>
        <Text style={styles.stepValue}>{draft}</Text>
        <TouchableOpacity
          style={[styles.stepBtn, draft >= maxForMe && styles.stepBtnDisabled]}
          onPress={inc}
          disabled={draft >= maxForMe}
          activeOpacity={0.7}
          accessibilityLabel="One more"
        >
          <Ionicons name="add" size={20} color={C.ink} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <TripBottomSheet
      visible={visible}
      onClose={onClose}
      title="Group Gear"
      subtitle="Shared items for the trip"
      footer={
        <View style={styles.footerRow}>
          <TouchableOpacity style={styles.btnGhost} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.btnGhostText}>Maybe later</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnDark, primaryDisabled && styles.btnDisabled]}
            onPress={handleConfirm}
            disabled={primaryDisabled}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <Text style={styles.btnDarkText}>{primaryLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      }
    >
      <View style={styles.itemRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.itemStatus}>{statusLine}</Text>
        </View>
        {renderControl()}
      </View>
    </TripBottomSheet>
  );
};

const styles = StyleSheet.create({
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  itemName: { fontFamily: C.fontBody, fontSize: 18, lineHeight: 22, fontWeight: '700', color: C.ink },
  itemStatus: { fontFamily: C.fontBody, fontSize: 12, lineHeight: 18, color: C.muted, marginTop: 4 },

  // "+" circle (48px) — Figma node 12833:13762
  plusCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.circleBg,
    borderWidth: 1,
    borderColor: C.circleBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusCircleActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },

  // Multi-quantity stepper (shares the circle visual language)
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    backgroundColor: C.circleBg,
    borderWidth: 1,
    borderColor: C.circleBorder,
    paddingHorizontal: 4,
  },
  stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepBtnDisabled: { opacity: 0.3 },
  stepValue: {
    fontFamily: C.fontHead,
    fontSize: 16,
    fontWeight: '700',
    color: C.ink,
    minWidth: 24,
    textAlign: 'center',
  },

  // Footer buttons (Figma 12833:13670)
  footerRow: { flexDirection: 'row', gap: 10 },
  btnGhost: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.circleBorder,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostText: { fontFamily: C.fontHead, fontSize: 16, fontWeight: '600', color: C.ink },
  btnDark: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: C.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDarkText: { fontFamily: C.fontHead, fontSize: 16, fontWeight: '600', color: C.white },
  btnDisabled: { opacity: 0.4 },
});

export default GearItemSheet;
