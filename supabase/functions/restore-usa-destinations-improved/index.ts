import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  // California
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
  
  // Hawaii
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
  
  // Florida
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
  
  // North Carolina
  'Wilmington': 'North Carolina',
  'Nags Head': 'North Carolina',
  'Kill Devil Hills': 'North Carolina',
  'Kitty Hawk': 'North Carolina',
  'Hatteras': 'North Carolina',
  'Buxton': 'North Carolina',
  
  // South Carolina
  'Charleston': 'South Carolina',
  'Folly Beach': 'South Carolina',
  'Myrtle Beach': 'South Carolina',
  
  // New Jersey
  'Asbury Park': 'New Jersey',
  'Belmar': 'New Jersey',
  'Manasquan': 'New Jersey',
  'Long Beach': 'New Jersey',
  'Cape May': 'New Jersey',
  
  // New York
  'Montauk': 'New York',
  'Long Beach': 'New York',
  'Rockaway Beach': 'New York',
  
  // Oregon
  'Seaside': 'Oregon',
  'Cannon Beach': 'Oregon',
  'Pacific City': 'Oregon',
  'Newport': 'Oregon',
  
  // Washington
  'Westport': 'Washington',
  'La Push': 'Washington',
  
  // Texas
  'South Padre Island': 'Texas',
  'Corpus Christi': 'Texas',
  'Galveston': 'Texas',
  'Port Aransas': 'Texas',
  
  // Rhode Island
  'Narragansett': 'Rhode Island',
  
  // Massachusetts
  'Nantucket': 'Massachusetts',
  'Martha\'s Vineyard': 'Massachusetts',
  'Cape Cod': 'Massachusetts'
}

// Famous surf spots mapped to their states
const US_SURF_SPOTS: Record<string, string> = {
  // Hawaii
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
  
  // California
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
  'Malibu': 'California',
  'Surfrider Beach': 'California',
  'Zuma Beach': 'California',
  'El Porto': 'California',
  'Manhattan Beach': 'California',
  'Hermosa Beach': 'California',
  'The Wedge': 'California',
  'Salt Creek': 'California',
  'San Onofre': 'California',
  'Oceanside Pier': 'California',
  'Huntington Pier': 'California',
  
  // Florida
  'Sebastian Inlet': 'Florida',
  'First Peak': 'Florida',
  'Monster Hole': 'Florida',
  
  // North Carolina
  'Cape Hatteras': 'North Carolina',
  'Outer Banks': 'North Carolina',
  
  // New Jersey
  'Manasquan Inlet': 'New Jersey',
  
  // New York
  'Ditch Plains': 'New York',
  
  // Oregon
  'Nelscott Reef': 'Oregon'
}

