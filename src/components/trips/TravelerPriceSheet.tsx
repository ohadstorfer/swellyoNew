import React, { useEffect, useMemo, useState } from 'react';
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
 * Dropping the price BELOW what they have already paid is warned about the
 * same way, and for a harder reason: there is no refund path anywhere in this
 * codebase. `amountOutstanding` clamps at zero, so the row simply reads
 * approved and nothing anywhere records that the traveler is owed money. The
 * warning (and the overpaid figure in the summary line) is the only trace it
 * leaves, so the operator has to settle it outside the app knowingly rather
 * than discover it later.
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
  /** Every requirement row on the trip, active or not — the same list the
   *  requirements editor reads. Only the pay rows are looked at, and only to
   *  decide whether a Deposit field may be shown at all. */
  requirements: { kind: string; isActive: boolean }[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ visible, tripId, userId, travelerName, budgetFxRate, requirements, onClose, onSaved }) => {
  const insets = useSafeAreaInsets();
  const { profile } = useUserProfile();
  const operatorCurrency: 'ILS' | 'USD' = isIsraeli(profile?.country_from) ? 'ILS' : 'USD';
  const rate = budgetFxRate ?? FALLBACK_USD_TO_ILS;

  /**
   * Is there anything to collect a deposit AGAINST?
   *
   * The create wizard treats a blank or zero deposit as "one single payment"
   * and publishes a `balance` row alone — no `deposit` row at all. Showing a
   * Deposit input on such a trip is silently uncollectable money: the balance
   * becomes `price - deposit`, so the traveler is billed the reduced amount,
   * every pay row reads approved, and the operator is short the deposit with
   * no error anywhere.
   *
   * Same rule (and the same reasoning) as ManageRequirementsSheet's pay-row
   * gate: an ACTIVE `deposit` row, not `payment_mode === 'managed'`, which
   * does not distinguish the two wizard outcomes. `operator_set_traveler_price`
   * enforces the identical rule server-side — this is only the affordance.
   */
  const hasDepositStep = useMemo(
    () => requirements.some(r => r.kind === 'deposit' && r.isActive),
    [requirements],
  );

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
  // Two different things to say out loud before saving, one control: 'raise'
  // reopens a balance, 'drop' leaves the traveler overpaid with no refund
  // path. They can both be true at once (raising a price that is still under
  // what was already paid), so `kind` is decided in one place — handleSave —
  // rather than by two independent booleans racing in the render.
  const [confirm, setConfirm] = useState<
    { t: number; d: number | null; kind: 'raise' | 'drop' } | null
  >(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFormError(null);
    setConfirm(null);
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
    // A trip with no deposit STEP has no deposit field on screen, and must
    // never send one: `operator_set_traveler_price` rejects a non-null
    // deposit on such a trip outright, and if it did not the money would be
    // uncollectable. Never read the (stale, hidden) input in that case.
    const d = hasDepositStep ? toUsd(deposit) : null;

    if (t == null || t < 0) {
      setFormError('Set a total price first.');
      return;
    }
    if (d != null && d > t) {
      setFormError('The deposit cannot be more than the total.');
      return;
    }

    // Overpayment first: it is the more consequential of the two, and both
    // can be true at once (raising a price that is still below what has
    // already been paid). There is no refund path in the app, so this is the
    // only moment the operator is told they will owe money back.
    if (paid > 0 && t < paid) {
      setConfirm({ t, d, kind: 'drop' });
      return;
    }
    // Only warn when it actually reopens something. Lowering the price, or
    // editing someone who has paid nothing, needs no ceremony.
    if (paid > 0 && originalTotalUsd != null && t > originalTotalUsd) {
      setConfirm({ t, d, kind: 'raise' });
      return;
    }
    void commit(t, d);
  };

  const typedTotalUsd = toUsd(total);
  const typedDepositUsd = hasDepositStep ? toUsd(deposit) : null;
  const balanceUsd = amountDue('balance', {
    totalUsd: typedTotalUsd,
    depositUsd: typedDepositUsd,
  });
  // amountDue returns null (not 0) on purpose — zero reads as "fully paid" to
  // every consumer. Mirror that here instead of collapsing it back to 0.
  const balanceLabel = formatPrice(balanceUsd, rate, profile?.country_from) ?? '—';
  const paidLabel = formatPrice(paid, rate, profile?.country_from) ?? '—';
  // What the traveler would be owed back at the currently-typed total. Shown
  // live, not only at the confirm step: `amountOutstanding` clamps at zero, so
  // this figure exists nowhere else in the app once the price is saved.
  const overpaidUsd = typedTotalUsd != null && paid > typedTotalUsd ? paid - typedTotalUsd : 0;
  const overpaidLabel = formatPrice(overpaidUsd, rate, profile?.country_from) ?? '—';
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
                setConfirm(null);
                setTotal(t.replace(/[^0-9]/g, ''));
              }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="2000"
              placeholderTextColor="#9A9A9A"
            />

            {/* Hidden, not disabled, when this trip has no deposit step —
                a greyed-out field still reads as "a deposit is possible
                here, later", and it is not. */}
            {hasDepositStep ? (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>Deposit · {currencyUnit}</Text>
                <TextInput
                  style={styles.input}
                  value={deposit}
                  onChangeText={t => {
                    setFormError(null);
                    setConfirm(null);
                    setDeposit(t.replace(/[^0-9]/g, ''));
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="500"
                  placeholderTextColor="#9A9A9A"
                />
              </>
            ) : null}

            <Text style={styles.summary}>
              {hasDepositStep ? 'Final payment' : 'They pay'}: {balanceLabel} · Paid so far:{' '}
              {paidLabel}
            </Text>

            {overpaidUsd > 0 ? (
              <Text style={styles.overpaid}>
                {travelerName} has paid {overpaidLabel} more than this. Swellyo cannot refund
                it — you will need to settle that with them yourself.
              </Text>
            ) : null}

            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            {confirm ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>
                  {confirm.kind === 'raise'
                    ? `${travelerName} has already paid ${paidLabel}. Raising their price will ask them for the difference.`
                    : `${travelerName} has already paid ${paidLabel}, which is more than this new price. They will be marked as fully paid and Swellyo will not refund the ${overpaidLabel} difference — that is between you and them.`}
                </Text>
                <View style={styles.confirmActions}>
                  <Pressable
                    onPress={() => setConfirm(null)}
                    style={({ pressed }) => [styles.confirmCancel, pressed && styles.pressedScale]}
                  >
                    <Text style={styles.confirmCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const c = confirm;
                      setConfirm(null);
                      void commit(c.t, c.d);
                    }}
                    style={({ pressed }) => [styles.confirmAsk, pressed && styles.pressedScale]}
                  >
                    <Text style={styles.confirmAskText}>
                      {confirm.kind === 'raise' ? 'Ask for it' : 'Lower it anyway'}
                    </Text>
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
  overpaid: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: '#B45309',
    marginTop: 8,
    lineHeight: 18,
  },
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
