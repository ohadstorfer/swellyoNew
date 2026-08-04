// SpotsSheetContent — how many people can be on the trip.
//
// The minus button stops at the number of people already on the trip
// (participant_count, host included). That is the same floor
// validateSpots (tripValidation.ts) enforces and the same one the DB
// trigger (20260803100000_operator_trip_edit_guards.sql) enforces —
// spec §7.1. Three layers saying one thing on purpose: the button makes
// the wrong value hard to reach, the validator explains it, and the
// trigger makes it impossible.
//
// Visual weights match CreateTripFlowA's inline "Max participants" stepper
// (54x54 square buttons, 16 border radius, 16 gap) so the wizard and this
// screen don't read as two different products.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ff } from '../../../theme/fonts';

const MIN_SPOTS = 2;
const MAX_SPOTS = 50;

const C = {
  inkBody: '#222B30',
  textMuted: '#7B7B7B',
  borderField: '#CFCFCF',
  borderDisabled: '#E4E4E4',
  surfaceCard: '#FFFFFF',
  iconDisabled: '#CFCFCF',
};

export interface SpotsSheetContentProps {
  value: number | null;
  participantCount: number;
  onChange: (next: number) => void;
}

export const SpotsSheetContent: React.FC<SpotsSheetContentProps> = ({
  value,
  participantCount,
  onChange,
}) => {
  // A trip with no cap yet (value === null) starts the stepper at the floor,
  // never below it — same floor the minus button itself won't cross.
  const floor = Math.max(MIN_SPOTS, participantCount);
  const current = value ?? floor;
  const canDecrease = current > floor;
  const canIncrease = current < MAX_SPOTS;

  const note =
    participantCount === 0
      ? ''
      : current === participantCount
        ? `This closes the trip — all ${current} spots are taken.`
        : `${participantCount} of ${current} spots are taken.`;

  return (
    <View style={styles.wrap}>
      <View style={styles.stepperRow}>
        <Pressable
          style={[styles.stepperBtn, !canDecrease && styles.stepperBtnDisabled]}
          onPress={() => onChange(current - 1)}
          disabled={!canDecrease}
          accessibilityRole="button"
          accessibilityLabel="Fewer spots"
        >
          <Ionicons
            name="remove"
            size={24}
            color={canDecrease ? C.inkBody : C.iconDisabled}
          />
        </Pressable>

        <View style={styles.stepperValueBox}>
          <Text style={styles.stepperValue}>{current}</Text>
        </View>

        <Pressable
          style={[styles.stepperBtn, !canIncrease && styles.stepperBtnDisabled]}
          onPress={() => onChange(current + 1)}
          disabled={!canIncrease}
          accessibilityRole="button"
          accessibilityLabel="More spots"
        >
          <Ionicons
            name="add"
            size={24}
            color={canIncrease ? C.inkBody : C.iconDisabled}
          />
        </Pressable>
      </View>

      {!!note && <Text style={styles.note}>{note}</Text>}
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
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderField,
    backgroundColor: C.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontFamily: ff('Montserrat', '700'),
    fontSize: 18,
    color: C.inkBody,
    textAlign: 'center',
  },
  note: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
  },
});

export default SpotsSheetContent;
