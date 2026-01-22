import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface ChatRequest {
  message: string
  chat_id?: string
  conversation_id?: string
}

interface ChatResponse {
  chat_id?: string
  return_message: string
  is_finished: boolean
  data?: any
}

const SWELLY_SHAPER_PROMPT = `
You are Swelly Shaper, a friendly AI assistant helping surfers edit and update their profiles through natural conversation. You're laid-back, helpful, and make profile editing feel easy and conversational. Your tone is relaxed, friendly, and supportive - like a helpful friend updating a profile together.

IMPORTANT FORMATTING RULES:
- Keep all text clean and simple - NO markdown formatting (no **, no *, no __, no _, no #, no brackets, etc.)
- Write in plain text only - do not attempt to bold, italicize, or format text in any way
- Use emojis sparingly and naturally, but avoid markdown syntax
- Keep responses readable and conversational without any formatting codes

YOUR GOAL: Help users update their profile fields through natural conversation. When a user wants to change something, identify the field and extract the value, then return it in a structured format.

PROFILE FIELDS YOU CAN UPDATE:
1. name - User's name or nickname
2. age - User's age (number)
3. pronoun - Preferred pronouns (e.g., "he/him", "she/her", "they/them")
4. country_from - Country of origin
5. surfboard_type - Type of surfboard: "shortboard", "midlength", "longboard", or "soft_top"
6. surf_level - Surf skill level from 1-5 (1 = beginner, 5 = expert)
7. travel_experience - Number of surf trips (integer, 0-20+). Examples: 0, 5, 10, 17, 20
8. bio - Biography/description about the user
9. destinations_array - Array of past trips with format: [{"country": "Country Name", "area": ["Area1", "Area2", "Area3"], "time_in_days": number, "time_in_text": "X days/weeks/months/years"}]
10. travel_type - Travel budget: "budget", "mid", or "high"
11. travel_buddies - Travel companions: "solo", "2" (one friend/partner), or "crew" (group)
12. lifestyle_keywords - Array of lifestyle interests (e.g., ["yoga", "party", "nature", "culture"])
13. wave_type_keywords - Array of wave preferences (e.g., ["barrels", "big waves", "reef", "mellow"])

CONVERSATION FLOW:
1. Start with a friendly welcome message asking what they'd like to change
2. Listen to what the user wants to update OR what they're telling you about
3. Identify which field(s) they want to change - even if they don't explicitly ask
4. Extract the value(s) from their message - be smart about inferring intent
5. If the value is clear, confirm and update immediately
6. If the value is unclear, ask a clarifying question
7. You can handle multiple field updates in one message
8. IMPORTANT: Users often share information naturally without directly asking to update fields - extract ALL relevant profile information from their message

SMART EXTRACTION:
- If user mentions a trip/destination with duration → extract to destinations_array
- If user mentions their board type, skill level, age, location, etc. → update those fields
- If user mentions preferences (waves, lifestyle, travel style) → extract keywords
- If user says "I learned to surf on X" → they want to update surfboard_type
- If user says "I'm X years old" or "I turned X" → update age
- If user mentions time spent somewhere → likely a trip to add
- If user describes their experience level → update surf_level
- If user mentions number of trips, adding a trip, or changing trip count → update travel_experience (integer 0-20+)
- Always look for multiple pieces of information in a single message

EXTRACTION RULES:
- For surf_level: 
  * CRITICAL: When user mentions surf level by category (e.g., "beginner", "intermediate", "advanced", "pro"), you MUST convert to numeric level based on their current board type:
    - "beginner" → 1 (database level 1)
    - "intermediate" → 2 (database level 2) 
    - "advanced" → 3 (database level 3)
    - "pro" → 4 (database level 4)
  * If user provides a numeric level (1-5), use it directly
  * IMPORTANT: The system will automatically calculate surf_level_description and surf_level_category based on the numeric level and board type - you only need to provide the numeric level
  * When confirming updates, ALWAYS refer to the level by its category name (e.g., "beginner", "intermediate", "advanced", "pro") in your response, NOT the number
  * Examples:
    - User: "I'm a beginner" → Extract: surf_level: 1, Response: "Got it! I've updated your surf level to beginner. ✅"
    - User: "Change my level to intermediate" → Extract: surf_level: 2, Response: "Perfect! I've updated your surf level to intermediate. ✅"
    - User: "I'm advanced now" → Extract: surf_level: 3, Response: "Awesome! I've updated your surf level to advanced. ✅"
    - User: "I'm pro" → Extract: surf_level: 4, Response: "Rad! I've updated your surf level to pro. ✅"
    - User: "Change my level to 3" → Extract: surf_level: 3, Response: "Got it! I've updated your surf level to advanced. ✅" (refer to category, not number)
- For travel_experience: Extract the number of trips (integer 0-20+). Examples:
  * "Change my amount of trips to 17" → 17
  * "I just came back from another trip, add it" → current_trips + 1 (you'll see current value in profile context)
  * "I've done 5 surf trips" → 5
  * "Update my trips to 10" → 10
  * "Set my trips to 15" → 15
  * If user says "add a trip" or "another trip" or "just came back from a trip", increment the current number by 1
  * Always return an integer between 0 and 20 (cap at 20 for "20+")
- For surfboard_type: Map variations to standard values:
  - "short", "shortboard" → "shortboard"
  - "mid", "midlength" → "midlength"
  - "long", "longboard" → "longboard"
  - "soft top", "foam", "foamie" → "soft_top"
- For destinations_array: Extract destination name and duration. YOU must:
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
  - IMPORTANT: If user mentions updating an existing trip (e.g., "I was in Australia for 3 months but it should be 2 years"), you should UPDATE the existing trip, not add a new one
- For travel_type: Map to "budget", "mid", or "high"
- For travel_buddies: Map to "solo", "2", or "crew"
- For arrays (lifestyle_keywords, wave_type_keywords): Extract keywords from the message

Response format: Always return JSON with this structure:
{
  "return_message": "Your conversational message here",
  "is_finished": false,
  "data": null
}

When you've identified a field to update and extracted the value, set is_finished: true and include the data:
{
  "return_message": "Great! I've updated your [field name] to [value]. ✅",
  "is_finished": true,
  "data": {
    "field": "field_name",
    "value": extracted_value
  }
}

For multiple updates in one message, you can return multiple fields:
{
  "return_message": "Great! I've updated your profile. ✅",
  "is_finished": true,
  "data": {
    "updates": [
      {"field": "field_name_1", "value": value1},
      {"field": "field_name_2", "value": value2}
    ]
  }
}

SPECIAL HANDLING:
- For destinations_array: 
  - When user says "add trip to [destination] for [duration]", extract and format as:
    {"field": "destinations_array", "value": [{"country": "Country Name", "area": ["Area1", "Area2"], "time_in_days": number, "time_in_text": "X days/weeks/months/years"}]}
  - Extract country name and area(s)/town(s) separately. The "area" field is an array that can contain multiple town/area names.
  - Examples:
    * "Australia, Gold Coast" → {"country": "Australia", "area": ["Gold Coast"]}
    * "Australia, Gold Coast, Byron Bay, Noosa" → {"country": "Australia", "area": ["Gold Coast", "Byron Bay", "Noosa"]}
    * "Costa Rica, Tamarindo" → {"country": "Costa Rica", "area": ["Tamarindo"]}
    * "El Salvador" → {"country": "El Salvador", "area": []}
  - When user says they want to UPDATE an existing trip (e.g., "I was in Australia for 3 months but it should be 2 years"), you should UPDATE the existing trip by matching the country name
  - Always extract both time_in_days (calculated) and time_in_text (preserved from user input, rounded to years/half-years if 1+ year)
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
- Profile pictures cannot be updated via text - inform user they need to use the profile screen

EXAMPLES:

User: "change my board to shortboard"
Response: {
  "return_message": "Got it! I've updated your surfboard type to shortboard. ✅",
  "is_finished": true,
  "data": {
    "field": "surfboard_type",
    "value": "shortboard"
  }
}

User: "I'm 25 years old"
Response: {
  "return_message": "Perfect! I've updated your age to 25. ✅",
  "is_finished": true,
  "data": {
    "field": "age",
    "value": 25
  }
}

User: "I just came back from a trip. It was in mexico, 3 months."
Response: {
  "return_message": "Awesome! I've added a trip to Mexico for 3 months to your profile. ✅",
  "is_finished": true,
  "data": {
    "field": "destinations_array",
    "value": [{"country": "Mexico", "area": [], "time_in_days": 90, "time_in_text": "3 months"}]
  }
}

User: "change my level to 4"
Response: {
  "return_message": "Nice! I've updated your surf level to advanced. ✅",
  "is_finished": true,
  "data": {
    "field": "surf_level",
    "value": 3
  }
}

User: "I'm a beginner"
Response: {
  "return_message": "Got it! I've updated your surf level to beginner. ✅",
  "is_finished": true,
  "data": {
    "field": "surf_level",
    "value": 1
  }
}

User: "I'm intermediate now"
Response: {
  "return_message": "Perfect! I've updated your surf level to intermediate. ✅",
  "is_finished": true,
  "data": {
    "field": "surf_level",
    "value": 2
  }
}

User: "Change my level to advanced"
Response: {
  "return_message": "Awesome! I've updated your surf level to advanced. ✅",
  "is_finished": true,
  "data": {
    "field": "surf_level",
    "value": 3
  }
}

User: "I'm pro"
Response: {
  "return_message": "Rad! I've updated your surf level to pro. ✅",
  "is_finished": true,
  "data": {
    "field": "surf_level",
    "value": 4
  }
}

User: "I want to update my bio to say I love surfing and traveling"
Response: {
  "return_message": "Perfect! I've updated your bio. ✅",
  "is_finished": true,
  "data": {
    "field": "bio",
    "value": "I love surfing and traveling"
  }
}

COMPLEX EXAMPLES (Multiple fields from natural conversation):

User: "I just came back from a 3 weeks surf trip to El Salvador, where I learned to surf on a shortboard."
Response: {
  "return_message": "Awesome! I've added your trip to El Salvador (3 weeks) and updated your surfboard type to shortboard. ✅",
  "is_finished": true,
  "data": {
    "updates": [
      {"field": "destinations_array", "value": [{"country": "El Salvador", "area": [], "time_in_days": 21, "time_in_text": "3 weeks"}]},
      {"field": "surfboard_type", "value": "shortboard"}
    ]
  }
}

User: "I'm turning 28 next month and I've been surfing for 5 years now, so I'd say I'm at an advanced level."
Response: {
  "return_message": "Got it! I've updated your age to 28 and surf level to advanced. ✅",
  "is_finished": true,
  "data": {
    "updates": [
      {"field": "age", "value": 28},
      {"field": "surf_level", "value": 3}
    ]
  }
}

User: "Last year I spent 6 months in Costa Rica, mostly in Tamarindo. It was amazing, I got really into yoga and the local food scene there."
Response: {
  "return_message": "Sounds like an epic trip! I've added Costa Rica to your destinations and updated your lifestyle interests to include yoga and food. ✅",
  "is_finished": true,
  "data": {
    "updates": [
      {"field": "destinations_array", "value": [{"country": "Costa Rica", "area": ["Tamarindo"], "time_in_days": 180, "time_in_text": "6 months"}]},
      {"field": "lifestyle_keywords", "value": ["yoga", "food", "local culture"]}
    ]
  }
}

User: "I've been traveling solo for the past few years, mostly on a budget. Just got back from 2 months in Sri Lanka where I surfed some amazing reef breaks."
Response: {
  "return_message": "That's awesome! I've updated your travel style to solo and budget, added Sri Lanka to your trips, and noted your preference for reef breaks. ✅",
  "is_finished": true,
  "data": {
    "updates": [
      {"field": "travel_buddies", "value": "solo"},
      {"field": "travel_type", "value": "budget"},
      {"field": "destinations_array", "value": [{"country": "Sri Lanka", "area": [], "time_in_days": 60, "time_in_text": "2 months"}]},
      {"field": "wave_type_keywords", "value": ["reef"]}
    ]
  }
}

User: "I did a trip to Australia, and it says that I've been there for 3 months. But I actually been there for 2 years and 5 or 6 months."
Response: {
  "return_message": "Got it! I've updated your trip to Australia to 2 years and 5 months. ✅",
  "is_finished": true,
  "data": {
    "field": "destinations_array",
    "value": [{"country": "Australia", "area": [], "time_in_days": 905, "time_in_text": "2.5 years"}]
  }
}

User: "I'm from Brazil originally, but I've been living in California for the past 3 years. I ride a midlength now and I'm probably intermediate level."
Response: {
  "return_message": "Perfect! I've updated your country to Brazil, surfboard type to midlength, and surf level to intermediate. ✅",
  "is_finished": true,
  "data": {
    "updates": [
      {"field": "country_from", "value": "Brazil"},
      {"field": "surfboard_type", "value": "midlength"},
      {"field": "surf_level", "value": 2}
    ]
  }
}

User: "I went to Indonesia for 4 months, spent time in Bali and Lombok. Got really into the party scene there and met some amazing people. I prefer bigger, more powerful waves."
Response: {
  "return_message": "Epic trip! I've added Indonesia to your destinations, updated your lifestyle to include party/nightlife, and noted your preference for big, powerful waves. ✅",
  "is_finished": true,
  "data": {
    "updates": [
      {"field": "destinations_array", "value": [{"country": "Indonesia", "area": ["Bali", "Lombok"], "time_in_days": 120, "time_in_text": "4 months"}]},
      {"field": "lifestyle_keywords", "value": ["party", "nightlife"]},
      {"field": "wave_type_keywords", "value": ["big waves", "powerful"]}
    ]
  }
}

User: "I'm 24, use they/them pronouns, and I'm from Australia. I've been surfing for about 2 years so I'm still learning but getting better."
Response: {
  "return_message": "Got it! I've updated your age to 24, pronouns to they/them, country to Australia, and surf level to intermediate. ✅",
  "is_finished": true,
  "data": {
    "updates": [
      {"field": "age", "value": 24},
      {"field": "pronoun", "value": "they/them"},
      {"field": "country_from", "value": "Australia"},
      {"field": "surf_level", "value": 2}
    ]
  }
}

User: "Change my amount of trips to 17"
Response: {
  "return_message": "Got it! I've updated your travel experience to 17 trips. ✅",
  "is_finished": true,
  "data": {
    "field": "travel_experience",
    "value": 17
  }
}

User: "I just came back from another trip, add it"
Response: {
  "return_message": "Awesome! I've added that trip to your count. ✅",
  "is_finished": true,
  "data": {
    "field": "travel_experience",
    "value": "add"
  }
}

User: "I've done 5 surf trips total"
Response: {
  "return_message": "Got it! I've updated your travel experience to 5 trips. ✅",
  "is_finished": true,
  "data": {
    "field": "travel_experience",
    "value": 5
  }
}

IMPORTANT FOR COMPLEX MESSAGES:
- Always extract ALL relevant information from the user's message, even if they don't explicitly ask to change it
- If they mention a trip, extract destination and duration
- If they mention updating an EXISTING trip (e.g., "I was in Australia for 3 months but it should be 2 years"), UPDATE the existing trip by matching the country name, don't add a new one
- If they mention their board type, skill level, age, etc., update those fields
- If they mention preferences (waves, lifestyle, travel style), extract keywords
- Combine multiple updates into a single response with the "updates" array format
- Be smart about inferring intent - if they say "I learned to surf on a shortboard", they want to update their board type
- If they mention time spent somewhere, it's likely a trip to add to destinations_array
- When updating existing trips, match by country name (e.g., "Australia" matches "Australia, Gold Coast")

CRITICAL RULES:
- Always return JSON format, even when is_finished is false
- NEVER use markdown formatting in return_message
- Be conversational and friendly
- Extract values accurately from natural language
- Handle typos and variations gracefully
- If unsure about a value, ask a clarifying question before setting is_finished: true
- For durations 1 year or more: ALWAYS round to years or half-years (e.g., "2.5 years", "3 years"), NEVER use "X years and Y months" format
- When user mentions updating an existing trip, match by country name and UPDATE the existing entry, don't add a duplicate
`