// Regional nicknames mapped to states
const US_REGIONS: Record<string, string> = {
  'OBX': 'North Carolina',
  'Outer Banks': 'North Carolina',
  'SoCal': 'California',
  'NorCal': 'California',
  'North Shore': 'Hawaii',
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
 * Extract US state/location from conversation messages with multi-layered detection
 */
function extractUSLocation(messages: Message[]): { location: string; areas: string[] } | null {
  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => m.content)
    .join(' ')

  // Layer 1: Check for explicit state mentions
  for (const state of US_STATES) {
    const stateRegex = new RegExp(`\\b${state}\\b`, 'gi')
    if (stateRegex.test(conversationText)) {
      return { location: state, areas: [] }
    }
  }

  // Layer 2: Check for surf spot mentions and infer state
  for (const [spot, state] of Object.entries(US_SURF_SPOTS)) {
    const spotRegex = new RegExp(`\\b${spot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    if (spotRegex.test(conversationText)) {
      return { location: state, areas: [spot] }
    }
  }

  // Layer 3: Check for city mentions and infer state
  for (const [city, state] of Object.entries(US_SURF_CITIES)) {
    const cityRegex = new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    if (cityRegex.test(conversationText)) {
      return { location: state, areas: [city] }
    }
  }

  // Layer 4: Check for regional nicknames and infer state
  for (const [region, state] of Object.entries(US_REGIONS)) {
    const regionRegex = new RegExp(`\\b${region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    if (regionRegex.test(conversationText)) {
      return { location: state, areas: [region] }
    }
  }

  // Layer 5: If USA mentioned but no specific location, return generic
  const hasUSAMention = USA_PATTERNS.some(pattern => pattern.test(conversationText))
  if (hasUSAMention) {
    return { location: 'United States', areas: [] }
  }

  return null
}

/**
 * Check if conversation mentions USA surfing with better context detection
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

/**
 * Estimate time spent with improved parsing
 */
function estimateTimeInDays(messages: Message[]): { days: number; text: string } {
  const conversationText = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => m.content)
    .join(' ')

  // Try to extract time mentions
  const patterns = [
    { regex: /(\d+)\s*(year|years|yr|yrs)/gi, multiplier: 365 },
    { regex: /(\d+)\s*(month|months|mo|mos)/gi, multiplier: 30 },
    { regex: /(\d+)\s*(week|weeks|wk|wks)/gi, multiplier: 7 },
    { regex: /(\d+)\s*(day|days)/gi, multiplier: 1 },
    { regex: /a\s+couple\s+(of\s+)?(month|months)/gi, value: 60, text: '2 months' },
    { regex: /a\s+few\s+(month|months)/gi, value: 90, text: '3 months' },
    { regex: /half\s+a\s+year/gi, value: 180, text: '6 months' },
    { regex: /a\s+year/gi, value: 365, text: '1 year' }
  ]

  for (const pattern of patterns) {
    if ('value' in pattern) {
      if (pattern.regex.test(conversationText)) {
        return { days: pattern.value, text: pattern.text }
      }
    } else {
      const match = pattern.regex.exec(conversationText)
      if (match) {
        const num = parseInt(match[1])
        const days = num * pattern.multiplier
        const unit = match[2].toLowerCase()
        const unitText = num === 1 
          ? unit.replace(/s$/, '') 
          : unit.endsWith('s') ? unit : unit + 's'
        return { days, text: `${num} ${unitText}` }
      }
    }
  }

  // Default to 1 week
  return { days: 7, text: '1 week' }
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

    console.log('🔍 Starting improved USA destination recovery process...')

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
      specific_states_found: 0,
      generic_usa_added: 0,
      users_updated: 0,
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

        // Extract US location (state/city/spot or generic USA)
        const locationData = extractUSLocation(messages)
        
        if (!locationData) {
          console.log(`⚠️ USA mentioned but could not extract location for user ${chat.user_id}`)
          results.details.push({
            user_id: chat.user_id,
            status: 'usa_mentioned_no_extraction',
            message: 'USA mentioned but extraction failed'
          })
          continue
        }

        const { location, areas } = locationData
        console.log(`📍 Extracted location: ${location} (areas: ${areas.join(', ')}) for user ${chat.user_id}`)

        // Track if this is a specific state or generic USA
        if (location === 'United States') {
          results.generic_usa_added++
        } else {
          results.specific_states_found++
        }

        // Estimate time spent
        const { days: timeInDays, text: timeInText } = estimateTimeInDays(messages)

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

        // Step 4: Check for duplicates
        const currentDestinations = (surferData.destinations_array || []) as Destination[]
        
        // Check if location already exists (case-insensitive)
        const hasLocation = currentDestinations.some(
          d => d.country.toLowerCase() === location.toLowerCase()
        )

        // If adding generic "United States", check if any specific US state exists
        if (location === 'United States') {
          const hasSpecificUSState = currentDestinations.some(d => 
            US_STATES.some(state => state.toLowerCase() === d.country.toLowerCase())
          )
          
          if (hasSpecificUSState) {
            console.log(`ℹ️ User ${chat.user_id} already has specific US state, skipping generic USA`)
            results.details.push({
              user_id: chat.user_id,
              status: 'has_specific_state',
              location: location,
              message: 'User already has specific US state destination'
            })
            continue
          }
        }

        if (hasLocation) {
          console.log(`ℹ️ User ${chat.user_id} already has ${location} in destinations`)
          results.details.push({
            user_id: chat.user_id,
            status: 'already_exists',
            location: location
          })
          continue
        }

        // Step 5: Add new destination
        const newDestination: Destination = {
          country: location,
          area: areas,
          time_in_days: timeInDays,
          time_in_text: timeInText
        }

        const updatedDestinations = [...currentDestinations, newDestination]

        // Step 6: Update surfer record
        const { error: updateError } = await supabaseAdmin
          .from('surfers')
          .update({ destinations_array: updatedDestinations })
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
          areas: areas,
          time_in_days: timeInDays,
          time_in_text: timeInText
        })

        console.log(`✅ Updated user ${chat.user_id} with ${location} destination`)

      } catch (error) {
        console.error(`Error processing chat for user ${chat.user_id}:`, error)
        results.errors.push(`User ${chat.user_id}: ${error.message}`)
      }
    }

    console.log('🎉 USA destination recovery complete!')
    console.log(`📊 Results: ${results.users_updated} users updated out of ${results.usa_mentions_found} USA mentions found`)
    console.log(`   - Specific states: ${results.specific_states_found}`)
    console.log(`   - Generic USA: ${results.generic_usa_added}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'USA destination recovery completed',
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
    console.error('Error in USA destination recovery:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
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

