/**
 * Matching Service V3
 * 
 * Implements a sophisticated 4-layer matching algorithm with:
 * 1. Explicit hard requirements (Layer 1)
 * 2. Inferred required constraints (Layer 2)
 * 3. Priorities with weighted boosts (Layer 3)
 * 4. General scoring (Layer 4)
 * 
 * Features:
 * - Destination hierarchy: Country > Area > Town
 * - Area normalization to fixed options
 * - Intent-driven matching rules
 * - Priority scoring (1-50, exceptions 100)
 */

import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { supabaseDatabaseService, SupabaseSurfer } from '../database/supabaseDatabaseService';
import { TripPlanningRequest, MatchedUser, BUDGET_MAP, TRAVEL_EXPERIENCE_MAP, GROUP_TYPE_MAP } from '../../types/tripPlanning';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

// Helper function to convert travel_experience (integer or legacy enum string) to comparable numeric level
// Returns: 1 (new_nomad/0-3), 2 (rising_voyager/4-9), 3 (wave_hunter/10-19), 4 (chicken_joe/20+)
function getTravelExperienceLevel(travelExp: number | string | undefined | null): number {
  if (travelExp === undefined || travelExp === null) {
    return 2; // Default to middle level
  }
  
  // If it's already a number (new format: number of trips)
  if (typeof travelExp === 'number') {
    if (travelExp <= 3) return 1; // new_nomad
    if (travelExp <= 9) return 2; // rising_voyager
    if (travelExp <= 19) return 3; // wave_hunter
    return 4; // chicken_joe (20+)
  }
  
  // Legacy format: enum string
  if (typeof travelExp === 'string') {
    return TRAVEL_EXPERIENCE_MAP[travelExp.toLowerCase()] || 2;
  }
  
  return 2; // Default fallback
}

/**
 * Fixed area options for normalization
 */
export const AREA_OPTIONS = [
  'north',
  'south',
  'east',
  'west',
  'south-west',
  'south-east',
  'north-west',
  'north-east',
] as const;

export type AreaOption = typeof AREA_OPTIONS[number];

/**
 * Intent types for matching
 */
export type MatchingIntent = 
  | 'surf_spots'
  | 'hikes'
  | 'stays'
  | 'providers'
  | 'equipment'
  | 'towns_within_area'
  | 'general';

/**
 * Destination structure with hierarchy
 */
export interface NormalizedDestination {
  country: string; // Always required
  area?: AreaOption | AreaOption[]; // Normalized to fixed options
  towns?: string[]; // Optional, intent-based
}

/**
 * Matching result for a user
 */
export interface UserMatchingResult {
  user_id: string;
  surfer: SupabaseSurfer;
  passedLayer1: boolean; // Explicit hard requirements
  passedLayer2: boolean; // Inferred required constraints
  priorityScore: number; // Layer 3: 1-50, exceptions 100
  generalScore: number; // Layer 4: General scoring
  totalScore: number; // Combined score
  matchedAreas: string[];
  matchedTowns: string[];
  commonLifestyleKeywords: string[];
  commonWaveKeywords: string[];
  daysInDestination: number;
  rejectionReason?: string; // Why user was filtered out
}

/**
 * Normalize area string to fixed area options using LLM
 */
