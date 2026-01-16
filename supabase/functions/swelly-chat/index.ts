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

IMPORTANT FORMATTING RULES:
- Keep all text clean and simple - NO markdown formatting (no **, no *, no __, no _, no #, no brackets, etc.)
- Write in plain text only - do not attempt to bold, italicize, or format text in any way
- Use emojis sparingly and naturally, but avoid markdown syntax
- Keep responses readable and conversational without any formatting codes

YOUR GOAL: Collect the following information in a structured format. Only set is_finished: true when you have ALL required information.

IMPORTANT: All questions must feel natural and conversational, like a friend asking - NOT like a form or questionnaire. Use Swelly's voice and personality. Avoid being too direct or formal. Make questions flow naturally in the conversation.

1. DESTINATIONS_ARRAY (past trips): Ask for surf destinations the user has visited, and ask for how long they stayed at each (e.g., "3 weeks", "2 months", "6 months"). YOU must:
   - Convert their response to approximate days (1 week = 7 days, 1 month = 30 days, 1 year = 365 days) and save as time_in_days
   - Extract the ORIGINAL time expression from the user's input and save as time_in_text
   - CRITICAL FORMATTING RULES FOR time_in_text:
     * For durations LESS than 1 year: Format as "X days" / "X weeks" / "X months" (preserve user's wording)
     * For durations 1 year or MORE: ALWAYS round to years or half-years (e.g., "1 year", "1.5 years", "2 years", "2.5 years", "3 years")
     * NEVER use "X years and Y months" format - always round to nearest year or half-year
     * Examples:
       - 2 years and 5 months → "2.5 years" (round 5 months to 0.5 years)
       - 2 years and 6 months → "2.5 years" (round 6 months to 0.5 years)
       - 2 years and 7 months → "2.5 years" (round 7 months to 0.5 years)
       - 2 years and 8 months → "2.5 years" (round 8 months to 0.5 years)
       - 2 years and 9 months → "3 years" (round 9 months up to next year)
       - 1 year and 3 months → "1.5 years"
       - 3 years and 2 months → "3 years" (round down)
       - 3 years and 4 months → "3.5 years" (round 4 months to 0.5 years)
   - Format: [{"country": "Country Name", "area": ["Area1", "Area2"], "time_in_days": number, "time_in_text": "X days/weeks/months/years"}]

2. TRAVEL_TYPE: Ask about their travel budget level in a natural, Swelly-style way. Must extract one of: "budget", "mid", or "high". Example: "Are you on a budget shredder, mid-range for a good amount of comfort, or looking to treat yourself well, no matter the cost?" - Keep it conversational and in Swelly's voice, not too direct.

3. TRAVEL_BUDDIES: Ask about who they travel with in a natural, Swelly-style way. Must extract one of: "solo" (travels alone), "2" (travels with 1 friend/partner), or "crew" (travels with a group). Example: "Do you usually roll solo, with a buddy or partner, or with a crew?" - Keep it conversational and in Swelly's voice, not too direct.

4. WAVE_TYPE_KEYWORDS: Ask about their wave preferences - size, type, conditions, etc. Extract keywords like: barrels, big waves, fast waves, small waves, mellow, reef, sand, beach break, point break, crowd preferences, etc. Return as an array of keywords.

5. LIFESTYLE_KEYWORDS: Ask about their lifestyle interests and activities outside of surfing. Extract keywords like: remote-work, party, nightlife, culture, local culture, nature, sustainability, volleyball, climbing, yoga, diving, fishing, art, music, food, exploring, adventure, mobility, etc. Return as an array of keywords.

6. ONBOARDING_SUMMARY_TEXT: Generate a brief 2-3 sentence summary of their travel preferences and lifestyle based on all the information collected.

IMPORTANT COLLECTION STRATEGY:
- Ask for PAST destinations FIRST, and ask how long they stayed (e.g., "3 weeks", "2 months") - YOU convert to days. Do not mention the connvertion in your question. Keep questions natural and in Swelly's voice.
- Ask for travel budget level (budget/mid/high) in a conversational, Swelly-style way - not too direct. Make it sound like a friend asking, not a form.
- Ask for travel companions (solo/2/crew) in a conversational, Swelly-style way - not too direct. Make it sound natural.
- Ask for wave preferences and extract specific keywords - keep it conversational
- Ask for lifestyle interests and extract specific keywords - keep it conversational
- Only finish when you have all 6 pieces of information
- ALL questions should feel natural and in Swelly's voice - avoid sounding like a questionnaire or form. Be conversational and friendly.

Response format: Always return JSON with this structure:
{
  "return_message": "Your conversational message here",
  "is_finished": false,
  "data": null
}

When is_finished is true, the data object MUST have this exact structure:
{
  "destinations_array": [
    {"country": "Country Name", "area": ["Area1", "Area2"], "time_in_days": number, "time_in_text": "X days/weeks/months/years"},
    ...
  ],
  "travel_type": "budget" | "mid" | "high",
  "travel_buddies": "solo" | "2" | "crew",
  "lifestyle_keywords": ["keyword1", "keyword2", ...],
  "wave_type_keywords": ["keyword1", "keyword2", ...],
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
How much time did you actually spend at each spot? Like for San Diego, Sri Lanka, and Maldives - how many days, weeks, or months total? This helps me understand your experience level at each place.",
    "is_finished": false,
    "data": null
}

User said:
SD - 3 weeks once, then 7 months. known a lot of locals. was this year. sri lanka - twice for a month each- winter 2023 and 2024, knows a bunch of locals. maldives 1 month

{
    "return_message": "Nice résumé, dude 👌 That's deep roots, esp. with SD locals.
Next up—what's your travel budget vibe? Are you on a budget shredder, mid-range for a good amount of comfort, or looking to treat yourself well, no matter the cost?",
    "is_finished": false,
    "data": null
}

User said:
budget

{
    "return_message": "Got it bro 🤙 budget shredder.
Do you usually roll solo, with a buddy or partner, or with a crew?",
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
   "return_message": "Epic, that paints the full picture 🤟 Got everything I need!",
   "is_finished": true,
   "data": {
        "destinations_array": [
          {"country": "USA", "area": ["San Diego", "South County"], "time_in_days": 210, "time_in_text": "7 months"},
          {"country": "Sri Lanka", "area": ["Ahangama", "Kabalana", "Midigama"], "time_in_days": 60, "time_in_text": "2 months"},
          {"country": "Maldives", "area": ["Thulusdhoo", "Himmafushi"], "time_in_days": 30, "time_in_text": "1 month"}
        ],
        "travel_type": "budget",
        "travel_buddies": "2",
        "lifestyle_keywords": ["remote-work", "party", "local culture", "nature", "sustainability", "volleyball", "climbing", "exploring", "mobility"],
        "wave_type_keywords": ["barrels", "big waves", "fast waves", "low crowd", "reef", "sand"],
        "onboarding_summary_text": "Budget traveler who typically travels solo or with one friend. Prefers barrels and big/fast waves, comfortable on both reef and sand breaks. Enjoys remote work, party scene, local culture, nature exploration, sustainability, volleyball, climbing, and mobility work."
    }
}

CRITICAL RULES FOR DESTINATIONS:
- When asking about PAST destinations, ask for duration in natural terms (weeks, months, years)
- YOU must convert to days (1 week = 7 days, 1 month = 30 days, 1 year = 365 days) for time_in_days
- YOU must extract and preserve the ORIGINAL time expression from the user's input for time_in_text
- CRITICAL FORMATTING RULES FOR time_in_text:
  * For durations LESS than 1 year: Format as "X days" / "X weeks" / "X months" (preserve user's wording)
  * For durations 1 year or MORE: ALWAYS round to years or half-years (e.g., "1 year", "1.5 years", "2 years", "2.5 years", "3 years")
  * NEVER use "X years and Y months" format - always round to nearest year or half-year
- Examples:
  * User says "3 weeks" → time_in_days: 21, time_in_text: "3 weeks"
  * User says "2 months" → time_in_days: 60, time_in_text: "2 months"
  * User says "6 months" → time_in_days: 180, time_in_text: "6 months"
  * User says "1 year" → time_in_days: 365, time_in_text: "1 year"
  * User says "1.5 years" or "a year and a half" → time_in_days: 547, time_in_text: "1.5 years"
  * User says "2 years and 5 months" → time_in_days: 905, time_in_text: "2.5 years" (ALWAYS round to half-years, never "2 years and 5 months")
  * User says "2 years and 6 months" → time_in_days: 915, time_in_text: "2.5 years"
  * User says "3 years and 2 months" → time_in_days: 1095, time_in_text: "3 years" (round down)
  * User says "3 years and 4 months" → time_in_days: 1115, time_in_text: "3.5 years"
  * User says "3 months" → time_in_days: 90, time_in_text: "3 months" (NOT "90 days")
- Always prefer the user's original wording (weeks/months/years) over converting to days in time_in_text, BUT for durations ≥ 1 year, always round to years/half-years
- Ask travel_type and travel_buddies as separate, direct questions
- Extract specific keywords for lifestyle_keywords and wave_type_keywords - don't use vague descriptions
- Only set is_finished: true when you have ALL 6 pieces of information
- Always return JSON format, even when is_finished is false
- NEVER use markdown formatting in return_message - keep text clean and simple, no **, no *, no __, no _, no #, no brackets or any formatting codes
`

/**
 * Transform Swelly conversation data to match database schema
 * Handles both old format (destinations, travel_style, surf_pref, extras)
 * and new structured format
 */
function transformSwellyData(data: any): any {
  // If data already has the new structure, return as-is
  if (data.destinations_array && data.travel_type && data.travel_buddies) {
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
 * -> [{destination_name: "San Diego", time_in_days: 210, time_in_text: "7 months"}, ...]
 */
function parseDestinations(destinationsStr: string): Array<{ destination_name: string; time_in_days: number; time_in_text: string }> {
  const result: Array<{ destination_name: string; time_in_days: number; time_in_text: string }> = []
  
  // Split by common separators (comma, semicolon, "and")
  const parts = destinationsStr.split(/[,;]| and /i).map(s => s.trim()).filter(s => s)
  
  for (const part of parts) {
    // Extract destination name and time
    // Patterns: "San Diego (7mo)", "Sri Lanka (2x 1mo)", "Maldives 1 month", "El Salvador 3 months", "Australia 2 years and 5 months"
    const timeMatch = part.match(/(\d+(?:\.\d+)?)\s*(mo|month|months|week|weeks|day|days|year|years)/i)
    const multiplierMatch = part.match(/(\d+)x|twice|thrice/i)
    const yearHalfMatch = part.match(/(\d+\.5|one and a half|1\.5)\s*(year|years)/i)
    // Pattern for "X years and Y months" format
    const yearsAndMonthsMatch = part.match(/(\d+)\s*(?:year|years)\s+and\s+(\d+)\s*(?:month|months)/i)
    
    let timeInDays = 30 // Default to 1 month
    let timeInText = "1 month" // Default text
    
    // Handle "X years and Y months" format - round to years/half-years
    if (yearsAndMonthsMatch) {
      const years = parseInt(yearsAndMonthsMatch[1])
      const months = parseInt(yearsAndMonthsMatch[2])
      const totalDays = (years * 365) + (months * 30)
      timeInDays = totalDays
      
      // Round to nearest year or half-year
      const totalYears = years + (months / 12)
      if (months <= 2) {
        // 0-2 months: round down to whole years
        timeInText = `${years} ${years === 1 ? 'year' : 'years'}`
      } else if (months <= 8) {
        // 3-8 months: round to half-year
        timeInText = `${years}.5 years`
      } else {
        // 9+ months: round up to next year
        timeInText = `${years + 1} ${years + 1 === 1 ? 'year' : 'years'}`
      }
    } else if (timeMatch) {
      const value = parseFloat(timeMatch[1])
      const unit = timeMatch[2].toLowerCase()
      let multiplier = 1
      
      // Handle multipliers (2x, twice, etc.)
      if (multiplierMatch) {
        multiplier = multiplierMatch[0].includes('twice') ? 2 : 
                    multiplierMatch[0].includes('thrice') ? 3 :
                    parseInt(multiplierMatch[1]) || 1
      }
      
      // Calculate days and text
      if (unit.includes('year')) {
        const totalYears = value * multiplier
        timeInDays = Math.round(totalYears * 365)
        if (totalYears === 1) {
          timeInText = "1 year"
        } else if (totalYears % 1 === 0.5) {
          timeInText = `${Math.floor(totalYears)}.5 years`
        } else {
          timeInText = `${totalYears} years`
        }
      } else if (unit.includes('mo') || unit.includes('month')) {
        const totalMonths = value * multiplier
        timeInDays = Math.round(totalMonths * 30)
        // If 12+ months, convert to years/half-years
        if (totalMonths >= 12) {
          const years = totalMonths / 12
          if (years >= 1 && years < 1.5) {
            timeInText = "1 year"
          } else if (years >= 1.5 && years < 2) {
            timeInText = "1.5 years"
          } else {
            const roundedYears = Math.round(years * 2) / 2
            if (roundedYears === Math.floor(roundedYears)) {
              timeInText = `${roundedYears} ${roundedYears === 1 ? 'year' : 'years'}`
            } else {
              timeInText = `${roundedYears} years`
            }
          }
        } else {
          if (totalMonths === 1) {
            timeInText = "1 month"
          } else {
            timeInText = `${totalMonths} months`
          }
        }
      } else if (unit.includes('week')) {
        const totalWeeks = value * multiplier
        timeInDays = Math.round(totalWeeks * 7)
        if (totalWeeks === 1) {
          timeInText = "1 week"
        } else {
          timeInText = `${totalWeeks} weeks`
        }
      } else if (unit.includes('day')) {
        const totalDays = value * multiplier
        timeInDays = Math.round(totalDays)
        if (totalDays === 1) {
          timeInText = "1 day"
        } else {
          timeInText = `${totalDays} days`
        }
      }
    } else if (yearHalfMatch) {
      // Handle "1.5 years" or "one and a half years"
      timeInDays = 547 // 1.5 * 365
      timeInText = "1.5 years"
    }
    
    // Extract destination name (remove time info)
    let destinationName = part
      .replace(/\([^)]*\)/g, '') // Remove parentheses
      .replace(/\d+\s*(?:year|years)\s+and\s+\d+\s*(?:month|months)/gi, '') // Remove "X years and Y months"
      .replace(/\d+(?:\.\d+)?\s*(mo|month|months|week|weeks|day|days|year|years)/gi, '') // Remove time
      .replace(/\d+x|twice|thrice|one and a half/gi, '') // Remove multipliers
      .replace(/\s+and\s+/gi, ' ') // Remove remaining "and" connectors
      .trim()
    
    if (destinationName) {
      result.push({
        destination_name: destinationName,
        time_in_days: timeInDays,
        time_in_text: timeInText
      })
    }
  }
  
  return result.length > 0 ? result : [{ destination_name: destinationsStr, time_in_days: 30, time_in_text: "1 month" }]
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

/**
 * Enrich area with related names, nicknames, and nearby towns using GPT API
 * @param country - Country name
 * @param area - The primary area/town name mentioned by user
 * @returns Array of related area names (with the original area first)
 */
async function enrichAreaWithRelatedNames(country: string, area: string): Promise<string[]> {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured, returning original area only')
    return [area]
  }

  if (!area || !area.trim()) {
    return []
  }

  try {
    const prompt = `Given a surf destination area: "${area}" in "${country}"

Your task: Research and find related names, nicknames, and nearby small towns/areas that surfers might use to refer to this location.

Return a JSON object with this structure:
{
  "related_areas": ["area1", "area2", "area3", ...]
}

Rules:
- Include the original area name as the FIRST item in the array
- Add common nicknames or alternative names for this area
- Add nearby small towns or areas that are part of the same surf region
- Add any other ways surfers might refer to this location
- Keep names concise (town/area names, not full descriptions)
- Return 3-8 related names total (including the original)
- Only include names that are actually related to this specific area
- Do NOT include the country name in the areas

Examples:
- Input: country="Australia", area="Gold Coast" → {
  "related_areas": ["Gold Coast", "GC", "Surfers Paradise", "Burleigh Heads", "Coolangatta", "Tweed Heads"]
}
- Input: country="Costa Rica", area="Tamarindo" → {
  "related_areas": ["Tamarindo", "Tama", "Playa Tamarindo", "Langosta", "Playa Grande", "Avellanas"]
}
- Input: country="Sri Lanka", area="Weligama" → {
  "related_areas": ["Weligama", "Weli", "Midigama", "Mirissa", "Polhena"]
}

Return ONLY the JSON object, no other text.`

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
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content?.trim()
    
    if (!content) {
      throw new Error('No content in OpenAI response')
    }

    const parsed = JSON.parse(content)
    const relatedAreas = parsed.related_areas || []
    
    // Ensure the original area is first, and remove duplicates
    const uniqueAreas = [area]
    for (const relatedArea of relatedAreas) {
      if (relatedArea && relatedArea.toLowerCase() !== area.toLowerCase() && !uniqueAreas.some(a => a.toLowerCase() === relatedArea.toLowerCase())) {
        uniqueAreas.push(relatedArea)
      }
    }

    return uniqueAreas
  } catch (error) {
    console.error('Error enriching area with related names:', error)
    // Fallback: return just the original area
    return [area]
  }
}

/**
 * Process and enrich destinations array with related area names
 * @param destinations - Array of destinations from GPT response
 * @returns Processed destinations with enriched areas
 */
async function processDestinationsArray(destinations: any[]): Promise<any[]> {
  if (!destinations || !Array.isArray(destinations)) {
    return []
  }

  const processed: any[] = []

  for (const dest of destinations) {
    // Support both new format (country, area) and legacy (destination_name)
    let country: string
    let areas: string[] = []

    if (dest.country) {
      // New format
      country = dest.country
      areas = dest.area || []
    } else if (dest.destination_name) {
      // Legacy format - parse it
      const parts = dest.destination_name.split(',').map((p: string) => p.trim())
      country = parts[0] || ''
      areas = parts.length > 1 ? parts.slice(1) : []
    } else {
      // Skip invalid destinations
      console.warn('Skipping invalid destination:', dest)
      continue
    }

    // If no areas mentioned, save with empty array
    if (areas.length === 0) {
      processed.push({
        country,
        area: [],
        time_in_days: dest.time_in_days || 0,
        time_in_text: dest.time_in_text,
      })
      continue
    }

    // Enrich ALL areas mentioned by the user
    const allEnrichedNames: string[] = []
    
    // Enrich each area sequentially
    for (const area of areas) {
      const enrichedNames = await enrichAreaWithRelatedNames(country, area)
      // enrichedNames includes the original area as first item, so skip it
      // Add all related names (excluding the original which is already in areas)
      for (let i = 1; i < enrichedNames.length; i++) {
        const relatedName = enrichedNames[i]
        // Only add if it's not already in the original areas list
        if (!areas.some(a => a.toLowerCase() === relatedName.toLowerCase())) {
          allEnrichedNames.push(relatedName)
        }
      }
    }
    
    // Combine: original areas first, then all enriched names
    // Remove duplicates while preserving order (originals first, then enriched)
    const seen = new Set<string>()
    const uniqueAreas: string[] = []
    
    // First pass: add all original areas (preserve order)
    for (const area of areas) {
      const lower = area.toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        uniqueAreas.push(area)
      }
    }
    
    // Second pass: add enriched names (excluding originals)
    for (const enrichedName of allEnrichedNames) {
      const lower = enrichedName.toLowerCase()
      if (!seen.has(lower)) {
        seen.add(lower)
        uniqueAreas.push(enrichedName)
      }
    }

    processed.push({
      country,
      area: uniqueAreas,
      time_in_days: dest.time_in_days || 0,
      time_in_text: dest.time_in_text,
    })
  }

  return processed
}

serve(async (req: Request) => {
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
          
          // Process and enrich destinations array with related area names
          if (transformedData.destinations_array && Array.isArray(transformedData.destinations_array)) {
            console.log('Processing destinations array for enrichment...')
            transformedData.destinations_array = await processDestinationsArray(transformedData.destinations_array)
            console.log('Enriched destinations array:', JSON.stringify(transformedData.destinations_array, null, 2))
          }
          
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
          
          // Process and enrich destinations array with related area names
          if (transformedData.destinations_array && Array.isArray(transformedData.destinations_array)) {
            console.log('Processing destinations array for enrichment (continue)...')
            transformedData.destinations_array = await processDestinationsArray(transformedData.destinations_array)
            console.log('Enriched destinations array (continue):', JSON.stringify(transformedData.destinations_array, null, 2))
          }
          
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

  } catch (error: unknown) {
    console.error('Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'
    return new Response(
      JSON.stringify({ error: errorMessage }),
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



