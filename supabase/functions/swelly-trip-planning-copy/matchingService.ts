/**
 * Matching Service (root copy for bundler) - Server-Side V3 Algorithm
 */
import { MatchResult } from './types.ts';
import { getPreviouslyMatchedUserIds } from './databaseService.ts';
import { buildSurferQuery, filterExcludedUsersInMemory } from './filterService.ts';
import {
  determineIntent,
  normalizeDestination,
  destinationMatches,
  hasRequestedAreaInArray,
  NormalizedDestination
} from './destinationUtils.ts';
import {
  checkLayer1HardRequirements,
  checkLayer2InferredConstraints,
  calculateLayer3PriorityScore,
  calculateLayer4GeneralScore,
} from './scoringUtils.ts';

export async function findMatchingUsersV3Server(
  request: any,
  requestingUserId: string,
  chatId: string,
  supabaseAdmin: any
): Promise<MatchResult[]> {
  console.log('[matchingService] === FINDING MATCHING USERS V3 (SERVER-SIDE) ===');
  console.log('[matchingService] Request:', JSON.stringify(request, null, 2));
  console.log('[matchingService] Requesting User ID:', requestingUserId);
  console.log('[matchingService] Chat ID:', chatId);

  if (!request.destination_country) {
    throw new Error('V3 algorithm requires destination_country');
  }

  try {
    const excludedUserIds = await getPreviouslyMatchedUserIds(chatId, supabaseAdmin);
    console.log(`[matchingService] Excluding ${excludedUserIds.length} previously matched users`);

    const intent = determineIntent(request);
    console.log('[matchingService] Determined intent:', intent);

    const normalizedDest = await normalizeDestination(request, intent);
    console.log('[matchingService] Normalized destination:', normalizedDest);

    const { data: currentUserSurfer, error: currentUserError } = await supabaseAdmin
      .from('surfers')
      .select('*')
      .eq('user_id', requestingUserId)
      .single();

    if (currentUserError || !currentUserSurfer) {
      throw new Error('Current user profile not found');
    }

    const query = buildSurferQuery(request, requestingUserId, excludedUserIds, supabaseAdmin);
    const { data: allSurfers, error: queryError } = await query;

    if (queryError) {
      throw new Error(`Error querying surfers: ${queryError.message}`);
    }

    if (!allSurfers || allSurfers.length === 0) {
      console.log('[matchingService] No surfers found in database');
      return [];
    }

    console.log(`[matchingService] Found ${allSurfers.length} total surfers from query`);

    const filteredSurfers = filterExcludedUsersInMemory(allSurfers, excludedUserIds);
    console.log(`[matchingService] After exclusion filter: ${filteredSurfers.length} surfers`);

    console.log('[matchingService] Filtering surfers by destination country...');
    const countryMatchedSurfers: Array<{
      surfer: any;
      hasAreaMatch: boolean;
      daysInDestination: number;
      bestMatch: {
        countryMatch: boolean;
        areaMatch: boolean;
        townMatch: boolean;
        matchedAreas: any[];
        matchedTowns: string[];
      };
    }> = [];

    const requestedArea = request.area || null;

    for (const userSurfer of filteredSurfers) {
      let daysInDestination = 0;
      let bestMatch: {
        countryMatch: boolean;
        areaMatch: boolean;
        townMatch: boolean;
        matchedAreas: any[];
        matchedTowns: string[];
      } | null = null;
      let hasAreaMatch = false;

      if (userSurfer.destinations_array && userSurfer.destinations_array.length > 0) {
        for (const dest of userSurfer.destinations_array) {
          const destForMatch = 'country' in dest ? dest : (dest as any).destination_name || '';
          const match = destinationMatches(destForMatch, normalizedDest);

          if (match.countryMatch) {
            daysInDestination += dest.time_in_days || 0;

            if (requestedArea) {
              if (hasRequestedAreaInArray(dest, requestedArea)) {
                hasAreaMatch = true;
              }
            }

            if (!bestMatch ||
                (match.areaMatch && !bestMatch.areaMatch) ||
                (match.townMatch && !bestMatch.townMatch)) {
              bestMatch = match;
            }
          }
        }
      }

      if (!bestMatch || !bestMatch.countryMatch || daysInDestination === 0) {
        continue;
      }

      countryMatchedSurfers.push({
        surfer: userSurfer,
        hasAreaMatch,
        daysInDestination,
        bestMatch,
      });
    }

    console.log(`[matchingService] Found ${countryMatchedSurfers.length} surfers with matching country`);

    const matchingResults: Array<{
      user_id: string;
      surfer: any;
      passedLayer1: boolean;
      passedLayer2: boolean;
      priorityScore: number;
      generalScore: number;
      totalScore: number;
      matchedAreas: string[];
      matchedTowns: string[];
      commonLifestyleKeywords: string[];
      commonWaveKeywords: string[];
      daysInDestination: number;
      bestMatch: any;
    }> = [];

    for (const { surfer: userSurfer, hasAreaMatch, daysInDestination, bestMatch } of countryMatchedSurfers) {
      const layer1Result = checkLayer1HardRequirements(userSurfer, request, normalizedDest);
      if (!layer1Result.passed) {
        continue;
      }

      const layer2Result = await checkLayer2InferredConstraints(
        userSurfer,
        request,
        intent,
        currentUserSurfer
      );
      if (!layer2Result.passed) {
        continue;
      }

      const priorityScore = calculateLayer3PriorityScore(
        userSurfer,
        request,
        intent,
        currentUserSurfer
      );

      const layer4Result = calculateLayer4GeneralScore(
        userSurfer,
        request,
        intent,
        currentUserSurfer,
        bestMatch,
        daysInDestination
      );

      const areaPriorityBoost = hasAreaMatch ? 1000 : 0;
      const totalScore = priorityScore + layer4Result.score + areaPriorityBoost;

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
        bestMatch,
      });
    }

    matchingResults.sort((a, b) => b.totalScore - a.totalScore);

    console.log(`[matchingService] Found ${matchingResults.length} valid matches`);

    const matchResults: MatchResult[] = matchingResults.map(result => ({
      user_id: result.user_id,
      name: result.surfer.name || 'User',
      profile_image_url: result.surfer.profile_image_url || null,
      match_score: result.totalScore,
      priority_score: result.priorityScore,
      general_score: result.generalScore,
      matched_areas: result.matchedAreas,
      matched_towns: result.matchedTowns,
      common_lifestyle_keywords: result.commonLifestyleKeywords,
      common_wave_keywords: result.commonWaveKeywords,
      surfboard_type: result.surfer.surfboard_type,
      surf_level: result.surfer.surf_level,
      travel_experience: result.surfer.travel_experience?.toString(),
      country_from: result.surfer.country_from,
      age: result.surfer.age,
      days_in_destination: result.daysInDestination,
      destinations_array: result.surfer.destinations_array,
      match_quality: {
        matchCount: 1,
        countryMatch: result.bestMatch.countryMatch,
        areaMatch: result.bestMatch.areaMatch,
        townMatch: result.bestMatch.townMatch,
      },
    }));

    console.log('[matchingService] === MATCHING V3 COMPLETE ===');
    return matchResults;
  } catch (error) {
    console.error('[matchingService] Error in findMatchingUsersV3Server:', error);
    throw error;
  }
}