async function normalizeArea(
  country: string,
  areaInput: string | null | undefined,
  intent: MatchingIntent
): Promise<AreaOption[]> {
  if (!areaInput) {
    return [];
  }

  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, using fallback area normalization');
    return [];
  }

  try {
    const prompt = `Given the country "${country}" and area/region/town "${areaInput}", normalize it to one or more of these fixed area options: ${AREA_OPTIONS.join(', ')}.

Rules:
- Return ONLY a JSON array of strings from the fixed options
- If the area spans multiple directions, return multiple (e.g., ["south-west", "south-east"])
- If unclear, return the closest match
- If the input is a town name, infer the area based on the country's geography
- Return empty array [] if no area can be determined

Example inputs and outputs:
- "South" → ["south"]
- "Weligama" (Sri Lanka) → ["south-west"]
- "Arugam Bay" (Sri Lanka) → ["east"]
- "South West" → ["south-west"]
- "Southern region" → ["south"]
- "Kabalana" (Sri Lanka) → ["south-west"]

Return ONLY the JSON array, no other text.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that returns only valid JSON arrays. Do not include any explanatory text.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent normalization
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    // Parse JSON response - could be array or object
    let areas: string[] = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        areas = parsed;
      } else if (parsed.areas && Array.isArray(parsed.areas)) {
        areas = parsed.areas;
      } else {
        // Try to extract from any array property
        const arrayValues = Object.values(parsed).find(v => Array.isArray(v));
        if (arrayValues) {
          areas = arrayValues as string[];
        }
      }
    } catch (parseError) {
      // If parsing fails, try to extract array from content directly
      const arrayMatch = content.match(/\[.*?\]/);
      if (arrayMatch) {
        areas = JSON.parse(arrayMatch[0]);
      }
    }
    
    if (Array.isArray(areas)) {
      // Validate that all areas are in the fixed options
      const validAreas = areas.filter((area: string) => 
        AREA_OPTIONS.includes(area.toLowerCase() as AreaOption)
      ).map((area: string) => area.toLowerCase() as AreaOption);
      
      return validAreas.length > 0 ? validAreas : [];
    }

    return [];
  } catch (error) {
    console.error('Error normalizing area:', error);
    return [];
  }
}

/**
 * Extract towns from area input using LLM (intent-based)
 */
async function extractTowns(
  country: string,
  areaInput: string | null | undefined,
  intent: MatchingIntent,
  normalizedAreas: AreaOption[]
): Promise<string[]> {
  // Only extract towns for certain intents
  if (intent !== 'surf_spots' && intent !== 'stays' && intent !== 'providers') {
    return [];
  }

  if (!areaInput || !OPENAI_API_KEY) {
    return [];
  }

  try {
    const prompt = `Given the country "${country}", area "${areaInput}", and normalized areas ${JSON.stringify(normalizedAreas)}, extract specific town names if mentioned or relevant.

Rules:
- Only return towns that are explicitly mentioned or are well-known surf/travel towns in the area
- Return ONLY a JSON array of town names (strings)
- If no specific towns are mentioned or relevant, return empty array []
- For surf spots intent, include nearby towns that are relevant for surf spots
- For stays intent, include towns where accommodations are typically located

Example:
- Input: "Kabalana area" (Sri Lanka, south-west) → ["Kabalana", "Ahangama", "Midigama"]
- Input: "South" (Sri Lanka) → [] (too general, no specific towns)
- Input: "Weligama" (Sri Lanka) → ["Weligama"] (explicitly mentioned)

Return ONLY the JSON array, no other text.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that returns only valid JSON arrays. Do not include any explanatory text.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    if (!content) {
      return [];
    }

    // Parse JSON response - could be array or object
    let towns: string[] = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        towns = parsed;
      } else if (parsed.towns && Array.isArray(parsed.towns)) {
        towns = parsed.towns;
      } else {
        // Try to extract from any array property
        const arrayValues = Object.values(parsed).find(v => Array.isArray(v));
        if (arrayValues) {
          towns = arrayValues as string[];
        }
      }
    } catch (parseError) {
      // If parsing fails, try to extract array from content directly
      const arrayMatch = content.match(/\[.*?\]/);
      if (arrayMatch) {
        towns = JSON.parse(arrayMatch[0]);
      }
    }
    
    if (Array.isArray(towns)) {
      return towns.filter((town: any) => typeof town === 'string' && town.trim().length > 0);
    }

    return [];
  } catch (error) {
    console.error('Error extracting towns:', error);
    return [];
  }
}

/**
 * Determine matching intent from request
 */
function determineIntent(request: TripPlanningRequest): MatchingIntent {
  const purpose = request.purpose;
  const topics = purpose.specific_topics || [];

  // Check for specific intent keywords
  const topicsLower = topics.map(t => t.toLowerCase());
  
  if (topicsLower.some(t => t.includes('surf spot') || t.includes('wave') || t.includes('break'))) {
    return 'surf_spots';
  }
  
  if (topicsLower.some(t => t.includes('hike') || t.includes('trail') || t.includes('walk'))) {
    return 'hikes';
  }
  
  if (topicsLower.some(t => t.includes('stay') || t.includes('accommodation') || t.includes('hotel') || t.includes('hostel'))) {
    return 'stays';
  }
  
  if (topicsLower.some(t => t.includes('provider') || t.includes('shop') || t.includes('rental'))) {
    return 'providers';
  }
  
  if (topicsLower.some(t => t.includes('equipment') || t.includes('board') || t.includes('gear'))) {
    return 'equipment';
  }

  // Default to general
  return 'general';
}

/**
 * Normalize destination from request
 */
