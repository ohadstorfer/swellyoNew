import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
  Dimensions,
} from 'react-native';

const SHEET_MAX_HEIGHT = Dimensions.get('window').height * 0.88;
import { Ionicons } from '@expo/vector-icons';
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

  if (!item) return null;

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
            {saving ? <ActivityIndicator color="#0788B0" /> : <Text style={styles.btnSecondaryText}>I'm no longer bringing this</Text>}
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
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.btnPrimaryText}>I got this</Text>}
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
              <ActivityIndicator color="#FFFFFF" />
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{item.name}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={18} color="#222B30" />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
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
          </View>
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
    maxHeight: SHEET_MAX_HEIGHT,
    width: '100%',
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
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 },
  label: { fontSize: 11, fontWeight: '700', color: '#4A5565', letterSpacing: 0.5 },
  statusValue: { fontSize: 16, fontWeight: '700', color: '#222B30', marginTop: 4 },
  statusSub: { fontSize: 13, color: '#4A5565', marginTop: 2 },
  contributorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 12, backgroundColor: '#E5E7EB' },
  avatarPlaceholder: { borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FAFAFA' },
  contributorName: { fontSize: 14, fontWeight: '700', color: '#222B30' },
  contributorQty: { fontSize: 12, color: '#7B7B7B', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 16 },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 4,
    marginTop: 10,
    backgroundColor: '#FAFAFA',
  },
  counterBtn: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnDisabled: { opacity: 0.3 },
  counterBtnText: { fontSize: 28, fontWeight: '600', color: '#222B30' },
  counterValue: { fontSize: 22, fontWeight: '700', color: '#222B30' },
  actions: { marginTop: 18 },
  btnPrimary: {
    backgroundColor: '#0788B0',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.35 },
  btnSecondary: {
    borderWidth: 1,
    borderColor: '#0788B0',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#0788B0', fontWeight: '700', fontSize: 15 },
  note: { fontSize: 13, color: '#7B7B7B', fontStyle: 'italic', marginTop: 16 },
});
