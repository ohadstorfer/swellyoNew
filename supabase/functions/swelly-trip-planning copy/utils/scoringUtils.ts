/**
 * Scoring Utilities
 * 
 * Contains scoring logic for the 4-layer matching algorithm
 */

import { NormalizedDestination, MatchingIntent, AreaOption } from './destinationUtils.ts';
import { SurferData } from '../types.ts';

// Helper function to convert travel_experience to comparable numeric level
function getTravelExperienceLevel(travelExp: number | string | undefined | null): number {
  if (travelExp === undefined || travelExp === null) {
    return 2; // Default to middle level
  }
  
  if (typeof travelExp === 'number') {
    if (travelExp <= 3) return 1; // new_nomad
    if (travelExp <= 9) return 2; // rising_voyager
    if (travelExp <= 19) return 3; // wave_hunter
    return 4; // chicken_joe (20+)
  }
  
  if (typeof travelExp === 'string') {
    const TRAVEL_EXPERIENCE_MAP: Record<string, number> = {
      'new_nomad': 1,
      'rising_voyager': 2,
      'wave_hunter': 3,
      'chicken_joe': 4,
    };
    return TRAVEL_EXPERIENCE_MAP[travelExp.toLowerCase()] || 2;
  }
  
  return 2;
}

const BUDGET_MAP: Record<string, 1 | 2 | 3> = {
  'budget': 1,
  'mid': 2,
  'high': 3,
};

/**
 * LAYER 1: Check explicit hard requirements
 * Returns true if user passes, false if filtered out
 */
export function checkLayer1HardRequirements(
  userSurfer: SurferData,
  request: any,
  normalizedDest: NormalizedDestination
): { passed: boolean; reason?: string } {
  const criteria = request.non_negotiable_criteria;
  
  if (!criteria) {
    return { passed: true };
  }

  // Check country_from filter
  if (criteria.country_from && criteria.country_from.length > 0) {
    if (!userSurfer.country_from || !criteria.country_from.includes(userSurfer.country_from)) {
      return { passed: false, reason: 'Country from filter not matched' };
    }
  }

  // Check surfboard_type filter
  if (criteria.surfboard_type && criteria.surfboard_type.length > 0) {
    if (!userSurfer.surfboard_type || !criteria.surfboard_type.includes(userSurfer.surfboard_type)) {
      return { passed: false, reason: 'Surfboard type filter not matched' };
    }
  }

  // Check age_range filter
  if (criteria.age_range) {
    const [minAge, maxAge] = criteria.age_range;
    if (!userSurfer.age || userSurfer.age < minAge || userSurfer.age > maxAge) {
      return { passed: false, reason: 'Age range filter not matched' };
    }
  }

  // Check surf_level filters - prefer category-based filtering
  if (criteria.surf_level_category) {
    if (!userSurfer.surf_level_category || userSurfer.surf_level_category !== criteria.surf_level_category) {
      return { passed: false, reason: 'Surf level category not matched' };
    }
    if (criteria.surfboard_type && criteria.surfboard_type.length > 0) {
      if (!userSurfer.surfboard_type || !criteria.surfboard_type.includes(userSurfer.surfboard_type)) {
        return { passed: false, reason: 'Surfboard type not matched for category filter' };
      }
    }
  }
  // Legacy: numeric surf_level filters
  else {
    if (criteria.surf_level_min !== undefined) {
      if (!userSurfer.surf_level || userSurfer.surf_level < criteria.surf_level_min) {
        return { passed: false, reason: 'Surf level minimum not met' };
      }
    }
    
    if (criteria.surf_level_max !== undefined) {
      if (!userSurfer.surf_level || userSurfer.surf_level > criteria.surf_level_max) {
        return { passed: false, reason: 'Surf level maximum exceeded' };
      }
    }
  }

  return { passed: true };
}

/**
 * LAYER 2: Check inferred required constraints
 */
export async function checkLayer2InferredConstraints(
  userSurfer: SurferData,
  request: any,
  intent: MatchingIntent,
  currentUserSurfer: SurferData
): Promise<{ passed: boolean; reason?: string }> {
  // For surf spots intent: skill level constraint
  if (intent === 'surf_spots' && request.purpose?.specific_topics?.some((t: string) => 
    t.toLowerCase().includes('advanced') || t.toLowerCase().includes('expert')
  )) {
    if (!userSurfer.surf_level || userSurfer.surf_level < 3) {
      return { passed: false, reason: 'Insufficient skill level for advanced surf spots' };
    }
  }

  return { passed: true };
}

/**
 * LAYER 3: Calculate priority score (1-50, exceptions 100)
 */
