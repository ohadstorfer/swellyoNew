import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface Destination {
  country: string
  area: string[]
  time_in_days: number
  time_in_text?: string
}

// Hawaii islands
const HAWAII_ISLANDS = [
  'Oahu',
  'Maui',
  'Big Island',
  'Hawaii',
  'Kauai',
  'Molokai',
  'Lanai',
  'Niihau',
  'Kahoolawe'
]

// Hawaii cities and towns
const HAWAII_CITIES = [
  'Honolulu', 'Waikiki', 'Haleiwa', 'Waialua', 'Kailua', 'Kaneohe',
  'Pearl City', 'Ewa Beach', 'Mililani', 'Aiea', 'Wahiawa', 'Laie',
  'Lahaina', 'Kihei', 'Kahului', 'Wailuku', 'Paia', 'Makawao',
  'Haiku', 'Hana', 'Kaanapali', 'Napili', 'Kapalua',
  'Kona', 'Hilo', 'Waimea', 'Kailua-Kona', 'Captain Cook', 'Volcano', 'Pahoa',
  'Hanalei', 'Poipu', 'Princeville', 'Kapaa', 'Lihue', 'Koloa', 'Hanapepe'
]

// Famous Hawaii surf spots
const HAWAII_SURF_SPOTS = [
  'Pipeline', 'Banzai Pipeline', 'Waimea Bay', 'Sunset Beach', 'North Shore',
  'Backdoor', 'Off The Wall', 'Rocky Point', 'Velzyland', 'Laniakea',
  'Chuns Reef', 'Ala Moana', 'Diamond Head', 'Makaha', 'Yokohama Bay',
  'Jaws', 'Peahi', 'Honolua Bay', 'Hookipa', 'Ho\'okipa', 'Lahaina Breakwall',
  'Maalaea', 'Kanaha', 'Banyans', 'Kahaluu', 'Lyman\'s',
  'Hanalei Bay', 'Tunnels', 'PK\'s', 'Kealia', 'Poipu Beach'
]

// Regional nicknames for Hawaii
const HAWAII_REGIONS = [
  'North Shore', 'The North Shore', 'South Shore', 'West Side',
  'Windward Side', 'Leeward Side', 'The Big Island', 'Big Island',
  'The Garden Isle', 'Garden Isle', 'The Valley Isle', 'Valley Isle'
]

