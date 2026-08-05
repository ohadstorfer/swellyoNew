import React, { useCallback } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isExpoGo } from '../../utils/keyboardAvoidingView';
// showErrorAlert(title, error, fallback) — three arguments. It exists to keep a
// raw `e.message` off the screen; never pass one through by hand.
import { showErrorAlert } from '../../utils/friendlyError';
// ff() picks the real weighted family file ('Inter-SemiBold'). A bare
// `fontFamily: 'Inter'` plus `fontWeight: '600'` renders Regular on iOS —
// iOS does not synthesise a weight for a named family. `fontWeight` is kept
// alongside it for web, where the family is one variable face.
import { ff } from '../../theme/fonts';
import { useConnectStatus } from '../../hooks/trips/useConnectStatus';
import { describeConnectState, type ConnectState } from '../../services/trips/connectStatus';

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
 * Where an operator connects Stripe, and — more often — where they find out
 * what Stripe is currently doing about it.
 *
 * ── What changed, and why it mattered ───────────────────────────────────────
 * This card used to have two faces: "Connect Stripe" and "Stripe connected",
 * drawn off `charges_enabled`. Stripe's model has six states, and the boolean
 * collapsed "you never finished" together with "you finished and we are
 * checking you". An operator who had just been told by Stripe "We will review
 * the information you submitted" closed the sheet and landed back on a button
 * that said "Connect Stripe" — the same button they had already pressed, and
 * the only thing on screen to press.
 *
 * The six states now live in services/trips/connectStatus.ts, under unit test,
 * along with the copy for each. This file only draws them.
 *
 * ── It is not about a trip ──────────────────────────────────────────────────
 * Nothing here takes a trip id, and `stripe-connect-onboard` refuses to
 * require one. This renders inside the create wizard today and is meant to
 * render in a settings screen tomorrow (Ohad, 2026-08-05: most operators will
 * connect Stripe before their first trip exists). Reading the status through
 * `useConnectStatus` rather than a prop is what makes that a drop-in.
 *
 * ── Deliberately not animated ───────────────────────────────────────────────
 * The state changes here are rare — most operators see two of them, once. The
 * card is allowed to just be correct. The only motion is the app-wide 0.97
 * press scale, which is feedback, not decoration.
 */
export const ConnectStripeCard: React.FC = () => {
  const { state, status, loading, watchForChange } = useConnectStatus();
  const [onboarding, setOnboarding] = React.useState(false);

  const copy = describeConnectState(state, status);

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
    // Closing says nothing about whether they finished — they can back out of
    // the last step, and even finishing only means Stripe has the form, not
    // that it has decided. Re-ask, then keep watching for a minute so an
    // approval that lands while they are still on this screen updates the card
    // in front of them instead of on their next visit.
    watchForChange();
  }, [watchForChange]);

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

  // Only on the very first read. A background refetch keeps the current card
  // on screen — blanking it to a spinner every time we re-ask Stripe would
  // make the poll after onboarding look like the screen was breaking.
  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator />
      </View>
    );
  }

  const tone = TONE[state];
  const body = (
    <>
      <View style={styles.headRow}>
        {tone.icon ? (
          tone.icon === 'spinner' ? (
            // Motion is the message here: something is happening elsewhere and
            // the operator is not being asked for anything.
            <ActivityIndicator size="small" color={tone.iconColor} style={styles.icon} />
          ) : (
            <Ionicons name={tone.icon} size={18} color={tone.iconColor} style={styles.icon} />
          )
        ) : null}
        <Text style={[styles.title, tone.titleColor ? { color: tone.titleColor } : null]}>
          {copy.title}
        </Text>
      </View>
      <Text style={styles.sub}>{copy.body}</Text>
    </>
  );

  // No button to press → not a Pressable. A card that dents under your finger
  // and then does nothing is worse than one that plainly does not respond.
  if (!copy.cta) {
    return <View style={[styles.card, tone.card]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onConnect}
      accessibilityRole="button"
      accessibilityLabel={copy.cta}
      style={({ pressed }) => [styles.card, tone.card, pressed && styles.pressed]}
    >
      {body}
      <Text style={[styles.cta, tone.ctaColor ? { color: tone.ctaColor } : null]}>{copy.cta}</Text>
    </Pressable>
  );
};

const C = {
  accent: '#0788B0',
  accentTint: '#F0F7FA',
  ink: '#181D27',
  sub: '#535862',
  line: '#D5D7DA',
  warn: '#B54708',
  warnTint: '#FFFAEB',
  warnLine: '#F5C77E',
  bad: '#B42318',
  badTint: '#FEF3F2',
  badLine: '#F0B4AE',
};

/** How each state looks. The words live in connectStatus.ts; only the paint is here. */
const TONE: Record<
  ConnectState,
  {
    card?: object;
    icon?: React.ComponentProps<typeof Ionicons>['name'] | 'spinner';
    iconColor?: string;
    titleColor?: string;
    ctaColor?: string;
  }
> = {
  not_started: {},
  incomplete: {},
  // Calm, not alarming: nothing is wrong and there is nothing to do.
  under_review: { card: { borderColor: C.accent, backgroundColor: C.accentTint }, icon: 'spinner', iconColor: C.accent, titleColor: C.accent },
  action_needed: { card: { borderColor: C.warnLine, backgroundColor: C.warnTint }, icon: 'alert-circle-outline', iconColor: C.warn, titleColor: C.warn, ctaColor: C.warn },
  ready: { card: { borderColor: C.accent, backgroundColor: C.accentTint }, icon: 'checkmark-circle', iconColor: C.accent, titleColor: C.accent },
  blocked: { card: { borderColor: C.badLine, backgroundColor: C.badTint }, icon: 'close-circle-outline', iconColor: C.bad, titleColor: C.bad },
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    backgroundColor: '#FFFFFF',
  },
  // Instant feedback on press. 0.97 is the app-wide value for pressables.
  pressed: { transform: [{ scale: 0.97 }] },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  // Fixed width so the title starts in the same place whether the icon is a
  // glyph or a spinner — the two measure differently, and without this the
  // heading shifts sideways the moment Stripe answers.
  icon: { width: 20, marginRight: 8 },
  title: {
    flex: 1,
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    // Web only — on native this would re-trigger the synthetic-bold path ff()
    // exists to avoid.
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    color: C.ink,
  },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: C.sub, marginTop: 4, lineHeight: 18 },
  cta: {
    fontFamily: ff('Inter', '600'),
    ...(Platform.OS === 'web' ? { fontWeight: '600' as const } : null),
    fontSize: 13,
    color: C.accent,
    marginTop: 10,
  },
});
