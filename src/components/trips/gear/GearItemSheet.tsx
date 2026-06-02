import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { TripBottomSheet, SHEET } from '../TripBottomSheet';
import type { EnrichedGearItem } from '../../../services/trips/groupTripsService';

interface Props {
  visible: boolean;
  item: EnrichedGearItem | null;
  currentUserId: string | null;
  onClose: () => void;
  onSetClaim: (itemId: string, quantity: number) => Promise<void>;
}

export const GearItemSheet: React.FC<Props> = ({
  visible,
  item,
  currentUserId,
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
      <TripBottomSheet visible={visible} onClose={onClose} title="Gear item">
        {null}
      </TripBottomSheet>
    );
  }

  const isSingle = item.needed_qty === 1;
  const othersQty = item.claimed_qty - item.my_claim_qty;
  const remainingForMe = item.needed_qty - othersQty; // max I could claim
  const isCovered = item.claimed_qty >= item.needed_qty;
  const iHaveIt = item.my_claim_qty > 0;

  const handleSave = async (next: number) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSetClaim(item.id, next);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const renderSingleControls = () => {
    if (iHaveIt) {
      return (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={() => handleSave(0)}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color={SHEET.brandTeal} /> : <Text style={styles.btnSecondaryText}>I'm no longer bringing this</Text>}
          </TouchableOpacity>
        </View>
      );
    }
    if (isCovered) {
      return null; // someone else got it
    }
    return (
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => handleSave(1)}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color={SHEET.surface} /> : <Text style={styles.btnPrimaryText}>I got this</Text>}
        </TouchableOpacity>
      </View>
    );
  };

  const renderMultiControls = () => {
    const canIncrement = draft < remainingForMe;
    const canDecrement = draft > 0;
    return (
      <>
        <Text style={styles.label}>HOW MANY CAN YOU BRING?</Text>
        <View style={styles.counterRow}>
          <TouchableOpacity
            style={[styles.counterBtn, !canDecrement && styles.counterBtnDisabled]}
            onPress={() => canDecrement && setDraft(d => Math.max(0, d - 1))}
            disabled={!canDecrement}
          >
            <Text style={styles.counterBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.counterValue}>{draft}</Text>
          <TouchableOpacity
            style={[styles.counterBtn, !canIncrement && styles.counterBtnDisabled]}
            onPress={() => canIncrement && setDraft(d => d + 1)}
            disabled={!canIncrement}
          >
            <Text style={styles.counterBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btnPrimary, draft === item.my_claim_qty && styles.btnDisabled]}
            onPress={() => handleSave(draft)}
            disabled={draft === item.my_claim_qty || saving}
          >
            {saving ? (
              <ActivityIndicator color={SHEET.surface} />
            ) : (
              <Text style={styles.btnPrimaryText}>
                {item.my_claim_qty === 0 ? 'Add mine' : draft === 0 ? 'Remove mine' : 'Update'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const statusLine = (() => {
    if (isCovered) return 'Covered · All set';
    if (item.claimed_qty === 0) return 'Not covered yet';
    return `${item.claimed_qty} / ${item.needed_qty} collected`;
  })();
  const remainingText = !isCovered && item.claimed_qty > 0
    ? `${item.needed_qty - item.claimed_qty} more needed`
    : !isCovered
      ? 'Someone needs to bring this'
      : null;

  return (
    <TripBottomSheet
      visible={visible}
      onClose={onClose}
      title={item.name}
      subtitle={statusLine}
    >
      <Text style={styles.label}>STATUS</Text>
      <Text style={styles.statusValue}>{statusLine}</Text>
      {remainingText ? <Text style={styles.statusSub}>{remainingText}</Text> : null}

      {item.contributors.length > 0 && (
        <>
          <Text style={[styles.label, { marginTop: 16 }]}>CONTRIBUTORS</Text>
          {item.contributors.map(c => (
            <View key={c.user_id} style={styles.contributorRow}>
              {c.profile_image_url ? (
                <Image source={{ uri: c.profile_image_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.contributorName}>
                  {c.user_id === currentUserId ? 'You' : c.name || 'Someone'}
                </Text>
                <Text style={styles.contributorQty}>
                  Bringing {c.quantity}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}

      {isSingle && isCovered && !iHaveIt && (
        <Text style={styles.note}>Someone else has this covered.</Text>
      )}
      {!isSingle && (
        <View style={styles.divider} />
      )}

      {isSingle ? renderSingleControls() : renderMultiControls()}
    </TripBottomSheet>
  );
};

const styles = StyleSheet.create({
  label: { fontFamily: SHEET.fontBody, fontSize: 11, fontWeight: '700', color: SHEET.inkBody, letterSpacing: 0.5 },
  statusValue: { fontFamily: SHEET.fontHead, fontSize: 16, fontWeight: '700', color: SHEET.inkBody, marginTop: 4 },
  statusSub: { fontFamily: SHEET.fontBody, fontSize: 13, color: SHEET.inkBody, marginTop: 2 },
  contributorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 12, backgroundColor: SHEET.border },
  avatarPlaceholder: { borderWidth: 1, borderColor: SHEET.border, backgroundColor: SHEET.surfaceMuted },
  contributorName: { fontFamily: SHEET.fontHead, fontSize: 14, fontWeight: '700', color: SHEET.inkBody },
  contributorQty: { fontFamily: SHEET.fontBody, fontSize: 12, color: SHEET.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: SHEET.border, marginVertical: 16 },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: SHEET.border,
    borderRadius: 10,
    paddingHorizontal: 4,
    marginTop: 10,
    backgroundColor: SHEET.surfaceMuted,
  },
  counterBtn: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnDisabled: { opacity: 0.3 },
  counterBtnText: { fontFamily: SHEET.fontHead, fontSize: 28, fontWeight: '600', color: SHEET.inkBody },
  counterValue: { fontFamily: SHEET.fontHead, fontSize: 22, fontWeight: '700', color: SHEET.inkBody },
  actions: { marginTop: 18 },
  btnPrimary: {
    backgroundColor: SHEET.brandTeal,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimaryText: { fontFamily: SHEET.fontHead, color: SHEET.surface, fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.35 },
  btnSecondary: {
    borderWidth: 1,
    borderColor: SHEET.brandTeal,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSecondaryText: { fontFamily: SHEET.fontHead, color: SHEET.brandTeal, fontWeight: '700', fontSize: 15 },
  note: { fontFamily: SHEET.fontBody, fontSize: 13, color: SHEET.textMuted, fontStyle: 'italic', marginTop: 16 },
});

export default GearItemSheet;
