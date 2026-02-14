/**
 * Filter Service: Query Building and Filtering
 * 
 * Builds optimized Supabase queries with filters applied at database level
 */

import { MatchingRequest } from '../types.ts';

/**
 * Build optimized Supabase query with all filters applied
 * Applies queryFilters at database level for performance
 */
export function buildSurferQuery(
  request: MatchingRequest['tripPlanningData'],
  requestingUserId: string,
  excludedUserIds: string[],
  supabaseAdmin: any
): any {
  // Start with base query - exclude requesting user
  let query = supabaseAdmin
    .from('surfers')
    .select('*')
    .neq('user_id', requestingUserId);

  // Exclude previously matched users
  // Since Supabase doesn't support .not('user_id', 'in', array) directly,
  // we'll filter in-memory after the query
  // But we can still optimize by excluding one at a time if the list is small
  if (excludedUserIds && excludedUserIds.length > 0) {
    if (excludedUserIds.length <= 10) {
      // For small lists, exclude individually
      for (const excludedId of excludedUserIds) {
        query = query.neq('user_id', excludedId);
      }
      console.log(`[filterService] Excluded ${excludedUserIds.length} users in query`);
    } else {
      console.log(`[filterService] Will exclude ${excludedUserIds.length} users in-memory (too many for query)`);
    }
  }

  // Apply query filters if available
  if (request.queryFilters) {
    query = applyQueryFilters(query, request.queryFilters);
  }

  return query;
}

/**
 * Apply query filters to Supabase query builder
 * Handles all filter types efficiently
 */
export function applyQueryFilters(query: any, queryFilters: any): any {
  console.log('[filterService] Applying query filters:', JSON.stringify(queryFilters, null, 2));

  // Filter by country_from (array of countries)
  if (queryFilters.country_from && Array.isArray(queryFilters.country_from) && queryFilters.country_from.length > 0) {
    query = query.in('country_from', queryFilters.country_from);
    console.log(`[filterService]   - Filtering by country_from: ${queryFilters.country_from.join(', ')}`);
  }

  // Filter by age range
  if (queryFilters.age_min !== undefined && queryFilters.age_min !== null && typeof queryFilters.age_min === 'number') {
    query = query.gte('age', queryFilters.age_min);
    console.log(`[filterService]   - Filtering by age_min: ${queryFilters.age_min}`);
  }
  if (queryFilters.age_max !== undefined && queryFilters.age_max !== null && typeof queryFilters.age_max === 'number') {
    query = query.lte('age', queryFilters.age_max);
    console.log(`[filterService]   - Filtering by age_max: ${queryFilters.age_max}`);
  }

  // Filter by surfboard_type (array or single value)
  if (queryFilters.surfboard_type) {
    const surfboardTypes = Array.isArray(queryFilters.surfboard_type)
      ? queryFilters.surfboard_type
      : [queryFilters.surfboard_type];
    if (surfboardTypes.length > 0) {
      query = query.in('surfboard_type', surfboardTypes);
      console.log(`[filterService]   - Filtering by surfboard_type: ${surfboardTypes.join(', ')}`);
    }
  }

  // Filter by surf_level_category (preferred method)
  // Supports both single string and array of strings
  if (queryFilters.surf_level_category) {
    const surfLevelCategories = Array.isArray(queryFilters.surf_level_category)
      ? queryFilters.surf_level_category
      : [queryFilters.surf_level_category];

    if (surfLevelCategories.length > 0) {
      if (surfLevelCategories.length === 1) {
        // Single value - use eq for efficiency
        query = query.eq('surf_level_category', surfLevelCategories[0]);
        console.log(`[filterService]   - Filtering by surf_level_category: ${surfLevelCategories[0]}`);
      } else {
        // Multiple values - use in
        query = query.in('surf_level_category', surfLevelCategories);
        console.log(`[filterService]   - Filtering by surf_level_category (multiple): ${surfLevelCategories.join(', ')}`);
      }
    }
  }
  // Legacy: Filter by numeric surf_level (for backward compatibility)
  else if (queryFilters.surf_level_min !== undefined || queryFilters.surf_level_max !== undefined) {
    if (queryFilters.surf_level_min !== undefined && queryFilters.surf_level_min !== null && typeof queryFilters.surf_level_min === 'number') {
      query = query.gte('surf_level', queryFilters.surf_level_min);
      console.log(`[filterService]   - Filtering by surf_level_min: ${queryFilters.surf_level_min}`);
    }
    if (queryFilters.surf_level_max !== undefined && queryFilters.surf_level_max !== null && typeof queryFilters.surf_level_max === 'number') {
      query = query.lte('surf_level', queryFilters.surf_level_max);
      console.log(`[filterService]   - Filtering by surf_level_max: ${queryFilters.surf_level_max}`);
    }
  }

  // Note: destination_days_min is handled in-memory after query
  // because it requires checking destinations_array JSONB field

  return query;
}

/**
 * Filter out excluded users in-memory (safety net)
 * Used when query-level exclusion isn't possible or sufficient
 */
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




