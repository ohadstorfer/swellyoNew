import { supabase, isSupabaseConfigured } from '../../config/supabase';

export interface DashboardCounter {
  total: number;
  in_range: number;
  series: number[]; // daily counts, last 30 days, oldest -> newest
}

export interface DashboardData {
  metric_2: DashboardCounter;   // users created
  metric_3: DashboardCounter;   // onboarding phase 1
  metric_4: DashboardCounter;   // full onboarding
  metric_5: DashboardCounter;   // first Swelly search
  metric_6: DashboardCounter;   // first Swelly match
  metric_7: DashboardCounter;   // convos with 1+ message — bucketed by first-message ts
  metric_8: DashboardCounter;   // both sides replied — bucketed by 2nd-side first-message ts
  metric_9: DashboardCounter;   // 4+ msgs each side — bucketed by 2nd-side 4th-message ts
  metric_10: {
    with_surfer: DashboardCounter;  // real users (have a non-demo surfer row)
    auth_only: DashboardCounter;    // opened the app but never created a surfer profile
  };
  range: { from: string | null; to: string | null };
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
