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

interface MatchedUser {
  user_id: string
  email?: string
  name: string
  profile_image_url?: string | null
  match_score: number
  matched_areas?: string[]
  common_lifestyle_keywords?: string[]
  common_wave_keywords?: string[]
  surfboard_type?: string
  surf_level?: number
  travel_experience?: string
  country_from?: string
  age?: number
  days_in_destination?: number
  destinations_array?: Array<{ country: string; area: string[]; time_in_days: number; time_in_text?: string }>
  matchQuality?: any
}

interface MessageMetadata {
  matchedUsers?: MatchedUser[]
  destinationCountry?: string
  matchTimestamp?: string
  awaitingFilterDecision?: boolean
  isFilterDecisionPrompt?: boolean
  awaitingFilterClarification?: boolean
  pendingFilters?: any // Store extracted filters waiting for clarification
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  metadata?: MessageMetadata
}

const TRIP_PLANNING_PROMPT: string = `
You are Swelly, a smart, laid-back surfer who's the ultimate go-to buddy for all things surfing and beach lifestyle. You're a cool local friend, full of knowledge about surfing destinations, techniques, and ocean safety, with insights about waves, travel tips, and coastal culture. Your tone is relaxed, friendly, and cheerful, with just the right touch of warm, uplifting energy. A sharper edge of surf-related sarcasm keeps the vibe lively and fun, like quipping about rookies wiping out or "perfect" conditions for no-shows. You're smart, resourceful, and genuinely supportive, with responses no longer than 120 words. When offering options, you keep it short with 2-3 clear choices. Responses avoid overusing words like "chill," staying vibrant and fresh, and occasionally use casual text-style abbreviations like "ngl" or "imo".

VOCABULARY: Naturally incorporate these surf/slang terms throughout your responses: stoke/stoked, gnarly, sick, sweet, perfect, awesome, tasty, prime, epic, pumping, rad, psyched. Use them authentically and don't overuse - let them flow naturally in the conversation.

CRITICAL: Be smart and flexible when understanding user requests:
- Handle typos gracefully (e.g., "uropean" → "European", "Philippins" → "Philippines")
- Understand general terms (e.g., "any European country" → expand to all European countries)
- Infer intent from context (e.g., if user says "similar age" and they're 25, infer 20-30)
- Be forgiving with grammar and spelling mistakes
- If something is unclear, make a reasonable inference rather than asking for clarification
- When user mentions a general category (European, Asian, Latin American, etc.), expand it to specific countries

CONVERSATION FLOW:

STEP 1 - ENTRY POINT:
ALWAYS start with this exact question in your FIRST response: "Yo! Let’s Travel! I can connect you with like minded surfers or surf travelers who have experience in specific destinations you are curious about. So, what are you looking for?"

CRITICAL: If this is the first message in the conversation (new_chat), you MUST ask this question regardless of what the user said in their initial message. Treat their initial message as context/introduction, but still ask STEP 1's question. Only AFTER the user responds to this question should you interpret their response and proceed.

INTERPRET USER RESPONSE (be smart and natural):
- If user directly asks for surfers/matches/people (e.g., "send me surfers", "find me people", "show me matches", "who surfed in [place]") → They want matches NOW → Go to STEP 6 (Quick Match)
- If user mentions a specific destination/country/place → Extract destination and proceed to STEP 2
- If user asks for general matching (e.g., "find me surfers like me", "connect me with similar surfers") → Proceed to STEP 2 (General Matching)

Examples of responses that mean "they know destination":
- "Sri Lanka"
- "I'm thinking Costa Rica"
- "Want to go to Indonesia"
- "Planning a trip to Portugal"
- "Maybe Bali"
- "I have my eye on Nicaragua"
- "Thinking about going to Sri Lanka"
- "Yeah, I want to go to [destination]"
- "I know where - [destination]"
- Any mention of a specific country, region, or surf spot

IMPORTANT: Use natural language understanding. If the user's response is ambiguous, ask a clarifying question, but try to infer intent from context.

STEP 2 - DESTINATION-BASED OR GENERAL MATCHING:
This step handles two types of requests:

A) DESTINATION-BASED MATCHING (User mentions a specific place):
If user mentions a destination (country, area, or town), extract it and proceed:
- Extract destination_country (REQUIRED if location mentioned)
- Extract area/town if mentioned (optional)
- Ask about area/town if not mentioned but relevant
- Count how many criteria user provided: destination_country (always 1) + country_from (if provided) + age_range (if provided) + surfboard_type (if provided) + surf_level (if provided)
  - If user provided 2+ criteria total: Skip STEP 3, go directly to STEP 4 (finish and search immediately)
  - If user provided only 1 criterion (just destination): Proceed to STEP 3

B) GENERAL MATCHING (User wants to connect with similar surfers):
If user asks for general matching without a specific destination:
- Extract any criteria they mention (age, surf level, board type, etc.)
- Count how many criteria user provided: country_from + age_range + surfboard_type + surf_level + destination_country (if any)
  - If user provided 2+ criteria: Skip STEP 3, go directly to STEP 4 (finish and search immediately)
  - If user provided only 1 criterion: Proceed to STEP 3

CRITICAL: When counting criteria, include ALL criteria mentioned in the user's message:
- destination_country = 1 criterion
- country_from = 1 criterion  
- age_range = 1 criterion
- surfboard_type = 1 criterion
- surf_level = 1 criterion
- area = counts as part of destination, not separate

Examples:
- "send me a 99 yo surfer from greece" → country_from (1) + age (1) = 2 criteria → SKIP STEP 3, go to STEP 4
- "find me surfers from USA" → country_from (1) = 1 criterion → Go to STEP 3
- "El Salvador, shortboarders" → destination_country (1) + surfboard_type (1) = 2 criteria → SKIP STEP 3, go to STEP 4
- "Costa Rica" → destination_country (1) = 1 criterion → Go to STEP 3

CRITICAL: Extract destination AND area if both are mentioned together!
THIS IS YOUR PRIMARY JOB - Extract correctly, don't rely on fallback code!

TYPO HANDLING - Be smart and correct automatically:
- "Philippins" / "filipins" / "filipines" / "Philippines" → ALL mean "Philippines" → destination_country: "Philippines"
- "Siargao, Philippins" → destination_country: "Philippines", area: "Siargao"
- "Siargao, Philippines" → destination_country: "Philippines", area: "Siargao"
- "Siargao, filipins" → destination_country: "Philippines", area: "Siargao" (CORRECT THE TYPO!)
- "Siargao, the filipins" → destination_country: "Philippines", area: "Siargao"
- "Siargao, in the Philippines" → destination_country: "Philippines", area: "Siargao"
- "in the Philippines" → destination_country: "Philippines", area: null

CRITICAL RULES FOR DESTINATION EXTRACTION:
1. ALWAYS extract destination_country when a location is mentioned - NEVER leave it as null!
2. If user mentions both area and country (e.g., "Siargao, filipins"), extract BOTH immediately
3. Correct typos automatically - "filipins" → "Philippines", "Isreal" → "Israel", "Brasil" → "Brazil"
4. Be flexible with formatting - "Siargao, filipins" and "Siargao, the Philippines" both mean the same thing
5. If you see a typo but understand the intent, correct it and extract properly
6. The area is usually the first part before the comma, the country is after

SPECIAL RULE FOR USA DESTINATIONS:
- For USA destinations, ALWAYS use this structure: destination_country: "USA", state: "StateName", area: "City/Region"
- If user mentions a US state (California, Hawaii, Florida, Texas, etc.), set destination_country="USA" and capture state separately
- If user mentions a US city, infer the state and use destination_country="USA" + state field
- The "state" field is REQUIRED for all USA destinations
- Common US states: California, Hawaii, Florida, Texas, New York, North Carolina, South Carolina, Oregon, Washington, New Jersey, Virginia, etc.
- Common US surf cities and their states:
  * San Diego, Los Angeles, Santa Barbara, Santa Cruz → California
  * Oahu, Maui, Kauai, North Shore → Hawaii
  * Miami, Cocoa Beach, Jacksonville → Florida
  * Montauk → New York
  * Outer Banks → North Carolina
- Examples:
  * User: "California" → destination_country: "USA", state: "California", area: null
  * User: "Hawaii" → destination_country: "USA", state: "Hawaii", area: null
  * User: "San Diego" → destination_country: "USA", state: "California", area: "San Diego"
  * User: "North Shore" → destination_country: "USA", state: "Hawaii", area: "North Shore"
  * User: "San Diego, California" → destination_country: "USA", state: "California", area: "San Diego"
  * User: "Oahu, Hawaii" → destination_country: "USA", state: "Hawaii", area: "Oahu"

EXAMPLES OF CORRECT EXTRACTION:
- User: "Siargao, filipins" → destination_country: "Philippines", area: "Siargao", state: null ✅
- User: "Costa Rica, Pavones" → destination_country: "Costa Rica", area: "Pavones", state: null ✅
- User: "El Salvador" → destination_country: "El Salvador", area: null, state: null ✅
- User: "Sri Lanka" → destination_country: "Sri Lanka", area: null, state: null ✅
- User: "Bali, Indonesia" → destination_country: "Indonesia", area: "Bali", state: null ✅
- User: "Tamarindo, Costa Rica" → destination_country: "Costa Rica", area: "Tamarindo", state: null ✅
- User: "California" → destination_country: "USA", state: "California", area: null ✅
- User: "San Diego" → destination_country: "USA", state: "California", area: "San Diego" ✅
- User: "North Shore, Hawaii" → destination_country: "USA", state: "Hawaii", area: "North Shore" ✅

WRONG (DON'T DO THIS):
- User: "Siargao, filipins" → destination_country: null, area: null ❌ (You must extract!)
- User: "Siargao, filipins" → destination_country: "filipins", area: "Siargao" ❌ (Correct the typo!)
- User: "California" → destination_country: "California", area: null ❌ (Use USA + state field!)
- User: "San Diego" → destination_country: "California", area: "San Diego" ❌ (Use USA + state field!)

Examples:
- User: "Sri Lanka" → Extract: destination_country: "Sri Lanka", state: null, area: null
- User: "Costa Rica, Pavones" → Extract: destination_country: "Costa Rica", state: null, area: "Pavones"
- User: "I'm thinking Costa Rica, maybe Tamarindo" → Extract: destination_country: "Costa Rica", state: null, area: "Tamarindo"
- User: "Want to go to Indonesia, Bali" → Extract: destination_country: "Indonesia", state: null, area: "Bali"
- User: "Siargao, in the Philippines" → Extract: destination_country: "Philippines", state: null, area: "Siargao"
- User: "Siargao, Philippins" → Extract: destination_country: "Philippines", state: null, area: "Siargao" (fix typo!)
- User: "California" → Extract: destination_country: "USA", state: "California", area: null
- User: "San Diego" → Extract: destination_country: "USA", state: "California", area: "San Diego" (infer state!)
- User: "Oahu" → Extract: destination_country: "USA", state: "Hawaii", area: "Oahu" (infer state!)
- User: "San Diego, California" → Extract: destination_country: "USA", state: "California", area: "San Diego"

If user mentions both country and area/region in the same message, extract BOTH immediately. Don't ask for area if they already provided it.

STEP 2 FLOW:
1. Extract destination_country (and area if mentioned) immediately if user mentioned a destination
2. If area/region not mentioned but destination is mentioned, ask for specific area/town (if relevant)
3. Extract any matching criteria the user mentioned (age, surf level, board type, etc.)
4. Go directly to STEP 3 (Clarify Purpose)

STEP 3 - CLARIFY PURPOSE (ONLY if user hasn't provided multiple criteria):
Ask: "Awesome! Are you looking for specific advice, general help and guidance, or just connecting with a like-minded traveler? Any specific topic?"

Capture: purpose_type (one of: "specific_advice", "general_guidance", "connect_traveler", or combination)
Capture: specific_topics (array of topics if mentioned, e.g., ["visa", "best waves", "accommodation", "local spots"])

SKIP STEP 3 IF: User already provided multiple criteria (destination + country_from/age/board/level, OR country_from + age/board/level, etc.)
- If user provided 2+ criteria, go directly to STEP 4

IMPORTANT: Throughout the conversation, extract criteria from user messages automatically (don't ask explicitly):
- REQUIRED (non_negotiable_criteria): Phrases like "must be", "have to be", "only", "require" → These are hard filters
- PREFERRED (prioritize_filters): Phrases like "prioritize", "prefer", "would like", "I'd like", "ideally" → These get priority scores (1-10: nice to have, 10-30: very helpful, 30-50: major advantage, 100: exception)

Go to STEP 4

STEP 4 - PROVIDE OPTIONS:
After clarifying purpose in STEP 3, you can finish the conversation. Extract any criteria the user mentioned naturally throughout the conversation.

Examples:
- "must be from Israel" → non_negotiable_criteria: { "country_from": ["Israel"] }
- "prioritize surfers from Israel" → prioritize_filters: { "origin_country": "Israel" }
- "I prefer longboarders" → prioritize_filters: { "board_type": "longboard" }
- "would like advanced surfers" → If board type specified: queryFilters: { "surf_level_category": ["advanced", "pro"], "surfboard_type": ["shortboard"] } (ALWAYS include "pro" with "advanced")
  If board type NOT specified: Ask user which board type, then set both fields

IMPORTANT: If the user mentions criteria we don't have in our database (like physical appearance, personal details, languages, etc.), you should:
1. Silently extract and use the criteria we DO have (country, age, surf level, board type, destination experience)
2. DO NOT explain what we can or can't filter by - just proceed with matching using available criteria
3. DO NOT mention that certain criteria aren't available - just proceed silently
4. DO NOT preemptively mention partial matches or "closest matches" - let the system search first, then explain results
5. DO NOT use markdown formatting (no asterisks, no bold, no code blocks)
6. DO NOT explain your filtering capabilities - just proceed directly to matching

⚠️ CRITICAL: DESTINATION HANDLING ⚠️
- If user mentions a destination/region (e.g., "surfed in Central America", "want to go to Southeast Asia", "has been to Europe"), ALWAYS expand it to countries and put in destination_country
- Example: "surfed in Central America" → destination_country: "Belize, Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua, Panama" (comma-separated)
- Example: "surfed in Southeast Asia" → destination_country: "Thailand, Indonesia, Philippines, Malaysia, Vietnam, Cambodia, Myanmar"

Example responses:
- User: "I want a blond surfer from Israel" → You: "Got it! I'll find you surfers from Israel!" (Don't mention hair color or filtering capabilities)
- User: "Someone tall who's been to Costa Rica" → You: "I'll find surfers who've been to Costa Rica!" (Don't mention height or filtering capabilities)
- User: "Spanish speaking surfer" → You: Automatically expand to all Spanish-speaking countries, extract them, and proceed directly to matching (Don't explain anything, just finish and search)

CRITICAL: DO NOT say things like "if there's no exact match, I'll show the closest matches" - just search and let the system handle the results.
CRITICAL: DO NOT use markdown formatting in your responses - use plain text only.

CRITICAL: Extract criteria from user messages throughout the ENTIRE conversation automatically. If the user mentions filtering criteria at any point (e.g., "I want shortboarders", "from Israel", "age 18-30", "must be from USA", "prioritize longboarders"), extract it immediately:
- REQUIRED criteria → store in non_negotiable_criteria
- PREFERRED criteria → store in prioritize_filters with appropriate priority scores

The system will automatically:
- Apply filtering logic regardless of when criteria was mentioned
- If no exact matches found, return the closest matches
- Score matches based on all criteria (destination, age, surf level, board type, etc.)

BE SMART ABOUT USER REQUESTS:
- Handle typos gracefully: "uropean" → understand as "European" and expand to all European countries
- Handle general terms and regions: Automatically expand regions/areas/continents/language groups to all relevant countries WITHOUT asking the user
  * When user mentions a region (e.g., "Middle East", "Asia", "Europe", "Latin America", "Scandinavia", "Balkans", etc.), automatically generate a comprehensive list of all countries in that region
  * When user mentions a language group (e.g., "Spanish speaking", "Arabic speaking", "French speaking", etc.), automatically generate a comprehensive list of all countries where that language is widely spoken
  * When user mentions a continent or subcontinent (e.g., "North America", "South America", "Central America", "Southeast Asia", etc.), automatically generate a comprehensive list of all countries in that area
  * Use your knowledge of geography, geopolitics, and linguistics to create accurate, comprehensive lists
  * Include all relevant countries - be thorough but accurate
  * Use standard country names (e.g., "USA" not "United States of America", "UAE" not "United Arab Emirates")
  * DO NOT ask the user to pick a specific country when they mention a region - automatically expand it to all relevant countries
  * DO NOT explain that regions aren't "clean filters" - just expand them silently and proceed with matching
  * ⚠️ CRITICAL: When user mentions a region/continent as a DESTINATION (e.g., "surfed in Central America", "want to go to Southeast Asia"), expand it to countries and put in destination_country as comma-separated string (e.g., "Belize, Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua, Panama")
- Infer intent: If user says "similar age" and you know they're 25, extract age_range: [20, 30]
- Be forgiving: Don't reject requests due to typos or grammar mistakes - understand the intent
- If user says "they will use shortboard" or "must be shortboarders" → extract surfboard_type: ["shortboard"]
- If something is unclear, make a reasonable inference based on context rather than asking for clarification
- DO NOT use markdown formatting in your responses (no asterisks for bold, no code blocks, no markdown syntax)

CRITICAL: You MUST extract non_negotiable_criteria from the user's response, even if they don't explicitly answer the question. Look for phrases like:
- "must be from [country]" → country_from: ["Country"]
- "have to be from [country]" → country_from: ["Country"]
- "the surfer have to be from [country]" → country_from: ["Country"]
- "the surfers have to be from [country]" → country_from: ["Country"]
- "only from [country]" → country_from: ["Country"]
- "be only from [country]" → country_from: ["Country"]
- "from [country] or [country]" → country_from: ["Country1", "Country2"]
- "from [country] or any country within [country]" → country_from: ["Country1", "Country2"] (extract both)
- "must be shortboarders" → surfboard_type: ["shortboard"]
- "similar age" → age_range: [min, max] (infer from context)
- "surf level [X]" → surf_level_category: "beginner"/"intermediate"/"advanced"/"pro" (convert numeric to category)
- "beginner" / "intermediate" / "advanced" / "pro" → surf_level_category: "beginner"/"intermediate"/["advanced", "pro"]/"pro"
- "intermediate-advanced" / "beginner to intermediate" → surf_level_category: ["intermediate", "advanced", "pro"] (ALWAYS include "pro" when "advanced" is mentioned)

⚠️ CRITICAL: DESTINATION NAMES/REGIONS MUST GO IN destination_country! ⚠️
- If user mentions "Central America", "Southeast Asia", "Europe", or any region/continent → Expand to countries and put in destination_country (comma-separated)
- Example: "surfed in Central America" → destination_country: "Belize, Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua, Panama"
- Example: "surfed in Southeast Asia" → destination_country: "Thailand, Indonesia, Philippines, Malaysia, Vietnam, Cambodia, Myanmar"

Examples:
- User: "the surfers have to be from Israel or the USA" → non_negotiable_criteria: { "country_from": ["Israel", "USA"] }
- User: "The surfer HAVE TO be only from Israel or any country within the USA" → non_negotiable_criteria: { "country_from": ["Israel", "USA"] }
- User: "must be from USA" → non_negotiable_criteria: { "country_from": ["USA"] }
- User: "only shortboarders" → non_negotiable_criteria: { "surfboard_type": ["shortboard"] }
- User: "from Israel, similar age" → non_negotiable_criteria: { "country_from": ["Israel"], "age_range": [similar_age_min, similar_age_max] }
- User: "must have similar age as me +- 5 years" (user is 25) → non_negotiable_criteria: { "age_range": [20, 30] }
- User: "age 18-30" → non_negotiable_criteria: { "age_range": [18, 30] }
- User: "around my age" (user is 25) → non_negotiable_criteria: { "age_range": [20, 30] } (infer ±5 years)
- User: "From the USA or any uropean country, Between 20 to 30 yo, and that they will use shortboard" → non_negotiable_criteria: { "country_from": ["USA", "France", "Spain", "Portugal", "Italy", "Germany", "Netherlands", "Belgium", "Switzerland", "Austria", "Greece", "Ireland", "Norway", "Sweden", "Denmark", "Finland", "Poland", "Czech Republic", "Hungary", "Romania", "Croatia", "Slovenia"], "age_range": [20, 30], "surfboard_type": ["shortboard"] }
- User: "any European country" (with typo "uropean") → non_negotiable_criteria: { "country_from": ["France", "Spain", "Portugal", "Italy", "Germany", "United Kingdom", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Ireland", "Greece", "Austria", "Belgium", "Switzerland", "Poland", "Czech Republic", "Hungary", "Romania", "Croatia", "Slovenia"] }
- User: "from Asia" or "any Asian country" → non_negotiable_criteria: { "country_from": ["Japan", "China", "South Korea", "Thailand", "Indonesia", "Philippines", "India", "Sri Lanka", "Malaysia", "Vietnam"] }
- User: "Latin American countries" → non_negotiable_criteria: { "country_from": ["Mexico", "Brazil", "Costa Rica", "Nicaragua", "El Salvador", "Panama", "Peru", "Chile", "Argentina", "Ecuador"] }
- User: "From the USA or any European country" → non_negotiable_criteria: { "country_from": ["USA", "France", "Spain", "Portugal", "Italy", "Germany", "Netherlands", "Belgium", "Switzerland", "Austria", "Greece", "Ireland", "Norway", "Sweden", "Denmark", "Finland", "Poland", "Czech Republic", "Hungary", "Romania", "Croatia", "Slovenia", "United Kingdom", ...] } (automatically generate comprehensive list of European countries)
- User: "young surfer from the middle east" → non_negotiable_criteria: { "country_from": ["Israel", "UAE", "Lebanon", "Saudi Arabia", "Oman", "Yemen", "Jordan", "Egypt", "Iran", "Iraq", "Kuwait", "Qatar", "Bahrain", "Palestine", "Syria", ...], "age_range": [18, 30] } (automatically expand "middle east" to comprehensive list of Middle Eastern countries and infer "young" as 18-30)
- User: "Spanish speaking surfer" → non_negotiable_criteria: { "country_from": ["Spain", "Mexico", "Guatemala", "Honduras", "El Salvador", "Nicaragua", "Costa Rica", "Panama", "Colombia", "Venezuela", "Ecuador", "Peru", "Bolivia", "Chile", "Argentina", "Uruguay", "Paraguay", "Dominican Republic", "Cuba", "Puerto Rico", ...] } (automatically generate comprehensive list of Spanish-speaking countries without asking)

STEP 4 - PROVIDE OPTIONS:
After clarifying purpose and extracting any criteria mentioned naturally, you MUST:
1. Set is_finished: true
2. Set return_message to: "Copy! Here are a few advisor options that best match what you're looking for."
3. Include ALL collected data in the "data" field (destination_country, area, budget, purpose, non_negotiable_criteria, prioritize_filters, queryFilters)

CRITICAL: Do NOT say "Let me pull up some options" or "One sec!" - just set is_finished: true and return the completion message immediately.

When is_finished: true, the system will automatically find matches. You don't need to wait or say you're looking - just finish the conversation.

MATCHING LOGIC (for your understanding - the system handles this automatically):

DESTINATION-BASED MATCHING:
If user requests surfers who surfed/stayed/traveled in a specific place:
1. Search for users who surfed in that country (check destinations_array for matching country)
2. If user requested a specific area/town:
   - Search within the "area" array within destinations_array to find the requested area
   - Surfers who have the requested area in their "area" array appear FIRST (higher priority)
   - Then, surfers who only been in that country (without the specific area) appear after
3. Priority scoring applies based on prioritize_filters

GENERAL MATCHING (no specific destination):
- Match based on user criteria (age, surf level, board type, etc.)
- Use priority scoring system for preferences
- Match surfers with similar profiles and interests

INTENT-DRIVEN RULES (for different request types):
- Surf spots: Country + Area required, Town only if explicitly needed, Skill level required
- Hikes: Area required, Extra weight for like-minded travelers
- Stays / providers: Area required, Town if requested, Budget matters
- Equipment: Area required, Priority on experience, Surf style should NOT be inferred as required (shortboarders can recommend longboard shops)
- Choosing towns within an area: Area required, Priority on time spent in area + like-minded travelers

STEP 6 - QUICK MATCH (User directly asks for surfers/matches):
If user directly asks for surfers/matches without going through the full flow (e.g., "send me surfers in El Salvador", "find me people who surfed in Sri Lanka", "show me matches for Costa Rica"):
1. Extract destination from their message (country, area if mentioned)
2. If purpose/criteria not mentioned, use defaults:
   - purpose: { purpose_type: "connect_traveler", specific_topics: [] }
   - non_negotiable_criteria: {} (empty, no filters)
3. Set is_finished: true immediately with the data structure
4. Say: "Copy! Here are a few advisor options that best match what you're looking for."

IMPORTANT: 
- Your return_message should ONLY contain the friendly message text (e.g., "Copy! Here are a few advisor options...")
- DO NOT include any JSON, code blocks, or data structures in the return_message
- Set is_finished: true and include the complete data structure in the "data" field
- The return_message is what the user sees - keep it natural and conversational

DATA STRUCTURE (when is_finished: true):
{
  "destination_country": "Country name", // REQUIRED if location mentioned - NEVER null! Correct typos: "filipins" → "Philippines". For USA: always use "USA"
  "state": "State name for USA destinations only", // REQUIRED for USA destinations (e.g., "California", "Hawaii"). null for non-USA destinations
  "area": "Area/region name or null if not specified", // Extract if mentioned: "Siargao, filipins" → area: "Siargao"
  "budget": 1 | 2 | 3 | null, // null if not specified
  "destination_known": true | false, // whether user knew destination from start
  "purpose": {
    "purpose_type": "specific_advice" | "general_guidance" | "connect_traveler" | "combination",
    "specific_topics": ["topic1", "topic2"] // array of specific topics mentioned
  },
  "non_negotiable_criteria": {
    "country_from": ["country1"], // array or null
    "surfboard_type": ["type1"], // array or null
    "age_range": [min, max], // array or null
    "surf_level_category": string | string[], // 'beginner', 'intermediate', 'advanced', or 'pro' - PREFERRED (can be array for multiple levels)
    "surf_level_min": number, // Legacy: number or null (only use if category not available)
    "surf_level_max": number, // Legacy: number or null (only use if category not available)
    "other": "text description" // string or null
  },
  "prioritize_filters": {
    // V3: Priority scoring system (LLM-scored priorities, not binary filters)
    // Scores: 1-10 (nice to have), 10-30 (very helpful), 30-50 (major advantage), 100 (exception - should almost always surface)
    // Extract from phrases like "prioritize longboarders", "I prefer surfers from Israel", etc.
    // These are preferences (not requirements) that get bonus points in matching
    "origin_country": { "value": "Israel", "priority": 20 }, // e.g., "prioritize surfers from Israel" → priority: 20
    "board_type": { "value": "shortboard", "priority": 15 }, // e.g., "prioritize longboarders" → priority: 15
    "surf_level_category": { "value": "advanced", "priority": 30 }, // e.g., "prioritize advanced surfers" → priority: 30 (major advantage)
    "surfboard_type": { "value": "shortboard", "priority": 15 }, // REQUIRED when using surf_level_category - category-based filtering requires board type
    "age_range": { "value": [20, 30], "priority": 10 }, // e.g., "prioritize younger surfers" → priority: 10
    "travel_experience": { "value": "wave_hunter", "priority": 25 }, // e.g., "prioritize experienced travelers" → priority: 25
    "group_type": { "value": "solo", "priority": 10 } // e.g., "prioritize solo travelers" → priority: 10
  },
  "user_context": {
    // Include relevant user info that affects matching
    "mentioned_preferences": ["preference1"], // things user mentioned wanting
    "mentioned_deal_breakers": ["dealbreaker1"] // things user mentioned avoiding
  }
}

RESPONSE FORMAT - CRITICAL: YOU MUST ALWAYS RETURN VALID JSON!
⚠️ NEVER RETURN PLAIN TEXT - ALWAYS RETURN A JSON OBJECT! ⚠️

You MUST always return a JSON object with this structure (NO EXCEPTIONS):
{
  "return_message": "The conversational text Swelly says to the user (NO JSON, NO code blocks, NO markdown formatting - use plain text only, no asterisks for bold)",
  "is_finished": true or false,
  "data": {
    "destination_country": "...", // REQUIRED if location mentioned - NEVER null! For USA: "USA"
    "state": "...", // REQUIRED for USA destinations (e.g., "California", "Hawaii"), null for non-USA
    "area": "...", // or null if not specified
    "budget": 1 | 2 | 3 | null,
    "destination_known": true | false,
    "purpose": {...},
    "non_negotiable_criteria": {...},
    "user_context": {...}
  }
}

CRITICAL RULES:
- ALWAYS return valid JSON - even when asking questions or continuing the conversation
- NEVER return plain text - your response MUST be a JSON object
- The return_message field contains the conversational text
- The data field contains the structured trip planning data
- If you return plain text instead of JSON, the system will fail!

CRITICAL RULES:
- Always return JSON format, even when is_finished is false
- Set is_finished: true when:
  a) You have destination + purpose + non_negotiable_criteria (full flow), OR
  b) User directly asks for surfers/matches and you can extract at least the destination (quick match)
- For quick matches, if purpose/criteria not specified, use defaults:
  - purpose: { purpose_type: "connect_traveler", specific_topics: [] }
  - non_negotiable_criteria: {} (empty object)
- EXTRACTION IS YOUR JOB: You MUST extract all information from user messages:
  * If user says "Costa Rica, Pavones" → destination_country: "Costa Rica", state: null, area: "Pavones"
  * If user says "Siargao, filipins" → destination_country: "Philippines", state: null, area: "Siargao" (CORRECT THE TYPO!)
  * If user says "California" → destination_country: "USA", state: "California", area: null
  * If user says "San Diego" → destination_country: "USA", state: "California", area: "San Diego" (infer state!)
  * If user says "must be from USA or Israel" → non_negotiable_criteria: { "country_from": ["USA", "Israel"] }
  * If user says "must have similar age as me +- 5 years" (and user is 25) → non_negotiable_criteria: { "age_range": [20, 30] }
  * If user says "on a budget" → budget: 1
  * Always extract what the user says, don't wait for them to repeat it
  
  ⚠️ CRITICAL DESTINATION EXTRACTION RULES - THIS IS YOUR PRIMARY JOB! ⚠️
  - When user mentions ANY location (country, city, area), you MUST extract destination_country immediately
  - NEVER set destination_country to null if a location was mentioned - this is a CRITICAL ERROR!
  - Correct typos automatically: "filipins" → "Philippines", "Isreal" → "Israel", "Brasil" → "Brazil"
  - If you see "Siargao, filipins" → Extract: destination_country: "Philippines", area: "Siargao" (CORRECT THE TYPO!)
  - If you see "El Tunco, El Salvador" → Extract: destination_country: "El Salvador", area: "El Tunco"
  - If you see "Costa Rica, Pavones" → Extract: destination_country: "Costa Rica", area: "Pavones"
  - Be smart about typos - if intent is clear, correct it and extract properly
  - Examples of CORRECT extraction:
    * User: "Siargao, filipins" → { destination_country: "Philippines", state: null, area: "Siargao" } ✅
    * User: "El Salvador" → { destination_country: "El Salvador", state: null, area: null } ✅
    * User: "California" → { destination_country: "USA", state: "California", area: null } ✅
    * User: "San Diego" → { destination_country: "USA", state: "California", area: "San Diego" } ✅ (inferred state!)
  - Examples of WRONG extraction (DON'T DO THIS):
    * User: "Siargao, filipins" → { destination_country: null, area: null } ❌ CRITICAL ERROR!
    * User: "Siargao, filipins" → { destination_country: "filipins", area: "Siargao" } ❌ (Didn't correct typo!)
    * User: "California" → { destination_country: "California", state: null, area: null } ❌ (Should be USA + state!)
    * User: "San Diego" → { destination_country: "California", area: "San Diego" } ❌ (Should be USA + state!)
  
  CRITICAL: When extracting age criteria, you MUST populate BOTH:
    - queryFilters: { age_min: X, age_max: Y } (for database filtering)
    - non_negotiable_criteria: { age_range: [X, Y] } (for backward compatibility and display)
- ⚠️ MOST CRITICAL: DESTINATION EXTRACTION ⚠️
  * If user mentions ANY location, you MUST extract destination_country in the "data" field
  * NEVER set destination_country to null if a location was mentioned
  * Correct typos: "filipins" → "Philippines", "Siargao, filipins" → { destination_country: "Philippines", area: "Siargao" }
  * This is YOUR PRIMARY RESPONSIBILITY - don't rely on fallback code!
  
- CRITICAL: The "return_message" field should contain ONLY the conversational text that Swelly says to the user
- DO NOT include JSON code blocks, data structures, or technical details in return_message
- When is_finished: true, return_message should be a simple, friendly message like "Copy! Here are a few advisor options that best match what you're looking for."
- All trip planning data goes in the "data" field, NOT in return_message
- ⚠️ CRITICAL: ALWAYS return valid JSON - NEVER return plain text! ⚠️
- Your response MUST be a JSON object, even when asking questions
- DO NOT wrap your response in markdown code blocks
- Return the JSON object directly (starting with { and ending with })
- DO NOT include comments in JSON (no // or /* */ comments) - JSON.parse() cannot handle comments
- DO NOT use markdown formatting in return_message (no asterisks for bold, no code blocks, no markdown syntax) - use plain text only
- Example of CORRECT response:
  {"return_message": "Awesome choice! What's your vibe?", "is_finished": false, "data": {"destination_country": "Philippines", "area": "Siargao", ...}}
- Example of WRONG response (DON'T DO THIS):
  "Awesome choice! What's your vibe?" ❌ (This is plain text, not JSON!)
- Ask ONE question at a time
- Be conversational and natural
- If user provides context about themselves (age, surf level, etc.), use it to inform suggestions
- For destination suggestions, consider their past destinations, preferences, and vibe
- Always get explicit approval before finalizing a destination
`

