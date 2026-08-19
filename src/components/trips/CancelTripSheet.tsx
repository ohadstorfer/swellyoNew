/**
 * CancelTripSheet — the operator calls the trip off, and everybody gets paid back.
 *
 * Opens from "Cancel trip" in the trip menu, replacing a bare `Alert.alert` that
 * said nothing about money on a trip that had collected thousands of dollars.
 *
 * Four things this insists on:
 *
 * 1. **The consequences are numbers, not adjectives.** "8 travelers · $4,850
 *    refunded in full" is what makes this decision real. Best practice for a
 *    destructive action that touches OTHER people's money is a consequence list
 *    with the actual figures — not type-to-confirm, which adds friction without
 *    adding comprehension and is reserved for deleting whole accounts.
 * 2. **The refund is stated, never asked.** When the operator cancels, everyone
 *    gets 100% back and the trip's cancellation policy does not apply — that
 *    policy governs a TRAVELER who backs out. Offering a choice here would
 *    invite operators to invent terms their travelers never agreed to.
 * 3. **There is a door before the point of no return.** "Contact us" sits above
 *    the red button, not after it, because everything unusual — refunding part,
 *    moving people to another trip — is still possible while the trip is alive
 *    and impossible once it is not.
 * 4. **The result is a screen, not a toast.** Cancelling takes a second;
 *    refunds take minutes to reach Stripe and days to reach a bank, and some
 *    are refused outright when the operator's balance is short. A sheet that
 *    closed on success would be claiming an outcome it does not know yet.
 *
 * ⚠️ Both phases live in ONE sheet on purpose. A second BottomSheetShell mounted
 * as a sibling of a presented Modal is resolved by RN to the root view
 * controller — which is already presenting — and never surfaces on iOS. Swapping
 * the body of one sheet has no such problem.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { formatExactUsd } from './plan/PlanSections';
import { ff } from '../../theme/fonts';
import {
  cancelTripWithRefunds,
  type CancelRefundOutcome,
  type CancelTripResult,
} from '../../services/trips/groupTripsService';

const ACCENT = '#05BCD3';
const DANGER = '#B3261E';
const OK = '#0D6A5E';
const WARN = '#9A5E12';

/**
 * ⚠️ CONFIRM THIS ADDRESS before shipping. There is no in-app support channel,
 * so "Contact us" is a mailto — the cheapest thing that actually reaches a
 * human. If a Swelly support route is ever built, this is the one call site.
 */
const SUPPORT_EMAIL = 'support@swellyo.com';

/** One row of the result list. */
const OutcomeRow: React.FC<{ name: string; outcome: CancelRefundOutcome }> = ({ name, outcome }) => {
  const label =
    outcome.status === 'succeeded'
      ? 'Refunded'
      : outcome.status === 'already_refunded'
        ? 'Already refunded'
        : outcome.status === 'blocked_insufficient_balance'
          ? 'Needs balance'
          : 'Failed';

  const tone =
    outcome.status === 'succeeded' || outcome.status === 'already_refunded'
      ? styles.stateOk
      : outcome.status === 'blocked_insufficient_balance'
        ? styles.stateWarn
        : styles.stateBad;

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        {outcome.message ? <Text style={styles.rowNote}>{outcome.message}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        {outcome.amountUsd > 0 ? (
          <Text style={styles.rowAmount}>{formatExactUsd(outcome.amountUsd)}</Text>
        ) : null}
        <Text style={[styles.state, tone]}>{label}</Text>
      </View>
    </View>
  );
};

