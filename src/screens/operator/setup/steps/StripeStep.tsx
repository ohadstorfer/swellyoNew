/**
 * Step 1 — get paid through Stripe (Figma 15225-20972, done: 15234-21180).
 *
 * Two faces, chosen by the SAME rule the checklist uses (`canCollectPayments`
 * via operatorSetupSteps), so this screen can never say "done" while the
 * checklist says otherwise:
 *   · not connected yet → the Stripe card; Continue opens Stripe's own form;
 *   · connected (ready / under review / action needed) → account details.
 *
 * ⚠️ THE FIGMA'S BULLETS ARE NOT COPIED. It promised "No platform fees until
 * your first booking" and "Dispute protection and 24/7 support". Swellyo takes
 * 12% of each payment (services/terms/operatorAgreement.ts) and offers neither.
 * Every line below is something the payment code already does.
 *
 * The "I will not be using Stripe Connect" row is left out on purpose (Ohad,
 * 15 Sep).
 */
import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useConnectStatus } from '../../../../hooks/trips/useConnectStatus';
import { useStripeOnboarding } from '../../../../components/trips/ConnectStripeCard';
import {
  canCollectPayments,
  describeConnectState,
  type ConnectState,
} from '../../../../services/trips/connectStatus';
import { openStripeDashboard } from '../../../../services/trips/tripPaymentsService';
import { showErrorAlert } from '../../../../utils/friendlyError';
import { TripIcon } from '../../../../components/trips/tripIcons';
import { textStyle, textStyles } from '../../../../theme/typography';
import { useWizard } from '../OperatorSetupWizard';
import { C, CheckBadge, FOOTER_SPACE, StatusNote, StepHeading, useWizardFooter } from '../setupUi';

const STRIPE_WORDMARK = require('../../../../../assets/images/operator/stripe-wordmark.png');

const BULLETS = [
  'Collect deposits and full payments from travelers',
  'Payouts go straight to your bank account',
  'Card and bank payments, handled by Stripe',
  'Refund travelers from your own Stripe balance',
];

const STATUS_LABEL: Partial<Record<ConnectState, { text: string; color: string }>> = {
  ready: { text: 'Active', color: C.ok },
  under_review: { text: 'Pending', color: C.warn },
  action_needed: { text: 'Action needed', color: C.danger },
};

export const StripeStep: React.FC = () => {
  const { next } = useWizard();
  const { state, status, loading } = useConnectStatus();
  const { start, element } = useStripeOnboarding();
  const connected = canCollectPayments(state);
  const copy = describeConnectState(state, status);

  useWizardFooter({
    label: 'Continue',
    busy: loading,
    // Not connected and Stripe has something to open → open it. Otherwise
    // (connected, or a state with nothing to press, like a refused account)
    // move on; the checklist still shows the step as unfinished.
    onPress: () => (!connected && copy.cta ? start() : next()),
  });

  if (element) return element;

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (connected) {
    const label = STATUS_LABEL[state];
    return (
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: FOOTER_SPACE }]}>
        <View style={s.hero}>
          <View style={s.badgeGlow}>
            <LinearGradient colors={['#84EBB4', C.ok]} style={s.badge}>
              <TripIcon name="check" size={24} color="#FFFFFF" strokeWidth={1.75} />
            </LinearGradient>
          </View>
          <Text style={s.doneTitle}>
            {state === 'ready' ? 'Stripe connected' : 'Details sent to Stripe'}
          </Text>
          <Text style={s.doneBody}>
            {state === 'ready'
              ? 'You can now collect traveler payments and receive payouts.'
              : copy.body}
          </Text>
        </View>

        <View style={s.details}>
          <Text style={s.detailsTitle}>Account details</Text>
          {status.accountId ? (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>Stripe ID</Text>
              <Text style={s.detailValue} numberOfLines={1} selectable>
                {status.accountId}
              </Text>
            </View>
          ) : null}
          {label ? (
            <View style={s.detailRow}>
              <Text style={s.detailLabel}>Status</Text>
              <Text style={[s.detailValue, { color: label.color }]}>{label.text}</Text>
            </View>
          ) : null}
        </View>

        {state === 'action_needed' ? (
          <Pressable
            onPress={async () => {
              try {
                await openStripeDashboard();
              } catch (e) {
                showErrorAlert('Stripe', e, 'Could not open your Stripe dashboard. Try again.');
              }
            }}
            accessibilityRole="button"
            style={({ pressed }) => [s.link, pressed && s.pressed]}
          >
            <Text style={s.linkText}>Open Stripe</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={[s.body, { paddingBottom: FOOTER_SPACE }]}>
      <StepHeading
        title="Get paid"
        sub="Connect Stripe to collect traveler payments and receive payouts directly to your bank account."
      />

      <View style={s.stripeCard}>
        <View style={s.stripeMain}>
          <View style={s.logoBlock}>
            <Image
              source={STRIPE_WORDMARK}
              style={s.wordmark}
              resizeMode="contain"
              accessibilityLabel="Stripe"
            />
            <Text style={s.tagline}>Secure payment processing</Text>
          </View>
          <View style={s.bullets}>
            {BULLETS.map(b => (
              <View key={b} style={s.bullet}>
                <TripIcon name="check-circle-broken" size={18} color={C.ok} strokeWidth={1.33} />
                <Text style={s.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        </View>
        <CheckBadge />
      </View>

      {/* Anything past "never started" has something to say — a form left
          half done, or a refusal. */}
      {state !== 'not_started' ? (
        <View style={s.state}>
          <StatusNote
            tone={state === 'blocked' ? 'danger' : 'warn'}
            title={copy.title}
            body={copy.body}
          />
        </View>
      ) : null}

      <View style={s.secure}>
        <TripIcon name="shield-01" size={18} color={C.muted} />
        <Text style={s.secureText}>
          Your financial details are handled by Stripe and never stored on Swellyo.
        </Text>
      </View>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: FOOTER_SPACE },
  body: { paddingHorizontal: 16, paddingTop: 35 },

  stripeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.accent,
    backgroundColor: C.card,
  },
  stripeMain: { flex: 1, gap: 24 },
  logoBlock: { gap: 4 },
  wordmark: { width: 94, height: 39 },
  tagline: { ...textStyles.MB2, color: C.muted },
  bullets: { gap: 8 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { flex: 1, ...textStyles.B3, color: C.ink },

  state: { marginTop: 16 },

  secure: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 32, paddingHorizontal: 6 },
  secureText: { flex: 1, ...textStyles.B3, color: C.muted },

  hero: { alignItems: 'center', gap: 8, paddingHorizontal: 13, marginBottom: 40 },
  badgeGlow: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: C.ok,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 6,
  },
  badge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...textStyles.MH3, color: C.ink, textAlign: 'center' },
  doneBody: { ...textStyles.B3, color: C.ink, textAlign: 'center' },

  details: { padding: 16, borderRadius: 24, backgroundColor: C.card, gap: 8 },
  detailsTitle: { ...textStyle('B3', '700'), color: C.ink },
  detailRow: { flexDirection: 'row', gap: 10 },
  detailLabel: { flex: 1, ...textStyles.B3, color: C.ink },
  detailValue: { flex: 1, ...textStyles.B3, color: C.ink, textAlign: 'right' },

  link: { alignSelf: 'center', marginTop: 16, padding: 8 },
  linkText: { ...textStyle('MB2', '700'), color: C.ink },
  pressed: { transform: [{ scale: 0.97 }] },
});
