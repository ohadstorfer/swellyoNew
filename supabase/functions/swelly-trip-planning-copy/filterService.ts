/**
 * Filter Service (root copy for bundler)
 */
import { MatchingRequest } from './types.ts';

export function buildSurferQuery(
  request: MatchingRequest['tripPlanningData'],
  requestingUserId: string,
  excludedUserIds: string[],
  supabaseAdmin: any
): any {
  let query = supabaseAdmin
    .from('surfers')
    .select('*')
    .neq('user_id', requestingUserId);

  if (excludedUserIds && excludedUserIds.length > 0) {
    if (excludedUserIds.length <= 10) {
      for (const excludedId of excludedUserIds) {
        query = query.neq('user_id', excludedId);
      }
      console.log(`[filterService] Excluded ${excludedUserIds.length} users in query`);
    } else {
      console.log(`[filterService] Will exclude ${excludedUserIds.length} users in-memory (too many for query)`);
    }
  }

  if (request.queryFilters) {
    query = applyQueryFilters(query, request.queryFilters);
  }

  return query;
}

export function applyQueryFilters(query: any, queryFilters: any): any {
  if (!queryFilters || typeof queryFilters !== 'object') return query;
  const q = { ...queryFilters };
  // Normalize single age or age_range into age_min/age_max (filtering only uses age_min/age_max)
  if (typeof q.age === 'number' && (q.age_min === undefined || q.age_max === undefined)) {
    q.age_min = q.age;
    q.age_max = q.age;
    delete q.age;
  }
  if (Array.isArray(q.age_range) && q.age_range.length > 0) {
    const nums = q.age_range.filter((x: unknown) => typeof x === 'number') as number[];
    if (nums.length === 2) {
      q.age_min = Math.min(nums[0], nums[1]);
      q.age_max = Math.max(nums[0], nums[1]);
    } else if (nums.length === 1) {
      q.age_min = nums[0];
      q.age_max = nums[0];
    }
    delete q.age_range;
  }

  console.log('[filterService] Applying query filters:', JSON.stringify(q, null, 2));

  if (q.country_from && Array.isArray(q.country_from) && q.country_from.length > 0) {
    query = query.in('country_from', q.country_from);
    console.log(`[filterService]   - Filtering by country_from: ${q.country_from.join(', ')}`);
  }

  if (q.age_min !== undefined && q.age_min !== null && typeof q.age_min === 'number') {
    query = query.gte('age', q.age_min);
    console.log(`[filterService]   - Filtering by age_min: ${q.age_min}`);
  }
  if (q.age_max !== undefined && q.age_max !== null && typeof q.age_max === 'number') {
    query = query.lte('age', q.age_max);
    console.log(`[filterService]   - Filtering by age_max: ${q.age_max}`);
  }

  if (q.surfboard_type) {
    const surfboardTypes = Array.isArray(q.surfboard_type)
      ? q.surfboard_type
      : [q.surfboard_type];
    if (surfboardTypes.length > 0) {
      query = query.in('surfboard_type', surfboardTypes);
      console.log(`[filterService]   - Filtering by surfboard_type: ${surfboardTypes.join(', ')}`);
    }
  }

  if (q.surf_level_category) {
    const surfLevelCategories = Array.isArray(q.surf_level_category)
      ? q.surf_level_category
      : [q.surf_level_category];

    if (surfLevelCategories.length > 0) {
      if (surfLevelCategories.length === 1) {
        query = query.eq('surf_level_category', surfLevelCategories[0]);
        console.log(`[filterService]   - Filtering by surf_level_category: ${surfLevelCategories[0]}`);
      } else {
        query = query.in('surf_level_category', surfLevelCategories);
        console.log(`[filterService]   - Filtering by surf_level_category (multiple): ${surfLevelCategories.join(', ')}`);
      }
    }
  }
  else if (q.surf_level_min !== undefined || q.surf_level_max !== undefined) {
    if (q.surf_level_min !== undefined && q.surf_level_min !== null && typeof q.surf_level_min === 'number') {
      query = query.gte('surf_level', q.surf_level_min);
      console.log(`[filterService]   - Filtering by surf_level_min: ${q.surf_level_min}`);
    }
    if (q.surf_level_max !== undefined && q.surf_level_max !== null && typeof q.surf_level_max === 'number') {
      query = query.lte('surf_level', q.surf_level_max);
      console.log(`[filterService]   - Filtering by surf_level_max: ${q.surf_level_max}`);
    }
  }

  return query;
}

export function filterExcludedUsersInMemory(
  surfers: any[],
  excludedUserIds: string[]
): any[] {
  if (!excludedUserIds || excludedUserIds.length === 0) {
    return surfers;
  }

  const beforeCount = surfers.length;
  const filtered = surfers.filter((surfer: any) => !excludedUserIds.includes(surfer.user_id));
  const afterCount = filtered.length;

  if (beforeCount !== afterCount) {
    console.log(`[filterService] In-memory filter removed ${beforeCount - afterCount} excluded users`);
  }

  return filtered;
}
