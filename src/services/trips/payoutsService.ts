/**
 * Talks to the `operator-payouts` edge function.
 *
 * Everything here acts on the SIGNED-IN USER's own Stripe account. There is
 * deliberately no account or user parameter: the server derives the account
 * from the JWT, so there is nothing to aim at somebody else's money.
 */
import { supabase } from '../../config/supabase';
import type { PayoutInterval, PayoutStatus } from './payoutSchedule';

/**
 * supabase-js turns any non-2xx into an `error` and drops the JSON body on the
 * floor. The body is where our real message lives — Stripe's own "delay_days
 * must be at least 2 for US accounts", or the pending-balance figure in the
 * operator's settlement currency — so dig it back out rather than showing
 * "Edge Function returned a non-2xx status". Same trick as `refundsService.ts`.
 */
async function unwrap(error: unknown): Promise<{ error: string; code?: string } | null> {
  try {
    const payload = await (error as any)?.context?.json?.();
    if (payload?.error) return { error: payload.error, code: payload.code };
  } catch {
    /* body was not JSON — caller falls back to its own message */
  }
  return null;
}

export type PayoutStatusResult =
  | { ok: true; status: PayoutStatus }
  // `code` lets the card tell "you never connected Stripe" (show nothing, the
  // Payments card above already says it) apart from a real failure.
  | { ok: false; error: string; code?: string };

export async function fetchPayoutStatus(): Promise<PayoutStatusResult> {
  const { data, error } = await supabase.functions.invoke('operator-payouts', {
    body: { action: 'status' },
  });
  if (error) {
    const body = await unwrap(error);
    return { ok: false, error: body?.error ?? 'Could not load your payout settings.', code: body?.code };
  }
  if (data?.error) return { ok: false, error: data.error, code: data.code };
  return {
    ok: true,
    status: {
      payoutsEnabled: Boolean(data.payoutsEnabled),
      hasEverPaidOut: data.hasEverPaidOut !== false,
      payoutsStatus: data.payoutsStatus ?? null,
      currency: data.currency ?? null,
      schedule: {
        interval: (data.schedule?.interval ?? null) as PayoutInterval | null,
        delayDays: data.schedule?.delayDays ?? null,
        weeklyAnchor: data.schedule?.weeklyAnchor ?? null,
        monthlyAnchor: data.schedule?.monthlyAnchor ?? null,
      },
      available: data.available ?? [],
      pending: data.pending ?? [],
    },
  };
}

export type SaveScheduleResult = { ok: true } | { ok: false; error: string };

/**
 * `delayDays` is sent only when the caller means to change it. Sending the
 * value we just read back at Stripe on every save would turn a display into a
 * write, and would fail on a manual schedule where the field does not apply.
 */
export async function savePayoutSchedule(args: {
  interval: PayoutInterval;
  delayDays?: number;
  weeklyAnchor?: string;
  monthlyAnchor?: number;
}): Promise<SaveScheduleResult> {
  const { data, error } = await supabase.functions.invoke('operator-payouts', {
    body: { action: 'set_schedule', ...args },
  });
  if (error) {
    const body = await unwrap(error);
    return { ok: false, error: body?.error ?? 'Could not save your payout schedule.' };
  }
  if (!data?.ok) return { ok: false, error: data?.error ?? 'Could not save your payout schedule.' };
  return { ok: true };
}

export type PayoutNowResult =
  | { ok: true; formatted: string }
  | { ok: false; error: string };

export async function payOutNow(): Promise<PayoutNowResult> {
  const { data, error } = await supabase.functions.invoke('operator-payouts', {
    body: { action: 'payout_now' },
  });
  if (error) {
    const body = await unwrap(error);
    return { ok: false, error: body?.error ?? 'Could not send the payout.' };
  }
  if (!data?.ok) return { ok: false, error: data?.error ?? 'Could not send the payout.' };
  return { ok: true, formatted: data.formatted };
}
