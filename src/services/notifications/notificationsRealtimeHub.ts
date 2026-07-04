/**
 * ONE shared realtime channel for the current user's `notifications` rows.
 * Badge, panel, and the in-app banner attach as in-memory listeners —
 * replacing the 2 postgres_changes subscriptions that existed before
 * (badge + focus-gated panel) with a single stable one.
 *
 * Lifecycle: started once post-auth (AppContent), stopped only at logout
 * (registerLogoutHandlers). NEVER focus-gate this channel — channel churn
 * previously overheated devices (see NotificationCenter badge comment).
 * Resilience intentionally matches the old badge subscription (no rejoin).
 */
import { supabase } from '../../config/supabase';
import type { NotificationRow } from './notificationsService';

type HubListener = {
  onInsert?: (row: NotificationRow) => void;
  onUpdate?: (row: NotificationRow) => void;
};

let channel: ReturnType<typeof supabase.channel> | null = null;
let currentUserId: string | null = null;
const listeners = new Set<HubListener>();

export function startNotificationsHub(userId: string): void {
  if (channel && currentUserId === userId) return; // idempotent
  stopNotificationsHub();
  currentUserId = userId;
  channel = supabase
    .channel(`notifications-hub:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as NotificationRow;
        if (!row?.id) return;
        listeners.forEach((l) => l.onInsert?.(row));
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as NotificationRow;
        if (!row?.id) return;
        listeners.forEach((l) => l.onUpdate?.(row));
      }
    )
    .subscribe((status) => {
      if (__DEV__ && status !== 'SUBSCRIBED') {
        console.log('[notificationsRealtimeHub] status:', status);
      }
    });
}

export function stopNotificationsHub(): void {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  currentUserId = null;
}

/** Attach an in-memory listener; returns unsubscribe. Cheap — no channel churn. */
export function onNotification(l: HubListener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
