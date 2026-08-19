import { supabase } from '../../config/supabase';

/**
 * Notification center — client service for the `notifications` table
 * (see supabase/migrations/20260601010000_notification_center.sql).
 *
 * One row = one thing one user sees. Rows are created by DB triggers; the client
 * only reads its own rows, subscribes for realtime, and marks them read.
 *
 * RESILIENT: every query is wrapped so that if the migration hasn't been applied
 * yet (table missing), the app degrades to "no notifications" instead of crashing.
 */

export type NotificationType =
  | 'member_joined'
  | 'member_committed'
  | 'gear_claimed'
  | 'admin_update_posted'
  | 'group_gear_updated'
  | 'personal_gear_updated'
  | 'gear_request_decided'
  | 'commitment_decided'
  | 'join_request_decided'
  | 'join_request_received'
  | 'gear_request_received'
  | 'commitment_request_received'
  | 'member_left'
  | 'trip_cancelled'
  | 'member_removed'
  | 'trip_reminder'
  | 'trip_ended'
  | 'trip_invite_received'
  | 'trip_invite_accepted'
  | 'trip_invite_declined'
  // The operator sent a document back. `operator_reject_document` has always
  // written this row; until now nothing here knew the type, so it rendered as a
  // blank "Notification". There is deliberately no `operator_document_approved`
  // counterpart: the approve RPC writes no row (Ohad, 30 Jul — a push per
  // approval would mean eight pushes for one operator clearing a queue).
  | 'operator_document_rejected'
  // The operator tapped "Remind N people" on the Dashboard. Written by
  // `operator_remind_requirement`, which is the FIRST thing ever to create one
  // of these — the enum value and its push priority were added in July with the
  // note "reminder cadence is not decided yet", and then nothing sent it. The
  // cadence is now whatever the operator taps, with a 24h cooldown in the RPC.
  | 'operator_requirement_due_soon'
  // Same requirement, past its due date. Written by the daily
  // scan-requirement-deadlines cron (20260820000000), which is the first
  // producer either of these two overdue types has ever had — the enum
  // values existed since July with nothing sending them.
  | 'operator_requirement_overdue'
  // The operator's own heads-up that someone is late. One digest per
  // requirement, not one per traveler — `data.count` says how many.
  | 'operator_requirement_overdue_operator'
  // Stripe finished verifying an operator's payout account and they can now be
  // paid. Written by `stripe-connect-webhook`, and the ONLY notification here
  // that is not about a trip — `trip_id` is null, because this can (and by
  // design usually will) happen before the operator's first trip exists.
  // NotificationCenter already refuses to navigate a row with no trip_id, so
  // it renders as an unpressable status line, which is exactly right.
  | 'operator_stripe_ready'
  // The same account went the other way: Stripe stopped it, froze its payouts,
  // or set a deadline it has already missed. Written by
  // `trg_notify_connect_status`, which reads the edge off the row — so the
  // Connect webhook, the onboarding poll and the daily sweep all produce it.
  // `data.reason` is one of 'blocked' | 'charges_disabled' | 'payouts_disabled'
  // | 'past_due' and decides both the copy and whether the push waits for quiet
  // hours. Like its counterpart above it carries no `trip_id`; unlike it, this
  // one has somewhere to go, so NotificationCenter routes it by type.
  | 'operator_stripe_action_needed'
  // A Swellyo admin turned on someone's `surfers.operator` flag. Written by
  // `trg_notify_operator_setup_required` — the ONLY producer, and it fires on
  // the false→true edge only, so there is no cron and nothing that can repeat.
  // Like `operator_stripe_ready` this is about the ACCOUNT, so `trip_id` is
  // null; unlike it, this one has somewhere to go, which is why
  // NotificationCenter routes it by type rather than by trip.
  | 'operator_setup_required'
  // An operator asked someone to join their trip's crew, from inside the app.
  // Written by `invite_staff_member`. Like `trip_invite_received`, this row is
  // a QUESTION, not news: tapping it opens the accept sheet rather than the
  // trip, because the recipient is not on the crew until they say yes.
  | 'operator_staff_invited'
  // A traveler's payment did not finish — the card was declined
  // (`data.reason === 'card_declined'`) or a checkout was opened and abandoned
  // until Stripe expired it (`'checkout_abandoned'`). Written by
  // `stripe-webhook`, best-effort, one per requirement per 24h. The copy is
  // the same for both reasons on purpose: "nothing was charged, try again" is
  // the whole message either way, and naming the decline would just make the
  // traveler relive it.
  | 'operator_payment_stuck'
  // A traveler's bank opened a chargeback on one of the operator's payments.
  // Written by `stripe-webhook` from `charge.dispute.created` (Phase 3 of
  // refunds-and-merchant-of-record.md). The operator cannot answer the bank —
  // the dispute sits on Swellyo's platform account — but the evidence that
  // wins it (booking records, the waiver, messages) is theirs, and the clock
  // is short: `data.evidence_due_label` is the bank's deadline, and it is why
  // this one bypasses quiet hours.
  | 'operator_charge_disputed'
  // The same case closed. `data.outcome` is 'won' (the money stays) or 'lost'
  // (a negative 'dispute_lost' ledger row was written and the traveler's pay
  // state fell back to unpaid). Same producer, from `charge.dispute.closed`.
  | 'operator_dispute_closed'
  // The trip moved. Written by `trg_notify_trip_dates_changed`, which fires off
  // the row, so the app, the operator dashboard and a hand-written UPDATE all
  // produce it identically. It matters more than "the dates changed" sounds:
  // every requirement deadline and the final payment are stored relative to
  // `start_date`, so they all move with it and the traveler agreed to none of
  // it. `data.date_range` is the new range, pre-formatted by the trigger so the
  // push and the bell say the same thing; `data.has_deadlines` says whether
  // this trip has any deadline to have moved, and is what decides where the row
  // taps through to.
  | 'trip_dates_changed';

