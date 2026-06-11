/**
 * Broadcast topic names for group-trip realtime — must match what the
 * broadcast_trip_change DB trigger sends to
 * (supabase/migrations/20260610000001_group_trips_broadcast_trigger.sql).
 *
 * All three are PRIVATE channels; subscription auth is the
 * "trips: read trip topics" policy on realtime.messages.
 */
export const tripTopic = (tripId: string) => `trip:${tripId}`;
export const TRIPS_LIST_TOPIC = 'trips-list';
export const userTripsTopic = (userId: string) => `user-trips:${userId}`;
