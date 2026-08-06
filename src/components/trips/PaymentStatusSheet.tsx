/**
 * PaymentStatusSheet — what the traveler sees when a payment does not simply
 * work.
 *
 * Two things used to happen here, and both were silent in the way that costs
 * real money:
 *
 *  1. `startCheckout` threw and the screen fired `Alert.alert('Payment', …)`.
 *     A one-button OS alert states a problem and offers no way out of it; the
 *     traveler's only move is to tap OK and guess. Apple's own guidance is
 *     that an alert is for a situation the user must be interrupted for, and
 *     that it should carry the action that resolves it — "OK" is not that.
 *
 *  2. Checkout closed, the webhook did not land inside the poll window, and
 *     the row quietly went back to saying "Pay". That is the dangerous one:
 *     the single most likely thing a traveler does when a $2,000 payment
 *     appears not to have registered is pay it again.
 *
 * So this sheet exists to make sure every unhappy path ends in a sentence and
 * a next step. `mode` is the difference between the two:
 *
 *  • `failed`  — nothing is in flight. Say why, offer to retry.
 *  • `pending` — something MIGHT be in flight, and we cannot prove otherwise.
 *    The primary job of this copy is "do not pay again"; the primary action is
 *    to check, not to pay.
 *  • `unconfirmed` — the 30-minute `pending` window has run out and the row is
 *    back to offering "Pay". This is the gate on that tap: the same doubt as
 *    `pending`, but now the traveler is actively trying to pay again, so the
 *    sheet has to let them. **The two buttons swap weight here** — asking the
 *    organiser becomes primary and paying becomes the outline. Refusing to let
 *    someone pay is its own failure mode; making it the second-most obvious
 *    thing on screen is the honest middle.
 *
 * Not an Alert, deliberately: only a sheet can carry two verbs plus a
 * paragraph explaining which to pick, and it inherits the app's sheet physics
 * instead of the OS's.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '../BottomSheetShell';
import { ff } from '../../theme/fonts';

export type PaymentStatusMode = 'failed' | 'pending' | 'unconfirmed';

export const PaymentStatusSheet: React.FC<{
  visible: boolean;
  mode: PaymentStatusMode;
  onClose: () => void;
  /** What this payment was for, e.g. "Deposit". Naming it is what stops the
   *  traveler wondering WHICH of the two payments on the trip this is about. */
  title: string;
  /** `failed` only — the already-friendly reason, from `friendlyErrorMessage`.
   *  Raw error text must never reach this prop. */
  reason?: string | null;
  /** `unconfirmed` only — how long ago the attempt was, already formatted by
   *  `describeAttemptAge` ("about 40 minutes ago"). */
  attemptAge?: string | null;
  /** `failed` → retry the checkout. `pending` → refetch and see if the webhook
   *  has landed. `unconfirmed` → "Pay anyway", which forgets the attempt and
   *  starts a fresh checkout. Either way the sheet closes first and the caller
   *  owns the busy state, so the button never has to survive its own unmount. */
  onRetry: () => void;
  /** Opens the trip chat. The escape hatch that stops a payment problem from
   *  becoming a support ticket nobody files — the operator is one tap away and
   *  is the only person who can actually look this up. */
  onMessageOrganiser?: () => void;
  /** True while the caller is re-checking, so the primary button can say so
   *  rather than the sheet closing on a tap that looks like it did nothing. */
  busy?: boolean;
}> = ({
  visible,
  mode,
  onClose,
  title,
  reason,
  attemptAge,
  onRetry,
  onMessageOrganiser,
  busy = false,
}) => {
  const insets = useSafeAreaInsets();
  const pending = mode === 'pending';
  const unconfirmed = mode === 'unconfirmed';
  // Both doubt states share the amber register. Only `failed` — where we know
  // for certain nothing happened — earns red.
  const waiting = pending || unconfirmed;

  // `unconfirmed` is the one mode where paying is NOT the recommended action,
  // so it is the one mode where the retry button gives up the primary slot.
  // Unless there is nothing to hand it to — a sheet whose only button is an
  // outline reads as having no action at all.
  const payIsPrimary = !unconfirmed || !onMessageOrganiser;

  const retryLabel = unconfirmed ? 'Pay anyway' : pending ? 'Check again' : 'Try again';

  // The server's generic failure message is "Could not start the payment" and
  // this sheet's title is "We couldn't start the payment" — printing both
  // stacked them into a stutter that told the traveler nothing twice. Suppress
  // a reason that only restates the heading, and let the explanatory line
  // below carry the weight instead. Compared on letters alone so wording,
  // case, and punctuation differences ("couldn't" vs "could not") still match.
  const bare = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const reasonText = reason?.trim() || '';
  const reasonAddsNothing =
    !reasonText ||
    (() => {
      const a = bare(reasonText);
      const b = bare("We couldn't start the payment");
      return a.includes(b) || b.includes(a);
    })();

  const retryButton = (
    <Pressable
      key="retry"
      onPress={onRetry}
      disabled={busy}
      style={({ pressed }) => [
        payIsPrimary ? styles.primaryBtn : styles.secondaryBtn,
        payIsPrimary && pending && styles.primaryBtnWait,
        pressed && !busy && styles.btnPressed,
        busy && styles.btnDisabled,
      ]}
    >
      {busy && payIsPrimary ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Text style={payIsPrimary ? styles.primaryText : styles.secondaryText}>{retryLabel}</Text>
      )}
    </Pressable>
  );

  const organiserButton = onMessageOrganiser ? (
    <Pressable
      key="organiser"
      onPress={onMessageOrganiser}
      style={({ pressed }) => [
        payIsPrimary ? styles.secondaryBtn : styles.primaryBtn,
        pressed && styles.btnPressed,
      ]}
    >
      <Text style={payIsPrimary ? styles.secondaryText : styles.primaryText}>
        Message your organiser
      </Text>
    </Pressable>
  ) : null;

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={[styles.surface, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.grabWrap}>
          <View style={styles.grabber} />
        </View>

        {/* The icon carries the tone before a word is read: amber for "we are
            waiting", red for "this did not happen". Amber and not red on
            `pending` on purpose — nothing has gone wrong yet, and a red circle
            over a payment that is probably fine invites exactly the panicked
            second payment this sheet exists to prevent. */}
        <View style={[styles.iconRing, waiting ? styles.iconRingWait : styles.iconRingBad]}>
          {waiting ? (
            <Ionicons name="time-outline" size={26} color="#B26B00" />
          ) : (
            <Ionicons name="alert-circle-outline" size={26} color="#C4361E" />
          )}
        </View>

        <Text style={styles.title}>
          {pending
            ? 'Still confirming your payment'
            : unconfirmed
              ? 'You already started this payment'
              : "We couldn't start the payment"}
        </Text>

        <Text style={styles.body}>
          {pending ? (
            <>
              Your bank may have gone through — we just haven't heard back yet. This
              usually takes a few seconds, and {title.toLowerCase()} will tick itself off
              as soon as it does.
              {'\n\n'}
              <Text style={styles.bodyStrong}>Please don't pay again.</Text> If it's still
              like this in a few minutes, message your organiser and they'll check.
            </>
          ) : unconfirmed ? (
            <>
              You started paying {title.toLowerCase()} {attemptAge || 'a little while ago'} and
              we never got a confirmation. It may still have gone through.
              {'\n\n'}
              <Text style={styles.bodyStrong}>
                Check with your organiser before paying again.
              </Text>{' '}
              They can see straight away whether the money arrived.
            </>
          ) : (
            <>
              {reasonAddsNothing ? (
                <>Something went wrong before you reached the payment page.</>
              ) : (
                <>{reasonText}</>
              )}
              {'\n\n'}
              Nothing was charged. You can try again, or ask your organiser to take a
              look.
            </>
          )}
        </Text>

        {/* Order is by weight, not by kind — on `unconfirmed` the organiser
            button IS the primary one and has to sit on top. */}
        {payIsPrimary ? retryButton : organiserButton}
        {payIsPrimary ? organiserButton : retryButton}

        {/* Dismiss is text, not a third button: it is the one action nobody
            needs help finding, and giving it equal weight would make walking
            away look like a reasonable answer to "did my money arrive?". */}
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.dismissBtn, pressed && styles.btnPressed]}
        >
          <Text style={styles.dismissText}>Not now</Text>
        </Pressable>
      </View>
    </BottomSheetShell>
  );
};