/**
 * Every bell type, as a runtime set for the foreground push gate.
 * Record<NotificationType, true> forces exhaustiveness: adding a new
 * NotificationType without listing it here is a compile error.
 */
const BELL_TYPE_FLAGS: Record<NotificationType, true> = {
  member_joined: true,
  member_committed: true,
  gear_claimed: true,
  admin_update_posted: true,
  group_gear_updated: true,
  personal_gear_updated: true,
  gear_request_decided: true,
  commitment_decided: true,
  join_request_decided: true,
  join_request_received: true,
  gear_request_received: true,
  commitment_request_received: true,
  member_left: true,
  trip_cancelled: true,
  member_removed: true,
  trip_reminder: true,
  trip_ended: true,
  trip_invite_received: true,
  trip_invite_accepted: true,
  trip_invite_declined: true,
  operator_document_rejected: true,
  operator_requirement_due_soon: true,
  operator_requirement_overdue: true,
  operator_requirement_overdue_operator: true,
  operator_stripe_ready: true,
  operator_stripe_action_needed: true,
  operator_setup_required: true,
  operator_staff_invited: true,
  operator_payment_stuck: true,
  operator_charge_disputed: true,
  operator_dispute_closed: true,
  trip_dates_changed: true,
};
export const BELL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(
  Object.keys(BELL_TYPE_FLAGS)
);

/**
 * "Is the notifications screen (bell panel) currently focused?" — module-level
 * flag, same manual pattern as MessagingProvider's currentConversationIdRef.
 * NotificationsPanel sets it on focus/blur; the push foreground gate reads it
 * to suppress banners for the screen the user is already looking at.
 */
let notificationsScreenOpen = false;
export function setNotificationsScreenOpen(open: boolean): void {
  notificationsScreenOpen = open;
}
export function isNotificationsScreenOpen(): boolean {
  return notificationsScreenOpen;
}

export interface NotificationRow {
  id: string;
  recipient_id: string;
  trip_id: string | null;
  type: NotificationType;
  audience: 'user' | 'admin';
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  /** Frozen render snapshot, e.g. { actor_name, trip_title, gear_name, qty, decision, item_name, preview }. */
  data: Record<string, any> | null;
  read_at: string | null;
  handled_at: string | null;
  created_at: string;
}

