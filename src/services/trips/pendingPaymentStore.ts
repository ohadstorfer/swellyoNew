/**
 * Remembers that a traveler came back from Stripe Checkout and we never got a
 * confirmation.
 *
 * Spec: docs/specs/operator-trips/payment-pending-state.md
 *
 * WHY THIS EXISTS: the row state that stops someone paying twice used to be a
 * `useState` in TripDetailScreen. It died on unmount — navigate to the chat and
 * back, and a payment that may have gone through was offering a fresh "Pay"
 * button again. This survives that, and survives the app being killed.
 *
 * ## One timestamp, two thresholds
 *
 * The naive shape is two records with two TTLs. It is one, because both
 * questions are asked of the same moment — when the poll gave up on a payment
 * we could not confirm:
 *
 *   • under 30 minutes  → `pending`. The row reads "Processing". A webhook
 *     that has not landed by now is broken rather than slow, and holding this
 *     state longer would lock a traveler out of legitimately retrying.
 *   • up to 7 days      → `unconfirmed`. The row goes back to "Pay", but the
 *     first tap has to warn before it charges anything. Comfortably past
 *     Stripe's webhook retry window.
 *   • after that        → forgotten.
 *
 * Letting `pending` expire straight back into a plain one-tap "Pay" would just
 * re-open the double-payment trap on a 30-minute delay. `unconfirmed` is the
 * half that makes expiry safe, which is why it long outlives the visible state.
 *
 * ⚠️ Device-local, on purpose and only for now. Pay on the phone, open on the
 * web, and the web knows nothing about it. The correct fix is server-side via
 * `operator_checkout_sessions` — already a go-live gate for three other
 * reasons — at which point this file should be DELETED rather than kept
 * alongside it. See §4 of the spec.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** How long the row keeps saying "Processing". */
export const PENDING_WINDOW_MS = 30 * 60 * 1000;
/** How long an unconfirmed attempt still gates a retry. */
export const ATTEMPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type PaymentAttemptPhase = 'pending' | 'unconfirmed' | 'none';

/** requirementId → epoch ms when the poll gave up. */
export type PaymentAttempts = Record<string, number>;

const keyFor = (tripId: string) => `swellyo:pendingPayments:${tripId}`;

/**
 * Which phase an attempt is in, given when it started.
 *
 * Pure and exported so the screen can classify without touching storage, and
 * so the thresholds are testable without mocking a clock at the call site.
 * `now` is a parameter rather than `Date.now()` for the same reason.
 */
export function attemptPhase(startedAt: number, now: number): PaymentAttemptPhase {
  const age = now - startedAt;
  // A negative age means the clock moved backwards (timezone change, NTP
  // correction, a device whose owner set the date by hand). Treat it as fresh
  // rather than as "none": the safe direction is to keep warning.
  if (age < PENDING_WINDOW_MS) return 'pending';
  if (age < ATTEMPT_WINDOW_MS) return 'unconfirmed';
  return 'none';
}

/**
 * Every unconfirmed attempt on this trip, already pruned of anything past the
 * 7-day window.
 *
 * Never throws. A read failure here must not take down the trip screen — the
 * cost of returning `{}` is that one row shows "Pay" when it could have shown
 * "Processing", which is exactly the behaviour we had before this file
 * existed; the cost of propagating is a blank screen.
 */
export async function loadPaymentAttempts(
  tripId: string,
  now: number = Date.now(),
): Promise<PaymentAttempts> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(tripId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const out: PaymentAttempts = {};
    let pruned = false;
    for (const [requirementId, startedAt] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
        pruned = true;
        continue;
      }
      if (attemptPhase(startedAt, now) === 'none') {
        pruned = true;
        continue;
      }
      out[requirementId] = startedAt;
    }

    // Pruning on read, not on a schedule: this is the only moment we are
    // certain someone cares about this trip, and it keeps the key from growing
    // forever on a trip with a long history of retries.
    if (pruned) await persist(tripId, out);
    return out;
  } catch {
    return {};
  }
}

/**
 * Record that a payment came back unconfirmed. Returns the updated map so the
 * caller can set state from it rather than re-reading storage.
 */
export async function recordPaymentAttempt(
  tripId: string,
  requirementId: string,
  current: PaymentAttempts,
  now: number = Date.now(),
): Promise<PaymentAttempts> {
  const next = { ...current, [requirementId]: now };
  await persist(tripId, next);
  return next;
}

/**
 * Forget an attempt — the payment confirmed, or the traveler chose "Pay
 * anyway" and is knowingly starting a fresh one.
 */
export async function clearPaymentAttempt(
  tripId: string,
  requirementId: string,
  current: PaymentAttempts,
): Promise<PaymentAttempts> {
  if (!(requirementId in current)) return current;
  const next = { ...current };
  delete next[requirementId];
  await persist(tripId, next);
  return next;
}

async function persist(tripId: string, attempts: PaymentAttempts): Promise<void> {
  try {
    if (Object.keys(attempts).length === 0) {
      await AsyncStorage.removeItem(keyFor(tripId));
      return;
    }
    await AsyncStorage.setItem(keyFor(tripId), JSON.stringify(attempts));
  } catch {
    // Swallowed deliberately. A write failure degrades this feature to the
    // in-memory behaviour it replaced; it must never surface as an error on a
    // screen the traveler opened to look at their trip.
  }
}

/**
 * "about 40 minutes ago" — for the warning that gates a retry.
 *
 * Deliberately vague ("about"): the stored moment is when our POLL gave up,
 * not when they tapped pay, so precision here would be false. Vague and
 * roughly right beats exact and subtly wrong when the number's only job is to
 * help someone recognise "oh, that was me, ten minutes ago".
 */
export function describeAttemptAge(startedAt: number, now: number = Date.now()): string {
  const mins = Math.max(1, Math.round((now - startedAt) / 60000));
  if (mins < 60) return `about ${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `about ${days} day${days === 1 ? '' : 's'} ago`;
}
