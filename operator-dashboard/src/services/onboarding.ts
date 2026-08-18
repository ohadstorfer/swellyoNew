import { supabase } from '../lib/supabase';

/**
 * A traveler who paid their deposit and never finished onboarding.
 *
 * They are in a state that looks like nothing from either side: their money is
 * with the operator, but they hold no spot and are not on the trip. Nothing
 * surfaced them until this — the operator had to notice a name missing from a
 * list they had no reason to count.
 */
export interface StalledOnboarder {
  userId: string;
  /** Whole days since they last did anything at all — paid, uploaded, signed. */
  stalledDays: number;
  /** The must_have steps still blocking them. Never the skippable ones. */
  missingTitles: string[];
}

/**
 * After a week, being stuck stops being someone's busy fortnight and becomes
 * the operator's problem. That is also the point where the traveler has had all
 * three of their nudges (24h, 3 days, 7 days) and answered none of them, so
 * there is nothing left for the automatic path to try.
 */
export const STALLED_TODO_DAYS = 7;

/**
 * Reads the same RPC the nudge scanner does, so the to-do here and the
 * notifications a traveler receives can never disagree about who is stuck.
 *
 * Returns [] for anyone without `roster.view` on the trip — the function
 * filters rather than raising, so this needs no permission branch of its own.
 */
export async function fetchStalledOnboarders(tripId: string): Promise<StalledOnboarder[]> {
  const { data, error } = await supabase.rpc('operator_stalled_onboarders', {
    p_trip_id: tripId,
  });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    stalledDays: Math.floor((r.stalled_hours ?? 0) / 24),
    missingTitles: (r.missing_titles ?? []) as string[],
  }));
}