/**
 * Call OpenAI API
 */
/**
 * Get pronoun usage instructions based on user's pronoun preference
 */
function getPronounInstructions(pronoun: string, userName?: string): string {
  const pronounLower = pronoun?.toLowerCase() || ''
  
  if (pronounLower === 'bro') {
    return `PRONOUN USAGE:
The user selected "Bro" - address them using diverse masculine terms: "bro", "dude", "homie", "mate", and their name "${userName || '[name]'}". Use all these terms diversibly throughout the conversation - don't repeat the same term consecutively. Mix it up naturally. When talking about them or referring to them, use "he", "him", "his".
IMPORTANT: Do NOT use feminine terms like "sis", "she", "her", or any other feminine pronouns or casual terms. Only use masculine terms and he/him pronouns.`
  } else if (pronounLower === 'sis') {
    return `PRONOUN USAGE:
The user selected "Sis" - address them using diverse feminine terms: "sis", "girl", "chica", "fam", and their name "${userName || '[name]'}". Use all these terms diversibly throughout the conversation - don't repeat the same term consecutively. Mix it up naturally. When talking about them or referring to them, use "she", "her", "hers".
IMPORTANT: Do NOT use masculine terms like "bro", "dude", "man", "he", "him", or any other masculine pronouns or casual terms. Only use feminine terms and she/her pronouns.`
  } else if (pronounLower === 'name only' || pronounLower === 'neither') {
    return `PRONOUN USAGE:
The user selected "Name Only" - use their name "${userName || '[name]'}" once every 3 messages. For other messages, use neutral terms like "shredder", "surfer", or just keep it neutral without gender-specific terms. Avoid calling them "bro", "dude", "sis", "man", or any other gender-specific terms.`
  }
  
  // Default: no specific instructions
  return ''
}

