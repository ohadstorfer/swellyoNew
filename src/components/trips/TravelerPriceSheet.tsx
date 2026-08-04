import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Lives at src/components/BottomSheetShell.tsx — one level up from trips/.
import { BottomSheetShell } from '../BottomSheetShell';
import {
  amountDue,
  fetchPaidByRequirement,
  fetchTravelerPrices,
  saveTravelerPrice,
} from '../../services/trips/tripPaymentsService';
import { showErrorAlert } from '../../utils/friendlyError';
import { ff } from '../../theme/fonts';
import { useUserProfile } from '../../context/UserProfileContext';
import { FALLBACK_USD_TO_ILS, formatPrice, ilsToUsd, isIsraeli, usdToIls } from '../../utils/currency';

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
 * surprises people, so it is said out loud before saving — inline, not via
 * `Alert.alert`. This sheet already sits nested inside TripMemberSheet's own
 * Modal; a native alert confirming into a `commit()` that then calls
 * `onClose()` would dismiss the alert and this Modal in overlapping frames,
 * the same family of bug behind the iOS touch-lock freeze this project has
 * already lost days to.
 *
 * Inputs are shown in the OPERATOR's own currency (₪ for an Israeli operator,
 * same rule `CreateTripFlowA` uses for the trip's own price step), converted
 * to/from the canonical USD columns with the trip's frozen `budget_fx_rate` —
 * exactly like that wizard's edit-mode path. The database never sees
 * anything but USD; only this input layer converts.
 */
