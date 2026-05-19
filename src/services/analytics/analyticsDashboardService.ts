import { supabase, isSupabaseConfigured } from '../../config/supabase';

/**
 * Counter shape returned by the analytics-dashboard edge function for every event.
 *  - total:  count within the selected range (all-time if no range)
 *  - prev:   count within the equivalent prior range (for delta % calc; 0 if no range)
 *  - series: daily counts over the last 30 days, oldest -> newest (for the sparkline)
 *
 * For "repeatable" events (app_opened, swelly_search_clicked, swelly_connect_clicked),
 * total/prev/series-day-values are COUNT(DISTINCT user_id) — each user counts once per
 * range/day. For one-shot events they are COUNT(*).
 */
export interface DashboardCounter {
  total: number;
  prev: number;
  series: number[];
}

export const EVENT_NAMES = [
  'user_signed_up',
  'onboarding_step_1',
  'onboarding_step_2',
  'onboarding_step_3',
  'onboarding_step_4',
  'onboarding_step_5',
  'onboarding_step_6',
  'onboarding_step_7',
  'onboarding_finalized',
  'swelly_search_clicked',
  'swelly_connect_clicked',
  'first_message_sent',
  'conversation_two_sided',
  'conversation_deep_engaged',
  'app_opened',
] as const;
export type EventName = typeof EVENT_NAMES[number];

export interface DashboardData {
  range: { from: string | null; to: string | null };
  prev_range: { from: string | null; to: string | null };
  metrics: Record<EventName, DashboardCounter>;
  /**
   * 1:1 conversations with >=1 message in the range. Sourced live from the
   * `messages` table (not analytics_events). May be undefined if the
   * analytics-dashboard edge function predates this field.
   */
  active_conversations?: DashboardCounter;
}

export interface DashboardRange {
  from?: string | null; // ISO timestamp
  to?: string | null;   // ISO timestamp
}

/**
 * Fetch the analytics dashboard. Caller must be an admin (`users.role = 'admin'`).
 * The edge function returns 401/403 otherwise.
 */
export async function fetchDashboard(range: DashboardRange = {}): Promise<DashboardData> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }
  const body: Record<string, string> = {};
  if (range.from) body.from = range.from;
  if (range.to) body.to = range.to;

  const { data, error } = await supabase.functions.invoke<DashboardData>('analytics-dashboard', {
    body,
  });
  if (error) throw error;
  if (!data) throw new Error('Empty response from analytics-dashboard');
  return data;
}

/**
 * Returns true if the current authenticated user has role='admin' in the users table.
 * Used to gate the entry point in Settings.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (error) return false;
    return data?.role === 'admin';
  } catch {
    return false;
  }
}
