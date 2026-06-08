import { supabase, isSupabaseConfigured } from '../../config/supabase';

/** Same shape as the Users dashboard counter: total / prior-range / 30-day daily series. */
export interface TripCounter {
  total: number;
  prev: number;
  series: number[];
}

export interface NamedCount {
  label: string;
  count: number;
}

export const TRIP_OVERVIEW_KEYS = [
  'trips_created',
  'join_requests',
  'members_joined',
  'unique_hosts',
  'commitments_approved',
] as const;
export type TripOverviewKey = typeof TRIP_OVERVIEW_KEYS[number];

export interface TripsRates {
  fill_rate_avg: number | null;
  pct_reached_full: number | null;
  cancellation_rate: number | null;
  approval_rate: number | null;
  ghost_trips: number;
  median_response_hours: number | null;
}

export interface TripsDashboardData {
  range: { from: string | null; to: string | null };
  prev_range: { from: string | null; to: string | null };
  overview: Record<TripOverviewKey, TripCounter>;
  breakdowns: {
    status: NamedCount[];
    hosting_style: NamedCount[];
    budget: NamedCount[];
    top_destinations: NamedCount[];
  };
  lifecycle_funnel: NamedCount[];
  demand_funnel: NamedCount[];
  rates: TripsRates;
}

export interface TripsDashboardRange {
  from?: string | null;
  to?: string | null;
}

/**
 * Fetch the trips analytics dashboard. Caller must be an admin (`users.role = 'admin'`);
 * the edge function returns 401/403 otherwise.
 */
export async function fetchTripsDashboard(range: TripsDashboardRange = {}): Promise<TripsDashboardData> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }
  const body: Record<string, string> = {};
  if (range.from) body.from = range.from;
  if (range.to) body.to = range.to;

  const { data, error } = await supabase.functions.invoke<TripsDashboardData>('analytics-trips', { body });
  if (error) throw error;
  if (!data) throw new Error('Empty response from analytics-trips');
  return data;
}