async function normalizeDestination(
  request: TripPlanningRequest,
  intent: MatchingIntent
): Promise<NormalizedDestination> {
  const country = request.destination_country;
  const areaInput = request.area;

  // Normalize area to fixed options
  const normalizedAreas = await normalizeArea(country, areaInput, intent);
  
  // Extract towns (intent-based)
  const towns = await extractTowns(country, areaInput, intent, normalizedAreas);

  return {
    country,
    area: normalizedAreas.length === 1 ? normalizedAreas[0] : normalizedAreas,
    towns: towns.length > 0 ? towns : undefined,
  };
}

/**
 * Extract destination hierarchy from user's destinations_array
 * Parses format like "Sri Lanka, South-West, Weligama" or "Sri Lanka, South"
 */
function parseUserDestination(destinationName: string): {
  country: string;
  area?: AreaOption[];
  towns?: string[];
} {
  const parts = destinationName.split(',').map(p => p.trim());
  const country = parts[0] || '';
  
  if (parts.length === 1) {
    return { country };
  }

  // Try to identify area and town from remaining parts
  const areaParts: AreaOption[] = [];
  const townParts: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    
    // Check if it matches a fixed area option
    const matchedArea = AREA_OPTIONS.find(area => 
      part === area || 
      part.includes(area) || 
      area.includes(part)
    );
    
    if (matchedArea) {
      areaParts.push(matchedArea);
    } else {
      // If it doesn't match an area, it's likely a town
      townParts.push(parts[i]);
    }
  }

  return {
    country,
    area: areaParts.length > 0 ? areaParts : undefined,
    towns: townParts.length > 0 ? townParts : undefined,
  };
}

/**
 * Check if user destination matches normalized destination
 */
function destinationMatches(
  userDestination: string,
  normalizedDest: NormalizedDestination
): {
  countryMatch: boolean;
  areaMatch: boolean;
  townMatch: boolean;
  matchedAreas: AreaOption[];
  matchedTowns: string[];
} {
  const userDest = parseUserDestination(userDestination);
  
  // Country must always match
  const countryMatch = userDest.country.toLowerCase() === normalizedDest.country.toLowerCase();
  
  if (!countryMatch) {
    return {
      countryMatch: false,
      areaMatch: false,
      townMatch: false,
      matchedAreas: [],
      matchedTowns: [],
    };
  }

  // Check area match
  let areaMatch = false;
  const matchedAreas: AreaOption[] = [];
  
  if (normalizedDest.area && userDest.area) {
    const requestedAreas = Array.isArray(normalizedDest.area) 
      ? normalizedDest.area 
      : [normalizedDest.area];
    
    for (const reqArea of requestedAreas) {
      if (userDest.area.includes(reqArea)) {
        areaMatch = true;
        matchedAreas.push(reqArea);
      }
    }
  } else if (!normalizedDest.area) {
    // If no area specified in request, any area matches
    areaMatch = true;
  }

  // Check town match (intent-based)
  let townMatch = false;
  const matchedTowns: string[] = [];
  
  if (normalizedDest.towns && userDest.towns) {
    for (const reqTown of normalizedDest.towns) {
      const reqTownLower = reqTown.toLowerCase();
      for (const userTown of userDest.towns) {
        if (userTown.toLowerCase().includes(reqTownLower) || reqTownLower.includes(userTown.toLowerCase())) {
          townMatch = true;
          matchedTowns.push(userTown);
        }
      }
    }
  } else if (!normalizedDest.towns) {
    // If no towns specified in request, any town matches
    townMatch = true;
  }

  return {
    countryMatch,
    areaMatch,
    townMatch,
    matchedAreas,
    matchedTowns,
  };
}

/**
 * LAYER 1: Check explicit hard requirements
 * Returns true if user passes, false if filtered out
 */
function checkLayer1HardRequirements(
  userSurfer: SupabaseSurfer,
  request: TripPlanningRequest,
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

  // Check surf_level filters
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

  // Check must_have_keywords
  if (criteria.must_have_keywords && criteria.must_have_keywords.length > 0) {
    const userKeywords = [
      ...(userSurfer.lifestyle_keywords || []),
      ...(userSurfer.wave_type_keywords || []),
    ];
    
    const hasAllKeywords = criteria.must_have_keywords.every(keyword =>
      userKeywords.some(uk => uk.toLowerCase().includes(keyword.toLowerCase()))
    );
    
    if (!hasAllKeywords) {
      return { passed: false, reason: 'Must-have keywords not matched' };
    }
  }

  return { passed: true };
}

