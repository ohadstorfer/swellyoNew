import { supabase, isSupabaseConfigured } from '../../config/supabase';

export interface OnboardingMatch {
  user_id: string;
  conversation_id: string;
  total_score: number;
  scores: {
    age: number;
    country: number;
    surf_level: number;
    board: number;
    lifestyle: number;
  };
}

export interface OnboardingMatchResult {
  matches: OnboardingMatch[];
  match_count: number;
}

/**
 * Finds the 3 closest surfer matches and creates direct conversations with them.
 * Called once after the user completes onboarding and presses "Save" on their profile.
 * Idempotent — calling again will not create duplicate conversations.
 */
export async function findAndConnectMatches(): Promise<OnboardingMatchResult | null> {
  if (!isSupabaseConfigured()) {
    console.warn('[onboardingMatchingService] Supabase not configured, skipping matching');
    return null;
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('[onboardingMatchingService] User not authenticated:', authError);
      return null;
    }

    console.log('[onboardingMatchingService] Finding matches for user:', user.id);

    const { data, error } = await supabase.rpc('find_and_connect_matches', {
      input_user_id: user.id,
    });

    if (error) {
      console.error('[onboardingMatchingService] RPC error:', error);
      return null;
    }

    const result = data as OnboardingMatchResult;
    console.log(`[onboardingMatchingService] Found ${result.match_count} matches`);
    return result;
  } catch (error) {
    console.error('[onboardingMatchingService] Unexpected error:', error);
    return null;
  }
}
