import { supabase, isSupabaseConfigured } from '../../config/supabase';

/**
 * Data layer for the admin group-trips analytics charts.
 * All numbers come from the `analytics-trips` edge function, which excludes
 * demo users and admins (event rows carry is_demo_user/is_admin flags;
 * participant cohorts are filtered via surfers.is_demo_user / is_admin).
 */

/** One point on a retention curve: of `eligible` users, `active` opened the app on day-N. */
export interface RetentionPoint {
  day: number;
  active: number;
  eligible: number;
}

export interface TripsRetention {
  /** Day offsets measured: [0, 1, 3, 7, 14, 30]. */
  buckets: number[];
  joiners: RetentionPoint[];
  hosts: RetentionPoint[];
  /** Cohort sizes (joiners = earliest role 'member', hosts = earliest role 'host'). */
  totals: { joiners: number; hosts: number };
}

export interface AdoptionFeature {
  /** The analytics event_name (e.g. 'trip_commit'). */
  key: string;
  joiners: { used: number; denom: number };
  hosts: { used: number; denom: number };
}

export interface TripsAdoption {
  /** The range the adoption numbers were computed over (null = all-time). */
  range: { from: string | null; to: string | null };
  features: AdoptionFeature[];
}

export type TripHealthTag = 'alive' | 'cooling' | 'dead' | 'completed';

export interface TripHealthDay {
  day: number;
  /**
   * Distinct non-demo/admin users with a trip_opened OR trip_chat_opened
   * event for this trip on the exact calendar day (created_at date + N days,
   * UTC). null = that day is still in the future for this trip.
   */
  active: number | null;
}

export interface TripHealthRow {
  trip_id: string;
  title: string | null;
  crew: number;
  created_at: string;
  days: TripHealthDay[];
  tag: TripHealthTag;
  /** Distinct users active in the last 7 calendar days. */
  last7_active: number;
}

export interface TripsHealth {
  /** Day offsets measured: [0, 1, 3, 7, 14, 21, 30]. */
  buckets: number[];
  /** Sorted: alive, cooling, dead, completed; within group by crew desc. */
  trips: TripHealthRow[];
}

export interface TripsAnalyticsData {
  retention: TripsRetention;
  adoption: TripsAdoption;
  health: TripsHealth;
}

export interface TripsAnalyticsRange {
  from?: string | null; // ISO timestamp
  to?: string | null;   // ISO timestamp
}

/**
 * Fetch the group-trips analytics. Caller must be an admin (`users.role = 'admin'`).
 * The edge function returns 401/403 otherwise.
 *
 * The optional range applies ONLY to the adoption chart; retention and health
 * are always computed over all time.
 */
export async function fetchTripsAnalytics(range: TripsAnalyticsRange = {}): Promise<TripsAnalyticsData> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }
  const body: Record<string, string> = {};
  if (range.from) body.from = range.from;
  if (range.to) body.to = range.to;

  const { data, error } = await supabase.functions.invoke<TripsAnalyticsData>('analytics-trips', {
    body,
  });
  if (error) throw error;
  if (!data) throw new Error('Empty response from analytics-trips');
  return data;
}