/**
 * LAYER 2: Check inferred required constraints
 * Uses LLM to infer constraints (e.g., beginner shouldn't answer advanced questions)
 */
async function checkLayer2InferredConstraints(
  userSurfer: SupabaseSurfer,
  request: TripPlanningRequest,
  intent: MatchingIntent,
  currentUserSurfer: SupabaseSurfer
): Promise<{ passed: boolean; reason?: string }> {
  // For surf spots intent: skill level constraint
  if (intent === 'surf_spots' && request.purpose.specific_topics?.some(t => 
    t.toLowerCase().includes('advanced') || t.toLowerCase().includes('expert')
  )) {
    // If asking for advanced spots, user should be at least level 3
    if (!userSurfer.surf_level || userSurfer.surf_level < 3) {
      return { passed: false, reason: 'Insufficient skill level for advanced surf spots' };
    }
  }

  // If asking for beginner spots, advanced users might not be ideal
  if (intent === 'surf_spots' && request.purpose.specific_topics?.some(t => 
    t.toLowerCase().includes('beginner') || t.toLowerCase().includes('easy')
  )) {
    // Advanced users (level 5) might not remember beginner spots well
    // But we don't filter them out, just note it
  }

  // For equipment intent: surf style should not be inferred as required
  // (shortboarders can recommend longboard shops)
  // This is handled in Layer 3 priorities, not as a hard filter

  return { passed: true };
}

/**
 * LAYER 3: Calculate priority score (1-50, exceptions 100)
 */
function calculateLayer3PriorityScore(
  userSurfer: SupabaseSurfer,
  request: TripPlanningRequest,
  intent: MatchingIntent,
  currentUserSurfer: SupabaseSurfer
): number {
  const priorities = request.prioritize_filters;
  if (!priorities) {
    return 0;
  }

  let priorityScore = 0;

  // Origin country priority (1-50)
  if (priorities.origin_country && userSurfer.country_from === priorities.origin_country) {
    priorityScore += 30; // Major advantage
  }

  // Board type priority (1-50)
  if (priorities.board_type && userSurfer.surfboard_type === priorities.board_type) {
    // Exception: if user explicitly asks for specific board type advice, boost heavily
    if (intent === 'equipment' || request.purpose.specific_topics?.some(t => 
      t.toLowerCase().includes(priorities.board_type!.toLowerCase())
    )) {
      priorityScore += 100; // Exception: almost always surface
    } else {
      priorityScore += 40; // Major advantage
    }
  }

  // Surf level priority (1-50)
  if (priorities.surf_level !== undefined && userSurfer.surf_level === priorities.surf_level) {
    // Exception: if asking for advanced surf spots and user is advanced
    if (intent === 'surf_spots' && priorities.surf_level >= 4) {
      priorityScore += 100; // Exception: almost always surface
    } else {
      priorityScore += 35; // Major advantage
    }
  }

  // Age range priority (1-50)
  if (priorities.age_range) {
    const [minAge, maxAge] = priorities.age_range;
    if (userSurfer.age && userSurfer.age >= minAge && userSurfer.age <= maxAge) {
      priorityScore += 25; // Very helpful
    }
  }

  // Lifestyle keywords priority (1-50)
  if (priorities.lifestyle_keywords && priorities.lifestyle_keywords.length > 0) {
    const userKeywords = userSurfer.lifestyle_keywords || [];
    const matches = priorities.lifestyle_keywords.filter(keyword =>
      userKeywords.some(uk => uk.toLowerCase().includes(keyword.toLowerCase()))
    );
    priorityScore += Math.min(50, matches.length * 15); // Up to 50 points
  }

  // Wave keywords priority (1-50)
  if (priorities.wave_type_keywords && priorities.wave_type_keywords.length > 0) {
    const userKeywords = userSurfer.wave_type_keywords || [];
    const matches = priorities.wave_type_keywords.filter(keyword =>
      userKeywords.some(uk => uk.toLowerCase().includes(keyword.toLowerCase()))
    );
    priorityScore += Math.min(50, matches.length * 15); // Up to 50 points
  }

  // Travel experience priority (1-50)
  // Handle both integer (new format) and enum string (legacy format)
  if (priorities.travel_experience && userSurfer.travel_experience !== undefined) {
    const priorityLevel = getTravelExperienceLevel(priorities.travel_experience);
    const userLevel = getTravelExperienceLevel(userSurfer.travel_experience);
    if (priorityLevel === userLevel) {
      priorityScore += 20; // Very helpful
    }
  }

  // Group type priority (1-50)
  if (priorities.group_type && userSurfer.travel_buddies === priorities.group_type) {
    priorityScore += 15; // Nice to have
  }

  return Math.min(priorityScore, 100); // Cap at 100 (exception level)
}