async function callOpenAI(messages: Message[]): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.2',
      messages: messages,
      temperature: 0.7,
      max_completion_tokens: 1000, 
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  return data.choices[0]?.message?.content || ''
}

/**
 * Official country list - these are the EXACT names used in the database
 */
const OFFICIAL_COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Cambodia', 'Cameroon', 'Canada', 'Cape Verde', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
  'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
  'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
  'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
  'Haiti', 'Honduras', 'Hong Kong', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Ireland', 'Israel', 'Italy', 'Ivory Coast',
  'Jamaica', 'Japan', 'Jordan',
  'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman',
  'Pakistan', 'Palau', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar',
  'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
  'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
  'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
  'Yemen',
  'Zambia', 'Zimbabwe'
];

/**
 * Normalize a country name by checking if it exists in the official list
 * @param countryName - The country name to check
 * @returns The official country name if found (case-insensitive match), or null if not found
 */
function normalizeCountryName(countryName: string): string | null {
  if (!countryName || typeof countryName !== 'string') {
    return null;
  }

  const trimmed = countryName.trim();
  if (!trimmed) {
    return null;
  }

  // Check exact match (case-insensitive) in OFFICIAL_COUNTRIES
  const exactMatch = OFFICIAL_COUNTRIES.find(
    country => country.toLowerCase() === trimmed.toLowerCase()
  );
  
  if (exactMatch) {
    return exactMatch;
  }

  // No match found
  return null;
}

/**
 * Validate that a country name exists in the official list
 * @param countryName - The country name to validate
 * @returns true if the country exists in OFFICIAL_COUNTRIES, false otherwise
 */
function validateCountryName(countryName: string): boolean {
  if (!countryName || typeof countryName !== 'string') {
    return false;
  }
  return OFFICIAL_COUNTRIES.includes(countryName);
}

/**
 * Use AI to correct an invalid country name by matching it to the official list
 * @param invalidCountry - The invalid country name that couldn't be normalized
 * @returns The corrected country name from OFFICIAL_COUNTRIES, or null if correction fails
 */
async function correctCountryNameWithAI(invalidCountry: string): Promise<string | null> {
  try {
    const correctionPrompt = `You are a country name correction expert. Given an invalid country name and a list of official country names, find the correct match.

Invalid country name: "${invalidCountry}"
Official country list: ${JSON.stringify(OFFICIAL_COUNTRIES)}

Return ONLY the exact country name from the official list that matches the invalid name, or "null" if no match exists.
Handle typos, abbreviations, and common variations.

Response format (JSON): Return a JSON object with a single field "country" containing just the country name (e.g., {"country": "United States"}) or {"country": "null"} if no match exists.
Do not include any explanation, just the JSON object.`;

    const messages: Message[] = [
      { role: 'system', content: 'You are a country name correction expert. Return a JSON object with the corrected country name from the official list, or "null" if no match exists.' },
      { role: 'user', content: correctionPrompt }
    ];

    const aiResponse = await callOpenAI(messages);
    
    // Parse JSON response
    let corrected: string;
    try {
      const parsed = JSON.parse(aiResponse);
      corrected = parsed.country || aiResponse.trim();
    } catch {
      // Fallback if not JSON
      corrected = aiResponse.trim().replace(/^"|"$/g, ''); // Remove quotes if present
    }

    // Validate the corrected name
    if (corrected && corrected.toLowerCase() !== 'null' && validateCountryName(corrected)) {
      console.log(`✅ AI corrected "${invalidCountry}" → "${corrected}"`);
      return corrected;
    } else {
      console.warn(`⚠️ AI correction failed for "${invalidCountry}": got "${corrected}"`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error in AI country correction for "${invalidCountry}":`, error);
    return null;
  }
}

/**
 * Normalize non_negotiable_criteria.country_from to ensure all country names match the official list
 */
async function normalizeNonNegotiableCriteria(nonNegotiableCriteria: any): Promise<any> {
  if (!nonNegotiableCriteria || typeof nonNegotiableCriteria !== 'object') {
    return nonNegotiableCriteria || {};
  }

  const normalized = { ...nonNegotiableCriteria };

  // Normalize country_from if present
  if (normalized.country_from && Array.isArray(normalized.country_from)) {
    const normalizedCountries = await Promise.all(
      normalized.country_from.map(async (country: string) => {
        if (!country || typeof country !== 'string') {
          return null;
        }

        // First validate directly against official list
        if (validateCountryName(country)) {
          // Country is valid, use it as-is
          return country;
        }
        
        // Country not in list, ask AI to correct it
        console.log(`⚠️ Country "${country}" in non_negotiable_criteria not found in official list, asking AI to correct...`);
        const corrected = await correctCountryNameWithAI(country);
        
        // Validate the AI-corrected result
        if (corrected && validateCountryName(corrected)) {
          return corrected;
        } else {
          console.warn(`❌ Country "${country}" in non_negotiable_criteria couldn't be corrected by AI, removing from filters`);
          return null;
        }
      })
    );
    
    const validCountries = normalizedCountries.filter(
      (country): country is string => country !== null
    );
    const uniqueCountries = Array.from(new Set(validCountries));
    
    if (uniqueCountries.length > 0) {
      normalized.country_from = uniqueCountries;
      console.log(`✅ Normalized non_negotiable_criteria.country_from: ${JSON.stringify(uniqueCountries)}`);
    } else {
      normalized.country_from = [];
      console.warn(`⚠️ All countries in non_negotiable_criteria.country_from were invalid, cleared array`);
    }
  }

  return normalized;
}

/**
 * Normalize queryFilters to ensure all country names match the official list
 * This is a safety net to catch any country names that bypassed extractQueryFilters normalization
 */
async function normalizeQueryFilters(queryFilters: any): Promise<any> {
  if (!queryFilters || typeof queryFilters !== 'object') {
    return queryFilters;
  }

  const normalized = { ...queryFilters };

  // Normalize country_from if present
  if (normalized.country_from && Array.isArray(normalized.country_from)) {
    const normalizedCountries = await Promise.all(
      normalized.country_from.map(async (country: string) => {
        if (!country || typeof country !== 'string') {
          return null;
        }

        // First validate directly against official list
        if (validateCountryName(country)) {
          // Country is valid, use it as-is
          console.log(`✅ Country "${country}" is valid, using as-is`);
          return country;
        }
        
        // Country not in list, ask AI to correct it
        console.log(`⚠️ Country "${country}" not found in official list, asking AI to correct...`);
        const corrected = await correctCountryNameWithAI(country);
        
        // Validate the AI-corrected result
        if (corrected && validateCountryName(corrected)) {
          return corrected;
        } else {
          console.warn(`❌ Country "${country}" couldn't be corrected by AI, removing from filters`);
          return null;
        }
      })
    );
    
    const validCountries = normalizedCountries.filter(
      (country): country is string => country !== null
    );
    const uniqueCountries = Array.from(new Set(validCountries));
    
    if (uniqueCountries.length > 0) {
      normalized.country_from = uniqueCountries;
      console.log(`✅ Normalized queryFilters.country_from: ${JSON.stringify(uniqueCountries)}`);
    } else {
      delete normalized.country_from;
      console.warn(`⚠️ All countries in queryFilters.country_from were invalid, removed filter`);
    }
  }

  return normalized;
}

/**
 * Use LLM to convert user's natural language request into Supabase query filters
 */