export function calculateLayer3PriorityScore(
  userSurfer: SurferData,
  request: any,
  intent: MatchingIntent,
  currentUserSurfer: SurferData
): number {
  const priorities = request.prioritize_filters;
  if (!priorities) {
    return 0;
  }

  let priorityScore = 0;

  // Origin country priority (1-50)
  if (priorities.origin_country && userSurfer.country_from === priorities.origin_country) {
    priorityScore += 30;
  }

  // Board type priority (1-50)
  if (priorities.board_type && userSurfer.surfboard_type === priorities.board_type) {
    if (intent === 'equipment' || request.purpose?.specific_topics?.some((t: string) => 
      t.toLowerCase().includes(priorities.board_type!.toLowerCase())
    )) {
      priorityScore += 100; // Exception: almost always surface
    } else {
      priorityScore += 40;
    }
  }

  // Surf level priority (1-50) - prefer category-based
  if (priorities.surf_level_category && userSurfer.surf_level_category === priorities.surf_level_category) {
    if (intent === 'surf_spots' && priorities.surf_level_category === 'advanced') {
      priorityScore += 100; // Exception: almost always surface
    } else {
      priorityScore += 35;
    }
  }
  // Legacy: numeric surf level priority
  else if (priorities.surf_level !== undefined && userSurfer.surf_level === priorities.surf_level) {
    if (intent === 'surf_spots' && priorities.surf_level >= 4) {
      priorityScore += 100; // Exception: almost always surface
    } else {
      priorityScore += 35;
    }
  }

  // Age range priority (1-50)
  if (priorities.age_range) {
    const [minAge, maxAge] = priorities.age_range;
    if (userSurfer.age && userSurfer.age >= minAge && userSurfer.age <= maxAge) {
      priorityScore += 25;
    }
  }

  // Travel experience priority (1-50)
  if (priorities.travel_experience && userSurfer.travel_experience !== undefined) {
    const priorityLevel = getTravelExperienceLevel(priorities.travel_experience);
    const userLevel = getTravelExperienceLevel(userSurfer.travel_experience);
    if (priorityLevel === userLevel) {
      priorityScore += 20;
    }
  }

  // Group type priority (1-50)
  if (priorities.group_type && userSurfer.travel_buddies === priorities.group_type) {
    priorityScore += 15;
  }

  return Math.min(priorityScore, 100); // Cap at 100
}

/**
 * LAYER 4: Calculate general scoring
 */
export function calculateLayer4GeneralScore(
  userSurfer: SurferData,
  request: any,
  intent: MatchingIntent,
  currentUserSurfer: SurferData,
  destinationMatch: {
    countryMatch: boolean;
    areaMatch: boolean;
    townMatch: boolean;
    matchedAreas: AreaOption[];
    matchedTowns: string[];
  },
  daysInDestination: number
): {
  score: number;
  matchedAreas: string[];
  matchedTowns: string[];
  commonLifestyleKeywords: string[];
  commonWaveKeywords: string[];
} {
  let score = 0;
  const matchedAreas: string[] = [];
  const matchedTowns: string[] = [];
  const commonLifestyleKeywords: string[] = [];
  const commonWaveKeywords: string[] = [];

  // Base score: Days in destination (1 point per day, max 50)
  score += Math.min(daysInDestination, 50);

  // Area match bonus (intent-based)
  if (destinationMatch.areaMatch) {
    if (intent === 'surf_spots' || intent === 'stays' || intent === 'hikes') {
      score += 40; // Area is critical for these intents
    } else {
      score += 25; // Area is helpful but not critical
    }
    matchedAreas.push(...destinationMatch.matchedAreas.map(a => a));
  }

  // Town match bonus (only for intents where town matters)
  if (destinationMatch.townMatch && (intent === 'surf_spots' || intent === 'stays' || intent === 'providers')) {
    score += 30; // Town is critical for these intents
    matchedTowns.push(...destinationMatch.matchedTowns);
  } else if (destinationMatch.townMatch) {
    score += 10; // Town is nice to have
    matchedTowns.push(...destinationMatch.matchedTowns);
  }

  // Budget similarity (0-30 points)
  if (request.budget && userSurfer.travel_type) {
    const userBudget = BUDGET_MAP[userSurfer.travel_type] || 2;
    const diff = Math.abs(request.budget - userBudget);
    score += Math.max(0, 30 - (diff * 15));
  }

  // Surf level similarity (0-30 points)
  if (userSurfer.surf_level && currentUserSurfer.surf_level) {
    const diff = Math.abs(currentUserSurfer.surf_level - userSurfer.surf_level);
    score += Math.max(0, 30 - (diff * 10));
  }

  // Travel experience similarity (0-30 points)
  if (userSurfer.travel_experience !== undefined && currentUserSurfer.travel_experience !== undefined) {
    const userExp = getTravelExperienceLevel(userSurfer.travel_experience);
    const currentExp = getTravelExperienceLevel(currentUserSurfer.travel_experience);
    const diff = Math.abs(currentExp - userExp);
    score += Math.max(0, 30 - (diff * 10));
  }

  // Same surfboard type (+20 points, but not required for equipment intent)
  if (userSurfer.surfboard_type && currentUserSurfer.surfboard_type) {
    if (userSurfer.surfboard_type === currentUserSurfer.surfboard_type) {
      if (intent !== 'equipment') {
        score += 20;
      }
    }
  }

  // Same group type (+15 points)
  if (userSurfer.travel_buddies && currentUserSurfer.travel_buddies) {
    if (userSurfer.travel_buddies === currentUserSurfer.travel_buddies) {
      score += 15;
    }
  }

  return {
    score,
    matchedAreas,
    matchedTowns,
    commonLifestyleKeywords,
    commonWaveKeywords,
  };
}




