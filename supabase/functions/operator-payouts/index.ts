// Reads and changes ONE operator's payout schedule, and sends a manual payout.
//
// WHY WE ARE ALLOWED TO TOUCH THIS AT ALL. Stripe only lets a platform edit a
// connected account's payout schedule when the platform owns fraud and dispute
// liability. Ours do: `controller.losses.payments = 'application'`, read off a
// live account on 2026-08-12 (see the header of `stripe-connect-onboard`).
// Stripe, verbatim: "Platforms that manage fraud and dispute liability … can
// adjust the payout interval", and for the delay, "You can edit this property
// on accounts where you own fraud and dispute liability."
// If that controller value ever changes, every write here starts 400ing.
//
// ⚠️ THERE ARE TWO DIFFERENT CLOCKS AND THEY ARE CONSTANTLY CONFUSED:
//
//   • `delay_days` — how long after a traveler pays before the money becomes
//     AVAILABLE in the operator's balance at all. Nothing beats this. A manual
//     payout cannot touch money that has not cleared yet.
//   • `interval`   — how often available money is SWEPT to their bank.
//     `manual` means never, until someone asks. This is the one a "pay out
//     now" button can beat.
//
// A third thing is neither, and is NOT configurable: Stripe holds the FIRST
// live payout of a brand-new account for 7–14 days. If an operator complains
// about a two-week wait on their first ever payout, no setting on this page
// will fix it. Test-mode accounts never see that hold, so it cannot be
// reproduced before going live.
//
// WHY THE GATE IS NOT `trip_staff_can`. Every other money endpoint here is
// scoped to a trip and asks for `money.manage` on it. A payout schedule is not
// a fact about a trip — it is a fact about the operator's Stripe account, which
// outlives any single trip and covers the money from all of them. So the rule
// is the simplest one that is actually true: you may read and change the
// schedule of the payout account whose `user_id` is you. Staff on a trip,
// co-operators included, get nothing here.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** See payments-checkout for why `.message` alone, never the raw object. */
function safeMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'unknown error';
}

/**
 * Both helpers carry an optional `stripeAccount`, i.e. "run this AS the
 * connected account". It matters in opposite directions depending on the call:
 *
 *   • `/v1/balance` and `/v1/payouts` MUST send it. Without it they read and
 *     move SWELLYO's money.
 *   • `/v1/accounts/{id}` must NOT send it. The account id is already in the
 *     path, and it is the platform that is permitted to write the schedule.
 */
async function stripeGet(path: string, stripeAccount?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${STRIPE_SECRET_KEY}` };
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount;

  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  return body;
}

async function stripePost(
  path: string,
  params: Record<string, string>,
  opts: { stripeAccount?: string; idempotencyKey?: string } = {},
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (opts.stripeAccount) headers['Stripe-Account'] = opts.stripeAccount;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe ${path} failed`);
  return body;
}

