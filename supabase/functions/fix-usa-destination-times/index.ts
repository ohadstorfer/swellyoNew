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

// All 50 US states
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming', 'Puerto Rico', 'Virgin Islands'
]

// Major surf cities mapped to their states
const US_SURF_CITIES: Record<string, string> = {
  'San Diego': 'California',
  'Santa Cruz': 'California',
  'Huntington Beach': 'California',
  'Los Angeles': 'California',
  'Malibu': 'California',
  'Santa Barbara': 'California',
  'Ventura': 'California',
  'San Francisco': 'California',
  'Half Moon Bay': 'California',
  'Pacifica': 'California',
  'Oceanside': 'California',
  'Encinitas': 'California',
  'Carlsbad': 'California',
  'Newport Beach': 'California',
  'Laguna Beach': 'California',
  'Manhattan Beach': 'California',
  'Hermosa Beach': 'California',
  'Redondo Beach': 'California',
  'Pismo Beach': 'California',
  'Monterey': 'California',
  'Carmel': 'California',
  'Honolulu': 'Hawaii',
  'Waikiki': 'Hawaii',
  'Haleiwa': 'Hawaii',
  'Waialua': 'Hawaii',
  'Lahaina': 'Hawaii',
  'Kihei': 'Hawaii',
  'Hanalei': 'Hawaii',
  'Poipu': 'Hawaii',
  'Kailua': 'Hawaii',
  'Kona': 'Hawaii',
  'Miami': 'Florida',
  'Cocoa Beach': 'Florida',
  'New Smyrna Beach': 'Florida',
  'Jacksonville': 'Florida',
  'Daytona Beach': 'Florida',
  'West Palm Beach': 'Florida',
  'Fort Lauderdale': 'Florida',
  'Melbourne': 'Florida',
  'Satellite Beach': 'Florida',
  'Indialantic': 'Florida',
  'Wilmington': 'North Carolina',
  'Nags Head': 'North Carolina',
  'Kill Devil Hills': 'North Carolina',
  'Kitty Hawk': 'North Carolina',
  'Hatteras': 'North Carolina',
  'Buxton': 'North Carolina',
  'Charleston': 'South Carolina',
  'Folly Beach': 'South Carolina',
  'Myrtle Beach': 'South Carolina',
  'Asbury Park': 'New Jersey',
  'Belmar': 'New Jersey',
  'Manasquan': 'New Jersey',
  'Long Beach': 'New Jersey',
  'Cape May': 'New Jersey',
  'Montauk': 'New York',
  'Rockaway Beach': 'New York',
  'Seaside': 'Oregon',
  'Cannon Beach': 'Oregon',
  'Pacific City': 'Oregon',
  'Newport': 'Oregon',
  'Westport': 'Washington',
  'La Push': 'Washington',
  'South Padre Island': 'Texas',
  'Corpus Christi': 'Texas',
  'Galveston': 'Texas',
  'Port Aransas': 'Texas',
  'Narragansett': 'Rhode Island',
  'Nantucket': 'Massachusetts',
  'Martha\'s Vineyard': 'Massachusetts',
  'Cape Cod': 'Massachusetts'
}

// Famous surf spots mapped to their states
const US_SURF_SPOTS: Record<string, string> = {
  'Pipeline': 'Hawaii',
  'Banzai Pipeline': 'Hawaii',
  'Waimea Bay': 'Hawaii',
  'Sunset Beach': 'Hawaii',
  'North Shore': 'Hawaii',
  'Backdoor': 'Hawaii',
  'Off The Wall': 'Hawaii',
  'Rocky Point': 'Hawaii',
  'Velzyland': 'Hawaii',
  'Haleiwa': 'Hawaii',
  'Laniakea': 'Hawaii',
  'Chuns Reef': 'Hawaii',
  'Jaws': 'Hawaii',
  'Peahi': 'Hawaii',
  'Honolua Bay': 'Hawaii',
  'Hookipa': 'Hawaii',
  'Mavericks': 'California',
  'Rincon': 'California',
  'Trestles': 'California',
  'Lowers': 'California',
  'Uppers': 'California',
  'Swamis': 'California',
  'Blacks Beach': 'California',
  'Windansea': 'California',
  'La Jolla Shores': 'California',
  'Cardiff Reef': 'California',
  'Tourmaline': 'California',
  'Steamer Lane': 'California',
  'Pleasure Point': 'California',
  'Surfrider Beach': 'California',
  'Zuma Beach': 'California',
  'El Porto': 'California',
  'The Wedge': 'California',
  'Salt Creek': 'California',
  'San Onofre': 'California',
  'Oceanside Pier': 'California',
  'Huntington Pier': 'California',
  'Sebastian Inlet': 'Florida',
  'First Peak': 'Florida',
  'Monster Hole': 'Florida',
  'Cape Hatteras': 'North Carolina',
  'Outer Banks': 'North Carolina',
  'Manasquan Inlet': 'New Jersey',
  'Ditch Plains': 'New York',
  'Nelscott Reef': 'Oregon'
}

