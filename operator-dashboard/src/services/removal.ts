/**
 * Taking one person off a trip, and deciding their money first.
 *
 * The desktop twin of the app's `RemoveTravelerSheet` +
 * `groupTripsService.removeParticipant`. Same two calls, same order, same
 * best-effort tail — an operator who removes someone from their laptop must
 * leave the trip in exactly the state removing them from the phone would.
 *
 * ⚠️ Rule 1 of docs/SPEC.md still holds: nothing here is new. The participant
 * DELETE policy (`trip_staff_can(trip_id,'travelers.remove')`), the join-request
 * and chat cleanup, `trip-cancel`'s single-traveler mode and
 * `send-trip-removed-notification` are all created and owned by the app side.
 * This file calls them.
 *
 * ── The order is refund, then remove ────────────────────────────────────────
 * The operator decides the money while looking at the person; reversing it
 * means hunting for someone who is no longer on the roster. But a refund that
 * fails must not trap them — the dialog offers to remove anyway, carrying
 * whatever actually went back.
 */
import { supabase } from '../lib/supabase';

export type RefundOutcome = {
  userId: string;
  amountUsd: number;
  status: 'succeeded' | 'failed' | 'blocked_insufficient_balance' | 'pending';
  message?: string;
};

export type RefundTravelerResult = {
  refunds: RefundOutcome[];
  /** Asked for, but no payment was left to take it from. */
  unallocatedUsd: number;
  /** Set when the server itself refused — the whole request, not one payment. */
  error?: string;
};

/**
 * Refund one traveler, across however many payments they made.
 *
 * `payments-refund` cannot do this: it takes ONE `paymentEventId`, and a
 * traveler is not one payment — deposit, balance and every partial are their
 * own PaymentIntent (one traveler on prod has six paid rows). `trip-cancel`'s
 * single-traveler mode spreads an amount across them NEWEST-FIRST, because the
 * newest money is likeliest to still be in the operator's available balance.
 *
 * The server requires `money.manage`, which the operator of record holds and a
 * Manager may not. Hiding the button is UX; this is the boundary.
 */
export async function refundTraveler(args: {
  tripId: string;
  userId: string;
  amountUsd: number;
}): Promise<RefundTravelerResult> {
  const { data, error } = await supabase.functions.invoke('trip-cancel', {
    body: { tripId: args.tripId, userId: args.userId, amountUsd: args.amountUsd },
  });

  // supabase-js treats any non-2xx as an error and hides the JSON body on it.
  // The body is the whole point — the server writes the message naming both
  // balance figures in the operator's own currency — so dig it back out.
  if (error) {
    let payload: any = null;
    try {
      payload = await (error as any).context?.json?.();
    } catch {
      /* not JSON — fall through to the generic message */
    }
    throw new Error(payload?.error ?? 'Could not issue the refund. Please try again.');
  }

  if (!data?.ok) {
    throw new Error(data?.error ?? 'Could not issue the refund. Please try again.');
  }

  return {
    refunds: (data.refunds ?? []) as RefundOutcome[],
    unallocatedUsd: Number(data.unallocatedUsd ?? 0),
    ...(data.error ? { error: data.error as string } : {}),
  };
}

/** What actually went back, which is not what was asked for. */
export function sentUsd(refunds: RefundOutcome[]): number {
  return refunds.filter(r => r.status === 'succeeded').reduce((sum, r) => sum + r.amountUsd, 0);
}

/** The attempts that moved no money. Their presence is what makes a refund
 *  "partly done" rather than done. */
export function badRefunds(refunds: RefundOutcome[]): RefundOutcome[] {
  return refunds.filter(r => r.status === 'failed' || r.status === 'blocked_insufficient_balance');
}

/**
 * Take them off the trip.
 *
 * Only the participant DELETE is awaited — it is what makes the member row
 * disappear. Everything after it is fire-and-forget with a warn, exactly as the
 * app does it: none of it should hold the UI, and none of it should be able to
 * fail the removal.
 *
 * @param refundedUsd What was ACTUALLY refunded, if anything. It goes into the
 *   removal push so the traveler is told the amount instead of having to ask.
 *   ⚠️ Omitted, never zeroed — "$0.00 is being refunded" is worse than silence,
 *   and the renderer treats absent as "say nothing about money".
 */
export async function removeTraveler(args: {
  tripId: string;
  userId: string;
  refundedUsd?: number;
}): Promise<void> {
  const { tripId, userId, refundedUsd } = args;

  // Both the banner (before the delete) and the chat removal (after it) need
  // the trip's conversation. One lookup, tolerated if it fails.
  const conversation = await findTripConversation(tripId);

  // Posted BEFORE the delete, as the app does: the insert is by the operator,
  // who stays in the group, so RLS lets it through however it interleaves.
  if (conversation) void postRemovalBanner(conversation, userId);

  const { error } = await supabase
    .from('group_trip_participants')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId);

  if (error) throw error;

  // ── Cleanup. None of this may fail the removal. ──────────────────────────

  // Without this the unique(trip_id, requester_id) constraint blocks them from
  // ever asking to join again.
  void supabase
    .from('group_trip_join_requests')
    .delete()
    .eq('trip_id', tripId)
    .eq('requester_id', userId)
    .then(({ error: e }) => {
      if (e) console.warn('[removal] join request cleanup failed:', e);
    });

  // ⚠️ Permitted to the conversation's CREATOR, which is the operator on their
  // own trips. A Manager's attempt is refused — the same limit the app has, and
  // the same fire-and-forget handling.
  if (conversation) {
    void supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversation)
      .eq('user_id', userId)
      .then(({ error: e }) => {
        if (e) console.warn('[removal] chat removal failed:', e);
      });
  }

  void supabase.functions
    .invoke('send-trip-removed-notification', {
      body: {
        trip_id: tripId,
        removed_user_id: userId,
        ...(refundedUsd && refundedUsd > 0 ? { refund_usd: refundedUsd } : {}),
      },
    })
    .catch(e => console.warn('[removal] notification failed:', e));
}

/** The trip's group conversation, or null. Never throws — nothing downstream
 *  of it is worth failing a removal for. */
async function findTripConversation(tripId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('is_direct', false)
      .eq('metadata->>trip_id', tripId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.warn('[removal] conversation lookup failed:', e);
    return null;
  }
}

/**
 * "<Operator> removed <Traveler>" in the group chat.
 *
 * The group watches somebody disappear either way; the app posts this line so
 * it is not a mystery, and a removal done from the desktop must not be quieter
 * than one done from a phone.
 */
async function postRemovalBanner(conversationId: string, removedUserId: string): Promise<void> {
  try {
    const { data: session } = await supabase.auth.getSession();
    const meId = session.session?.user?.id;
    if (!meId) return;

    const { data: surfers } = await supabase
      .from('surfers')
      .select('user_id, name')
      .in('user_id', [meId, removedUserId]);

    const nameOf = (id: string) =>
      (surfers ?? []).find((s: any) => s.user_id === id)?.name?.trim() || 'User';

    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: meId,
      body: `${nameOf(meId)} removed ${nameOf(removedUserId)}`,
      // ⚠️ `messages` has TWO type constraints; 'text' + is_system is the shape
      // the app uses for every system line, and the only one known to satisfy
      // both.
      type: 'text',
      is_system: true,
      attachments: [],
    });
    if (error) throw error;

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
  } catch (e) {
    console.warn('[removal] banner failed:', e);
  }
}
