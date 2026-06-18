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
