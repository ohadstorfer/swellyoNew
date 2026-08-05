import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchConnectStatus } from '../../services/trips/tripPaymentsService';
import { isExpoGo } from '../../utils/keyboardAvoidingView';
// showErrorAlert(title, error, fallback) — three arguments. It exists to keep a
// raw `e.message` off the screen; never pass one through by hand.
import { showErrorAlert } from '../../utils/friendlyError';
// ff() picks the real weighted family file ('Inter-SemiBold'). A bare
// `fontFamily: 'Inter'` plus `fontWeight: '600'` renders Regular on iOS —
// iOS does not synthesise a weight for a named family. `fontWeight` is kept
// alongside it for web, where the family is one variable face.
import { ff } from '../../theme/fonts';

/**
 * The native Stripe SDK, loaded only where it can exist.
 *
 * `@stripe/stripe-react-native` is a native module with no JS fallback, so in
 * Expo Go the import itself throws. A top-level `import` would therefore take
 * down the WHOLE create-trip wizard on Expo Go — not just this one card —
 * which is where Ohad tests every day. So it is required lazily, the failure
 * is swallowed, and the result is allowed to be null.
 *
 * Onboarding is native-only by decision (Ohad, 2026-08-04): there is no
 * browser fallback to drop back to. `nativeOnboarding` false means the button
 * explains itself rather than pretending to work.
 */
const stripeConnect = isExpoGo
  ? null
  : (() => {
      try {
        return require('./StripeConnectOnboarding') as typeof import('./StripeConnectOnboarding');
      } catch (e) {
        console.warn('[ConnectStripeCard] native Stripe SDK unavailable:', e);
        return null;
      }
    })();

const Onboarding = stripeConnect?.StripeConnectOnboarding ?? null;
const nativeOnboarding = !!Onboarding && (stripeConnect?.hasStripePublishableKey ?? false);

/**
 * The gate on managed mode. Until Stripe says this operator can accept charges,
 * a trip must not be publishable asking for money it has no way to receive.
 *
 * Status is re-read on every mount, and again whenever onboarding closes.
 * Even though the form is now drawn in-app, the ACCOUNT still changes on
 * Stripe's side and nothing tells us it happened except asking — and the
 * operator can close the flow one step from the end, so a close is not a
 * finish.
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
  const [onboarding, setOnboarding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchConnectStatus();
      setConnected(s.chargesEnabled);
      onStatusChange(s.chargesEnabled);
    } catch (e) {
      // Deliberately swallowed: a status check that fails means "we do not
      // know", and the safe reading of that is "not connected" — never a
      // crash, and never an alert on a screen the operator did not ask a
      // question on. Logged so a real outage is not silently invisible.
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

  const onConnect = useCallback(() => {
    if (!nativeOnboarding) {
      // Expo Go, or a build with no publishable key. There is deliberately no
      // browser fallback — Ohad chose native-only on 2026-08-04 — so say what
      // is actually wrong instead of failing silently.
      showErrorAlert(
        'Stripe',
        null,
        isExpoGo
          ? 'Connecting Stripe needs the full app, not Expo Go. Open a development build and try again.'
          : 'Stripe is not configured in this build.',
      );
      return;
    }
    setOnboarding(true);
  }, []);

  const onOnboardingExit = useCallback(() => {
    setOnboarding(false);
    // Closing the flow says nothing about whether they finished it — they can
    // back out of the last step. Always re-ask Stripe rather than assuming.
    void refresh();
  }, [refresh]);

  if (onboarding && Onboarding) {
    return (
      <Onboarding
        onExit={onOnboardingExit}
        onLoadError={message => {
          // Close first: leaving the sheet up behind an alert strands the
          // operator on a spinner that will never finish.
          setOnboarding(false);
          // `message` is the edge function's own text, which for the common
          // setup failure names the Stripe account that is missing Connect.
          // That is far more use than "try again" — it is not something
          // trying again will fix.
          showErrorAlert('Stripe', null, message || 'Could not open Stripe. Try again.');
        }}
      />
    );
  }

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