// Regional nicknames mapped to states
const US_REGIONS: Record<string, string> = {
  'OBX': 'North Carolina',
  'Outer Banks': 'North Carolina',
  'SoCal': 'California',
  'NorCal': 'California',
  'South Bay': 'California',
  'Orange County': 'California',
  'OC': 'California',
  'San Diego County': 'California',
  'South County': 'California',
  'Space Coast': 'Florida',
  'Treasure Coast': 'Florida',
  'Gold Coast': 'Florida',
  'Emerald Coast': 'Florida',
  'Jersey Shore': 'New Jersey',
  'The Hamptons': 'New York',
  'Long Island': 'New York',
  'Cape Cod': 'Massachusetts',
  'The Cape': 'Massachusetts'
}

// Patterns to detect USA mentions
const USA_PATTERNS = [
  /\b(USA|U\.S\.A\.|United States|US|U\.S\.|America|the States|Estados Unidos|Estados Unidos de America|EE\.?\s*UU\.?)\b/gi
]

/**
 * Extract US state/location from conversation
 */
function extractUSLocation(conversationText: string): string | null {
  // Check for explicit state mentions
  for (const state of US_STATES) {
    const stateRegex = new RegExp(`\\b${state}\\b`, 'gi')
    if (stateRegex.test(conversationText)) {
      return state
    }
  }

  // Check for surf spot mentions and infer state
  for (const [spot, state] of Object.entries(US_SURF_SPOTS)) {
    const spotRegex = new RegExp(`\\b${spot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    if (spotRegex.test(conversationText)) {
      return state
    }
  }

  // Check for city mentions and infer state
  for (const [city, state] of Object.entries(US_SURF_CITIES)) {
    const cityRegex = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    if (cityRegex.test(conversationText)) {
      return state
    }
  }

  // Check for regional nicknames and infer state
  for (const [region, state] of Object.entries(US_REGIONS)) {
    const regionRegex = new RegExp(`\\b${region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    if (regionRegex.test(conversationText)) {
      return state
    }
  }

  // Check if USA mentioned but no specific location
  const hasUSAMention = USA_PATTERNS.some(pattern => pattern.test(conversationText))
  if (hasUSAMention) {
    return 'United States'
  }

  return null
}

/**
 * Extract time duration using ChatGPT API for intelligent extraction
 * Follows the same time conversion rules as swelly-chat onboarding
 */
async function extractTimeWithAI(
  messages: Message[],
  location: string
): Promise<{ days: number; text: string } | null> {
  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set')
    return null
  }

  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role}: ${m.content}`)
    .join('\n')

  const prompt = `You are analyzing a surf trip onboarding conversation to extract the exact time duration a user spent in a specific USA location.

LOCATION TO EXTRACT TIME FOR: ${location}

CONVERSATION:
${conversationText}

TASK: Extract the time duration the user mentioned spending at ${location}.

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
- If multiple trips to ${location} are mentioned, sum the total time
- If no time is mentioned for ${location}, return null
- Be smart about context - match the time to the correct location
- Look for phrases like "spent X in ${location}", "lived in ${location} for X", "${location} for X"

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
    console.error(`Error extracting time with AI for ${location}:`, error)
    return null
  }
}

/**
 * Check if conversation mentions USA surfing
 */
