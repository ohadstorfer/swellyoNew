import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface ChatRequest {
  message: string
  chat_id?: string
  conversation_id?: string // Supabase conversation ID (optional)
}

interface ChatResponse {
  chat_id?: string
  return_message: string
  is_finished: boolean
  data?: any
}

const META_PROMPT = `
You are Swelly, a smart, laid-back surfer who's the ultimate go-to buddy for all things surfing and beach lifestyle. You're a cool local friend, full of knowledge about surfing destinations, techniques, and ocean safety, with insights about waves, travel tips, and coastal culture. Your tone is relaxed, friendly, and cheerful, with just the right touch of warm, uplifting energy. A sharper edge of surf-related sarcasm keeps the vibe lively and fun, like quipping about rookies wiping out or "perfect" conditions for no-shows. You're smart, resourceful, and genuinely supportive, with responses no longer than 120 words. When offering options, you keep it short with 2-3 clear choices. Responses avoid overusing words like "chill," staying vibrant and fresh, and occasionally use casual text-style abbreviations like "ngl" or "imo". Use the words dude, bro, shredder, gnarly, stoke.

YOUR GOAL: Collect the following information in a structured format. Only set is_finished: true when you have ALL required information:

1. DESTINATIONS_ARRAY (past trips): Ask for surf destinations the user has visited, and ask for how long they stayed at each (e.g., "3 weeks", "2 months", "6 months"). YOU must convert their response to approximate days (1 week = 7 days, 1 month = 30 days). Format: [{"destination_name": "Location, Area", "time_in_days": number}]

2. TRAVEL_TYPE: Ask specifically about their travel budget level. Must be one of: "budget", "mid", or "high". Ask directly: "Are you more of a budget traveler, mid-range, or high-end spender?"

3. TRAVEL_BUDDIES: Ask specifically who they travel with. Must be one of: "solo" (travels alone), "2" (travels with 1 friend/partner), or "crew" (travels with a group). Ask directly: "Do you usually travel solo, with a friend/partner, or with a crew?"

4. WAVE_TYPE_KEYWORDS: Ask about their wave preferences - size, type, conditions, etc. Extract keywords like: barrels, big waves, fast waves, small waves, mellow, reef, sand, beach break, point break, crowd preferences, etc. Return as an array of keywords.

5. LIFESTYLE_KEYWORDS: Ask about their lifestyle interests and activities outside of surfing. Extract keywords like: remote-work, party, nightlife, culture, local culture, nature, sustainability, volleyball, climbing, yoga, diving, fishing, art, music, food, exploring, adventure, mobility, etc. Return as an array of keywords.

6. FUTURE_TRIP_DESTINATIONS: Ask where they want to travel to next. Ask: "Where are you thinking of heading next? Any specific countries or regions on your radar?" Convert the response to an array of destination strings. Format destinations as "Country, Area" (e.g., "Costa Rica, Tamarindo") or just "Country" if no specific area (e.g., "Indonesia"). Can also be wider zones like "Central America". Also ask how long they plan to stay and convert to days. Format: {"destinations": ["Country, Area", ...], "time_in_days": number}

7. ONBOARDING_SUMMARY_TEXT: Generate a brief 2-3 sentence summary of their travel preferences and lifestyle based on all the information collected.

IMPORTANT COLLECTION STRATEGY:
- Ask for PAST destinations FIRST, and ask how long they stayed (e.g., "3 weeks", "2 months") - YOU convert to days
- Ask for travel budget level (budget/mid/high) as a separate, direct question
- Ask for travel companions (solo/2/crew) as a separate, direct question
- Ask for wave preferences and extract specific keywords
- Ask for lifestyle interests and extract specific keywords
- Ask for FUTURE trip destinations and duration - convert duration to days
- Only finish when you have all 7 pieces of information

Response format: Always return JSON with this structure:
{
  "return_message": "Your conversational message here",
  "is_finished": false,
  "data": null
}

When is_finished is true, the data object MUST have this exact structure:
{
  "destinations_array": [
    {"destination_name": "State/Country, Specific-area", "time_in_days": number},
    ...
  ],
  "travel_type": "budget" | "mid" | "high",
  "travel_buddies": "solo" | "2" | "crew",
  "lifestyle_keywords": ["keyword1", "keyword2", ...],
  "wave_type_keywords": ["keyword1", "keyword2", ...],
  "surf_trip_plan": {
    "destinations": ["Country, Area", "Country", "Wider Zone", ...],
    "time_in_days": number,
    "summary_text": "Brief summary of their future trip plans"
  },
  "onboarding_summary_text": "A brief 2-3 sentence summary of the user's travel preferences and lifestyle"
}

Example conversation flow:
Given context - 23 years old, Israeli, 8-10 surf trips, Charging surfer

{
    "return_message": "Which 2-3 surf zones you'd say you really know inside-out? Like towns or areas you've actually lived/surfed enough to call your stomping grounds abroad?",
    "is_finished": false,
    "data": null
}

User said:
I'd say, San Diego, south county, Sri lanka in kabalana ahangama midigama and towns around, Maldives at thulusdhoo and himmafushi

{
    "return_message": "Solid list bro, that's some tasty variety 🌊🔥
Now I need the details: how much time did you actually spend at each spot? Like for San Diego, Sri Lanka, and Maldives - how many days, weeks, or months total? This helps me understand your experience level at each place.",
    "is_finished": false,
    "data": null
}

User said:
SD - 3 weeks once, then 7 months. known a lot of locals. was this year. sri lanka - twice for a month each- winter 2023 and 2024, knows a bunch of locals. maldives 1 month

{
    "return_message": "Nice résumé, dude 👌 That's deep roots, esp. with SD locals.
Next up—what's your travel budget vibe? Are you more of a budget traveler, mid-range spender, or high-end luxury type?",
    "is_finished": false,
    "data": null
}

User said:
budget, solo or another friend, usually remote work as well, like to party, local culture, nature, etc

{
    "return_message": "Got it bro 🤙 budget shredder, mixing work, waves, and some late nights with culture + nature stoke.
Quick clarification—when you say 'solo or another friend', do you usually travel solo, with one friend/partner, or with a crew?",
    "is_finished": false,
    "data": null
}

User said:
usually just me or one friend, not a big group

{
    "return_message": "Perfect, so mostly solo or with one friend 🤙
Now wave-wise—what's your sweet spot? Talking size, reef vs sand, crowds, comfort with barrels vs mellower peelers. What kinda setups really fire you up?",
    "is_finished": false,
    "data": null
}

User said:
barrels and hard fast big waves. rather no crowd, but can surf crowds. reef and sand both work

{
    "return_message": "Hell yeah, charger vibes 🏄‍♂️💥 hunting barrels, power, and less crowd if possible, but not afraid of a packed lineup. Last piece, bro—outside the surf: any general trip must-do's or lifestyle things? (Like sustainability, local food, art, diving, community stuff, yoga, fishing, etc). What makes a trip feel complete for you?",
    "is_finished": false,
    "data": null
}

User said:
support sustainabilty, not too much on it. doing valley ball and climbing. love exploring cool spots and nature. do mobility and stretches.

{
    "return_message": "Perfect! Last question—where are you thinking of heading next? Any specific countries or regions on your radar? And how long are you planning to stay?",
    "is_finished": false,
    "data": null
}

User said:
thinking about Costa Rica, maybe Tamarindo area, or Indonesia. probably 2-3 months

{
   "return_message": "Epic, that paints the full picture 🤟 Got everything I need!",
   "is_finished": true,
   "data": {
        "destinations_array": [
          {"destination_name": "San Diego, South County", "time_in_days": 210},
          {"destination_name": "Sri Lanka, Ahangama/Kabalana/Midigama", "time_in_days": 60},
          {"destination_name": "Maldives, Thulusdhoo/Himmafushi", "time_in_days": 30}
        ],
        "travel_type": "budget",
        "travel_buddies": "2",
        "lifestyle_keywords": ["remote-work", "party", "local culture", "nature", "sustainability", "volleyball", "climbing", "exploring", "mobility"],
        "wave_type_keywords": ["barrels", "big waves", "fast waves", "low crowd", "reef", "sand"],
        "surf_trip_plan": {
          "destinations": ["Costa Rica, Tamarindo", "Indonesia"],
          "time_in_days": 75,
          "summary_text": "Planning a 2-3 month trip to Costa Rica (Tamarindo area) or Indonesia, seeking new surf experiences and adventure."
        },
        "onboarding_summary_text": "Budget traveler who typically travels solo or with one friend. Prefers barrels and big/fast waves, comfortable on both reef and sand breaks. Enjoys remote work, party scene, local culture, nature exploration, sustainability, volleyball, climbing, and mobility work."
    }
}

CRITICAL RULES:
- When asking about PAST destinations, ask for duration in natural terms (weeks, months) and YOU convert to days (1 week = 7 days, 1 month = 30 days)
- When asking about FUTURE trip destinations, ask "where do you want to travel to and for how long?" - convert duration to days
- Format future destinations as "Country, Area" (e.g., "Costa Rica, Tamarindo") or just "Country" if no area specified (e.g., "Indonesia"). Can be wider zones like "Central America"
- Ask travel_type and travel_buddies as separate, direct questions
- Extract specific keywords for lifestyle_keywords and wave_type_keywords - don't use vague descriptions
- Only set is_finished: true when you have ALL 7 pieces of information (including future trip plan)
- Always return JSON format, even when is_finished is false
`

