/**
 * The cancellation-policy gate: one `await` in front of every checkout.
 *
 * Two screens open Stripe Checkout — `TravelerOnboardingScreen` (the deposit,
 * which never opens an amount sheet and goes straight out to Stripe) and
 * `TripDetailScreen` (task rows, "Pay now", and the partial-payment sheet).
 * The consent has to sit in front of BOTH or the first and largest payment
 * escapes it, which is exactly the trap
 * docs/specs/operator-trips/refunds-and-merchant-of-record.md §4d warns about.
 *
 * So the gate is a hook, not a sheet each screen wires up its own way:
 *
 *     const consent = useTripPolicyConsent(tripId, userId, isManagedTrip);
 *     ...
 *     if (!(await consent.ensureConsent())) return;   // they backed out
 *     await startCheckout(...)
 *     ...
 *     <TripPolicyConsentSheet {...consent.sheetProps} />
 *
 * `ensureConsent()` resolves true when there is nothing to ask (no policy on
 * the trip, or already agreed to these exact words) — so the common path costs
 * nothing and the call site stays one line.
 *
 * ⚠️ IT FAILS OPEN, DELIBERATELY. If the policy cannot be read, or the consent
 * cannot be written, the payment proceeds. A missing audit row is a problem
 * for us; a traveler who cannot pay for their trip because our evidence table
 * is unreachable is a problem for them, and they are not the ones who should
 * carry it. Note also that the RPC does not exist until
 * `20260812000100_consent_records.sql` is applied BY HAND — failing closed
 * would mean shipping this client before that migration takes payments down.
 * Hard enforcement belongs server-side, in `payments-checkout`, once every
 * build in the field records consent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CancellationPolicy } from '../services/trips/cancellationPolicy';
import {
  consentText,
  fetchTripPolicy,
  hasConsentedToPolicy,
  recordPolicyConsent,
} from '../services/trips/tripPolicyConsent';

/** What we know about this trip's policy and this traveler's agreement to it. */
type Gate = {
  policy: CancellationPolicy | null;
  /** True also means "nothing to ask" — no policy is not a missing agreement. */
  consented: boolean;
};

/** Nothing to ask. The value returned for a trip with no policy, and the one
 *  every failure degrades to. */
const OPEN: Gate = { policy: null, consented: true };

/** Backstop for a dropped `onDismissed`. Comfortably past the shell's own
 *  exit (220ms slide + its 120ms unmount fallback) plus UIKit's teardown, so
 *  in practice the real callback always wins the race. */
const DISMISS_FALLBACK_MS = 700;

