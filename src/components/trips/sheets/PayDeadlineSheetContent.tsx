// PayDeadlineSheetContent — when the full amount is due, on a trip whose
// operator collects payment OUTSIDE the app.
//
// Managed trips never open this: their deadline lives on the `balance`
// requirement row and is edited in Manage requirements, next to the other
// deadlines it moves with. This sheet edits the trip COLUMN
// (offline_payment_due_days_before) that offline trips carry instead — the DB
// refuses pay rows on an offline trip, so a column is the only home their
// deadline has.
//
// Steps through DEADLINE_STEPS, not ±1 — the same named-interval scale
// Manage requirements uses, so "the deadline control" feels like one control
// everywhere it appears after publish. (The create wizard's stepper is looser
// on purpose; once a value is stored, the scale keeps edits tidy.)
//
// Visual weights match SpotsSheetContent (54-height row, 16 radius, 16 gap)
// so the edit screen's sheets don't read as two different products.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';
import {
  isDeadlineAtEnd,
  resolveDeadlineDate,
  stepDeadline,
} from '../../../services/trips/tripDocumentsService';

const C = {
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  borderDisabled: '#E4E4E4',
  surfaceCard: '#FFFFFF',
  iconDisabled: '#CFCFCF',
};

export interface PayDeadlineSheetContentProps {
  daysBefore: number;
  /** The trip's start date, for showing the real date the deadline lands on.
   *  Null (months-only trips) shows the days wording alone — there is no
   *  honest date to name. */
  startDateISO: string | null;
  onChange: (next: number) => void;
}

export const PayDeadlineSheetContent: React.FC<PayDeadlineSheetContentProps> = ({
  daysBefore,
  startDateISO,
  onChange,
}) => {
  const canDecrease = !isDeadlineAtEnd(daysBefore, -1);
  const canIncrease = !isDeadlineAtEnd(daysBefore, 1);
  const due = resolveDeadlineDate(startDateISO, daysBefore);
  const dueLabel = due
    ? due.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.stepperRow}>
        <Pressable
          style={[styles.stepperBtn, !canDecrease && styles.stepperBtnDisabled]}
          onPress={() => onChange(stepDeadline(daysBefore, -1))}
          disabled={!canDecrease}
          accessibilityRole="button"
          accessibilityLabel="Move the deadline closer to the trip"
        >
          <Ionicons
            name="remove"
            size={24}
            color={canDecrease ? C.inkBody : C.iconDisabled}
          />
        </Pressable>

        <View style={styles.stepperValueBox}>
          <Text style={styles.stepperValue}>
            {daysBefore === 1 ? '1 day before' : `${daysBefore} days before`}
          </Text>
          {dueLabel ? <Text style={styles.stepperDate}>{dueLabel}</Text> : null}
        </View>

        <Pressable
          style={[styles.stepperBtn, !canIncrease && styles.stepperBtnDisabled]}
          onPress={() => onChange(stepDeadline(daysBefore, 1))}
          disabled={!canIncrease}
          accessibilityRole="button"
          accessibilityLabel="Move the deadline earlier"
        >
          <Ionicons
            name="add"
            size={24}
            color={canIncrease ? C.inkBody : C.iconDisabled}
          />
        </Pressable>
      </View>

      <Text style={styles.note}>
        Travelers see this in their plan: pay you the full amount by this date.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingTop: 4, paddingBottom: 8, gap: 16 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepperBtn: {
    width: 54,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderField,
    backgroundColor: C.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { borderColor: C.borderDisabled },
  stepperValueBox: {
    flex: 1,
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderField,
    backgroundColor: C.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  stepperValue: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18,
    color: C.inkBody,
    textAlign: 'center',
  },
  stepperDate: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  note: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
  },
});

export default PayDeadlineSheetContent;