const styles = StyleSheet.create({
  surface: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
  },
  grabWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E4' },
  iconRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 14,
  },
  iconRingBad: { backgroundColor: '#FBEAE6' },
  iconRingWait: { backgroundColor: '#FDF1DC' },
  title: {
    fontFamily: ff('Inter', '700'),
    fontSize: 19,
    fontWeight: '700',
    color: '#212121',
    marginBottom: 8,
  },
  body: {
    fontFamily: ff('Inter', '400'),
    fontSize: 14,
    lineHeight: 21,
    color: '#5E5E5E',
    marginBottom: 20,
  },
  bodyStrong: { fontFamily: ff('Inter', '600'), fontWeight: '600', color: '#212121' },
  primaryBtn: {
    height: 50,
    borderRadius: 25,
    backgroundColor: '#4EB4C9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnWait: { backgroundColor: '#212121' },
  primaryText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryBtn: {
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryText: {
    fontFamily: ff('Inter', '600'),
    fontSize: 15,
    fontWeight: '600',
    color: '#212121',
  },
  dismissBtn: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  dismissText: { fontFamily: ff('Inter', '500'), fontSize: 14, color: '#9A9A9A' },
  // Opacity, not scale: these are full-width and a scale on a 50px-tall bar
  // that touches both margins reads as the sheet flexing, not the button.
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.55 },
});