/**
 * Transform Swelly conversation data to match database schema
 * Handles both old format (destinations, travel_style, surf_pref, extras)
 * and new structured format
 */
function transformSwellyData(data: any): any {
  // If data already has the new structure, return as-is (but ensure surf_trip_plan exists)
  if (data.destinations_array && data.travel_type && data.travel_buddies) {
    // Ensure surf_trip_plan exists
    if (!data.surf_trip_plan) {
      data.surf_trip_plan = null
    }
    return data
  }

  // Transform from old format to new format
  const result: any = {}

  // Parse destinations string into destinations_array
  if (data.destinations) {
    result.destinations_array = parseDestinations(data.destinations)
  } else if (data.destinations_array) {
    result.destinations_array = data.destinations_array
  }

  // Parse travel_style into travel_type and travel_buddies
  if (data.travel_style) {
    const travelStyle = data.travel_style.toLowerCase()
    
    // Extract travel_type
    if (travelStyle.includes('budget')) {
      result.travel_type = 'budget'
    } else if (travelStyle.includes('mid') || travelStyle.includes('medium')) {
      result.travel_type = 'mid'
    } else if (travelStyle.includes('high') || travelStyle.includes('luxury')) {
      result.travel_type = 'high'
    }

    // Extract travel_buddies
    if (travelStyle.includes('solo')) {
      result.travel_buddies = 'solo'
    } else if (travelStyle.includes('crew') || travelStyle.includes('group')) {
      result.travel_buddies = 'crew'
    } else if (travelStyle.includes('2') || travelStyle.includes('friend') || travelStyle.includes('1 friend')) {
      result.travel_buddies = '2'
    }
  } else {
    result.travel_type = data.travel_type
    result.travel_buddies = data.travel_buddies
  }

  // Extract lifestyle keywords from extras and travel_style
  if (data.extras || data.travel_style) {
    const lifestyleText = `${data.extras || ''} ${data.travel_style || ''}`.toLowerCase()
    result.lifestyle_keywords = extractKeywords(lifestyleText, [
      'remote-work', 'remote work', 'work', 'party', 'nightlife', 'culture', 'local culture',
      'nature', 'sustainability', 'eco', 'volleyball', 'climbing', 'yoga', 'diving',
      'fishing', 'art', 'music', 'food', 'exploring', 'adventure', 'mobility', 'stretches'
    ])
  } else if (data.lifestyle_keywords) {
    result.lifestyle_keywords = data.lifestyle_keywords
  }

  // Extract wave type keywords from surf_pref
  if (data.surf_pref) {
    const surfPref = data.surf_pref.toLowerCase()
    result.wave_type_keywords = extractKeywords(surfPref, [
      'barrels', 'barrel', 'big waves', 'big', 'fast waves', 'fast', 'power',
      'small waves', 'small', 'mellow', 'peelers', 'reef', 'sand', 'beach break',
      'point break', 'crowd', 'crowds', 'uncrowded', 'empty'
    ])
  } else if (data.wave_type_keywords) {
    result.wave_type_keywords = data.wave_type_keywords
  }

  // Handle surf_trip_plan (future trip destinations)
  if (data.surf_trip_plan) {
    result.surf_trip_plan = data.surf_trip_plan
  } else {
    // If not provided, set to null
    result.surf_trip_plan = null
  }

  // Create onboarding summary text
  if (data.onboarding_summary_text) {
    result.onboarding_summary_text = data.onboarding_summary_text
  } else {
    // Generate summary from available data
    const parts: string[] = []
    if (result.travel_type) parts.push(`${result.travel_type} traveler`)
    if (result.travel_buddies) parts.push(`travels ${result.travel_buddies === '2' ? 'with 1 friend' : result.travel_buddies}`)
    if (data.surf_pref) parts.push(`prefers ${data.surf_pref}`)
    if (data.extras) parts.push(`enjoys ${data.extras}`)
    result.onboarding_summary_text = parts.length > 0 ? parts.join('. ') + '.' : null
  }

  return result
}

