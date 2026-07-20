/**
 * Broadcast topic names for group-trip realtime — must match what the
 * broadcast_trip_change DB trigger sends to
 * (supabase/migrations/20260610000001_group_trips_broadcast_trigger.sql).
 *
 * All are PRIVATE channels; subscription auth is the
 * "trips: read trip topics" policy on realtime.messages.
 *
 * Event names must also match the trigger:
 *   - TRIPS_LIST_TOPIC  -> event 'trips_list_changed' (Explore catalogue only)
 *   - tripsMineTopic(id) -> event 'trips_mine_changed' (that user's My Trips)
 */
export const tripTopic = (tripId: string) => `trip:${tripId}`;
export const TRIPS_LIST_TOPIC = 'trips-list';
export const tripsMineTopic = (userId: string) => `trips-mine:${userId}`;
export const userTripsTopic = (userId: string) => `user-trips:${userId}`;

// ---------------------------------------------------------------------------
// acquireTopic — churn-safe subscribe/teardown for focus-gated Broadcast topics.
//
// Focus-gated hooks subscribe on focus and remove on blur, which under fast
// navigation hits two realtime-js hazards (both verified in 2.80.0):
//   1. RealtimeClient._remove filters this.channels by TOPIC — if a new channel
//      for the same topic is created while the old one is still leaving, the
//      old channel's close drops the NEW one from the dispatch list too: it
//      stays joined server-side but never receives another event.
//   2. Leaving a channel whose join hasn't been acked can schedule orphaned
//      rejoin loops (Phoenix #3349) that outlive the screen.
// (Topic names can't be made unique per cycle: the topic IS the routing key
// the broadcast_trip_change trigger sends to.)
//
// Defenses, in order:
//   - LINGER: on release the channel stays live for a grace period; a refocus
//     within it reuses the same channel instance — the common back-and-forth
//     case produces ZERO join/leave traffic. Reuse keeps the original event
//     bindings, so this is only safe while handlers are pure functions of the
//     topic (true for the trips hooks: they only invalidate react-query keys
//     derived from the ids baked into the topic).
//   - JOIN-SETTLE: teardown never calls removeChannel mid-'joining'; it waits
//     for the join to settle first (bounded retries).
//   - SERIALIZED RE-SUBSCRIBE: a new acquire for a topic with a removal still
//     in flight waits for that removal before creating the fresh channel, so
//     hazard 1 can't fire.
// ---------------------------------------------------------------------------
import { supabase } from '../../config/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

const LINGER_MS = 200;
const JOIN_SETTLE_RETRY_MS = 250;
const JOIN_SETTLE_MAX_TRIES = 8;

type LiveEntry = {
  channel: RealtimeChannel;
  refs: number;
  lingerTimer: ReturnType<typeof setTimeout> | null;
};

const liveTopics = new Map<string, LiveEntry>();
const pendingRemovals = new Map<string, Promise<void>>();

function removeWhenJoinSettled(topic: string, channel: RealtimeChannel): void {
  let tries = 0;
  const attempt = (): Promise<void> => {
    if ((channel.state as string) === 'joining' && tries < JOIN_SETTLE_MAX_TRIES) {
      tries += 1;
      return new Promise<void>((res) => setTimeout(res, JOIN_SETTLE_RETRY_MS)).then(attempt);
    }
    return supabase.removeChannel(channel).then(() => undefined).catch(() => undefined);
  };
  const p = attempt().finally(() => {
    if (pendingRemovals.get(topic) === p) pendingRemovals.delete(topic);
  });
  pendingRemovals.set(topic, p);
}

/**
 * Subscribe to a private Broadcast topic. `attach` receives the fresh channel
 * to register `.on(...)` handlers BEFORE subscribe; it is NOT called when a
 * lingering channel is reused (the original handlers stay). Returns a release
 * function — always call it from the effect cleanup, it is idempotent.
 */
export function acquireTopic(
  topic: string,
  attach: (channel: RealtimeChannel) => void,
): () => void {
  let released = false;
  let entry: LiveEntry | null = null;

  const adopt = (e: LiveEntry) => {
    if (e.lingerTimer) {
      clearTimeout(e.lingerTimer);
      e.lingerTimer = null;
    }
    e.refs += 1;
    entry = e;
  };

  const existing = liveTopics.get(topic);
  if (existing) {
    adopt(existing);
  } else {
    (pendingRemovals.get(topic) ?? Promise.resolve()).then(() => {
      if (released) return;
      const raced = liveTopics.get(topic);
      if (raced) {
        adopt(raced);
        return;
      }
      const channel = supabase.channel(topic, { config: { private: true } });
      attach(channel);
      channel.subscribe();
      entry = { channel, refs: 1, lingerTimer: null };
      liveTopics.set(topic, entry);
    });
  }

  return () => {
    if (released) return;
    released = true;
    const e = entry;
    if (!e) return; // creation was still awaiting a pending removal — nothing to undo
    e.refs -= 1;
    if (e.refs > 0) return;
    e.lingerTimer = setTimeout(() => {
      if (liveTopics.get(topic) === e) liveTopics.delete(topic);
      removeWhenJoinSettled(topic, e.channel);
    }, LINGER_MS);
  };
}