export function useTripPolicyConsent(
  tripId: string,
  userId: string | null,
  /** False on a trip that never takes payments — skips both reads entirely. */
  enabled: boolean,
) {
  const [policy, setPolicy] = useState<CancellationPolicy | null>(null);
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // The authoritative copy. State drives the sheet; this drives the decision,
  // because `ensureConsent` can be called from a handler holding a closure
  // older than the last render — and because agreeing UPDATES it, which the
  // memoised load promise below can never do.
  //
  // `null` is "not read yet", NOT "nothing to ask". Those must be different
  // values: the fast path below returns true on `consented`, so an unloaded
  // gate that defaulted to OPEN would wave every first payment straight
  // through before the policy had even been read.
  const gateRef = useRef<Gate | null>(null);
  // The in-flight read, so a tap that lands mid-load waits for it instead of
  // starting a second one.
  const loadRef = useRef<Promise<Gate> | null>(null);
  const resolveRef = useRef<((agreed: boolean) => void) | null>(null);
  // The answer, held from the tap until the sheet's Modal is FULLY gone —
  // see `closeWith`. `null` means nothing is waiting to be handed back.
  const pendingAnswerRef = useRef<boolean | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // A screen that unmounts mid-question is a "no". Leaving the promise
      // hanging would strand the caller's `await` forever, and with it the
      // pay button it is holding. There is no Modal left to wait for here, so
      // this one resolves straight away.
      if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
      pendingAnswerRef.current = null;
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  // Re-reading is only correct when the identity changes; the policy is frozen
  // on the trip and cannot change under us mid-session.
  useEffect(() => {
    loadRef.current = null;
    gateRef.current = null;
    setPolicy(null);
  }, [tripId, userId, enabled]);

  const load = useCallback((): Promise<Gate> => {
    if (loadRef.current) return loadRef.current;

    const run = (async (): Promise<Gate> => {
      if (!enabled || !tripId || !userId) return OPEN;
      const found = await fetchTripPolicy(tripId);
      if (!found) return OPEN;
      const already = await hasConsentedToPolicy(tripId, userId, consentText(found));
      return { policy: found, consented: already };
    })()
      .then(gate => {
        gateRef.current = gate;
        if (aliveRef.current) setPolicy(gate.policy);
        return gate;
      })
      .catch(err => {
        // Dropped, not cached: a transient failure must not disable the gate
        // for the rest of the session. The next tap reads again.
        loadRef.current = null;
        console.warn('[policyConsent] could not read the policy — letting the payment through:', err);
        return OPEN;
      });

    loadRef.current = run;
    return run;
  }, [enabled, tripId, userId]);

  // Warm it while the screen is idle so the tap that matters isn't waiting on
  // two round trips before Stripe even opens.
  useEffect(() => {
    if (!enabled || !tripId || !userId) return;
    void load();
  }, [enabled, tripId, userId, load]);

  /** Hand the answer back to the waiting `ensureConsent()` and forget it. */
  const settle = useCallback((agreed: boolean) => {
    if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
    pendingAnswerRef.current = null;
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(agreed);
  }, []);

  /**
   * Close the sheet, and hand the answer back only once its Modal is GONE.
   *
   * ⚠️ NOT on the tap. Every caller of `ensureConsent()` continues into
   * something that presents natively — TripDetailScreen's "Pay now" opens
   * PayAmountSheet (another RN Modal) on the very next line, the deposit paths
   * open Stripe Checkout in a browser sheet. iOS refuses to present while
   * another view controller is still dismissing, and RN neither retries nor
   * logs it: the second sheet never appears and an invisible controller is
   * left over the screen swallowing every touch. That is the "agreed, then the
   * trip screen froze" report — nothing to scroll, nothing to tap.
   *
   * So the resolve waits for the shell's `onDismissed` (iOS: the Modal's real
   * `onDismiss`, after UIKit has finished the teardown; elsewhere: unmount).
   * The timer is only a backstop — a dropped callback must not strand the pay
   * button behind an `await` that never settles, which is the worse failure.
   */
  const closeWith = useCallback(
    (agreed: boolean) => {
      pendingAnswerRef.current = agreed;
      setVisible(false);
      if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        if (pendingAnswerRef.current !== null) settle(pendingAnswerRef.current);
      }, DISMISS_FALLBACK_MS);
    },
    [settle],
  );

  const handleDismissed = useCallback(() => {
    if (pendingAnswerRef.current !== null) settle(pendingAnswerRef.current);
  }, [settle]);

  /**
   * Ask, if there is anything to ask. Resolves true to continue to Checkout,
   * false when the traveler dismissed the sheet without agreeing.
   */
  const ensureConsent = useCallback(async (): Promise<boolean> => {
    // Straight through once they have agreed — including the second call the
    // balance flow makes, where "Pay now" asks and the pay path then runs the
    // same gate. This check is on the REF and not on the awaited result
    // because `load()` is memoised: it keeps resolving to the gate as it was
    // read, so agreeing would never be visible through it and the sheet would
    // open again on the way to Checkout.
    if (gateRef.current?.consented) return true;

    const fallback = await load();
    // The ref again, for the same reason — `fallback` only stands in when the
    // read failed and left the ref unset, which is the fail-open path.
    const gate = gateRef.current ?? fallback;
    if (gate.consented || !gate.policy) return true;

    setVisible(true);
    return new Promise<boolean>(resolve => {
      // One question at a time. A second caller would otherwise overwrite the
      // first resolver and leave that await hanging. `settle` (not a bare
      // resolve) so a pending answer still waiting on a dismiss is dropped
      // with it, rather than firing later into the new caller's promise.
      settle(false);
      resolveRef.current = resolve;
    });
  }, [load, settle]);

  const handleAgree = useCallback(async () => {
    const current = gateRef.current?.policy;
    if (!current) return;

    setSaving(true);
    try {
      await recordPolicyConsent(tripId, consentText(current));
      gateRef.current = { policy: current, consented: true };
    } catch (err) {
      // Fails open — see the header. They ticked; we could not file it. The
      // tag is deliberately greppable in device logs, because "no consent rows
      // exist" and "nobody has paid yet" look identical from the database.
      console.warn('[policyConsent] could not record consent — letting the payment through:', err);
    }
    if (!aliveRef.current) return;
    setSaving(false);
    closeWith(true);
  }, [tripId, closeWith]);

  const handleClose = useCallback(() => {
    // Never mid-write: dismissing while the record is in flight would resolve
    // the caller into Checkout and then close the sheet under a running RPC.
    if (saving) return;
    closeWith(false);
  }, [saving, closeWith]);

  return {
    ensureConsent,
    /** Spread straight onto <TripPolicyConsentSheet />. */
    sheetProps: {
      visible,
      policy,
      saving,
      onAgree: handleAgree,
      onClose: handleClose,
      // Load-bearing, not telemetry: this is what releases the `await` in
      // `ensureConsent()`. See `closeWith`.
      onDismissed: handleDismissed,
    },
  };
}
