import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// ==========================================
// 🔧 MANUAL TESTING MODE
// ==========================================
// Set this to true to use the hardcoded user_id below instead of request body
const MANUAL_MODE = false

// 🔧 EDIT THIS LINE - PUT YOUR USER ID HERE FOR TESTING:
const MANUAL_USER_ID = 'paste-your-user-uuid-here'

// 🔧 BATCH MODE - Process ALL users with onboarding chats
const BATCH_MODE = false
// ==========================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatResponse {
  return_message: string
  is_finished: boolean
  data?: {
    destinations_array?: Array<{
      country: string
      state?: string  // Only for USA destinations
      area: string[]
      time_in_days: number
      time_in_text?: string
    }>
    travel_type?: string
    travel_buddies?: string
    lifestyle_keywords?: string[]
    wave_type_keywords?: string[]
    onboarding_summary_text?: string
  }
}

interface RequestBody {
  user_id: string
}

// Process a single user
async function processSingleUser(user_id: string, supabaseAdmin: any) {
  // Find onboarding chat for this user
  const { data: allChats, error: chatError } = await supabaseAdmin
    .from('swelly_chat_history')
    .select('chat_id, messages, created_at, conversation_type')
    .eq('user_id', user_id)
    .eq('conversation_type', 'onboarding')
    .order('created_at', { ascending: true })

  if (chatError || !allChats || allChats.length === 0) {
    console.error('❌ No onboarding chat found:', chatError)
    return new Response(
      JSON.stringify({
        success: false,
        error: 'No onboarding chat found for this user',
        user_id,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  console.log(`✅ Found ${allChats.length} onboarding chat(s) for user`)

  // Search through onboarding chats to find the completion message with destinations_array
  let destinations_array = null
  let found_finished = false
  let foundInChatId = null

  for (const chat of allChats) {
    const messages: Message[] = chat.messages || []
    console.log(`📝 Checking chat ${chat.chat_id} with ${messages.length} messages`)

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]

      if (message.role === 'assistant') {
        try {
          const parsedContent: ChatResponse = JSON.parse(message.content)

          // Look for the onboarding completion message with destinations_array
          if (
            parsedContent.is_finished === true &&
            parsedContent.data?.destinations_array &&
            Array.isArray(parsedContent.data.destinations_array) &&
            parsedContent.data.destinations_array.length > 0
          ) {
            // Use the destinations_array directly from the message (includes time_in_text)
            destinations_array = parsedContent.data.destinations_array
            found_finished = true
            foundInChatId = chat.chat_id
            console.log(`✅ Found onboarding completion at message ${i}`)
            console.log(`📍 Destinations:`, JSON.stringify(destinations_array, null, 2))
            break
          }
        } catch (e) {
          continue
        }
      }
    }

    if (found_finished) break
  }

  if (!found_finished || !destinations_array) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'No completed onboarding with destinations_array found',
        user_id,
        chats_checked: allChats.length,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (destinations_array.length === 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'destinations_array is empty',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Update the surfers table
  const { error: updateError } = await supabaseAdmin
    .from('surfers')
    .update({
      destinations_array: destinations_array,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user_id)

  if (updateError) {
    console.error('❌ Failed to update surfers table:', updateError)
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to update destinations_array',
        details: updateError.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  console.log(`✅ Updated ${destinations_array.length} destinations for user ${user_id}`)

  return new Response(
    JSON.stringify({
      success: true,
      user_id,
      chat_id: foundInChatId,
      destinations_count: destinations_array.length,
      destinations_array,
      message: 'Successfully updated destinations_array from onboarding chat',
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
}

// Process all users in batch mode
async function processBatchMode(supabaseAdmin: any) {
  console.log('================================================')
  console.log('🚀 BATCH MODE: Processing ALL users')
  console.log('================================================')

  // Get all unique user IDs from surfers table
  const { data: surfers, error: surfersError } = await supabaseAdmin
    .from('surfers')
    .select('user_id, name')
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

  console.log(`📋 Found ${surfers.length} surfers to process`)

  const results = []
  let successCount = 0
  let failCount = 0
  let skipCount = 0

  for (const surfer of surfers) {
    const user_id = surfer.user_id
    const name = surfer.name || 'Unknown'
    
    console.log(`\n🔍 Processing: ${name} (${user_id})`)

    try {
      // Find onboarding chat for this user
      const { data: allChats, error: chatError } = await supabaseAdmin
        .from('swelly_chat_history')
        .select('chat_id, messages, created_at, conversation_type')
        .eq('user_id', user_id)
        .eq('conversation_type', 'onboarding')
        .order('created_at', { ascending: true })

      if (chatError || !allChats || allChats.length === 0) {
        console.log(`⏭️  No onboarding chat found, skipping`)
        results.push({ user_id, name, status: 'skipped', reason: 'No onboarding chat found' })
        skipCount++
        continue
      }

      // Search through onboarding chats to find completion message with destinations_array
      let destinations_array = null
      let found_finished = false
      let foundInChatId = null

      for (const chat of allChats) {
        const messages: Message[] = chat.messages || []

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i]

          if (message.role === 'assistant') {
            try {
              const parsedContent: ChatResponse = JSON.parse(message.content)

              if (
                parsedContent.is_finished === true &&
                parsedContent.data?.destinations_array &&
                Array.isArray(parsedContent.data.destinations_array) &&
                parsedContent.data.destinations_array.length > 0
              ) {
                // Use the destinations_array directly from the message (includes time_in_text)
                destinations_array = parsedContent.data.destinations_array
                found_finished = true
                foundInChatId = chat.chat_id
                break
              }
            } catch (e) {
              continue
            }
          }
        }

        if (found_finished) break
      }

      if (!found_finished || !destinations_array) {
        console.log(`⏭️  No completed onboarding found, skipping`)
        results.push({ user_id, name, status: 'skipped', reason: 'No completed onboarding with destinations' })
        skipCount++
        continue
      }

      // Update the surfers table
      const { error: updateError } = await supabaseAdmin
        .from('surfers')
        .update({
          destinations_array: destinations_array,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user_id)

      if (updateError) {
        console.error(`❌ Update failed: ${updateError.message}`)
        results.push({ user_id, name, status: 'failed', error: updateError.message })
        failCount++
        continue
      }

      console.log(`✅ Updated ${destinations_array.length} destinations`)
      results.push({ 
        user_id, 
        name, 
        status: 'success', 
        destinations_count: destinations_array.length,
        chat_id: foundInChatId,
      })
      successCount++

    } catch (error: any) {
      console.error(`❌ Error processing user: ${error.message}`)
      results.push({ user_id, name, status: 'error', error: error.message })
      failCount++
    }
  }

  console.log('\n================================================')
  console.log('📊 BATCH PROCESSING COMPLETE')
  console.log('================================================')
  console.log(`✅ Success: ${successCount}`)
  console.log(`❌ Failed: ${failCount}`)
  console.log(`⏭️  Skipped: ${skipCount}`)
  console.log(`📋 Total: ${surfers.length}`)
  console.log('================================================')

  return new Response(
    JSON.stringify({
      success: true,
      batch_mode: true,
      summary: {
        total: surfers.length,
        success: successCount,
        failed: failCount,
        skipped: skipCount,
      },
      results,
      message: 'Batch processing complete',
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
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

    // Determine which mode we're in
    if (BATCH_MODE) {
      console.log('🔧 BATCH MODE ENABLED - Processing ALL users with onboarding chats')
      return await processBatchMode(supabaseAdmin)
    }

    // Get user_id from manual mode or request body
    let user_id: string

    if (MANUAL_MODE) {
      user_id = MANUAL_USER_ID
      console.log('🔧 MANUAL MODE ENABLED - Using hardcoded user_id:', user_id)
    } else {
      // Parse request body
      const body: RequestBody = await req.json()
      user_id = body.user_id

      if (!user_id) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'user_id is required in request body',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        )
      }
    }

    console.log(`🔍 Processing user: ${user_id}`)

    // Process single user
    const result = await processSingleUser(user_id, supabaseAdmin)
    return result
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