/**
 * Parse destinations string into structured array
 * Example: "San Diego (7mo), Sri Lanka (2x 1mo)" 
 * -> [{destination_name: "San Diego", time_in_days: 210}, ...]
 */
function parseDestinations(destinationsStr: string): Array<{ destination_name: string; time_in_days: number }> {
  const result: Array<{ destination_name: string; time_in_days: number }> = []
  
  // Split by common separators (comma, semicolon, "and")
  const parts = destinationsStr.split(/[,;]| and /i).map(s => s.trim()).filter(s => s)
  
  for (const part of parts) {
    // Extract destination name and time
    // Patterns: "San Diego (7mo)", "Sri Lanka (2x 1mo)", "Maldives 1 month"
    const timeMatch = part.match(/(\d+)\s*(mo|month|months|week|weeks|day|days)/i)
    const multiplierMatch = part.match(/(\d+)x|twice|thrice/i)
    
    let timeInDays = 30 // Default to 1 month
    
    if (timeMatch) {
      let days = parseInt(timeMatch[1])
      const unit = timeMatch[2].toLowerCase()
      
      if (unit.includes('mo') || unit.includes('month')) {
        days = days * 30
      } else if (unit.includes('week')) {
        days = days * 7
      }
      
      if (multiplierMatch) {
        const multiplier = multiplierMatch[0].includes('twice') ? 2 : 
                          multiplierMatch[0].includes('thrice') ? 3 :
                          parseInt(multiplierMatch[1]) || 1
        days = days * multiplier
      }
      
      timeInDays = days
    }
    
    // Extract destination name (remove time info)
    let destinationName = part
      .replace(/\([^)]*\)/g, '') // Remove parentheses
      .replace(/\d+\s*(mo|month|months|week|weeks|day|days)/gi, '') // Remove time
      .replace(/\d+x|twice|thrice/gi, '') // Remove multipliers
      .trim()
    
    if (destinationName) {
      result.push({
        destination_name: destinationName,
        time_in_days: timeInDays
      })
    }
  }
  
  return result.length > 0 ? result : [{ destination_name: destinationsStr, time_in_days: 30 }]
}

