/**
 * Money rules.
 *
 * "What is owed" and "is it paid" are never stored. They are worked out from
 * the traveler's frozen price and the payment ledger, exactly as the database
 * does it.
 *
 * This is a PORT of two live SQL functions:
 *   - operator_traveler_amount_due(trip, user, kind)
 *   - operator_requirement_pay_state(trip, user, requirement)
 *
 * We port rather than call them because neither grants EXECUTE to
 * `authenticated` — the browser cannot run them. Granting would not help much
 * either: both return one value for one traveler and one step, so a 15-person
 * trip would need 30 round trips to draw one page.
 *
 * This is the FOURTH copy of a database rule in this codebase. See
 * docs/SPEC.md §6 for why that is tolerated and what the real fix is.
 * Because it is a copy, it is pure, and it is tested.
 *
 * Two traps live in here on purpose:
 *   1. Money is added in whole CENTS, as integers. 0.1 + 0.2 is not 0.3.
 *   2. A Postgres `numeric` can arrive as a STRING. Everything goes through
 *      toNumber() first, or `1000 + 2000` silently becomes "10002000".
 */

import { formatUsd } from '../lib/format';

export type PayKind = 'deposit' | 'balance';

export type PayStepState =
  /** Paid in full. Matches the database's 'approved'. */
  | 'paid'
  /** Owed and not settled. Matches the database's 'not_started'. */
  | 'unpaid'
  /** No price exists for this person, so nothing can be owed. */
  | 'no_price';

/** What one traveler was frozen at when they joined. Either may be unset. */
export type TravelerPrice = {
  priceTotalUsd: number | null;
  depositUsd: number | null;
};

/** The trip's defaults, used when the traveler has no frozen price. */
export type TripPrice = {
  costPerPerson: number | null;
  depositAmount: number | null;
};

export type PaymentEvent = {
  userId: string;
  requirementId: string | null;
  /** 'paid' | 'refunded' | 'failed'. Refunds carry a negative amount. */
  eventType: string;
  amountUsd: number;
  isLivemode: boolean;
  createdAt: string | null;
};

/**
 * Anything Postgres hands us for a `numeric`, turned into a number.
 *
 * Returns null for null, undefined, empty string, and anything unparseable.
 * Never returns NaN — a NaN leaking into a total renders as "$NaN" on screen
 * and compares false against everything, so a real debt would read as paid.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Dollars to whole cents. All addition happens in this space. */
export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * What this traveler owes for one step.
 *
 * `null` means NO PRICE IS SET. It is not zero and it is not free — nothing
 * can be collected until someone sets a price.
 *
 * Mirrors operator_traveler_amount_due. The negative-balance guard is not
 * defensive padding: a deposit larger than the total would otherwise bill a
 * negative balance, and every step would read as paid.
 */
export function amountDueUsd(
  kind: PayKind,
  traveler: TravelerPrice | null,
  trip: TripPrice,
): number | null {
  const price = traveler?.priceTotalUsd ?? trip.costPerPerson ?? null;
  const deposit = traveler?.depositUsd ?? trip.depositAmount ?? null;

  if (kind === 'deposit') return deposit;

  if (price === null) return null;
  const balance = toCents(price) - toCents(deposit ?? 0);
  if (balance < 0) return null;
  return fromCents(balance);
}

/**
 * Does this event count towards what has been paid?
 *
 * 'failed' rows are excluded outright rather than trusted to carry a zero
 * amount, and only one Stripe mode is ever counted. See §4 of the design:
 * the database counts TEST payments while its livemode setting is unset, so
 * this site must count the same ones or the two disagree about one debt.
 */
export function countsAsPayment(event: PaymentEvent, liveMode: boolean): boolean {
  return event.eventType !== 'failed' && event.isLivemode === liveMode;
}

/**
 * Total paid, in dollars, across the events given.
 *
 * Refunds are negative rows, so they subtract with no special case. The result
 * can legitimately be negative if a traveler was refunded more than they paid.
 */
export function sumPaidUsd(events: PaymentEvent[], liveMode: boolean): number {
  let cents = 0;
  for (const e of events) {
    if (!countsAsPayment(e, liveMode)) continue;
    cents += toCents(e.amountUsd);
  }
  return fromCents(cents);
}

/**
 * How many events belong to the Stripe mode we are NOT counting.
 *
 * Drives the mismatch warning. A non-zero count here usually means
 * VITE_STRIPE_LIVEMODE disagrees with the database's app.stripe_livemode,
 * which would otherwise fail silently — the totals would simply be wrong.
 */
export function otherModeCount(events: PaymentEvent[], liveMode: boolean): number {
  return events.filter(e => e.eventType !== 'failed' && e.isLivemode !== liveMode).length;
}

/**
 * Is a step settled?
 *
 * `>=`, not `>`: paying exactly what is owed is paid. Compared in cents so a
 * float residue cannot leave a fully paid step reading as unpaid.
 */
export function stepState(dueUsd: number | null, paidUsd: number): PayStepState {
  if (dueUsd === null) return 'no_price';
  return toCents(paidUsd) >= toCents(dueUsd) ? 'paid' : 'unpaid';
}

export const STEP_STATE_LABEL: Record<PayStepState, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  no_price: 'No price set',
};

/**
 * Read a money amount an operator typed.
 *
 * Tolerates what people actually paste: '$3,000', ' 3000 ', '3,000.50'.
 * Returns null for blank or anything that is not a plain amount, so a typo
 * becomes "that is not an amount" rather than a silent zero.
 */
