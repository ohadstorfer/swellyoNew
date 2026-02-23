import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// find-matches: inlined below (no local imports - only index.ts is deployed)

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
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  metadata?: MessageMetadata
}

// === INLINED find-matches: full LLM destination utils, no local imports ===
interface MatchResultInline {
  user_id: string
  name: string
  profile_image_url?: string | null
  match_score: number
  priority_score?: number
  general_score?: number
  matched_areas?: string[]
  matched_towns?: string[]
  common_lifestyle_keywords?: string[]
  common_wave_keywords?: string[]
  surfboard_type?: string
  surf_level?: number
  travel_experience?: string
  country_from?: string
  age?: number
  days_in_destination?: number
  destinations_array?: Array<{ country: string; area: string[]; time_in_days: number; time_in_text?: string }>
  match_quality?: any
}
const AREA_OPTIONS_INLINE = ['north', 'south', 'east', 'west', 'south-west', 'south-east', 'north-west', 'north-east'] as const
type AreaOptionInline = typeof AREA_OPTIONS_INLINE[number]
type MatchingIntentInline = 'surf_spots' | 'hikes' | 'stays' | 'providers' | 'equipment' | 'towns_within_area' | 'general'
interface NormalizedDestinationInline {
  country: string
  area?: AreaOptionInline | AreaOptionInline[]
  towns?: string[]
}
interface SurferDataInline {
  user_id: string
  name?: string
  country_from?: string | null
  surfboard_type?: string | null
  age?: number | null
  surf_level?: number | null
  surf_level_category?: string | null
  travel_experience?: number | string | null
  travel_buddies?: string | null
  travel_type?: string | null
}
async function normalizeAreaInline(country: string, areaInput: string | null | undefined, intent: MatchingIntentInline): Promise<AreaOptionInline[]> {
  if (!areaInput) return []
  if (!OPENAI_API_KEY) {
    console.warn('[find-matches] OpenAI key not set, skip area norm')
    return []
  }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that returns only valid JSON arrays. Do not include any explanatory text.' },
          { role: 'user', content: `Given the country "${country}" and area/region/town "${areaInput}", normalize it to one or more of these fixed area options: ${AREA_OPTIONS_INLINE.join(', ')}. Return ONLY a JSON array of strings from the fixed options. Example: ["south-west"].` }
        ],
        temperature: 0.3,
        max_tokens: 100,
      }),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}`)
    const data = await res.json()
    const content = data.choices[0]?.message?.content?.trim()
    if (!content) return []
    let areas: string[] = []
    try {
      const parsed = JSON.parse(content)
      areas = Array.isArray(parsed) ? parsed : (parsed.areas && Array.isArray(parsed.areas) ? parsed.areas : [])
    } catch {
      const m = content.match(/\[.*?\]/)
      if (m) areas = JSON.parse(m[0])
    }
    return areas.filter((a: string) => AREA_OPTIONS_INLINE.includes(a.toLowerCase() as AreaOptionInline)).map((a: string) => a.toLowerCase() as AreaOptionInline)
  } catch (e) {
    console.error('[find-matches] normalizeArea', e)
    return []
  }
}
async function extractTownsInline(country: string, areaInput: string | null | undefined, intent: MatchingIntentInline, normalizedAreas: AreaOptionInline[]): Promise<string[]> {
  if (intent !== 'surf_spots' && intent !== 'stays' && intent !== 'providers') return []
  if (!areaInput || !OPENAI_API_KEY) return []
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that returns only valid JSON arrays. Do not include any explanatory text.' },
          { role: 'user', content: `Given the country "${country}", area "${areaInput}", and normalized areas ${JSON.stringify(normalizedAreas)}, extract specific town names if mentioned or relevant. Return ONLY a JSON array of town names (strings), or [] if none.` }
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const content = data.choices[0]?.message?.content?.trim()
    if (!content) return []
    let towns: string[] = []
    try {
      const parsed = JSON.parse(content)
      towns = Array.isArray(parsed) ? parsed : (parsed.towns && Array.isArray(parsed.towns) ? parsed.towns : [])
    } catch {
      const m = content.match(/\[.*?\]/)
      if (m) towns = JSON.parse(m[0])
    }
    return towns.filter((t: any) => typeof t === 'string' && t.trim().length > 0)
  } catch (e) {
    console.error('[find-matches] extractTowns', e)
    return []
  }
}
function determineIntentInline(request: any): MatchingIntentInline {
  const topics = (request.purpose?.specific_topics || []).map((t: string) => t.toLowerCase())
  if (topics.some((t: string) => t.includes('surf spot') || t.includes('wave') || t.includes('break'))) return 'surf_spots'
  if (topics.some((t: string) => t.includes('hike') || t.includes('trail') || t.includes('walk'))) return 'hikes'
  if (topics.some((t: string) => t.includes('stay') || t.includes('accommodation') || t.includes('hotel') || t.includes('hostel'))) return 'stays'
  if (topics.some((t: string) => t.includes('provider') || t.includes('shop') || t.includes('rental'))) return 'providers'
  if (topics.some((t: string) => t.includes('equipment') || t.includes('board') || t.includes('gear'))) return 'equipment'
  return 'general'
}
async function normalizeDestinationInline(request: any, intent: MatchingIntentInline): Promise<NormalizedDestinationInline> {
  const country = request.destination_country
  const areaInput = request.area
  const normalizedAreas = await normalizeAreaInline(country, areaInput, intent)
  const towns = await extractTownsInline(country, areaInput, intent, normalizedAreas)
  return {
    country,
    area: normalizedAreas.length === 1 ? normalizedAreas[0] : normalizedAreas,
    towns: towns.length > 0 ? towns : undefined,
  }
}
function parseUserDestinationInline(destination: { country: string; area: string[] } | { destination_name: string } | string): { country: string; area?: AreaOptionInline[]; towns?: string[] } {
  if (typeof destination === 'object' && 'country' in destination) {
    const country = destination.country
    const areas = (destination.area || []) as string[]
    const areaParts: AreaOptionInline[] = []
    const townParts: string[] = []
    for (const area of areas) {
      const lower = area.toLowerCase()
      const matched = AREA_OPTIONS_INLINE.find(opt => lower === opt || lower.includes(opt) || opt.includes(lower))
      if (matched) areaParts.push(matched)
      else townParts.push(area)
    }
    return { country, area: areaParts.length > 0 ? areaParts : undefined, towns: townParts.length > 0 ? townParts : undefined }
  }
  const name = typeof destination === 'string' ? destination : (destination as any).destination_name || ''
  const parts = name.split(',').map((p: string) => p.trim())
  const country = parts[0] || ''
  if (parts.length === 1) return { country }
  const areaParts: AreaOptionInline[] = []
  const townParts: string[] = []
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase()
    const matched = AREA_OPTIONS_INLINE.find(a => part === a || part.includes(a) || a.includes(part))
    if (matched) areaParts.push(matched)
    else townParts.push(parts[i])
  }
  return { country, area: areaParts.length > 0 ? areaParts : undefined, towns: townParts.length > 0 ? townParts : undefined }
}
function hasRequestedAreaInArrayInline(userDest: any, requestedArea: string | null | undefined): boolean {
  if (!requestedArea) return false
  const lower = requestedArea.toLowerCase()
  if (typeof userDest === 'object' && 'country' in userDest) {
    return (userDest.area || []).some((area: string) => area.toLowerCase() === lower || area.toLowerCase().includes(lower) || lower.includes(area.toLowerCase()))
  }
  if (typeof userDest === 'string') {
    const parts = userDest.split(',').map((p: string) => p.trim())
    if (parts.length > 1) return parts.slice(1).some((p: string) => p.toLowerCase() === lower || p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase()))
  }
  if (typeof userDest === 'object' && 'destination_name' in userDest) {
    const name = (userDest as any).destination_name || ''
    const parts = name.split(',').map((p: string) => p.trim())
    if (parts.length > 1) return parts.slice(1).some((p: string) => p.toLowerCase() === lower || p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase()))
  }
  return false
}
function destinationMatchesInline(userDest: any, norm: NormalizedDestinationInline): { countryMatch: boolean; areaMatch: boolean; townMatch: boolean; matchedAreas: AreaOptionInline[]; matchedTowns: string[] } {
  const u = parseUserDestinationInline(userDest)
  const requested = norm.country.split(',').map((c: string) => c.trim().toLowerCase()).filter((c: string) => c.length > 0)
  const userCountry = u.country.toLowerCase().trim()
  const countryMatch = requested.some((r: string) => {
    if (userCountry === r) return true
    if ((r === 'usa' || r === 'united states') && (userCountry.includes('united states') || userCountry.includes('usa'))) return true
    if ((r === 'uk' || r === 'united kingdom') && (userCountry.includes('united kingdom') || /\buk\b/.test(userCountry))) return true
    const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp('\\b' + escaped + '\\b', 'i').test(userCountry)
  })
  if (!countryMatch) return { countryMatch: false, areaMatch: false, townMatch: false, matchedAreas: [], matchedTowns: [] }
  const reqAreas = Array.isArray(norm.area) ? norm.area : norm.area ? [norm.area] : []
  const userAreas = u.area || []
  const matchedAreas = reqAreas.filter((ra: AreaOptionInline) => userAreas.some((ua: AreaOptionInline) => ua === ra))
  const reqTowns = norm.towns || []
  const userTowns = u.towns || []
  const matchedTowns = reqTowns.filter((rt: string) => userTowns.some((ut: string) => ut.toLowerCase() === rt.toLowerCase() || ut.toLowerCase().includes(rt.toLowerCase()) || rt.toLowerCase().includes(ut.toLowerCase())))
  return { countryMatch: true, areaMatch: matchedAreas.length > 0, townMatch: matchedTowns.length > 0, matchedAreas, matchedTowns }
}
function getTravelExpLevelInline(t: number | string | undefined | null): number {
  if (t === undefined || t === null) return 2
  if (typeof t === 'number') {
    if (t <= 3) return 1
    if (t <= 9) return 2
    if (t <= 19) return 3
    return 4
  }
  if (typeof t === 'string') {
    const M: Record<string, number> = { 'new_nomad': 1, 'rising_voyager': 2, 'wave_hunter': 3, 'chicken_joe': 4 }
    return M[t.toLowerCase()] || 2
  }
  return 2
}
function buildSurferQueryInline(req: any, requestingUserId: string, excludedIds: string[], supabaseAdmin: any): any {
  let q = supabaseAdmin
    .from('surfers')
    .select('*')
    .neq('user_id', requestingUserId)
    .or('is_demo_user.is.null,is_demo_user.eq.false')
  if (excludedIds?.length > 0) {
    if (excludedIds.length <= 10) for (const id of excludedIds) q = q.neq('user_id', id)
  }
  return q
}
function filterExcludedInMemoryInline(surfers: any[], ids: string[]): any[] {
  if (!ids?.length) return surfers
  return surfers.filter((s: any) => !ids.includes(s.user_id))
}
async function getPreviouslyMatchedUserIdsInline(chatId: string, supabaseAdmin: any): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('matching_users').select('matched_user_id').eq('chat_id', chatId)
  if (error) return []
  return (data || []).map((r: any) => r.matched_user_id)
}

// Criteria filtering (same logic as original: country_from, surfboard_type, surf_level)
// Category to numeric level: same as src/utils/surfLevelMapping.ts (DB format 1-5)
const SURF_LEVEL_CATEGORY_TO_NUM: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
  pro: 4,
}
function countryFromMatchInline(requested: string[], userCountry: string | null | undefined): boolean {
  if (!requested?.length) return true
  if (!userCountry || typeof userCountry !== 'string') return false
  const userLower = userCountry.trim().toLowerCase()
  return requested.some((c: string) => {
    const rcTrimmed = String(c).trim().toLowerCase()
    if (userLower === rcTrimmed) return true
    if ((rcTrimmed === 'united states' || rcTrimmed === 'usa') && (userLower.includes('united states') || userLower.includes('usa'))) return true
    if ((rcTrimmed === 'uk' || rcTrimmed === 'united kingdom') && (userLower.includes('united kingdom') || /\buk\b/.test(userLower))) return true
    return userLower.includes(rcTrimmed) || rcTrimmed.includes(userLower)
  })
}
function normalizeBoardTypeInline(v: string): string {
  const lower = (v || '').toLowerCase().replace(/\s+/g, '_')
  if (lower === 'midlength' || lower === 'mid_length') return 'mid_length'
  if (lower === 'longboard' || lower === 'long_board') return 'longboard'
  if (lower === 'shortboard' || lower === 'short_board') return 'shortboard'
  if (lower === 'softtop' || lower === 'soft_top') return 'soft_top'
  return v
}
function surfLevelCategoryToMinNumericInline(categories: string[]): number {
  if (!categories?.length) return 0
  const levels = categories.map((cat: string) => SURF_LEVEL_CATEGORY_TO_NUM[(cat || '').toLowerCase()]).filter((n: number) => n != null && !isNaN(n))
  return levels.length ? Math.min(...levels) : 0
}
function passesCriteriaInline(entry: { surfer: any; hasAreaMatch: boolean; daysInDestination: number; bestMatch: any }, queryFilters: any): boolean {
  const s = entry.surfer
  if (queryFilters?.country_from && Array.isArray(queryFilters.country_from) && queryFilters.country_from.length > 0) {
    if (!countryFromMatchInline(queryFilters.country_from, s.country_from)) return false
  }
  if (queryFilters?.surfboard_type && Array.isArray(queryFilters.surfboard_type) && queryFilters.surfboard_type.length > 0) {
    const normalized = queryFilters.surfboard_type.map(normalizeBoardTypeInline)
    const userBoard = normalizeBoardTypeInline(s.surfboard_type || '')
    if (!userBoard || !normalized.includes(userBoard)) return false
  }
  if (queryFilters?.surf_level_category != null) {
    const requested = Array.isArray(queryFilters.surf_level_category) ? queryFilters.surf_level_category : [queryFilters.surf_level_category]
    const requestedCategories = requested.map((x: string) => (x || '').toLowerCase()).filter(Boolean)
    if (requestedCategories.length > 0) {
      const userCategory = (s.surf_level_category || '').toLowerCase()
      const userLevel = typeof s.surf_level === 'number' ? s.surf_level : 0
      const matchByCategory = userCategory && requestedCategories.includes(userCategory)
      const minLevel = surfLevelCategoryToMinNumericInline(requestedCategories)
      const matchByNumeric = minLevel > 0 && userLevel >= minLevel
      if (!matchByCategory && !matchByNumeric) return false
    }
  }
  return true
}

async function saveMatchesInline(chatId: string, requestingUserId: string, matches: MatchResultInline[], supabaseAdmin: any, filters?: any, destinationCountry?: string, area?: string | null): Promise<void> {
  if (!matches?.length) return
  const records = matches.map(m => ({
    chat_id: chatId,
    requesting_user_id: requestingUserId,
    matched_user_id: m.user_id,
    destination_country: destinationCountry || null,
    area: area || null,
    match_score: m.match_score,
    priority_score: m.priority_score ?? null,
    general_score: m.general_score ?? null,
    matched_areas: m.matched_areas ?? null,
    matched_towns: m.matched_towns ?? null,
    common_lifestyle_keywords: m.common_lifestyle_keywords ?? null,
    common_wave_keywords: m.common_wave_keywords ?? null,
    days_in_destination: m.days_in_destination ?? null,
    match_quality: m.match_quality ?? null,
    filters_applied: filters ?? null,
  }))
  const { error } = await supabaseAdmin.from('matching_users').upsert(records, { onConflict: 'chat_id,matched_user_id', ignoreDuplicates: false })
  if (error) throw new Error('Failed to save matches: ' + error.message)
}
async function findMatchingUsersV3Server(request: any, requestingUserId: string, chatId: string, supabaseAdmin: any): Promise<MatchResultInline[]> {
  if (!request.destination_country) throw new Error('V3 algorithm requires destination_country')
  console.log('[find-matches] findMatchingUsersV3Server: destination_country=', request.destination_country, 'area=', request.area)
  const excludedUserIds = await getPreviouslyMatchedUserIdsInline(chatId, supabaseAdmin)
  console.log('[find-matches] Excluded user IDs (previously matched):', excludedUserIds?.length ?? 0)
  const intent = determineIntentInline(request)
  const normalizedDest = await normalizeDestinationInline(request, intent)
  console.log('[find-matches] Normalized destination:', JSON.stringify(normalizedDest))
  const query = buildSurferQueryInline(request, requestingUserId, excludedUserIds, supabaseAdmin)
  const { data: allSurfers, error: queryErr } = await query
  if (queryErr) throw new Error('Error querying surfers: ' + queryErr.message)
  console.log('[find-matches] Surfers from DB (before exclusions):', allSurfers?.length ?? 0)
  if (!allSurfers?.length) return []
  const filteredSurfers = filterExcludedInMemoryInline(allSurfers, excludedUserIds)
  console.log('[find-matches] Surfers after excluding previously matched:', filteredSurfers.length)
  const requestedArea = request.area || null
  const countryMatched: Array<{ surfer: any; hasAreaMatch: boolean; daysInDestination: number; bestMatch: { countryMatch: boolean; areaMatch: boolean; townMatch: boolean; matchedAreas: any[]; matchedTowns: string[] } }> = []
  for (const userSurfer of filteredSurfers) {
    let days = 0
    let bestMatch: { countryMatch: boolean; areaMatch: boolean; townMatch: boolean; matchedAreas: any[]; matchedTowns: string[] } | null = null
    let hasAreaMatch = false
    if (userSurfer.destinations_array?.length) {
      for (const dest of userSurfer.destinations_array) {
        const d = 'country' in dest ? dest : (dest as any).destination_name || ''
        const match = destinationMatchesInline(d, normalizedDest)
        if (match.countryMatch) {
          days += dest.time_in_days || 0
          if (requestedArea && hasRequestedAreaInArrayInline(dest, requestedArea)) hasAreaMatch = true
          if (!bestMatch || (match.areaMatch && !bestMatch.areaMatch) || (match.townMatch && !bestMatch.townMatch)) bestMatch = match
        }
      }
    }
    if (!bestMatch || !bestMatch.countryMatch || days === 0) continue
    countryMatched.push({ surfer: userSurfer, hasAreaMatch, daysInDestination: days, bestMatch })
  }
  console.log('[find-matches] Surfers with country match (destinations_array + time_in_days > 0):', countryMatched.length)

  // Apply optional criteria filters (country_from, surfboard_type, surf_level_category)
  const queryFilters = request.queryFilters || null
  let afterCriteria = countryMatched
  if (queryFilters && typeof queryFilters === 'object') {
    afterCriteria = countryMatched.filter((entry) => passesCriteriaInline(entry, queryFilters))
    console.log('[find-matches] After criteria filter (country_from/surfboard_type/surf_level):', afterCriteria.length)
  }

  // No scoring: sort by area match first (when user requested area), then by days_in_destination descending
  afterCriteria.sort((a, b) => {
    if (requestedArea) {
      if (a.hasAreaMatch && !b.hasAreaMatch) return -1
      if (!a.hasAreaMatch && b.hasAreaMatch) return 1
    }
    return b.daysInDestination - a.daysInDestination
  })
  return afterCriteria.map(({ surfer: userSurfer, hasAreaMatch, daysInDestination, bestMatch }) => ({
    user_id: userSurfer.user_id,
    name: userSurfer.name || 'User',
    profile_image_url: userSurfer.profile_image_url ?? null,
    match_score: daysInDestination,
    priority_score: 0,
    general_score: undefined as number | undefined,
    matched_areas: bestMatch.matchedAreas ?? [],
    matched_towns: bestMatch.matchedTowns ?? [],
    common_lifestyle_keywords: [],
    common_wave_keywords: [],
    surfboard_type: userSurfer.surfboard_type,
    surf_level: userSurfer.surf_level,
    travel_experience: userSurfer.travel_experience?.toString(),
    country_from: userSurfer.country_from,
    age: userSurfer.age,
    days_in_destination: daysInDestination,
    destinations_array: userSurfer.destinations_array,
    match_quality: { matchCount: 1, countryMatch: bestMatch.countryMatch, areaMatch: bestMatch.areaMatch, townMatch: bestMatch.townMatch },
  }))
}
// === END INLINED find-matches ===

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
ALWAYS start with this exact question in your FIRST response: "Yo! Let’s Travel! I can connect you with like minded surfers or surf travelers who have experience in specific destinations you are curious about. So, what are you looking for?"

When the first message in the conversation (new_chat) is vague or just a greeting, respond with STEP 1's question. If the user's first message clearly asks for surfers or matches and includes criteria (e.g. origin, board type, level) and/or a destination, treat it as their real request: extract what you can (destination if mentioned, criteria if mentioned) and only ask for what is missing (e.g. if they did not mention a destination, ask: "Which destination do you want to connect with surfers who've been there? (e.g. El Salvador, Costa Rica)"). Do not repeat STEP 1 when they already gave a direct request.

INTERPRET USER RESPONSE (be smart and natural):
- If user directly asks for surfers/matches/people (e.g., "send me surfers", "find me people", "show me matches", "who surfed in [place]") → They want matches NOW → Go to STEP 6 (Quick Match)
- If user mentions a specific destination/country/place → Extract destination and proceed to STEP 2
- If user asks for general matching without a destination (e.g., "find me surfers like me") → Ask which destination they want to connect with surfers who have been there, then proceed to STEP 2 once they answer
- When the user has already provided criteria (e.g. country of origin, surfboard type, surf level) but NO destination: acknowledge those criteria in your reply, then ask only for the destination. Example: "Got it — Israeli, shortboard, advanced. To find matches we need a destination: where do you want to connect with surfers who've been there? (e.g. El Salvador, Costa Rica, Philippines)." Do not ask "What are you looking for?" as if they had said nothing.

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

STEP 2 - DESTINATION-BASED MATCHING:
We only have two filters: (1) destination country, (2) area (if the user specifies one). Count filters like this:
- Filter 1 = destination_country (when user mentions a place they want to connect with surfers who surfed there)
- Filter 2 = area (only when user explicitly mentions an area/region/town, e.g. "La Libertad", "Siargao")

CRITICAL - DO NOT ASK FOR AREA WHEN USER ONLY SAID A COUNTRY:
- If the user only mentioned a country (e.g. "someone who surfed in El Salvador", "connect me to people who surfed in Costa Rica"), do NOT ask "which area?" Proceed with destination_country only. That counts as 1 filter.
- If the user does mention an area (e.g. "El Salvador, La Libertad" or "Siargao, Philippines"), resolve the country and area clearly. If you are unsure which country an area belongs to or whether the area name is correct, ask the user once to clarify. Once clear, extract both destination_country and area (2 filters).

FLOW:
- If user provided 2 filters (destination country + area): Do not ask further. Go directly to STEP 4 (set is_finished: true and search).
- If user provided 1 filter (destination country only): Ask ONCE: "Want to add anything else (e.g. a specific area, surf level, age)?" If they say no or just want to search → set is_finished: true with destination_country and area: null, then search. If they say yes and give an area → set area, now 2 filters, set is_finished: true and search. If they say yes but mention something other than area (e.g. surf level, age), still finish and search with just destination (country + area if they also gave one); do not ask again.

Examples:
- "Costa Rica" → 1 filter (country only) → Ask once "add anything else?" then finish and search when they respond
- "El Salvador, La Libertad" → 2 filters → Go directly to STEP 4, search immediately
- "Someone who surfed in Sri Lanka" → 1 filter → Do NOT ask for area. Ask once "add anything else?" then search
- "Philippines, Siargao" → 2 filters → Go directly to STEP 4, search immediately

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

STEP 2 FLOW:
1. Extract destination_country (and area if mentioned) immediately if user mentioned a destination
2. Do NOT ask for area when the user only mentioned a country
3. If user gave 2 filters (country + area) → go to STEP 4 and finish (set is_finished: true)
4. If user gave 1 filter (country only) → ask once "Want to add anything else (e.g. specific area, surf level, age)?" then when they respond, finish and search (with or without area depending on their answer)

STEP 4 - FINISH AND SEARCH:
When ready to search (2 filters provided, or 1 filter and user declined to add more, or 1 filter and user added something):
1. Set is_finished: true
2. Set return_message to: "Copy! Here are a few advisor options that best match what you're looking for."
3. Include in the "data" field: destination_country (required), area (if user specified one, else null), budget (null if not specified), destination_known (true/false), purpose (default: { purpose_type: "connect_traveler", specific_topics: [] }), user_context (optional)

IMPORTANT:
- DO NOT use markdown formatting (no asterisks, no bold, no code blocks)
- DO NOT say "Let me pull up some options" or "One sec!" - just set is_finished: true and return the completion message
- Matching is by destination only (country + optional area). The system finds surfers who have been to that place

BE SMART ABOUT USER REQUESTS:
- Handle typos gracefully: "uropean" → "European", "Philippins" → "Philippines"
- When user mentions a region/continent as a DESTINATION (e.g. "surfed in Central America", "Southeast Asia"), expand to countries and put in destination_country as comma-separated
- Be forgiving with grammar and spelling; if unclear, ask once to clarify (especially for area/country)
- DO NOT use markdown formatting in your responses

When is_finished: true, the system will automatically find matches by destination (country + optional area). You don't need to wait or say you're looking - just finish the conversation.

STEP 6 - QUICK MATCH (User directly asks for surfers/matches):
If user directly asks for surfers/matches (e.g. "send me surfers in El Salvador", "find me people who surfed in Sri Lanka", "show me matches for Costa Rica"):
1. Extract destination from their message (country, area if mentioned)
2. If 2 filters (country + area): set is_finished: true immediately and search
3. If 1 filter (country only): ask once "Want to add anything else (e.g. specific area)?" then when they respond, set is_finished: true and search
4. Use purpose: { purpose_type: "connect_traveler", specific_topics: [] } when not specified
5. Say: "Copy! Here are a few advisor options that best match what you're looking for."

IMPORTANT: return_message should ONLY contain the friendly message text. Set is_finished: true and include the data structure in the "data" field. Do NOT include JSON in return_message.

DATA STRUCTURE (when is_finished: true):
{
  "destination_country": "Country name", // REQUIRED if location mentioned - NEVER null. Correct typos: "filipins" → "Philippines"
  "area": "Area/region name or null if not specified", // Only include if user specified an area
  "budget": 1 | 2 | 3 | null,
  "destination_known": true | false,
  "purpose": {
    "purpose_type": "specific_advice" | "general_guidance" | "connect_traveler" | "combination",
    "specific_topics": ["topic1", "topic2"]
  },
  "user_context": {
    "mentioned_preferences": [],
    "mentioned_deal_breakers": []
  },
  "queryFilters": { "country_from": ["Israel"], "surfboard_type": ["shortboard"], "surf_level_category": ["advanced", "pro"] } // Optional: include when user specified origin, board type, or level. Use exact country names and enum values.
}
Do NOT include non_negotiable_criteria or prioritize_filters in the data. Matching is by destination (country + optional area) and, when provided, by queryFilters (country_from, surfboard_type, surf_level_category). When the user specified criteria (e.g. "Israeli", "shortboard", "advanced"), include queryFilters in data so the system can filter matches.

RESPONSE FORMAT - CRITICAL: YOU MUST ALWAYS RETURN VALID JSON!
⚠️ NEVER RETURN PLAIN TEXT - ALWAYS RETURN A JSON OBJECT! ⚠️

You MUST always return a JSON object with this structure (NO EXCEPTIONS):
{
  "return_message": "The conversational text Swelly says to the user (plain text only, no markdown)",
  "is_finished": true or false,
  "data": {
    "destination_country": "...", // REQUIRED when location mentioned - NEVER null
    "area": "..." or null,
    "budget": 1 | 2 | 3 | null,
    "destination_known": true | false,
    "purpose": { "purpose_type": "connect_traveler", "specific_topics": [] },
    "user_context": {}
  }
}

CRITICAL RULES:
- ALWAYS return valid JSON. NEVER return plain text.
- Set is_finished: true when: (a) User gave 2 filters (country + area) and you are ready to search, OR (b) User gave 1 filter and either declined to add more or added something and you are ready to search, OR (c) Quick match: user asked for surfers and you extracted at least destination_country.
- When is_finished: true, data MUST include destination_country (and area if user specified one). Do NOT include non_negotiable_criteria or prioritize_filters.
- DESTINATION EXTRACTION: When user mentions ANY location, extract destination_country immediately. Correct typos ("filipins" → "Philippines"). If they mention area too, extract both. NEVER set destination_country to null if a location was mentioned.
- return_message = conversational text only. All structured data goes in "data". No JSON or markdown in return_message.
- Example: {"return_message": "Want to add anything else?", "is_finished": false, "data": {"destination_country": "Costa Rica", "area": null, ...}}
- Ask ONE question at a time. Be conversational.
- For destination suggestions, consider their past destinations, preferences, and vibe
- Always get explicit approval before finalizing a destination
`

