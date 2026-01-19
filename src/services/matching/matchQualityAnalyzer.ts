/**
 * Match Quality Analyzer
 * 
 * Analyzes match quality between user requests and surfer profiles.
 * Handles null/missing data gracefully and counts only actual matches.
 */

import { TripPlanningRequest, MatchQuality } from '../../types/tripPlanning';
import { SupabaseSurfer } from '../database/supabaseDatabaseService';

/**
 * Null-safe age comparison
 */
function compareAge(
  requested: [number, number] | number | null | undefined,
  surferAge: number | null | undefined
): boolean | null {
  if (!requested || surferAge === null || surferAge === undefined) return null;
  const [min, max] = Array.isArray(requested) ? requested : [requested, requested];
  return surferAge >= min && surferAge <= max;
}

/**
 * Null-safe country_from comparison
 */
function compareCountryFrom(
  requested: string[] | null | undefined,
  surferCountry: string | null | undefined
): boolean | null {
  if (!requested || !surferCountry) return null;
  return requested.some(c => c.toLowerCase() === surferCountry.toLowerCase());
}

/**
 * Null-safe surfboard_type comparison
 */
function compareSurfboardType(
  requested: string[] | null | undefined,
  surferBoard: string | null | undefined
): boolean | null {
  if (!requested || !surferBoard) return null;
  const requestedArray = Array.isArray(requested) ? requested : [requested];
  return requestedArray.includes(surferBoard);
}

/**
 * Null-safe surf_level comparison
 */
function compareSurfLevel(
  requested: number | [number, number] | null | undefined,
  surferLevel: number | null | undefined
): boolean | null {
  if (!requested || surferLevel === null || surferLevel === undefined) return null;
  const [min, max] = Array.isArray(requested) ? requested : [requested, requested];
  return surferLevel >= min && surferLevel <= max;
}


/**
 * Calculate data completeness score for a surfer
 */
export function calculateDataCompleteness(surfer: SupabaseSurfer): number {
  let completeness = 0;
  const totalFields = 5; // age, country_from, surfboard_type, surf_level, travel_experience
  
  if (surfer.age !== null && surfer.age !== undefined) completeness++;
  if (surfer.country_from) completeness++;
  if (surfer.surfboard_type) completeness++;
  if (surfer.surf_level !== null && surfer.surf_level !== undefined) completeness++;
  if (surfer.travel_experience !== null && surfer.travel_experience !== undefined) completeness++;
  
  return completeness / totalFields; // 0.0 to 1.0
}

/**
 * Count how many criteria actually matched (excluding nulls)
 */
export function countMatchedCriteria(matchedCriteria: MatchQuality['matchedCriteria']): number {
  let count = 0;
  
  // Always count destination_country if it's true
  if (matchedCriteria.destination_country) count++;
  
  // Count other criteria only if they're explicitly true (not null or false)
  if (matchedCriteria.area === true) count++;
  if (matchedCriteria.country_from === true) count++;
  if (matchedCriteria.age === true) count++;
  if (matchedCriteria.surfboard_type === true) count++;
  if (matchedCriteria.surf_level === true) count++;
  if (matchedCriteria.travel_experience === true) count++;
  
  return count;
}

/**
 * Check if match quality meets minimum match requirement
 */
export function hasMinimumMatches(matchQuality: MatchQuality, minMatches: number = 2): boolean {
  return matchQuality.matchCount > minMatches;
}

/**
 * Analyze match quality between request and surfer
 */
