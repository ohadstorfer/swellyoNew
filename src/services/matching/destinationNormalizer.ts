/**
 * Destination Normalizer
 * 
 * Utility functions to normalize destinations during onboarding
 * and ensure consistency with the matching algorithm.
 * 
 * Follows the hierarchy: Country > Area > Town
 */

import { AREA_OPTIONS, AreaOption } from './matchingServiceV3';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

/**
 * Normalize a destination string from onboarding
 * Converts formats like "Weligama, Sri Lanka" to normalized structure
 * 
 * @param destinationInput - Raw destination input from user (e.g., "Weligama, Sri Lanka" or "Sri Lanka, South")
 * @returns Normalized destination structure
 */
export async function normalizeOnboardingDestination(
  destinationInput: string
): Promise<{
  destination_name: string; // Format: "Country, Area, Town" or "Country, Area" or "Country"
  country: string;
  area?: AreaOption | AreaOption[];
  towns?: string[];
}> {
  if (!destinationInput || !destinationInput.trim()) {
    throw new Error('Destination input is required');
  }

  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, using fallback normalization');
    // Fallback: try to parse manually
    const parts = destinationInput.split(',').map(p => p.trim());
    return {
      destination_name: destinationInput,
      country: parts[0] || destinationInput,
      area: undefined,
      towns: parts.length > 1 ? parts.slice(1) : undefined,
    };
  }

  try {
    const prompt = `Given a destination input from a user during onboarding: "${destinationInput}"

Your task:
1. Extract the country name
2. Normalize any area/region to one or more of these fixed options: ${AREA_OPTIONS.join(', ')}
3. Extract any specific town names if mentioned
4. Return a JSON object with this structure:
{
  "country": "Country Name",
  "area": ["area_option"] or null,
  "towns": ["town1", "town2"] or null,
  "destination_name": "Country, Area, Town" (formatted string)
}

Rules:
- The destination_name should follow format: "Country, Area, Town" or "Country, Area" or just "Country"
- If area is normalized, use the fixed area options (north, south, east, west, south-west, etc.)
- If multiple areas apply, use array format: ["south-west", "south-east"]
- If no area can be determined, set area to null
- If specific towns are mentioned, extract them; otherwise set towns to null
- The destination_name should be a readable string combining all parts

Examples:
- Input: "Weligama, Sri Lanka" → {
  "country": "Sri Lanka",
  "area": ["south-west"],
  "towns": ["Weligama"],
  "destination_name": "Sri Lanka, South-West, Weligama"
}
- Input: "Sri Lanka, South" → {
  "country": "Sri Lanka",
  "area": ["south"],
  "towns": null,
  "destination_name": "Sri Lanka, South"
}
- Input: "Arugam Bay, Sri Lanka" → {
  "country": "Sri Lanka",
  "area": ["east"],
  "towns": ["Arugam Bay"],
  "destination_name": "Sri Lanka, East, Arugam Bay"
}
- Input: "Costa Rica" → {
  "country": "Costa Rica",
  "area": null,
  "towns": null,
  "destination_name": "Costa Rica"
}

Return ONLY the JSON object, no other text.`;

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
            content: 'You are a helpful assistant that returns only valid JSON objects. Do not include any explanatory text.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
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

    const parsed = JSON.parse(content);
    
    // Validate and format the response
    const country = parsed.country || destinationInput.split(',')[0]?.trim() || destinationInput;
    const area = parsed.area ? (Array.isArray(parsed.area) ? parsed.area : [parsed.area]) : null;
    const towns = parsed.towns || null;
    
    // Build destination_name
    let destinationName = country;
    if (area && area.length > 0) {
      destinationName += `, ${area.join('-')}`;
    }
    if (towns && towns.length > 0) {
      destinationName += `, ${towns.join(', ')}`;
    }

    return {
      destination_name: destinationName,
      country,
      area: area && area.length > 0 ? (area.length === 1 ? area[0] : area) : undefined,
      towns: towns && towns.length > 0 ? towns : undefined,
    };
  } catch (error) {
    console.error('Error normalizing onboarding destination:', error);
    // Fallback: return basic structure
    const parts = destinationInput.split(',').map(p => p.trim());
    return {
      destination_name: destinationInput,
      country: parts[0] || destinationInput,
      area: undefined,
      towns: parts.length > 1 ? parts.slice(1) : undefined,
    };
  }
}

/**
 * Normalize an array of destinations from onboarding
 * Processes multiple destinations and normalizes each one
 */
export async function normalizeOnboardingDestinations(
  destinations: Array<{ destination_name: string; time_in_days: number }>
): Promise<Array<{ destination_name: string; time_in_days: number }>> {
  const normalized: Array<{ destination_name: string; time_in_days: number }> = [];

  for (const dest of destinations) {
    try {
      const normalizedDest = await normalizeOnboardingDestination(dest.destination_name);
      normalized.push({
        destination_name: normalizedDest.destination_name,
        time_in_days: dest.time_in_days,
      });
    } catch (error) {
      console.error(`Error normalizing destination "${dest.destination_name}":`, error);
      // Keep original if normalization fails
      normalized.push(dest);
    }
  }

  return normalized;
}