export const TravelerPriceSheet: React.FC<{
  visible: boolean;
  tripId: string;
  userId: string;
  travelerName: string;
  /** `group_trips.budget_fx_rate` — the trip's frozen USD→₪ rate. Null (no
   *  price ever set / legacy trip) falls back to FALLBACK_USD_TO_ILS, same as
   *  CreateTripFlowA's edit-mode path. */
  budgetFxRate: number | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ visible, tripId, userId, travelerName, budgetFxRate, onClose, onSaved }) => {
  const insets = useSafeAreaInsets();
  const { profile } = useUserProfile();
  const operatorCurrency: 'ILS' | 'USD' = isIsraeli(profile?.country_from) ? 'ILS' : 'USD';
  const rate = budgetFxRate ?? FALLBACK_USD_TO_ILS;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Both held as strings in the OPERATOR's currency — what the TextInput
  // shows. Converted to canonical USD only at the point of validating/saving.
  const [total, setTotal] = useState('');
  const [deposit, setDeposit] = useState('');
  const [paid, setPaid] = useState(0); // canonical USD, already paid
  // Snapshot of what was frozen on their row BEFORE this edit, in canonical
  // USD. The "ask for more money?" warning must compare against this, not
  // against `paid` — comparing to `paid` fires on a price DROP too, any time
  // a deposit was already paid (paid > 0) and the new total still exceeds
  // that deposit, which is the common case, not the exceptional one.
  const [originalTotalUsd, setOriginalTotalUsd] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmRaise, setConfirmRaise] = useState<{ t: number; d: number | null } | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFormError(null);
    setConfirmRaise(null);
    (async () => {
      setLoading(true);
      try {
        const [prices, paidMap] = await Promise.all([
          fetchTravelerPrices(tripId, userId),
          fetchPaidByRequirement(tripId, userId),
        ]);
        if (cancelled) return;
        const totalDisplay =
          prices.totalUsd != null
            ? operatorCurrency === 'ILS'
              ? usdToIls(prices.totalUsd, rate)
              : prices.totalUsd
            : null;
        const depositDisplay =
          prices.depositUsd != null
            ? operatorCurrency === 'ILS'
              ? usdToIls(prices.depositUsd, rate)
              : prices.depositUsd
            : null;
        setTotal(totalDisplay != null ? String(totalDisplay) : '');
        setDeposit(depositDisplay != null ? String(depositDisplay) : '');
        setOriginalTotalUsd(prices.totalUsd);
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
  }, [visible, tripId, userId, operatorCurrency, rate]);

  /** Operator-currency display string → canonical USD, or null if blank/invalid. */
  const toUsd = (displayVal: string): number | null => {
    const n = parseInt(displayVal, 10);
    if (!Number.isFinite(n)) return null;
    return operatorCurrency === 'ILS' ? ilsToUsd(n, rate) : n;
  };

  const commit = async (t: number, d: number | null) => {
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

  const handleSave = () => {
    setFormError(null);
    const t = toUsd(total);
    const d = toUsd(deposit);

    if (t == null || t < 0) {
      setFormError('Set a total price first.');
      return;
    }
    if (d != null && d > t) {
      setFormError('The deposit cannot be more than the total.');
      return;
    }

    // Only warn when it actually reopens something. Lowering the price, or
    // editing someone who has paid nothing, needs no ceremony.
    if (paid > 0 && originalTotalUsd != null && t > originalTotalUsd) {
      setConfirmRaise({ t, d });
      return;
    }
    void commit(t, d);
  };

  const balanceUsd = amountDue('balance', { totalUsd: toUsd(total), depositUsd: toUsd(deposit) });
  // amountDue returns null (not 0) on purpose — zero reads as "fully paid" to
  // every consumer. Mirror that here instead of collapsing it back to 0.
  const balanceLabel = formatPrice(balanceUsd, rate, profile?.country_from) ?? '—';
  const paidLabel = formatPrice(paid, rate, profile?.country_from) ?? '—';
  const currencyUnit = operatorCurrency === 'ILS' ? '₪' : 'USD';

  return (
    // No `title` prop exists on BottomSheetShell — the heading is rendered
    // below. `avoidKeyboard` is required: this sheet has text inputs.
    <BottomSheetShell visible={visible} onClose={onClose} avoidKeyboard>
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
        {loading ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <View style={styles.body}>
            <Text style={styles.heading}>{travelerName}'s price</Text>

            <Text style={styles.label}>Total · {currencyUnit}</Text>
            <TextInput
              style={styles.input}
              value={total}
              onChangeText={t => {
                setFormError(null);
                setConfirmRaise(null);
                setTotal(t.replace(/[^0-9]/g, ''));
              }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="2000"
              placeholderTextColor="#9A9A9A"
            />

            <Text style={[styles.label, { marginTop: 16 }]}>Deposit · {currencyUnit}</Text>
            <TextInput
              style={styles.input}
              value={deposit}
              onChangeText={t => {
                setFormError(null);
                setConfirmRaise(null);
                setDeposit(t.replace(/[^0-9]/g, ''));
              }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="500"
              placeholderTextColor="#9A9A9A"
            />

            <Text style={styles.summary}>
              Final payment: {balanceLabel} · Paid so far: {paidLabel}
            </Text>

            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            {confirmRaise ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>
                  {travelerName} has already paid {paidLabel}. Raising their price will ask
                  them for the difference.
                </Text>
                <View style={styles.confirmActions}>
                  <Pressable
                    onPress={() => setConfirmRaise(null)}
                    style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressedScale]}
                  >
                    <Text style={styles.confirmCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const c = confirmRaise;
                      setConfirmRaise(null);
                      void commit(c.t, c.d);
                    }}
                    style={({ pressed }) => [styles.confirmAsk, pressed && styles.pressedScale]}
                  >
                    <Text style={styles.confirmAskText}>Ask for it</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={({ pressed }) => [
                  styles.save,
                  pressed && styles.pressedScale,
                  saving && styles.saveDisabled,
                ]}
              >
                <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // BottomSheetShell is headless by design — every consumer supplies its own
  // surface. Without this, the sheet's text/inputs render straight onto the
  // dim scrim with TripMemberSheet's rows showing through underneath.
  surface: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  loading: { marginVertical: 32 },
  body: { paddingHorizontal: 20, paddingTop: 20 },
  heading: {
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 18,
    color: '#181D27',
    marginBottom: 16,
  },
  label: { fontFamily: ff('Inter', '600'), fontWeight: '600', fontSize: 13, color: '#535862', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: ff('Inter', '400'),
    fontSize: 16,
    color: '#181D27',
  },
  summary: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#535862', marginTop: 16 },
  formError: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#C0392B', marginTop: 8 },
  confirmBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  confirmText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7C2D12', lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  confirmCancel: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  confirmCancelText: { fontFamily: ff('Inter', '600'), fontWeight: '600', fontSize: 14, color: '#374151' },
  confirmAsk: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#0788B0',
  },
  confirmAskText: { fontFamily: ff('Inter', '600'), fontWeight: '600', fontSize: 14, color: '#FFFFFF' },
  save: {
    backgroundColor: '#0788B0',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { fontFamily: ff('Inter', '600'), fontWeight: '600', fontSize: 15, color: '#FFFFFF' },
  pressedScale: { transform: [{ scale: 0.97 }] },
});
