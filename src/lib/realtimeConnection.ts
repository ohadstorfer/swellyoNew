import { supabase, isSupabaseConfigured } from '../config/supabase';

/**
 * Realtime socket health.
 *
 * Problem: @supabase/realtime-js calls socket.disconnect() — a MANUAL disconnect
 * that disables auto-reconnect — whenever removeChannel() drops the channel count
 * to zero. After the Broadcast migration added standalone channels that churn
 * (user-inbox, presence), an unlucky teardown order can make a feature channel the
 * last one removed → the whole socket dies and never reconnects, stranding every
 * channel in a CHANNEL_ERROR loop.
 *
 * Fix:
 *  - Keepalive: pin one idle public channel for the authenticated session so the
 *    channel count never hits zero (prevention).
 *  - ensureConnected(): reconnect the socket if it's down; realtime-js then
 *    auto-rejoins all existing channels (cure).
 *  - Auth listener: on token refresh / sign-in, re-sync the realtime JWT and
 *    ensure the socket is connected (covers the mid-join token-refresh race for
 *    private channels).
 *
 * See docs/superpowers/specs/2026-06-05-realtime-socket-reconnect-design.md
 */

const KEEPALIVE_TOPIC = 'keepalive';

let keepaliveChannel: ReturnType<typeof supabase.channel> | null = null;
let authListenerRegistered = false;

/**
 * Reconnect the realtime socket if it isn't connected. On reconnect, realtime-js
 * rejoins all existing channels automatically, so no per-consumer recovery is needed.
 */
export function ensureConnected(): void {
  if (!isSupabaseConfigured()) return;
  try {
    const rt: any = (supabase as any).realtime;
    if (rt && typeof rt.isConnected === 'function' && !rt.isConnected()) {
      rt.connect();
    }
  } catch (e) {
    console.warn('[realtimeConnection] ensureConnected failed:', e);
  }
}

/**
 * Registered exactly once for the app's lifetime (must survive logout → login).
 * On token refresh / sign-in, re-sync the realtime JWT (idempotent belt-and-suspenders
 * alongside supabase-js's internal sync) so in-flight private-channel joins use the
 * fresh token, then make sure the socket is up.
 */
function registerAuthListenerOnce(): void {
  if (authListenerRegistered) return;
  authListenerRegistered = true;
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        try {
          (supabase as any).realtime?.setAuth?.(session?.access_token ?? null);
        } catch (e) {
          console.warn('[realtimeConnection] setAuth on token refresh failed:', e);
        }
        ensureConnected();
      }
    });
  } catch (e) {
    console.warn('[realtimeConnection] registerAuthListener failed:', e);
  }
}

/**
 * Pin an idle public channel for the authenticated session so removeChannel() can
 * never drop the channel count to zero (which would manually disconnect the socket
 * with no auto-reconnect). Idempotent. Registers the global auth listener on first call.
 */
export function startSessionKeepalive(): void {
  if (!isSupabaseConfigured()) return;
  registerAuthListenerOnce();
  if (keepaliveChannel) return;
  try {
    // No .on() bindings and nothing broadcasts here — zero traffic. It exists only
    // to keep channels.length >= 1 so the socket is never manually disconnected.
    keepaliveChannel = supabase.channel(KEEPALIVE_TOPIC);
    keepaliveChannel.subscribe();
  } catch (e) {
    console.warn('[realtimeConnection] startSessionKeepalive failed:', e);
    keepaliveChannel = null;
  }
}

/**
 * Remove the keepalive channel on logout so the socket can close normally.
 */
export function stopSessionKeepalive(): void {
  if (!keepaliveChannel) return;
  try {
    supabase.removeChannel(keepaliveChannel);
  } catch (e) {
    console.warn('[realtimeConnection] stopSessionKeepalive failed:', e);
  } finally {
    keepaliveChannel = null;
  }
}