export const CancelTripSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string;
  /** Travelers who lose their spot. Excludes the operator — they are not a guest
   *  on their own trip, and counting them inflates the one number that matters. */
  travelerCount: number;
  /** Everything collected through Stripe on this trip, net of refunds already
   *  issued. Drives the headline figure and whether money is mentioned at all. */
  paidUsd: number;
  /** The trip never collected through Swellyo, so there is nothing to send back
   *  and saying "refunded in full" would be a lie. */
  isOffline: boolean;
  /** Resolves a user id to a display name for the result list. */
  nameFor: (userId: string) => string;
  /**
   * Fired as soon as the trip is cancelled — BEFORE the operator dismisses the
   * result. The trip is already cancelled on the server at that point, so the
   * caller must update its cache then, not on close, or backing out of the sheet
   * would leave a live-looking trip on screen.
   */
  onCancelled: (result: CancelTripResult) => void;
  /** Render as a LAYER inside an already-presented Modal. See the header. */
  inline?: boolean;
}> = ({
  visible,
  onClose,
  tripId,
  tripTitle,
  travelerCount,
  paidUsd,
  isOffline,
  nameFor,
  onCancelled,
  inline,
}) => {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CancelTripResult | null>(null);

  // A fresh open starts clean. A sheet still showing last week's result reads as
  // a glitch rather than a memory.
  useEffect(() => {
    if (visible) {
      setBusy(false);
      setError(null);
      setResult(null);
    }
  }, [visible]);

  const hasMoney = !isOffline && paidUsd > 0;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await cancelTripWithRefunds({ tripId });
      // Tell the caller immediately: the trip is cancelled on the server whether
      // or not every refund landed, and whether or not this sheet is dismissed.
      onCancelled(res);
      setResult(res);
    } catch (e: any) {
      setError(e?.message ?? 'Could not cancel the trip. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const contactSupport = () => {
    const subject = encodeURIComponent(`Help before cancelling: ${tripTitle}`);
    const body = encodeURIComponent(
      `Hi Swellyo,\n\nI need help with my trip "${tripTitle}" before I cancel it.\n\nWhat I need:\n`,
    );
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {
      setError(`Could not open your mail app. Write to us at ${SUPPORT_EMAIL}.`);
    });
  };

  // ── Phase 2: what actually happened ────────────────────────────────
  if (result) {
    const refunds = result.refunds;
    const blocked = refunds.filter(r => r.status === 'blocked_insufficient_balance');
    const failed = refunds.filter(r => r.status === 'failed');
    const needsRetry = blocked.length + failed.length > 0;
    const sentUsd = refunds
      .filter(r => r.status === 'succeeded')
      .reduce((sum, r) => sum + r.amountUsd, 0);

    return (
      <BottomSheetShell visible={visible} onClose={onClose} inline={inline} swipeToDismiss={false}>
        <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={styles.grabWrap}>
            <View style={styles.grabber} />
          </View>

          <Text style={styles.heading}>Trip cancelled</Text>
          <Text style={styles.sub}>
            {refunds.length === 0
              ? 'Everyone has been notified.'
              : `Everyone has been notified. ${formatExactUsd(sentUsd)} is on its way back — travelers see it in 5–10 business days.`}
          </Text>

          {result.error ? (
            <View style={styles.errorBox} accessibilityLiveRegion="polite">
              <Text style={styles.errorText}>{result.error}</Text>
            </View>
          ) : null}

          {refunds.length > 0 && (
            <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
              {refunds.map(r => (
                <OutcomeRow key={r.paymentEventId} name={nameFor(r.userId)} outcome={r} />
              ))}
            </ScrollView>
          )}

          {needsRetry ? (
            <>
              <Text style={styles.note}>
                {blocked.length > 0
                  ? 'Refunds only come out of money you already hold. Add funds in Stripe or wait for your next payout, then try again — nothing is refunded twice.'
                  : 'Some refunds did not go through. Trying again is safe — nothing is refunded twice.'}
              </Text>
              <Pressable
                onPress={run}
                disabled={busy}
                style={({ pressed }) => [
                  styles.ctaRetry,
                  busy && styles.ctaOff,
                  pressed && !busy && styles.pressedScale,
                ]}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color="#04363C" />
                ) : (
                  <Text style={styles.ctaRetryText}>
                    {`Retry ${blocked.length + failed.length} refund${blocked.length + failed.length === 1 ? '' : 's'}`}
                  </Text>
                )}
              </Pressable>
            </>
          ) : null}

          {error ? (
            <View style={styles.errorBox} accessibilityLiveRegion="polite">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.quiet, pressed && styles.pressedScale]}
            accessibilityRole="button"
          >
            <Text style={styles.quietText}>Done</Text>
          </Pressable>
        </View>
      </BottomSheetShell>
    );
  }

  // ── Phase 1: are you sure? ─────────────────────────────────────────
  return (
    <BottomSheetShell visible={visible} onClose={busy ? () => {} : onClose} inline={inline}>
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabWrap}>
          <View style={styles.grabber} />
        </View>

        <Text style={styles.heading}>Cancel this trip?</Text>
        <Text style={styles.sub} numberOfLines={2}>
          {tripTitle}
        </Text>

        <View style={styles.bullets}>
          {travelerCount > 0 && (
            <Text style={styles.bullet}>
              {`•  ${travelerCount} traveler${travelerCount === 1 ? '' : 's'} lose their spot`}
            </Text>
          )}
          {hasMoney && (
            <Text style={styles.bullet}>
              {`•  ${formatExactUsd(paidUsd)} is refunded in full — everything paid goes back, in 5–10 business days`}
            </Text>
          )}
          {isOffline && paidUsd > 0 && (
            <Text style={styles.bullet}>
              •  Money was paid outside Swellyo, so you have to refund it yourself
            </Text>
          )}
          <Text style={styles.bullet}>•  Everyone is notified right away</Text>
          <Text style={styles.bullet}>•  This can't be undone</Text>
        </View>

        {hasMoney && (
          <Text style={styles.note}>
            Your trip's cancellation policy doesn't apply here — it covers travelers who back out.
            When you cancel, everyone gets everything back.
          </Text>
        )}

        <Text style={styles.help}>
          Need anything else — refunding part, moving people to another trip?{' '}
          <Text style={styles.helpLink} onPress={contactSupport} accessibilityRole="link">
            Contact us
          </Text>{' '}
          before cancelling.
        </Text>

        {error ? (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={run}
          disabled={busy}
          style={({ pressed }) => [styles.cta, busy && styles.ctaOff, pressed && !busy && styles.pressedScale]}
          accessibilityRole="button"
        >
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color="#FFFFFF" />
              {/* A bulk refund is several Stripe calls per traveler and can run
                  for the better part of a minute. A bare spinner on a button
                  that just took someone's trip away reads as a hang. */}
              <Text style={styles.ctaText}>{hasMoney ? 'Cancelling and refunding…' : 'Cancelling…'}</Text>
            </View>
          ) : (
            <Text style={styles.ctaText}>
              {hasMoney ? `Cancel trip & refund ${formatExactUsd(paidUsd)}` : 'Cancel trip'}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={busy ? undefined : onClose}
          disabled={busy}
          style={({ pressed }) => [styles.quiet, pressed && !busy && styles.pressedScale]}
          accessibilityRole="button"
        >
          <Text style={[styles.quietText, busy && styles.quietOff]}>Keep trip</Text>
        </Pressable>
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  // ⚠️ BottomSheetShell paints the BACKDROP ONLY — it is headless, and every
  // sheet supplies its own surface. Without these three lines the sheet renders
  // transparent and the screen behind it shows straight through the content.
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 6,
    gap: 10,
  },
  grabWrap: { alignItems: 'center', paddingBottom: 6 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0' },

  heading: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 17, color: '#222B30' },
  sub: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', marginTop: -4 },

  bullets: { gap: 7, marginTop: 2 },
  bullet: { fontFamily: ff('Inter', '400'), fontSize: 13.5, color: '#222B30', lineHeight: 19 },

  note: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', lineHeight: 18 },

  help: { fontFamily: ff('Inter', '400'), fontSize: 13, color: '#7B7B7B', lineHeight: 18 },
  helpLink: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, color: ACCENT },

  list: { maxHeight: 240 },
  listInner: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEEEEE',
  },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontFamily: ff('Inter', '500'), fontWeight: '500' as const, fontSize: 14, color: '#222B30' },
  rowNote: { fontFamily: ff('Inter', '400'), fontSize: 11.5, color: '#7B7B7B', lineHeight: 16 },
  rowRight: { alignItems: 'flex-end', gap: 3 },
  rowAmount: {
    fontFamily: ff('Inter', '500'),
    fontWeight: '500' as const,
    fontSize: 13,
    color: '#222B30',
    fontVariant: ['tabular-nums'],
  },
  state: {
    fontFamily: ff('Inter', '600'),
    fontWeight: '600' as const,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    borderRadius: 5,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stateOk: { color: OK, backgroundColor: '#E4F0EE' },
  stateWarn: { color: WARN, backgroundColor: '#F7EDDE' },
  stateBad: { color: DANGER, backgroundColor: '#FDECEA' },

  errorBox: {
    borderWidth: 1,
    borderColor: DANGER,
    backgroundColor: '#FDECEA',
    borderRadius: 10,
    padding: 11,
  },
  errorText: { fontFamily: ff('Inter', '400'), fontSize: 13, color: DANGER, lineHeight: 18 },

  cta: {
    backgroundColor: DANGER,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ctaRetry: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ctaRetryText: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 15, color: '#04363C' },
  ctaOff: { opacity: 0.45 },
  ctaText: { fontFamily: ff('Inter', '600'), fontWeight: '600' as const, fontSize: 15, color: '#FFFFFF' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  quiet: { alignItems: 'center', paddingVertical: 12 },
  quietText: { fontFamily: ff('Inter', '500'), fontWeight: '500' as const, fontSize: 14, color: '#7B7B7B' },
  quietOff: { opacity: 0.4 },

  // Subtle on purpose — a big scale on a full-width row reads as the whole
  // sheet moving.
  pressedScale: { transform: [{ scale: 0.98 }] },
});
