/**
 * Matching Service
 * 
 * Handles the matching algorithm to find users who match
 * trip planning criteria (destination, budget, preferences, etc.)
 */

import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { supabaseDatabaseService, SupabaseSurfer } from '../database/supabaseDatabaseService';
import { TripPlanningRequest, MatchedUser, BUDGET_MAP, TRAVEL_EXPERIENCE_MAP, GROUP_TYPE_MAP } from '../../types/tripPlanning';
import { analyzeMatchQuality, calculateDataCompleteness } from './matchQualityAnalyzer';

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

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

/**
 * Generate array of related areas using LLM
 */
async function generateAreaArray(country: string, area: string): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, using fallback area array');
    // Fallback: return the input area and a few common variations
    return [area];
  }

  try {
    const prompt = `Given the country "${country}" and area "${area}", generate a comprehensive list of related surf areas/regions/towns in that country. Include the original area and related locations. Return ONLY a JSON array of strings, no other text. Example format: ["South", "Weligama", "Hirekatiya", "Ahangama", "Midigama"]`;

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
        temperature: 0.7,
        max_tokens: 200,
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

    // Parse JSON array from response
    const areas = JSON.parse(content);
    if (Array.isArray(areas) && areas.length > 0) {
      return areas;
    }

    // Fallback if parsing fails
    return [area];
  } catch (error) {
    console.error('Error generating area array:', error);
    // Fallback: return the input area
    return [area];
  }
}

/**
 * Extract country from destination string
 * Handles formats like "Sri Lanka, South" or just "Sri Lanka"
 */
/**
 * Extract country from destination (supports both new and legacy formats)
 */
function extractCountryFromDestination(
  dest: { country: string; area: string[] } | { destination_name: string } | string
): string {
  // New structure: {country, area[]}
  if (typeof dest === 'object' && 'country' in dest) {
    return dest.country;
  }
  
  // Legacy structure: destination_name string or {destination_name: string}
  const destinationName = typeof dest === 'string' 
    ? dest 
    : (dest as any).destination_name || '';
  
  const parts = destinationName.split(',').map((p: string) => p.trim());
  return parts[0] || ''; // First part is usually the country
}

function extractCountry(destination: string): string {
  const parts = destination.split(',').map(p => p.trim());
  return parts[0]; // First part is usually the country
}

/**
 * Check if destination contains the requested country
 * Handles new structure: {country, area[]} and legacy: destination_name string
 */
