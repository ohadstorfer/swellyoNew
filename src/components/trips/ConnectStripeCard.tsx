import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchConnectStatus, startConnectOnboarding } from '../../services/trips/tripPaymentsService';
// showErrorAlert(title, error, fallback) — three arguments. It exists to keep a
// raw `e.message` off the screen; never pass one through by hand.
import { showErrorAlert } from '../../utils/friendlyError';
// ff() picks the real weighted family file ('Inter-SemiBold'). A bare
// `fontFamily: 'Inter'` plus `fontWeight: '600'` renders Regular on iOS —
// iOS does not synthesise a weight for a named family. `fontWeight` is kept
// alongside it for web, where the family is one variable face.
import { ff } from '../../theme/fonts';

/**
 * The gate on managed mode. Until Stripe says this operator can accept charges,
 * a trip must not be publishable asking for money it has no way to receive.
 *
 * Status is re-read on every mount because onboarding finishes on Stripe's own
 * site — nothing tells us it happened except asking.
 *
 * This renders in the CREATE wizard's budget step, BEFORE any trip row exists.
 * `stripe-connect-onboard` must therefore never require the caller to already
 * host an operator trip — it did once, and the wizard's hard block on
 * `!stripeReady` turned that into a deadlock no first-time operator could
 * escape. See the comment in that function.
 */
export const ConnectStripeCard: React.FC<{
  onStatusChange: (chargesEnabled: boolean) => void;
}> = ({ onStatusChange }) => {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchConnectStatus();
      setConnected(s.chargesEnabled);
      onStatusChange(s.chargesEnabled);
    } catch (e) {
      // Expected today: the Stripe edge functions aren't deployed yet, so
      // every call lands here. Logged (not surfaced to the operator) so a
      // real failure later than that isn't silently invisible — the caller
      // still reads this as "not connected," never a crash.
      console.warn('[ConnectStripeCard] fetchConnectStatus failed:', e);
      setConnected(false);
      onStatusChange(false);
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onConnect = useCallback(async () => {
    try {
      await startConnectOnboarding();
      // The browser sheet closing tells us nothing about whether they finished,
      // so always re-ask Stripe rather than assuming success.
      await refresh();
    } catch (e) {
      showErrorAlert('Stripe', e, 'Could not open Stripe. Try again.');
    }
  }, [refresh]);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator />
      </View>
    );
  }

  if (connected) {
    return (
      <View style={[styles.card, styles.cardDone]}>
        <Text style={styles.title}>Stripe connected</Text>
        <Text style={styles.sub}>You can collect payments for this trip.</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onConnect}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.title}>Connect Stripe</Text>
      <Text style={styles.sub}>
        Takes a few minutes. You will need your ID and bank details. Money goes
        straight to you.
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#D5D7DA',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    backgroundColor: '#FFFFFF',
  },
  cardDone: { borderColor: '#0788B0', backgroundColor: '#F0F7FA' },
  // Instant feedback on press. 0.97 is the app-wide value for pressables.
  pressed: { transform: [{ scale: 0.97 }] },
  title: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    // Web only — on native this would re-trigger the synthetic-bold path ff()
    // exists to avoid.
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    color: '#181D27',
  },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#535862', marginTop: 4, lineHeight: 18 },
});