/**
 * Deep-link target inside TripDetailScreen. 'overview' = just open the trip;
 * everything else switches to the Plan tab and scrolls to that section
 * (falling back to overview/top when the user can't see Plan or the section
 * isn't rendered — e.g. a declined requester, or a locked trip).
 */
export type TripDetailFocus =
  | 'overview'
  | 'commit'        // Plan → commit pill (members) / top of Plan (host)
  | 'updates'       // Plan → admin updates card
  | 'gear'          // Plan → Packing & Gear section
  | 'your-gear'     // Plan → Packing & Gear → Your Gear card
  | 'requests'      // Plan → pending join requests (host)
  | 'gear-requests' // Plan → gear requests badge + auto-open the sheet (host)
  | 'documents'     // Plan → Documents card
  | 'breakdown'     // Plan → group breakdown
  // Operator trips: push the traveler-onboarding flow on top of the trip card.
  // Not a section of the Plan tab — an onboarding traveler cannot see the Plan
  // tab at all. It resolves to the plain overview for anyone already in.
  | 'onboarding';

/**
 * Where tapping a notification should land. Single source of truth for both
 * tap surfaces: the bell feed (full row data) and native pushes (the
 * dispatcher mirrors `stage`/`decision` into the push data payload).
 */
export function tripFocusForNotification(
  type: string | undefined,
  data?: Record<string, any> | null
): TripDetailFocus {
  switch (type) {
    case 'join_request_received':
    case 'trip_join_request': // legacy push type (pre-queue webhook)
      return 'requests';
    case 'join_request_decided':
      // Approved → next step is committing. Declined → can't see Plan anyway.
      return data?.decision === 'approved' ? 'commit' : 'overview';
    case 'commitment_request_received': // host: action lives in the bell buttons
    case 'commitment_decided':
      return 'commit';
    case 'member_committed':
      return 'breakdown';
    case 'gear_request_received':
      return 'gear-requests';
    case 'gear_request_decided':
    case 'gear_claimed':
    case 'group_gear_updated':
      return 'gear';
    case 'personal_gear_updated':
      return 'your-gear';
    case 'admin_update_posted':
      return 'updates';
    // Straight to the Documents card, where the row is already sitting in the
    // "Send a new one" state with the operator's reason under it.
    case 'operator_document_rejected':
    // Same destination: the row they need is sitting in the Documents card
    // waiting to be tapped. A reminder that lands on the trip's Overview would
    // make the traveler hunt for the thing they were just asked for.
    case 'operator_requirement_due_soon':
    // Same reasoning, one day later.
    case 'operator_requirement_overdue':
      return 'documents';
    // operator_requirement_overdue_operator has no Plan tab of its own to
    // land on — it's an operator digest, not a traveler card — so it falls
    // to 'overview' below, which opens the trip; the Dashboard tab with the
    // review queue is one tap from there. operator_charge_disputed and
    // operator_dispute_closed fall the same way for the same reason: the
    // money card lives on the Dashboard tab, one tap from the trip.
    // The place with a Pay button. A stuck DEPOSIT — the realistic case, it is
    // the biggest amount and the first one asked for — belongs to a traveler
    // still mid-onboarding, and 'onboarding' opens that flow at their current
    // step. For someone already in (a balance payment), it resolves to the
    // plain overview, which the focus type documents as its fallback.
    case 'operator_payment_stuck':
      return 'onboarding';
    // The dates themselves are already in the notification body, so the reason
    // to tap is the part that is NOT there: which deadlines moved, and to when.
    // That is the Documents card. On a trip with no deadline-carrying
    // requirement — every peer trip, and an operator trip whose rows are all
    // must_have — there is nothing to look at there, so it opens the trip.
    // `has_deadlines` is written by the trigger; a row created before it
    // existed has no such key and lands on 'overview', which is the safe half.
    case 'trip_dates_changed':
      return data?.has_deadlines ? 'documents' : 'overview';
    case 'trip_invite_accepted':
    case 'trip_invite_declined':
      return 'overview';
    // trip_invite_received routes to a dedicated response sheet, not this
    // generic trip-focus path — see NotificationCenter's handleRowPress.
    case 'trip_reminder':
      switch (data?.stage) {
        case 'commit':
          return 'commit';
        case 'week':
        case 'gear':
          return 'gear'; // "packing list inside"
        default:
          return 'overview'; // tomorrow / today → trip details
      }
    // member_joined, member_left, member_removed, trip_cancelled, trip_ended
    default:
      return 'overview';
  }
}