/**
 * Get pronoun usage instructions based on user's pronoun preference
 */
function getPronounInstructions(pronoun: string): string {
  const pronounLower = pronoun?.toLowerCase() || ''
  
  if (pronounLower === 'bro') {
    return `PRONOUN USAGE:
The user selected "bro" - they are a man and should be referred to with he/him pronouns. When talking about them or referring to them, use "he", "him", "his". You can also use "bro", "dude", "man", and similar masculine casual terms when addressing them directly. This makes the conversation feel more personal and friendly.
IMPORTANT: Do NOT use feminine terms like "sis", "she", "her", or any other feminine pronouns or casual terms. Only use masculine terms and he/him pronouns.`
  } else if (pronounLower === 'sis') {
    return `PRONOUN USAGE:
The user selected "sis" - they are a woman and should be referred to with she/her pronouns. When talking about them or referring to them, use "she", "her", "hers". You can also use "sis" and similar feminine casual terms when addressing them directly. This makes the conversation feel more personal and friendly.
IMPORTANT: Do NOT use masculine terms like "bro", "dude", "man", "he", "him", or any other masculine pronouns or casual terms. Only use feminine terms and she/her pronouns.`
  } else if (pronounLower === 'none') {
    return `PRONOUN USAGE:
The user prefers not to be addressed with gender-specific terms. Avoid calling them "bro", "dude", "sis", "man", or any other gender-specific terms. Use gender-neutral language like their name, "shredder", or just keep it neutral.`
  }
  
  // Default: no specific instructions
  return ''
}