/**
 * Extract keywords from text based on a list of possible keywords
 */
function extractKeywords(text: string, possibleKeywords: string[]): string[] {
  const found: string[] = []
  const lowerText = text.toLowerCase()
  
  for (const keyword of possibleKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      found.push(keyword)
    }
  }
  
  return found
}

async function getChatHistory(chatId: string, supabase: any): Promise<any[]> {
  try {
    // Try to get chat history from database
    const { data, error } = await supabase
      .from('swelly_chat_history')
      .select('messages')
      .eq('chat_id', chatId)
      .single()

    if (error || !data) {
      return []
    }

    return data.messages || []
  } catch (error) {
    console.error('Error fetching chat history:', error)
    return []
  }
}

async function saveChatHistory(chatId: string, messages: any[], userId: string | null, conversationId: string | null, supabase: any): Promise<void> {
  try {
    const { error } = await supabase
      .from('swelly_chat_history')
      .upsert({
        chat_id: chatId,
        user_id: userId,
        conversation_id: conversationId,
        messages: messages,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'chat_id'
      })

    if (error) {
      console.error('Error saving chat history:', error)
    }
  } catch (error) {
    console.error('Error saving chat history:', error)
  }
}

async function callOpenAI(messages: any[]): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const requestBody = {
    // Use a model that supports JSON mode
    // gpt-4 (base) doesn't support response_format: json_object
    // Options: gpt-4o, gpt-4-turbo, gpt-4-0125-preview, gpt-3.5-turbo-1106
    model: 'gpt-5.2',
    messages: messages,
    temperature: 0.7,
    max_completion_tokens: 1000,
    response_format: { type: 'json_object' },
  }

  console.log('Sending request to OpenAI:', JSON.stringify(requestBody, null, 2))

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('OpenAI API error:', response.status, response.statusText, errorText)
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`)
  }

  const data = await response.json()
  console.log('OpenAI API response:', JSON.stringify(data, null, 2))
  
  const assistantMessage = data.choices[0]?.message?.content || ''
  console.log('Extracted assistant message:', assistantMessage)
  
  return assistantMessage
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { 
          status: 401, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      )
    }

    // Initialize Supabase client with service role for admin operations
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Get user from auth token
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication token' }),
        { 
          status: 401, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      )
    }

    const url = new URL(req.url)
    const path = url.pathname

    // Route: POST /swelly-chat/new_chat
    if (path.endsWith('/new_chat') && req.method === 'POST') {
      const body: ChatRequest = await req.json()
      
      // Generate chat ID
      const chatId = crypto.randomUUID()
      
      // Initialize chat history
      const messages = [
        { role: 'system', content: META_PROMPT },
        { role: 'user', content: body.message }
      ]

      // Call OpenAI
      const assistantMessage = await callOpenAI(messages)
      messages.push({ role: 'assistant', content: assistantMessage })

      // Save to database
      await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)

      // Parse JSON response and transform data structure if finished
      let parsedResponse: ChatResponse
      try {
        console.log('Raw assistant message:', assistantMessage)
        const parsed = JSON.parse(assistantMessage)
        console.log('Parsed JSON from ChatGPT:', JSON.stringify(parsed, null, 2))
        
        // Transform data structure if conversation is finished
        let transformedData = parsed.data || null
        if (parsed.is_finished && parsed.data) {
          console.log('Conversation finished. Original data:', JSON.stringify(parsed.data, null, 2))
          transformedData = transformSwellyData(parsed.data)
          console.log('Transformed data:', JSON.stringify(transformedData, null, 2))
        }
        
        parsedResponse = {
          chat_id: chatId,
          return_message: parsed.return_message || assistantMessage,
          is_finished: parsed.is_finished || false,
          data: transformedData
        }
        
        console.log('Final response being sent:', JSON.stringify(parsedResponse, null, 2))
      } catch (parseError) {
        console.error('Error parsing JSON from ChatGPT:', parseError)
        console.log('Raw message that failed to parse:', assistantMessage)
        parsedResponse = {
          chat_id: chatId,
          return_message: assistantMessage,
          is_finished: false,
          data: null
        }
      }

      return new Response(
        JSON.stringify(parsedResponse),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Route: POST /swelly-chat/continue/:chat_id
    if (path.includes('/continue/') && req.method === 'POST') {
      const chatId = path.split('/continue/')[1]
      const body: ChatRequest = await req.json()

      if (!chatId) {
        return new Response(
          JSON.stringify({ error: 'Missing chat_id' }),
          { 
            status: 400, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            } 
          }
        )
      }

      // Get existing chat history
      let messages = await getChatHistory(chatId, supabaseAdmin)
      
      if (messages.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Chat not found' }),
          { 
            status: 404, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            } 
          }
        )
      }

      // Add new user message
      messages.push({ role: 'user', content: body.message })

      // Call OpenAI
      const assistantMessage = await callOpenAI(messages)
      messages.push({ role: 'assistant', content: assistantMessage })

      // Save to database
      await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)

      // Parse JSON response and transform data structure if finished
      let parsedResponse: ChatResponse
      try {
        console.log('Raw assistant message (continue):', assistantMessage)
        const parsed = JSON.parse(assistantMessage)
        console.log('Parsed JSON from ChatGPT (continue):', JSON.stringify(parsed, null, 2))
        
        // Transform data structure if conversation is finished
        let transformedData = parsed.data || null
        if (parsed.is_finished && parsed.data) {
          console.log('Conversation finished (continue). Original data:', JSON.stringify(parsed.data, null, 2))
          transformedData = transformSwellyData(parsed.data)
          console.log('Transformed data (continue):', JSON.stringify(transformedData, null, 2))
        }
        
        parsedResponse = {
          return_message: parsed.return_message || assistantMessage,
          is_finished: parsed.is_finished || false,
          data: transformedData
        }
        
        console.log('Final response being sent (continue):', JSON.stringify(parsedResponse, null, 2))
      } catch (parseError) {
        console.error('Error parsing JSON from ChatGPT (continue):', parseError)
        console.log('Raw message that failed to parse (continue):', assistantMessage)
        parsedResponse = {
          return_message: assistantMessage,
          is_finished: false,
          data: null
        }
      }

      return new Response(
        JSON.stringify(parsedResponse),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Route: GET /swelly-chat/:chat_id
    const chatIdMatch = path.match(/\/([^/]+)$/)
    if (chatIdMatch && req.method === 'GET' && !path.endsWith('/health')) {
      const chatId = chatIdMatch[1]

      if (!chatId) {
        return new Response(
          JSON.stringify({ error: 'Missing chat_id' }),
          { 
            status: 400, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            } 
          }
        )
      }

      const messages = await getChatHistory(chatId, supabaseAdmin)

      if (messages.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Chat not found' }),
          { 
            status: 404, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            } 
          }
        )
      }

      return new Response(
        JSON.stringify({ chat_id: chatId, messages }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Health check
    if (path.endsWith('/health') || path === '/swelly-chat' || path.endsWith('/swelly-chat')) {
      return new Response(
        JSON.stringify({ status: 'healthy', message: 'Swelly API is running' }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { 
        status: 404, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
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



