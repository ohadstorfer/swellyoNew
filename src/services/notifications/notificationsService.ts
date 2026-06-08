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
  | 'commitment_request_received';

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

/** Ionicons name used for the row icon. */
type IoniconName = string;

export interface RenderedNotification {
  title: string;
  body: string;
  icon: IoniconName;
}

const TABLE = 'notifications';

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

/** Turn a notification row into display text + icon, using its frozen snapshot. */
export function renderNotification(n: NotificationRow): RenderedNotification {
  const d = n.data ?? {};
  const who = d.actor_name || 'Someone';
  const trip = d.trip_title ? `“${d.trip_title}”` : 'the trip';
  const decision = d.decision === 'approved' ? 'approved' : 'declined';

  switch (n.type) {
    case 'member_joined':
      return { title: 'New member', body: `${who} joined ${trip}.`, icon: 'person-add-outline' };
    case 'member_committed':
      return { title: 'New commitment', body: `${who} committed to ${trip}.`, icon: 'checkmark-done-outline' };
    case 'gear_claimed':
      return {
        title: 'Gear claimed',
        body: `${who} claimed ${d.qty ?? ''} ${d.gear_name ?? 'gear'}`.replace(/\s+/g, ' ').trim() + '.',
        icon: 'cube-outline',
      };
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
      return { title: 'New join request', body: `${who} asked to join ${trip}.`, icon: 'person-add-outline' };
    case 'gear_request_received':
      return { title: 'New gear request', body: `${who} requested ${d.item_name ?? 'gear'}.`, icon: 'cube-outline' };
    case 'commitment_request_received':
      return { title: 'New commitment request', body: `${who} wants to commit to ${trip}.`, icon: 'hand-right-outline' };
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