/**
 * LAYER 4: Calculate general scoring
 */
function calculateLayer4GeneralScore(
  userSurfer: SupabaseSurfer,
  request: TripPlanningRequest,
  intent: MatchingIntent,
  currentUserSurfer: SupabaseSurfer,
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
    matchedAreas.push(...destinationMatch.matchedAreas);
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
        score += 20; // Boost for same board type (except equipment intent)
      }
    }
  }

  // Same group type (+15 points)
  if (userSurfer.travel_buddies && currentUserSurfer.travel_buddies) {
    if (userSurfer.travel_buddies === currentUserSurfer.travel_buddies) {
      score += 15;
    }
  }

  // Lifestyle keywords match (+5 points per match, max 25)
  if (userSurfer.lifestyle_keywords && currentUserSurfer.lifestyle_keywords) {
    const matches = userSurfer.lifestyle_keywords.filter(uk =>
      currentUserSurfer.lifestyle_keywords!.some(ck =>
        uk.toLowerCase().includes(ck.toLowerCase()) || ck.toLowerCase().includes(uk.toLowerCase())
      )
    );
    score += Math.min(25, matches.length * 5);
    commonLifestyleKeywords.push(...matches);
  }

  // Wave keywords match (+5 points per match, max 25)
  if (userSurfer.wave_type_keywords && currentUserSurfer.wave_type_keywords) {
    const matches = userSurfer.wave_type_keywords.filter(uk =>
      currentUserSurfer.wave_type_keywords!.some(ck =>
        uk.toLowerCase().includes(ck.toLowerCase()) || ck.toLowerCase().includes(uk.toLowerCase())
      )
    );
    score += Math.min(25, matches.length * 5);
    commonWaveKeywords.push(...matches);
  }

  return {
    score,
    matchedAreas,
    matchedTowns,
    commonLifestyleKeywords,
    commonWaveKeywords,
  };
}

/**
 * Main V3 matching function
 */
