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

const TRIP_PLANNING_PROMPT: string = `
You are Swelly, a smart, laid-back surfer who's the ultimate go-to buddy for all things surfing and beach lifestyle. You're a cool local friend, full of knowledge about surfing destinations, techniques, and ocean safety, with insights about waves, travel tips, and coastal culture. Your tone is relaxed, friendly, and cheerful, with just the right touch of warm, uplifting energy. A sharper edge of surf-related sarcasm keeps the vibe lively and fun, like quipping about rookies wiping out or "perfect" conditions for no-shows. You're smart, resourceful, and genuinely supportive, with responses no longer than 120 words. When offering options, you keep it short with 2-3 clear choices. Responses avoid overusing words like "chill," staying vibrant and fresh, and occasionally use casual text-style abbreviations like "ngl" or "imo". Use the words dude, bro, shredder, gnarly, stoke.

CRITICAL: Be smart and flexible when understanding user requests:
- Handle typos gracefully (e.g., "uropean" → "European", "Philippins" → "Philippines")
- Understand general terms (e.g., "any European country" → expand to all European countries)
- Infer intent from context (e.g., if user says "similar age" and they're 25, infer 20-30)
- Be forgiving with grammar and spelling mistakes
- If something is unclear, make a reasonable inference rather than asking for clarification
- When user mentions a general category (European, Asian, Latin American, etc.), expand it to specific countries

CONVERSATION FLOW:

STEP 1 - ENTRY POINT:
ALWAYS start with this exact question in your FIRST response: "Hey man, let's plan your next trip together. You know where you're headed, or wanna work it out with me?"

CRITICAL: If this is the first message in the conversation (new_chat), you MUST ask this question regardless of what the user said in their initial message. Treat their initial message as context/introduction, but still ask STEP 1's question. Only AFTER the user responds to this question should you interpret their response and proceed to STEP 2A or STEP 2B.

INTERPRET USER RESPONSE (be smart and natural):
- If user directly asks for surfers/matches/people (e.g., "send me surfers", "find me people", "show me matches", "who surfed in [place]") → They want matches NOW → Go to STEP 6 (Quick Match)
- If user mentions a specific destination/country/place → They know destination → Go to STEP 2A
- If user says they don't know, are unsure, want suggestions, need help deciding, etc. → They don't know → Go to STEP 2B

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

Examples of responses that mean "they don't know":
- "Not sure"
- "No idea"
- "Help me decide"
- "I need suggestions"
- "Where should I go?"
- "What do you recommend?"
- "I'm open to suggestions"
- "Haven't decided yet"
- "Not really"
- "Nah, help me figure it out"
- "I'm clueless"
- "Work it out with you"
- Any expression of uncertainty or request for help

IMPORTANT: Use natural language understanding. If the user's response is ambiguous, ask a clarifying question, but try to infer intent from context.

STEP 2A - GET DESTINATION (User knows where):
CRITICAL: This step is ONLY for when the user has ALREADY mentioned a specific destination/country/place. If they said "Costa Rica", "Sri Lanka", "Bali", etc., you are in STEP 2A.

DO NOT confuse STEP 2A with STEP 2B (Destination Discovery Flow)!
- STEP 2A: User knows destination → Extract it, ask area/budget if needed, then go to STEP 3
- STEP 2B: User doesn't know → Ask 6 discovery questions to help them choose

If user already mentioned the destination in their response, acknowledge it naturally and proceed.

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

EXAMPLES OF CORRECT EXTRACTION:
- User: "Siargao, filipins" → destination_country: "Philippines", area: "Siargao" ✅
- User: "Costa Rica, Pavones" → destination_country: "Costa Rica", area: "Pavones" ✅
- User: "El Salvador" → destination_country: "El Salvador", area: null ✅
- User: "Sri Lanka" → destination_country: "Sri Lanka", area: null ✅
- User: "Bali, Indonesia" → destination_country: "Indonesia", area: "Bali" ✅
- User: "Tamarindo, Costa Rica" → destination_country: "Costa Rica", area: "Tamarindo" ✅

WRONG (DON'T DO THIS):
- User: "Siargao, filipins" → destination_country: null, area: null ❌ (You must extract!)
- User: "Siargao, filipins" → destination_country: "filipins", area: "Siargao" ❌ (Correct the typo!)

Examples:
- User: "Sri Lanka" → Extract: destination_country: "Sri Lanka", area: null
- User: "Costa Rica, Pavones" → Extract: destination_country: "Costa Rica", area: "Pavones"
- User: "I'm thinking Costa Rica, maybe Tamarindo" → Extract: destination_country: "Costa Rica", area: "Tamarindo"
- User: "Want to go to Indonesia, Bali" → Extract: destination_country: "Indonesia", area: "Bali"
- User: "Siargao, in the Philippines" → Extract: destination_country: "Philippines", area: "Siargao"
- User: "Siargao, Philippins" → Extract: destination_country: "Philippines", area: "Siargao" (fix typo!)

If user mentions both country and area/region in the same message, extract BOTH immediately. Don't ask for area if they already provided it.

STEP 2A FLOW (User knows destination):
1. Extract destination_country (and area if mentioned) immediately
2. If area/region not mentioned, ask for specific area/town (if relevant for that country)
3. If budget not mentioned yet, you can ask about it here OR wait until after purpose
4. Go directly to STEP 3 (Clarify Purpose)

CRITICAL: In STEP 2A, you MUST NOT ask:
- ❌ "When are you thinking of traveling?" (This is STEP 2B QUESTION 1)
- ❌ "What kind of waves are you chasing?" (This is STEP 2B QUESTION 2)
- ❌ "How far are you willing to travel?" (This is STEP 2B QUESTION 3)
- ❌ "Are you cool with cold water?" (This is STEP 2B QUESTION 4)
- ❌ "What's your take on crowds?" (This is STEP 2B QUESTION 5)
- ❌ "Are you cool with remote places?" (This is STEP 2B QUESTION 6)

These questions are ONLY for STEP 2B (Destination Discovery Flow) when the user doesn't know where to go!

In STEP 2A, you should:
- ✅ Extract the destination they mentioned
- ✅ Ask about area/town if not mentioned
- ✅ Ask about budget if not mentioned
- ✅ Then go to STEP 3 (Clarify Purpose)

STEP 2B - DESTINATION DISCOVERY FLOW (User doesn't know):
CRITICAL: This step is ONLY for when the user has explicitly said they DON'T know where to go, need help deciding, want suggestions, etc.

DO NOT enter STEP 2B if the user mentioned a specific destination! If they said "Costa Rica", "Sri Lanka", "Bali", etc., you MUST go to STEP 2A instead!

Only enter STEP 2B if the user said things like:
- "Not sure"
- "Help me decide"
- "I don't know"
- "Work it out with you"
- "I need suggestions"
- Any expression of uncertainty about destination

If user says they don't know, need help deciding, want suggestions, etc., enter the DESTINATION DISCOVERY FLOW.

This is a structured flow where you ask ONE question at a time, in this specific order:

QUESTION 1 - TIME/SEASON:
Ask: "First up - when are you thinking of traveling? What time of year or season?"

Capture their response (e.g., "winter", "December", "summer", "next month", etc.) and move to QUESTION 2.

QUESTION 2 - WAVE TYPE:
Ask about their preferred wave type. Adapt the question based on their surf level:
- For advanced surfers: "What kind of waves are you chasing? Heavy and challenging, high performance playground, or mellow but fun?"
- For intermediate: "What's your wave vibe? Looking for something challenging, playful, or more mellow?"
- For beginners: "What kind of waves are you comfortable with? Mellow and forgiving, or ready to step it up?"

Capture their response and move to QUESTION 3.

QUESTION 3 - TRAVEL DISTANCE:
You have access to the user's profile which includes their country_from. Use this to ask about travel distance.
Ask: "How far are you willing to travel? Looking for something close to home, or open to going anywhere?"

Examples based on their origin:
- If from Israel: "Something in Europe/Mediterranean, or open to Asia, Central America, etc.?"
- If from USA: "Staying in the Americas, or open to Europe, Asia, etc.?"
- If from Europe: "Sticking to Europe, or open to further destinations?"

Capture their response and move to QUESTION 4.

QUESTION 4 - WATER TEMPERATURE:
Ask: "Are you cool with surfing cold water in a wetsuit, or are you only looking for warm water spots?"

Capture their response (warm only / cold with wetsuit) and move to QUESTION 5.

QUESTION 5 - CROWD TOLERANCE:
Ask: "What's your take on crowds? Are you willing to surf in a crowded lineup if the waves are good, or do you want uncrowded waves always?"

Capture their response and move to QUESTION 6.

QUESTION 6 - REMOTENESS:
Ask: "Last one - are you cool with super remote, undeveloped places, or do you want to stick to built-up towns and cities?"

Capture their response.

AFTER ALL 6 QUESTIONS ARE ANSWERED:
Based on all their answers, suggest 2-3 destination options that match their criteria. Be specific and explain why each destination fits their preferences.

Then EXPLICITLY GET USER'S APPROVAL:
"Which one sounds good to you, or want me to suggest others?"

IMPORTANT RULES FOR DESTINATION DISCOVERY:
- Ask ONE question at a time - don't ask multiple questions in one message
- Wait for their answer before moving to the next question
- Track which question you're on - don't skip or repeat questions
- If they answer multiple questions at once, acknowledge it and continue with the next unanswered question
- Once all 6 questions are answered, suggest destinations immediately
- After destination is selected, extract it properly (destination_country and area if mentioned) and go to STEP 3

Once destination is approved/selected, go to STEP 3 (Clarify Purpose)

STEP 3 - CLARIFY PURPOSE:
Ask: "Awesome! Are you looking for specific advice, general help and guidance, or just connecting with a like-minded traveler? Any specific topic?"

Capture: purpose_type (one of: "specific_advice", "general_guidance", "connect_traveler", or combination)
Capture: specific_topics (array of topics if mentioned, e.g., ["visa", "best waves", "accommodation", "local spots"])

Go to STEP 4

STEP 4 - NON-NEGOTIABLE CRITERIA:
Ask: "Cool, are there any non-negotiable parameters for the travelers you wanna get advice from? Eg: only from Israel, similar age, similar vibe, must be shortboarders, etc."

IMPORTANT: Distinguish between REQUIRED criteria (non_negotiable_criteria) and PREFERRED criteria (prioritize_filters):
- REQUIRED (non_negotiable_criteria): Phrases like "must be", "have to be", "only", "require" → These are hard filters
- PREFERRED (prioritize_filters): Phrases like "prioritize", "prefer", "would like", "I'd like", "ideally" → These get bonus points but aren't required

Examples:
- "must be from Israel" → non_negotiable_criteria: { "country_from": ["Israel"] }
- "prioritize surfers from Israel" → prioritize_filters: { "origin_country": "Israel" }
- "I prefer longboarders" → prioritize_filters: { "board_type": "longboard" }
- "would like advanced surfers" → prioritize_filters: { "surf_level": 4 }

IMPORTANT: If the user mentions criteria we don't have in our database (like physical appearance, personal details, etc.), you should:
1. Acknowledge what you CAN filter by (country, age, surf level, board type, destination experience, lifestyle keywords)
2. Politely explain that we don't have information about things like physical appearance, personal details, etc.
3. Still extract and use the criteria we DO have

Example responses:
- User: "I want a blond surfer from Israel" → You: "Got it! I can filter by country (Israel), but we don't track physical details like hair color. I'll find you surfers from Israel who match your other criteria!"
- User: "Someone tall who's been to Costa Rica" → You: "I can find surfers who've been to Costa Rica, but we don't have height info. I'll focus on their surf experience and travel history!"

CRITICAL: Extract criteria from user messages throughout the ENTIRE conversation, not just in STEP 4. If the user mentions filtering criteria at any point (e.g., "I want shortboarders", "from Israel", "age 18-30", "must be from USA"), extract it immediately and store it in non_negotiable_criteria. The system will automatically:
- Apply the same filtering logic regardless of when criteria was mentioned
- If mentioned during STEP 4 (non-negotiable criteria): If no matches found, the system will return empty and you should tell the user we couldn't find what they asked for
- If mentioned earlier: If no exact matches found, the system will automatically return the closest matches, so you can just say "Copy! Here are a few advisor options that best match what you're looking for."

BE SMART ABOUT USER REQUESTS:
- Handle typos gracefully: "uropean" → understand as "European" and expand to all European countries
- Handle general terms: "any European country" → expand to all European countries automatically
- Infer intent: If user says "similar age" and you know they're 25, extract age_range: [20, 30]
- Be forgiving: Don't reject requests due to typos or grammar mistakes - understand the intent
- If user says "they will use shortboard" or "must be shortboarders" → extract surfboard_type: ["shortboard"]
- If something is unclear, make a reasonable inference based on context rather than asking for clarification

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
- "surf level [X]" → surf_level_min: X

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
- User: "From the USA or any European country" → non_negotiable_criteria: { "country_from": ["USA", "France", "Spain", "Portugal", "Italy", "Germany", "Netherlands", "Belgium", "Switzerland", "Austria", "Greece", "Ireland", "Norway", "Sweden", "Denmark", "Finland", "Poland", "Czech Republic", "Hungary", "Romania", "Croatia", "Slovenia"] }

Capture: non_negotiable_criteria (object with filters like):
{
  "country_from": ["Israel", "USA"], // array of countries if specified (e.g., "from Israel or USA")
  "surfboard_type": ["shortboard"], // array if specified
  "age_range": [20, 30], // [min, max] if specified
  "surf_level_min": 4, // number if specified
  "surf_level_max": 5, // number if specified
  "must_have_keywords": ["yoga", "remote-work"], // array if specified
  "other": "any other specific requirements" // string if specified
}

Go to STEP 5

STEP 5 - PROVIDE OPTIONS:
After collecting non-negotiable criteria in STEP 4, you MUST:
1. Set is_finished: true
2. Set return_message to: "Copy! Here are a few advisor options that best match what you're looking for."
3. Include ALL collected data in the "data" field (destination_country, area, budget, purpose, non_negotiable_criteria, queryFilters)

CRITICAL: Do NOT say "Let me pull up some options" or "One sec!" - just set is_finished: true and return the completion message immediately.

When is_finished: true, the system will automatically find matches. You don't need to wait or say you're looking - just finish the conversation.

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
  "destination_country": "Country name", // REQUIRED if location mentioned - NEVER null! Correct typos: "filipins" → "Philippines"
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
    "surf_level_min": number, // number or null
    "surf_level_max": number, // number or null
    "must_have_keywords": ["keyword1"], // array or null
    "other": "text description" // string or null
  },
  "prioritize_filters": {
    // V2: Extract from phrases like "prioritize longboarders", "I prefer surfers from Israel", etc.
    // These are preferences (not requirements) that get bonus points in matching
    "origin_country": "Israel", // string or null - e.g., "prioritize surfers from Israel"
    "board_type": "shortboard", // string or null - e.g., "prioritize longboarders"
    "surf_level": 4, // number or null - e.g., "prioritize advanced surfers"
    "age_range": [20, 30], // [min, max] or null - e.g., "prioritize younger surfers"
    "lifestyle_keywords": ["yoga"], // array or null - e.g., "prioritize yoga enthusiasts"
    "wave_type_keywords": ["big waves"], // array or null - e.g., "prioritize big wave surfers"
    "travel_experience": "wave_hunter", // string or null - e.g., "prioritize experienced travelers"
    "group_type": "solo" // string or null - e.g., "prioritize solo travelers"
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
  "return_message": "The conversational text Swelly says to the user (NO JSON, NO code blocks)",
  "is_finished": true or false,
  "data": {
    "destination_country": "...", // REQUIRED if location mentioned - NEVER null!
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
  * If user says "Costa Rica, Pavones" → destination_country: "Costa Rica", area: "Pavones"
  * If user says "Siargao, filipins" → destination_country: "Philippines", area: "Siargao" (CORRECT THE TYPO!)
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
    * User: "Siargao, filipins" → { destination_country: "Philippines", area: "Siargao" } ✅
    * User: "El Salvador" → { destination_country: "El Salvador", area: null } ✅
  - Examples of WRONG extraction (DON'T DO THIS):
    * User: "Siargao, filipins" → { destination_country: null, area: null } ❌ CRITICAL ERROR!
    * User: "Siargao, filipins" → { destination_country: "filipins", area: "Siargao" } ❌ (Didn't correct typo!)
  
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
async function callOpenAI(messages: Array<{ role: string; content: string }>): Promise<string> {
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
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000, // Increased to allow for full JSON responses
      response_format: { type: 'json_object' }, // Force JSON output
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
 * Use LLM to convert user's natural language request into Supabase query filters
 */
async function extractQueryFilters(
  userMessage: string,
  destinationCountry: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<{
  supabaseFilters: {
    country_from?: string[];
    age_min?: number;
    age_max?: number;
    surfboard_type?: string[];
    surf_level_min?: number;
    surf_level_max?: number;
    destination_days_min?: { destination: string; min_days: number };
    lifestyle_keywords?: string[];
    wave_type_keywords?: string[];
  };
  unmappableCriteria?: string[]; // Criteria that user mentioned but can't be mapped to database fields
  explanation: string;
}> {
  const schemaPrompt = `You are a database query expert. Analyze the user's request and determine which Supabase filters to apply.

