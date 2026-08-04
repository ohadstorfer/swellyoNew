// PriceSheetContent — Price per person + Deposit, the operator Edit-trip
// screen's riskiest row. Both numbers are canonical USD; `currency` is shown
// as a label only (the operator's input currency) — converting here would
// fight the trip's frozen budget_fx_rate. This component never reads or
// writes budget_fx_rate. See spec §7.2 and operatorTripsService.ts's
// updateOperatorTripPrice, which is the only sanctioned write path for
// costPerPerson/depositAmount (it freezes every already-joined traveler's
// price BEFORE the new number lands — never route these two fields through
// the screen's generic `save()`).
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { ff } from '../../../theme/fonts';

export type PriceDraft = { costPerPerson: number | null; depositAmount: number | null };

const C = {
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  surfaceCard: '#FFFFFF',
  errorText: '#C0392B',
};

/** '' -> null, so clearing the field means "not set" and not 0. Anything
 *  that is not a finite number is also null. Only feeds the PARENT value —
 *  the on-screen text is tracked separately in AmountField's own local
 *  state, so a trailing '.' the operator just typed is never silently
 *  stripped out from under them (see AmountField below). */
function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * A single USD amount field. Keeps its own local string so the operator can
 * type freely (including a bare trailing '.') without the parsed-then-
 * restringified prop value fighting back mid-keystroke — same pattern as
 * AgeSheetContent's minStr/maxStr (focus-guarded resync from the parent).
 */
const AmountField: React.FC<{
  label: string;
  value: number | null;
  currency: string;
  hint?: string;
  onChangeValue: (n: number | null) => void;
  accessibilityLabel: string;
}> = ({ label, value, currency, hint, onChangeValue, accessibilityLabel }) => {
  const [text, setText] = useState(value != null ? String(value) : '');
  const [focused, setFocused] = useState(false);

  // Pull in an external change (sheet reopened with a new `initial`) — but
  // never while the operator is actively typing, or every keystroke's
  // round-trip through the parent would stomp the raw text.
  useEffect(() => {
    if (!focused) setText(value != null ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.field}>
        <Text style={styles.prefix}>{currency}</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(t) => {
            const cleaned = t.replace(/[^0-9.]/g, '');
            setText(cleaned);
            onChangeValue(parseAmount(cleaned));
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            // Snap the visible text to the committed number once the
            // operator moves on (e.g. "1." -> "1"). Safe here — it only
            // happens after they've left the field, never mid-type.
            setText(value != null ? String(value) : '');
          }}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={C.textMuted}
          accessibilityLabel={accessibilityLabel}
        />
      </View>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
};

/**
 * Price per person and deposit. Mounted inside EditFieldSheet, which already
 * supplies the surface, bottom-inset padding, Save footer and the
 * `validate`-driven error text — this component renders none of those, and
 * deliberately does not re-render `error` itself when `error` is left unset
 * (see OperatorTripEditScreen's wiring: EditFieldSheet already shows
 * validatePrice/validateDeposit's message once — Task 6 found stacking a
 * second copy via the body's own `error` prop).
 */
export const PriceSheetContent: React.FC<{
  costPerPerson: number | null;
  depositAmount: number | null;
  currency: string | null;
  onChange: (next: PriceDraft) => void;
  error?: string;
}> = ({ costPerPerson, depositAmount, currency, onChange, error }) => {
  const label = currency ?? 'USD';
  return (
    <View style={styles.wrap}>
      <AmountField
        label="Price per person"
        value={costPerPerson}
        currency={label}
        onChangeValue={(n) => onChange({ costPerPerson: n, depositAmount })}
        accessibilityLabel="Price per person"
      />
      <AmountField
        label="Deposit"
        value={depositAmount}
        currency={label}
        hint="Leave empty if travelers pay in one go."
        onChangeValue={(n) => onChange({ costPerPerson, depositAmount: n })}
        accessibilityLabel="Deposit"
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8, gap: 20 },
  block: { gap: 8 },
  label: { fontFamily: ff('Inter', '700'), fontSize: 14, color: C.inkBody },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: C.borderField,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    backgroundColor: C.surfaceCard,
  },
  prefix: { fontFamily: ff('Inter', '400'), fontSize: 15, color: C.textMuted },
  input: { flex: 1, fontFamily: ff('Inter', '400'), fontSize: 16, color: C.inkBody },
  hint: { fontFamily: ff('Inter', '400'), fontSize: 12, color: C.textMuted },
  error: { fontFamily: ff('Inter', '400'), fontSize: 13, color: C.errorText },
});

export default PriceSheetContent;
