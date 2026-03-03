/**
 * Filter Service: Query Building and Filtering (copy-copy)
 */

import { MatchingRequest } from '../types.ts'

export function buildSurferQuery(
  request: MatchingRequest['tripPlanningData'],
  requestingUserId: string,
  excludedUserIds: string[],
  supabaseAdmin: any
): any {
  let query = supabaseAdmin
    .from('surfers')
    .select('*')
    .neq('user_id', requestingUserId)
  if (excludedUserIds?.length > 0 && excludedUserIds.length <= 10) {
    for (const excludedId of excludedUserIds) {
      query = query.neq('user_id', excludedId)
    }
  }
  if (request.queryFilters) {
    query = applyQueryFilters(query, request.queryFilters)
  }
  return query
}

export function applyQueryFilters(query: any, queryFilters: any): any {
  if (!queryFilters || typeof queryFilters !== 'object') return query
  if (queryFilters.country_from && Array.isArray(queryFilters.country_from) && queryFilters.country_from.length > 0) {
    query = query.in('country_from', queryFilters.country_from)
  }
  if (typeof queryFilters.age_min === 'number') query = query.gte('age', queryFilters.age_min)
  if (typeof queryFilters.age_max === 'number') query = query.lte('age', queryFilters.age_max)
  if (queryFilters.surfboard_type) {
    const types = Array.isArray(queryFilters.surfboard_type) ? queryFilters.surfboard_type : [queryFilters.surfboard_type]
    if (types.length > 0) query = query.in('surfboard_type', types)
  }
  if (queryFilters.surf_level_category != null) {
    const arr = Array.isArray(queryFilters.surf_level_category) ? queryFilters.surf_level_category : [queryFilters.surf_level_category]
    if (arr.length === 1) query = query.eq('surf_level_category', arr[0])
    else if (arr.length > 1) query = query.in('surf_level_category', arr)
  } else if (queryFilters.surf_level_min != null || queryFilters.surf_level_max != null) {
    if (typeof queryFilters.surf_level_min === 'number') query = query.gte('surf_level', queryFilters.surf_level_min)
    if (typeof queryFilters.surf_level_max === 'number') query = query.lte('surf_level', queryFilters.surf_level_max)
  }
  return query
}

export function filterExcludedUsersInMemory(surfers: any[], excludedUserIds: string[]): any[] {
  if (!excludedUserIds?.length) return surfers
  return surfers.filter((s: any) => !excludedUserIds.includes(s.user_id))
}