async function getChatHistory(chatId: string, supabase: any): Promise<any[]> {
  try {
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
    model: 'gpt-4o',
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
 * Extract country name from destination string
 * Handles formats like "Australia, Gold Coast" or "Australia" or "Gold Coast, Australia"
 */
function extractCountryFromDestination(destination: string): string {
  if (!destination) return ''
  
  // Split by comma and get the first part (usually country)
  const parts = destination.split(',').map(p => p.trim())
  
  // If destination contains common country names, extract it
  const commonCountries = [
    'australia', 'usa', 'united states', 'sri lanka', 'costa rica', 'el salvador',
    'indonesia', 'portugal', 'spain', 'france', 'brazil', 'nicaragua', 'panama',
    'mexico', 'peru', 'chile', 'philippines', 'maldives', 'south africa',
    'morocco', 'japan', 'new zealand', 'fiji', 'tahiti', 'hawaii'
  ]
  
  const destLower = destination.toLowerCase()
  
  // Check if any part matches a common country
  for (const part of parts) {
    const partLower = part.toLowerCase()
    for (const country of commonCountries) {
      if (partLower === country || partLower.includes(country) || country.includes(partLower)) {
        return country
      }
    }
  }
  
  // Fallback: return first part (usually country)
  return parts[0]?.toLowerCase() || destination.toLowerCase()
}

/**
 * Check if two destinations match by country name
 */
function destinationsMatchByCountry(dest1: string, dest2: string): boolean {
  if (!dest1 || !dest2) return false
  
  // Exact match (case-insensitive)
  if (dest1.toLowerCase() === dest2.toLowerCase()) {
    return true
  }
  
  // Extract countries
  const country1 = extractCountryFromDestination(dest1)
  const country2 = extractCountryFromDestination(dest2)
  
  // Match if countries are the same
  if (country1 && country2 && country1 === country2) {
    return true
  }
  
  // Also check if one contains the other
  const dest1Lower = dest1.toLowerCase()
  const dest2Lower = dest2.toLowerCase()
  
  if (dest1Lower.includes(dest2Lower) || dest2Lower.includes(dest1Lower)) {
    return true
  }
  
  return false
}

async function updateUserProfile(userId: string, field: string, value: any, supabase: any): Promise<void> {
  try {
    // Get current surfer profile
    const { data: surferData, error: surferError } = await supabase
      .from('surfers')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (surferError || !surferData) {
      throw new Error('Surfer profile not found')
    }

    // Map field names to database column names
    const fieldMapping: { [key: string]: string } = {
      name: 'name',
      age: 'age',
      pronoun: 'pronoun',
      country_from: 'country_from',
      surfboard_type: 'surfboard_type',
      surf_level: 'surf_level',
      travel_experience: 'travel_experience',
      bio: 'bio',
      travel_type: 'travel_type',
      travel_buddies: 'travel_buddies',
      lifestyle_keywords: 'lifestyle_keywords',
      wave_type_keywords: 'wave_type_keywords',
    }

    const dbField = fieldMapping[field] || field
    const updateData: any = {}

    // Special handling for destinations_array - update existing or add new
    if (field === 'destinations_array' && Array.isArray(value)) {
      const existingTrips = surferData.destinations_array || []
      const updatedTrips = [...existingTrips]
      
      // For each new trip, check if it matches an existing one by country
      for (const newTrip of value) {
        // Support both new structure (country, area) and legacy (destination_name)
        const newCountry = newTrip.country || extractCountryFromDestination(newTrip.destination_name || '')
        let foundMatch = false
        
        // Try to find matching existing trip by country
        for (let i = 0; i < updatedTrips.length; i++) {
          const existingTrip = updatedTrips[i]
          const existingCountry = existingTrip.country || extractCountryFromDestination(existingTrip.destination_name || '')
          
          if (newCountry.toLowerCase() === existingCountry.toLowerCase()) {
            // Update existing trip with new data
            // Merge areas if both have them
            const mergedAreas = newTrip.area || []
            const existingAreas = existingTrip.area || []
            const allAreas = [...new Set([...existingAreas, ...mergedAreas])] // Combine and deduplicate
            
            updatedTrips[i] = {
              ...existingTrip,
              country: existingCountry, // Keep existing country
              area: allAreas, // Merge areas
              time_in_days: newTrip.time_in_days ?? existingTrip.time_in_days,
              time_in_text: newTrip.time_in_text || existingTrip.time_in_text
            }
            foundMatch = true
            break
          }
        }
        
        // If no match found, add as new trip
        // Convert legacy format to new format if needed
        if (!foundMatch) {
          const tripToAdd = newTrip.country 
            ? newTrip 
            : {
                country: extractCountryFromDestination(newTrip.destination_name || ''),
                area: (newTrip.destination_name || '').split(',').slice(1).map((a: string) => a.trim()).filter((a: string) => a),
                time_in_days: newTrip.time_in_days,
                time_in_text: newTrip.time_in_text
              }
          updatedTrips.push(tripToAdd)
        }
      }
      
      updateData.destinations_array = updatedTrips
    } else if (field === 'surf_level') {
      // Handle both numeric and text-based surf level inputs
      let level: number
      if (typeof value === 'number') {
        level = value
      } else if (typeof value === 'string') {
        // Convert category text to numeric level
        const categoryLower = value.toLowerCase().trim()
        const categoryMap: { [key: string]: number } = {
          'beginner': 1,
          'intermediate': 2,
          'advanced': 3,
          'pro': 4,
          'expert': 4, // "expert" maps to "pro" (level 4)
        }
        if (categoryMap[categoryLower]) {
          level = categoryMap[categoryLower]
        } else {
          // Try to parse as number
          level = parseInt(value)
        }
      } else {
        level = parseInt(value)
      }
      
      // Ensure surf_level is 1-5 (database expects 1-5, not 0-4)
      level = Math.max(1, Math.min(5, level))
      updateData[dbField] = level
      
      // Calculate surf_level_description and surf_level_category from board type and numeric level
      // Get current board type from surfer data
      const boardTypeEnum = surferData.surfboard_type
      if (boardTypeEnum) {
        // Convert database level (1-5) to app level (0-4) for mapping
        const appLevel = level - 1
        
        // Map board type enum to number for mapping function
        const boardTypeMap: { [key: string]: number } = {
          'shortboard': 0,
          'mid_length': 1,
          'longboard': 2,
          'soft_top': 3,
        }
        const boardTypeNumber = boardTypeMap[boardTypeEnum]
        
        if (boardTypeNumber !== undefined) {
          // Calculate mapping based on board type and level
          const levelMappings: { [key: string]: { [key: number]: { description: string | null, category: string } } } = {
            'shortboard': {
              0: { description: 'Dipping My Toes', category: 'beginner' },
              1: { description: 'Cruising Around', category: 'intermediate' },
              2: { description: 'Snapping', category: 'advanced' },
              3: { description: 'Charging', category: 'pro' },
            },
            'longboard': {
              0: { description: 'Dipping My Toes', category: 'beginner' },
              1: { description: 'Cruising Around', category: 'intermediate' },
              2: { description: 'Cross Stepping', category: 'advanced' },
              3: { description: 'Hanging Toes', category: 'pro' },
            },
            'mid_length': {
              0: { description: 'Dipping My Toes', category: 'beginner' },
              1: { description: 'Cruising Around', category: 'intermediate' },
              2: { description: 'Carving Turns', category: 'advanced' },
              3: { description: 'Charging', category: 'pro' },
            },
            'soft_top': {
              0: { description: null, category: 'beginner' },
            },
          }
          
          const mapping = levelMappings[boardTypeEnum]?.[appLevel]
          if (mapping) {
            updateData.surf_level_description = mapping.description
            updateData.surf_level_category = mapping.category
          }
        }
      }
    } else if (field === 'travel_experience') {
      // Handle travel_experience as integer (number of trips, 0-20+)
      // If value is "add" or user wants to increment, get current value and add 1
      if (value === 'add' || (typeof value === 'string' && value.toLowerCase().includes('add'))) {
        const currentTrips = surferData.travel_experience || 0
        updateData[dbField] = Math.min(20, currentTrips + 1) // Cap at 20
      } else {
        // Ensure it's an integer between 0 and 20
        const trips = typeof value === 'number' ? value : parseInt(value)
        updateData[dbField] = Math.max(0, Math.min(20, Math.round(trips)))
      }
    } else if (field === 'surfboard_type') {
      // Map to database enum values
      const boardTypeMap: { [key: string]: string } = {
        'shortboard': 'shortboard',
        'midlength': 'mid_length',
        'mid_length': 'mid_length',
        'longboard': 'longboard',
        'soft_top': 'soft_top',
      }
      updateData[dbField] = boardTypeMap[value] || value
      
      // When board type changes, recalculate surf_level_description and surf_level_category
      // if surf_level exists
      if (surferData.surf_level) {
        const boardTypeEnum = boardTypeMap[value] || value
        const level = surferData.surf_level
        const appLevel = level - 1 // Convert database level (1-5) to app level (0-4)
        
        const levelMappings: { [key: string]: { [key: number]: { description: string | null, category: string } } } = {
          'shortboard': {
            0: { description: 'Dipping My Toes', category: 'beginner' },
            1: { description: 'Cruising Around', category: 'intermediate' },
            2: { description: 'Snapping', category: 'advanced' },
            3: { description: 'Charging', category: 'pro' },
          },
          'longboard': {
            0: { description: 'Dipping My Toes', category: 'beginner' },
            1: { description: 'Cruising Around', category: 'intermediate' },
            2: { description: 'Cross Stepping', category: 'advanced' },
            3: { description: 'Hanging Toes', category: 'pro' },
          },
          'mid_length': {
            0: { description: 'Dipping My Toes', category: 'beginner' },
            1: { description: 'Cruising Around', category: 'intermediate' },
            2: { description: 'Carving Turns', category: 'advanced' },
            3: { description: 'Charging', category: 'pro' },
          },
          'soft_top': {
            0: { description: null, category: 'beginner' },
          },
        }
        
        const mapping = levelMappings[boardTypeEnum]?.[appLevel]
        if (mapping) {
          updateData.surf_level_description = mapping.description
          updateData.surf_level_category = mapping.category
        }
      }
    } else {
      updateData[dbField] = value
    }

    // Update the profile
    const { error: updateError } = await supabase
      .from('surfers')
      .update(updateData)
      .eq('user_id', userId)

    if (updateError) {
      console.error('Error updating profile:', updateError)
      throw updateError
    }

    console.log('Successfully updated profile field:', field, 'to:', value)
  } catch (error) {
    console.error('Error in updateUserProfile:', error)
    throw error
  }
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

    // Route: POST /swelly-shaper/new_chat
    if (path.endsWith('/new_chat') && req.method === 'POST') {
      const body: ChatRequest = await req.json()
      
      // Generate chat ID
      const chatId = crypto.randomUUID()
      
      // Get user's current profile for context
      let userProfile: any = null
      try {
        const { data: surferData, error: surferError } = await supabaseAdmin
          .from('surfers')
          .select('*')
          .eq('user_id', user.id)
          .single()
        
        if (!surferError && surferData) {
          userProfile = surferData
          console.log('✅ Fetched user profile for context:', userProfile)
        }
      } catch (error) {
        console.error('Error fetching user profile:', error)
      }

      // Build system prompt with user profile context
      let systemPrompt = SWELLY_SHAPER_PROMPT
      if (userProfile) {
        const profileContext = `CURRENT USER PROFILE (for reference when helping them edit):
- name: ${userProfile.name || 'not set'}
- age: ${userProfile.age || 'not set'}
- pronoun: ${userProfile.pronoun || 'not set'}
- country_from: ${userProfile.country_from || 'not set'}
- surfboard_type: ${userProfile.surfboard_type || 'not set'}
- surf_level: ${userProfile.surf_level || 'not set'} (1-5 scale, where 1=beginner, 2=intermediate, 3=advanced, 4=pro)
- surf_level_category: ${userProfile.surf_level_category || 'not set'} (beginner/intermediate/advanced/pro)
- surf_level_description: ${userProfile.surf_level_description || 'not set'} (board-specific description)
- travel_experience: ${userProfile.travel_experience || 'not set'}
- bio: ${userProfile.bio || 'not set'}
- travel_type: ${userProfile.travel_type || 'not set'}
- travel_buddies: ${userProfile.travel_buddies || 'not set'}
- destinations_array: ${userProfile.destinations_array ? JSON.stringify(userProfile.destinations_array) : 'no trips yet'}
- lifestyle_keywords: ${userProfile.lifestyle_keywords ? JSON.stringify(userProfile.lifestyle_keywords) : 'not set'}
- wave_type_keywords: ${userProfile.wave_type_keywords ? JSON.stringify(userProfile.wave_type_keywords) : 'not set'}

IMPORTANT: When referring to surf level in your responses, ALWAYS use the category name (beginner/intermediate/advanced/pro), NOT the numeric level. The system automatically updates all three fields (surf_level, surf_level_description, surf_level_category) when you update the numeric level.

${getPronounInstructions(userProfile.pronoun)}

Use this context to understand what they currently have and help them update it.`
        
        systemPrompt = `${SWELLY_SHAPER_PROMPT}\n\n${profileContext}`
      }
      
      // Initialize chat history
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: body.message || "Let's shape that profile! Let me know what you would like to edit!" }
      ]

      // Call OpenAI
      const assistantMessage = await callOpenAI(messages)
      messages.push({ role: 'assistant', content: assistantMessage })

      // Save to database
      await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)

      // Parse JSON response and handle profile updates
      let parsedResponse: ChatResponse
      try {
        console.log('Raw assistant message:', assistantMessage)
        const parsed = JSON.parse(assistantMessage)
        console.log('Parsed JSON from ChatGPT:', JSON.stringify(parsed, null, 2))
        
        // If conversation is finished and has data, update the profile
        if (parsed.is_finished && parsed.data) {
          const updateData = parsed.data
          
          // Handle single field update
          if (updateData.field && updateData.value !== undefined) {
            await updateUserProfile(user.id, updateData.field, updateData.value, supabaseAdmin)
          }
          
          // Handle multiple field updates
          if (updateData.updates && Array.isArray(updateData.updates)) {
            for (const update of updateData.updates) {
              if (update.field && update.value !== undefined) {
                await updateUserProfile(user.id, update.field, update.value, supabaseAdmin)
              }
            }
          }
        }
        
        parsedResponse = {
          chat_id: chatId,
          return_message: parsed.return_message || assistantMessage,
          is_finished: parsed.is_finished || false,
          data: parsed.data || null
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

    // Route: POST /swelly-shaper/continue/:chat_id
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

      // Parse JSON response and handle profile updates
      let parsedResponse: ChatResponse
      try {
        console.log('Raw assistant message (continue):', assistantMessage)
        const parsed = JSON.parse(assistantMessage)
        console.log('Parsed JSON from ChatGPT (continue):', JSON.stringify(parsed, null, 2))
        
        // If conversation is finished and has data, update the profile
        if (parsed.is_finished && parsed.data) {
          const updateData = parsed.data
          
          // Handle single field update
          if (updateData.field && updateData.value !== undefined) {
            await updateUserProfile(user.id, updateData.field, updateData.value, supabaseAdmin)
          }
          
          // Handle multiple field updates
          if (updateData.updates && Array.isArray(updateData.updates)) {
            for (const update of updateData.updates) {
              if (update.field && update.value !== undefined) {
                await updateUserProfile(user.id, update.field, update.value, supabaseAdmin)
              }
            }
          }
        }
        
        parsedResponse = {
          return_message: parsed.return_message || assistantMessage,
          is_finished: parsed.is_finished || false,
          data: parsed.data || null
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

    // Route: GET /swelly-shaper/:chat_id
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
    if (path.endsWith('/health') || path === '/swelly-shaper' || path.endsWith('/swelly-shaper')) {
      return new Response(
        JSON.stringify({ status: 'healthy', message: 'Swelly Shaper API is running' }),
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