export async function findMatchingUsersV3(
  request: TripPlanningRequest,
  requestingUserId: string
): Promise<MatchedUser[]> {
  console.log('=== FINDING MATCHING USERS V3 ===');
  console.log('Request:', JSON.stringify(request, null, 2));
  console.log('Requesting User ID:', requestingUserId);

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }

  if (!request.destination_country) {
    throw new Error('V3 algorithm requires destination_country');
  }

  try {
    // Step 1: Determine intent
    const intent = determineIntent(request);
    console.log('Determined intent:', intent);

    // Step 2: Normalize destination (Country > Area > Town)
    const normalizedDest = await normalizeDestination(request, intent);
    console.log('Normalized destination:', normalizedDest);

    // Step 3: Get current user's profile
    const currentUserSurfer = await supabaseDatabaseService.getSurferByUserId(requestingUserId);
    if (!currentUserSurfer) {
      throw new Error('Current user profile not found');
    }

    // Step 4: Query all users (excluding current user)
    const { data: allSurfers, error: queryError } = await supabase
      .from('surfers')
      .select('*')
      .neq('user_id', requestingUserId);

    if (queryError) {
      throw new Error(`Error querying surfers: ${queryError.message}`);
    }

    if (!allSurfers || allSurfers.length === 0) {
      console.log('No surfers found in database');
      return [];
    }

    console.log(`Found ${allSurfers.length} total surfers`);

    // Step 5: Process each user through 4-layer matching
    const matchingResults: UserMatchingResult[] = [];

    for (const userSurfer of allSurfers) {
      // Find matching destinations and calculate days
      let daysInDestination = 0;
      let bestMatch: {
        countryMatch: boolean;
        areaMatch: boolean;
        townMatch: boolean;
        matchedAreas: AreaOption[];
        matchedTowns: string[];
      } | null = null;

      if (userSurfer.destinations_array && userSurfer.destinations_array.length > 0) {
        for (const dest of userSurfer.destinations_array) {
          const match = destinationMatches(dest.destination_name, normalizedDest);
          
          if (match.countryMatch) {
            daysInDestination += dest.time_in_days || 0;
            
            // Track best match (prefer area + town matches)
            if (!bestMatch || 
                (match.areaMatch && !bestMatch.areaMatch) ||
                (match.townMatch && !bestMatch.townMatch)) {
              bestMatch = match;
            }
          }
        }
      }

      // Skip if no country match
      if (!bestMatch || !bestMatch.countryMatch || daysInDestination === 0) {
        continue;
      }

      // LAYER 1: Check explicit hard requirements
      const layer1Result = checkLayer1HardRequirements(userSurfer, request, normalizedDest);
      if (!layer1Result.passed) {
        matchingResults.push({
          user_id: userSurfer.user_id,
          surfer: userSurfer,
          passedLayer1: false,
          passedLayer2: false,
          priorityScore: 0,
          generalScore: 0,
          totalScore: 0,
          matchedAreas: [],
          matchedTowns: [],
          commonLifestyleKeywords: [],
          commonWaveKeywords: [],
          daysInDestination: 0,
          rejectionReason: layer1Result.reason,
        });
        continue;
      }

      // LAYER 2: Check inferred required constraints
      const layer2Result = await checkLayer2InferredConstraints(
        userSurfer,
        request,
        intent,
        currentUserSurfer
      );
      if (!layer2Result.passed) {
        matchingResults.push({
          user_id: userSurfer.user_id,
          surfer: userSurfer,
          passedLayer1: true,
          passedLayer2: false,
          priorityScore: 0,
          generalScore: 0,
          totalScore: 0,
          matchedAreas: [],
          matchedTowns: [],
          commonLifestyleKeywords: [],
          commonWaveKeywords: [],
          daysInDestination: 0,
          rejectionReason: layer2Result.reason,
        });
        continue;
      }

      // LAYER 3: Calculate priority score
      const priorityScore = calculateLayer3PriorityScore(
        userSurfer,
        request,
        intent,
        currentUserSurfer
      );

      // LAYER 4: Calculate general score
      const layer4Result = calculateLayer4GeneralScore(
        userSurfer,
        request,
        intent,
        currentUserSurfer,
        bestMatch,
        daysInDestination
      );

      // Calculate total score (priority + general)
      const totalScore = priorityScore + layer4Result.score;

      matchingResults.push({
        user_id: userSurfer.user_id,
        surfer: userSurfer,
        passedLayer1: true,
        passedLayer2: true,
        priorityScore,
        generalScore: layer4Result.score,
        totalScore,
        matchedAreas: layer4Result.matchedAreas,
        matchedTowns: layer4Result.matchedTowns,
        commonLifestyleKeywords: layer4Result.commonLifestyleKeywords,
        commonWaveKeywords: layer4Result.commonWaveKeywords,
        daysInDestination,
      });
    }

    // Step 6: Filter to only users who passed both Layer 1 and Layer 2
    const passedUsers = matchingResults.filter(r => r.passedLayer1 && r.passedLayer2);

    // Step 7: Sort by total score (descending)
    passedUsers.sort((a, b) => b.totalScore - a.totalScore);

    // Step 8: Return top 3 users
    const topUsers = passedUsers.slice(0, 3);

    console.log(`Found ${passedUsers.length} users who passed filters, returning top 3`);
    console.log('Top users:', topUsers.map(u => ({
      user_id: u.user_id,
      name: u.surfer.name,
      totalScore: u.totalScore,
      priorityScore: u.priorityScore,
      generalScore: u.generalScore,
    })));

    // Convert to MatchedUser format
    const matchedUsers: MatchedUser[] = topUsers.map(result => ({
      user_id: result.user_id,
      name: result.surfer.name || 'User',
      profile_image_url: result.surfer.profile_image_url,
      match_score: result.totalScore,
      matched_areas: result.matchedAreas,
      common_lifestyle_keywords: result.commonLifestyleKeywords,
      common_wave_keywords: result.commonWaveKeywords,
      surfboard_type: result.surfer.surfboard_type,
      surf_level: result.surfer.surf_level,
      travel_experience: result.surfer.travel_experience,
      country_from: result.surfer.country_from,
      age: result.surfer.age,
      days_in_destination: result.daysInDestination,
      destinations_array: result.surfer.destinations_array,
    }));

    console.log('=== MATCHING V3 COMPLETE ===');
    return matchedUsers;
  } catch (error) {
    console.error('Error in findMatchingUsersV3:', error);
    throw error;
  }
}

