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
 * Check if destination matches any of the requested countries (handles comma-separated strings)
 * This is a convenience function that splits comma-separated country strings and checks each one
 */
function destinationMatchesAnyCountry(
  destination: { country: string; area: string[] } | { destination_name: string } | string | null | undefined,
  requestedCountries: string | null | undefined
): boolean {
  if (!destination || !requestedCountries) {
    return false;
  }
  
  // Split comma-separated countries into array
  const countries = requestedCountries
    .split(',')
    .map(c => c.trim())
    .filter(c => c.length > 0);
  
  // Check if destination matches ANY of the requested countries
  return countries.some(country => 
    destinationContainsCountry(destination, country)
  );
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
        destinationMatchesAnyCountry(dest, request.destination_country)
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
          destinationMatchesAnyCountry(dest, request.destination_country)
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
          if (destinationMatchesAnyCountry(dest, request.destination_country)) {
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
    let surfersFilteredByDestination: SupabaseSurfer[] = []; // Track surfers filtered out by destination
    
    // Only filter by destination if destination_country is provided
    // NOTE: destination_country is NOT required - users can request surfers without a destination
    if (request.destination_country) {
      console.log(`Filtering by destination: ${request.destination_country}`);
      
      // Split comma-separated countries for logging
      const requestedCountries = request.destination_country
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);
      console.log(`Split into countries:`, requestedCountries);
      
      // Debug: Log sample destination data from first few surfers
      if (filteredSurfers.length > 0) {
        console.log(`Sample destination data from first 3 surfers:`);
        filteredSurfers.slice(0, 3).forEach((surfer: any, idx: number) => {
          if (surfer.destinations_array && Array.isArray(surfer.destinations_array)) {
            const dests = surfer.destinations_array.map((d: any) => {
              if (typeof d === 'object' && 'country' in d) {
                return `{country: "${d.country}", area: [${(d.area || []).join(', ')}]}`;
              } else if (typeof d === 'object' && 'destination_name' in d) {
                return `{destination_name: "${d.destination_name}"}`;
              }
              return String(d);
            }).join('; ');
            console.log(`  Surfer ${idx + 1} (${surfer.name}): [${dests}]`);
          } else {
            console.log(`  Surfer ${idx + 1} (${surfer.name}): no destinations_array`);
          }
        });
      }
      
      // Track surfers that passed other filters but don't have the destination
      surfersFilteredByDestination = filteredSurfers.filter((surfer: any) => {
        if (!surfer.destinations_array || !Array.isArray(surfer.destinations_array)) {
          return true; // This surfer doesn't have the destination
        }
        const hasMatch = surfer.destinations_array.some((dest: any) => 
          destinationMatchesAnyCountry(dest, request.destination_country)
        );
        if (!hasMatch) {
          // Debug: log what destinations this surfer has
          const surferDestinations = surfer.destinations_array.map((d: any) => {
            if (typeof d === 'object' && 'country' in d) {
              return d.country;
            } else if (typeof d === 'object' && 'destination_name' in d) {
              return d.destination_name;
            }
            return String(d);
          }).join(', ');
          console.log(`  ❌ ${surfer.name} (${surfer.country_from}) - no destination match. Has: [${surferDestinations}]`);
        }
        return !hasMatch;
      }) as SupabaseSurfer[];
      
      surfersWithDestination = filteredSurfers.filter((surfer: any) => {
        if (!surfer.destinations_array || !Array.isArray(surfer.destinations_array)) {
          return false;
        }
        const hasMatch = surfer.destinations_array.some((dest: any) => 
          destinationMatchesAnyCountry(dest, request.destination_country)
        );
        if (hasMatch) {
          console.log(`  ✅ ${surfer.name} (${surfer.country_from}) - destination match found`);
        }
        return hasMatch;
      });
      console.log(`Filtered to ${surfersWithDestination.length} surfers with matching destinations (from ${filteredSurfers.length} total)`);
      if (surfersWithDestination.length === 0 && filteredSurfers.length > 0) {
        console.log(`⚠️ All ${filteredSurfers.length} surfers were filtered out by destination requirement`);
      }
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
          destinationMatchesAnyCountry(dest, request.destination_country)
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
          if (destinationMatchesAnyCountry(dest, request.destination_country)) {
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
              destinationMatchesAnyCountry(dest, request.destination_country!)
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
    
    // Store rejected matches for analysis (if no valid matches found)
    const rejectedMatches = hasCriteria && validMatches.length === 0
      ? matchedUsersWithQuality.filter(u => u.matchQuality && u.matchQuality.matchCount <= 1)
      : [];
    
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
    
    // Create a result object to store metadata (even if topMatches is empty)
    const result = topMatches as any;
    
    // Store rejected matches and destination-filtered surfers in the return value for analysis if needed
    if (rejectedMatches.length > 0) {
      result.__rejectedMatches = rejectedMatches;
      console.log(`  📊 Stored ${rejectedMatches.length} rejected matches for analysis`);
    }
    // Store surfers that passed other filters but were filtered out by destination
    if (surfersWithDestination.length === 0 && filteredSurfers.length > 0 && request.destination_country) {
      result.__destinationFilteredSurfers = surfersFilteredByDestination;
      result.__passedOtherFilters = filteredSurfers.length;
      console.log(`  📊 Stored ${surfersFilteredByDestination.length} destination-filtered surfers for analysis (${filteredSurfers.length} passed other filters)`);
    }
    

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
    
    // Log metadata for debugging
    if ((result as any).__destinationFilteredSurfers) {
      console.log(`📊 Metadata stored: ${(result as any).__destinationFilteredSurfers.length} destination-filtered surfers, ${(result as any).__passedOtherFilters} passed other filters`);
    }
    if ((result as any).__rejectedMatches) {
      console.log(`📊 Metadata stored: ${(result as any).__rejectedMatches.length} rejected matches`);
    }
    
    console.log('==========================');
    
    return result;
  } catch (error) {
    console.error('Error in findMatchingUsers:', error);
    throw error;
  }
}

/**
 * Analyze why no matches were found and generate a helpful explanation
 * Uses the existing match quality analysis from the matching process
 * This is more efficient and accurate than querying the database again
 */
export function analyzeNoMatchesReason(
  request: TripPlanningRequest,
  rejectedMatches: MatchedUser[], // Matches that were found but filtered out (matchCount <= 1)
  destinationFilteredSurfers?: SupabaseSurfer[], // Surfers that passed other filters but don't have the destination
  passedOtherFiltersCount?: number // Count of surfers that passed other filters
): string {
  try {
    // Case 2: Surfers passed other filters but were filtered out by destination
    if (destinationFilteredSurfers && destinationFilteredSurfers.length > 0 && request.destination_country) {
      const requestedCountries = request.destination_country
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);
      
      const countriesStr = requestedCountries.length === 1 
        ? requestedCountries[0] 
        : `any of those countries (${requestedCountries.slice(0, 3).join(', ')}${requestedCountries.length > 3 ? '...' : ''})`;
      
      // Check if any of the filtered surfers are from the requested countries
      const hasCountryFromMatch = destinationFilteredSurfers.some((surfer: any) => {
        const requestedCountriesFrom = request.non_negotiable_criteria?.country_from || 
                                       request.queryFilters?.country_from || null;
        if (!requestedCountriesFrom || !surfer.country_from) return false;
        const userCountry = surfer.country_from.toLowerCase();
        return requestedCountriesFrom.some(
          c => userCountry.includes(c.toLowerCase()) || c.toLowerCase().includes(userCountry)
        );
      });
      
      let message = `Hey, I found ${passedOtherFiltersCount || destinationFilteredSurfers.length} surfer${passedOtherFiltersCount !== 1 ? 's' : ''} that match your other criteria (age, board type, country), but none of them have surfed in ${countriesStr}`;
      
      if (hasCountryFromMatch) {
        const countryFrom = request.non_negotiable_criteria?.country_from || request.queryFilters?.country_from || [];
        const countryStr = Array.isArray(countryFrom) && countryFrom.length === 1 ? countryFrom[0] : 'those countries';
        message += `. I do have surfers from ${countryStr}, but they haven't surfed there yet`;
      }
      
      message += `. Try searching for surfers who have surfed in ${requestedCountries[0]} or other destinations, or remove the destination requirement`;
      
      return message;
    }
    
    // Case 2: No rejected matches to analyze
    if (!rejectedMatches || rejectedMatches.length === 0) {
      return "Couldn't find any matches right now, but more surfers are joining every day. Check back soon!";
    }
    
    const reasons: string[] = [];
    const suggestions: string[] = [];
    
    // Analyze which criteria failed across all rejected matches
    // Count how many matches failed each criterion
    const failedCriteria: { [key: string]: { count: number; details: any } } = {};
    
    rejectedMatches.forEach(match => {
      if (!match.matchQuality) return;
      
      const { matchedCriteria, differences, missingData } = match.matchQuality;
      
      // Check destination_country
      if (request.destination_country && matchedCriteria.destination_country === false) {
        if (!failedCriteria.destination_country) {
          failedCriteria.destination_country = { count: 0, details: null };
        }
        failedCriteria.destination_country.count++;
      }
      
      // Check area (if requested)
      if (request.area && request.destination_country && matchedCriteria.area === false) {
        if (!failedCriteria.area) {
          failedCriteria.area = { count: 0, details: differences.area };
        }
        failedCriteria.area.count++;
      }
      
      // Check country_from
      if (matchedCriteria.country_from === false) {
        if (!failedCriteria.country_from) {
          failedCriteria.country_from = { count: 0, details: differences.country_from };
        }
        failedCriteria.country_from.count++;
      }
      
      // Check age
      if (matchedCriteria.age === false) {
        if (!failedCriteria.age) {
          failedCriteria.age = { count: 0, details: differences.age };
        }
        failedCriteria.age.count++;
      }
      
      // Check surfboard_type
      if (matchedCriteria.surfboard_type === false) {
        if (!failedCriteria.surfboard_type) {
          failedCriteria.surfboard_type = { count: 0, details: differences.surfboard_type };
        }
        failedCriteria.surfboard_type.count++;
      }
      
      // Check surf_level
      if (matchedCriteria.surf_level === false) {
        if (!failedCriteria.surf_level) {
          failedCriteria.surf_level = { count: 0, details: differences.surf_level };
        }
        failedCriteria.surf_level.count++;
      }
    });
    
    // Build reasons based on failed criteria (prioritize by importance)
    // 1. Destination (most important)
    if (failedCriteria.destination_country && failedCriteria.destination_country.count === rejectedMatches.length) {
      const requestedCountries = request.destination_country
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);
      if (requestedCountries.length === 1) {
        reasons.push(`no surfers who have surfed in ${requestedCountries[0]}`);
      } else {
        reasons.push(`no surfers who have surfed in any of those countries`);
      }
    }
    
    // 2. Area (if destination was requested)
    if (request.area && request.destination_country && failedCriteria.area && failedCriteria.area.count === rejectedMatches.length) {
      reasons.push(`no surfers who have surfed in ${request.area}`);
    }
    
    // 3. Country_from
    if (failedCriteria.country_from && failedCriteria.country_from.count === rejectedMatches.length) {
      const requestedCountries = failedCriteria.country_from.details?.requested || [];
      const countriesStr = requestedCountries.length === 1 
        ? requestedCountries[0] 
        : requestedCountries.join(' or ');
      reasons.push(`no surfers from ${countriesStr}`);
    }
    
    // 4. Age
    if (failedCriteria.age && failedCriteria.age.count === rejectedMatches.length) {
      const ageDetails = failedCriteria.age.details;
      if (ageDetails && Array.isArray(ageDetails.requested) && ageDetails.requested.length === 2) {
        const [minAge, maxAge] = ageDetails.requested;
        reasons.push(`no surfers between ${minAge} and ${maxAge} years old`);
        // Find closest age from rejected matches
        const ages = rejectedMatches
          .map(m => m.age)
          .filter(a => a !== null && a !== undefined) as number[];
        if (ages.length > 0) {
          const minAvailable = Math.min(...ages);
          const maxAvailable = Math.max(...ages);
          if (minAge > maxAvailable) {
            suggestions.push(`try a lower age range (we have surfers up to ${maxAvailable} years old)`);
          } else if (maxAge < minAvailable) {
            suggestions.push(`try a higher age range (our youngest surfer is ${minAvailable} years old)`);
          } else {
            suggestions.push(`try expanding the age range (we have surfers from ${minAvailable} to ${maxAvailable} years old)`);
          }
        }
      }
    }
    
    // 5. Surfboard_type
    if (failedCriteria.surfboard_type && failedCriteria.surfboard_type.count === rejectedMatches.length) {
      const boardDetails = failedCriteria.surfboard_type.details;
      if (boardDetails) {
        const requestedBoards = Array.isArray(boardDetails.requested) 
          ? boardDetails.requested 
          : [boardDetails.requested];
        const boardTypeNames: { [key: string]: string } = {
          'shortboard': 'shortboard',
          'mid_length': 'midlength',
          'longboard': 'longboard',
          'soft_top': 'soft top',
        };
        const boardStr = requestedBoards.length === 1 
          ? (boardTypeNames[requestedBoards[0]] || requestedBoards[0])
          : requestedBoards.map((b: string) => boardTypeNames[b] || b).join(' or ');
        reasons.push(`no surfers using ${boardStr}`);
        // Find available board types from rejected matches
        const availableBoards = [...new Set(rejectedMatches
          .map(m => m.surfboard_type)
          .filter(b => b !== null && b !== undefined))] as string[];
        if (availableBoards.length > 0) {
          const boardNames = availableBoards.map((b: string) => boardTypeNames[b] || b).join(', ');
          suggestions.push(`try other board types (we have ${boardNames} surfers)`);
        }
      }
    }
    
    // 6. Surf_level
    if (failedCriteria.surf_level && failedCriteria.surf_level.count === rejectedMatches.length) {
      const levelDetails = failedCriteria.surf_level.details;
      if (levelDetails) {
        const requestedLevel = levelDetails.requested;
        const levelRange = Array.isArray(requestedLevel) 
          ? requestedLevel 
          : [requestedLevel, requestedLevel];
        const [minLevel, maxLevel] = levelRange;
        const levelNames: { [key: number]: string } = {
          1: 'beginner',
          2: 'beginner-intermediate',
          3: 'intermediate',
          4: 'intermediate-advanced',
          5: 'advanced',
        };
        const levelStr = minLevel === maxLevel 
          ? levelNames[minLevel] || `level ${minLevel}`
          : `level ${minLevel}-${maxLevel}`;
        reasons.push(`no ${levelStr} surfers`);
        // Find available levels from rejected matches
        const availableLevels = [...new Set(rejectedMatches
          .map(m => m.surf_level)
          .filter(l => l !== null && l !== undefined))] as number[];
        if (availableLevels.length > 0) {
          const minAvailable = Math.min(...availableLevels);
          const maxAvailable = Math.max(...availableLevels);
          suggestions.push(`try adjusting the skill level (we have surfers from level ${minAvailable} to ${maxAvailable})`);
        }
      }
    }
    
    // Build the message
    if (reasons.length === 0) {
      return "Couldn't find any matches right now, but more surfers are joining every day. Check back soon!";
    }
    
    let message = "Hey, I couldn't find anyone that matches your criteria because ";
    
    if (reasons.length === 1) {
      message += `there's ${reasons[0]}`;
    } else if (reasons.length === 2) {
      message += `there's ${reasons[0]} and ${reasons[1]}`;
    } else {
      message += `there's ${reasons.slice(0, -1).join(', ')}, and ${reasons[reasons.length - 1]}`;
    }
    
    if (suggestions.length > 0) {
      message += `. ${suggestions[0]}`;
    } else {
      message += `. Try relaxing some of your requirements or check back later as more surfers join!`;
    }
    
    return message;
  } catch (error) {
    console.error('Error analyzing no matches reason:', error);
    return "Couldn't find any matches right now. Try adjusting your search criteria or check back later!";
  }
}

