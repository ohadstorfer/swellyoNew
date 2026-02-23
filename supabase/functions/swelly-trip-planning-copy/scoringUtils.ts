/**
 * Scoring Utilities (root copy for bundler)
 */
import { NormalizedDestination, MatchingIntent, AreaOption } from './destinationUtils.ts';
import { SurferData } from './types.ts';

function getTravelExperienceLevel(travelExp: number | string | undefined | null): number {
  if (travelExp === undefined || travelExp === null) return 2;
  if (typeof travelExp === 'number') {
    if (travelExp <= 3) return 1;
    if (travelExp <= 9) return 2;
    if (travelExp <= 19) return 3;
    return 4;
  }
  if (typeof travelExp === 'string') {
    const M: Record<string, number> = { 'new_nomad': 1, 'rising_voyager': 2, 'wave_hunter': 3, 'chicken_joe': 4 };
    return M[travelExp.toLowerCase()] || 2;
  }
  return 2;
}

const BUDGET_MAP: Record<string, 1 | 2 | 3> = { 'budget': 1, 'mid': 2, 'high': 3 };

export function checkLayer1HardRequirements(
  userSurfer: SurferData,
  request: any,
  normalizedDest: NormalizedDestination
): { passed: boolean; reason?: string } {
  const criteria = request.non_negotiable_criteria;
  if (!criteria) return { passed: true };
  if (criteria.country_from?.length && (!userSurfer.country_from || !criteria.country_from.includes(userSurfer.country_from)))
    return { passed: false, reason: 'Country from filter not matched' };
  if (criteria.surfboard_type?.length && (!userSurfer.surfboard_type || !criteria.surfboard_type.includes(userSurfer.surfboard_type)))
    return { passed: false, reason: 'Surfboard type filter not matched' };
  if (criteria.age_range) {
    const [minAge, maxAge] = criteria.age_range;
    if (!userSurfer.age || userSurfer.age < minAge || userSurfer.age > maxAge)
      return { passed: false, reason: 'Age range filter not matched' };
  }
  if (criteria.surf_level_category) {
    if (!userSurfer.surf_level_category || userSurfer.surf_level_category !== criteria.surf_level_category)
      return { passed: false, reason: 'Surf level category not matched' };
    if (criteria.surfboard_type?.length && (!userSurfer.surfboard_type || !criteria.surfboard_type.includes(userSurfer.surfboard_type)))
      return { passed: false, reason: 'Surfboard type not matched for category filter' };
  } else {
    if (criteria.surf_level_min !== undefined && (!userSurfer.surf_level || userSurfer.surf_level < criteria.surf_level_min))
      return { passed: false, reason: 'Surf level minimum not met' };
    if (criteria.surf_level_max !== undefined && (!userSurfer.surf_level || userSurfer.surf_level > criteria.surf_level_max))
      return { passed: false, reason: 'Surf level maximum exceeded' };
  }
  return { passed: true };
}

export async function checkLayer2InferredConstraints(
  userSurfer: SurferData,
  request: any,
  intent: MatchingIntent,
  currentUserSurfer: SurferData
): Promise<{ passed: boolean; reason?: string }> {
  if (intent === 'surf_spots' && request.purpose?.specific_topics?.some((t: string) =>
    t.toLowerCase().includes('advanced') || t.toLowerCase().includes('expert'))) {
    if (!userSurfer.surf_level || userSurfer.surf_level < 3)
      return { passed: false, reason: 'Insufficient skill level for advanced surf spots' };
  }
  return { passed: true };
}

export function calculateLayer3PriorityScore(
  userSurfer: SurferData,
  request: any,
  intent: MatchingIntent,
  currentUserSurfer: SurferData
): number {
  const priorities = request.prioritize_filters;
  if (!priorities) return 0;
  let priorityScore = 0;
  if (priorities.origin_country && userSurfer.country_from === priorities.origin_country) priorityScore += 30;
  if (priorities.board_type && userSurfer.surfboard_type === priorities.board_type) {
    if (intent === 'equipment' || request.purpose?.specific_topics?.some((t: string) =>
      t.toLowerCase().includes(priorities.board_type!.toLowerCase()))) priorityScore += 100;
    else priorityScore += 40;
  }
  if (priorities.surf_level_category && userSurfer.surf_level_category === priorities.surf_level_category) {
    if (intent === 'surf_spots' && priorities.surf_level_category === 'advanced') priorityScore += 100;
    else priorityScore += 35;
  } else if (priorities.surf_level !== undefined && userSurfer.surf_level === priorities.surf_level) {
    if (intent === 'surf_spots' && priorities.surf_level >= 4) priorityScore += 100;
    else priorityScore += 35;
  }
  if (priorities.age_range) {
    const [minAge, maxAge] = priorities.age_range;
    if (userSurfer.age && userSurfer.age >= minAge && userSurfer.age <= maxAge) priorityScore += 25;
  }
  if (priorities.travel_experience && userSurfer.travel_experience !== undefined) {
    if (getTravelExperienceLevel(priorities.travel_experience) === getTravelExperienceLevel(userSurfer.travel_experience))
      priorityScore += 20;
  }
  if (priorities.group_type && userSurfer.travel_buddies === priorities.group_type) priorityScore += 15;
  return Math.min(priorityScore, 100);
}

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
  let score = Math.min(daysInDestination, 50);
  const matchedAreas: string[] = [];
  const matchedTowns: string[] = [];
  const commonLifestyleKeywords: string[] = [];
  const commonWaveKeywords: string[] = [];
  if (destinationMatch.areaMatch) {
    score += (intent === 'surf_spots' || intent === 'stays' || intent === 'hikes') ? 40 : 25;
    matchedAreas.push(...destinationMatch.matchedAreas.map(a => a));
  }
  if (destinationMatch.townMatch) {
    if (intent === 'surf_spots' || intent === 'stays' || intent === 'providers') score += 30;
    else score += 10;
    matchedTowns.push(...destinationMatch.matchedTowns);
  }
  if (request.budget && userSurfer.travel_type) {
    const userBudget = BUDGET_MAP[userSurfer.travel_type] || 2;
    score += Math.max(0, 30 - Math.abs(request.budget - userBudget) * 15);
  }
  if (userSurfer.surf_level && currentUserSurfer.surf_level)
    score += Math.max(0, 30 - Math.abs(currentUserSurfer.surf_level - userSurfer.surf_level) * 10);
  if (userSurfer.travel_experience !== undefined && currentUserSurfer.travel_experience !== undefined)
    score += Math.max(0, 30 - Math.abs(getTravelExperienceLevel(currentUserSurfer.travel_experience) - getTravelExperienceLevel(userSurfer.travel_experience)) * 10);
  if (userSurfer.surfboard_type && currentUserSurfer.surfboard_type &&
      userSurfer.surfboard_type === currentUserSurfer.surfboard_type && intent !== 'equipment') score += 20;
  if (userSurfer.travel_buddies && currentUserSurfer.travel_buddies &&
      userSurfer.travel_buddies === currentUserSurfer.travel_buddies) score += 15;
  return { score, matchedAreas, matchedTowns, commonLifestyleKeywords, commonWaveKeywords };
}
