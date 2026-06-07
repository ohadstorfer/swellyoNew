/**
 * match_surfers RPC client wrapper
 *
 * Calls the in-DB `match_surfers` Postgres function (filter + score + rank + limit)
 * and maps rows to MatchedUser. Used by the non-copy TripPlanningChatScreen for
 * local testing of the scalable matching path. Production (copy screen + edge
 * function) is untouched.
 *
 * Parity reference: supabase/functions/swelly-trip-planning-copy/index.ts
 */
import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { TripPlanningRequest, MatchedUser } from '../../types/tripPlanning';

/** Mirror of hasMeaningfulQueryFiltersInline in the edge function. */
function hasMeaningfulQueryFilters(q: any): boolean {
  if (!q || typeof q !== 'object') return false;
  if (Array.isArray(q.country_from) && q.country_from.length > 0) return true;
  if (Array.isArray(q.surfboard_type) && q.surfboard_type.length > 0) return true;
  if (q.surf_level_category != null) return true;
  if (typeof q.age_min === 'number') return true;
  if (typeof q.age_max === 'number') return true;
  return false;
}

export function mapRpcRowToMatchedUser(r: any): MatchedUser {
  return {
    user_id: r.user_id,
    name: r.name ?? 'User',
    profile_image_url: r.profile_image_url ?? null,
    match_score: r.match_score ?? 0,
    matched_areas: r.matched_areas ?? [],
    common_lifestyle_keywords: [],
    common_wave_keywords: [],
    surfboard_type: r.surfboard_type ?? undefined,
    surf_level: r.surf_level ?? undefined,
    travel_experience: r.travel_experience ?? undefined,
    country_from: r.country_from ?? undefined,
    age: r.age ?? undefined,
    days_in_destination: r.days_in_destination ?? 0,
    destinations_array: r.destinations_array,
    matchQuality: {
      matchCount: 1,
      countryMatch: !!r.country_match,
      areaMatch: !!r.area_match,
      townMatch: false,
    } as any,
  };
}

export async function findMatchingUsersRpc(
  request: TripPlanningRequest,
  requestingUserId: string,
  excludedIds: string[] = []
): Promise<{ matches: MatchedUser[]; totalCount: number }> {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured');
  const qf: any = (request as any).queryFilters || {};
  const dest = request.destination_country?.trim() || null;
  if (!dest && !hasMeaningfulQueryFilters(qf)) {
    throw new Error('Either destination_country or at least one query filter (e.g. country_from, age_min/age_max, surfboard_type, surf_level_category) is required for matching.');
  }
  const cat = qf.surf_level_category != null
    ? (Array.isArray(qf.surf_level_category) ? qf.surf_level_category : [qf.surf_level_category])
    : null;

  const { data, error } = await supabase.rpc('match_surfers', {
    p_requesting_user_id: requestingUserId,
    p_excluded_ids: excludedIds,
    p_destination_country: dest,
    p_area: request.area || null,
    p_country_from: Array.isArray(qf.country_from) && qf.country_from.length ? qf.country_from : null,
    p_surfboard_type: Array.isArray(qf.surfboard_type) && qf.surfboard_type.length ? qf.surfboard_type : null,
    p_surf_level_category: cat,
    p_age_min: typeof qf.age_min === 'number' ? qf.age_min : null,
    p_age_max: typeof qf.age_max === 'number' ? qf.age_max : null,
    p_limit: 3,
  });
  if (error) throw new Error(error.message);
  const rows: any[] = data || [];
  const totalCount = rows.length ? Number(rows[0].total_count) : 0;
  return { matches: rows.map(mapRpcRowToMatchedUser), totalCount };
}
