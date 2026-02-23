/**
 * Destination Utilities
 * 
 * Handles destination normalization and matching logic
 */

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

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
 * Normalize area string to fixed area options using LLM
 */
export async function normalizeArea(
  country: string,
  areaInput: string | null | undefined,
  intent: MatchingIntent
): Promise<AreaOption[]> {
  if (!areaInput) {
    return [];
  }

  if (!OPENAI_API_KEY) {
    console.warn('[destinationUtils] OpenAI API key not configured, using fallback area normalization');
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
        temperature: 0.3,
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

    // Parse JSON response
    let areas: string[] = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        areas = parsed;
      } else if (parsed.areas && Array.isArray(parsed.areas)) {
        areas = parsed.areas;
      } else {
        const arrayValues = Object.values(parsed).find(v => Array.isArray(v));
        if (arrayValues) {
          areas = arrayValues as string[];
        }
      }
    } catch (parseError) {
      const arrayMatch = content.match(/\[.*?\]/);
      if (arrayMatch) {
        areas = JSON.parse(arrayMatch[0]);
      }
    }
    
    if (Array.isArray(areas)) {
      const validAreas = areas.filter((area: string) => 
        AREA_OPTIONS.includes(area.toLowerCase() as AreaOption)
      ).map((area: string) => area.toLowerCase() as AreaOption);
      
      return validAreas.length > 0 ? validAreas : [];
    }

    return [];
  } catch (error) {
    console.error('[destinationUtils] Error normalizing area:', error);
    return [];
  }
}

/**
 * Extract towns from area input using LLM (intent-based)
 */
export async function extractTowns(
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

    // Parse JSON response
    let towns: string[] = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        towns = parsed;
      } else if (parsed.towns && Array.isArray(parsed.towns)) {
        towns = parsed.towns;
      } else {
        const arrayValues = Object.values(parsed).find(v => Array.isArray(v));
        if (arrayValues) {
          towns = arrayValues as string[];
        }
      }
    } catch (parseError) {
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
    console.error('[destinationUtils] Error extracting towns:', error);
    return [];
  }
}

/**
 * Determine matching intent from request
 */
export function determineIntent(request: any): MatchingIntent {
  const purpose = request.purpose;
  const topics = purpose?.specific_topics || [];

  const topicsLower = topics.map((t: string) => t.toLowerCase());
  
  if (topicsLower.some((t: string) => t.includes('surf spot') || t.includes('wave') || t.includes('break'))) {
    return 'surf_spots';
  }
  
  if (topicsLower.some((t: string) => t.includes('hike') || t.includes('trail') || t.includes('walk'))) {
    return 'hikes';
  }
  
  if (topicsLower.some((t: string) => t.includes('stay') || t.includes('accommodation') || t.includes('hotel') || t.includes('hostel'))) {
    return 'stays';
  }
  
  if (topicsLower.some((t: string) => t.includes('provider') || t.includes('shop') || t.includes('rental'))) {
    return 'providers';
  }
  
  if (topicsLower.some((t: string) => t.includes('equipment') || t.includes('board') || t.includes('gear'))) {
    return 'equipment';
  }

  return 'general';
}

/**
 * Normalize destination from request
 */
