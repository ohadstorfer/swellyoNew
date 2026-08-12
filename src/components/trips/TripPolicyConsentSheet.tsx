/**
 * TripPolicyConsentSheet — the cancellation policy, and a tick, before Stripe.
 *
 * Opens on the way to Checkout, once per trip per policy. Not on every payment:
 * this is the one screen between a traveler and the largest payment they will
 * make on Swellyo, and the step people abandon. Asking twice for the same
 * agreement is friction that buys no extra evidence.
 *
 * ⚠️ EVERY WORD ON THIS SHEET COMES FROM `consentCopy()`, and the record stored
 * server-side is `consentText()` over the same fields. Nothing here composes a
 * sentence of its own. If the sheet wrote its own copy, the row that is
 * supposed to prove "we showed them exactly this" would drift from the screen
 * the first time somebody improved the wording.
 *
 * Dressed exactly like PayAmountSheet — same surface, grabber, heading scale
 * and CTA — because it is the same moment in the same flow, one step earlier.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';
import { consentCopy } from '../../services/trips/tripPolicyConsent';
import type { CancellationPolicy } from '../../services/trips/cancellationPolicy';

const ACCENT = '#05BCD3';

/** Square, not the radio dot PayAmountSheet uses: a radio is one of several
 *  choices, a checkbox is an agreement. The shape is the affordance. */
const CheckBox: React.FC<{ checked: boolean }> = ({ checked }) => (
  <View style={[styles.box, checked && styles.boxOn]}>
    {checked ? <Text style={styles.boxTick}>✓</Text> : null}
  </View>
);

export const TripPolicyConsentSheet: React.FC<{
  visible: boolean;
  /** The policy frozen on the trip. Null renders nothing — the caller should
   *  not have opened this at all, and a sheet with no terms in it would be a
   *  tick box agreeing to nothing. */
  policy: CancellationPolicy | null;
  /** Recording is in flight. The CTA waits rather than closing optimistically:
   *  the whole point is the record, so "agreed" must mean it was written. */
  saving?: boolean;
  onAgree: () => void;
  onClose: () => void;
  /** See BottomSheetShell — set when opened from a screen that is itself a
   *  presented Modal, or the sheet silently never appears on iOS. */
  inline?: boolean;
}> = ({ visible, policy, saving = false, onAgree, onClose, inline }) => {
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState(false);

  // A fresh open always starts unticked. Carrying the tick over from a sheet
  // they backed out of would let the next payment through on an agreement
  // nobody made this time.
  useEffect(() => {
    if (visible) setChecked(false);
  }, [visible]);

  if (!policy) return null;
  const copy = consentCopy(policy);

  return (
    <BottomSheetShell visible={visible} onClose={onClose} inline={inline}>
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabWrap}>
          <View style={styles.grabber} />
        </View>

        <Text style={styles.heading}>Before you pay</Text>
        <Text style={styles.sub}>
          This trip has its own refund rules. They are set by the operator and do not change
          once you have paid.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{copy.title}</Text>
          {copy.steps.map(line => (
            <View key={line} style={styles.stepRow}>
              <View style={styles.bullet} />
              <Text style={styles.stepText}>{line}</Text>
            </View>
          ))}
          {copy.notes ? <Text style={styles.notes}>{copy.notes}</Text> : null}
          <Text style={styles.footer}>{copy.footer}</Text>
        </View>

        <Pressable
          onPress={() => setChecked(v => !v)}
          disabled={saving}
          style={({ pressed }) => [
            styles.tickRow,
            checked && styles.tickRowOn,
            pressed && styles.pressedScale,
          ]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel="I agree to this cancellation policy"
        >
          <CheckBox checked={checked} />
          <Text style={styles.tickText}>I have read and agree to this cancellation policy</Text>
        </Pressable>

        <Pressable
          onPress={checked && !saving ? onAgree : undefined}
          disabled={!checked || saving}
          style={({ pressed }) => [
            styles.continueBtn,
            pressed && checked && !saving && styles.pressedScale,
            (!checked || saving) && styles.continueDisabled,
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.continueText}>Agree and continue</Text>
          )}
        </Pressable>
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // BottomSheetShell is headless — every consumer paints its own surface.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  heading: {
    fontFamily: ff('Montserrat', '700'),
    fontWeight: '700',
    fontSize: 18,
    color: '#181D27',
    marginTop: 8,
  },
  sub: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: '#535862',
    marginTop: 4,
    marginBottom: 16,
  },
  // The terms themselves, boxed off from our framing around them: what is
  // inside this card is what the record says was shown.
  card: {
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  cardTitle: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600',
    fontSize: 14,
    color: '#181D27',
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  // Aligned to the first line's cap height rather than centred on the row: a
  // step that wraps to two lines would otherwise float its dot to the middle.
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9A9A9A',
    marginTop: 7,
  },
  stepText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: '#414651',
  },
  notes: {
    fontFamily: ff('Inter', '400'),
    fontSize: 13,
    lineHeight: 18,
    color: '#414651',
  },
  footer: {
    fontFamily: ff('Inter', '400'),
    fontSize: 12,
    lineHeight: 16,
    color: '#717680',
  },
  tickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#EAECF0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 14,
  },
  tickRowOn: { borderColor: ACCENT, backgroundColor: '#F4FCFD' },
  tickText: {
    flex: 1,
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 20,
    color: '#181D27',
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#D5D7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: ACCENT, backgroundColor: ACCENT },
  boxTick: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  // The app's one primary CTA (same clothes as PayAmountSheet's Continue).
  continueBtn: {
    height: 56,
    borderRadius: 12,
    backgroundColor: '#212121',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  continueDisabled: { opacity: 0.5 },
  continueText: {
    fontFamily: ff('Montserrat', '600'),
    fontWeight: '600',
    fontSize: 16,
    color: '#FFFFFF',
  },
  pressedScale: { transform: [{ scale: 0.98 }] },
});