function destinationContainsCountry(
  destination: { country: string; area: string[] } | { destination_name: string } | string | null | undefined,
  requestedCountry: string | null | undefined
): boolean {
  // Handle null/undefined cases
  if (!destination || !requestedCountry) {
    return false;
  }
  
  const country = extractCountryFromDestination(destination);
  const requestedLower = requestedCountry.toLowerCase().trim();
  const countryLower = country.toLowerCase().trim();
  
  // Exact match
  if (countryLower === requestedLower) {
    return true;
  }
  
  // Use word boundary regex to avoid substring matches (e.g., "USA" in "AUS")
  const escapedRequested = requestedLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedRequested}\\b`, 'i');
  if (regex.test(countryLower)) {
    return true;
  }
  
  // Special case: if requested is "USA" and destination contains "United States" or vice versa
  if (requestedLower === 'usa' || requestedLower === 'united states') {
    if (countryLower.includes('united states') || countryLower.includes('usa')) {
      return true;
    }
  }
  
  // Special case: if requested is "UK" and destination contains "United Kingdom" or vice versa
  if (requestedLower === 'uk' || requestedLower === 'united kingdom') {
    if (countryLower.includes('united kingdom') || /\buk\b/.test(countryLower)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if any generated areas match the destination
 * Works with new structure: {country, area[]} and legacy: destination_name string
 */
function destinationMatchesAreas(
  destination: { country: string; area: string[] } | { destination_name: string } | string,
  generatedAreas: string[]
): boolean {
  // New structure: {country, area[]}
  if (typeof destination === 'object' && 'country' in destination) {
    const areas = destination.area || [];
    return generatedAreas.some(genArea => 
      areas.some(destArea => {
        const destAreaLower = destArea.toLowerCase();
        const genAreaLower = genArea.toLowerCase();
        return destAreaLower.includes(genAreaLower) || genAreaLower.includes(destAreaLower);
      })
    );
  }
  
  // Legacy structure: destination_name string
  const destinationName = typeof destination === 'string' 
    ? destination 
    : (destination as any).destination_name || '';
  
  const destinationLower = destinationName.toLowerCase();
  return generatedAreas.some(area => 
    destinationLower.includes(area.toLowerCase()) || 
    area.toLowerCase().includes(destinationLower.split(',')[1]?.trim().toLowerCase() || '')
  );
}

/**
 * Calculate similarity score for numeric attributes
 * Formula: 30 - (abs(requested - user) * 15), max 30
 */
function calculateSimilarityScore(requested: number, user: number): number {
  const diff = Math.abs(requested - user);
  return Math.max(0, 30 - (diff * 15));
}

/**
 * Calculate dynamic weights based on context and purpose
 */
function calculateDynamicWeights(
  request: TripPlanningRequest,
  currentUserSurfer: SupabaseSurfer
): {
  lifestyleWeight: number;
  waveWeight: number;
  surfLevelWeight: number;
  boardTypeWeight: number;
  budgetWeight: number;
  travelExpWeight: number;
  groupTypeWeight: number;
  destinationDaysWeight: number;
} {
  // Base weights
  let lifestyleWeight = 5; // per match
  let waveWeight = 5; // per match
  let surfLevelWeight = 30; // similarity score
  let boardTypeWeight = 30; // exact match
  let budgetWeight = 30; // similarity score
  let travelExpWeight = 30; // similarity score
  let groupTypeWeight = 30; // exact match
  let destinationDaysWeight = 1; // per day

  // Adjust weights based on purpose
  if (request.purpose.purpose_type === 'connect_traveler') {
    // More weight on vibe and lifestyle match
    lifestyleWeight = 10;
    waveWeight = 8;
    surfLevelWeight = 40;
    boardTypeWeight = 40;
  } else if (request.purpose.purpose_type === 'specific_advice') {
    // More weight on destination experience and expertise
    destinationDaysWeight = 2;
    surfLevelWeight = 40; // Higher level = more expertise
    if (request.purpose.specific_topics?.some(t => t.includes('wave') || t.includes('surf'))) {
      surfLevelWeight = 50;
      boardTypeWeight = 40;
    }
  } else if (request.purpose.purpose_type === 'general_guidance') {
    // Balanced, but destination experience matters more
    destinationDaysWeight = 1.5;
  }

  // Adjust weights based on user context preferences
  if (request.user_context?.mentioned_preferences) {
    const prefs = request.user_context.mentioned_preferences.map(p => p.toLowerCase());
    if (prefs.some(p => p.includes('yoga') || p.includes('lifestyle'))) {
      lifestyleWeight = 10;
    }
    if (prefs.some(p => p.includes('wave') || p.includes('surf'))) {
      waveWeight = 8;
      surfLevelWeight = 40;
    }
  }

  // Context-based adjustments (e.g., Israeli + Sri Lanka visa question)
  if (request.purpose.specific_topics) {
    const topics = request.purpose.specific_topics.map(t => t.toLowerCase());
    if (topics.some(t => t.includes('visa') || t.includes('entry'))) {
      // If asking about visa, prioritize users from same country
      // This will be handled in must-have filters, but also boost country match
      if (currentUserSurfer.country_from) {
        // Country match becomes very important
        // This is handled separately in must-have filters
      }
    }
  }

  return {
    lifestyleWeight,
    waveWeight,
    surfLevelWeight,
    boardTypeWeight,
    budgetWeight,
    travelExpWeight,
    groupTypeWeight,
    destinationDaysWeight,
  };
}

/**
 * Apply must-have filters (explicit user requests)
 * Returns true if user should be filtered out
 */
function applyMustHaveFilters(
  userSurfer: SupabaseSurfer,
  request: TripPlanningRequest
): boolean {
  const criteria = request.non_negotiable_criteria;
  if (!criteria) return false;

  // Filter by country_from
  if (criteria.country_from && criteria.country_from.length > 0) {
    if (!userSurfer.country_from) return true;
    const userCountry = userSurfer.country_from.toLowerCase();
    const matches = criteria.country_from.some(
      c => userCountry.includes(c.toLowerCase()) || c.toLowerCase().includes(userCountry)
    );
    if (!matches) return true;
  }

  // Filter by surfboard_type
  if (criteria.surfboard_type && criteria.surfboard_type.length > 0) {
    if (!userSurfer.surfboard_type) return true;
    if (!criteria.surfboard_type.includes(userSurfer.surfboard_type)) return true;
  }

  // Filter by age_range
  if (criteria.age_range && criteria.age_range.length === 2) {
    if (!userSurfer.age) return true;
    const [minAge, maxAge] = criteria.age_range;
    if (userSurfer.age < minAge || userSurfer.age > maxAge) return true;
  }

  // Filter by surf_level_min
  if (criteria.surf_level_min !== undefined && criteria.surf_level_min !== null) {
    if (!userSurfer.surf_level) return true;
    if (userSurfer.surf_level < criteria.surf_level_min) return true;
  }

  // Filter by surf_level_max
  if (criteria.surf_level_max !== undefined && criteria.surf_level_max !== null) {
    if (!userSurfer.surf_level) return true;
    if (userSurfer.surf_level > criteria.surf_level_max) return true;
  }

  // Filter by must_have_keywords (lifestyle or wave keywords)
  if (criteria.must_have_keywords && criteria.must_have_keywords.length > 0) {
    const userLifestyle = (userSurfer.lifestyle_keywords || []).map(k => k.toLowerCase());
    const userWave = (userSurfer.wave_type_keywords || []).map(k => k.toLowerCase());
    const required = criteria.must_have_keywords.map(k => k.toLowerCase());
    
    const hasAll = required.every(keyword =>
      userLifestyle.includes(keyword) || userWave.includes(keyword)
    );
    if (!hasAll) return true;
  }

  return false; // User passes all filters
}

/**
 * Apply AI/context filters and boost weights
 * Returns a multiplier for the base score based on context
 */
function applyContextFilters(
  userSurfer: SupabaseSurfer,
  request: TripPlanningRequest,
  currentUserSurfer: SupabaseSurfer
): number {
  let contextMultiplier = 1.0;

  // Context: Same country + visa question = high priority
  if (request.purpose.specific_topics?.some(t => 
    t.toLowerCase().includes('visa') || 
    t.toLowerCase().includes('entry') ||
    t.toLowerCase().includes('document')
  )) {
    if (currentUserSurfer.country_from && userSurfer.country_from) {
      const currentCountry = currentUserSurfer.country_from.toLowerCase();
      const userCountry = userSurfer.country_from.toLowerCase();
      if (currentCountry.includes(userCountry) || userCountry.includes(currentCountry)) {
        contextMultiplier *= 1.5; // Boost for same country when asking about visa
      }
    }
  }

  // Context: Asking about waves/surf spots = prioritize higher surf level
  if (request.purpose.specific_topics?.some(t => 
    t.toLowerCase().includes('wave') || 
    t.toLowerCase().includes('surf') ||
    t.toLowerCase().includes('spot') ||
    t.toLowerCase().includes('break')
  )) {
    if (userSurfer.surf_level && currentUserSurfer.surf_level) {
      if (userSurfer.surf_level >= currentUserSurfer.surf_level) {
        contextMultiplier *= 1.3; // Boost for equal or higher level
      }
    }
  }

  // Context: Asking about accommodation/living = prioritize longer stays
  if (request.purpose.specific_topics?.some(t => 
    t.toLowerCase().includes('accommodation') || 
    t.toLowerCase().includes('living') ||
    t.toLowerCase().includes('stay') ||
    t.toLowerCase().includes('housing')
  )) {
    // This will be handled in destination days scoring
    contextMultiplier *= 1.2;
  }

  return contextMultiplier;
}

/**
 * Calculate similarity score using V2 formula: 30 - (abs(requested - user) * 15)
 * Returns value between 0 and 30
 */
function calculateV2SimilarityScore(requested: number, user: number): number {
  return Math.max(0, Math.min(30, 30 - (Math.abs(requested - user) * 15)));
}

/**
 * Check if area matches any of the generated areas
 */
function areaMatches(
  destination: { country: string; area: string[] } | { destination_name: string } | string,
  generatedAreas: string[]
): boolean {
  return destinationMatchesAreas(destination, generatedAreas);
}

/**
 * Check if prioritized filter matches user
 */
function checkPrioritizedFilterMatch(
  filterKey: string,
  filterValue: any,
  userSurfer: SupabaseSurfer,
  currentUserSurfer: SupabaseSurfer
): boolean {
  switch (filterKey) {
    case 'origin_country':
    case 'country_from':
      if (!userSurfer.country_from || !filterValue) return false;
      return userSurfer.country_from.toLowerCase().includes(filterValue.toLowerCase()) ||
             filterValue.toLowerCase().includes(userSurfer.country_from.toLowerCase());
    
    case 'board_type':
    case 'surfboard_type':
      return userSurfer.surfboard_type === filterValue;
    
    case 'surf_level':
      return userSurfer.surf_level === filterValue;
    
    case 'age_range':
      if (!Array.isArray(filterValue) || filterValue.length !== 2) return false;
      if (!userSurfer.age) return false;
      const [minAge, maxAge] = filterValue;
      return userSurfer.age >= minAge && userSurfer.age <= maxAge;
    
    case 'lifestyle_keywords':
      if (!Array.isArray(filterValue) || !userSurfer.lifestyle_keywords) return false;
      return filterValue.some(keyword => 
        userSurfer.lifestyle_keywords!.some(userKeyword => 
          userKeyword.toLowerCase() === keyword.toLowerCase()
        )
      );
    
    case 'wave_type_keywords':
      if (!Array.isArray(filterValue) || !userSurfer.wave_type_keywords) return false;
      return filterValue.some(keyword => 
        userSurfer.wave_type_keywords!.some(userKeyword => 
          userKeyword.toLowerCase() === keyword.toLowerCase()
        )
      );
    
    case 'travel_experience':
      // Handle both integer (new format) and enum string (legacy format)
      if (typeof filterValue === 'string' && typeof userSurfer.travel_experience === 'string') {
        return userSurfer.travel_experience === filterValue;
      }
      // For integer comparison, convert both to levels
      const filterLevel = getTravelExperienceLevel(filterValue);
      const userLevel = getTravelExperienceLevel(userSurfer.travel_experience);
      return filterLevel === userLevel;
    
    case 'group_type':
    case 'travel_buddies':
      return userSurfer.travel_buddies === filterValue;
    
    default:
      return false;
  }
}

/**
 * Find matching users V2 - Simplified point-based algorithm
 * Implements the V2 matching algorithm with fixed point values
 */
export async function findMatchingUsersV2(
  request: TripPlanningRequest,
  requestingUserId: string
): Promise<MatchedUser[]> {
  console.log('=== FINDING MATCHING USERS V2 ===');
  console.log('Request:', JSON.stringify(request, null, 2));
  console.log('Requesting User ID:', requestingUserId);
  
  // Validate required fields
  if (!request.destination_country || !request.area || !request.budget) {
    throw new Error('V2 algorithm requires destination_country, area, and budget');
  }
  
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }

  try {
    // Step 1: Generate area array using LLM
    console.log('Step 1: Generating area array...');
    const generatedAreas = await generateAreaArray(request.destination_country, request.area);
    console.log('Generated areas:', generatedAreas);

    // Step 2: Initialize user points map
    console.log('Step 2: Initializing user points map...');
    const userPoints = new Map<string, {
      surfer: SupabaseSurfer;
      points: number;
      matchedAreas: string[];
      commonLifestyleKeywords: string[];
      commonWaveKeywords: string[];
      daysInDestination: number;
    }>();

    // Step 3: Query users with matching destinations
    console.log('Step 3: Querying users with matching destinations...');
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

    // Get current user's profile for comparison
    const currentUserSurfer = await supabaseDatabaseService.getSurferByUserId(requestingUserId);
    if (!currentUserSurfer) {
      throw new Error('Current user profile not found');
    }

    // Filter users who have the destination country in their destinations_array
    const usersWithDestination = allSurfers.filter((surfer: any) => {
      if (!surfer.destinations_array || !Array.isArray(surfer.destinations_array)) {
        return false;
      }
      return surfer.destinations_array.some((dest: any) => 
        destinationContainsCountry(dest, request.destination_country)
      );
    });

    console.log(`Filtered to ${usersWithDestination.length} users with matching destinations`);

    // Step 4: Initialize points with days spent
    console.log('Step 4: Initializing points with days spent...');
    for (const surfer of usersWithDestination) {
      const userSurfer = surfer as SupabaseSurfer;
      
      // Find matching destination entries and sum days
      let daysInDestination = 0;
      if (userSurfer.destinations_array) {
        const matchingDestinations = userSurfer.destinations_array.filter(dest =>
          destinationContainsCountry(dest, request.destination_country)
        );
        daysInDestination = matchingDestinations.reduce((sum, dest) => sum + (dest.time_in_days || 0), 0);
      }

      userPoints.set(userSurfer.user_id, {
        surfer: userSurfer,
        points: daysInDestination, // Initialize with days
        matchedAreas: [],
        commonLifestyleKeywords: [],
        commonWaveKeywords: [],
        daysInDestination: daysInDestination,
      });
    }

    console.log(`Initialized ${userPoints.size} users with base points`);

    // Steps 5-13: Calculate additional points
    console.log('Steps 5-13: Calculating additional points...');
    
    for (const [userId, userEntry] of userPoints.entries()) {
      const userSurfer = userEntry.surfer;
      let points = userEntry.points;

      // Step 5: Add 30 points for area matches
      if (userSurfer.destinations_array && generatedAreas.length > 0) {
        for (const dest of userSurfer.destinations_array) {
          if (destinationContainsCountry(dest, request.destination_country)) {
            if (areaMatches(dest, generatedAreas)) {
              points += 30;
              // Track which area matched
              const destAreas = 'area' in dest ? dest.area : [];
              const destName = ('destination_name' in dest ? dest.destination_name : '') as string;
              const matchedArea = generatedAreas.find(area => {
                const areaLower = area.toLowerCase();
                return destAreas.some(da => da.toLowerCase().includes(areaLower)) ||
                       destName.toLowerCase().includes(areaLower);
              });
              if (matchedArea && !userEntry.matchedAreas.includes(matchedArea)) {
                userEntry.matchedAreas.push(matchedArea);
              }
              break; // Only count once per user
            }
          }
        }
      }

      // Step 6: Budget compatibility (0-30 points)
      if (userSurfer.travel_type && request.budget) {
        const userBudget = BUDGET_MAP[userSurfer.travel_type] || 2;
        points += calculateV2SimilarityScore(request.budget, userBudget);
      }

      // Step 7: Surf level compatibility (0-30 points)
      if (userSurfer.surf_level && currentUserSurfer.surf_level) {
        points += calculateV2SimilarityScore(currentUserSurfer.surf_level, userSurfer.surf_level);
      }

      // Step 8: Travel experience compatibility (0-30 points)
      if (userSurfer.travel_experience !== undefined && currentUserSurfer.travel_experience !== undefined) {
        const requestedExp = getTravelExperienceLevel(currentUserSurfer.travel_experience);
        const userExp = getTravelExperienceLevel(userSurfer.travel_experience);
        points += calculateV2SimilarityScore(requestedExp, userExp);
      }

      // Step 9: Surfboard type match (+30 points)
      if (
        userSurfer.surfboard_type &&
        currentUserSurfer.surfboard_type &&
        userSurfer.surfboard_type === currentUserSurfer.surfboard_type
      ) {
        points += 30;
      }

      // Step 10: Group type match (+30 points)
      if (userSurfer.travel_buddies && currentUserSurfer.travel_buddies) {
        if (userSurfer.travel_buddies === currentUserSurfer.travel_buddies) {
          points += 30;
        }
      }

      // Step 11: Lifestyle keywords (+5 points per match)
      if (userSurfer.lifestyle_keywords && currentUserSurfer.lifestyle_keywords) {
        const commonKeywords = userSurfer.lifestyle_keywords.filter(keyword =>
          currentUserSurfer.lifestyle_keywords!.some(
            currentKeyword => currentKeyword.toLowerCase() === keyword.toLowerCase()
          )
        );
        points += commonKeywords.length * 5;
        userEntry.commonLifestyleKeywords = commonKeywords;
      }

      // Step 12: Wave keywords (+5 points per match)
      if (userSurfer.wave_type_keywords && currentUserSurfer.wave_type_keywords) {
        const commonKeywords = userSurfer.wave_type_keywords.filter(keyword =>
          currentUserSurfer.wave_type_keywords!.some(
            currentKeyword => currentKeyword.toLowerCase() === keyword.toLowerCase()
          )
        );
        points += commonKeywords.length * 5;
        userEntry.commonWaveKeywords = commonKeywords;
      }

      // Step 13: Prioritized filters (+50 points per match)
      if (request.prioritize_filters) {
        for (const [filterKey, filterValue] of Object.entries(request.prioritize_filters)) {
          if (filterValue !== undefined && filterValue !== null) {
            if (checkPrioritizedFilterMatch(filterKey, filterValue, userSurfer, currentUserSurfer)) {
              points += 50;
              console.log(`  ${userSurfer.name}: +50 points for prioritized filter match: ${filterKey} = ${filterValue}`);
            }
          }
        }
      }

      // Update points
      userEntry.points = points;
    }

    // Step 14: Sort and return top 3
    console.log('Step 14: Sorting and selecting top 3 matches...');
    const sortedUsers = Array.from(userPoints.values())
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);

    console.log('Top 3 matches:', sortedUsers.map(u => ({
      name: u.surfer.name,
      points: u.points,
      days: u.daysInDestination
    })));

    // Format as MatchedUser array
    const matchedUsers: MatchedUser[] = sortedUsers.map(entry => ({
      user_id: entry.surfer.user_id,
      name: entry.surfer.name,
      profile_image_url: entry.surfer.profile_image_url || null,
      match_score: entry.points,
      matched_areas: entry.matchedAreas,
      common_lifestyle_keywords: entry.commonLifestyleKeywords,
      common_wave_keywords: entry.commonWaveKeywords,
      surfboard_type: entry.surfer.surfboard_type || undefined,
      surf_level: entry.surfer.surf_level || undefined,
      travel_experience: entry.surfer.travel_experience?.toString() || undefined, // Convert to string
      country_from: entry.surfer.country_from || undefined,
      age: entry.surfer.age || undefined,
      days_in_destination: entry.daysInDestination,
      destinations_array: entry.surfer.destinations_array,
    }));

    console.log('=== MATCHING V2 COMPLETE ===');
    console.log(`Found ${matchedUsers.length} matched users`);
    console.log('==========================');
    
    return matchedUsers;
  } catch (error) {
    console.error('Error in findMatchingUsersV2:', error);
    throw error;
  }
}

/**
 * Find matching users based on trip planning criteria
 * Unified algorithm that combines filtering (queryFilters) and scoring (V2 point system)
 */
export async function findMatchingUsers(
  request: TripPlanningRequest,
  requestingUserId: string
): Promise<MatchedUser[]> {
  console.log('=== FINDING MATCHING USERS ===');
  console.log('Request:', JSON.stringify(request, null, 2));
  console.log('Requesting User ID:', requestingUserId);
  console.log('Query Filters Present:', !!request.queryFilters);
  if (request.queryFilters) {
    console.log('Query Filters Content:', JSON.stringify(request.queryFilters, null, 2));
  }
  if (request.prioritize_filters) {
    console.log('Prioritize Filters:', JSON.stringify(request.prioritize_filters, null, 2));
  }
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }

  try {
    // Step 1: Handle destination_country (optional - if null, we'll score without destination filtering)
    let generatedAreas: string[] = [];
    let destinationCountryLower: string | null = null;
    
    if (request.destination_country) {
      // Step 2: Generate area array using LLM (if area is provided)
      generatedAreas = request.area 
        ? await generateAreaArray(request.destination_country, request.area)
        : [request.destination_country];
      console.log('Generated areas:', generatedAreas);
      
      // Normalize destination country for filtering (lowercase for comparison)
      destinationCountryLower = request.destination_country.toLowerCase();
    } else {
      console.log('⚠️ No destination_country provided - will match surfers without destination filtering');
      generatedAreas = [];
    }

    // Step 2: Get current user's profile for comparison
    const currentUserSurfer = await supabaseDatabaseService.getSurferByUserId(requestingUserId);
    if (!currentUserSurfer) {
      throw new Error('Current user profile not found');
    }

    // Step 3: Build and execute Supabase query with filters (if provided)
    console.log('Step 4: Querying Supabase for surfers...');
    console.log('Has queryFilters?', !!request.queryFilters);
    
    let query = supabase
      .from('surfers')
      .select('*')
      .neq('user_id', requestingUserId); // Always exclude current user
    
    // Apply AI-extracted query filters if available
    if (request.queryFilters) {
      console.log('✅ Applying query filters:', JSON.stringify(request.queryFilters, null, 2));
      
      // Filter by country_from
      if (request.queryFilters.country_from && request.queryFilters.country_from.length > 0) {
        query = query.in('country_from', request.queryFilters.country_from);
        console.log(`  - Filtering by country_from: ${request.queryFilters.country_from.join(', ')}`);
      }
      
      // Filter by age range
      if (request.queryFilters.age_min !== undefined && request.queryFilters.age_min !== null && typeof request.queryFilters.age_min === 'number') {
        query = query.gte('age', request.queryFilters.age_min);
        console.log(`  - Filtering by age_min: ${request.queryFilters.age_min}`);
      }
      if (request.queryFilters.age_max !== undefined && request.queryFilters.age_max !== null && typeof request.queryFilters.age_max === 'number') {
        query = query.lte('age', request.queryFilters.age_max);
        console.log(`  - Filtering by age_max: ${request.queryFilters.age_max}`);
      }
      
      // Filter by surfboard_type (handle both string and array)
      if (request.queryFilters.surfboard_type) {
        const surfboardTypes = Array.isArray(request.queryFilters.surfboard_type) 
          ? request.queryFilters.surfboard_type 
          : [request.queryFilters.surfboard_type];
        if (surfboardTypes.length > 0) {
          query = query.in('surfboard_type', surfboardTypes);
          console.log(`  - Filtering by surfboard_type: ${surfboardTypes.join(', ')}`);
        }
      }
      
      // Filter by surf_level
      if (request.queryFilters.surf_level_min !== undefined && request.queryFilters.surf_level_min !== null && typeof request.queryFilters.surf_level_min === 'number') {
        query = query.gte('surf_level', request.queryFilters.surf_level_min);
        console.log(`  - Filtering by surf_level_min: ${request.queryFilters.surf_level_min}`);
      }
      if (request.queryFilters.surf_level_max !== undefined && request.queryFilters.surf_level_max !== null && typeof request.queryFilters.surf_level_max === 'number') {
        query = query.lte('surf_level', request.queryFilters.surf_level_max);
        console.log(`  - Filtering by surf_level_max: ${request.queryFilters.surf_level_max}`);
      }
      
      // Filter by lifestyle_keywords (array contains)
      if (request.queryFilters.lifestyle_keywords && request.queryFilters.lifestyle_keywords.length > 0) {
        query = query.contains('lifestyle_keywords', request.queryFilters.lifestyle_keywords);
        console.log(`  - Filtering by lifestyle_keywords: ${request.queryFilters.lifestyle_keywords.join(', ')}`);
      }
      
      // Filter by wave_type_keywords (array contains)
      if (request.queryFilters.wave_type_keywords && request.queryFilters.wave_type_keywords.length > 0) {
        query = query.contains('wave_type_keywords', request.queryFilters.wave_type_keywords);
        console.log(`  - Filtering by wave_type_keywords: ${request.queryFilters.wave_type_keywords.join(', ')}`);
      }
    } else {
      console.log('⚠️ No query filters provided - querying all surfers');
    }
    
    // Note: Destination filtering is done in-memory after the query
    // This is because destinations_array is JSONB and requires complex pattern matching
    // that's more reliable to do in-memory with the destinationContainsCountry function
    // The DB-level filter above would be ideal but Supabase JSONB filtering for partial string matches
    // in nested arrays is complex and less reliable than in-memory filtering
    
    const queryStartTime = Date.now();
    let { data: allSurfers, error: queryError } = await query;
    const queryEndTime = Date.now();
    
    console.log(`Supabase query took ${queryEndTime - queryStartTime}ms`);
    
    if (queryError) {
      console.error('Supabase query error:', queryError);
      console.error('Error details:', JSON.stringify(queryError, null, 2));
      throw new Error(`Error querying surfers: ${queryError.message}`);
    }

    console.log(`Supabase returned ${allSurfers?.length || 0} surfers`);
    if (!allSurfers || allSurfers.length === 0) {
      console.log('No surfers found in database after applying query filters');
      
      // If filters came from non-negotiable step and no matches found, return empty
      // Otherwise, we'll relax filters and return closest matches
      if (request.filtersFromNonNegotiableStep && request.queryFilters) {
        console.log('⚠️ No matches found with non-negotiable criteria - returning empty array');
        return [];
      }
      
      // If not from non-negotiable step, query again without filters to get closest matches
      console.log('ℹ️ No exact matches found, but filters not from non-negotiable step - querying all surfers for closest matches');
      const { data: allSurfersRelaxed, error: relaxedError } = await supabase
        .from('surfers')
        .select('*')
        .neq('user_id', requestingUserId);
      
      if (relaxedError) {
        console.error('Error querying all surfers for closest matches:', relaxedError);
        return [];
      }
      
      allSurfers = allSurfersRelaxed || [];
      console.log(`Relaxed query returned ${allSurfers.length} surfers for closest match scoring`);
    }
    
    // Log sample of returned data
    console.log('Sample surfer data (first 3):', allSurfers.slice(0, 3).map(s => ({
      name: s.name,
      country_from: s.country_from,
      destinations_count: s.destinations_array?.length || 0,
      has_el_salvador: s.destinations_array?.some((d: any) => 
        destinationContainsCountry(d, 'El Salvador')
      ) || false
    })));

    // Step 4.5: Apply destination_days_min filter in-memory (since it's JSONB)
    let filteredSurfers = allSurfers
    if (request.queryFilters?.destination_days_min) {
      const { destination, min_days } = request.queryFilters.destination_days_min
      console.log(`Applying destination_days_min filter: ${min_days} days in ${destination}`)
      
      filteredSurfers = allSurfers.filter((surfer: any) => {
        if (!surfer.destinations_array) return false
        const destinations = Array.isArray(surfer.destinations_array) 
          ? surfer.destinations_array 
          : []
        
        const match = destinations.find((d: any) => 
          destinationContainsCountry(d, destination) &&
          d.time_in_days >= min_days
        )
        return !!match
      })
      
      console.log(`Filtered ${allSurfers.length} surfers to ${filteredSurfers.length} after destination_days_min filter`)
      
      // If no matches after destination_days_min and filters from non-negotiable step, return empty
      if (filteredSurfers.length === 0 && request.filtersFromNonNegotiableStep) {
        console.log('⚠️ No matches found after destination_days_min filter with non-negotiable criteria - returning empty')
        return []
      }
    }
    
    // If no surfers after all filters and filters are from non-negotiable step, return empty
    if (filteredSurfers.length === 0 && request.filtersFromNonNegotiableStep && request.queryFilters) {
      console.log('⚠️ No surfers match the non-negotiable criteria - returning empty array')
      return []
    }
    
    // If no surfers but filters NOT from non-negotiable step, query again without filters to get closest matches
    if (filteredSurfers.length === 0 && request.queryFilters && !request.filtersFromNonNegotiableStep) {
      console.log('ℹ️ No exact matches, but filters not non-negotiable - querying all surfers for closest matches')
      const { data: allSurfersRelaxed, error: relaxedError } = await supabase
        .from('surfers')
        .select('*')
        .neq('user_id', requestingUserId)
      
      if (relaxedError) {
        console.error('Error querying all surfers for closest matches:', relaxedError)
        return []
      }
      
      filteredSurfers = allSurfersRelaxed || []
      console.log(`Relaxed query returned ${filteredSurfers.length} surfers for closest match scoring`)
    }

    // Step 5: Apply must-have filters (for backward compatibility with non_negotiable_criteria)
    // Note: If queryFilters were used, most filtering is already done at DB level
    console.log('Step 5: Applying must-have filters (backward compatibility)...');
    console.log('Non-negotiable criteria:', JSON.stringify(request.non_negotiable_criteria, null, 2));
    
    filteredSurfers = filteredSurfers.filter((surfer: any) => {
      const shouldFilter = applyMustHaveFilters(surfer as SupabaseSurfer, request);
      if (shouldFilter) {
        console.log(`Filtered out: ${surfer.name} (${surfer.country_from}) - reason: must-have filter failed`);
      }
      return !shouldFilter; // Keep users who pass filters
    });

    console.log(`Final filtered count: ${filteredSurfers.length} surfers after all filters`);
    console.log('Surfers that passed filters:', filteredSurfers.map(s => ({ 
      name: s.name, 
      country_from: s.country_from 
    })));

    // Step 6: Pre-filter by destination BEFORE scoring (more efficient)
    // Filter out users who don't have the destination in their destinations_array
    console.log('Step 6: Pre-filtering by destination...');
    
    let surfersWithDestination = filteredSurfers;
    
    // Only filter by destination if destination_country is provided
    // NOTE: destination_country is NOT required - users can request surfers without a destination
    if (request.destination_country) {
      console.log(`Filtering by destination: ${request.destination_country}`);
      surfersWithDestination = filteredSurfers.filter((surfer: any) => {
        if (!surfer.destinations_array || !Array.isArray(surfer.destinations_array)) {
          return false;
        }
        return surfer.destinations_array.some((dest: any) => 
          destinationContainsCountry(dest, request.destination_country)
        );
      });
      console.log(`Filtered to ${surfersWithDestination.length} surfers with matching destinations (from ${filteredSurfers.length} total)`);
    } else {
      console.log('ℹ️ No destination_country provided - matching by other criteria only (destination not required)');
      console.log(`Proceeding with ${filteredSurfers.length} surfers (no destination filter applied)`);
      // Use all filtered surfers when no destination is specified
      surfersWithDestination = filteredSurfers;
    }
    
    // Step 7: Create user_points map and calculate scores using unified V2 point system
    const userPoints = new Map<string, {
      surfer: SupabaseSurfer;
      points: number;
      matchedAreas: string[];
      commonLifestyleKeywords: string[];
      commonWaveKeywords: string[];
      daysInDestination: number;
    }>();

    // Initialize map for each filtered user (only those with matching destinations)
    for (const surfer of surfersWithDestination) {
      const userSurfer = surfer as SupabaseSurfer;
      
      // Initialize points with days spent in destination
      let daysInDestination = 0;
      if (request.destination_country && userSurfer.destinations_array) {
        const matchingDestinations = userSurfer.destinations_array.filter(dest =>
          destinationContainsCountry(dest, request.destination_country)
        );
        daysInDestination = matchingDestinations.reduce((sum, dest) => sum + (dest.time_in_days || 0), 0);
      } else if (!request.destination_country && userSurfer.destinations_array) {
        // No specific destination - sum all days
        daysInDestination = userSurfer.destinations_array.reduce((sum: number, dest: any) => sum + (dest.time_in_days || 0), 0);
      }

      userPoints.set(surfer.user_id, {
        surfer: userSurfer,
        points: daysInDestination, // Initialize with days (base score)
        matchedAreas: [],
        commonLifestyleKeywords: [],
        commonWaveKeywords: [],
        daysInDestination: daysInDestination,
      });
    }

    // Step 8: Score each user using unified V2 point system
    for (const surfer of surfersWithDestination) {
      const userEntry = userPoints.get(surfer.user_id);
      if (!userEntry) continue;

      const { surfer: userSurfer } = userEntry;
      let points = userEntry.points; // Start with base points (days)

      // Step 5: Add 30 points for area matches
      if (request.area && request.destination_country && userSurfer.destinations_array && generatedAreas.length > 0) {
        for (const dest of userSurfer.destinations_array) {
          if (destinationContainsCountry(dest, request.destination_country)) {
            if (areaMatches(dest, generatedAreas)) {
              points += 30;
              // Track which area matched
              const destAreas = 'area' in dest ? dest.area : [];
              const destName = ('destination_name' in dest ? dest.destination_name : '') as string;
              const matchedArea = generatedAreas.find(area => {
                const areaLower = area.toLowerCase();
                return destAreas.some(da => da.toLowerCase().includes(areaLower)) ||
                       destName.toLowerCase().includes(areaLower);
              });
              if (matchedArea && !userEntry.matchedAreas.includes(matchedArea)) {
                userEntry.matchedAreas.push(matchedArea);
              }
              break; // Only count once per user
            }
          }
        }
      }

      // Step 6: Budget compatibility (0-30 points)
      if (request.budget && userSurfer.travel_type) {
        const userBudget = BUDGET_MAP[userSurfer.travel_type] || 2;
        points += calculateV2SimilarityScore(request.budget, userBudget);
      }

      // Step 7: Surf level compatibility (0-30 points)
      if (userSurfer.surf_level && currentUserSurfer.surf_level) {
        points += calculateV2SimilarityScore(currentUserSurfer.surf_level, userSurfer.surf_level);
      }

      // Step 8: Travel experience compatibility (0-30 points)
      if (userSurfer.travel_experience !== undefined && currentUserSurfer.travel_experience !== undefined) {
        const requestedExp = getTravelExperienceLevel(currentUserSurfer.travel_experience);
        const userExp = getTravelExperienceLevel(userSurfer.travel_experience);
        points += calculateV2SimilarityScore(requestedExp, userExp);
      }

      // Step 9: Surfboard type match (+30 points)
      if (
        userSurfer.surfboard_type &&
        currentUserSurfer.surfboard_type &&
        userSurfer.surfboard_type === currentUserSurfer.surfboard_type
      ) {
        points += 30;
      }

      // Step 10: Group type match (+30 points)
      if (userSurfer.travel_buddies && currentUserSurfer.travel_buddies) {
        if (userSurfer.travel_buddies === currentUserSurfer.travel_buddies) {
          points += 30;
        }
      }

      // Step 11: Lifestyle keywords (+5 points per match)
      if (userSurfer.lifestyle_keywords && currentUserSurfer.lifestyle_keywords) {
        const commonKeywords = userSurfer.lifestyle_keywords.filter(keyword =>
          currentUserSurfer.lifestyle_keywords!.some(
            currentKeyword => currentKeyword.toLowerCase() === keyword.toLowerCase()
          )
        );
        points += commonKeywords.length * 5;
        userEntry.commonLifestyleKeywords = commonKeywords;
      }

      // Step 12: Wave keywords (+5 points per match)
      if (userSurfer.wave_type_keywords && currentUserSurfer.wave_type_keywords) {
        const commonKeywords = userSurfer.wave_type_keywords.filter(keyword =>
          currentUserSurfer.wave_type_keywords!.some(
            currentKeyword => currentKeyword.toLowerCase() === keyword.toLowerCase()
          )
        );
        points += commonKeywords.length * 5;
        userEntry.commonWaveKeywords = commonKeywords;
      }

      // Step 13: Prioritized filters (+50 points per match)
      if (request.prioritize_filters) {
        for (const [filterKey, filterValue] of Object.entries(request.prioritize_filters)) {
          if (filterValue !== undefined && filterValue !== null) {
            if (checkPrioritizedFilterMatch(filterKey, filterValue, userSurfer, currentUserSurfer)) {
              points += 50;
              console.log(`  ${userSurfer.name}: +50 points for prioritized filter match: ${filterKey} = ${filterValue}`);
            }
          }
        }
      }

      // Update points
      userEntry.points = points;
    }

    // Step 14: Sort and return top 3
    console.log('Step 14: Sorting and selecting top 3 matches...');
    console.log(`Total users with points: ${userPoints.size}`);
    
    const sortedUsers = Array.from(userPoints.values())
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);
    
    console.log('Top 3 matches:', sortedUsers.map(u => ({
      name: u.surfer.name,
      points: u.points,
      days: u.daysInDestination,
      country_from: u.surfer.country_from
    })));

    // Format as MatchedUser array with match quality analysis
    const matchedUsersWithQuality = sortedUsers.map(entry => {
      // Create destination match info for quality analysis
      const destinationMatch = {
        countryMatch: request.destination_country 
          ? entry.surfer.destinations_array?.some((dest: any) => 
              destinationContainsCountry(dest, request.destination_country!)
            ) || false
          : false, // If no destination requested, countryMatch is false (not applicable)
        areaMatch: request.area && request.destination_country
          ? entry.matchedAreas.length > 0
          : false,
        townMatch: false, // Not used in this matching service
        matchedAreas: entry.matchedAreas,
        matchedTowns: [],
      };
      
      // Analyze match quality
      const matchQuality = analyzeMatchQuality(request, entry.surfer, destinationMatch);
      
      return {
        user_id: entry.surfer.user_id,
        name: entry.surfer.name,
        profile_image_url: entry.surfer.profile_image_url || null,
        match_score: entry.points,
        matched_areas: entry.matchedAreas,
        common_lifestyle_keywords: entry.commonLifestyleKeywords,
        common_wave_keywords: entry.commonWaveKeywords,
        surfboard_type: entry.surfer.surfboard_type || undefined,
        surf_level: entry.surfer.surf_level || undefined,
        travel_experience: entry.surfer.travel_experience?.toString() || undefined, // Convert to string
        country_from: entry.surfer.country_from || undefined,
        age: entry.surfer.age || undefined,
        days_in_destination: entry.daysInDestination,
        destinations_array: entry.surfer.destinations_array,
        matchQuality, // Add match quality
      };
    });
    
    // Check if any criteria were requested
    const hasCriteria = !!(
      request.destination_country ||
      request.area ||
      request.non_negotiable_criteria?.country_from ||
      request.non_negotiable_criteria?.age_range ||
      request.non_negotiable_criteria?.surfboard_type ||
      request.non_negotiable_criteria?.surf_level_min ||
      request.non_negotiable_criteria?.surf_level_max ||
      request.queryFilters?.age_min ||
      request.queryFilters?.age_max ||
      request.queryFilters?.country_from ||
      request.queryFilters?.surfboard_type ||
      request.queryFilters?.surf_level_min ||
      request.queryFilters?.surf_level_max
    );
    
    // Filter by matchCount > 1 only if criteria were requested
    // If no criteria (e.g., "random user"), return all users regardless of matchCount
    const validMatches = hasCriteria
      ? matchedUsersWithQuality.filter(u => u.matchQuality && u.matchQuality.matchCount > 1)
      : matchedUsersWithQuality; // No criteria = return all (will be sorted by score)
    
    // Sort by match count (desc), then by score (desc), then by data completeness
    validMatches.sort((a, b) => {
      if (!a.matchQuality || !b.matchQuality) return 0;
      if (b.matchQuality.matchCount !== a.matchQuality.matchCount) {
        return b.matchQuality.matchCount - a.matchQuality.matchCount;
      }
      if (b.match_score !== a.match_score) {
        return b.match_score - a.match_score;
      }
      const aCompleteness = calculateDataCompleteness(a as any);
      const bCompleteness = calculateDataCompleteness(b as any);
      return bCompleteness - aCompleteness;
    });
    
    // Return top 3
    const topMatches: MatchedUser[] = validMatches.slice(0, 3);
    
    console.log(`After match quality filter (matchCount > 1): ${validMatches.length} valid matches`);
    console.log(`Returning top ${topMatches.length} matches`);

    console.log('=== MATCHING COMPLETE ===');
    console.log(`Found ${topMatches.length} matched users (after quality filter)`);
    if (topMatches.length > 0) {
      console.log('Matched users:', topMatches.map((u: MatchedUser) => ({ 
        name: u.name, 
        match_score: u.match_score,
        matchCount: u.matchQuality?.matchCount,
        days_in_destination: u.days_in_destination,
        country_from: u.country_from
      })));
    }
    console.log('==========================');
    
    return topMatches;
  } catch (error) {
    console.error('Error in findMatchingUsers:', error);
    throw error;
  }
}