export async function normalizeDestination(
  request: any,
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
 */
export function parseUserDestination(
  destination: { country: string; area: string[] } | { destination_name: string } | string
): {
  country: string;
  area?: AreaOption[];
  towns?: string[];
} {
  // Handle new structure: {country, area[]}
  if (typeof destination === 'object' && 'country' in destination) {
    const country = destination.country;
    const areas = destination.area || [];
    
    const areaParts: AreaOption[] = [];
    const townParts: string[] = [];

    for (const area of areas) {
      const areaLower = area.toLowerCase();
      const matchedArea = AREA_OPTIONS.find(opt => 
        areaLower === opt || 
        areaLower.includes(opt) || 
        opt.includes(areaLower)
      );
      
      if (matchedArea) {
        areaParts.push(matchedArea);
      } else {
        townParts.push(area);
      }
    }

    return {
      country,
      area: areaParts.length > 0 ? areaParts : undefined,
      towns: townParts.length > 0 ? townParts : undefined,
    };
  }

  // Handle legacy structure
  const destinationName = typeof destination === 'string' 
    ? destination 
    : (destination as any).destination_name || '';
  
  const parts = destinationName.split(',').map(p => p.trim());
  const country = parts[0] || '';
  
  if (parts.length === 1) {
    return { country };
  }

  const areaParts: AreaOption[] = [];
  const townParts: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    
    const matchedArea = AREA_OPTIONS.find(area => 
      part === area || 
      part.includes(area) || 
      area.includes(part)
    );
    
    if (matchedArea) {
      areaParts.push(matchedArea);
    } else {
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
 * Check if requested area/town is in user's area array
 */
export function hasRequestedAreaInArray(
  userDestination: { country: string; area: string[] } | { destination_name: string } | string,
  requestedArea: string | null | undefined
): boolean {
  if (!requestedArea) return false;
  
  if (typeof userDestination === 'object' && 'country' in userDestination) {
    const areas = userDestination.area || [];
    const requestedLower = requestedArea.toLowerCase();
    return areas.some(area => area.toLowerCase() === requestedLower || 
                              area.toLowerCase().includes(requestedLower) ||
                              requestedLower.includes(area.toLowerCase()));
  }
  
  if (typeof userDestination === 'string') {
    const parts = userDestination.split(',').map(p => p.trim());
    if (parts.length > 1) {
      const requestedLower = requestedArea.toLowerCase();
      return parts.slice(1).some(part => part.toLowerCase() === requestedLower ||
                                         part.toLowerCase().includes(requestedLower) ||
                                         requestedLower.includes(part.toLowerCase()));
    }
  }
  
  if (typeof userDestination === 'object' && 'destination_name' in userDestination) {
    const destName = (userDestination as any).destination_name || '';
    const parts = destName.split(',').map((p: string) => p.trim());
    if (parts.length > 1) {
      const requestedLower = requestedArea.toLowerCase();
      return parts.slice(1).some(part => part.toLowerCase() === requestedLower ||
                                         part.toLowerCase().includes(requestedLower) ||
                                         requestedLower.includes(part.toLowerCase()));
    }
  }
  
  return false;
}

/**
 * Check if user destination matches normalized destination
 */
export function destinationMatches(
  userDestination: { country: string; area: string[] } | { destination_name: string } | string,
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
  const requestedCountries = normalizedDest.country
    .split(',')
    .map(c => c.trim().toLowerCase())
    .filter(c => c.length > 0);
  
  const userCountryLower = userDest.country.toLowerCase().trim();
  
  const countryMatch = requestedCountries.some(reqCountry => {
    if (userCountryLower === reqCountry) {
      return true;
    }
    
    const escapedReq = reqCountry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedReq}\\b`, 'i');
    if (regex.test(userCountryLower)) {
      return true;
    }
    
    if ((reqCountry === 'usa' || reqCountry === 'united states') && 
        (userCountryLower.includes('united states') || userCountryLower.includes('usa'))) {
      return true;
    }
    if ((reqCountry === 'uk' || reqCountry === 'united kingdom') && 
        (userCountryLower.includes('united kingdom') || /\buk\b/.test(userCountryLower))) {
      return true;
    }
    
    return false;
  });
  
  if (!countryMatch) {
    return {
      countryMatch: false,
      areaMatch: false,
      townMatch: false,
      matchedAreas: [],
      matchedTowns: [],
    };
  }
  
  // Area matching
  const requestedAreas = Array.isArray(normalizedDest.area) 
    ? normalizedDest.area 
    : normalizedDest.area ? [normalizedDest.area] : [];
  const userAreas = userDest.area || [];
  
  const matchedAreas = requestedAreas.filter(reqArea => 
    userAreas.some(userArea => userArea === reqArea)
  );
  const areaMatch = matchedAreas.length > 0;
  
  // Town matching
  const requestedTowns = normalizedDest.towns || [];
  const userTowns = userDest.towns || [];
  
  const matchedTowns = requestedTowns.filter(reqTown => {
    const reqTownLower = reqTown.toLowerCase();
    return userTowns.some(userTown => 
      userTown.toLowerCase() === reqTownLower ||
      userTown.toLowerCase().includes(reqTownLower) ||
      reqTownLower.includes(userTown.toLowerCase())
    );
  });
  const townMatch = matchedTowns.length > 0;
  
  return {
    countryMatch: true,
    areaMatch,
    townMatch,
    matchedAreas,
    matchedTowns,
  };
}