function mentionsUSASurfing(messages: Message[]): boolean {
  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => m.content)
    .join(' ')

  // Check if USA or US location is mentioned
  const hasUSAMention = USA_PATTERNS.some(pattern => pattern.test(conversationText))
  const hasUSLocation = US_STATES.some(state => {
    const stateRegex = new RegExp(`\\b${state}\\b`, 'gi')
    return stateRegex.test(conversationText)
  })
  const hasUSCity = Object.keys(US_SURF_CITIES).some(city => {
    const cityRegex = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    return cityRegex.test(conversationText)
  })
  const hasUSSpot = Object.keys(US_SURF_SPOTS).some(spot => {
    const spotRegex = new RegExp(`\\b${spot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    return spotRegex.test(conversationText)
  })

  if (!hasUSAMention && !hasUSLocation && !hasUSCity && !hasUSSpot) {
    return false
  }

  // Check for surf-specific context
  const surfContextPatterns = [
    /\b(surf|surfed|surfing|wave|waves|beach|destination|travel|trip|stayed|lived|visited|went to)\b/gi
  ]
  const hasSurfContext = surfContextPatterns.some(pattern => pattern.test(conversationText))

  return hasSurfContext
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

    console.log('🔍 Starting USA destination time fix process (AI-powered)...')

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
      usa_mentions_found: 0,
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
        
        // Check if conversation mentions USA surfing
        if (!mentionsUSASurfing(messages)) {
          continue
        }

        results.usa_mentions_found++
        console.log(`✅ Found USA mention for user ${chat.user_id}`)

        const conversationText = messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => m.content)
          .join(' ')

        // Extract US location
        const location = extractUSLocation(conversationText)
        
        if (!location) {
          console.log(`⚠️ Could not extract location for user ${chat.user_id}`)
          continue
        }

        console.log(`📍 Extracted location: ${location} for user ${chat.user_id}`)

        // Extract time spent from conversation using AI
        const extractedTime = await extractTimeWithAI(messages, location)
        
        if (!extractedTime) {
          console.log(`⚠️ Could not extract time for ${location} for user ${chat.user_id}`)
          results.details.push({
            user_id: chat.user_id,
            status: 'no_time_found',
            location: location,
            message: 'AI could not extract time from conversation'
          })
          continue
        }

        console.log(`⏱️ Extracted time: ${extractedTime.text} (${extractedTime.days} days) for ${location}`)

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

        // Step 4: Find the destination in the array
        // Handle both old format (state in country field) and new format (state field with country: "USA")
        const currentDestinations = (surferData.destinations_array || []) as (Destination & { state?: string })[]
        
        const locationLower = location.toLowerCase()
        const isUSALocation = location === 'United States' || location === 'USA'
        
        const destinationIndex = currentDestinations.findIndex(d => {
          const countryLower = d.country.toLowerCase()
          const stateLower = (d as any).state?.toLowerCase() || ''
          
          // Direct country match
          if (countryLower === locationLower) {
            return true
          }
          
          // If looking for a US state, check if it's in the state field
          if (stateLower && stateLower === locationLower) {
            return true
          }
          
          // If looking for "United States" or "USA", match any USA destination
          if (isUSALocation && (
            countryLower === 'usa' || 
            countryLower === 'united states' ||
            countryLower === 'us' ||
            US_STATES.some(state => state.toLowerCase() === countryLower)
          )) {
            return true
          }
          
          return false
        })

        if (destinationIndex === -1) {
          console.log(`ℹ️ User ${chat.user_id} doesn't have ${location} in destinations_array`)
          results.no_existing_destination++
          results.details.push({
            user_id: chat.user_id,
            status: 'no_existing_destination',
            location: location,
            extracted_time: extractedTime,
            message: 'Location not found in destinations_array'
          })
          continue
        }

        const existingDestination = currentDestinations[destinationIndex]
        
        // Step 5: Compare times
        const timeDifference = Math.abs(existingDestination.time_in_days - extractedTime.days)
        
        // If times match (within 1 day tolerance), skip
        if (timeDifference <= 1) {
          console.log(`✓ Time matches for ${location} (user ${chat.user_id})`)
          results.details.push({
            user_id: chat.user_id,
            status: 'time_matches',
            location: location,
            existing_time: existingDestination.time_in_days,
            extracted_time: extractedTime.days
          })
          continue
        }

        // Step 6: Time mismatch found - update it
        results.mismatches_found++
        console.log(`⚠️ Time mismatch for ${location} (user ${chat.user_id}):`)
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
          location: location,
          old_time_in_days: existingDestination.time_in_days,
          old_time_in_text: existingDestination.time_in_text,
          new_time_in_days: extractedTime.days,
          new_time_in_text: extractedTime.text,
          difference_days: timeDifference
        })

        console.log(`✅ Updated time for ${location} (user ${chat.user_id})`)

      } catch (error) {
        console.error(`Error processing chat for user ${chat.user_id}:`, error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        results.errors.push(`User ${chat.user_id}: ${errorMessage}`)
      }
    }

    console.log('🎉 USA destination time fix complete!')
    console.log(`📊 Results:`)
    console.log(`   - Total checked: ${results.total_checked}`)
    console.log(`   - USA mentions found: ${results.usa_mentions_found}`)
    console.log(`   - Mismatches found: ${results.mismatches_found}`)
    console.log(`   - Users updated: ${results.users_updated}`)
    console.log(`   - No existing destination: ${results.no_existing_destination}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'USA destination time fix completed',
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
    console.error('Error in USA destination time fix:', error)
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

