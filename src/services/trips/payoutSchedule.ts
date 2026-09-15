/**
 * What Stripe is doing with the operator's money, said in English.
 *
 * ⚠️ THE ONE THING TO UNDERSTAND BEFORE EDITING THIS FILE. There are TWO
 * clocks, they are independent, and almost every confused question about
 * payouts comes from mixing them up:
 *
 *   1. `delayDays` — how long after a traveler pays before the money is
 *      AVAILABLE at all. Nothing beats this, including a manual payout. The
 *      money is not being withheld by us; it does not exist to pay out yet.
 *   2. `interval`  — how often AVAILABLE money is swept to the bank.
 *      `manual` means never, until someone presses the button.
 *
 * The UI shows both, separately and in that order, because an operator asking
 * "where is my money" has to be able to tell which one is holding it. Collapse
 * them into one "you get paid in N days" line and the answer becomes a guess.
 *
 * A third wait is neither of these and cannot be configured: Stripe holds the
 * FIRST live payout of a new account 7–14 days. `firstPayoutCaveat` below is
 * the only honest thing we can say about it.
 *
 * Duplicated in the dashboard as `operator-dashboard/src/domain/payoutSchedule.ts` — the two
 * codebases share nothing on purpose (see CLAUDE.md). Change both.
 */

export type PayoutInterval = 'manual' | 'daily' | 'weekly' | 'monthly';

export interface PayoutSchedule {
  interval: PayoutInterval | null;
  delayDays: number | null;
  weeklyAnchor: string | null;
  monthlyAnchor: number | null;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface PayoutStatus {
  payoutsEnabled: boolean;
  /** False only when Stripe reports zero payouts ever. See `firstPayoutCaveat`. */
  hasEverPaidOut: boolean;
  payoutsStatus: string | null;
  currency: string | null;
  schedule: PayoutSchedule;
  available: Money[];
  pending: Money[];
}

export const INTERVALS: PayoutInterval[] = ['daily', 'weekly', 'monthly', 'manual'];

/**
 * Labels are written from the OPERATOR's side of the transaction ("my bank",
 * "when I ask"), not the system's ("automatic", "scheduled"). The operator is
 * not administering a payout engine; they are asking when they get paid.
 */
export const INTERVAL_LABEL: Record<PayoutInterval, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  manual: 'Only when I ask',
};

export const INTERVAL_BLURB: Record<PayoutInterval, string> = {
  daily: 'As soon as money clears, it goes to your bank.',
  weekly: 'Cleared money waits and goes out once a week.',
  monthly: 'Cleared money waits and goes out once a month.',
  manual: 'Money stays in your Stripe balance until you press Pay out.',
};

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const TITLE = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** An amount in Stripe's smallest unit, written the way a human reads it. */
export function formatMoney(minor: number, currency: string): string {
  const code = (currency || 'usd').toUpperCase();
  let per = 100;
  try {
    const digits =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    per = 10 ** digits;
  } catch {
    /* unknown code — two decimals is the overwhelming default */
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(minor / per);
  } catch {
    return `${minor / per} ${code}`;
  }
}

/** The total in one currency, or zero if that currency has no entry at all. */
export function amountIn(list: Money[], currency: string | null): number {
  if (!currency) return list[0]?.amount ?? 0;
  return list.find(m => m.currency.toLowerCase() === currency.toLowerCase())?.amount ?? 0;
}

/**
 * Clock 1, on its own. `null` when Stripe has not told us — which happens on an
 * account that has never been paid out — and the caller must not print "0 days"
 * in that case, because same-day clearing is a real and very different claim.
 */
export function describeClearing(s: PayoutSchedule): string | null {
  if (s.delayDays === null) return null;
  if (s.delayDays === 0) return 'Money is available as soon as a traveler pays.';
  const unit = s.delayDays === 1 ? 'day' : 'days';
  return `Money becomes available ${s.delayDays} ${unit} after a traveler pays.`;
}

/** Clock 2, on its own. */
export function describeSweep(s: PayoutSchedule): string {
  switch (s.interval) {
    case 'daily':
      return 'Then it goes to your bank every day.';
    case 'weekly':
      return `Then it goes to your bank every ${TITLE(s.weeklyAnchor ?? 'week')}.`;
    case 'monthly': {
      const d = s.monthlyAnchor;
      if (!d) return 'Then it goes to your bank once a month.';
      // 29–31 land on the last day of a short month. Saying "the 31st" to
      // someone paid in February would be wrong eleven months out of twelve.
      if (d >= 29) return 'Then it goes to your bank on the last day of each month.';
      return `Then it goes to your bank on the ${ordinal(d)} of each month.`;
    }
    case 'manual':
      return 'It then stays in your Stripe balance until you pay it out.';
    default:
      return 'Stripe has not told us how often it pays out yet.';
  }
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Whether to offer the button at all.
 *
 * ONLY on a manual schedule — and this is a real rule, not a tidiness
 * preference. On an automatic schedule the available balance is swept the
 * moment it clears, so the button would read "Pay out $0.00" nearly always, and
 * the operator would reasonably conclude their money had gone missing. Stripe's
 * own Express Dashboard hides it for exactly the same reason.
 */
export function canPayOutNow(status: PayoutStatus): boolean {
  return (
    status.payoutsEnabled &&
    status.schedule.interval === 'manual' &&
    amountIn(status.available, status.currency) > 0
  );
}

/**
 * The single sentence to show when an operator on a manual schedule has a zero
 * available balance. Distinguishing "nothing sold yet" from "sold, still
 * clearing" is the whole value of this line — the second is the state that
 * makes people think the money is lost.
 */
export function describeNothingToPayOut(status: PayoutStatus): string {
  const pending = amountIn(status.pending, status.currency);
  if (pending > 0) {
    return `${formatMoney(pending, status.currency ?? 'usd')} is on its way but has not cleared yet.`;
  }
  return 'Nothing to pay out yet.';
}

/**
 * The caveat about the first-ever payout. Shown only when it can still apply,
 * because an operator who has been paid before does not need to read it and a
 * permanent warning trains people to ignore warnings.
 *
 * We cannot detect "has never been paid out" from the schedule alone, so the
 * caller passes it — today from "no payouts exist on this account".
 */
export function firstPayoutCaveat(hasEverPaidOut: boolean): string | null {
  if (hasEverPaidOut) return null;
  return 'Stripe holds the very first payout of a new account for 7–14 days. That one is set by Stripe and no setting here changes it.';
}