export function parseUsdInput(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** The price this traveler is actually on: their own if frozen, else the trip's. */
export function effectiveTotalUsd(
  traveler: TravelerPrice | null,
  trip: TripPrice,
): number | null {
  return traveler?.priceTotalUsd ?? trip.costPerPerson ?? null;
}

// ── One trip's whole money picture ────────────────────────────────────────

export type StepMoney = {
  requirementId: string;
  kind: PayKind;
  title: string;
  dueUsd: number | null;
  paidUsd: number;
  state: PayStepState;
};

export type TravelerMoney = {
  userId: string;
  totalUsd: number | null;
  paidUsd: number;
  steps: StepMoney[];
  /** This person's counted events, newest first, for their history list. */
  events: PaymentEvent[];
};

export type TripMoney = {
  travelers: TravelerMoney[];
  /** Sum of the prices that exist. Travelers with no price add nothing. */
  expectedUsd: number;
  /** Every counted event on the trip, including any from people who left. */
  collectedUsd: number;
  /** How many travelers have no price set — the operator's own backlog. */
  noPriceCount: number;
  /** How many travelers have settled each step. */
  paidCountByKind: Record<PayKind, number>;
  /** Counted events across the whole trip, newest first. */
  events: PaymentEvent[];
  /** Events belonging to the Stripe mode we are NOT showing. Drives a warning. */
  hiddenCount: number;
};

/**
 * Work out every money number one trip needs, in one pass.
 *
 * All three screens go through this so they cannot drift apart — a tile
 * saying "1 of 2 paid" while the page under it lists something else is worse
 * than either being wrong on its own.
 *
 * Counts use EVERY traveler as the denominator, including those with no price.
 * Someone with no price is not paid, so leaving them out would make the trip
 * look further along than it is.
 */
export function buildTripMoney(args: {
  members: Array<{ userId: string } & TravelerPrice>;
  steps: Array<{ requirementId: string; kind: PayKind; title: string }>;
  trip: TripPrice;
  events: PaymentEvent[];
  liveMode: boolean;
}): TripMoney {
  const { members, steps, trip, events, liveMode } = args;

  const counted = events.filter(e => countsAsPayment(e, liveMode));
  const paidCountByKind: Record<PayKind, number> = { deposit: 0, balance: 0 };

  const travelers = members.map((m): TravelerMoney => {
    const mine = counted.filter(e => e.userId === m.userId);

    const travelerSteps = steps.map((s): StepMoney => {
      const dueUsd = amountDueUsd(s.kind, m, trip);
      const paidUsd = sumPaidUsd(
        mine.filter(e => e.requirementId === s.requirementId),
        liveMode,
      );
      const state = stepState(dueUsd, paidUsd);
      if (state === 'paid') paidCountByKind[s.kind] += 1;
      return { ...s, dueUsd, paidUsd, state };
    });

    return {
      userId: m.userId,
      totalUsd: effectiveTotalUsd(m, trip),
      // Their whole ledger, not the sum of the steps: a payment that lost its
      // requirement link still left the operator's account.
      paidUsd: sumPaidUsd(mine, liveMode),
      steps: travelerSteps,
      events: mine,
    };
  });

  let expectedCents = 0;
  let noPriceCount = 0;
  for (const t of travelers) {
    if (t.totalUsd === null) noPriceCount += 1;
    else expectedCents += toCents(t.totalUsd);
  }

  return {
    travelers,
    expectedUsd: fromCents(expectedCents),
    collectedUsd: sumPaidUsd(counted, liveMode),
    noPriceCount,
    paidCountByKind,
    events: counted,
    hiddenCount: otherModeCount(events, liveMode),
  };
}

// ── Changing a price after money has arrived ──────────────────────────────

export type PriceChangeCheck =
  | { ok: true; confirm: null }
  | { ok: true; confirm: string }
  | { ok: false; reason: string };

/**
 * Decide what happens when an operator changes a traveler's total.
 *
 * Three cases, and only one of them interrupts:
 *
 *   nothing paid            -> save, no confirmation
 *   paid, new total >= paid -> confirm, with the numbers spelled out
 *   new total < paid        -> BLOCKED
 *
 * The block is the important one. Lowering a total below what someone already
 * paid leaves them overpaid, and this site has no refund — nothing in the
 * system can resolve that state. Stripe refuses the same move for the same
 * reason: a credit note reduces what is owed "but not below zero".
 *
 * The server does NOT check this. operator_set_traveler_price accepts any
 * total of zero or more whatever has been paid, so a direct API call still
 * gets through. Logged in the design doc §6 for the next payments migration.
 *
 * No confirmation when nothing has been paid, deliberately. Confirmations only
 * work while they stay rare — one on every price edit teaches the operator to
 * click through the one that matters.
 */
export function checkPriceChange(args: {
  travelerName: string;
  newTotalUsd: number;
  paidUsd: number;
  /** What they owe today, if a price is already set. Only used for wording. */
  currentTotalUsd: number | null;
}): PriceChangeCheck {
  const { travelerName, newTotalUsd, paidUsd, currentTotalUsd } = args;

  if (toCents(paidUsd) <= 0) return { ok: true, confirm: null };

  if (toCents(newTotalUsd) < toCents(paidUsd)) {
    return {
      ok: false,
      reason:
        `${travelerName} has already paid ${formatUsd(paidUsd)}. ` +
        `To charge less than that you need to refund them in Stripe first.`,
    };
  }

  const willOwe = fromCents(toCents(newTotalUsd) - toCents(paidUsd));
  const owesNow =
    currentTotalUsd === null ? null : fromCents(toCents(currentTotalUsd) - toCents(paidUsd));

  const before =
    owesNow === null ? '' : ` They owe ${formatUsd(owesNow)} right now.`;

  return {
    ok: true,
    confirm:
      `${travelerName} has paid ${formatUsd(paidUsd)}.${before} ` +
      `After this change they will owe ${formatUsd(willOwe)}.`,
  };
}
