import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// Lives at src/components/BottomSheetShell.tsx — one level up from trips/.
import { BottomSheetShell } from '../BottomSheetShell';
import {
  amountDue,
  fetchPaidByRequirement,
  fetchTravelerPrices,
  saveTravelerPrice,
} from '../../services/trips/tripPaymentsService';
import { showErrorAlert } from '../../utils/friendlyError';

/**
 * One traveler's own price.
 *
 * The trip price is only a default — this is what they actually owe, and it was
 * frozen onto their participant row when they joined. Editing here affects
 * nobody else, which is exactly the point: operators agree different prices
 * with different people.
 *
 * Raising the price of someone who already paid REOPENS their balance for the
 * difference. That is intended (an operator adding services mid-trip), but it
 * surprises people, so it is said out loud before saving.
 */
export const TravelerPriceSheet: React.FC<{
  visible: boolean;
  tripId: string;
  userId: string;
  travelerName: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ visible, tripId, userId, travelerName, onClose, onSaved }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [total, setTotal] = useState('');
  const [deposit, setDeposit] = useState('');
  const [paid, setPaid] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [prices, paidMap] = await Promise.all([
          fetchTravelerPrices(tripId, userId),
          fetchPaidByRequirement(tripId, userId),
        ]);
        if (cancelled) return;
        setTotal(prices.totalUsd != null ? String(prices.totalUsd) : '');
        setDeposit(prices.depositUsd != null ? String(prices.depositUsd) : '');
        setPaid(Object.values(paidMap).reduce((s, n) => s + n, 0));
      } catch (e) {
        if (!cancelled) showErrorAlert('Price', e, 'Could not load this price.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tripId, userId]);

  const save = useCallback(async () => {
    const t = parseInt(total, 10);
    const d = deposit ? parseInt(deposit, 10) : null;

    if (!Number.isFinite(t) || t < 0) {
      Alert.alert('Set a total price first.');
      return;
    }
    if (d != null && d > t) {
      Alert.alert('The deposit cannot be more than the total.');
      return;
    }

    const commit = async () => {
      setSaving(true);
      try {
        await saveTravelerPrice(tripId, userId, t, d);
        onSaved();
        onClose();
      } catch (e) {
        showErrorAlert('Price', e, 'Could not save this price.');
      } finally {
        setSaving(false);
      }
    };

    // Only warn when it actually reopens something. Lowering a price, or
    // editing someone who has paid nothing, needs no ceremony.
    if (paid > 0 && t > paid) {
      Alert.alert(
        'Ask for more money?',
        `${travelerName} has paid ${paid}. Raising their price to ${t} will ask them for the difference.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Ask for it', onPress: commit },
        ],
      );
      return;
    }
    await commit();
  }, [total, deposit, paid, tripId, userId, travelerName, onClose, onSaved]);

  const balance = amountDue('balance', {
    totalUsd: parseInt(total, 10) || null,
    depositUsd: deposit ? parseInt(deposit, 10) : null,
  });

  return (
    // No `title` prop exists on BottomSheetShell — the heading is yours to
    // render. `avoidKeyboard` is required here: this sheet has text inputs.
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 32 }} />
      ) : (
        <View style={styles.body}>
          <Text style={styles.heading}>{travelerName}'s price</Text>
          <Text style={styles.label}>Total · USD</Text>
          <TextInput
            style={styles.input}
            value={total}
            onChangeText={t => setTotal(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="2000"
          />

          <Text style={[styles.label, { marginTop: 16 }]}>Deposit · USD</Text>
          <TextInput
            style={styles.input}
            value={deposit}
            onChangeText={t => setDeposit(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="500"
          />

          <Text style={styles.summary}>
            Final payment: {balance ?? 0} · Paid so far: {paid}
          </Text>

          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [
              styles.save,
              pressed && { transform: [{ scale: 0.97 }] },
              saving && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>
      )}
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 20 },
  heading: { fontSize: 18, fontWeight: '600', color: '#181D27', marginBottom: 16 },
  label: { fontSize: 13, color: '#535862', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#181D27',
  },
  summary: { fontSize: 13, color: '#535862', marginTop: 16 },
  save: {
    backgroundColor: '#0788B0',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
