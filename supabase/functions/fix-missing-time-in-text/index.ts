import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Destination {
  country: string
  area: string[]
  time_in_days: number
  time_in_text?: string
}

/**
 * Helper function to convert days to time_in_text following the rules
 * 
 * RULES:
 * - For durations LESS than 1 year: Format as "X days" / "X weeks" / "X months"
 * - For durations 1 year or MORE: ALWAYS round to years or half-years
 * - NEVER use "X years and Y months" format - always round to nearest year or half-year
 * 
 * EXAMPLES:
 * - 1 day → "1 day"
 * - 5 days → "5 days"
 * - 7 days → "1 week"
 * - 14 days → "2 weeks"
 * - 21 days → "3 weeks"
 * - 30 days → "1 month"
 * - 60 days → "2 months"
 * - 180 days → "6 months"
 * - 365 days (1 year, 0 months) → "1 year"
 * - 456 days (1 year, 3 months) → "1.5 years"
 * - 547 days (1 year, 6 months) → "1.5 years"
 * - 638 days (1 year, 9 months) → "2 years"
 * - 912 days (2 years, 6 months) → "2.5 years"
 * - 1003 days (2 years, 9 months) → "3 years"
 * - 1186 days (3 year, 3 months) → "3.5 years"
 */
function daysToTimeInText(days: number): string {
  // Rule 1: Less than 7 days - use "X days"
  if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'}`
  }
  
  // Rule 2: 7-29 days - use "X weeks"
  if (days < 30) {
    const weeks = Math.round(days / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'}`
  }
  
  // Rule 3: 30-364 days - use "X months"
  if (days < 365) {
    const months = Math.round(days / 30.44) // More accurate: 365.25/12 = 30.44
    return `${months} month${months === 1 ? '' : 's'}`
  }
  
  // Rule 4: 365+ days - ALWAYS round to years or half-years
  // Convert to total months for better accuracy
  const totalMonths = days / 30.44
  const years = Math.floor(totalMonths / 12)
  const remainingMonths = totalMonths % 12
  
  // Rounding logic:
  // 0-2 months: round down (X years)
  // 3-8 months: round to X.5 years
  // 9+ months: round up (X+1 years)
  let roundedYears: number
  
  if (remainingMonths < 3) {
    roundedYears = years
  } else if (remainingMonths <= 8) {
    roundedYears = years + 0.5
  } else {
    roundedYears = years + 1
  }
  
  // Edge case: if we somehow get 0 years (shouldn't happen with >= 365 days)
  if (roundedYears === 0) {
    roundedYears = 1
  }
  
  return `${roundedYears} year${roundedYears === 1 ? '' : 's'}`
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
    console.log('🔧 Fixing missing time_in_text in destinations_array')
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
    let noChangeCount = 0

    for (const surfer of surfers) {
      const user_id = surfer.user_id
      const name = surfer.name || 'Unknown'
      const destinations = surfer.destinations_array as Destination[]

      if (!Array.isArray(destinations) || destinations.length === 0) {
        console.log(`⏭️  ${name}: No destinations array, skipping`)
        skippedCount++
        continue
      }

      console.log(`\n🔍 Checking: ${name} (${destinations.length} destinations)`)

      // Check if any destination is missing time_in_text
      let needsUpdate = false
      let missingCount = 0
      const updatedDestinations = destinations.map((dest, index) => {
        // Validate destination has required fields
        if (!dest.country || !dest.time_in_days) {
          console.log(`  ⚠️  Destination ${index + 1}: Invalid data (missing country or time_in_days)`)
          return dest
        }
        
        if (!dest.time_in_text) {
          const generatedText = daysToTimeInText(dest.time_in_days)
          const areaText = dest.area && dest.area.length > 0 ? `, ${dest.area.join(', ')}` : ''
          console.log(`  📍 Destination ${index + 1}: ${dest.country}${areaText}`)
          console.log(`     ├─ time_in_days: ${dest.time_in_days}`)
          console.log(`     └─ Generated time_in_text: "${generatedText}"`)
          needsUpdate = true
          missingCount++
          return {
            ...dest,
            time_in_text: generatedText
          }
        } else {
          console.log(`  ✓ Destination ${index + 1}: ${dest.country} - already has time_in_text: "${dest.time_in_text}"`)
        }
        return dest
      })
      
      if (missingCount > 0) {
        console.log(`  → Found ${missingCount} destination${missingCount === 1 ? '' : 's'} missing time_in_text`)
      }

      if (!needsUpdate) {
        console.log(`  ✓ All destinations already have time_in_text`)
        noChangeCount++
        results.push({
          user_id,
          name,
          status: 'no_change',
          reason: 'All destinations have time_in_text'
        })
        continue
      }

      // Update the surfers table
      const { error: updateError } = await supabaseAdmin
        .from('surfers')
        .update({
          destinations_array: updatedDestinations,
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

      console.log(`  ✅ Updated ${missingCount} destination${missingCount === 1 ? '' : 's'} with time_in_text`)
      updatedCount++
      results.push({
        user_id,
        name,
        status: 'updated',
        destinations_count: destinations.length,
        updated_destinations: missingCount
      })
    }

    console.log('\n================================================')
    console.log('📊 PROCESSING COMPLETE')
    console.log('================================================')
    console.log(`✅ Updated: ${updatedCount}`)
    console.log(`➖ No change needed: ${noChangeCount}`)
    console.log(`⏭️  Skipped: ${skippedCount}`)
    console.log(`📋 Total: ${surfers.length}`)
    console.log('================================================')

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total: surfers.length,
          updated: updatedCount,
          no_change: noChangeCount,
          skipped: skippedCount,
        },
        results,
        message: 'Processing complete',
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