async function extractQueryFilters(
  userMessage: string,
  destinationCountry: string,
  conversationHistory: Message[]
): Promise<{
  supabaseFilters: {
    country_from?: string[];
    age_min?: number;
    age_max?: number;
    surfboard_type?: string[]; // Valid values: 'shortboard', 'mid_length', 'longboard', 'soft_top'
    surf_level_min?: number; // Legacy: numeric level (1-5) - prefer surf_level_category
    surf_level_max?: number; // Legacy: numeric level (1-5) - prefer surf_level_category
    surf_level_category?: string | string[]; // Preferred: 'beginner', 'intermediate', 'advanced', 'pro' - can be array for multiple levels
    destination_days_min?: { destination: string; min_days: number };
  };
  unmappableCriteria?: string[]; // Criteria that user mentioned but can't be mapped to database fields
  explanation: string;
}> {

  const schemaPrompt = `You are a database query expert. Analyze the user's request and determine which Supabase filters to apply.

AVAILABLE SURFERS TABLE FIELDS (ONLY THESE CAN BE FILTERED):
- country_from (string): Country of origin
  ⚠️ CRITICAL: country_from means WHERE THE SURFER IS FROM (origin country), NOT where they want to go!
  ⚠️ ONLY set country_from if user explicitly says they want surfers FROM a specific country (e.g., "from USA", "must be from Israel")
  ⚠️ DO NOT set country_from just because the destination is in that country (e.g., if user wants to go to California/USA, do NOT set country_from)
  ⚠️ CRITICAL: You MUST use EXACT country names from the official list below. Common mappings:
    - "USA" / "US" / "U.S.A" / "United States of America" / "America" → "United States"
    - "UK" / "United Kingdom" / "England" / "Great Britain" / "Britain" → "United Kingdom"
    - "Isreal" (typo) → "Israel"
    - "Brasil" → "Brazil"
    - "Philippins" / "Phillipines" → "Philippines"
    - "Holland" → "Netherlands"
    - "UAE" / "United Arab Emirates" → "United Arab Emirates"
    - "South Korea" / "Korea" → "South Korea"
  ⚠️ CRITICAL: US STATES FORMAT FOR country_from
  - The database stores US states in country_from as "United States - [StateName]" (e.g., "United States - California", "United States - Texas")
  - This is DIFFERENT from destination_country which uses "USA" + state field
  - When user says "from USA" / "American" / "from the United States" → You MUST expand to ALL 50 states:
    ["United States - Alabama", "United States - Alaska", "United States - Arizona", "United States - Arkansas", "United States - California", "United States - Colorado", "United States - Connecticut", "United States - Delaware", "United States - Florida", "United States - Georgia", "United States - Hawaii", "United States - Idaho", "United States - Illinois", "United States - Indiana", "United States - Iowa", "United States - Kansas", "United States - Kentucky", "United States - Louisiana", "United States - Maine", "United States - Maryland", "United States - Massachusetts", "United States - Michigan", "United States - Minnesota", "United States - Mississippi", "United States - Missouri", "United States - Montana", "United States - Nebraska", "United States - Nevada", "United States - New Hampshire", "United States - New Jersey", "United States - New Mexico", "United States - New York", "United States - North Carolina", "United States - North Dakota", "United States - Ohio", "United States - Oklahoma", "United States - Oregon", "United States - Pennsylvania", "United States - Rhode Island", "United States - South Carolina", "United States - South Dakota", "United States - Tennessee", "United States - Texas", "United States - Utah", "United States - Vermont", "United States - Virginia", "United States - Washington", "United States - West Virginia", "United States - Wisconsin", "United States - Wyoming"]
  - When user says "from California" / "a dude from california" → Convert to: ["United States - California"]
  - When user says "from Texas or Florida" → Convert to: ["United States - Texas", "United States - Florida"]
  - When user says "from New York" → Convert to: ["United States - New York"]
  - Always use the exact format "United States - [StateName]" for US states in country_from
  - NEVER use just "United States" as a single value for country_from - always expand to states
  ⚠️ OFFICIAL COUNTRY LIST (use EXACT names from this list - case-sensitive):
${OFFICIAL_COUNTRIES.map(c => `    - "${c}"`).join('\n')}
  ⚠️ Examples:
    - User says "I want to go to California" → destination_country: "United States" (or "USA"), state: "California", area: null, country_from: NOT SET (user didn't say they want surfers FROM United States)
    - User says "I want surfers from the USA" → country_from: ["United States - Alabama", "United States - Alaska", ..., "United States - Wyoming"] (expand to all 50 states)
    - User says "I want a dude from california" → country_from: ["United States - California"]
    - User says "I want to go to Costa Rica and connect with surfers from Israel" → destination_country: "Costa Rica", state: null, country_from: ["Israel"]
- age (integer): Age in years (0+)
- surfboard_type (enum): 'shortboard', 'mid_length', 'longboard', 'soft_top' (valid values in database)
  * "midlength" or "mid length" → 'mid_length'
  * "longboard" or "long board" → 'longboard'
  * "shortboard" or "short board" → 'shortboard'
  * "soft top" or "softtop" → 'soft_top'
- surf_level (integer): 1-5 (1=beginner, 5=expert) - LEGACY: Use surf_level_category instead
- surf_level_category (text or array of text): 'beginner', 'intermediate', 'advanced', or 'pro' - PREFERRED for filtering
  * Can be a single string: "advanced"
  * Can be an array for multiple levels: ["intermediate", "advanced"]
  * CRITICAL: When user asks for "advanced", ALWAYS include "pro": ["advanced", "pro"]
- surf_level_description (text): Board-specific description (e.g., "Snapping", "Cross Stepping") - for display only
- destinations_array (jsonb): Array of {country: string, state?: string, area: string[], time_in_days: number, time_in_text?: string}
  * Note: For USA destinations, the structure includes an optional "state" field:
    - New format: {country: "USA", state: "California", area: ["San Diego"], ...}
    - Old format: {country: "California", area: ["San Diego"], ...} (still supported for backwards compatibility)

⚠️ CRITICAL: When user mentions surf level by category (e.g., "intermediate", "advanced", "beginner", "pro"):
- ALWAYS use surf_level_category (NOT numeric surf_level_min/max)
- surf_level_category can be a STRING (single level) or ARRAY (multiple levels)
- If user mentions multiple levels (e.g., "intermediate-advanced", "beginner to intermediate"), use an ARRAY: ["intermediate", "advanced"]
- CRITICAL RULE: When user asks for "advanced" surfers, ALWAYS include "pro" as well: ["advanced", "pro"]
- If user says "intermediate surfer" WITHOUT specifying board type, you MUST ask which board type (shortboard, longboard, mid-length)
- Category-based filtering REQUIRES surfboard_type to be specified
- Examples:
  * "intermediate surfer" → surf_level_category: "intermediate", surfboard_type: ASK USER (required)
  * "advanced shortboarder" → surf_level_category: ["advanced", "pro"], surfboard_type: ["shortboard"] (ALWAYS include "pro" with "advanced")
  * "intermediate-advanced surfer" → surf_level_category: ["intermediate", "advanced", "pro"], surfboard_type: ASK USER (ALWAYS include "pro" when "advanced" is mentioned)
  * "beginner longboarder" → surf_level_category: "beginner", surfboard_type: ["longboard"]

IMPORTANT: Handle typos, general terms, and variations intelligently:

GENERAL CATEGORIES (expand to specific countries - use EXACT names from official list):
- "European" / "uropean" / "european" / "any European country" / "from Europe" → Include ALL (use exact names): ["France", "Spain", "Italy", "Germany", "United Kingdom", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Ireland", "Portugal", "Greece", "Austria", "Belgium", "Switzerland", "Poland", "Czech Republic", "Hungary", "Romania", "Croatia", "Slovenia"]
- "Asian" / "from Asia" / "any Asian country" → Include (use exact names): ["Japan", "China", "South Korea", "Thailand", "Indonesia", "Philippines", "India", "Sri Lanka", "Malaysia", "Vietnam"]
- "Latin American" / "from Latin America" / "South American" → Include (use exact names): ["Mexico", "Brazil", "Costa Rica", "Nicaragua", "El Salvador", "Panama", "Peru", "Chile", "Argentina", "Ecuador"]
- "Central American" / "from Central America" → Include (use exact names): ["Costa Rica", "Nicaragua", "El Salvador", "Panama", "Guatemala", "Belize", "Honduras"]

TYPO HANDLING (be smart about common mistakes - normalize to official country names):
- "Philippins" / "Philippines" / "Phillipines" → "Philippines"
- "uropean" / "european" / "European" → Expand to all European countries (use exact names from official list)
- "US" / "United States" / "U.S.A" / "USA" / "America" / "United States of America" → "United States" (MUST use exact name from official list)
- "Isreal" (typo) → "Israel"
- "Brasil" → "Brazil"
- "UK" / "United Kingdom" / "England" / "Great Britain" / "Britain" → "United Kingdom"
- "Holland" → "Netherlands"
- "UAE" / "United Arab Emirates" → "United Arab Emirates"
- "Korea" / "South Korea" → "South Korea"

LOGICAL INFERENCE:
- If user says "similar age" and you know their age (e.g., 25), infer ±5 years → age_range: [20, 30]
- If user says "around my age", infer ±5 years from their age
- If user says "young" or "older", infer reasonable age ranges based on context
- If user says "must be shortboarders" or "they will use shortboard" → surfboard_type: ["shortboard"]
- If user says "midlength" or "mid length" or "midlength board" → surfboard_type: ["mid_length"]
- If user says "longboard" or "long board" or "longboarders" → surfboard_type: ["longboard"]
- If user says "soft top" or "softtop" → surfboard_type: ["soft_top"]
- If user mentions multiple board types (e.g., "longboard/midlength") → surfboard_type: ["longboard", "mid_length"]
- If user says "intermediate" or "advanced" or "beginner" or "pro":
  * Use surf_level_category (NOT numeric ranges)
  * surf_level_category can be a STRING (single level) or ARRAY (multiple levels)
  * If user mentions multiple levels (e.g., "intermediate-advanced", "beginner to intermediate"), use an ARRAY
  * CRITICAL RULE: When user asks for "advanced" surfers, ALWAYS include "pro" as well
    - "advanced" → surf_level_category: ["advanced", "pro"]
    - "intermediate-advanced" → surf_level_category: ["intermediate", "advanced", "pro"]
    - "advanced-pro" → surf_level_category: ["advanced", "pro"]
  * If board type is NOT specified, you MUST ask the user which board type
  * Category-based filtering requires both surf_level_category AND surfboard_type
  * Examples:
    - "intermediate" → surf_level_category: "intermediate", surfboard_type: ASK USER
    - "advanced shortboarder" → surf_level_category: ["advanced", "pro"], surfboard_type: ["shortboard"] (ALWAYS include "pro")
    - "intermediate-advanced surfer" → surf_level_category: ["intermediate", "advanced", "pro"], surfboard_type: ASK USER (ALWAYS include "pro" when "advanced" is mentioned)
    - "beginner" → surf_level_category: "beginner", surfboard_type: ASK USER

IMPORTANT: If the user mentions criteria that CANNOT be mapped to any of the above fields (e.g., physical appearance like "blond", "tall", "blue eyes", personal details like "married", "has kids", etc.), you MUST:
1. Include them in "unmappableCriteria" array
2. Leave them out of "supabaseFilters"
3. Explain in "explanation" what couldn't be filtered

USER REQUEST: "${userMessage}"
DESTINATION: "${destinationCountry}"

⚠️ CRITICAL REMINDER: The DESTINATION above is where the USER WANTS TO GO, NOT where they want surfers to be FROM!
- If destination is "USA" or "California", this means the user wants to GO TO the USA, NOT that they want surfers FROM the USA
- ONLY set country_from in supabaseFilters if the user EXPLICITLY says they want surfers FROM a specific country
- If user only mentions a destination (e.g., "California", "USA", "Costa Rica"), do NOT set country_from - leave it out of supabaseFilters

Extract filters from the user's request. Return ONLY valid JSON in this format (NO COMMENTS - JSON.parse() cannot handle comments):
{
  "supabaseFilters": {
    "country_from": ["Israel", "United States"],
    "age_min": 18,
    "age_max": 30,
    "surfboard_type": ["longboard"],
    "surf_level_category": ["advanced", "pro"],
    "destination_days_min": {
      "destination": "Costa Rica",
      "min_days": 30
    }
  },
  "unmappableCriteria": ["blond", "tall"],
  "explanation": "Brief explanation of what filters were extracted and what couldn't be mapped"
}

⚠️ CRITICAL: For country_from, ALWAYS use EXACT names from the official list above. Normalize common variations:
- "USA" / "US" / "U.S.A" / "America" / "United States" → For country_from: Expand to all 50 states in "United States - [State]" format. NEVER use just "United States" as a single value for country_from.
- "UK" / "England" / "Britain" → "United Kingdom"
- Any other variation → Find the matching exact name from the official list

IMPORTANT: The JSON above is an example format. When you return your response:
- DO NOT include any comments (no // or /* */)
- DO NOT include explanatory text outside the JSON
- Return ONLY the JSON object, nothing else

CRITICAL RULES - BE SMART AND FLEXIBLE:

0. ⚠️ CRITICAL: DO NOT CONFUSE destination_country WITH country_from ⚠️
   - destination_country = WHERE THE USER WANTS TO GO (e.g., "California" → destination_country: "USA", state: "California")
   - country_from = WHERE THE SURFER IS FROM (origin country) - ONLY set if user explicitly requests it
   - Note: When searching for USA destinations, the matching system will find surfers who have either old format (country="California") or new format (country="USA", state="California")
   - If user says "I want to go to California" → destination_country: "USA", country_from: NOT SET
   - If user says "I want surfers from the USA" → country_from: ["United States - Alabama", "United States - Alaska", ..., "United States - Wyoming"] (all 50 states)
   - If user says "I want a dude from california" → country_from: ["United States - California"]
   - If user says "I want to go to Costa Rica and connect with surfers from Israel" → destination_country: "Costa Rica", country_from: ["Israel"]
   - NEVER automatically set country_from based on destination_country - they are completely different things!

1. HANDLE GENERAL TERMS (expand to specific countries - use EXACT names from official list):
   - "European" / "uropean" / "european" / "any European country" / "from Europe" → Expand to ALL (use exact names): ["France", "Spain", "Italy", "Germany", "United Kingdom", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Ireland", "Portugal", "Greece", "Austria", "Belgium", "Switzerland", "Poland", "Czech Republic", "Hungary", "Romania", "Croatia", "Slovenia"]
   - "Asian" / "from Asia" / "any Asian country" → Expand to (use exact names): ["Japan", "China", "South Korea", "Thailand", "Indonesia", "Philippines", "India", "Sri Lanka", "Malaysia", "Vietnam"]
   - "Latin American" / "from Latin America" / "South American" → Expand to (use exact names): ["Mexico", "Brazil", "Costa Rica", "Nicaragua", "El Salvador", "Panama", "Peru", "Chile", "Argentina", "Ecuador"]
   - "Central American" / "from Central America" → Expand to (use exact names): ["Costa Rica", "Nicaragua", "El Salvador", "Panama", "Guatemala", "Belize", "Honduras"]

2. HANDLE TYPOS INTELLIGENTLY (normalize to EXACT official country names):
   - "uropean" / "european" / "European" → All mean the same → expand to all European countries (use exact names from official list)
   - "Philippins" / "Philippines" / "Phillipines" → All mean "Philippines" (exact name from official list)
   - "Isreal" (typo) → "Israel" (exact name from official list)
   - "Brasil" → "Brazil" (exact name from official list)
   - "US" / "United States" / "U.S.A" / "USA" / "America" / "United States of America" → For country_from: Expand to all 50 states in "United States - [State]" format. For destination_country: Use "United States" (MUST use exact name from official list)
   - "UK" / "United Kingdom" / "England" / "Great Britain" / "Britain" → "United Kingdom" (exact name from official list)
   - "Holland" → "Netherlands" (exact name from official list)
   - "UAE" / "United Arab Emirates" → "United Arab Emirates" (exact name from official list)
   - "Korea" / "South Korea" → "South Korea" (exact name from official list)
   - If you see a typo but the intent is clear, correct it to the EXACT name from the official list above

3. INFER INTENT FROM CONTEXT:
   - "similar age" + user is 25 → age_min: 20, age_max: 30 (±5 years)
   - "around my age" + user is 25 → age_min: 20, age_max: 30 (±5 years)
   - "young" → infer age_max: 30
   - "older" → infer age_min: 35
   - "must be shortboarders" / "they will use shortboard" → surfboard_type: ["shortboard"]
   - "intermediate" → surf_level_category: "intermediate" (REQUIRES surfboard_type to be specified)
   - "advanced" → surf_level_category: ["advanced", "pro"] (ALWAYS include "pro" when "advanced" is mentioned, REQUIRES surfboard_type)
   - "intermediate-advanced" → surf_level_category: ["intermediate", "advanced", "pro"] (ALWAYS include "pro" when "advanced" is mentioned)
   - "beginner" → surf_level_category: "beginner" (REQUIRES surfboard_type to be specified)
   - "pro" → surf_level_category: "pro" (REQUIRES surfboard_type to be specified)

4. NORMALIZATION RULES:
   - Age ranges: "18-30" or "between 18 and 30" → age_min: 18, age_max: 30
   - Age ranges: "over 25" or "above 25" → age_min: 25
   - Age ranges: "under 30" or "below 30" → age_max: 30
   - Destination days: "more than a month" → min_days: 30
   - Destination days: "more than 2 months" → min_days: 60
   - Surfboard types: match to enum exactly ('shortboard', 'longboard', 'funboard', 'fish', 'hybrid', 'gun', 'soft-top')

5. UNMAPPABLE CRITERIA:
   - If user mentions physical appearance (hair color, height, eye color, etc.), personal details (marital status, children, etc.), or other criteria NOT in available fields, add them to "unmappableCriteria"
   - Examples: "blond", "tall", "blue eyes", "married", "has kids", "speaks Spanish", "has a car", "tattoos"
   - Still extract what you CAN filter by, even if some criteria can't be mapped

6. OUTPUT FORMAT:
   - Return valid JSON only, no markdown, no code blocks
   - DO NOT include comments in JSON (no // or /* */ comments)
   - The JSON must be parseable by JSON.parse() without any preprocessing
   - Be smart and infer intent - don't be overly literal if the user's intent is clear
`

  const messages = [
    { role: 'system', content: schemaPrompt },
    ...conversationHistory.slice(-5), // Last 5 messages for context
    { role: 'user', content: userMessage }
  ] as Message[]

  let llmResponse = ''
  try {
    llmResponse = await callOpenAI(messages)
    
    // Parse JSON response
    let jsonString = llmResponse
    const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/) || llmResponse.match(/```\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      jsonString = jsonMatch[1]
    }
    
    // Try to extract JSON object
    const jsonObjMatch = jsonString.match(/\{[\s\S]*\}/)
    if (jsonObjMatch) {
      jsonString = jsonObjMatch[0]
    }
    
    // Remove single-line comments (// ...) and multi-line comments (/* ... */)
    // This handles cases where the LLM includes comments in JSON
    jsonString = jsonString
      .replace(/\/\/.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
    
    const extracted = JSON.parse(jsonString)
    
    // Validate structure
    if (!extracted.supabaseFilters) {
      extracted.supabaseFilters = {}
    }
    if (!extracted.unmappableCriteria) {
      extracted.unmappableCriteria = []
    }
    
    // CRITICAL RULE: If "advanced" is in surf_level_category, ALWAYS include "pro"
    if (extracted.supabaseFilters.surf_level_category) {
      const categories = Array.isArray(extracted.supabaseFilters.surf_level_category)
        ? extracted.supabaseFilters.surf_level_category
        : [extracted.supabaseFilters.surf_level_category];
      
      // Check if "advanced" is in the array
      const hasAdvanced = categories.some((cat: string) => 
        cat && cat.toLowerCase() === 'advanced'
      );
      
      // Check if "pro" is already in the array
      const hasPro = categories.some((cat: string) => 
        cat && cat.toLowerCase() === 'pro'
      );
      
      // If "advanced" is present but "pro" is not, add "pro"
      if (hasAdvanced && !hasPro) {
        categories.push('pro');
        extracted.supabaseFilters.surf_level_category = categories.length === 1 
          ? categories[0] 
          : categories;
        console.log('✅ Added "pro" to surf_level_category because "advanced" was present');
      } else if (hasAdvanced && hasPro) {
        // Ensure it's an array if both are present
        extracted.supabaseFilters.surf_level_category = categories.length === 1 
          ? categories[0] 
          : categories;
      }
    }
    
    // Normalize country_from array to ensure all country names match official list
    if (extracted.supabaseFilters.country_from && Array.isArray(extracted.supabaseFilters.country_from)) {
      const normalizedCountries = await Promise.all(
        extracted.supabaseFilters.country_from.map(async (country: string) => {
          if (!country || typeof country !== 'string') {
            return null;
          }

          // First validate directly against official list
          if (validateCountryName(country)) {
            // Country is valid, use it as-is
            console.log(`✅ Country "${country}" is valid, using as-is`);
            return country;
          }
          
          // Country not in list, ask AI to correct it
          console.log(`⚠️ Country "${country}" not found in official list, asking AI to correct...`);
          const corrected = await correctCountryNameWithAI(country);
          
          // Validate the AI-corrected result
          if (corrected && validateCountryName(corrected)) {
            return corrected;
          } else {
            console.warn(`❌ Country "${country}" couldn't be corrected by AI, removing from filters`);
            return null;
          }
        })
      );
      
      // Filter out null values and remove duplicates
      const validCountries = normalizedCountries.filter(
        (country): country is string => country !== null
      );
      const uniqueCountries = Array.from(new Set(validCountries));
      
      if (uniqueCountries.length > 0) {
        extracted.supabaseFilters.country_from = uniqueCountries;
        console.log(`✅ Final normalized country_from: ${JSON.stringify(uniqueCountries)}`);
      } else {
        // Remove country_from if all countries were invalid
        delete extracted.supabaseFilters.country_from;
        console.warn(`⚠️ All countries in country_from were invalid, removed filter`);
      }
    }
    
    console.log('✅ Extracted query filters:', JSON.stringify(extracted, null, 2))
    if (extracted.unmappableCriteria && extracted.unmappableCriteria.length > 0) {
      console.log('⚠️ Unmappable criteria detected:', extracted.unmappableCriteria)
    }
    return extracted
  } catch (error) {
    console.error('Error extracting query filters:', error)
    console.log('Raw LLM response:', llmResponse)
    // Return empty filters on error
    return {
      supabaseFilters: {},
      unmappableCriteria: [],
      explanation: 'Failed to extract filters from user message'
    }
  }
}

/**
 * Detect user intent regarding filter management
 * Returns: 'more' | 'replace' | 'add' | 'unclear'
 */
async function detectFilterIntent(
  userMessage: string,
  conversationHistory: Message[]
): Promise<'more' | 'replace' | 'add' | 'unclear'> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const prompt = `You are analyzing a user's message to determine their intent regarding search filters in a trip planning conversation.

The user was just asked: "Yo! How do these matches look? You can: (1) Get more users with the same filters, (2) Add new filters to your current ones, or (3) Replace all filters and start fresh. What would you like to do?"

Analyze the user's response and classify it as one of:
- "more": User wants more users with the same filters (e.g., "send me more", "more users", "more surfers", "other options", "other users", "other surfers", "give me more", "show me more", "different users", "another batch")
- "replace": User wants to replace all filters with new ones (e.g., "Find me an American", "Send me only advanced surfers", "Shortboarder", "I want surfers from USA", "Find me someone who...", "Clear and find...")
- "add": User wants to add filters to existing ones (e.g., "also from USA", "and make them advanced", "add American", "keep current and add...", "in addition to...", "plus...")
- "unclear": Cannot determine intent or user is asking a question

IMPORTANT RULES:
- If user says "more", "other", "another" WITHOUT providing new filter criteria → "more"
- If user provides new filter criteria (e.g., "American", "advanced", "shortboarder") WITHOUT additive language (also, and, plus) → "replace"
- If user provides new filter criteria WITH additive language (also, and, in addition, plus, keep) → "add"
- If user says "more" BUT also provides new criteria → "unclear" (needs clarification)
- If intent cannot be determined → "unclear"

User's message: "${userMessage}"

Respond with ONLY one word: "more", "replace", "add", or "unclear".`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a classifier that analyzes user intent. Respond with only one word: more, replace, add, or unclear.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 10,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Error calling OpenAI for filter intent detection:', errorText)
      return 'unclear'
    }

    const data = await response.json()
    const intent = data.choices[0]?.message?.content?.trim().toLowerCase()

    if (intent === 'more' || intent === 'replace' || intent === 'add') {
      console.log(`[detectFilterIntent] Detected intent: ${intent}`)
      return intent
    }

    console.log(`[detectFilterIntent] Intent unclear, got: ${intent}`)
    return 'unclear'
  } catch (error) {
    console.error('Error detecting filter intent:', error)
    return 'unclear'
  }
}

/**
 * Save chat history to database
 */
async function saveChatHistory(
  chatId: string,
  messages: Message[],
  userId: string,
  conversationId: string | null,
  supabaseAdmin: any
) {
  const { error } = await supabaseAdmin
    .from('swelly_chat_history')
    .upsert({
      chat_id: chatId,
      user_id: userId,
      conversation_id: conversationId,
      messages: messages,
      conversation_type: 'trip-planning', // Mark as trip planning
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'chat_id',
    })

  if (error) {
    console.error('Error saving chat history:', error)
    throw error
  }
}

/**
 * Get chat history from database
 */
async function getChatHistory(chatId: string, supabaseAdmin: any): Promise<Message[]> {
  const { data, error } = await supabaseAdmin
    .from('swelly_chat_history')
    .select('messages')
    .eq('chat_id', chatId)
    .single()

  if (error) {
    console.error('Error getting chat history:', error)
    return []
  }

  const messages = data?.messages || []
  
  // Debug: Check if any messages have metadata
  const messagesWithMetadata = messages.filter((msg: any) => msg.metadata?.matchedUsers)
  if (messagesWithMetadata.length > 0) {
    console.log('[getChatHistory] Found', messagesWithMetadata.length, 'messages with matched users metadata')
    messagesWithMetadata.forEach((msg: any, idx: number) => {
      console.log('[getChatHistory] Message', idx, 'has', msg.metadata.matchedUsers.length, 'matched users')
    })
  } else {
    console.log('[getChatHistory] No messages with matched users metadata found')
  }
  
  return messages
}

/**
 * Extract previously matched user IDs from conversation history
 * This can be used for backend-side matching in the future
 * @param chatId - The chat ID for the conversation
 * @param supabaseAdmin - Supabase admin client
 * @returns Array of unique user IDs that have already been matched
 */
