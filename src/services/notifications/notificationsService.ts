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
  | 'trip_ended';

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
  | 'breakdown';    // Plan → group breakdown

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
        body: `Suggested to add ${item} to Group Gear`,
        bodyParts: [
          { t: 'Suggested to add ' },
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
        body: `Wants to commit to ${tripName}`,
        bodyParts: [
          { t: 'Wants to ' },
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
    case 'member_removed':
      return { title: 'Removed from trip', body: `You're no longer part of ${trip}.`, icon: 'remove-circle-outline' };
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
