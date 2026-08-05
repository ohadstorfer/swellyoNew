// GettingPaidSheetContent — how the trip collects money, after publish.
// Writes group_trips.payment_mode (via setOperatorTripPaymentMode, which also
// owns the pay requirement rows — never write payment_mode directly).
//
// Same two choices, same copy as the create wizard's "Getting paid" block
// (CreateTripFlowA's pricing step). The wording is deliberately identical: an
// operator who picked "I'll handle payment myself" at publish has to recognise
// the option they are changing.
//
// Card shape follows VisibilitySheetContent rather than the wizard's inline
// rows — this is a sheet, and the sheets in this folder share one look. It also
// uses ff() for weights, which the wizard's own styles predate (a bare
// fontFamily + fontWeight renders Regular on iOS).
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';
import { ConnectStripeCard } from '../ConnectStripeCard';

export type PaymentMode = 'offline' | 'managed';

const C = {
  accent: '#0788B0',
  accentTint: '#E6F4F8',
  ink: '#222B30',
  desc: '#7B7B7B',
  border: '#CFCFCF',
  surface: '#FFFFFF',
  checkboxOffBg: '#F7F7F7',
};

const OPTIONS: { key: PaymentMode; title: string; desc: string }[] = [
  {
    key: 'offline',
    title: "I'll handle payment myself",
    desc: 'Travelers pay you outside the app, however you do it today.',
  },
  {
    key: 'managed',
    title: 'Collect payment in Swellyo',
    desc: 'Travelers pay by card. A deposit now, the rest before the trip.',
  },
];

export const GettingPaidSheetContent: React.FC<{
  value: PaymentMode;
  onChange: (next: PaymentMode) => void;
  /** The trip's deposit, for the line under the managed card. Read-only here —
   *  the amount itself is the Price & deposit row's job, and duplicating the
   *  input would give two places to change one number. */
  depositLabel: string | null;
}> = ({ value, onChange, depositLabel }) => (
  <View style={styles.list}>
    {OPTIONS.map((o) => {
      const selected = value === o.key;
      return (
        <TouchableOpacity
          key={o.key}
          activeOpacity={0.85}
          onPress={() => onChange(o.key)}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={o.title}
          style={[styles.card, selected && styles.cardSelected]}
        >
          <View style={styles.textCol}>
            <Text style={[styles.title, selected && styles.titleSelected]}>{o.title}</Text>
            <Text style={styles.desc}>{o.desc}</Text>
          </View>
          <View style={[styles.checkbox, selected ? styles.checkboxOn : styles.checkboxOff]}>
            {selected ? (
              <MaterialCommunityIcons name="check-bold" size={13} color="#FFFFFF" />
            ) : null}
          </View>
        </TouchableOpacity>
      );
    })}

    {value === 'managed' && (
      <View>
        {/* Mounted only while 'managed' is the draft, so an operator who never
            opens that option is never asked to connect anything. It reads the
            status itself through useConnectStatus — the parent screen reads
            the SAME cached query for its own `validate`, so there is one
            round trip and the two can never disagree. */}
        <ConnectStripeCard />
        <Text style={styles.footnote}>
          {depositLabel
            ? `Travelers pay a ${depositLabel} deposit, then the rest before the trip. Change it in Price & deposit.`
            : 'Travelers pay the whole price in one go. Add a deposit in Price & deposit to split it in two.'}
        </Text>
      </View>
    )}
  </View>
);

const styles = StyleSheet.create({
  list: { gap: 12, paddingVertical: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: C.accent,
    backgroundColor: C.accentTint,
    // Compensates the extra border so the content does not shift on select.
    padding: 15,
  },
  textCol: { flex: 1, gap: 4 },
  title: { fontFamily: ff('Inter', '700'), fontSize: 15, color: C.ink },
  titleSelected: { color: C.accent },
  desc: { fontFamily: ff('Inter', '400'), fontSize: 13, lineHeight: 18, color: C.desc },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: C.accent },
  checkboxOff: {
    backgroundColor: C.checkboxOffBg,
    borderWidth: 1,
    borderColor: C.border,
  },
  footnote: {
    marginTop: 10,
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 17,
    color: C.desc,
  },
});

export default GettingPaidSheetContent;