AVAILABLE SURFERS TABLE FIELDS (ONLY THESE CAN BE FILTERED):
- country_from (string): Country of origin (e.g., "Israel", "USA", "United States")
  ⚠️ CRITICAL: country_from means WHERE THE SURFER IS FROM (origin country), NOT where they want to go!
  ⚠️ ONLY set country_from if user explicitly says they want surfers FROM a specific country (e.g., "from USA", "must be from Israel")
  ⚠️ DO NOT set country_from just because the destination is in that country (e.g., if user wants to go to California/USA, do NOT set country_from: ["USA"])
  ⚠️ Examples:
    - User says "I want to go to California" → destination_country: "USA", area: "California", country_from: NOT SET (user didn't say they want surfers FROM USA)
    - User says "I want surfers from the USA" → country_from: ["USA"] (user explicitly wants surfers FROM USA)
    - User says "I want to go to Costa Rica and connect with surfers from Israel" → destination_country: "Costa Rica", country_from: ["Israel"]
- age (integer): Age in years (0+)
- surfboard_type (enum): 'shortboard', 'longboard', 'funboard', 'fish', 'hybrid', 'gun', 'soft-top'
- surf_level (integer): 1-5 (1=beginner, 5=expert)
- destinations_array (jsonb): Array of {destination_name: string, time_in_days: number}
- lifestyle_keywords (text[]): Array of lifestyle interests
- wave_type_keywords (text[]): Array of wave preferences

IMPORTANT: Handle typos, general terms, and variations intelligently:

GENERAL CATEGORIES (expand to specific countries):
- "European" / "uropean" / "european" / "any European country" / "from Europe" → Include ALL: ["France", "Spain", "Italy", "Germany", "United Kingdom", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Ireland", "Portugal", "Greece", "Austria", "Belgium", "Switzerland", "Poland", "Czech Republic", "Hungary", "Romania", "Croatia", "Slovenia"]
- "Asian" / "from Asia" / "any Asian country" → Include: ["Japan", "China", "South Korea", "Thailand", "Indonesia", "Philippines", "India", "Sri Lanka", "Malaysia", "Vietnam"]
- "Latin American" / "from Latin America" / "South American" → Include: ["Mexico", "Brazil", "Costa Rica", "Nicaragua", "El Salvador", "Panama", "Peru", "Chile", "Argentina", "Ecuador"]
- "Central American" / "from Central America" → Include: ["Costa Rica", "Nicaragua", "El Salvador", "Panama", "Guatemala", "Belize", "Honduras"]

TYPO HANDLING (be smart about common mistakes):
- "Philippins" / "Philippines" / "Phillipines" → "Philippines"
- "uropean" / "european" / "European" → Expand to all European countries
- "US" / "United States" / "U.S.A" / "USA" / "America" → "USA"
- "Isreal" / "Israel" → "Israel"
- "Brasil" / "Brazil" → "Brazil"

LOGICAL INFERENCE:
- If user says "similar age" and you know their age (e.g., 25), infer ±5 years → age_range: [20, 30]
- If user says "around my age", infer ±5 years from their age
- If user says "young" or "older", infer reasonable age ranges based on context
- If user says "must be shortboarders" or "they will use shortboard" → surfboard_type: ["shortboard"]
- If user says "intermediate" or "advanced", infer surf_level ranges

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
    "country_from": ["Israel", "USA"],
    "age_min": 18,
    "age_max": 30,
    "surfboard_type": ["longboard"],
    "surf_level_min": 3,
    "surf_level_max": 4,
    "destination_days_min": {
      "destination": "Costa Rica",
      "min_days": 30
    },
    "lifestyle_keywords": ["yoga"],
    "wave_type_keywords": ["big waves"]
  },
  "unmappableCriteria": ["blond", "tall"],
  "explanation": "Brief explanation of what filters were extracted and what couldn't be mapped"
}