export function analyzeMatchQuality(
  request: TripPlanningRequest,
  surfer: SupabaseSurfer,
  destinationMatch: {
    countryMatch: boolean;
    areaMatch: boolean;
    townMatch: boolean;
    matchedAreas: string[];
    matchedTowns: string[];
  }
): MatchQuality {
  const matchedCriteria: MatchQuality['matchedCriteria'] = {
    destination_country: request.destination_country ? destinationMatch.countryMatch : null, // null if no destination requested
  };
  
  const differences: MatchQuality['differences'] = {};
  const missingData: MatchQuality['missingData'] = {};
  
  // Check area match (only if destination_country is provided)
  if (request.area && request.destination_country) {
    matchedCriteria.area = destinationMatch.areaMatch;
    if (!destinationMatch.areaMatch) {
      // Find what area they actually have
      const foundArea = surfer.destinations_array?.find(dest => 
        dest.country.toLowerCase() === request.destination_country!.toLowerCase()
      )?.area?.[0] || null;
      differences.area = { requested: request.area, found: foundArea };
    }
  }
  
  // Check country_from
  const requestedCountries = request.non_negotiable_criteria?.country_from || 
                             request.queryFilters?.country_from || null;
  if (requestedCountries) {
    const countryMatch = compareCountryFrom(requestedCountries, surfer.country_from);
    matchedCriteria.country_from = countryMatch;
    if (countryMatch === false) {
      differences.country_from = { requested: requestedCountries, found: surfer.country_from || null };
    }
    if (!surfer.country_from) {
      missingData.country_from = true;
    }
  }
  
  // Check age
  const requestedAge = request.non_negotiable_criteria?.age_range || 
                       (request.queryFilters?.age_min && request.queryFilters?.age_max 
                         ? [request.queryFilters.age_min, request.queryFilters.age_max] 
                         : null);
  if (requestedAge) {
    const ageMatch = compareAge(requestedAge, surfer.age);
    matchedCriteria.age = ageMatch;
    if (ageMatch === false) {
      differences.age = { requested: requestedAge, found: surfer.age || null };
    }
    if (surfer.age === null || surfer.age === undefined) {
      missingData.age = true;
    }
  }
  
  // Check surfboard_type
  const requestedBoardType = request.non_negotiable_criteria?.surfboard_type || 
                             request.queryFilters?.surfboard_type || null;
  if (requestedBoardType) {
    const boardMatch = compareSurfboardType(requestedBoardType, surfer.surfboard_type || undefined);
    matchedCriteria.surfboard_type = boardMatch;
    if (boardMatch === false) {
      differences.surfboard_type = { 
        requested: Array.isArray(requestedBoardType) ? requestedBoardType : [requestedBoardType], 
        found: surfer.surfboard_type || null 
      };
    }
    if (!surfer.surfboard_type) {
      missingData.surfboard_type = true;
    }
  }
  
  // Check surf_level
  const requestedSurfLevel = request.non_negotiable_criteria?.surf_level_min && request.non_negotiable_criteria?.surf_level_max
    ? [request.non_negotiable_criteria.surf_level_min, request.non_negotiable_criteria.surf_level_max]
    : request.non_negotiable_criteria?.surf_level_min || 
      request.queryFilters?.surf_level_min || null;
  if (requestedSurfLevel) {
    const levelMatch = compareSurfLevel(requestedSurfLevel, surfer.surf_level);
    matchedCriteria.surf_level = levelMatch;
    if (levelMatch === false) {
      differences.surf_level = { requested: requestedSurfLevel, found: surfer.surf_level || null };
    }
    if (surfer.surf_level === null || surfer.surf_level === undefined) {
      missingData.surf_level = true;
    }
  }
  
  // Check travel_experience (if requested in prioritize_filters)
  // Note: This is less common but we'll check it
  if (request.prioritize_filters?.travel_experience) {
    // This is a preference, not a requirement, so we'll mark it as null for now
    // Could be enhanced later
    matchedCriteria.travel_experience = null;
  }
  
  
  // Count matches
  const matchCount = countMatchedCriteria(matchedCriteria);
  
  // Check if exact match (all requested criteria matched, no differences)
  const hasDifferences = Object.keys(differences).length > 0;
  // Exact match means: 
  // - If destination requested: destination must match
  // - All requested criteria matched
  // - No differences
  // - If area requested: area must match
  const exactMatch = (!request.destination_country || destinationMatch.countryMatch) && 
                     matchCount > 0 && 
                     !hasDifferences &&
                     // Also check that area matches if area was requested
                     (request.area ? destinationMatch.areaMatch : true);
  
  return {
    exactMatch,
    matchCount,
    matchedCriteria,
    differences,
    missingData,
  };
}

