import { supabase, isSupabaseConfigured } from '../../config/supabase';

/**
 * Shape of a single destination as stored in `surfers.destinations_array`.
 * Shared by the onboarding flow and the edit-profile flow.
 */
export type SyncDestination = {
  country: string;
  state?: string;
  area: string[];
  time_in_days: number;
  time_in_text?: string;
};

/**
 * Mirrors a user's `destinations_array` into the `user_destinations` table by
 * firing the `geocode-user-destinations` Edge Function (geocodes each place,
 * upserts rows, reconciles stale ones).
 *
 * Fire-and-forget by design: a Google API hiccup or network blip must never
 * block the user-facing save. The Edge Function resolves the user from the JWT
 * and is conservative — it skips reconcile deletes on partial geocode failure
 * so a transient outage can't lose data.
 *
 * Single source of truth — used by both the edit-profile flow
 * (`ProfileEditPanel`) and onboarding (`onboardingService.saveStep4Destinations`)
 * so the two paths can never drift.
 */
export function syncUserDestinations(destinationsArray: SyncDestination[]): void {
  if (!isSupabaseConfigured()) return;
  supabase.functions
    .invoke('geocode-user-destinations', {
      body: { destinations_array: destinationsArray },
    })
    .catch((err) => console.warn('Geocode destinations failed:', err));
}
