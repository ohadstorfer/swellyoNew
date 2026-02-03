import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Destination {
  country: string
  state?: string  // NEW: only populated for USA destinations
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
  'Oahu': 'Hawaii',
  'Kauai': 'Hawaii',
  'Maui': 'Hawaii',
  'Big Island': 'Hawaii',
  'Molokai': 'Hawaii',
  'Lanai': 'Hawaii',
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
  'South County': 'California',
  'Outer Banks': 'North Carolina'
}

// Helper: Check if a string is a US state (case-insensitive)
function isUSState(name: string): boolean {
  return US_STATES.some(state => state.toLowerCase() === name.toLowerCase())
}

// Helper: Get state from city/spot name (case-insensitive)
function getStateFromCity(cityName: string): string | null {
  // Clean the city name - remove parenthetical notes like "(south shore)"
  const cleanedName = cityName.replace(/\s*\([^)]*\)/g, '').trim()
  const lowerName = cleanedName.toLowerCase()
  
  // First check if it's actually a US state name
  if (isUSState(cleanedName)) {
    return cleanedName
  }
  
  // Try exact match on cleaned name in cities
  const cityKey = Object.keys(US_SURF_CITIES).find(
    key => key.toLowerCase() === lowerName
  )
  if (cityKey) return US_SURF_CITIES[cityKey]
  
  // Try exact match on cleaned name in surf spots
  const spotKey = Object.keys(US_SURF_SPOTS).find(
    key => key.toLowerCase() === lowerName
  )
  if (spotKey) return US_SURF_SPOTS[spotKey]
  
  // Try partial match - check if any city/spot name is contained in the input
  const partialCityMatch = Object.entries(US_SURF_CITIES).find(
    ([key, _]) => lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)
  )
  if (partialCityMatch) return partialCityMatch[1]
  
  const partialSpotMatch = Object.entries(US_SURF_SPOTS).find(
    ([key, _]) => lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)
  )
  if (partialSpotMatch) return partialSpotMatch[1]
  
  return null
}

// Helper: Normalize a single destination
function normalizeDestination(dest: Destination): Destination & { action: string } {
  // Validate destination has required fields
  if (!dest || !dest.country) {
    return {
      ...dest,
      country: dest?.country || 'Unknown',
      area: dest?.area || [],
      time_in_days: dest?.time_in_days || 0,
      action: 'Invalid destination - missing country field'
    }
  }
  
  const country = dest.country.trim()
  const area = dest.area || []
  
  // Skip normalization if state already exists
  if (dest.state) {
    return {
      ...dest,
      action: 'Already has state - skipped normalization'
    }
  }
  
  // Case 1: State name in country field
  if (isUSState(country)) {
    return {
      ...dest,
      country: 'USA',
      state: country,
      area: area,
      action: `Converted state "${country}" to USA with state field`
    }
  }
  
  // Case 2 & 3: Country is USA or USA variants
  const isUSACountry = ['usa', 'united states', 'us', 'u.s.', 'u.s.a.'].includes(country.toLowerCase())
  
  if (isUSACountry) {
    // Has areas - infer state from FIRST city only
    if (area.length > 0) {
      const firstCity = area[0].trim()
      const inferredState = getStateFromCity(firstCity)
      
      if (inferredState) {
        return {
          ...dest,
          country: 'USA',
          state: inferredState,
          area: area,
          action: `Inferred state "${inferredState}" from first city "${firstCity}"`
        }
      } else {
        // Unknown city - keep as generic USA
        return {
          ...dest,
          country: 'USA',
          state: undefined,
          area: area,
          action: `Unknown city "${firstCity}" - kept as generic USA`
        }
      }
    } else {
      // No areas - keep as generic USA
      return {
        ...dest,
        country: 'USA',
        state: undefined,
        area: area,
        action: 'Generic USA - no specific state'
      }
    }
  }
  
  // Not USA-related - keep unchanged
  return {
    ...dest,
    action: 'Non-USA destination - unchanged'
  }
}