/** Ionicons name used for the row icon. */
type IoniconName = string;

/** A span of body text; `b` marks it bold (e.g. the action verb or group name). */
export interface BodyPart {
  t: string;
  b?: boolean;
}

export interface RenderedNotification {
  title: string;
  body: string;
  icon: IoniconName;
  /** Rich body broken into spans so the bell can bold the action + group.
   *  When absent, the plain `body` string is rendered instead. */
  bodyParts?: BodyPart[];
}

const TABLE = 'notifications';

// ---------------------------------------------------------------------------
// Editable bell texts — loaded once per session from notification_templates.
// Missing table/row/field → the hardcoded defaults below render as before.
// ---------------------------------------------------------------------------
type BellTemplate = { bell_title: string | null; bell_body: string | null };
let bellTemplates: Record<string, BellTemplate> | null = null;
let bellTemplatesLoading = false;

async function loadBellTemplates(): Promise<void> {
  if (bellTemplates || bellTemplatesLoading) return;
  bellTemplatesLoading = true;
  try {
    const { data, error } = await supabase
      .from('notification_templates')
      .select('key, bell_title, bell_body');
    if (!error && data) {
      const map: Record<string, BellTemplate> = {};
      for (const row of data as any[]) map[row.key] = row;
      bellTemplates = map;
    }
  } catch (e) {
    console.warn('[notificationsService] templates load failed (using defaults):', e);
  } finally {
    bellTemplatesLoading = false;
  }
}

/** Template row key: type, or type:variant for decision/stage splits. */
function bellTemplateKey(n: NotificationRow): string {
  const d = n.data ?? {};
  if (n.type === 'join_request_decided' || n.type === 'commitment_decided' || n.type === 'gear_request_decided') {
    return `${n.type}:${d.decision === 'approved' ? 'approved' : 'declined'}`;
  }
  if (n.type === 'trip_reminder') {
    const s = d.stage || '';
    if (s === 'tomorrow' || s === 'today') return `trip_reminder:${s}`;
    if (s.startsWith('commit_')) return 'trip_reminder:commit';
    if (s.startsWith('gear_')) return 'trip_reminder:gear';
    return 'trip_reminder:week';
  }
  return n.type;
}

/** Replace {placeholders}; unknown ones stay as-is; extra spaces collapse. */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Quietly swallow "table doesn't exist yet" (migration not applied) and similar. */
function isMissingTableError(error: any): boolean {
  const msg = (error?.message || '').toLowerCase();
  return (
    error?.code === '42P01' || // undefined_table
    msg.includes('does not exist') ||
    msg.includes('could not find the table')
  );
}