/** Mirrors payments-refund — Stripe amounts are always in the smallest unit. */
function minorPerMajor(currency: string): number {
  try {
    const digits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

function formatMoney(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  const major = minor / minorPerMajor(currency);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(major);
  } catch {
    return `${major} ${code}`;
  }
}

const INTERVALS = ['manual', 'daily', 'weekly', 'monthly'] as const;
type Interval = (typeof INTERVALS)[number];

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!STRIPE_SECRET_KEY) {
    console.error('[operator-payouts] STRIPE_SECRET_KEY is not set');
    return json({ error: 'Stripe is not configured' }, 500);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);
    const userId = userData.user.id;

    let body: {
      action?: string;
      interval?: string;
      delayDays?: number;
      weeklyAnchor?: string;
      monthlyAnchor?: number;
      currency?: string;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const action = body.action ?? 'status';

    // ── The caller's own payout account ──────────────────────────────
    // Gate and subject in one lookup: there is no parameter naming which
    // account to act on, so there is no way to aim this at someone else's.
    const { data: row, error: rowErr } = await admin
      .from('operator_payout_accounts')
      .select('stripe_account_id, payouts_enabled')
      .eq('user_id', userId)
      .maybeSingle();

    if (rowErr) {
      console.error('[operator-payouts] payout account lookup failed:', safeMessage(rowErr));
      return json({ error: 'Could not load your payout account' }, 503);
    }
    if (!row?.stripe_account_id) {
      // Not an error the operator can act on from this screen — they have not
      // connected Stripe yet, and the Connect card above says so already.
      return json({ error: 'You have not connected a Stripe account yet.', code: 'no_account' }, 409);
    }
    const acct = row.stripe_account_id as string;

    // ── status ───────────────────────────────────────────────────────
    if (action === 'status') {
      // Sequential, not Promise.all: if the account read fails there is
      // nothing worth reporting and the balance read is wasted.
      const account = await stripeGet(`accounts/${acct}`);
      const payouts = account?.settings?.payouts ?? {};
      const schedule = payouts.schedule ?? {};

      // `available` is what a manual payout could move RIGHT NOW. `pending` is
      // money that exists but has not cleared `delay_days` yet — showing only
      // the first makes a healthy account look empty two days after a sale.
      let available: Array<{ amount: number; currency: string }> = [];
      let pending: Array<{ amount: number; currency: string }> = [];
      try {
        const balance = await stripeGet('balance', acct);
        available = balance.available ?? [];
        pending = balance.pending ?? [];
      } catch (e) {
        // A balance we cannot read must not take the whole screen down — the
        // schedule is still worth showing, and is the point of the page.
        console.error('[operator-payouts] balance read failed:', safeMessage(e));
      }

      // Has this account EVER been paid out? One cheap call, and it is the
      // only way to say anything honest about the 7-14 day first-payout hold:
      // that hold is invisible in the schedule, applies once, and is the most
      // likely explanation for "why has my money not arrived" on a new
      // account. `false` here is what licenses the UI to mention it; on an
      // account that has been paid before, the caveat is noise.
      let hasEverPaidOut = true;
      try {
        const history = await stripeGet('payouts?limit=1', acct);
        hasEverPaidOut = (history.data ?? []).length > 0;
      } catch (e) {
        // Unknown is not the same as "never". Defaulting to true suppresses
        // the caveat rather than showing a scary note we cannot stand behind.
        console.error('[operator-payouts] payout history read failed:', safeMessage(e));
      }

      return json({
        stripeAccountId: acct,
        country: account?.country ?? null,
        hasEverPaidOut,
        currency: account?.default_currency ?? null,
        payoutsEnabled: Boolean(row.payouts_enabled),
        // 'enabled' | 'disabled' — Stripe's own view, which can differ from
        // `payouts_enabled` on the account while requirements are outstanding.
        payoutsStatus: payouts.status ?? null,
        schedule: {
          interval: schedule.interval ?? null,
          delayDays: schedule.delay_days ?? null,
          weeklyAnchor: schedule.weekly_anchor ?? null,
          monthlyAnchor: schedule.monthly_anchor ?? null,
        },
        available,
        pending,
      });
    }

    // Everything past here writes. Refusing early keeps the error honest: a
    // schedule saved onto an account Stripe will not pay out from reads as
    // success and changes nothing the operator cares about.
    if (!row.payouts_enabled) {
      return json(
        {
          error: 'Stripe is not paying out to this account yet, so the schedule cannot be changed.',
          code: 'payouts_disabled',
        },
        409,
      );
    }

    // ── set_schedule ─────────────────────────────────────────────────
    if (action === 'set_schedule') {
      const interval = body.interval as Interval | undefined;
      if (!interval || !INTERVALS.includes(interval)) {
        return json({ error: 'Pick how often you want to be paid.' }, 400);
      }

      const params: Record<string, string> = {
        'settings[payouts][schedule][interval]': interval,
      };

      // ⚠️ Anchors are per-interval and Stripe 400s on a mismatch — sending
      // `weekly_anchor` with `interval=daily` is an error, not a no-op. So the
      // anchor is only ever sent for the interval that owns it. Switching
      // interval simply stops sending the old one; whether Stripe drops the
      // stored value or keeps it inert is its business, and either is fine
      // because the value has no effect on an interval that does not use it.
      if (interval === 'weekly') {
        const anchor = (body.weeklyAnchor ?? 'friday').toLowerCase();
        if (!WEEKDAYS.includes(anchor)) {
          return json({ error: 'Pick a day of the week to be paid on.' }, 400);
        }
        params['settings[payouts][schedule][weekly_anchor]'] = anchor;
      }
      if (interval === 'monthly') {
        const anchor = body.monthlyAnchor ?? 1;
        // 29–31 are allowed by Stripe and land on the last day of a short
        // month, so the range is the full 1–31, not 1–28.
        if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) {
          return json({ error: 'Pick a day of the month from 1 to 31.' }, 400);
        }
        params['settings[payouts][schedule][monthly_anchor]'] = String(anchor);
      }

      // `delay_days` is meaningless on a manual schedule (nothing is swept
      // automatically), and Stripe rejects it there.
      if (interval !== 'manual' && body.delayDays !== undefined) {
        const d = body.delayDays;
        if (!Number.isInteger(d) || d < 1 || d > 31) {
          return json({ error: 'The number of days to hold money must be a whole number from 1 to 31.' }, 400);
        }
        // Deliberately NOT floored by us. Stripe enforces the account's own
        // country minimum and returns a precise message when the value is too
        // low; a second guess here would either duplicate that rule wrongly or
        // drift from it. Raising the delay is always allowed and is only ever
        // safer for us — it leaves the money where a refund can still reach it.
        params['settings[payouts][schedule][delay_days]'] = String(d);
      }

      try {
        const updated = await stripePost(`accounts/${acct}`, params);
        const s = updated?.settings?.payouts?.schedule ?? {};
        return json({
          ok: true,
          schedule: {
            interval: s.interval ?? null,
            delayDays: s.delay_days ?? null,
            weeklyAnchor: s.weekly_anchor ?? null,
            monthlyAnchor: s.monthly_anchor ?? null,
          },
        });
      } catch (e) {
        // Stripe's message here is the useful one ("delay_days must be at
        // least 2 for US accounts"), and it is safe to show: it is about the
        // operator's own account, not our platform.
        return json({ error: safeMessage(e), code: 'stripe_rejected' }, 400);
      }
    }

    // ── payout_now ───────────────────────────────────────────────────
    if (action === 'payout_now') {
      const balance = await stripeGet('balance', acct);
      const availableList: Array<{ amount: number; currency: string }> = balance.available ?? [];
      const currency = (body.currency ?? largestCurrency(availableList)).toLowerCase();
      const entry = availableList.find(a => a.currency.toLowerCase() === currency);
      const amount = entry?.amount ?? 0;

      if (amount <= 0) {
        // The overwhelmingly common case, and the one worth explaining: on an
        // automatic schedule the balance is swept as soon as it clears, and
        // anything newer than `delay_days` is still pending. "Nothing to pay
        // out" is the correct state, not a failure.
        const pendingList: Array<{ amount: number; currency: string }> = balance.pending ?? [];
        const stillPending = pendingList.find(p => p.currency.toLowerCase() === currency)?.amount ?? 0;
        return json(
          {
            error:
              stillPending > 0
                ? `Nothing has cleared yet. ${formatMoney(stillPending, currency)} is still on its way from Stripe.`
                : 'There is nothing available to pay out right now.',
            code: 'nothing_available',
            pending: stillPending,
            currency,
          },
          409,
        );
      }

      // Double-tap protection, not idempotency-for-all-time. Stripe keys live
      // 24h, so a key on account+currency+amount alone would block a genuine
      // second payout of the same amount the same day. Bucketing by the minute
      // swallows the duplicate click and lets a deliberate retry through.
      const minuteBucket = Math.floor(Date.now() / 60_000);
      const key = `payout:${acct}:${currency}:${amount}:${minuteBucket}`;

      try {
        const payout = await stripePost(
          'payouts',
          { amount: String(amount), currency },
          { stripeAccount: acct, idempotencyKey: key },
        );
        return json({
          ok: true,
          payoutId: payout.id,
          amount,
          currency,
          formatted: formatMoney(amount, currency),
          arrivalDate: payout.arrival_date ?? null,
          status: payout.status ?? null,
        });
      } catch (e) {
        return json({ error: safeMessage(e), code: 'stripe_rejected' }, 400);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error('[operator-payouts] unhandled:', safeMessage(e));
    return json({ error: 'Something went wrong. Nothing was changed.' }, 500);
  }
});

/**
 * Which currency to pay out when the caller did not say. The largest available
 * balance, because an operator with a stray 30 cents of some other currency
 * should still get their real money when they press the button.
 */
function largestCurrency(available: Array<{ amount: number; currency: string }>): string {
  if (available.length === 0) return 'usd';
  return available.reduce((a, b) => (b.amount > a.amount ? b : a)).currency;
}