// Helper: Consolidate destinations with same state
function consolidateDestinations(destinations: (Destination & { action: string })[]): Destination[] {
  const usaDestinations: Map<string, Destination> = new Map()
  const nonUsaDestinations: Destination[] = []
  
  for (const dest of destinations) {
    if (dest.country === 'USA' && dest.state) {
      const key = dest.state
      
      if (usaDestinations.has(key)) {
        // Consolidate: sum times, merge areas
        const existing = usaDestinations.get(key)!
        const mergedAreas = [...new Set([...existing.area, ...dest.area])]
        
        usaDestinations.set(key, {
          country: 'USA',
          state: dest.state,
          area: mergedAreas,
          time_in_days: existing.time_in_days + dest.time_in_days,
          time_in_text: existing.time_in_text || dest.time_in_text
        })
      } else {
        usaDestinations.set(key, {
          country: dest.country,
          state: dest.state,
          area: dest.area,
          time_in_days: dest.time_in_days,
          time_in_text: dest.time_in_text
        })
      }
    } else {
      // Non-USA or generic USA (no state) - keep as-is
      const { action, ...cleanDest } = dest
      nonUsaDestinations.push(cleanDest)
    }
  }
  
  return [...Array.from(usaDestinations.values()), ...nonUsaDestinations]
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role key for admin access
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    console.log('================================================')
    console.log('🇺🇸 Normalizing USA destinations structure')
    console.log('================================================')

    // Get all surfers with destinations_array
    const { data: surfers, error: surfersError } = await supabaseAdmin
      .from('surfers')
      .select('user_id, name, destinations_array')
      .not('destinations_array', 'is', null)
      .order('created_at', { ascending: true })

    if (surfersError || !surfers) {
      console.error('❌ Error fetching surfers:', surfersError)
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to fetch surfers',
          details: surfersError?.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    console.log(`📋 Found ${surfers.length} surfers with destinations_array`)

    const results = []
    let updatedCount = 0
    let skippedCount = 0
    let consolidatedCount = 0
    let unknownCitiesCount = 0
    const unknownCities: Set<string> = new Set()

    for (const surfer of surfers) {
      const user_id = surfer.user_id
      const name = surfer.name || 'Unknown'
      const destinations = surfer.destinations_array as Destination[]

      if (!Array.isArray(destinations) || destinations.length === 0) {
        console.log(`⏭️  ${name}: No destinations array, skipping`)
        skippedCount++
        continue
      }

      console.log(`\n🔍 Processing: ${name} (${destinations.length} destinations)`)
      console.log(`  Original destinations:`, JSON.stringify(destinations, null, 2))

      // Normalize each destination
      const normalizedWithActions = destinations.map((dest, index) => {
        // Skip invalid destinations
        if (!dest || typeof dest !== 'object') {
          console.log(`  ⚠️  Destination ${index + 1}: Invalid destination object, skipping`)
          return null
        }
        
        const normalized = normalizeDestination(dest)
        const countryDisplay = dest.country || 'Unknown'
        const areaDisplay = dest.area?.length ? `, ${dest.area.join(', ')}` : ''
        console.log(`  📍 Destination ${index + 1}: ${countryDisplay}${areaDisplay}`)
        console.log(`     └─ ${normalized.action}`)
        
        // Track unknown cities
        if (normalized.action.startsWith('Unknown city')) {
          const match = normalized.action.match(/Unknown city "([^"]+)"/)
          if (match) {
            unknownCities.add(match[1])
          }
        }
        
        return normalized
      }).filter(Boolean) as (Destination & { action: string })[]

      // Check if any USA destinations exist
      const hasUSADestinations = normalizedWithActions.some(d => d.country === 'USA')
      
      if (!hasUSADestinations) {
        console.log(`  ✓ No USA destinations to normalize`)
        skippedCount++
        results.push({
          user_id,
          name,
          status: 'skipped',
          reason: 'No USA destinations'
        })
        continue
      }

      // Consolidate destinations with same state
      const originalCount = normalizedWithActions.length
      const consolidated = consolidateDestinations(normalizedWithActions)
      const wasConsolidated = consolidated.length < originalCount
      
      console.log(`  After normalization:`, JSON.stringify(normalizedWithActions.map(d => ({ country: d.country, state: (d as any).state, area: d.area })), null, 2))
      console.log(`  After consolidation:`, JSON.stringify(consolidated.map(d => ({ country: d.country, state: (d as any).state, area: d.area, time_in_days: d.time_in_days })), null, 2))
      
      if (wasConsolidated) {
        console.log(`  🔗 Consolidated ${originalCount} → ${consolidated.length} destinations`)
        consolidatedCount++
      }

      // Update the surfers table
      const { error: updateError } = await supabaseAdmin
        .from('surfers')
        .update({
          destinations_array: consolidated,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user_id)

      if (updateError) {
        console.error(`  ❌ Update failed: ${updateError.message}`)
        results.push({
          user_id,
          name,
          status: 'failed',
          error: updateError.message
        })
        continue
      }

      console.log(`  ✅ Normalized USA destinations`)
      updatedCount++
      results.push({
        user_id,
        name,
        status: 'updated',
        original_count: originalCount,
        final_count: consolidated.length,
        consolidated: wasConsolidated
      })
    }

    unknownCitiesCount = unknownCities.size

    console.log('\n================================================')
    console.log('📊 NORMALIZATION COMPLETE')
    console.log('================================================')
    console.log(`✅ Updated: ${updatedCount}`)
    console.log(`🔗 Consolidated: ${consolidatedCount}`)
    console.log(`⚠️  Unknown cities: ${unknownCitiesCount}`)
    console.log(`⏭️  Skipped: ${skippedCount}`)
    console.log(`📋 Total: ${surfers.length}`)
    
    if (unknownCities.size > 0) {
      console.log('\n⚠️  Unknown cities requiring manual review:')
      unknownCities.forEach(city => console.log(`   - ${city}`))
    }
    
    console.log('================================================')

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total: surfers.length,
          updated: updatedCount,
          consolidated: consolidatedCount,
          unknown_cities: unknownCitiesCount,
          skipped: skippedCount,
        },
        unknown_cities: Array.from(unknownCities),
        results,
        message: 'Normalization complete',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('❌ Unexpected error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
        stack: error.stack,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})