export const notificationsService = {
  /** Latest notifications for the current user, newest first. */
  async fetch(limit = 50): Promise<NotificationRow[]> {
    void loadBellTemplates(); // fire-and-forget; ready by the time the bell renders
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        if (!isMissingTableError(error)) {
          console.warn('[notificationsService] fetch error:', error.message);
        }
        return [];
      }
      return (data as NotificationRow[]) ?? [];
    } catch (e) {
      console.warn('[notificationsService] fetch threw:', e);
      return [];
    }
  },

  /** Count of unread (read_at IS NULL) — powers the bell badge. */
  async unreadCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from(TABLE)
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (error) {
        if (!isMissingTableError(error)) {
          console.warn('[notificationsService] unreadCount error:', error.message);
        }
        return 0;
      }
      return count ?? 0;
    } catch {
      return 0;
    }
  },

  /** Mark every unread notification for the current user as read. */
  async markAllRead(): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from(TABLE)
        .update({ read_at: nowIso })
        .eq('recipient_id', user.id)
        .is('read_at', null);
      if (error && !isMissingTableError(error)) {
        console.warn('[notificationsService] markAllRead error:', error.message);
      }
    } catch (e) {
      console.warn('[notificationsService] markAllRead threw:', e);
    }
  },

  /** Mark a single notification read (e.g. when tapped). */
  async markRead(id: string): Promise<void> {
    try {
      await supabase
        .from(TABLE)
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
    } catch {
      /* ignore */
    }
  },

  /**
   * Mark a single notification handled (e.g. after its inline Approve/Decline
   * action resolves). Durable record so the buttons don't reappear on reopen.
   */
  async markHandled(id: string): Promise<void> {
    try {
      await supabase
        .from(TABLE)
        .update({ handled_at: new Date().toISOString() })
        .eq('id', id);
    } catch {
      /* ignore */
    }
  },

  /**
   * Realtime: receive this user's notifications as they arrive (INSERT) and when
   * their read/handled state changes elsewhere (UPDATE). Filtered server-side by
   * recipient_id so a client only ever sees its own rows.
   *
   * Returns an unsubscribe function.
   */
  subscribe(
    userId: string,
    handlers: {
      onInsert?: (row: NotificationRow) => void;
      onUpdate?: (row: NotificationRow) => void;
    }
  ): () => void {
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: TABLE,
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          if (row?.id) handlers.onInsert?.(row);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: TABLE,
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          if (row?.id) handlers.onUpdate?.(row);
        }
      )
      .subscribe((status) => {
        if (__DEV__ && status !== 'SUBSCRIBED') {
          console.log(`[notificationsService] notifications:${userId} status: ${status}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  },
};

/** Turn a notification row into display text + icon, using its frozen snapshot.
 *  Texts come from notification_templates when loaded; defaults otherwise.
 *  Icons always come from the defaults (not editable). */
export function renderNotification(n: NotificationRow): RenderedNotification {
  const base = renderNotificationDefault(n);
  const tpl = bellTemplates?.[bellTemplateKey(n)];
  if (tpl?.bell_title && tpl?.bell_body) {
    const d = n.data ?? {};
    const trip = d.trip_title ? `“${d.trip_title}”` : 'the trip';
    const stage = d.stage || '';
    const vars: Record<string, string> = {
      trip,
      actor: d.actor_name || 'Someone',
      item: d.item_name ?? d.gear_name ?? 'gear',
      qty: d.qty != null ? String(d.qty) : '',
      preview: d.preview || `New update in ${trip}.`,
      days: stage.includes('_') ? stage.split('_')[1] : '',
    };
    // An admin-edited template is a single title/body string — it can't express
    // the name/action split, so drop bodyParts and render it as plain text.
    return {
      ...base,
      title: fillTemplate(tpl.bell_title, vars),
      body: fillTemplate(tpl.bell_body, vars),
      bodyParts: undefined,
    };
  }
  return base;
}

/** The hardcoded default rendering (also the fallback when templates are absent). */
function renderNotificationDefault(n: NotificationRow): RenderedNotification {
  const d = n.data ?? {};
  const who = d.actor_name || 'Someone';
  const trip = d.trip_title ? `“${d.trip_title}”` : 'the trip';
  // Bare trip name (no quotes) for the bold spans in the new name/action layout.
  const tripName = d.trip_title || 'the trip';
  const decision = d.decision === 'approved' ? 'approved' : 'declined';

  switch (n.type) {
    case 'member_joined':
      return {
        title: who,
        body: `joined ${tripName}`,
        bodyParts: [{ t: 'joined ' }, { t: tripName, b: true }],
        icon: 'person-add-outline',
      };
    case 'member_committed':
      return {
        title: who,
        body: `committed to ${tripName}`,
        bodyParts: [{ t: 'committed to ' }, { t: tripName, b: true }],
        icon: 'checkmark-done-outline',
      };
    case 'gear_claimed': {
      const claimed = `${d.qty ?? ''} ${d.gear_name ?? 'gear'}`.replace(/\s+/g, ' ').trim();
      return {
        title: who,
        body: `claimed ${claimed}`,
        bodyParts: [{ t: 'claimed ' }, { t: claimed, b: true }],
        icon: 'cube-outline',
      };
    }
    case 'admin_update_posted':
      return {
        title: 'New trip update',
        body: d.preview ? `${d.preview}` : `New update in ${trip}.`,
        icon: 'megaphone-outline',
      };
    case 'group_gear_updated':
      return { title: 'Group gear updated', body: `The group gear list for ${trip} changed.`, icon: 'list-outline' };
    case 'personal_gear_updated':
      return { title: 'Your gear updated', body: `Your gear list for ${trip} was updated.`, icon: 'list-outline' };
    case 'gear_request_decided':
      return {
        title: `Gear request ${decision}`,
        body: `Your request for ${d.item_name ?? 'gear'} was ${decision}.`,
        icon: decision === 'approved' ? 'checkmark-circle-outline' : 'close-circle-outline',
      };
    case 'commitment_decided':
      return {
        title: `Commitment ${decision}`,
        body: `Your commitment was ${decision}.`,
        icon: decision === 'approved' ? 'checkmark-circle-outline' : 'close-circle-outline',
      };
    case 'join_request_decided':
      return {
        title: `Request ${decision}`,
        body: `Your request to join ${trip} was ${decision}.`,
        icon: decision === 'approved' ? 'checkmark-circle-outline' : 'close-circle-outline',
      };
    case 'join_request_received':
      return {
        title: who,
        body: `requested to join ${tripName}`,
        bodyParts: [{ t: 'requested to ' }, { t: `join ${tripName}`, b: true }],
        icon: 'person-add-outline',
      };
    case 'gear_request_received': {
      const item = d.item_name ?? d.gear_name ?? 'gear';
      return {
        title: who,
        body: `suggested to add ${item} to Group Gear`,
        bodyParts: [
          { t: 'suggested to add ' },
          { t: item, b: true },
          { t: ' to ' },
          { t: 'Group Gear', b: true },
        ],
        icon: 'cube-outline',
      };
    }
    case 'commitment_request_received':
      return {
        title: who,
        body: `wants to commit to ${tripName}`,
        bodyParts: [
          { t: 'wants to ' },
          { t: 'commit', b: true },
          { t: ' to ' },
          { t: tripName, b: true },
        ],
        icon: 'hand-right-outline',
      };
    case 'member_left':
      return {
        title: who,
        body: `left ${tripName}`,
        bodyParts: [{ t: 'left ' }, { t: tripName, b: true }],
        icon: 'exit-outline',
      };
    case 'trip_cancelled':
      return { title: 'Trip cancelled', body: `${trip} was cancelled.`, icon: 'close-circle-outline' };
    case 'member_removed': {
      // Absent `refund_usd` means no money moved — say nothing rather than "$0".
      const refund = typeof d.refund_usd === 'number' && d.refund_usd > 0 ? d.refund_usd : null;
      return {
        title: 'Removed from trip',
        body: refund
          ? `You're no longer part of ${trip}. $${refund.toFixed(2)} is on its way back.`
          : `You're no longer part of ${trip}.`,
        icon: 'remove-circle-outline',
      };
    }
    case 'trip_dates_changed': {
      // `date_range` is formatted by the trigger, not here, so the bell and the
      // push name the dates identically. A row written before that key existed
      // falls back to the vaguer sentence rather than printing "undefined".
      const range = typeof d.date_range === 'string' ? d.date_range : '';
      const moved = d.has_deadlines ? ' Your deadlines moved with them.' : '';
      return {
        title: 'New trip dates',
        body: range
          ? `${trip} now runs ${range}.${moved}`
          : `The dates for ${trip} changed.${moved}`,
        icon: 'calendar-outline',
      };
    }
    case 'trip_reminder': {
      const s = d.stage || '';
      if (s === 'tomorrow') return { title: 'Trip tomorrow', body: `${trip} starts tomorrow.`, icon: 'time-outline' };
      if (s === 'today') return { title: 'Trip today', body: `${trip} starts today.`, icon: 'time-outline' };
      if (s.startsWith('commit_')) return { title: 'Lock your spot', body: `Commit to ${trip} before it fills up.`, icon: 'time-outline' };
      if (s.startsWith('gear_')) return { title: 'Gear still needed', body: `Some gear for ${trip} still needs an owner.`, icon: 'time-outline' };
      return { title: 'Trip reminder', body: `${trip} is coming up.`, icon: 'time-outline' };
    }
    case 'trip_ended':
      return { title: 'Trip ended', body: `Share your photos & memories from ${trip}.`, icon: 'images-outline' };
    case 'trip_invite_received':
      return {
        title: who,
        body: `invited you to join ${tripName}`,
        bodyParts: [{ t: 'invited you to join ' }, { t: tripName, b: true }],
        icon: 'mail-outline',
      };
    case 'trip_invite_accepted':
      return {
        title: who,
        body: `accepted your invite to ${tripName}`,
        bodyParts: [{ t: 'accepted your invite to ' }, { t: tripName, b: true }],
        icon: 'checkmark-circle-outline',
      };
    case 'trip_invite_declined':
      return {
        title: who,
        body: `declined your invite to ${tripName}`,
        bodyParts: [{ t: 'declined your invite to ' }, { t: tripName, b: true }],
        icon: 'close-circle-outline',
      };
    case 'operator_document_rejected': {
      // The operator's reason IS the notification — it is the only thing that
      // tells the traveler what to do differently. The document name leads so
      // someone with several outstanding items knows which one to redo.
      const what = d.requirement_title || 'document';
      return {
        title: `${what} sent back`,
        body: d.note
          ? `${d.note}`
          : `Your organiser asked for a new one for ${trip}.`,
        icon: 'close-circle-outline',
      };
    }
    case 'operator_requirement_due_soon': {
      // The document name leads, for the same reason it does above: someone
      // with three outstanding items needs to know which one is being asked
      // for. Deliberately not phrased as an accusation — this fires on things
      // that are merely still open, not only on things that are late.
      const needed = d.requirement_title || 'A document';
      return {
        title: `${needed} still needed`,
        body: `Your organiser is still waiting for this for ${trip}.`,
        icon: 'time-outline',
      };
    }
    case 'operator_requirement_overdue': {
      // Same document, past its due date — DOC-3 in the notifications plan.
      // Names the deadline, not just "late", since a traveler juggling
      // several items needs the date to know how late.
      const needed = d.requirement_title || 'A document';
      const label = d.due_date_label ? ` It was due ${d.due_date_label}.` : '';
      return {
        title: `${needed} is late`,
        body: `Your organiser is waiting for this for ${trip}.${label}`,
        icon: 'alert-circle-outline',
      };
    }
    case 'operator_requirement_overdue_operator': {
      // OPS-2 in the plan. One row per requirement, never one per stuck
      // traveler — `data.count` is the whole point of batching it that way.
      const needed = d.requirement_title || 'A document';
      const count = typeof d.count === 'number' ? d.count : null;
      const who = count === 1 ? '1 person' : `${count ?? 'Some'} people`;
      return {
        title: `${who} late on ${needed}`,
        body: `Open the dashboard to chase them for ${trip}.`,
        icon: 'alert-circle-outline',
      };
    }
    case 'operator_payment_stuck':
      // "Nothing was charged" leads because it answers the traveler's actual
      // fear — a declined card leaves someone unsure whether money moved. The
      // same copy for both reasons (declined / abandoned): the instruction is
      // identical, and the reason only decides which one the traveler already
      // knows.
      return {
        title: 'Your payment did not finish',
        body: `Nothing was charged for ${trip}. You can try again.`,
        icon: 'card-outline',
      };
    case 'operator_charge_disputed': {
      // The deadline leads the body: it is the only part of a chargeback with
      // a clock on it, and the operator's evidence (booking records, the
      // waiver, messages) is the only thing that wins one. Deliberately does
      // NOT say "respond in your Stripe dashboard" — the dispute sits on
      // Swellyo's platform account, and an operator hunting their Express
      // dashboard for a case that is not there would lose days.
      const amount = typeof d.amount_usd === 'number' ? `$${d.amount_usd.toFixed(2)} ` : '';
      const due = d.evidence_due_label ? ` Evidence is due by ${d.evidence_due_label} — gather your booking records.` : '';
      return {
        title: `A ${amount}payment was disputed`,
        body: `A traveler's bank is taking back a payment on ${trip}.${due}`,
        icon: 'alert-circle-outline',
      };
    }
    case 'operator_dispute_closed': {
      const amount = typeof d.amount_usd === 'number' ? `$${d.amount_usd.toFixed(2)}` : 'The payment';
      return d.outcome === 'lost'
        ? {
            title: 'The dispute was lost',
            body: `${amount} went back to the traveler's bank for ${trip}.`,
            icon: 'close-circle-outline',
          }
        : {
            title: 'You won the dispute',
            body: `The bank ruled in your favor — the payment on ${trip} stands.`,
            icon: 'checkmark-circle-outline',
          };
    }
    case 'operator_setup_required':
      // Says what they GET, not what we need. "Finish your setup" is a chore;
      // being told you can now sell trips is the reason to open it.
      return {
        title: 'You can now run trips on Swellyo',
        body: 'Four quick things to set up before you create your first one.',
        icon: 'rocket-outline',
      };
    case 'operator_stripe_ready':
      // Not about a trip, so no trip name and nothing to tap through to. The
      // point of the row is to end the waiting: an operator who connected
      // Stripe and was told "we will review this" has been given no way to
      // find out the answer except opening the app and looking.
      return {
        title: 'Stripe approved you',
        body: 'You can now collect payment for your trips in Swellyo.',
        icon: 'card-outline',
      };
    case 'operator_stripe_action_needed':
      // One type, four sentences. "Contact Stripe support" and "send them a
      // document" are not the same instruction, and an operator who reads the
      // wrong one wastes the time they have left.
      //
      // Never Stripe's own field names, here or in the push. With Express
      // accounts it is Stripe's form that collects the requirements, and
      // 'individual.verification.document' tells an operator nothing they can
      // act on — the same reason `describeConnectState` shows a count instead.
      switch (d.reason) {
        case 'blocked':
          return {
            title: 'Stripe closed your payout account',
            body: 'You can no longer collect payments. Stripe decides this, not Swellyo — contact Stripe support to find out why.',
            icon: 'alert-circle-outline',
          };
        case 'charges_disabled':
          return {
            title: 'Your payments have stopped',
            body: 'Stripe switched off payments on your account. Travelers cannot pay you until it is fixed.',
            icon: 'alert-circle-outline',
          };
        case 'payouts_disabled':
          return {
            title: 'Stripe paused your payouts',
            body: 'You can still take payments, but the money is not reaching your bank yet.',
            icon: 'card-outline',
          };
        default:
          // 'past_due' — and the fallback, because a reason we do not know is
          // still a reason to look. Word for word what the setup card says in
          // `action_needed`, so the notification and the screen it opens agree.
          return {
            title: 'Stripe needs something from you',
            body: 'Some details are past their deadline. Send them now, or Stripe will stop your payments.',
            icon: 'time-outline',
          };
      }
    case 'operator_staff_invited': {
      // The tier leads. "Marta added you to El Salvador 26" says nothing about
      // what you are being handed — Crew and Manager are very different jobs,
      // and Manager can read every traveler's passport. Naming it in the row
      // means the answer is informed before the sheet is even open.
      const who = d.actor_name || 'An operator';
      const tier = d.role_label || 'crew';
      return {
        title: `Join ${trip} as ${tier}?`,
        body: `${who} wants you on the crew.`,
        icon: 'people-outline',
      };
    }
    default:
      return { title: 'Notification', body: '', icon: 'notifications-outline' };
  }
}

/** Short relative time: "now", "5m", "3h", "2d", or a date. */
export function formatNotificationTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const dte = new Date(iso);
  return `${dte.getUTCDate().toString().padStart(2, '0')}/${(dte.getUTCMonth() + 1).toString().padStart(2, '0')}`;
}