/**
 * Call OpenAI API
 */
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
  ⚠️ OFFICIAL COUNTRY LIST (use EXACT names from this list - case-sensitive):
${OFFICIAL_COUNTRIES.map(c => `    - "${c}"`).join('\n')}
  ⚠️ Examples:
    - User says "I want to go to California" → destination_country: "United States", area: "California", country_from: NOT SET (user didn't say they want surfers FROM United States)
    - User says "I want surfers from the USA" → country_from: ["United States"] (normalized from "USA" to "United States")
    - User says "I want to go to Costa Rica and connect with surfers from Israel" → destination_country: "Costa Rica", country_from: ["Israel"]
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
- destinations_array (jsonb): Array of {country: string, area: string[], time_in_days: number, time_in_text?: string}

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
- "USA" / "US" / "U.S.A" / "America" → "United States"
- "UK" / "England" / "Britain" → "United Kingdom"
- Any other variation → Find the matching exact name from the official list

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
   - "US" / "United States" / "U.S.A" / "USA" / "America" / "United States of America" → "United States" (MUST use exact name from official list)
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
 * Detect user intent regarding filter management (keep or clear filters)
 */
async function detectFilterIntent(
  userMessage: string,
  conversationHistory: Message[]
): Promise<'keep' | 'clear' | 'unclear'> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const prompt = `You are analyzing a user's message to determine their intent regarding search filters in a trip planning conversation.

The user was just asked: "Yo! How do these matches look? If you want to find more surfers, I can keep your current filters and add to them, or we can start fresh with new ones. What do you think?"

Analyze the user's response and classify it as one of:
- "keep": User wants to keep current filters and possibly add more (e.g., "keep", "yes", "add more", "refine", "keep them", "yes keep", "keep filters", "add to them", "refine them")
- "clear": User wants to clear all filters and start over (e.g., "clear", "start over", "new search", "reset", "clear them", "start fresh", "new", "clear filters", "remove filters")
- "unclear": Cannot determine intent or user is asking a question

User's message: "${userMessage}"

Respond with ONLY one word: "keep", "clear", or "unclear".`

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
          { role: 'system', content: 'You are a classifier that analyzes user intent. Respond with only one word: keep, clear, or unclear.' },
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

    if (intent === 'keep' || intent === 'clear') {
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
  // Handle CORS preflight - must return 200 with CORS headers so browser allows the actual request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Max-Age': '86400',
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

${getPronounInstructions(userProfile.pronoun)}`
        systemPrompt = TRIP_PLANNING_PROMPT + '\n\n' + profileContext
      }

      // Initialize chat history
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        // First message: if user already gave a clear request (surfers/matches + criteria or destination), treat it as real request and only ask for what is missing (e.g. destination). Otherwise use STEP 1.
        { role: 'system', content: 'This is the FIRST message in a NEW conversation. If the user\'s message clearly asks for surfers or matches and includes criteria (e.g. "Israeli", "shortboard", "advanced") and/or a destination (e.g. "El Salvador"), treat it as their real request: extract destination if mentioned, extract criteria if mentioned, and only ask for what is missing (e.g. "Which destination do you want to connect with surfers who\'ve been there? (e.g. El Salvador, Costa Rica)"). If their message is vague or just a greeting, respond with STEP 1\'s question: "Yo! Let\'s Travel! I can connect you with like minded surfers or surf travelers who have experience in specific destinations you are curious about. So, what are you looking for?"' },
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
        // Copy flow: no criteria normalization; only destination/area matter
        if (!tripPlanningData && parsed.is_finished) {
          tripPlanningData = {
            destination_country: parsed.destination_country,
            area: parsed.area,
            budget: parsed.budget,
            destination_known: parsed.destination_known,
            purpose: parsed.purpose,
            user_context: parsed.user_context,
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

${getPronounInstructions(userProfile.pronoun)}`
        messages.splice(0, 1, { role: 'system', content: TRIP_PLANNING_PROMPT + '\n\n' + profileContext })
      }

      // Check if we're waiting for a filter decision (matches were just sent)
      let awaitingFilterDecision = false
      let existingQueryFilters: any = null
      let filterIntent: 'keep' | 'clear' | 'unclear' | null = null
      
      // Check the most recent assistant message for the awaitingFilterDecision flag
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
        }
      }
      
      // If awaiting filter decision, detect user intent
      if (awaitingFilterDecision) {
        console.log('[continue] Detecting filter intent from user message:', body.message)
        filterIntent = await detectFilterIntent(body.message, messages)
        console.log('[continue] Detected filter intent:', filterIntent)
        
        if (filterIntent === 'clear') {
          // Clear all filters - reset queryFilters to null
          console.log('[continue] User wants to clear filters - will reset queryFilters')
          // Remove the flag from metadata
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].metadata?.awaitingFilterDecision) {
              const metadata = messages[i].metadata
              if (metadata) {
                delete metadata.awaitingFilterDecision
              }
            }
          }
        } else if (filterIntent === 'keep') {
          // Keep filters - will merge with existing filters later
          console.log('[continue] User wants to keep filters - will merge with existing filters')
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
          // Unclear intent - ask for clarification
          console.log('[continue] Filter intent unclear - asking for clarification')
          const clarificationMessage = "I didn't quite catch that. Would you like to keep your current filters or clear them and start fresh?"
          
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
      
      // Handle filter management based on user intent
      if (awaitingFilterDecision && filterIntent) {
        // User just responded to filter decision question
        if (filterIntent === 'clear') {
          // Clear all filters - use only new filters (don't merge with existing)
          console.log('🗑️ User cleared filters - using only new filters:', JSON.stringify(extractedQueryFilters, null, 2))
          // extractedQueryFilters will contain only new filters extracted from current message
          // Don't merge with existingQueryFilters or accumulatedFilters
        } else if (filterIntent === 'keep') {
          // Keep filters - merge with existing filters
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
        const strongJsonEnforcement = `ERROR: You returned plain text instead of JSON. This is a CRITICAL ERROR. You MUST return a JSON object. Your response MUST be valid JSON starting with { and ending with }. Example: {"return_message": "Your text here", "is_finished": false, "data": {"destination_country": "Philippines", "area": "Siargao", "budget": null, "destination_known": true, "purpose": {"purpose_type": "connect_traveler", "specific_topics": []}, "user_context": {}}}. Return ONLY the JSON object, nothing else.`
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
          // Copy flow: only run fallback when destination_country or area is missing (no criteria extraction)
          const needsFallback = !tripPlanningData.destination_country || (!tripPlanningData.area && tripPlanningData.destination_country)
          
          if (needsFallback) {
            console.log('⚠️ ChatGPT did not extract all data - using fallback extraction from conversation history (destination/area only)')
            console.log('Current data before enrichment:', JSON.stringify(tripPlanningData, null, 2))
            
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'user') {
                const userMsg = messages[i].content
                const userMsgLower = userMsg.toLowerCase()
                
                // Extract area if missing (e.g., "Costa Rica, Pavones" -> area: "Pavones")
                if (!tripPlanningData.area && tripPlanningData.destination_country) {
                  const countryLower = tripPlanningData.destination_country.toLowerCase()
                  if (userMsgLower.includes(countryLower)) {
                    const parts = userMsg.split(',').map(p => p.trim())
                    if (parts.length > 1) {
                      const countryIndex = parts.findIndex(p => p.toLowerCase().includes(countryLower))
                      if (countryIndex >= 0 && countryIndex < parts.length - 1) {
                        const area = parts[countryIndex + 1]
                        if (area && area.length > 0 && area.length < 50) {
                          tripPlanningData.area = area
                          console.log(`✅ Extracted area "${area}" from user message: "${userMsg}"`)
                        }
                      }
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
              user_context: parsed.user_context || {},
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
                        user_context: prevParsed.user_context || prevParsed.data?.user_context || {},
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
            if (awaitingFilterDecision && filterIntent === 'clear') {
              // User wants to clear filters - use only new filters
              tripPlanningData.queryFilters = normalizedQueryFilters
              console.log('🗑️ User cleared filters - using only new filters')
            } else if (awaitingFilterDecision && filterIntent === 'keep' && tripPlanningData.queryFilters) {
              // User wants to keep filters - merge with existing
              tripPlanningData.queryFilters = {
                ...tripPlanningData.queryFilters,
                ...normalizedQueryFilters, // Current filters override existing ones
              }
              console.log('🔄 Merged filters (existing + current)')
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
            return_message: "Yo! How do these matches look? If you want to find more surfers, I can keep your current filters and add to them, or we can start fresh with new ones. What do you think?",
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

    // Route: POST /swelly-trip-planning/find-matches
    if (path.endsWith('/find-matches') && req.method === 'POST') {
      try {
        const body: { chatId: string; tripPlanningData: any } = await req.json()

        if (!body.chatId) {
          return new Response(
            JSON.stringify({ error: 'Missing chatId' }),
            { 
              status: 400, 
              headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              } 
            }
          )
        }

        if (!body.tripPlanningData) {
          return new Response(
            JSON.stringify({ error: 'Missing tripPlanningData' }),
            { 
              status: 400, 
              headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              } 
            }
          )
        }

        // Normalize tripPlanningData to snake_case (client/LLM may send camelCase)
        const raw = body.tripPlanningData || {}
        console.log('[find-matches] Request body keys:', { chatId: body.chatId, tripPlanningDataKeys: Object.keys(raw) })
        let queryFilters = raw.queryFilters ?? raw.query_filters ?? null
        if (queryFilters && typeof queryFilters === 'object') {
          queryFilters = await normalizeQueryFilters(queryFilters)
        }
        const tripPlanningData = {
          destination_country: raw.destination_country ?? raw.destinationCountry ?? null,
          area: raw.area ?? null,
          budget: raw.budget ?? null,
          destination_known: raw.destination_known ?? raw.destinationKnown ?? false,
          purpose: raw.purpose ?? { purpose_type: 'connect_traveler', specific_topics: [] },
          user_context: raw.user_context ?? raw.userContext ?? null,
          queryFilters: queryFilters || null,
        }

        if (!tripPlanningData.destination_country || String(tripPlanningData.destination_country).trim() === '') {
          console.error('[find-matches] Missing destination_country in tripPlanningData. Keys received:', Object.keys(raw))
          return new Response(
            JSON.stringify({ error: 'destination_country is required for matching. Ensure the chat response data includes destination_country or destinationCountry.' }),
            { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
          )
        }

        console.log('[find-matches] Normalized request:', {
          destination_country: tripPlanningData.destination_country,
          area: tripPlanningData.area,
          queryFilters: tripPlanningData.queryFilters ? Object.keys(tripPlanningData.queryFilters) : null,
        })

        // Run server-side matching (same behaviour as main flow, matching on server)
        console.log('[find-matches] Starting server-side matching for chat:', body.chatId)
        const matches = await findMatchingUsersV3Server(
          tripPlanningData,
          user.id,
          body.chatId,
          supabaseAdmin
        )

        // Save matches to database
        await saveMatchesInline(
          body.chatId,
          user.id,
          matches,
          supabaseAdmin,
          null,
          tripPlanningData.destination_country,
          tripPlanningData.area || null
        )

        console.log('[find-matches] Successfully found and saved', matches.length, 'matches')

        return new Response(
          JSON.stringify({
            matches,
            totalCount: matches.length,
            chatId: body.chatId,
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
        console.error('[find-matches] Error:', error)
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
    }

    // If no route matched, return 404
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

