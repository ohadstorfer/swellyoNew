// Migrate travel_experience from enum string to integer (number of trips)
// This function converts all existing travel_experience enum values to their corresponding integer values:
// - 'new_nomad' → 0 (0-3 trips)
// - 'rising_voyager' → 4 (4-9 trips)
// - 'wave_hunter' → 10 (10-19 trips)
// - 'chicken_joe' → 20 (20+ trips)
//
// IMPORTANT: Before running this function, you must update the database schema to change
// the travel_experience column from ENUM to INTEGER. Run this SQL in Supabase SQL Editor:
//
// ALTER TABLE surfers 
// ALTER COLUMN travel_experience TYPE integer 
// USING CASE 
//   WHEN travel_experience::text = 'new_nomad' THEN 0
//   WHEN travel_experience::text = 'rising_voyager' THEN 4
//   WHEN travel_experience::text = 'wave_hunter' THEN 10
//   WHEN travel_experience::text = 'chicken_joe' THEN 20
//   ELSE NULL
// END;

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Mapping from enum string to integer (number of trips)
    const travelExperienceMap: { [key: string]: number } = {
      'new_nomad': 0,        // 0-3 trips → use 0 as default
      'rising_voyager': 4,   // 4-9 trips → use 4 as default
      'wave_hunter': 10,     // 10-19 trips → use 10 as default
      'chicken_joe': 20,     // 20+ trips → use 20 as default
    };

    console.log('Starting travel_experience migration...');

    // Fetch all surfers with travel_experience that is a string (enum format)
    const { data: surfers, error: fetchError } = await supabase
      .from('surfers')
      .select('user_id, travel_experience')
      .not('travel_experience', 'is', null);

    if (fetchError) {
      console.error('Error fetching surfers:', fetchError);
      throw fetchError;
    }

    if (!surfers || surfers.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No surfers found with travel_experience to migrate',
          migrated: 0 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    console.log(`Found ${surfers.length} surfers to check`);

    let migratedCount = 0;
    let skippedCount = 0;
    const errors: Array<{ user_id: string; error: string }> = [];

    // Process each surfer
    for (const surfer of surfers) {
      const travelExp = surfer.travel_experience;

      // Skip if already a number (already migrated)
      if (typeof travelExp === 'number') {
        skippedCount++;
        continue;
      }

      // Skip if not a string (unexpected type)
      if (typeof travelExp !== 'string') {
        console.warn(`Unexpected travel_experience type for user ${surfer.user_id}: ${typeof travelExp}`);
        skippedCount++;
        continue;
      }

      // Convert enum string to integer
      const travelExpLower = travelExp.toLowerCase();
      const tripsNumber = travelExperienceMap[travelExpLower];

      if (tripsNumber === undefined) {
        console.warn(`Unknown travel_experience value: ${travelExp} for user ${surfer.user_id}`);
        errors.push({ 
          user_id: surfer.user_id, 
          error: `Unknown travel_experience value: ${travelExp}` 
        });
        skippedCount++;
        continue;
      }

      // Update the surfer record
      const { error: updateError } = await supabase
        .from('surfers')
        .update({ travel_experience: tripsNumber })
        .eq('user_id', surfer.user_id);

      if (updateError) {
        console.error(`Error updating user ${surfer.user_id}:`, updateError);
        errors.push({ 
          user_id: surfer.user_id, 
          error: updateError.message 
        });
      } else {
        migratedCount++;
        console.log(`Migrated user ${surfer.user_id}: ${travelExp} → ${tripsNumber}`);
      }
    }

    const result = {
      success: true,
      message: `Migration completed`,
      total: surfers.length,
      migrated: migratedCount,
      skipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log('Migration summary:', result);

    return new Response(
      JSON.stringify(result),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error: any) {
    console.error('Migration error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error occurred' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