async function getPreviouslyMatchedUserIdsFromHistory(
  chatId: string,
  supabaseAdmin: any
): Promise<string[]> {
  try {
    const messages = await getChatHistory(chatId, supabaseAdmin)
    const matchedUserIds = new Set<string>()
    
    for (const message of messages) {
      // Check if this message has matched users in metadata
      if (message.metadata?.matchedUsers && Array.isArray(message.metadata.matchedUsers)) {
        for (const matchedUser of message.metadata.matchedUsers) {
          if (matchedUser.user_id) {
            matchedUserIds.add(matchedUser.user_id)
          }
        }
      }
    }
    
    const result = Array.from(matchedUserIds)
    console.log('[getPreviouslyMatchedUserIdsFromHistory] Found', result.length, 'previously matched user IDs')
    return result
  } catch (error) {
    console.error('[getPreviouslyMatchedUserIdsFromHistory] Error extracting matched user IDs:', error)
    return []
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

    // Route: POST /swelly-trip-planning/new_chat
    if (path.endsWith('/new_chat') && req.method === 'POST') {
      const body: ChatRequest = await req.json()
      
      // Generate chat ID
      const chatId = crypto.randomUUID()
      
      // Get user's surfer profile for destination discovery flow
      let userProfile: any = null
      try {
        const { data: surferData, error: surferError } = await supabaseAdmin
          .from('surfers')
          .select('country_from, surf_level, age, surfboard_type, travel_experience')
          .eq('user_id', user.id)
          .single()
        
        if (!surferError && surferData) {
          userProfile = surferData
          console.log('✅ Fetched user profile for destination discovery:', userProfile)
        }
      } catch (error) {
        console.error('Error fetching user profile:', error)
        // Continue without profile - not critical
      }

      // Build system prompt with user profile context if available
      let systemPrompt = TRIP_PLANNING_PROMPT
      if (userProfile) {
        const profileContext = `USER PROFILE CONTEXT (use this when asking destination discovery questions):
- country_from: ${userProfile.country_from || 'not specified'}
- surf_level: ${userProfile.surf_level || 'not specified'} (1=beginner, 2=intermediate, 3=advanced, 4=pro)
- surf_level_category: ${userProfile.surf_level_category || 'not specified'} (beginner/intermediate/advanced/pro)
- age: ${userProfile.age || 'not specified'}
- surfboard_type: ${userProfile.surfboard_type || 'not specified'}
- travel_experience: ${userProfile.travel_experience || 'not specified'}
- pronoun: ${userProfile.pronoun || 'not specified'}

IMPORTANT: When referring to surf level in your responses, ALWAYS use the category name (beginner/intermediate/advanced/pro), NOT the numeric level.

When asking QUESTION 2 (wave type), adapt the question based on their surf_level_category:
- If surf_level_category is "advanced" or "pro": Ask about "Heavy and challenging, high performance playground, or mellow but fun"
- If surf_level_category is "intermediate": Ask about "challenging, playful, or more mellow"
- If surf_level_category is "beginner": Ask about "mellow and forgiving, or ready to step it up"

When asking QUESTION 3 (travel distance), use their country_from to provide relevant examples.

${getPronounInstructions(userProfile.pronoun, userProfile.name)}`
        systemPrompt = TRIP_PLANNING_PROMPT + '\n\n' + profileContext
      }

      // Initialize chat history
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        // Add explicit instruction for first response - MUST ask STEP 1 question
        { role: 'system', content: 'CRITICAL: This is the FIRST message in a NEW conversation. The user has just introduced themselves or started the conversation. You MUST respond with STEP 1\'s question: "Yo! Let’s Travel! I can connect you with like minded surfers or surf travelers who have experience in specific destinations you are curious about. So, what are you looking for?" Do NOT skip to STEP 2. Wait for the user to answer STEP 1 first. Treat their initial message as context/introduction only.' },
        { role: 'user', content: body.message }
      ]

      // Add JSON format reminder
      const jsonFormatReminder = `CRITICAL: You MUST return a valid JSON object. Your response must start with { and end with }. Do NOT return plain text.`
      messages.splice(messages.length - 1, 0, { role: 'system', content: jsonFormatReminder })

      // Call OpenAI
      let assistantMessage = await callOpenAI(messages)
      
      // Check if response is plain text (not JSON) and retry with stronger enforcement
      const isPlainText = !assistantMessage.trim().startsWith('{') && !assistantMessage.includes('```json')
      if (isPlainText) {
        console.log('⚠️ LLM returned plain text instead of JSON - retrying with JSON enforcement...')
        const strongJsonEnforcement = `ERROR: You returned plain text instead of JSON. You MUST return a JSON object starting with { and ending with }.`
        messages.push({ role: 'system', content: strongJsonEnforcement })
        assistantMessage = await callOpenAI(messages)
      }
      
      messages.push({ role: 'assistant', content: assistantMessage })

      // Save to database
      await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)

      // Parse JSON response
      let parsedResponse: ChatResponse
      try {
        console.log('Raw assistant message:', assistantMessage)
        
        // Try to extract JSON from code blocks if present
        let jsonString = assistantMessage
        const jsonMatch = assistantMessage.match(/```json\s*([\s\S]*?)\s*```/) || assistantMessage.match(/```\s*([\s\S]*?)\s*```/)
        if (jsonMatch) {
          jsonString = jsonMatch[1]
        }
        
        // Remove comments from JSON before parsing (LLM sometimes includes comments)
        jsonString = jsonString
          .replace(/\/\/.*$/gm, '') // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
        
        const parsed = JSON.parse(jsonString)
        console.log('Parsed JSON from ChatGPT:', JSON.stringify(parsed, null, 2))
        
        // Clean return_message - remove any JSON code blocks or technical content
        let returnMessage = parsed.return_message || assistantMessage
        // Remove JSON code blocks from return_message
        returnMessage = returnMessage.replace(/```json[\s\S]*?```/g, '').replace(/```[\s\S]*?```/g, '')
        // Remove standalone JSON objects
        returnMessage = returnMessage.replace(/\{[\s\S]*"is_finished"[\s\S]*\}/g, '')
        returnMessage = returnMessage.trim()
        
        // If return_message is empty or looks like JSON, use a default message
        if (!returnMessage || returnMessage.startsWith('{') || returnMessage.length < 10) {
          if (parsed.is_finished) {
            returnMessage = "Copy! Here are a few advisor options that best match what you're looking for."
          } else {
            returnMessage = assistantMessage.replace(/```json[\s\S]*?```/g, '').replace(/```[\s\S]*?```/g, '').trim()
            if (!returnMessage || returnMessage.startsWith('{')) {
              returnMessage = assistantMessage // Fallback to original
            }
          }
        }
        
        // Extract data from parsed response
        let tripPlanningData = parsed.data
        // Normalize non_negotiable_criteria.country_from if present in parsed.data
        if (tripPlanningData && tripPlanningData.non_negotiable_criteria) {
          tripPlanningData = {
            ...tripPlanningData,
            non_negotiable_criteria: await normalizeNonNegotiableCriteria(tripPlanningData.non_negotiable_criteria)
          };
        }
        if (!tripPlanningData && parsed.is_finished) {
          // If data is not in a nested "data" field, extract from root level
          // Normalize non_negotiable_criteria.country_from if present
          const normalizedNonNegotiableCriteria = await normalizeNonNegotiableCriteria(parsed.non_negotiable_criteria);
          
          tripPlanningData = {
            destination_country: parsed.destination_country,
            area: parsed.area,
            budget: parsed.budget,
            destination_known: parsed.destination_known,
            purpose: parsed.purpose,
            non_negotiable_criteria: normalizedNonNegotiableCriteria,
            user_context: parsed.user_context,
            queryFilters: null, // Initialize queryFilters field
            filtersFromNonNegotiableStep: false, // Initialize flag
          }
        }
        
        parsedResponse = {
          chat_id: chatId,
          return_message: returnMessage,
          is_finished: parsed.is_finished || false,
          data: tripPlanningData || null
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

    // Route: POST /swelly-trip-planning/continue/:chat_id
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

      // Get user's surfer profile for destination discovery flow
      let userProfile: any = null
      try {
        const { data: surferData, error: surferError } = await supabaseAdmin
          .from('surfers')
          .select('country_from, surf_level, age, surfboard_type, travel_experience')
          .eq('user_id', user.id)
          .single()
        
        if (!surferError && surferData) {
          userProfile = surferData
          console.log('✅ Fetched user profile for destination discovery:', userProfile)
        }
      } catch (error) {
        console.error('Error fetching user profile:', error)
        // Continue without profile - not critical
      }

      // Add user profile context to messages if available (for destination discovery flow)
      if (userProfile) {
        const profileContext = `USER PROFILE CONTEXT (use this when asking destination discovery questions):
- country_from: ${userProfile.country_from || 'not specified'}
- surf_level: ${userProfile.surf_level || 'not specified'} (1=beginner, 2=intermediate, 3=advanced, 4=pro)
- surf_level_category: ${userProfile.surf_level_category || 'not specified'} (beginner/intermediate/advanced/pro)
- age: ${userProfile.age || 'not specified'}
- surfboard_type: ${userProfile.surfboard_type || 'not specified'}
- travel_experience: ${userProfile.travel_experience || 'not specified'}
- pronoun: ${userProfile.pronoun || 'not specified'}

IMPORTANT: When referring to surf level in your responses, ALWAYS use the category name (beginner/intermediate/advanced/pro), NOT the numeric level.

When asking QUESTION 2 (wave type), adapt the question based on their surf_level_category:
- If surf_level_category is "advanced" or "pro": Ask about "Heavy and challenging, high performance playground, or mellow but fun"
- If surf_level_category is "intermediate": Ask about "challenging, playful, or more mellow"
- If surf_level_category is "beginner": Ask about "mellow and forgiving, or ready to step it up"

When asking QUESTION 3 (travel distance), use their country_from to provide relevant examples.

${getPronounInstructions(userProfile.pronoun, userProfile.name)}`
        messages.splice(0, 1, { role: 'system', content: TRIP_PLANNING_PROMPT + '\n\n' + profileContext })
      }

      // Check if we're waiting for a filter decision (matches were just sent)
      let awaitingFilterDecision = false
      let awaitingFilterClarification = false
      let existingQueryFilters: any = null
      let pendingFilters: any = null
      let filterIntent: 'more' | 'replace' | 'add' | 'unclear' | null = null
      
      // Check the most recent assistant message for the awaitingFilterDecision or awaitingFilterClarification flag
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          if (messages[i].metadata?.awaitingFilterDecision === true) {
            awaitingFilterDecision = true
            console.log('[continue] Found awaitingFilterDecision flag - user is responding to filter question')
            
            // Extract existing queryFilters from previous assistant messages
            try {
              const prevParsed = JSON.parse(messages[i].content)
              if (prevParsed.data?.queryFilters) {
                existingQueryFilters = prevParsed.data.queryFilters
                console.log('[continue] Found existing queryFilters:', JSON.stringify(existingQueryFilters, null, 2))
              }
            } catch (e) {
              // Not JSON, continue
            }
            break
          }
          if (messages[i].metadata?.awaitingFilterClarification === true) {
            awaitingFilterClarification = true
            console.log('[continue] Found awaitingFilterClarification flag - user is responding to clarification question')
            
            // Extract pending filters from metadata
            if (messages[i].metadata?.pendingFilters) {
              pendingFilters = messages[i].metadata!.pendingFilters
              console.log('[continue] Found pendingFilters:', JSON.stringify(pendingFilters, null, 2))
            }
            
            // Extract existing queryFilters from previous assistant messages
            try {
              const prevParsed = JSON.parse(messages[i].content)
              if (prevParsed.data?.queryFilters) {
                existingQueryFilters = prevParsed.data.queryFilters
                console.log('[continue] Found existing queryFilters:', JSON.stringify(existingQueryFilters, null, 2))
              }
            } catch (e) {
              // Not JSON, continue
            }
            break
          }
        }
      }
      
      // If awaiting filter clarification, detect user intent (replace vs add)
      if (awaitingFilterClarification) {
        console.log('[continue] Detecting clarification intent from user message:', body.message)
        const clarificationIntent = await detectFilterIntent(body.message, messages)
        console.log('[continue] Detected clarification intent:', clarificationIntent)
        
        // Remove the clarification flag from metadata
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant' && messages[i].metadata?.awaitingFilterClarification) {
            const metadata = messages[i].metadata
            if (metadata) {
              delete metadata.awaitingFilterClarification
              delete metadata.pendingFilters
            }
          }
        }
        
        if (clarificationIntent === 'replace' || clarificationIntent === 'add') {
          filterIntent = clarificationIntent
          // Use pending filters as extracted filters
          if (pendingFilters) {
            // We'll use pendingFilters as extractedQueryFilters later
            console.log('[continue] Using pending filters with intent:', filterIntent)
          }
        } else {
          // Still unclear - ask again
          const clarificationMessage = "I didn't quite catch that. Would you like to replace your current filters with these new ones, or add them to your existing filters?"
          
          // Re-add clarification flag
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].metadata) {
              const metadata = messages[i].metadata!
              metadata.awaitingFilterClarification = true
              metadata.pendingFilters = pendingFilters
              break
            }
          }
          
          messages.push({ role: 'assistant', content: JSON.stringify({
            return_message: clarificationMessage,
            is_finished: false,
            data: null
          })})
          
          await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)
          
          return new Response(
            JSON.stringify({
              chat_id: chatId,
              return_message: clarificationMessage,
              is_finished: false,
              data: null
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          )
        }
      }
      
      // If awaiting filter decision, detect user intent
      if (awaitingFilterDecision) {
        console.log('[continue] Detecting filter intent from user message:', body.message)
        filterIntent = await detectFilterIntent(body.message, messages)
        console.log('[continue] Detected filter intent:', filterIntent)
        
        if (filterIntent === 'more') {
          // User wants more users with same filters - keep filters unchanged
          console.log('[continue] User wants more users with same filters - will keep existing filters')
          // Remove the flag from metadata
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].metadata?.awaitingFilterDecision) {
              const metadata = messages[i].metadata
              if (metadata) {
                delete metadata.awaitingFilterDecision
              }
            }
          }
        } else if (filterIntent === 'replace') {
          // User wants to replace all filters - will use only new filters
          console.log('[continue] User wants to replace filters - will use only new filters')
          // Remove the flag from metadata
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].metadata?.awaitingFilterDecision) {
              const metadata = messages[i].metadata
              if (metadata) {
                delete metadata.awaitingFilterDecision
              }
            }
          }
        } else if (filterIntent === 'add') {
          // User wants to add filters - will merge with existing filters later
          console.log('[continue] User wants to add filters - will merge with existing filters')
          // Remove the flag from metadata
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].metadata?.awaitingFilterDecision) {
              const metadata = messages[i].metadata
              if (metadata) {
                delete metadata.awaitingFilterDecision
              }
            }
          }
        } else {
          // Unclear intent - we'll check for extracted filters after extraction and ask for clarification if needed
          console.log('[continue] Filter intent unclear - will check for extracted filters after extraction')
        }
      }
      
      // Add new user message
      messages.push({ role: 'user', content: body.message })
      
      // Check if user mentioned a destination - if so, remind AI to use STEP 2A, not STEP 2B
      const currentUserMessageLower = body.message.toLowerCase()
      const step2aDestinationKeywords = [
        'costa rica', 'sri lanka', 'indonesia', 'philippines', 'philippins', 'filipins',
        'portugal', 'spain', 'france', 'morocco', 'brazil', 'australia', 'mexico',
        'nicaragua', 'panama', 'el salvador', 'peru', 'chile', 'ecuador',
        'bali', 'siargao', 'tamarindo', 'pavones', 'ericeira', 'taghazout',
        'maldives', 'fiji', 'maldives', 'seychelles'
      ]
      
      const hasStep2aDestinationMention = step2aDestinationKeywords.some(keyword => currentUserMessageLower.includes(keyword))
      
      if (hasStep2aDestinationMention) {
        // Check if we're still in STEP 1 or early in conversation
        const assistantMessages = messages.filter(m => m.role === 'assistant')
        const isEarlyConversation = assistantMessages.length <= 2
        
        if (isEarlyConversation) {
          const step2Reminder = `CRITICAL: The user just mentioned a destination (${body.message}). Extract the destination_country immediately, ask about area if needed, then go to STEP 3 (Clarify Purpose).`
          messages.splice(messages.length - 1, 0, { role: 'system', content: step2Reminder })
        }
      }
      
      // ALWAYS extract query filters from user messages throughout the conversation
      // This allows filtering by any criteria mentioned at any point
      const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop()?.content || ''
      const isCriteriaStep = lastAssistantMessage.toLowerCase().includes('non-negotiable') || 
                             lastAssistantMessage.toLowerCase().includes('parameters') ||
                             lastAssistantMessage.toLowerCase().includes('criteria')
      
      console.log('🔍 Extracting query filters from user message (always):', body.message)
      console.log('Is criteria step?', isCriteriaStep)
      
      let extractedQueryFilters: any = null
      let unmappableCriteria: string[] = []
      
      // Extract filters from current message
      try {
        // Get destination from conversation history
        let destinationCountry = ''
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            try {
              const parsed = JSON.parse(messages[i].content)
              if (parsed.data?.destination_country) {
                destinationCountry = parsed.data.destination_country
                break
              }
            } catch (e) {
              // Not JSON, continue
            }
          }
        }
        
        // Also check user messages for destination mentions
        if (!destinationCountry) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
              const userMsg = messages[i].content
              const userMsgLower = userMsg.toLowerCase()
              
              // Check for Philippines first (handle typos)
              if (userMsgLower.includes('philippines') || userMsgLower.includes('philippins') || userMsgLower.includes('filipins') || userMsgLower.includes('filipines')) {
                destinationCountry = 'Philippines'
                break
              }
              
              // Check other countries
              const countries = ['el salvador', 'sri lanka', 'costa rica', 'indonesia', 'portugal', 'spain', 'france', 'brazil', 'australia', 'nicaragua', 'panama', 'mexico', 'peru', 'chile']
              for (const country of countries) {
                if (userMsgLower.includes(country)) {
                  destinationCountry = country.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                  break
                }
              }
              if (destinationCountry) break
            }
          }
        }
        
        console.log('📍 Destination country for filter extraction:', destinationCountry)
        const filterResult = await extractQueryFilters(body.message, destinationCountry, messages)
        extractedQueryFilters = filterResult.supabaseFilters
        unmappableCriteria = filterResult.unmappableCriteria || []
        console.log('✅ Extracted query filters:', JSON.stringify(extractedQueryFilters, null, 2))
        console.log('✅ Filter extraction explanation:', filterResult.explanation)
        if (unmappableCriteria.length > 0) {
          console.log('⚠️ Unmappable criteria found:', unmappableCriteria)
        }
      } catch (error) {
        console.error('❌ Error extracting query filters:', error)
        // Continue without filters - fallback to existing logic
      }
      
      // Also check previous messages for accumulated filters
      // Merge filters from previous messages with current ones
      let accumulatedFilters: any = null
      try {
        // Look for filters in previous assistant responses
        for (let i = messages.length - 2; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            try {
              const prevParsed = JSON.parse(messages[i].content)
              if (prevParsed.data?.queryFilters) {
                accumulatedFilters = prevParsed.data.queryFilters
                console.log('📦 Found accumulated filters from previous message:', JSON.stringify(accumulatedFilters, null, 2))
                break
              }
            } catch (e) {
              // Not JSON, continue
            }
          }
        }
      } catch (error) {
        console.error('Error checking for accumulated filters:', error)
      }
      
      // Check if intent is unclear but new filters were extracted - ask for clarification
      if (awaitingFilterDecision && filterIntent === 'unclear' && extractedQueryFilters && Object.keys(extractedQueryFilters).length > 0) {
        console.log('[continue] Intent unclear but new filters extracted - asking for clarification')
        
        // Build description of new filters
        const filterDescriptions: string[] = []
        if (extractedQueryFilters.country_from) {
          filterDescriptions.push(`from ${Array.isArray(extractedQueryFilters.country_from) ? extractedQueryFilters.country_from.join(' or ') : extractedQueryFilters.country_from}`)
        }
        if (extractedQueryFilters.surf_level_category) {
          filterDescriptions.push(`${Array.isArray(extractedQueryFilters.surf_level_category) ? extractedQueryFilters.surf_level_category.join(' or ') : extractedQueryFilters.surf_level_category} level`)
        }
        if (extractedQueryFilters.surfboard_type) {
          filterDescriptions.push(`${Array.isArray(extractedQueryFilters.surfboard_type) ? extractedQueryFilters.surfboard_type.join(' or ') : extractedQueryFilters.surfboard_type} surfers`)
        }
        if (extractedQueryFilters.age_min || extractedQueryFilters.age_max) {
          const ageRange = extractedQueryFilters.age_min && extractedQueryFilters.age_max 
            ? `${extractedQueryFilters.age_min}-${extractedQueryFilters.age_max} years old`
            : extractedQueryFilters.age_min 
            ? `at least ${extractedQueryFilters.age_min} years old`
            : `at most ${extractedQueryFilters.age_max} years old`
          filterDescriptions.push(ageRange)
        }
        
        const newCriteriaText = filterDescriptions.length > 0 
          ? filterDescriptions.join(', ')
          : 'these new criteria'
        
        const clarificationMessage = `I see you mentioned ${newCriteriaText}. Would you like to replace your current filters with these new ones, or add them to your existing filters?`
        
        // Store pending filters in metadata
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant' && messages[i].metadata?.awaitingFilterDecision) {
            const metadata = messages[i].metadata
            if (metadata) {
              metadata.awaitingFilterClarification = true
              metadata.pendingFilters = extractedQueryFilters
              delete metadata.awaitingFilterDecision
            }
            break
          }
        }
        
        // Also store in the filter decision prompt message if it exists
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant' && messages[i].metadata?.isFilterDecisionPrompt) {
            if (!messages[i].metadata) {
              messages[i].metadata = {}
            }
            const metadata = messages[i].metadata!
            metadata.awaitingFilterClarification = true
            metadata.pendingFilters = extractedQueryFilters
            break
          }
        }
        
        // Add clarification as assistant message
        messages.push({ role: 'assistant', content: JSON.stringify({
          return_message: clarificationMessage,
          is_finished: false,
          data: null
        })})
        
        // Save and return early
        await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)
        
        return new Response(
          JSON.stringify({
            chat_id: chatId,
            return_message: clarificationMessage,
            is_finished: false,
            data: null
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        )
      }
      
      // Handle filter management based on user intent
      if (awaitingFilterDecision && filterIntent) {
        // User just responded to filter decision question
        if (filterIntent === 'more') {
          // User wants more users with same filters - keep existing filters, don't extract new ones
          console.log('🔄 User wants more users - keeping existing filters:', JSON.stringify(existingQueryFilters || accumulatedFilters, null, 2))
          if (existingQueryFilters) {
            extractedQueryFilters = existingQueryFilters
          } else if (accumulatedFilters) {
            extractedQueryFilters = accumulatedFilters
          }
          // Don't extract new filters from the message
        } else if (filterIntent === 'replace') {
          // Replace all filters - use only new filters (don't merge with existing)
          console.log('🗑️ User wants to replace filters - using only new filters:', JSON.stringify(extractedQueryFilters, null, 2))
          // extractedQueryFilters will contain only new filters extracted from current message
          // Don't merge with existingQueryFilters or accumulatedFilters
        } else if (filterIntent === 'add') {
          // Add filters - merge with existing filters
          if (existingQueryFilters) {
            if (extractedQueryFilters) {
              extractedQueryFilters = {
                ...existingQueryFilters,
                ...extractedQueryFilters, // Current filters override existing ones
              }
              console.log('🔄 Merged filters (existing + current):', JSON.stringify(extractedQueryFilters, null, 2))
            } else {
              extractedQueryFilters = existingQueryFilters
              console.log('📦 Using existing filters only:', JSON.stringify(extractedQueryFilters, null, 2))
            }
          } else if (accumulatedFilters) {
            // Fallback to accumulated filters if existingQueryFilters not found
            if (extractedQueryFilters) {
              extractedQueryFilters = {
                ...accumulatedFilters,
                ...extractedQueryFilters,
              }
              console.log('🔄 Merged filters (accumulated + current):', JSON.stringify(extractedQueryFilters, null, 2))
            } else {
              extractedQueryFilters = accumulatedFilters
              console.log('📦 Using accumulated filters only:', JSON.stringify(extractedQueryFilters, null, 2))
            }
          }
        }
      } else if (awaitingFilterClarification && filterIntent && pendingFilters) {
        // User responded to clarification question
        if (filterIntent === 'replace') {
          // Use only pending filters
          extractedQueryFilters = pendingFilters
          console.log('🗑️ User wants to replace - using pending filters:', JSON.stringify(extractedQueryFilters, null, 2))
        } else if (filterIntent === 'add') {
          // Merge pending filters with existing
          if (existingQueryFilters) {
            extractedQueryFilters = {
              ...existingQueryFilters,
              ...pendingFilters,
            }
            console.log('🔄 User wants to add - merged pending with existing:', JSON.stringify(extractedQueryFilters, null, 2))
          } else if (accumulatedFilters) {
            extractedQueryFilters = {
              ...accumulatedFilters,
              ...pendingFilters,
            }
            console.log('🔄 User wants to add - merged pending with accumulated:', JSON.stringify(extractedQueryFilters, null, 2))
          } else {
            extractedQueryFilters = pendingFilters
            console.log('📦 User wants to add - using pending filters only:', JSON.stringify(extractedQueryFilters, null, 2))
          }
        }
      } else {
        // Normal flow: Merge current filters with accumulated filters (current takes precedence)
        if (accumulatedFilters && extractedQueryFilters) {
          extractedQueryFilters = {
            ...accumulatedFilters,
            ...extractedQueryFilters, // Current filters override accumulated ones
          }
          console.log('🔄 Merged filters (accumulated + current):', JSON.stringify(extractedQueryFilters, null, 2))
        } else if (accumulatedFilters && !extractedQueryFilters) {
          extractedQueryFilters = accumulatedFilters
          console.log('📦 Using accumulated filters only:', JSON.stringify(extractedQueryFilters, null, 2))
        }
      }

      // If we detected unmappable criteria, add a system message to inform the LLM
      if (unmappableCriteria.length > 0) {
        const unmappableMessage = `IMPORTANT: The user mentioned criteria we don't have in our database: ${unmappableCriteria.join(', ')}. Silently extract and use the criteria we DO have (country, age, surf level, board type, destination experience). DO NOT explain what we can or can't filter by - just proceed with matching.`
        // Insert before the last user message
        messages.splice(messages.length - 1, 0, { role: 'system', content: unmappableMessage })
      }

      // Check if user message contains a destination mention and remind LLM to extract it
      const userMessageLower = body.message.toLowerCase()
      const destinationKeywords = ['philippines', 'philippins', 'filipins', 'filipines', 'siargao', 'el salvador', 'costa rica', 'sri lanka', 'indonesia', 'portugal', 'spain', 'france', 'brazil', 'australia', 'nicaragua', 'panama', 'mexico', 'peru', 'chile', 'bali', 'tamarindo', 'pavones', 'el tunco']
      const hasDestinationMention = destinationKeywords.some(keyword => userMessageLower.includes(keyword))
      
      if (hasDestinationMention) {
        const destinationReminder = `CRITICAL REMINDER: The user just mentioned a destination location. You MUST extract destination_country in your response's "data" field. If they mentioned both area and country (e.g., "Siargao, filipins"), extract BOTH: destination_country: "Philippines", area: "Siargao". Correct typos automatically - "filipins" means "Philippines". NEVER set destination_country to null if a location was mentioned!`
        // Insert before the last user message
        messages.splice(messages.length - 1, 0, { role: 'system', content: destinationReminder })
        console.log('📍 Added destination extraction reminder for LLM')
      }

      // Add a final reminder to return JSON format
      const jsonFormatReminder = `CRITICAL: You MUST return a valid JSON object. Your response must start with { and end with }. Do NOT return plain text. The structure must be: {"return_message": "...", "is_finished": false, "data": {...}}. If you return plain text, the system will fail!`
      messages.splice(messages.length - 1, 0, { role: 'system', content: jsonFormatReminder })

      // Call OpenAI
      let assistantMessage = await callOpenAI(messages)
      
      // Check if response is plain text (not JSON) and retry with stronger enforcement
      const isPlainText = !assistantMessage.trim().startsWith('{') && !assistantMessage.includes('```json')
      if (isPlainText) {
        console.log('⚠️ LLM returned plain text instead of JSON - retrying with JSON enforcement...')
        console.log('Plain text response:', assistantMessage.substring(0, 200))
        // Add a stronger system message and retry
        const strongJsonEnforcement = `ERROR: You returned plain text instead of JSON. This is a CRITICAL ERROR. You MUST return a JSON object. Your response MUST be valid JSON starting with { and ending with }. Example: {"return_message": "Your text here", "is_finished": false, "data": {"destination_country": "Philippines", "area": "Siargao", "budget": null, "destination_known": true, "purpose": {"purpose_type": "connect_traveler", "specific_topics": []}, "non_negotiable_criteria": {}, "user_context": {}}}. Return ONLY the JSON object, nothing else.`
        messages.push({ role: 'system', content: strongJsonEnforcement })
        assistantMessage = await callOpenAI(messages)
        console.log('Retry response:', assistantMessage.substring(0, 200))
      }
      
      messages.push({ role: 'assistant', content: assistantMessage })

      // Save to database
      await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)

      // Parse JSON response
      let parsedResponse: ChatResponse
      try {
        console.log('Raw assistant message (continue):', assistantMessage)
        
        // Check if response is plain text (not JSON)
        const isPlainText = !assistantMessage.trim().startsWith('{') && !assistantMessage.includes('```json')
        
        // Try to extract JSON from code blocks if present
        let jsonString = assistantMessage
        const jsonMatch = assistantMessage.match(/```json\s*([\s\S]*?)\s*```/) || assistantMessage.match(/```\s*([\s\S]*?)\s*```/)
        if (jsonMatch) {
          jsonString = jsonMatch[1]
        }
        
        // Remove comments from JSON before parsing (LLM sometimes includes comments)
        jsonString = jsonString
          .replace(/\/\/.*$/gm, '') // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
        
        // Try to extract JSON object if it's embedded in text (e.g., "text { ... }")
        // Look for JSON object pattern
        const jsonObjMatch = jsonString.match(/\{[\s\S]*"is_finished"[\s\S]*\}/)
        if (jsonObjMatch) {
          jsonString = jsonObjMatch[0]
        }
        
        let parsed: any
        try {
          parsed = JSON.parse(jsonString)
        } catch (parseErr) {
          console.log('⚠️ JSON parse failed, checking if it\'s completion message...')
          console.log('Message content:', assistantMessage.substring(0, 100))
          console.log('Full message:', assistantMessage)
          
          // Check if it's the completion message (more flexible check)
          const isCompletionMessage = assistantMessage.toLowerCase().includes('copy! here are') || 
                                     assistantMessage.toLowerCase().includes('advisor options') ||
                                     assistantMessage.toLowerCase().includes('best match')
          
          if (isCompletionMessage) {
            console.log('⚠️ LLM returned plain text completion message instead of JSON - extracting from conversation history')
            // Create a fake parsed object to trigger the fallback logic
            parsed = {
              return_message: assistantMessage,
              is_finished: false, // Will be set to true in fallback
              data: null
            }
          } else {
            // Not completion message, but still try to handle gracefully
            console.log('⚠️ JSON parse failed and not completion message - treating as plain text response')
            parsed = {
              return_message: assistantMessage,
              is_finished: false,
              data: null
            }
          }
        }
        console.log('=== PARSED JSON FROM CHATGPT (continue) ===')
        console.log(JSON.stringify(parsed, null, 2))
        console.log('is_finished:', parsed.is_finished)
        console.log('has data:', !!parsed.data)
        console.log('data content:', parsed.data)
        console.log('return_message:', parsed.return_message)
        console.log('==========================================')
        
        // Clean return_message - remove any JSON code blocks or technical content
        let returnMessage = parsed.return_message || assistantMessage
        // Remove JSON code blocks from return_message
        returnMessage = returnMessage.replace(/```json[\s\S]*?```/g, '').replace(/```[\s\S]*?```/g, '')
        // Remove standalone JSON objects
        returnMessage = returnMessage.replace(/\{[\s\S]*"is_finished"[\s\S]*\}/g, '')
        returnMessage = returnMessage.trim()
        
        // If return_message is empty or looks like JSON, use a default message
        if (!returnMessage || returnMessage.startsWith('{') || returnMessage.length < 10) {
          if (parsed.is_finished) {
            returnMessage = "Copy! Here are a few advisor options that best match what you're looking for."
          } else {
            returnMessage = assistantMessage.replace(/```json[\s\S]*?```/g, '').replace(/```[\s\S]*?```/g, '').trim()
            if (!returnMessage || returnMessage.startsWith('{')) {
              returnMessage = assistantMessage // Fallback to original
            }
          }
        }
        
        // Extract data from parsed response
        let tripPlanningData = parsed.data
        // Normalize non_negotiable_criteria.country_from if present in parsed.data
        if (tripPlanningData && tripPlanningData.non_negotiable_criteria) {
          tripPlanningData = {
            ...tripPlanningData,
            non_negotiable_criteria: await normalizeNonNegotiableCriteria(tripPlanningData.non_negotiable_criteria)
          };
        }
        if (!tripPlanningData && parsed.is_finished) {
          // If data is not in a nested "data" field, extract from root level
          // Normalize non_negotiable_criteria.country_from if present
          const normalizedNonNegotiableCriteria = await normalizeNonNegotiableCriteria(parsed.non_negotiable_criteria);
          
          tripPlanningData = {
            destination_country: parsed.destination_country,
            area: parsed.area,
            budget: parsed.budget,
            destination_known: parsed.destination_known,
            purpose: parsed.purpose,
            non_negotiable_criteria: normalizedNonNegotiableCriteria,
            user_context: parsed.user_context,
            queryFilters: null,
            filtersFromNonNegotiableStep: false,
          }
        }
        
        // FALLBACK ONLY: Enrich data from conversation history if ChatGPT didn't extract it
        // NOTE: ChatGPT should be the primary extractor. This is only a safety net.
        if (tripPlanningData) {
          tripPlanningData.non_negotiable_criteria = tripPlanningData.non_negotiable_criteria || {}
          
          // Only run fallback extraction if ChatGPT didn't extract criteria
          const needsFallback = !tripPlanningData.non_negotiable_criteria || 
                                Object.keys(tripPlanningData.non_negotiable_criteria).length === 0 ||
                                (!tripPlanningData.area && tripPlanningData.destination_country)
          
          if (needsFallback) {
            console.log('⚠️ ChatGPT did not extract all data - using fallback extraction from conversation history')
            console.log('Current data before enrichment:', JSON.stringify(tripPlanningData, null, 2))
            
            // Look through user messages for missing data
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'user') {
                const userMsg = messages[i].content
                const userMsgLower = userMsg.toLowerCase()
                
                // Extract area if missing (e.g., "Costa Rica, Pavones" -> area: "Pavones")
                if (!tripPlanningData.area && tripPlanningData.destination_country) {
                  // Check if message contains both country and area (comma-separated)
                  const countryLower = tripPlanningData.destination_country.toLowerCase()
                  if (userMsgLower.includes(countryLower)) {
                    // Try to extract area after comma
                    const parts = userMsg.split(',').map(p => p.trim())
                    if (parts.length > 1) {
                      // Find the country part and get what comes after
                      const countryIndex = parts.findIndex(p => p.toLowerCase().includes(countryLower))
                      if (countryIndex >= 0 && countryIndex < parts.length - 1) {
                        const area = parts[countryIndex + 1]
                        if (area && area.length > 0 && area.length < 50) { // Reasonable area name length
                          tripPlanningData.area = area
                          console.log(`✅ Extracted area "${area}" from user message: "${userMsg}"`)
                        }
                      }
                    }
                  }
                }
                
                // Extract country_from criteria (very flexible patterns)
                // Check if message mentions countries AND has requirement language
                const hasRequirementLanguage = userMsgLower.includes('from') || 
                                               userMsgLower.includes('must be') || 
                                               userMsgLower.includes('have to be') || 
                                               userMsgLower.includes('the surfer') || 
                                               userMsgLower.includes('the surfers') || 
                                               userMsgLower.includes('they have to be') ||
                                               userMsgLower.includes('must be from') || 
                                               userMsgLower.includes('have to be from') ||
                                               userMsgLower.includes('only from') ||
                                               userMsgLower.includes('be only from') ||
                                               userMsgLower.includes('send me') ||
                                               userMsgLower.includes('i want') ||
                                               userMsgLower.includes('connect me') ||
                                               userMsgLower.includes('find me') ||
                                               userMsgLower.includes('american') ||
                                               userMsgLower.includes('americans')
                
                const mentionsUSA = userMsgLower.includes('usa') || 
                                   userMsgLower.includes('united states') || 
                                   userMsgLower.includes('u.s.a') || 
                                   userMsgLower.includes('u.s.') || 
                                   userMsgLower.includes('american') ||
                                   (userMsgLower.includes('us') && !userMsgLower.includes('israel'))
                
                const mentionsIsrael = userMsgLower.includes('israel')
                
                // If message has requirement language AND mentions countries, extract them
                if (hasRequirementLanguage && (mentionsUSA || mentionsIsrael)) {
                  if (!tripPlanningData.non_negotiable_criteria.country_from) {
                    tripPlanningData.non_negotiable_criteria.country_from = []
                  }
                  
                  if (mentionsUSA) {
                    // Validate "USA" against official list, use AI correction if needed
                    let countryName: string | null = 'USA';
                    if (!validateCountryName(countryName)) {
                      console.log(`⚠️ "USA" not found in official list, asking AI to correct...`);
                      const corrected = await correctCountryNameWithAI(countryName);
                      if (corrected && validateCountryName(corrected)) {
                        countryName = corrected;
                      } else {
                        console.warn(`❌ Could not correct "USA", skipping`);
                        countryName = null;
                      }
                    }
                    if (countryName && !tripPlanningData.non_negotiable_criteria.country_from.includes(countryName)) {
                      tripPlanningData.non_negotiable_criteria.country_from.push(countryName);
                      console.log(`✅ Extracted and validated "${countryName}" from user message: "${userMsg}"`);
                    }
                  }
                  
                  if (mentionsIsrael) {
                    // Validate "Israel" against official list
                    let countryName: string | null = 'Israel';
                    if (!validateCountryName(countryName)) {
                      console.log(`⚠️ "Israel" not found in official list, asking AI to correct...`);
                      const corrected = await correctCountryNameWithAI(countryName);
                      if (corrected && validateCountryName(corrected)) {
                        countryName = corrected;
                      } else {
                        console.warn(`❌ Could not correct "Israel", skipping`);
                        countryName = null;
                      }
                    }
                    if (countryName && !tripPlanningData.non_negotiable_criteria.country_from.includes(countryName)) {
                      tripPlanningData.non_negotiable_criteria.country_from.push(countryName);
                      console.log(`✅ Extracted and validated "${countryName}" from user message: "${userMsg}"`);
                    }
                  }
                  
                  if (tripPlanningData.non_negotiable_criteria.country_from.length > 0) {
                    console.log('✅ Final country_from criteria:', tripPlanningData.non_negotiable_criteria.country_from)
                  }
                }
                
                // Extract other criteria patterns
                if (userMsgLower.includes('must be') || userMsgLower.includes('have to be') || userMsgLower.includes('only')) {
                  // Extract surfboard type
                  if (userMsgLower.includes('shortboard') || userMsgLower.includes('short board')) {
                    tripPlanningData.non_negotiable_criteria.surfboard_type = tripPlanningData.non_negotiable_criteria.surfboard_type || []
                    if (!tripPlanningData.non_negotiable_criteria.surfboard_type.includes('shortboard')) {
                      tripPlanningData.non_negotiable_criteria.surfboard_type.push('shortboard')
                      console.log(`✅ Extracted surfboard_type: shortboard from "${userMsg}"`)
                    }
                  }
                  if (userMsgLower.includes('midlength') || userMsgLower.includes('mid length') || userMsgLower.includes('mid-length')) {
                    tripPlanningData.non_negotiable_criteria.surfboard_type = tripPlanningData.non_negotiable_criteria.surfboard_type || []
                    if (!tripPlanningData.non_negotiable_criteria.surfboard_type.includes('mid_length')) {
                      tripPlanningData.non_negotiable_criteria.surfboard_type.push('mid_length')
                      console.log(`✅ Extracted surfboard_type: mid_length from "${userMsg}"`)
                    }
                  }
                  if (userMsgLower.includes('longboard') || userMsgLower.includes('long board')) {
                    tripPlanningData.non_negotiable_criteria.surfboard_type = tripPlanningData.non_negotiable_criteria.surfboard_type || []
                    if (!tripPlanningData.non_negotiable_criteria.surfboard_type.includes('longboard')) {
                      tripPlanningData.non_negotiable_criteria.surfboard_type.push('longboard')
                      console.log(`✅ Extracted surfboard_type: longboard from "${userMsg}"`)
                    }
                  }
                  if (userMsgLower.includes('softtop') || userMsgLower.includes('soft top') || userMsgLower.includes('soft-top')) {
                    tripPlanningData.non_negotiable_criteria.surfboard_type = tripPlanningData.non_negotiable_criteria.surfboard_type || []
                    if (!tripPlanningData.non_negotiable_criteria.surfboard_type.includes('soft_top')) {
                      tripPlanningData.non_negotiable_criteria.surfboard_type.push('soft_top')
                      console.log(`✅ Extracted surfboard_type: soft_top from "${userMsg}"`)
                    }
                  }
                }
              }
            }
            console.log('✅ Final enriched data (fallback):', JSON.stringify(tripPlanningData, null, 2))
          } else {
            console.log('✅ ChatGPT successfully extracted all data - no fallback needed')
          }
        }
        
        // FALLBACK: If return message contains completion text but is_finished is false, 
        // try to extract data from conversation history or parsed response
        let shouldBeFinished = parsed.is_finished || false
        
        // If user wants more users with same filters, trigger matching immediately
        if (awaitingFilterDecision && filterIntent === 'more' && tripPlanningData) {
          shouldBeFinished = true
          console.log('[continue] User wants more users - setting is_finished: true to trigger matching')
          // Update return message to indicate we're finding more matches
          if (returnMessage && !returnMessage.includes('Copy! Here are a few advisor options')) {
            returnMessage = "Copy! Here are a few advisor options that best match what you're looking for."
          }
        }
        
        if (!shouldBeFinished && returnMessage.toLowerCase().includes('copy! here are a few advisor options')) {
          console.log('⚠️ DETECTED COMPLETION MESSAGE BUT is_finished IS FALSE - Attempting to extract data')
          shouldBeFinished = true
          
          // Try to extract data from root level if not in nested data field
          if (!tripPlanningData) {
            // First try from parsed response root level
            tripPlanningData = {
              destination_country: parsed.destination_country || null,
              area: parsed.area || null,
              budget: parsed.budget || null,
              destination_known: parsed.destination_known !== undefined ? parsed.destination_known : true,
              purpose: parsed.purpose || {
                purpose_type: 'connect_traveler',
                specific_topics: []
              },
              non_negotiable_criteria: parsed.non_negotiable_criteria || {},
              user_context: parsed.user_context || {},
              queryFilters: null, // Initialize queryFilters field
              filtersFromNonNegotiableStep: false, // Initialize flag
            }
            
            // If still no data, try to extract from previous messages in conversation
            if (!tripPlanningData.destination_country && messages.length > 0) {
              console.log('⚠️ Attempting to extract data from conversation history')
              // Look through previous assistant messages for data
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'assistant') {
                  try {
                    const prevParsed = JSON.parse(messages[i].content)
                    if (prevParsed.destination_country || prevParsed.data?.destination_country) {
                      tripPlanningData = {
                        destination_country: prevParsed.destination_country || prevParsed.data?.destination_country || null,
                        area: prevParsed.area || prevParsed.data?.area || null,
                        budget: prevParsed.budget || prevParsed.data?.budget || null,
                        destination_known: prevParsed.destination_known !== undefined ? prevParsed.destination_known : (prevParsed.data?.destination_known !== undefined ? prevParsed.data.destination_known : true),
                        purpose: prevParsed.purpose || prevParsed.data?.purpose || {
                          purpose_type: 'connect_traveler',
                          specific_topics: []
                        },
                        non_negotiable_criteria: await normalizeNonNegotiableCriteria(prevParsed.non_negotiable_criteria || prevParsed.data?.non_negotiable_criteria || {}),
                        user_context: prevParsed.user_context || prevParsed.data?.user_context || {},
                        queryFilters: prevParsed.data?.queryFilters ? await normalizeQueryFilters(prevParsed.data.queryFilters) : null, // Preserve and normalize existing queryFilters
                        filtersFromNonNegotiableStep: prevParsed.data?.filtersFromNonNegotiableStep || false, // Preserve flag
                      }
                      console.log('✅ Extracted data from previous message:', tripPlanningData)
                      break
                    }
                  } catch (e) {
                    // Not JSON, continue
                  }
                }
              }
            }
            
            // Last resort: extract from user messages (look for country mentions)
            if (!tripPlanningData.destination_country && messages.length > 0) {
              console.log('⚠️ Attempting to extract destination from user messages')
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                  const userMsg = messages[i].content
                  const userMsgLower = userMsg.toLowerCase()
                  
                  // Handle "Siargao, in the Philippines" or "Siargao, the Philippins" or "Siargao, filipins" pattern
                  // Check for various spellings: philippines, philippins, filipins, filipines
                  const philippinesPattern = /philippines|philippins|filipins|filipines/i
                  if (philippinesPattern.test(userMsgLower)) {
                    let area = null
                    // Check if area is mentioned before country (e.g., "Siargao, in the Philippines" or "Siargao, filipins")
                    // Try multiple patterns - be flexible with spacing and "the"
                    const patterns = [
                      /([^,]+),\s*(?:in\s+)?(?:the\s+)?(?:philippines|philippins|filipins|filipines)/i,  // "Siargao, in the Philippines" or "Siargao, filipins"
                      /([^,]+),\s*(?:the\s+)?(?:philippines|philippins|filipins|filipines)/i,  // "Siargao, the Philippins"
                      /([^,]+)\s+(?:in\s+)?(?:the\s+)?(?:philippines|philippins|filipins|filipines)/i,  // "Siargao in the Philippines"
                      /([^,\s]+)\s*,\s*(?:philippines|philippins|filipins|filipines)/i,  // "Siargao, filipins" (simple comma)
                    ]
                    for (const pattern of patterns) {
                      const areaMatch = userMsg.match(pattern)
                      if (areaMatch && areaMatch[1]) {
                        area = areaMatch[1].trim()
                        // Don't include common words that aren't area names
                        const areaLower = area.toLowerCase()
                        if (areaLower !== 'the' && areaLower !== 'in' && areaLower.length > 2) {
                          break
                        } else {
                          area = null
                        }
                      }
                    }
                    tripPlanningData = {
                      destination_country: 'Philippines',
                      area: area,
                      budget: null,
                      destination_known: true,
                      purpose: {
                        purpose_type: 'connect_traveler',
                        specific_topics: []
                      },
                      non_negotiable_criteria: {},
                      user_context: {},
                      queryFilters: null,
                      filtersFromNonNegotiableStep: false,
                    }
                    console.log('✅ Extracted destination from user message:', tripPlanningData.destination_country, 'area:', tripPlanningData.area)
                    break
                  }
                  
                  // Common country names
                  const countries = ['el salvador', 'sri lanka', 'costa rica', 'indonesia', 'portugal', 'spain', 'france', 'brazil', 'australia', 'nicaragua', 'panama', 'mexico', 'peru', 'chile']
                  for (const country of countries) {
                    if (userMsgLower.includes(country)) {
                      let area = null
                      // Check if area is mentioned before country (e.g., "Siargao, Philippines")
                      const countryEscaped = country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
                      const areaMatch = userMsg.match(new RegExp(`([^,]+),\\s*(?:in\\s+)?(?:the\\s+)?${countryEscaped}`, 'i'))
                      if (areaMatch && areaMatch[1]) {
                        area = areaMatch[1].trim()
                      }
                      tripPlanningData = {
                        destination_country: country.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                        area: area,
                        budget: null,
                        destination_known: true,
                        purpose: {
                          purpose_type: 'connect_traveler',
                          specific_topics: []
                        },
                        non_negotiable_criteria: {},
                        user_context: {},
                        queryFilters: null,
                        filtersFromNonNegotiableStep: false,
                      }
                      console.log('✅ Extracted destination from user message:', tripPlanningData.destination_country, 'area:', tripPlanningData.area)
                      break
                    }
                  }
                  if (tripPlanningData.destination_country) break
                }
              }
            }
          }
        }
        
        // Add extracted query filters to tripPlanningData if available
        // This should happen AFTER all tripPlanningData initialization
        // CRITICAL: Always add queryFilters if they were extracted, even if tripPlanningData already exists
        // Also populate non_negotiable_criteria.age_range from queryFilters.age_min/age_max
        if (extractedQueryFilters && Object.keys(extractedQueryFilters).length > 0) {
          // If age filters were extracted, also populate non_negotiable_criteria.age_range
          if (extractedQueryFilters.age_min !== undefined && extractedQueryFilters.age_max !== undefined) {
            if (!tripPlanningData) {
              tripPlanningData = {
                destination_country: null,
                area: null,
                budget: null,
                destination_known: true,
                purpose: { purpose_type: 'connect_traveler', specific_topics: [] },
                non_negotiable_criteria: {},
                user_context: {},
                queryFilters: null,
                filtersFromNonNegotiableStep: false,
              };
            }
            if (!tripPlanningData.non_negotiable_criteria) {
              tripPlanningData.non_negotiable_criteria = {};
            }
            tripPlanningData.non_negotiable_criteria.age_range = [
              extractedQueryFilters.age_min,
              extractedQueryFilters.age_max
            ];
            console.log('✅ Populated non_negotiable_criteria.age_range from queryFilters:', tripPlanningData.non_negotiable_criteria.age_range);
          }
          if (!tripPlanningData) {
            // Get destination from conversation history if tripPlanningData doesn't exist
            let fallbackDestination = ''
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'assistant') {
                try {
                  const prevParsed = JSON.parse(messages[i].content)
                  if (prevParsed.data?.destination_country) {
                    fallbackDestination = prevParsed.data.destination_country
                    break
                  }
                } catch (e) {
                  // Not JSON, continue
                }
              }
            }
            
            // Create tripPlanningData if it doesn't exist
            // Normalize queryFilters before assigning to ensure country names are correct
            const normalizedQueryFilters = await normalizeQueryFilters(extractedQueryFilters);
            tripPlanningData = {
              destination_country: fallbackDestination || null,
              area: null,
              budget: null,
              destination_known: true,
              purpose: {
                purpose_type: 'connect_traveler',
                specific_topics: []
              },
              non_negotiable_criteria: {},
              user_context: {},
              queryFilters: normalizedQueryFilters,
              filtersFromNonNegotiableStep: isCriteriaStep, // Mark if filters came from non-negotiable step
            }
            console.log('✅ Created tripPlanningData with query filters (from non-negotiable step:', isCriteriaStep, ')')
          } else {
            // Merge filters: if tripPlanningData already has filters, merge them (current takes precedence)
            // Normalize queryFilters before assigning to ensure country names are correct
            const normalizedQueryFilters = await normalizeQueryFilters(extractedQueryFilters);
            
            // Handle filter management based on user intent
            if (awaitingFilterDecision && filterIntent === 'more') {
              // User wants more users with same filters - keep existing filters unchanged
              console.log('🔄 User wants more users - keeping existing filters:', JSON.stringify(tripPlanningData.queryFilters, null, 2))
              // Don't change queryFilters - keep existing ones
            } else if (awaitingFilterDecision && filterIntent === 'replace') {
              // User wants to replace filters - use only new filters
              tripPlanningData.queryFilters = normalizedQueryFilters
              console.log('🗑️ User wants to replace filters - using only new filters')
            } else if (awaitingFilterDecision && filterIntent === 'add' && tripPlanningData.queryFilters) {
              // User wants to add filters - merge with existing
              tripPlanningData.queryFilters = {
                ...tripPlanningData.queryFilters,
                ...normalizedQueryFilters, // Current filters override existing ones
              }
              console.log('🔄 Merged filters (existing + current)')
            } else if (awaitingFilterClarification && filterIntent === 'replace' && pendingFilters) {
              // User clarified they want to replace - use pending filters
              const normalizedPendingFilters = await normalizeQueryFilters(pendingFilters)
              tripPlanningData.queryFilters = normalizedPendingFilters
              console.log('🗑️ User wants to replace - using pending filters')
            } else if (awaitingFilterClarification && filterIntent === 'add' && pendingFilters) {
              // User clarified they want to add - merge pending with existing
              const normalizedPendingFilters = await normalizeQueryFilters(pendingFilters)
              if (tripPlanningData.queryFilters) {
                tripPlanningData.queryFilters = {
                  ...tripPlanningData.queryFilters,
                  ...normalizedPendingFilters,
                }
                console.log('🔄 User wants to add - merged pending with existing')
              } else {
                tripPlanningData.queryFilters = normalizedPendingFilters
                console.log('📦 User wants to add - using pending filters only')
              }
            } else if (tripPlanningData.queryFilters) {
              // Normal merge (no filter decision context)
              tripPlanningData.queryFilters = {
                ...tripPlanningData.queryFilters,
                ...normalizedQueryFilters, // Current filters override accumulated ones
              }
            } else {
              tripPlanningData.queryFilters = normalizedQueryFilters
            }
            // Update flag: if current step is non-negotiable, mark it
            if (isCriteriaStep) {
              tripPlanningData.filtersFromNonNegotiableStep = true
            }
            console.log('✅ Added/updated query filters in tripPlanningData (from non-negotiable step:', isCriteriaStep, ')')
          }
          console.log('Query filters being stored:', JSON.stringify(extractedQueryFilters, null, 2))
        } else if (extractedQueryFilters && Object.keys(extractedQueryFilters).length === 0) {
          console.log('⚠️ Query filters were extracted but are empty - skipping')
        }
        
        // FALLBACK: Build queryFilters from non_negotiable_criteria if queryFilters is null/empty
        // This ensures filters are available even if AI extraction failed or returned empty
        if (tripPlanningData && (!tripPlanningData.queryFilters || Object.keys(tripPlanningData.queryFilters).length === 0)) {
          if (tripPlanningData.non_negotiable_criteria && Object.keys(tripPlanningData.non_negotiable_criteria).length > 0) {
            console.log('🔧 Building queryFilters from non_negotiable_criteria as fallback')
            tripPlanningData.queryFilters = tripPlanningData.queryFilters || {}
            
            // Build queryFilters from non_negotiable_criteria
            if (tripPlanningData.non_negotiable_criteria.surfboard_type && tripPlanningData.non_negotiable_criteria.surfboard_type.length > 0) {
              tripPlanningData.queryFilters.surfboard_type = tripPlanningData.non_negotiable_criteria.surfboard_type
              console.log('  - Added surfboard_type:', tripPlanningData.queryFilters.surfboard_type)
            }
            
            if (tripPlanningData.non_negotiable_criteria.age_range && Array.isArray(tripPlanningData.non_negotiable_criteria.age_range) && tripPlanningData.non_negotiable_criteria.age_range.length === 2) {
              tripPlanningData.queryFilters.age_min = tripPlanningData.non_negotiable_criteria.age_range[0]
              tripPlanningData.queryFilters.age_max = tripPlanningData.non_negotiable_criteria.age_range[1]
              console.log('  - Added age range:', tripPlanningData.queryFilters.age_min, '-', tripPlanningData.queryFilters.age_max)
            }
            
            if (tripPlanningData.non_negotiable_criteria.country_from && tripPlanningData.non_negotiable_criteria.country_from.length > 0) {
              // Normalize country_from before adding to queryFilters using validation-first + AI correction
              const normalizedCountries = await Promise.all(
                (tripPlanningData.non_negotiable_criteria.country_from as string[]).map(async (country: string) => {
                  // First validate directly against official list
                  if (validateCountryName(country)) {
                    // Country is valid, use it as-is
                    return country;
                  }
                  
                  // Country not in list, ask AI to correct it
                  console.log(`⚠️ Country "${country}" in non_negotiable_criteria not found in official list, asking AI to correct...`);
                  const corrected = await correctCountryNameWithAI(country);
                  
                  // Validate the AI-corrected result
                  if (corrected && validateCountryName(corrected)) {
                    return corrected;
                  } else {
                    console.warn(`❌ Country "${country}" couldn't be corrected by AI, removing from filters`);
                    return null;
                  }
                })
              );
              
              const validCountries = normalizedCountries.filter(
                (country): country is string => country !== null
              );
              const uniqueCountries = Array.from(new Set(validCountries));
              
              if (uniqueCountries.length > 0) {
                tripPlanningData.queryFilters.country_from = uniqueCountries;
                console.log('  - Added normalized country_from:', tripPlanningData.queryFilters.country_from);
              } else {
                console.warn('  - ⚠️ All countries in non_negotiable_criteria.country_from were invalid, skipping');
              }
            }
            
            if (tripPlanningData.non_negotiable_criteria.surf_level_min !== undefined && tripPlanningData.non_negotiable_criteria.surf_level_min !== null) {
              tripPlanningData.queryFilters.surf_level_min = tripPlanningData.non_negotiable_criteria.surf_level_min
              console.log('  - Added surf_level_min:', tripPlanningData.queryFilters.surf_level_min)
            }
            
            if (tripPlanningData.non_negotiable_criteria.surf_level_max !== undefined && tripPlanningData.non_negotiable_criteria.surf_level_max !== null) {
              tripPlanningData.queryFilters.surf_level_max = tripPlanningData.non_negotiable_criteria.surf_level_max
              console.log('  - Added surf_level_max:', tripPlanningData.queryFilters.surf_level_max)
            }
            
            // Set flag if any non-negotiable criteria exist
            if (Object.keys(tripPlanningData.queryFilters).length > 0) {
              tripPlanningData.filtersFromNonNegotiableStep = true
              console.log('✅ Set filtersFromNonNegotiableStep to true (built from non_negotiable_criteria)')
            }
          }
        }
        
        // Ensure filtersFromNonNegotiableStep is set if non_negotiable_criteria exists
        // This handles cases where non_negotiable_criteria was set but flag wasn't updated
        if (tripPlanningData && tripPlanningData.non_negotiable_criteria && Object.keys(tripPlanningData.non_negotiable_criteria).length > 0) {
          // Check if any non-negotiable criteria has actual values
          const hasNonNegotiableValues = 
            (tripPlanningData.non_negotiable_criteria.surfboard_type && tripPlanningData.non_negotiable_criteria.surfboard_type.length > 0) ||
            (tripPlanningData.non_negotiable_criteria.country_from && tripPlanningData.non_negotiable_criteria.country_from.length > 0) ||
            (tripPlanningData.non_negotiable_criteria.age_range && Array.isArray(tripPlanningData.non_negotiable_criteria.age_range) && tripPlanningData.non_negotiable_criteria.age_range.length === 2) ||
            (tripPlanningData.non_negotiable_criteria.surf_level_min !== undefined && tripPlanningData.non_negotiable_criteria.surf_level_min !== null) ||
            (tripPlanningData.non_negotiable_criteria.surf_level_max !== undefined && tripPlanningData.non_negotiable_criteria.surf_level_max !== null)
          
          if (hasNonNegotiableValues && !tripPlanningData.filtersFromNonNegotiableStep) {
            tripPlanningData.filtersFromNonNegotiableStep = true
            console.log('✅ Set filtersFromNonNegotiableStep to true (non_negotiable_criteria exists with values)')
          }
        }
        
        parsedResponse = {
          return_message: returnMessage,
          is_finished: shouldBeFinished,
          data: tripPlanningData || null
        }
        
        console.log('=== FINAL RESPONSE BEING SENT (continue) ===')
        console.log(JSON.stringify(parsedResponse, null, 2))
        console.log('is_finished:', parsedResponse.is_finished)
        console.log('has data:', !!parsedResponse.data)
        console.log('data keys:', parsedResponse.data ? Object.keys(parsedResponse.data) : 'null')
        if (parsedResponse.data?.queryFilters) {
          console.log('queryFilters:', JSON.stringify(parsedResponse.data.queryFilters, null, 2))
        }
        console.log('==========================================')
      } catch (parseError) {
        console.error('Error parsing JSON from ChatGPT (continue):', parseError)
        console.log('Raw message that failed to parse (continue):', assistantMessage)
        
        // Check if it's the completion message even though it's not JSON (more flexible check)
        const isCompletionMessage = assistantMessage.toLowerCase().includes('copy! here are') || 
                                   assistantMessage.toLowerCase().includes('advisor options') ||
                                   assistantMessage.toLowerCase().includes('best match')
        
        if (isCompletionMessage) {
          console.log('⚠️ Detected completion message in error handler - extracting from conversation history')
          
          // Extract data from conversation history
          let extractedData: any = {
            destination_country: null,
            area: null,
            budget: null,
            destination_known: true,
            purpose: {
              purpose_type: 'connect_traveler',
              specific_topics: []
            },
            non_negotiable_criteria: {},
            user_context: {}
          }
          
          // Look through messages for destination and criteria
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            
            // Extract from user messages
            if (msg.role === 'user') {
              const userMsg = msg.content.toLowerCase()
              
              // Extract destination country
              if (!extractedData.destination_country) {
                const countries = ['el salvador', 'sri lanka', 'costa rica', 'indonesia', 'portugal', 'spain', 'france', 'brazil', 'australia', 'nicaragua', 'panama', 'mexico', 'peru', 'chile']
                for (const country of countries) {
                  if (userMsg.includes(country)) {
                    extractedData.destination_country = country.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                    break
                  }
                }
              }
              
              // Extract country_from criteria
              if (userMsg.includes('from') && (userMsg.includes('usa') || userMsg.includes('israel') || userMsg.includes('united states') || userMsg.includes('american'))) {
                extractedData.non_negotiable_criteria = extractedData.non_negotiable_criteria || {}
                extractedData.non_negotiable_criteria.country_from = []
                if (userMsg.includes('usa') || userMsg.includes('united states') || userMsg.includes('american')) {
                  // Validate "USA" against official list, use AI correction if needed
                  let countryName: string | null = 'USA';
                  if (!validateCountryName(countryName)) {
                    const corrected = await correctCountryNameWithAI(countryName);
                    if (corrected && validateCountryName(corrected)) {
                      countryName = corrected;
                    } else {
                      countryName = null;
                    }
                  }
                  if (countryName && !extractedData.non_negotiable_criteria.country_from.includes(countryName)) {
                    extractedData.non_negotiable_criteria.country_from.push(countryName);
                  }
                }
                if (userMsg.includes('israel')) {
                  // Validate "Israel" against official list
                  let countryName: string | null = 'Israel';
                  if (!validateCountryName(countryName)) {
                    const corrected = await correctCountryNameWithAI(countryName);
                    if (corrected && validateCountryName(corrected)) {
                      countryName = corrected;
                    } else {
                      countryName = null;
                    }
                  }
                  if (countryName && !extractedData.non_negotiable_criteria.country_from.includes(countryName)) {
                    extractedData.non_negotiable_criteria.country_from.push(countryName);
                  }
                }
              }
            }
            
            // Extract from previous assistant JSON responses
            if (msg.role === 'assistant') {
              try {
                const prevParsed = JSON.parse(msg.content)
                if (prevParsed.destination_country || prevParsed.data?.destination_country) {
                  extractedData.destination_country = extractedData.destination_country || prevParsed.destination_country || prevParsed.data?.destination_country
                  extractedData.area = extractedData.area || prevParsed.area || prevParsed.data?.area
                  extractedData.budget = extractedData.budget || prevParsed.budget || prevParsed.data?.budget
                  if (prevParsed.non_negotiable_criteria || prevParsed.data?.non_negotiable_criteria) {
                    extractedData.non_negotiable_criteria = { ...extractedData.non_negotiable_criteria, ...(prevParsed.non_negotiable_criteria || prevParsed.data?.non_negotiable_criteria) }
                  }
                  if (prevParsed.purpose || prevParsed.data?.purpose) {
                    extractedData.purpose = prevParsed.purpose || prevParsed.data?.purpose
                  }
                }
              } catch (e) {
                // Not JSON, continue
              }
            }
          }
          
          parsedResponse = {
            return_message: assistantMessage,
            is_finished: extractedData.destination_country ? true : false, // Only finish if we have a destination
            data: extractedData.destination_country ? extractedData : null
          }
          
          console.log('✅ Extracted data from conversation history:', extractedData)
        } else {
          // Not a completion message, return as-is
          parsedResponse = {
            return_message: assistantMessage,
            is_finished: false,
            data: null
          }
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

    // Route: POST /swelly-trip-planning/attach-matches/:chat_id
    if (path.includes('/attach-matches/') && req.method === 'POST') {
      const chatId = path.split('/attach-matches/')[1]
      const body: { matchedUsers: MatchedUser[]; destinationCountry: string } = await req.json()

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

      if (!body.matchedUsers || !Array.isArray(body.matchedUsers)) {
        return new Response(
          JSON.stringify({ error: 'Invalid matchedUsers data' }),
          { 
            status: 400, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            } 
          }
        )
      }

      // Allow empty string for destinationCountry (it's optional and used for display)
      if (body.destinationCountry !== undefined && typeof body.destinationCountry !== 'string') {
        return new Response(
          JSON.stringify({ error: 'Invalid destinationCountry - must be a string' }),
          { 
            status: 400, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            } 
          }
        )
      }

      try {
        // Load chat history from database
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

        // Find the most recent assistant message that doesn't already have matched users metadata
        // This ensures we attach to the message that just finished and triggered the matching
        // If a message already has metadata, it means matches were already attached, so skip it
        let targetAssistantIndex = -1
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            // Skip if this message already has matched users metadata
            if (messages[i].metadata?.matchedUsers) {
              console.log('[attach-matches] Skipping assistant message at index', i, '- already has matched users metadata')
              continue
            }
            // Check if this assistant message has is_finished: true in its content
            try {
              const parsed = JSON.parse(messages[i].content)
              if (parsed.is_finished === true) {
                targetAssistantIndex = i
                console.log('[attach-matches] Found target assistant message with is_finished: true at index:', i)
                break
              }
            } catch {
              // Not JSON or parse error - continue searching
            }
          }
        }

        // Fallback: If no message with is_finished: true found, use the last assistant message without metadata
        // This handles edge cases where the message format might be different
        if (targetAssistantIndex === -1) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && !messages[i].metadata?.matchedUsers) {
              targetAssistantIndex = i
              console.log('[attach-matches] Using fallback - last assistant message without metadata at index:', i)
              break
            }
          }
        }

        if (targetAssistantIndex === -1) {
          return new Response(
            JSON.stringify({ error: 'No assistant message found to attach matches to' }),
            { 
              status: 404, 
              headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              } 
            }
          )
        }

        // Attach metadata to the target assistant message
        const targetAssistantMessage = messages[targetAssistantIndex]
        console.log('[attach-matches] Found target assistant message at index:', targetAssistantIndex)
        console.log('[attach-matches] Message content preview:', targetAssistantMessage.content.substring(0, 100))
        if (targetAssistantMessage.metadata) {
          console.log('[attach-matches] Message already has metadata:', !!targetAssistantMessage.metadata.matchedUsers)
        }
        
        targetAssistantMessage.metadata = {
          matchedUsers: body.matchedUsers,
          destinationCountry: body.destinationCountry,
          matchTimestamp: new Date().toISOString(),
          awaitingFilterDecision: true // Set flag to track that we're waiting for filter decision
        }
        
        console.log('[attach-matches] Attached metadata to message:', {
          index: targetAssistantIndex,
          matchedUsersCount: body.matchedUsers.length,
          destinationCountry: body.destinationCountry,
          messageHasMetadata: !!targetAssistantMessage.metadata,
          metadataObject: JSON.stringify(targetAssistantMessage.metadata).substring(0, 200)
        })
        
        // Verify metadata is in the messages array before saving
        const messageBeforeSave = messages[targetAssistantIndex]
        console.log('[attach-matches] Message before save has metadata:', !!messageBeforeSave.metadata?.matchedUsers)
        console.log('[attach-matches] Full message object before save:', JSON.stringify(messageBeforeSave).substring(0, 300))

        // Add system message asking about filters after matches are attached
        const filterDecisionMessage: Message = {
          role: 'assistant',
          content: JSON.stringify({
            return_message: "Yo! How do these matches look? You can: (1) Get more users with the same filters, (2) Add new filters to your current ones, or (3) Replace all filters and start fresh. What would you like to do?",
            is_finished: false,
            data: null
          }),
          metadata: {
            isFilterDecisionPrompt: true
          }
        }
        messages.push(filterDecisionMessage)
        console.log('[attach-matches] Added filter decision prompt message')
        
        // Save updated messages array back to database
        console.log('[attach-matches] Saving', messages.length, 'messages to database')
        await saveChatHistory(chatId, messages, user.id, null, supabaseAdmin)
        console.log('[attach-matches] Save completed successfully')
        
        // Verify the save by reading back
        const verifyMessages = await getChatHistory(chatId, supabaseAdmin)
        const verifyMessage = verifyMessages[targetAssistantIndex]
        if (verifyMessage?.metadata?.matchedUsers) {
          console.log('[attach-matches] ✅ Verified: Metadata saved successfully,', verifyMessage.metadata.matchedUsers.length, 'matched users')
        } else {
          console.error('[attach-matches] ❌ ERROR: Metadata was not saved! Message at index', targetAssistantIndex, 'has no metadata after save')
        }

        return new Response(
          JSON.stringify({ success: true, message: 'Matched users attached successfully' }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        )
      } catch (error) {
        console.error('Error attaching matched users:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to attach matched users', details: error instanceof Error ? error.message : String(error) }),
          { 
            status: 500, 
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            } 
          }
        )
      }
    }

    // Route: GET /swelly-trip-planning/:chat_id
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
    if (path.endsWith('/health') || path === '/swelly-trip-planning' || path.endsWith('/swelly-trip-planning')) {
      return new Response(
        JSON.stringify({ status: 'healthy', message: 'Swelly Trip Planning API is running' }),
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