// Patterns to detect Hawaii mentions
const HAWAII_PATTERNS = [
  /\b(Hawaii|Hawai'i|Hawaiian Islands|The Islands|Aloha State)\b/gi
]

/**
 * Check if conversation mentions Hawaii surfing
 */
function mentionsHawaiiSurfing(messages: Message[]): boolean {
  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => m.content)
    .join(' ')

  // Check if Hawaii or Hawaii location is mentioned
  const hasHawaiiMention = HAWAII_PATTERNS.some(pattern => pattern.test(conversationText))
  const hasHawaiiIsland = HAWAII_ISLANDS.some(island => {
    const islandRegex = new RegExp(`\\b${island.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    return islandRegex.test(conversationText)
  })
  const hasHawaiiCity = HAWAII_CITIES.some(city => {
    const cityRegex = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    return cityRegex.test(conversationText)
  })
  const hasHawaiiSpot = HAWAII_SURF_SPOTS.some(spot => {
    const spotRegex = new RegExp(`\\b${spot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    return spotRegex.test(conversationText)
  })
  const hasHawaiiRegion = HAWAII_REGIONS.some(region => {
    const regionRegex = new RegExp(`\\b${region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    return regionRegex.test(conversationText)
  })

  if (!hasHawaiiMention && !hasHawaiiIsland && !hasHawaiiCity && !hasHawaiiSpot && !hasHawaiiRegion) {
    return false
  }

  // Check for surf-specific context
  const surfContextPatterns = [
    /\b(surf|surfed|surfing|wave|waves|beach|destination|travel|trip|stayed|lived|visited|went to)\b/gi
  ]
  const hasSurfContext = surfContextPatterns.some(pattern => pattern.test(conversationText))

  return hasSurfContext
}

/**
 * Extract time duration using ChatGPT API for intelligent extraction
 * Follows the same time conversion rules as swelly-chat onboarding
 */
async function extractTimeWithAI(
  messages: Message[]
): Promise<{ days: number; text: string } | null> {
  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set')
    return null
  }

  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role}: ${m.content}`)
    .join('\n')

  // Create comprehensive list of Hawaii-related terms
  const hawaiiTerms = [
    'Hawaii', 'Hawai\'i', 'Hawaiian Islands',
    ...HAWAII_ISLANDS,
    ...HAWAII_CITIES,
    ...HAWAII_SURF_SPOTS,
    ...HAWAII_REGIONS
  ].join(', ')

  const prompt = `You are analyzing a surf trip onboarding conversation to extract the exact time duration a user spent in Hawaii (including any Hawaiian islands, cities, or surf spots).

HAWAII-RELATED LOCATIONS TO LOOK FOR:
${hawaiiTerms}

CONVERSATION:
${conversationText}

TASK: Extract the time duration the user mentioned spending in Hawaii or any Hawaii-related location (islands like Oahu, Maui, Big Island, Kauai; cities like Honolulu, Haleiwa; surf spots like Pipeline, North Shore, etc.).

TIME CONVERSION RULES (CRITICAL):
1. Convert to days: 1 week = 7 days, 1 month = 30 days, 1 year = 365 days
2. For time_in_text formatting:
   - For durations LESS than 1 year: Use "X days", "X weeks", or "X months" (preserve user's wording)
   - For durations 1 year or MORE: ALWAYS round to years or half-years
     * "2 years and 5 months" → "2.5 years" (time_in_days: 905)
     * "2 years and 6 months" → "2.5 years" (time_in_days: 915)
     * "2 years and 9 months" → "3 years" (time_in_days: 1095)
     * "1 year and 3 months" → "1.5 years" (time_in_days: 457)
     * "3 years and 4 months" → "3.5 years" (time_in_days: 1215)
   - NEVER use "X years and Y months" format

EXAMPLES:
- "3 weeks" → {"time_in_days": 21, "time_in_text": "3 weeks"}
- "7 months" → {"time_in_days": 210, "time_in_text": "7 months"}
- "1.5 years" → {"time_in_days": 547, "time_in_text": "1.5 years"}
- "2 years and 5 months" → {"time_in_days": 905, "time_in_text": "2.5 years"}
- "a couple months" → {"time_in_days": 60, "time_in_text": "2 months"}
- "half a year" → {"time_in_days": 180, "time_in_text": "6 months"}

IMPORTANT:
- If multiple trips to Hawaii are mentioned, sum the total time
- If no time is mentioned for Hawaii, return null
- Be smart about context - look for phrases like "spent X in Hawaii", "lived in Oahu for X", "Pipeline for X"
- Hawaii can be mentioned as: Hawaii, Hawai'i, islands, Oahu, Maui, North Shore, Pipeline, etc.

Return ONLY valid JSON in this exact format:
{"time_in_days": number, "time_in_text": "formatted string"}

or if no time found:
null`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that extracts time durations from conversations. Return only valid JSON or null.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    })

    if (!response.ok) {
      console.error(`OpenAI API error: ${response.status}`)
      return null
    }

    const data = await response.json()
    const content = data.choices[0].message.content.trim()
    
    // Handle null response
    if (content === 'null' || content === '') {
      return null
    }

    // Parse JSON response
    const result = JSON.parse(content)
    
    if (result === null || !result.time_in_days || !result.time_in_text) {
      return null
    }
    
    return {
      days: result.time_in_days,
      text: result.time_in_text
    }
  } catch (error) {
    console.error('Error extracting time with AI for Hawaii:', error)
    return null
  }
}

serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'OPENAI_API_KEY is not configured'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    console.log('🔍 Starting Hawaii destination time fix process (AI-powered)...')

    // Step 1: Get all onboarding chat histories
    const { data: chatHistories, error: chatError } = await supabaseAdmin
      .from('swelly_chat_history')
      .select('chat_id, user_id, messages')
      .or('conversation_type.eq.onboarding,conversation_type.is.null')

    if (chatError) {
      console.error('Error fetching chat histories:', chatError)
      throw chatError
    }

    console.log(`📊 Found ${chatHistories?.length || 0} onboarding conversations`)

    const results = {
      total_checked: 0,
      hawaii_mentions_found: 0,
      mismatches_found: 0,
      users_updated: 0,
      no_existing_destination: 0,
      errors: [] as string[],
      details: [] as any[]
    }

    // Step 2: Process each chat history
    for (const chat of chatHistories || []) {
      results.total_checked++

      try {
        const messages = chat.messages as Message[]
        
        // Check if conversation mentions Hawaii surfing
        if (!mentionsHawaiiSurfing(messages)) {
          continue
        }

        results.hawaii_mentions_found++
        console.log(`✅ Found Hawaii mention for user ${chat.user_id}`)

        // Extract time spent from conversation using AI
        const extractedTime = await extractTimeWithAI(messages)
        
        if (!extractedTime) {
          console.log(`⚠️ Could not extract time for Hawaii for user ${chat.user_id}`)
          results.details.push({
            user_id: chat.user_id,
            status: 'no_time_found',
            location: 'Hawaii',
            message: 'AI could not extract time from conversation'
          })
          continue
        }

        console.log(`⏱️ Extracted time: ${extractedTime.text} (${extractedTime.days} days) for Hawaii`)

        // Step 3: Get current surfer data
        const { data: surferData, error: surferError } = await supabaseAdmin
          .from('surfers')
          .select('user_id, destinations_array')
          .eq('user_id', chat.user_id)
          .single()

        if (surferError) {
          console.error(`Error fetching surfer data for ${chat.user_id}:`, surferError)
          results.errors.push(`User ${chat.user_id}: ${surferError.message}`)
          continue
        }

        // Step 4: Find Hawaii in the destinations array
        const currentDestinations = (surferData.destinations_array || []) as Destination[]
        
        const destinationIndex = currentDestinations.findIndex(
          d => d.country.toLowerCase() === 'hawaii'
        )

        if (destinationIndex === -1) {
          console.log(`ℹ️ User ${chat.user_id} doesn't have Hawaii in destinations_array`)
          results.no_existing_destination++
          results.details.push({
            user_id: chat.user_id,
            status: 'no_existing_destination',
            location: 'Hawaii',
            extracted_time: extractedTime,
            message: 'Hawaii not found in destinations_array'
          })
          continue
        }

        const existingDestination = currentDestinations[destinationIndex]
        
        // Step 5: Compare times
        const timeDifference = Math.abs(existingDestination.time_in_days - extractedTime.days)
        
        // If times match (within 1 day tolerance), skip
        if (timeDifference <= 1) {
          console.log(`✓ Time matches for Hawaii (user ${chat.user_id})`)
          results.details.push({
            user_id: chat.user_id,
            status: 'time_matches',
            location: 'Hawaii',
            existing_time: existingDestination.time_in_days,
            extracted_time: extractedTime.days
          })
          continue
        }

        // Step 6: Time mismatch found - update it
        results.mismatches_found++
        console.log(`⚠️ Time mismatch for Hawaii (user ${chat.user_id}):`)
        console.log(`   Existing: ${existingDestination.time_in_days} days (${existingDestination.time_in_text})`)
        console.log(`   Extracted: ${extractedTime.days} days (${extractedTime.text})`)

        // Update the destination with correct time
        currentDestinations[destinationIndex] = {
          ...existingDestination,
          time_in_days: extractedTime.days,
          time_in_text: extractedTime.text
        }

        // Step 7: Update surfer record
        const { error: updateError } = await supabaseAdmin
          .from('surfers')
          .update({ destinations_array: currentDestinations })
          .eq('user_id', chat.user_id)

        if (updateError) {
          console.error(`Error updating surfer ${chat.user_id}:`, updateError)
          results.errors.push(`User ${chat.user_id}: ${updateError.message}`)
          continue
        }

        results.users_updated++
        results.details.push({
          user_id: chat.user_id,
          status: 'updated',
          location: 'Hawaii',
          old_time_in_days: existingDestination.time_in_days,
          old_time_in_text: existingDestination.time_in_text,
          new_time_in_days: extractedTime.days,
          new_time_in_text: extractedTime.text,
          difference_days: timeDifference
        })

        console.log(`✅ Updated time for Hawaii (user ${chat.user_id})`)

      } catch (error) {
        console.error(`Error processing chat for user ${chat.user_id}:`, error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        results.errors.push(`User ${chat.user_id}: ${errorMessage}`)
      }
    }

    console.log('🎉 Hawaii destination time fix complete!')
    console.log(`📊 Results:`)
    console.log(`   - Total checked: ${results.total_checked}`)
    console.log(`   - Hawaii mentions found: ${results.hawaii_mentions_found}`)
    console.log(`   - Mismatches found: ${results.mismatches_found}`)
    console.log(`   - Users updated: ${results.users_updated}`)
    console.log(`   - No existing destination: ${results.no_existing_destination}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Hawaii destination time fix completed',
        results
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )

  } catch (error) {
    console.error('Error in Hawaii destination time fix:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  }
})




