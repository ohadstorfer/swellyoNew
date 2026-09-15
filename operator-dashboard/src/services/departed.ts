/**
 * People who paid for this trip and are no longer on it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `leaveTrip()` and `removeParticipant()` DELETE the participant row, so a
 * traveler who paid $1,000 and left vanishes from every screen while every
 * ledger row about them survives keyed to (trip_id, user_id). The operator
 * cannot see them, cannot refund them, and cannot tell that the trip's totals
 * include money from somebody who is not coming. That is test X-07.
 *
 * Phase 1 of docs/specs/operator-trips/departed-members.md stops the delete
 * and marks the row 'left' / 'removed' instead. THIS FILE IS PHASE 0: it needs
 * no schema change and it is the only thing that will ever find the people
 * removed BEFORE that lands, because for them there is no row left to mark.
 * It stays useful afterwards for exactly that historical set.
 *
 * ── What counts as "no longer on the trip" here ─────────────────────────────
 * A user_id that appears in this trip's payment ledger and has NO participant
 * row at all. Once phase 1 ships, a departure leaves a row behind, so those
 * people come from the roster instead (phase 3) and never appear here — the
 * two lists are disjoint by construction, not by a filter that could drift.
 *
 * ── The money ───────────────────────────────────────────────────────────────
 * `netPaidUsd` is the same sum every other screen uses: non-failed events in
 * the Stripe mode this site counts, refunds included as the negative rows they
 * are. `payments` carries the individual `paid` events because a refund is
 * always issued against ONE payment (see RefundDialog), not against a total.
 */
import { supabase } from '../lib/supabase';
import { fetchPaymentEvents, STRIPE_LIVEMODE } from './payments';
import { fetchDepartedMembers } from './trips';
import type { PaymentEvent } from '../domain/money';

export type DepartedPayment = {
  /** organized_trip_payment_events.id — what RefundDialog refunds against. */
  id: string;
  amountUsd: number;
  createdAt: string | null;
};

export type DepartedTraveler = {
  userId: string;
  /** Everything they paid, minus everything refunded. Never negative. */
  netPaidUsd: number;
  /** Their `paid` events, newest first. Empty when it has all been refunded. */
  payments: DepartedPayment[];
};

/**
 * Everyone in this trip's ledger with no participant row.
 *
 * Takes the events it was already given where the caller has them, so a page
 * that already renders the ledger does not fetch it twice.
 */
export async function fetchDepartedFromLedger(
  tripId: string,
  events?: PaymentEvent[],
): Promise<DepartedTraveler[]> {
  const ledger = events ?? (await fetchPaymentEvents(tripId));

  // Only the mode this site counts. A test-mode payment on a live-mode
  // dashboard is already excluded from every total; listing the person here
  // would invent a refund the operator cannot issue.
  const mine = ledger.filter(e => e.isLivemode === STRIPE_LIVEMODE);
  if (mine.length === 0) return [];

  // Not `fetchMembers` — that filters `role = 'member'`, and a row of any role
  // means "still on the trip". This asks the narrower question on purpose.
  const { data, error } = await supabase
    .from('group_trip_participants')
    .select('user_id')
    .eq('trip_id', tripId);
  if (error) throw error;

  const onTrip = new Set((data ?? []).map((r: { user_id: string }) => r.user_id));

  const byUser = new Map<string, DepartedTraveler>();
  for (const e of mine) {
    if (onTrip.has(e.userId)) continue;
    // 'failed' rows are pinned to 0 by a CHECK, but excluding them outright
    // means this sum never depends on that CHECK holding — the same reasoning
    // as operator_requirement_pay_state.
    if (e.eventType === 'failed') continue;

    let row = byUser.get(e.userId);
    if (!row) {
      row = { userId: e.userId, netPaidUsd: 0, payments: [] };
      byUser.set(e.userId, row);
    }
    row.netPaidUsd += e.amountUsd;
    if (e.eventType === 'paid') {
      row.payments.push({ id: e.id, amountUsd: e.amountUsd, createdAt: e.createdAt });
    }
  }

  return [...byUser.values()]
    .map(r => ({
      ...r,
      // A fully refunded person still belongs on this list — the operator
      // needs to see that the money went back — but the figure reads 0, not
      // a negative that looks like a bug.
      netPaidUsd: Math.max(0, Math.round(r.netPaidUsd * 100) / 100),
      payments: r.payments.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    }))
    .sort((a, b) => b.netPaidUsd - a.netPaidUsd);
}

/** One person who is no longer on the trip, from whichever source knows them. */
export type Departed = {
  userId: string;
  /**
   * How we know. 'left' / 'removed' come from a kept participant row and carry
   * a date and a reason; 'ledger' is somebody deleted before that row survived
   * departures, and all we have is their money.
   */
  kind: 'left' | 'removed' | 'ledger';
  leftAt: string | null;
  leftBy: string | null;
  leftReason: string | null;
  /** Everything paid minus everything refunded, in the mode this site counts. */
  netPaidUsd: number;
  /** Total sent back, as a positive number. 0 when nothing was refunded. */
  refundedUsd: number;
};

/**
 * Everybody who is no longer on this trip, from both sources at once.
 *
 * The roster half (a kept row marked 'left' or 'removed') is empty until
 * migration 20260906000300 is applied. The ledger half (deleted before that
 * existed, money still on file) is the historical set and never grows again.
 * A person can only be in one of them: having a row and having no row are the
 * two cases, so nothing is deduplicated here — there is nothing to collide.
 *
 * Sorted by when they left, most recent first, with the ledger people — whose
 * date nobody recorded — last.
 */
export async function fetchDeparted(tripId: string): Promise<Departed[]> {
  const [marked, ledger, events] = await Promise.all([
    fetchDepartedMembers(tripId),
    fetchDepartedFromLedger(tripId),
    fetchPaymentEvents(tripId),
  ]);

  const mine = events.filter(e => e.isLivemode === STRIPE_LIVEMODE);
  const moneyFor = (userId: string) => {
    let net = 0;
    let refunded = 0;
    for (const e of mine) {
      if (e.userId !== userId || e.eventType === 'failed') continue;
      net += e.amountUsd;
      // Refunds are stored as negative rows, so this reads back as a positive
      // "sent back" figure rather than a minus sign the operator has to parse.
      if (e.eventType === 'refunded') refunded -= e.amountUsd;
    }
    return {
      netPaidUsd: Math.max(0, Math.round(net * 100) / 100),
      refundedUsd: Math.max(0, Math.round(refunded * 100) / 100),
    };
  };

  const rows: Departed[] = [
    ...marked.map(m => ({
      userId: m.userId,
      kind: m.status,
      leftAt: m.leftAt,
      leftBy: m.leftBy,
      leftReason: m.leftReason,
      ...moneyFor(m.userId),
    })),
    ...ledger.map(l => ({
      userId: l.userId,
      kind: 'ledger' as const,
      leftAt: null,
      leftBy: null,
      leftReason: null,
      ...moneyFor(l.userId),
    })),
  ];

  return rows.sort((a, b) => (b.leftAt ?? '').localeCompare(a.leftAt ?? ''));
}