IMPORTANT: The JSON above is an example format. When you return your response:
- DO NOT include any comments (no // or /* */)
- DO NOT include explanatory text outside the JSON
- Return ONLY the JSON object, nothing else

CRITICAL RULES - BE SMART AND FLEXIBLE:

0. ⚠️ CRITICAL: DO NOT CONFUSE destination_country WITH country_from ⚠️
   - destination_country = WHERE THE USER WANTS TO GO (e.g., "California" → destination_country: "USA")
   - country_from = WHERE THE SURFER IS FROM (origin country) - ONLY set if user explicitly requests it
   - If user says "I want to go to California" → destination_country: "USA", country_from: NOT SET
   - If user says "I want surfers from the USA" → country_from: ["USA"]
   - If user says "I want to go to Costa Rica and connect with surfers from Israel" → destination_country: "Costa Rica", country_from: ["Israel"]
   - NEVER automatically set country_from based on destination_country - they are completely different things!

1. HANDLE GENERAL TERMS (expand to specific countries):
   - "European" / "uropean" / "european" / "any European country" / "from Europe" → Expand to ALL: ["France", "Spain", "Italy", "Germany", "United Kingdom", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Ireland", "Portugal", "Greece", "Austria", "Belgium", "Switzerland", "Poland", "Czech Republic", "Hungary", "Romania", "Croatia", "Slovenia"]
   - "Asian" / "from Asia" / "any Asian country" → Expand to: ["Japan", "China", "South Korea", "Thailand", "Indonesia", "Philippines", "India", "Sri Lanka", "Malaysia", "Vietnam"]
   - "Latin American" / "from Latin America" / "South American" → Expand to: ["Mexico", "Brazil", "Costa Rica", "Nicaragua", "El Salvador", "Panama", "Peru", "Chile", "Argentina", "Ecuador"]
   - "Central American" / "from Central America" → Expand to: ["Costa Rica", "Nicaragua", "El Salvador", "Panama", "Guatemala", "Belize", "Honduras"]

2. HANDLE TYPOS INTELLIGENTLY (be forgiving):
   - "uropean" / "european" / "European" → All mean the same → expand to all European countries
   - "Philippins" / "Philippines" / "Phillipines" → All mean "Philippines"
   - "Isreal" / "Israel" → "Israel"
   - "Brasil" / "Brazil" → "Brazil"
   - "US" / "United States" / "U.S.A" / "USA" / "America" → "USA"
   - If you see a typo but the intent is clear, correct it automatically

3. INFER INTENT FROM CONTEXT:
   - "similar age" + user is 25 → age_min: 20, age_max: 30 (±5 years)
   - "around my age" + user is 25 → age_min: 20, age_max: 30 (±5 years)
   - "young" → infer age_max: 30
   - "older" → infer age_min: 35
   - "must be shortboarders" / "they will use shortboard" → surfboard_type: ["shortboard"]
   - "intermediate" → surf_level_min: 2, surf_level_max: 4
   - "advanced" → surf_level_min: 4, surf_level_max: 5

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
  ]

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
 * Save chat history to database
 */
async function saveChatHistory(
  chatId: string,
  messages: Array<{ role: string; content: string }>,
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
async function getChatHistory(chatId: string, supabaseAdmin: any): Promise<Array<{ role: string; content: string }>> {
  const { data, error } = await supabaseAdmin
    .from('swelly_chat_history')
    .select('messages')
    .eq('chat_id', chatId)
    .single()

  if (error) {
    console.error('Error getting chat history:', error)
    return []
  }

  return data?.messages || []
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
- surf_level: ${userProfile.surf_level || 'not specified'} (1=beginner, 5=expert)
- age: ${userProfile.age || 'not specified'}
- surfboard_type: ${userProfile.surfboard_type || 'not specified'}
- travel_experience: ${userProfile.travel_experience || 'not specified'}

When asking QUESTION 2 (wave type), adapt the question based on their surf_level:
- If surf_level is 4-5 (advanced): Ask about "Heavy and challenging, high performance playground, or mellow but fun"
- If surf_level is 2-3 (intermediate): Ask about "challenging, playful, or more mellow"
- If surf_level is 1 (beginner): Ask about "mellow and forgiving, or ready to step it up"

When asking QUESTION 3 (travel distance), use their country_from to provide relevant examples.`
        systemPrompt = TRIP_PLANNING_PROMPT + '\n\n' + profileContext
      }

      // Initialize chat history
      const messages = [
        { role: 'system', content: systemPrompt },
        // Add explicit instruction for first response - MUST ask STEP 1 question
        { role: 'system', content: 'CRITICAL: This is the FIRST message in a NEW conversation. The user has just introduced themselves or started the conversation. You MUST respond with STEP 1\'s question: "Hey man, let\'s plan your next trip together. You know where you\'re headed, or wanna work it out with me?" Do NOT skip to STEP 2A or STEP 2B. Do NOT ask about time/season yet. Wait for the user to answer STEP 1 first. Treat their initial message as context/introduction only.' },
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
        if (!tripPlanningData && parsed.is_finished) {
          // If data is not in a nested "data" field, extract from root level
          tripPlanningData = {
            destination_country: parsed.destination_country,
            area: parsed.area,
            budget: parsed.budget,
            destination_known: parsed.destination_known,
            purpose: parsed.purpose,
            non_negotiable_criteria: parsed.non_negotiable_criteria,
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
- surf_level: ${userProfile.surf_level || 'not specified'} (1=beginner, 5=expert)
- age: ${userProfile.age || 'not specified'}
- surfboard_type: ${userProfile.surfboard_type || 'not specified'}
- travel_experience: ${userProfile.travel_experience || 'not specified'}

When asking QUESTION 2 (wave type), adapt the question based on their surf_level:
- If surf_level is 4-5 (advanced): Ask about "Heavy and challenging, high performance playground, or mellow but fun"
- If surf_level is 2-3 (intermediate): Ask about "challenging, playful, or more mellow"
- If surf_level is 1 (beginner): Ask about "mellow and forgiving, or ready to step it up"

When asking QUESTION 3 (travel distance), use their country_from to provide relevant examples.`
        messages.splice(0, 1, { role: 'system', content: TRIP_PLANNING_PROMPT + '\n\n' + profileContext })
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
          const step2aReminder = `CRITICAL: The user just mentioned a destination (${body.message}). You MUST use STEP 2A (GET DESTINATION), NOT STEP 2B (Destination Discovery Flow). Extract the destination_country immediately, ask about area/budget if needed, then go to STEP 3 (Clarify Purpose). DO NOT ask the destination discovery questions (time/season, wave type, travel distance, etc.) - those are ONLY for STEP 2B when the user doesn't know where to go!`
          messages.splice(messages.length - 1, 0, { role: 'system', content: step2aReminder })
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
      
      // Merge current filters with accumulated filters (current takes precedence)
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

      // If we detected unmappable criteria, add a system message to inform the LLM
      if (unmappableCriteria.length > 0) {
        const unmappableMessage = `IMPORTANT: The user mentioned criteria we don't have in our database: ${unmappableCriteria.join(', ')}. You should acknowledge this politely and explain that we can filter by: country, age, surf level, board type, destination experience, and lifestyle keywords, but not by physical appearance or personal details. Still proceed with filtering by the criteria we DO have.`
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
        if (!tripPlanningData && parsed.is_finished) {
          // If data is not in a nested "data" field, extract from root level
          tripPlanningData = {
            destination_country: parsed.destination_country,
            area: parsed.area,
            budget: parsed.budget,
            destination_known: parsed.destination_known,
            purpose: parsed.purpose,
            non_negotiable_criteria: parsed.non_negotiable_criteria,
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
                                               userMsgLower.includes('be only from')
                
                const mentionsUSA = userMsgLower.includes('usa') || 
                                   userMsgLower.includes('united states') || 
                                   userMsgLower.includes('u.s.a') || 
                                   userMsgLower.includes('u.s.') || 
                                   (userMsgLower.includes('us') && !userMsgLower.includes('israel'))
                
                const mentionsIsrael = userMsgLower.includes('israel')
                
                // If message has requirement language AND mentions countries, extract them
                if (hasRequirementLanguage && (mentionsUSA || mentionsIsrael)) {
                  if (!tripPlanningData.non_negotiable_criteria.country_from) {
                    tripPlanningData.non_negotiable_criteria.country_from = []
                  }
                  
                  if (mentionsUSA && !tripPlanningData.non_negotiable_criteria.country_from.includes('USA')) {
                    tripPlanningData.non_negotiable_criteria.country_from.push('USA')
                    console.log(`✅ Extracted USA from user message: "${userMsg}"`)
                  }
                  
                  if (mentionsIsrael && !tripPlanningData.non_negotiable_criteria.country_from.includes('Israel')) {
                    tripPlanningData.non_negotiable_criteria.country_from.push('Israel')
                    console.log(`✅ Extracted Israel from user message: "${userMsg}"`)
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
                  if (userMsgLower.includes('longboard') || userMsgLower.includes('long board')) {
                    tripPlanningData.non_negotiable_criteria.surfboard_type = tripPlanningData.non_negotiable_criteria.surfboard_type || []
                    if (!tripPlanningData.non_negotiable_criteria.surfboard_type.includes('longboard')) {
                      tripPlanningData.non_negotiable_criteria.surfboard_type.push('longboard')
                      console.log(`✅ Extracted surfboard_type: longboard from "${userMsg}"`)
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
                        non_negotiable_criteria: prevParsed.non_negotiable_criteria || prevParsed.data?.non_negotiable_criteria || {},
                        user_context: prevParsed.user_context || prevParsed.data?.user_context || {},
                        queryFilters: prevParsed.data?.queryFilters || null, // Preserve existing queryFilters
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
              queryFilters: extractedQueryFilters,
              filtersFromNonNegotiableStep: isCriteriaStep, // Mark if filters came from non-negotiable step
            }
            console.log('✅ Created tripPlanningData with query filters (from non-negotiable step:', isCriteriaStep, ')')
          } else {
            // Merge filters: if tripPlanningData already has filters, merge them (current takes precedence)
            if (tripPlanningData.queryFilters) {
              tripPlanningData.queryFilters = {
                ...tripPlanningData.queryFilters,
                ...extractedQueryFilters, // Current filters override accumulated ones
              }
            } else {
              tripPlanningData.queryFilters = extractedQueryFilters
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
              tripPlanningData.queryFilters.country_from = tripPlanningData.non_negotiable_criteria.country_from
              console.log('  - Added country_from:', tripPlanningData.queryFilters.country_from)
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
            (tripPlanningData.non_negotiable_criteria.surf_level_max !== undefined && tripPlanningData.non_negotiable_criteria.surf_level_max !== null) ||
            (tripPlanningData.non_negotiable_criteria.must_have_keywords && tripPlanningData.non_negotiable_criteria.must_have_keywords.length > 0)
          
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
              if (userMsg.includes('from') && (userMsg.includes('usa') || userMsg.includes('israel') || userMsg.includes('united states'))) {
                extractedData.non_negotiable_criteria = extractedData.non_negotiable_criteria || {}
                extractedData.non_negotiable_criteria.country_from = []
                if (userMsg.includes('usa') || userMsg.includes('united states')) {
                  extractedData.non_negotiable_criteria.country_from.push('USA')
                }
                if (userMsg.includes('israel')) {
                  extractedData.non_negotiable_criteria.country_from.push('Israel')
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

