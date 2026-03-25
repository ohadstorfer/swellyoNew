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
  /** When adding filters (Add Filter flow), client sends current queryFilters so we can merge. */
  existing_query_filters?: any
  adding_filters?: boolean
  /** Optional: preserve destination/area when merging in add-filters mode. */
  existing_destination_country?: string | null
  existing_area?: string | null
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
  totalCount?: number
  actionRow?: {
    requestData?: any
    selectedAction?: 'new_chat' | 'add_filter' | 'more' | null
  }
  searchSummaryBlock?: {
    requestData?: any
    searchSummary?: string
    selectedAction?: 'search' | 'continue_editing' | null
  }
  isRestartAfterNewChat?: boolean
  isAddFilterPrompt?: boolean
  existingFiltersData?: any
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  metadata?: MessageMetadata
}

/** First question shown when starting or restarting trip planning. */
const TRIP_PLANNING_FIRST_QUESTION_TEXT =
  "Yo! Let’s get you connected! So what are we looking for today?"

// ========== UI MESSAGES: Ordered, typed messages for perfect conversation restore ==========

interface UIMessage {
  id: string
  order_index: number
  type: 'bot_text' | 'user_text' | 'search_summary' | 'match_results' | 'no_matches' | 'new_chat_restart' | 'add_filter_prompt' | 'filter_removal_ack' | 'error'
  text: string
  timestamp: string  // ISO 8601
  is_user: boolean
  // Type-specific payload
  matched_users?: MatchedUser[]
  destination_country?: string
  match_total_count?: number
  action_row?: {
    request_data: any
    selected_action: 'new_chat' | 'add_filter' | 'more' | null
  }
  search_summary_block?: {
    request_data: any
    search_summary: string
    selected_action: 'search' | 'continue_editing' | null
  }
  is_search_summary?: boolean
  is_restart_after_new_chat?: boolean
  backend_message_index?: number
}

function makeTimestamp(): string {
  return new Date().toISOString()
}

function appendUIMessage(uiMessages: UIMessage[], partial: Omit<UIMessage, 'id' | 'order_index'>): UIMessage {
  const msg: UIMessage = {
    ...partial,
    id: crypto.randomUUID(),
    order_index: uiMessages.length,
  }
  uiMessages.push(msg)
  return msg
}

/** Load ui_messages from DB (returns empty array if column is null/empty). */
async function getUIMessages(chatId: string, supabaseAdmin: any): Promise<UIMessage[]> {
  const { data, error } = await supabaseAdmin
    .from('swelly_chat_history')
    .select('ui_messages')
    .eq('chat_id', chatId)
    .single()
  if (error || !data) return []
  return Array.isArray(data.ui_messages) ? data.ui_messages : []
}

/** Save ui_messages to DB (alongside existing saveChatHistory for GPT messages). */
async function saveUIMessages(chatId: string, uiMessages: UIMessage[], supabaseAdmin: any): Promise<void> {
  const { error } = await supabaseAdmin
    .from('swelly_chat_history')
    .update({ ui_messages: uiMessages, updated_at: new Date().toISOString() })
    .eq('chat_id', chatId)
  if (error) {
    console.error('[saveUIMessages] Error:', error)
  }
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
function getCountryFromUserDestInline(dest: any): string {
  if (typeof dest === 'object' && dest !== null && 'country' in dest) return (dest.country || '').trim()
  if (typeof dest === 'object' && dest !== null && 'destination_name' in dest) {
    const name = (dest.destination_name || '').trim()
    const first = name.split(',')[0]
    return (first || '').trim()
  }
  if (typeof dest === 'string') {
    const first = dest.split(',')[0]
    return (first || '').trim()
  }
  return ''
}
function countryMatchesRequestInline(requestCountry: string | null, userCountry: string, userState?: string | null): boolean {
  if (!requestCountry || !userCountry) return false
  const requested = requestCountry.split(',').map((c: string) => c.trim().toLowerCase()).filter((c: string) => c.length > 0)
  const userCountryLower = userCountry.toLowerCase().trim()
  const userStateLower = userState != null ? String(userState).toLowerCase().trim() : undefined
  return requested.some((r: string) => {
    if (userCountryLower === r) return true
    if ((r === 'usa' || r === 'united states') && (userCountryLower.includes('united states') || userCountryLower.includes('usa'))) return true
    if ((r === 'uk' || r === 'united kingdom') && (userCountryLower.includes('united kingdom') || /\buk\b/.test(userCountryLower))) return true
    const usStatePrefix = 'united states - '
    if (r.startsWith(usStatePrefix)) {
      const requestedState = r.slice(usStatePrefix.length).trim()
      const isUSUser = userCountryLower.includes('united states') || userCountryLower === 'usa'
      if (isUSUser && requestedState.length > 0 && userStateLower) {
        if (userStateLower === requestedState) return true
        if (userStateLower.includes(requestedState) || requestedState.includes(userStateLower)) return true
      }
    }
    const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp('\\b' + escaped + '\\b', 'i').test(userCountryLower)
  })
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
const SURF_LEVEL_NUM_TO_CATEGORY: Record<number, string> = {
  1: 'beginner',
  2: 'intermediate',
  3: 'advanced',
  4: 'pro',
}
/** Allowed numeric levels for requested categories: single category => [that level]; multiple => levels >= min. */
function surfLevelAllowedNumericLevelsInline(requestedCategories: string[]): number[] {
  if (!requestedCategories?.length) return []
  const levels = requestedCategories
    .map((cat: string) => SURF_LEVEL_CATEGORY_TO_NUM[(cat || '').toLowerCase()])
    .filter((n: number) => n != null && !isNaN(n))
  if (levels.length === 0) return []
  if (levels.length === 1) return levels
  const minLevel = Math.min(...levels)
  return [1, 2, 3, 4].filter((l: number) => l >= minLevel)
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
function passesCriteriaInline(entry: { surfer: any; hasAreaMatch?: boolean; daysInDestination?: number; bestMatch?: any }, queryFilters: any): boolean {
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
      const allowedNumericLevels = surfLevelAllowedNumericLevelsInline(requestedCategories)
      const userCategory = (s.surf_level_category || '').toLowerCase()
      const surferNumeric = typeof s.surf_level === 'number' ? s.surf_level : null
      const matchByCategory = !!userCategory && requestedCategories.includes(userCategory)
      const matchByNumeric = surferNumeric != null && allowedNumericLevels.includes(surferNumeric)
      const singleCategory = requestedCategories.length === 1
      const pass = singleCategory
        ? matchByCategory || (!userCategory && matchByNumeric)
        : matchByCategory || matchByNumeric
      if (!pass) return false
    }
  }
  if (queryFilters?.age_min !== undefined && queryFilters?.age_min !== null && typeof queryFilters.age_min === 'number') {
    const userAge = typeof s.age === 'number' ? s.age : null
    if (userAge === null || userAge < queryFilters.age_min) return false
  }
  if (queryFilters?.age_max !== undefined && queryFilters?.age_max !== null && typeof queryFilters.age_max === 'number') {
    const userAge = typeof s.age === 'number' ? s.age : null
    if (userAge === null || userAge > queryFilters.age_max) return false
  }
  return true
}

function getCriteriaFailureReasonInline(surfer: any, queryFilters: any): string | null {
  const s = surfer
  if (queryFilters?.country_from && Array.isArray(queryFilters.country_from) && queryFilters.country_from.length > 0) {
    if (!countryFromMatchInline(queryFilters.country_from, s.country_from)) {
      return `country_from: surfer.country_from='${s.country_from ?? 'null'}' not in requested [${queryFilters.country_from.join(', ')}]`
    }
  }
  if (queryFilters?.surfboard_type && Array.isArray(queryFilters.surfboard_type) && queryFilters.surfboard_type.length > 0) {
    const normalized = queryFilters.surfboard_type.map(normalizeBoardTypeInline)
    const userBoard = normalizeBoardTypeInline(s.surfboard_type || '')
    if (!userBoard || !normalized.includes(userBoard)) {
      return `surfboard_type: surfer.surfboard_type='${s.surfboard_type ?? 'null'}' (normalized: '${userBoard || 'empty'}') not in [${normalized.join(', ')}]`
    }
  }
  if (queryFilters?.surf_level_category != null) {
    const requested = Array.isArray(queryFilters.surf_level_category) ? queryFilters.surf_level_category : [queryFilters.surf_level_category]
    const requestedCategories = requested.map((x: string) => (x || '').toLowerCase()).filter(Boolean)
    if (requestedCategories.length > 0) {
      const allowedNumericLevels = surfLevelAllowedNumericLevelsInline(requestedCategories)
      const userCategory = (s.surf_level_category || '').toLowerCase()
      const surferNumeric = typeof s.surf_level === 'number' ? s.surf_level : null
      const matchByCategory = !!userCategory && requestedCategories.includes(userCategory)
      const matchByNumeric = surferNumeric != null && allowedNumericLevels.includes(surferNumeric)
      const singleCategory = requestedCategories.length === 1
      const pass = singleCategory
        ? matchByCategory || (!userCategory && matchByNumeric)
        : matchByCategory || matchByNumeric
      if (!pass) {
        const requiredDesc = singleCategory
          ? `category '${requestedCategories[0]}' or surf_level = ${allowedNumericLevels[0] ?? '?'}`
          : `category in [${requestedCategories.join(', ')}] or surf_level in [${allowedNumericLevels.join(', ')}]`
        return `surf_level_category: surfer.surf_level_category='${s.surf_level_category ?? 'null'}' surfer.surf_level=${surferNumeric ?? 'null'}, required ${requiredDesc}`
      }
    }
  }
  if (queryFilters?.age_min !== undefined && queryFilters?.age_min !== null && typeof queryFilters.age_min === 'number') {
    const userAge = typeof s.age === 'number' ? s.age : null
    if (userAge === null || userAge < queryFilters.age_min) {
      return `age_min: surfer.age=${userAge === null ? 'null' : userAge}, required >= ${queryFilters.age_min}`
    }
  }
  if (queryFilters?.age_max !== undefined && queryFilters?.age_max !== null && typeof queryFilters.age_max === 'number') {
    const userAge = typeof s.age === 'number' ? s.age : null
    if (userAge === null || userAge > queryFilters.age_max) {
      return `age_max: surfer.age=${userAge === null ? 'null' : userAge}, required <= ${queryFilters.age_max}`
    }
  }
  return null
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
function hasMeaningfulQueryFiltersInline(q: any): boolean {
  if (!q || typeof q !== 'object') return false
  if (q.country_from && Array.isArray(q.country_from) && q.country_from.length > 0) return true
  if (q.surfboard_type && Array.isArray(q.surfboard_type) && q.surfboard_type.length > 0) return true
  if (q.surf_level_category != null) return true
  if (typeof q.age_min === 'number') return true
  if (typeof q.age_max === 'number') return true
  return false
}

function totalDaysInDestinationsInline(destinations_array: any[] | null | undefined): number {
  if (!destinations_array?.length) return 0
  let sum = 0
  for (const d of destinations_array) {
    sum += (d && typeof d.time_in_days === 'number') ? d.time_in_days : 0
  }
  return sum
}

function buildSearchSpecInline(request: any, queryFilters: any, hasDestination: boolean): string {
  const parts: string[] = []
  if (hasDestination) {
    parts.push(`destination_country=${request.destination_country}`)
    if (request.area) parts.push(`area=${request.area}`)
  }
  if (queryFilters?.country_from && Array.isArray(queryFilters.country_from) && queryFilters.country_from.length > 0) {
    parts.push(`country_from in [${queryFilters.country_from.join(', ')}]`)
  }
  if (queryFilters?.surfboard_type && Array.isArray(queryFilters.surfboard_type) && queryFilters.surfboard_type.length > 0) {
    parts.push(`surfboard_type in [${queryFilters.surfboard_type.join(', ')}]`)
  }
  if (queryFilters?.surf_level_category != null) {
    const arr = Array.isArray(queryFilters.surf_level_category) ? queryFilters.surf_level_category : [queryFilters.surf_level_category]
    parts.push(`surf_level_category in [${arr.join(', ')}]`)
  }
  if (typeof queryFilters?.age_min === 'number') {
    parts.push(`age_min=${queryFilters.age_min} (surfer.age >= ${queryFilters.age_min})`)
  }
  if (typeof queryFilters?.age_max === 'number') {
    parts.push(`age_max=${queryFilters.age_max} (surfer.age <= ${queryFilters.age_max})`)
  }
  return parts.length ? parts.join(', ') : '(no filters)'
}

/** Max number of matches returned per request; "More" returns the next batch (previously matched are excluded). */
const MATCHES_PAGE_SIZE = 3

async function findMatchingUsersV3Server(request: any, requestingUserId: string, chatId: string, supabaseAdmin: any, excludePrevious: boolean = false): Promise<{ results: MatchResultInline[]; totalCount: number }> {
  const hasDestination = request.destination_country && String(request.destination_country).trim() !== ''
  const queryFilters = request.queryFilters || null

  const pathName = hasDestination ? 'destination' : 'general'
  console.log('[find-matches] Match path:', pathName)
  console.log('[find-matches] Search spec:', buildSearchSpecInline(request, queryFilters, hasDestination))

  // General match path: no destination, filter by queryFilters only
  if (!hasDestination) {
    if (!hasMeaningfulQueryFiltersInline(queryFilters)) {
      throw new Error('Either destination_country or at least one query filter (e.g. country_from, age_min/age_max, surfboard_type, surf_level_category) is required for matching.')
    }
    const excludedUserIds = excludePrevious ? await getPreviouslyMatchedUserIdsInline(chatId, supabaseAdmin) : []
    console.log('[find-matches] General match (no destination). Excluded user IDs:', excludedUserIds?.length ?? 0)
    const query = buildSurferQueryInline(request, requestingUserId, excludedUserIds, supabaseAdmin)
    const { data: allSurfers, error: queryErr } = await query
    if (queryErr) throw new Error('Error querying surfers: ' + queryErr.message)
    console.log('[find-matches] General: surfers from DB =', allSurfers?.length ?? 0)
    if (!allSurfers?.length) {
      console.log('[find-matches] 0 matches: no surfers from DB')
      return { results: [], totalCount: 0 }
    }
    const filteredSurfers = filterExcludedInMemoryInline(allSurfers, excludedUserIds)
    console.log('[find-matches] General: after excluding previously matched =', filteredSurfers.length)
    if (filteredSurfers.length === 0) {
      console.log('[find-matches] 0 matches: no surfers left after exclusions')
      return { results: [], totalCount: 0 }
    }
    if (filteredSurfers.length > 0) {
      const sample = filteredSurfers.slice(0, 3).map((s: any) => ({
        user_id: s.user_id,
        country_from: s.country_from,
        surfboard_type: s.surfboard_type,
        surf_level_category: s.surf_level_category,
        surf_level: s.surf_level,
        age: s.age,
      }))
      console.log('[find-matches] General: sample of DB surfers (first 3):', JSON.stringify(sample))
    }
    const candidates = filteredSurfers.filter((s: any) => passesCriteriaInline({ surfer: s }, queryFilters))
    console.log('[find-matches] General match: after criteria filter:', candidates.length)
    if (candidates.length === 0 && filteredSurfers.length > 0) {
      console.log('[find-matches] 0 matches after criteria. Sample failure reasons (first 5 surfers):')
      for (let i = 0; i < Math.min(5, filteredSurfers.length); i++) {
        const s = filteredSurfers[i]
        const reason = getCriteriaFailureReasonInline(s, queryFilters)
        console.log('[find-matches]   user_id=' + (s.user_id || '?') + ':', reason ?? 'passed')
      }
    }
    if (candidates.length > 0 && queryFilters?.surf_level_category != null) {
      const sample = candidates[0]
      console.log('[find-matches] surf_level filter applied; sample passed surfer: user_id=' + (sample.user_id || '?') + ' surf_level_category=' + (sample.surf_level_category ?? 'null') + ' surf_level=' + (sample.surf_level ?? 'null'))
    }
    candidates.sort((a: any, b: any) => totalDaysInDestinationsInline(b.destinations_array) - totalDaysInDestinationsInline(a.destinations_array))
    const generalResults = candidates.map((userSurfer: any) => {
      const totalDays = totalDaysInDestinationsInline(userSurfer.destinations_array)
      return {
        user_id: userSurfer.user_id,
        name: userSurfer.name || 'User',
        profile_image_url: userSurfer.profile_image_url ?? null,
        match_score: totalDays,
        priority_score: 0,
        general_score: undefined as number | undefined,
        matched_areas: [],
        matched_towns: [],
        common_lifestyle_keywords: [],
        common_wave_keywords: [],
        surfboard_type: userSurfer.surfboard_type,
        surf_level: userSurfer.surf_level,
        travel_experience: userSurfer.travel_experience?.toString(),
        country_from: userSurfer.country_from,
        age: userSurfer.age,
        days_in_destination: totalDays,
        destinations_array: userSurfer.destinations_array,
        match_quality: { matchCount: 1, countryMatch: false, areaMatch: false, townMatch: false },
      }
    })
    const limited = generalResults.slice(0, MATCHES_PAGE_SIZE)
    console.log('[find-matches] Result:', limited.length, `matches (path=general, max per page=${MATCHES_PAGE_SIZE}, totalCount=${generalResults.length})`)
    return { results: limited, totalCount: generalResults.length }
  }

  // Destination path: country match + raw area match only (no cardinal/town normalization)
  const excludedUserIds = excludePrevious ? await getPreviouslyMatchedUserIdsInline(chatId, supabaseAdmin) : []
  console.log('[find-matches] Destination: excluded user IDs (previously matched):', excludedUserIds?.length ?? 0, 'excludePrevious:', excludePrevious)
  const query = buildSurferQueryInline(request, requestingUserId, excludedUserIds, supabaseAdmin)
  const { data: allSurfers, error: queryErr } = await query
  if (queryErr) throw new Error('Error querying surfers: ' + queryErr.message)
  console.log('[find-matches] Destination: surfers from DB (before exclusions):', allSurfers?.length ?? 0)
  if (!allSurfers?.length) {
    console.log('[find-matches] 0 matches: no surfers from DB')
    return { results: [], totalCount: 0 }
  }
  const filteredSurfers = filterExcludedInMemoryInline(allSurfers, excludedUserIds)
  console.log('[find-matches] Destination: after excluding previously matched:', filteredSurfers.length)
  const requestedArea = request.area || null
  const countryMatched: Array<{ surfer: any; hasAreaMatch: boolean; daysInDestination: number; bestMatch: { countryMatch: boolean; areaMatch: boolean; townMatch: boolean; matchedAreas: string[]; matchedTowns: string[] } }> = []
  for (const userSurfer of filteredSurfers) {
    let days = 0
    let hasAreaMatch = false
    if (userSurfer.destinations_array?.length) {
      for (const dest of userSurfer.destinations_array) {
        const userCountry = getCountryFromUserDestInline(dest)
        const userState = typeof dest === 'object' && dest !== null && 'state' in dest ? (dest as any).state : undefined
        if (!countryMatchesRequestInline(request.destination_country, userCountry, userState)) continue
        days += dest.time_in_days || 0
        if (requestedArea && hasRequestedAreaInArrayInline(dest, requestedArea)) hasAreaMatch = true
      }
    }
    if (days === 0) continue
    const bestMatch = {
      countryMatch: true,
      areaMatch: hasAreaMatch,
      townMatch: false,
      matchedAreas: hasAreaMatch && requestedArea ? [requestedArea] : [] as string[],
      matchedTowns: [] as string[],
    }
    countryMatched.push({ surfer: userSurfer, hasAreaMatch, daysInDestination: days, bestMatch })
  }
  console.log('[find-matches] Destination: after country match (destinations_array + time_in_days > 0):', countryMatched.length)
  if (countryMatched.length === 0) {
    console.log('[find-matches] 0 matches: no surfers with destination country match')
    return { results: [], totalCount: 0 }
  }

  let afterCriteria = countryMatched
  if (queryFilters && typeof queryFilters === 'object') {
    afterCriteria = countryMatched.filter((entry) => passesCriteriaInline(entry, queryFilters))
    console.log('[find-matches] Destination: after criteria filter (country_from/surfboard_type/surf_level/age):', afterCriteria.length)
    if (afterCriteria.length === 0 && countryMatched.length > 0) {
      console.log('[find-matches] 0 matches after criteria. Sample failure reasons (first 5 surfers):')
      for (let i = 0; i < Math.min(5, countryMatched.length); i++) {
        const entry = countryMatched[i]
        const reason = getCriteriaFailureReasonInline(entry.surfer, queryFilters)
        console.log('[find-matches]   user_id=' + (entry.surfer?.user_id || '?') + ':', reason ?? 'passed')
      }
    }
    if (afterCriteria.length > 0 && queryFilters?.surf_level_category != null) {
      const sampleSurfer = afterCriteria[0].surfer
      console.log('[find-matches] surf_level filter applied; sample passed surfer: user_id=' + (sampleSurfer?.user_id || '?') + ' surf_level_category=' + (sampleSurfer?.surf_level_category ?? 'null') + ' surf_level=' + (sampleSurfer?.surf_level ?? 'null'))
    }
  }

  afterCriteria.sort((a, b) => {
    if (requestedArea) {
      if (a.hasAreaMatch && !b.hasAreaMatch) return -1
      if (!a.hasAreaMatch && b.hasAreaMatch) return 1
    }
    return b.daysInDestination - a.daysInDestination
  })
  const destResults = afterCriteria.map(({ surfer: userSurfer, hasAreaMatch, daysInDestination, bestMatch }) => ({
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
  const destLimited = destResults.slice(0, MATCHES_PAGE_SIZE)
  console.log('[find-matches] Result:', destLimited.length, `matches (path=destination, max per page=${MATCHES_PAGE_SIZE}, totalCount=${destResults.length})`)
  return { results: destLimited, totalCount: destResults.length }
}
// === END INLINED find-matches ===

const FIXED_FIRST_MESSAGE = "Yo! Let\u2019s get you connected! So what are we looking for today?"

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
ALWAYS start with this exact question in your FIRST response — and use ONLY this sentence, no additions: "Yo! Let’s get you connected! So what are we looking for today?" Do NOT add any other sentence after it (e.g. do not add "Do you want surfers who've surfed a specific destination..." or "or just surfers that match your vibe...").

When the first message in the conversation (new_chat) is vague or just a greeting, respond with STEP 1's question only (the single sentence above). If the user's first message clearly asks for surfers or matches and includes criteria (e.g. origin, board type, level) and/or a destination, treat it as their real request: extract what you can (destination if mentioned, criteria if mentioned) and only ask for what is missing (e.g. if they did not mention a destination, ask: "Which destination do you want to connect with surfers who've been there? (e.g. El Salvador, Costa Rica)"). Do not repeat STEP 1 when they already gave a direct request.

INTERPRET USER RESPONSE (be smart and natural):
- If user directly asks for surfers/matches/people (e.g., "send me surfers", "find me people", "show me matches", "who surfed in [place]") → They want matches NOW → Go to STEP 6 (Quick Match)
- If user mentions a specific destination/country/place → Extract destination and proceed to STEP 2
- If user asks for general matching without a destination (e.g., "find me surfers like me") → You may set is_finished: true with only queryFilters for general matching, or ask which destination they want and proceed to STEP 2 once they answer.
- When the user has already provided criteria (e.g. country of origin, age, surfboard type, surf level) but NO destination: you may set is_finished: true with only queryFilters (no destination_country) to run general matching, or ask for a destination if you want to narrow by place. Acknowledge their criteria in your reply. Do not ask "What are you looking for?" as if they had said nothing.

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
Count ALL filters the user provided. Filters include:
- destination_country (when user mentions a place they want to connect with surfers who surfed there)
- area (only when user explicitly mentions an area/region/town, e.g. "La Libertad", "Siargao")
- country_from (when user mentions nationality/origin, e.g. "Israeli", "from USA", "American")
- surfboard_type (when user mentions board type, e.g. "shortboarder", "longboard")
- surf_level_category (when user mentions level, e.g. "advanced", "beginner")
- age range (when user mentions age, e.g. "around my age", "young")

CRITICAL RULES:
- NEVER ask for area. If the user wants a specific area, they will mention it themselves.
- If the user provided 2 or more filters total (counting ALL filter types above), go directly to STEP 4 (set is_finished: true and search). Do NOT ask any follow-up questions.
- If the user provided only 1 filter (e.g. just a country, or just country_from): set is_finished: true in the SAME turn. Return one response with search_summary (and data with that filter). Do NOT send a separate "Want to add anything else?" message. In the search_summary text you may include a short line like "Want to add anything else or search now?" so the user can add more or proceed.

Examples:
- "Israeli who surfed in El Salvador" → 2 filters (country + country_from) → Go directly to STEP 4, search immediately
- "advanced surfer in Costa Rica" → 2 filters (country + surf_level) → Go directly to STEP 4, search immediately
- "El Salvador, La Libertad" → 2 filters (country + area) → Go directly to STEP 4, search immediately
- "Costa Rica" → 1 filter (country only) → set is_finished: true in same turn with search_summary (e.g. "Got you — Costa Rica. Want to add anything else or search now?")
- "Someone who surfed in Sri Lanka" → 1 filter → set is_finished: true in same turn with search_summary
- "send me an israeli surfer" / "just israeli" → 1 filter (country_from) → set is_finished: true in same turn with search_summary (e.g. "Got you — Israeli surfers (keeping it wide open). Want to add anything else or search now?")
- "Philippines, Siargao" → 2 filters → Go directly to STEP 4, search immediately
- "send me an Israeli dude who surfed in El Salvador" → 2 filters (country + country_from) → Go directly to STEP 4, search immediately

CRITICAL: Extract destination AND area if both are mentioned together!
THIS IS YOUR PRIMARY JOB - Extract correctly, don't rely on fallback code!

TYPO HANDLING - Be smart and correct automatically:
- "Philippins" / "filipins" / "filipines" / "Philippines" → ALL mean "Philippines" → destination_country: "Philippines"
- "Siargao Philippins" → destination_country: "Philippines", area: "Siargao"
- "Siargao Philippines" → destination_country: "Philippines", area: "Siargao"
- "Siargao filipins" → destination_country: "Philippines", area: "Siargao" (CORRECT THE TYPO!)
- "Siargao the filipins" → destination_country: "Philippines", area: "Siargao"
- "Siargao in the Philippines" → destination_country: "Philippines", area: "Siargao"
- "in the Philippines" → destination_country: "Philippines", area: null

CRITICAL RULES FOR DESTINATION EXTRACTION:
1. ALWAYS extract destination_country when a location is mentioned - NEVER leave it as null!
2. If user mentions both area and country (e.g., "Siargao filipins"), extract BOTH immediately
3. Correct typos automatically - "filipins" → "Philippines", "Isreal" → "Israel", "Brasil" → "Brazil"
4. Be flexible with formatting - "Siargao, filipins" and "Siargao the Philippines" both mean the same thing
5. If you see a typo but understand the intent, correct it and extract properly
6. When the user writes two place names separated by a comma, do NOT assume a fixed order. Instead, use your geographic knowledge to figure out which one is the country and which one is the area/region within that country. For example: "Costa Rica, Pavones" → country is "Costa Rica", area is "Pavones". "Bali, Indonesia" → country is "Indonesia", area is "Bali". "Tamarindo, Costa Rica" → country is "Costa Rica", area is "Tamarindo".
7. IMPORTANT: area must ONLY be a real geographic location (city, town, region, beach). If text after a comma is NOT a place name (e.g. "using a shortboard", "who is advanced", "around age 25"), do NOT set it as area. Only set area when it is an actual place within the destination country.

US DESTINATION RULES (when user mentions a place in the United States):
- When the user mentions a US STATE as the place they want to connect with surfers who surfed there, set destination_country to the EXACT format "United States - StateName" (e.g. "United States - California", "United States - Hawaii"). Use the exact state name after the hyphen (Alabama, Alaska, California, Florida, Hawaii, New York, Texas, etc.).
- Set area ONLY when the user mentions a specific place WITHIN that state (city, region, beach, e.g. "San Diego", "Huntington Beach"). If they only mention the state, set area to null.
- "California" / "surfed in California" / "I want to go to California" → destination_country: "United States - California", area: null
- "Hawaii" / "surfed in Hawaii" → destination_country: "United States - Hawaii", area: null
- "San Diego California" / "Huntington Beach California" → destination_country: "United States - California", area: "San Diego" / "Huntington Beach"
- If user says only "USA" or "United States" with no state → destination_country: "United States", area: null

EXAMPLES OF CORRECT EXTRACTION:
- User: "Siargao, filipins" → destination_country: "Philippines", area: "Siargao" ✅
- User: "Costa Rica, Pavones" → destination_country: "Costa Rica", area: "Pavones" ✅
- User: "El Salvador" → destination_country: "El Salvador", area: null ✅
- User: "Sri Lanka" → destination_country: "Sri Lanka", area: null ✅
- User: "Bali, Indonesia" → destination_country: "Indonesia", area: "Bali" ✅
- User: "Tamarindo, Costa Rica" → destination_country: "Costa Rica", area: "Tamarindo" ✅
- User: "California" or "surfed in California" → destination_country: "United States - California", area: null ✅
- User: "Hawaii" → destination_country: "United States - Hawaii", area: null ✅
- User: "San Diego, California" → destination_country: "United States - California", area: "San Diego" ✅

WRONG (DON'T DO THIS):
- User: "Siargao, filipins" → destination_country: null, area: null ❌ (You must extract!)
- User: "Siargao, filipins" → destination_country: "filipins", area: "Siargao" ❌ (Correct the typo!)
- User: "El Salvador, using a shortboard" → area: "using a shortboard" ❌ (That's not a place! Set area: null, put shortboard in queryFilters.surfboard_type)
- User: "Hawaii, advanced surfer" → area: "advanced surfer" ❌ (That's not a place! Set area: null, put level in queryFilters.surf_level_category)

Examples:
- User: "Sri Lanka" → Extract: destination_country: "Sri Lanka", area: null
- User: "Costa Rica, Pavones" → Extract: destination_country: "Costa Rica", area: "Pavones"
- User: "I'm thinking Costa Rica, maybe Tamarindo" → Extract: destination_country: "Costa Rica", area: "Tamarindo"
- User: "Want to go to Indonesia, Bali" → Extract: destination_country: "Indonesia", area: "Bali"
- User: "Siargao, in the Philippines" → Extract: destination_country: "Philippines", area: "Siargao"
- User: "Siargao, Philippins" → Extract: destination_country: "Philippines", area: "Siargao" (fix typo!)
- User: "California" or "I want to go to California" → Extract: destination_country: "United States - California", area: null
- User: "San Diego, California" → Extract: destination_country: "United States - California", area: "San Diego"

If user mentions both country and area/region in the same message, extract BOTH immediately. Don't ask for area if they already provided it.

STEP 2 FLOW:
1. Extract destination_country (and area if mentioned) immediately if user mentioned a destination location
2. Extract any queryFilters (country_from, surfboard_type, surf_level_category, age) if mentioned
2. Do NOT ask for area when the user only mentioned a country or destination location       
3. Count ALL filters total (destination_country, area, country_from, surfboard_type, surf_level_category, age)
4. If user gave 2+ filters total → go to STEP 4 and finish (set is_finished: true) immediately, NO follow-up questions
5. If user gave only 1 filter → set is_finished: true in the SAME turn with search_summary and data. Do NOT send a separate "Want to add anything else?" message. In search_summary you may include "Want to add anything else or search now?" so they can add more or proceed.

STEP 4 - FINISH AND WAIT FOR DECISION:
When you have enough information to define a clear search (2 filters provided, or 1 filter and user declined to add more, or 1 filter and user added something):
1. Set is_finished: true
2. Set return_message to a short, friendly line that matches the intent of the upcoming search (e.g. "Sweet — I think I’ve got your surfer vibe dialed in.").
3. Include in the "data" field: destination_country (required when user specified a destination; null when doing criteria-only general matching), area (if user specified one, else null), budget (null if not specified), destination_known (true/false), purpose (default: { purpose_type: "connect_traveler", specific_topics: [] }), user_context (optional). When matching without destination, include queryFilters with at least one criterion instead.
4. ALWAYS set search_summary in data (see DATA STRUCTURE section) so the user sees exactly what would be searched, and your message implicitly hands control back to them to either search now or tweak filters first.
5. Do NOT set is_finished: true when you have no destination_country and no meaningful queryFilters (no country_from, surfboard_type, surf_level_category, or age). In that case set is_finished: false and in your reply explain we can filter by: destination they surfed, origin, age, surf level, board type — and ask for at least one so we can search.

IMPORTANT:
- DO NOT use markdown formatting (no asterisks, no bold, no code blocks)
- DO NOT say "Let me pull up some options" or "One sec!" - just set is_finished: true, describe the planned search in a natural way, and let the search_summary + follow-up question handle the actual decision to search or edit.
- Matching is by destination (country + optional area) when provided, or by criteria only (e.g. country_from, age) when the user did not specify a destination. The system will only actually search after the user clearly confirms they want to search.

BE SMART ABOUT USER REQUESTS:
- Handle typos gracefully: "uropean" → "European", "Philippins" → "Philippines"
- When user mentions a region/continent as a DESTINATION (e.g. "surfed in Central America", "Southeast Asia"), expand to countries and put in destination_country as comma-separated
- Be forgiving with grammar and spelling; if unclear, ask once to clarify (especially for area/country)
- DO NOT use markdown formatting in your responses

When is_finished: true, you are NOT actually running the search yourself. Instead, you are handing a complete search definition back to the system (via the data + search_summary). The system will only run the search AFTER the user answers your "search now or tweak filters first?" question and you set data.next_action based on their reply.

STEP 6 - QUICK MATCH (User directly asks for surfers/matches):
If user directly asks for surfers/matches (e.g. "send me surfers in El Salvador", "find me people who surfed in Sri Lanka", "show me matches for Costa Rica"):
1. Extract destination from their message (country, area if mentioned)
2. If 2+ filters (e.g. country + area, or country + country_from): set is_finished: true immediately, define the search, fill data (including search_summary), and wait for the user's decision.
3. If 1 filter only (e.g. country only, or only country_from like "send me an israeli surfer"): set is_finished: true in the SAME turn with search_summary. Do NOT ask a separate "Want to add anything else?" message. Include in search_summary optional "Want to add anything else or search now?" so they can add more or proceed.
4. Use purpose: { purpose_type: "connect_traveler", specific_topics: [] } when not specified.
5. Your return_message should describe what you’re about to search for in a friendly way, but MUST NOT claim that you are already searching or that you have already found options. The actual search only happens after the user confirms via the follow-up reply.

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
  "queryFilters": { "country_from": ["Israel"], "surfboard_type": ["shortboard"], "surf_level_category": ["advanced", "pro"], "age_min": 20, "age_max": 30 }, // Include when user specified origin, board type, level, or age. Use exact country names and enum values. When user says "around my age" or "same age", use USER PROFILE CONTEXT age and set age_min/age_max (e.g. age ±5). For a specific age (e.g. "25"), set age_min: 25, age_max: 25. For "above X" or "older than X" (e.g. "above 30"), set age_min: 30, age_max: 99. For "below X" or "younger than X" (e.g. "below 25"), set age_min: 18, age_max: 25.
  "search_summary": "Short casual summary of what we're searching for, shown to the user before they decide whether to search or edit filters. REQUIRED when is_finished is true. First, write a one-line friendly summary of the filters (e.g. \"Sweet so we're going for American dude that surfed Hawaii and is also a shortboarder just like you!\" or \"Got it — Israeli advanced shortboarder!\"). Then add a newline (\"\\n\") and a short question asking if they want to search now or tweak filters first (e.g. \"Are you ready for me to search now, or do you want to tweak any filters first?\"). Tone: friendly, first person, no markdown. Base it ONLY on the criteria (destination_country, area, queryFilters). Do NOT mention that there is no destination, no specific destination, or that we're going global — just describe the filters.",
  "next_action": "search" | "edit" | "clarify" | null // Optional. For the FIRST user reply after you asked whether to search or edit: set to \"search\" when they clearly want to search now, \"edit\" when they clearly want to change/tweak filters first, or \"clarify\" when their intent is ambiguous and you are asking a follow-up question.
}
Do NOT include non_negotiable_criteria or prioritize_filters in the data. When is_finished is true, ALWAYS set search_summary so the user sees what will be searched. Matching is by destination (country + optional area) and, when provided, by queryFilters (country_from, surfboard_type, surf_level_category). When the user specified criteria (e.g. "Israeli", "shortboard", "advanced"), include queryFilters in data so the system can filter matches.
CRITICAL - TEXT AND DATA MUST MATCH: Every filter or criterion you mention in return_message or search_summary MUST appear in data (either destination_country/area or a corresponding key in data.queryFilters). If you say "shortboarder", "from Israel", or "around your age", the matching field must be set in data.queryFilters (or destination/area). Do not describe a criterion in text without setting it in data.
For return_message and search_summary: when matching without a destination (only queryFilters), do NOT say \"no destination\", \"no specific destination\", \"going global\", or similar. Only mention the existing filters (e.g. \"Got you, bro — searching for an advanced Israeli shortboarder.\").

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
    "user_context": {},
    "search_summary": "Short casual summary of the search followed by a newline and a question asking if the user wants to search now or tweak filters first (REQUIRED when is_finished true)",
    "next_action": "search" | "edit" | "clarify" | null
  }
}

CRITICAL RULES:
- ALWAYS return valid JSON. NEVER return plain text.
- REMOVE ALL FILTERS: When the user says they want to remove all filters, clear all, wipe the slate, start fresh, or reset filters, you MUST set in the response data: queryFilters: null, destination_country: null, and area: null. Do not keep any previous destination or criteria. Example: User says "remove all filters" → data: { ..., queryFilters: null, destination_country: null, area: null, ... }.
- Set is_finished: true when: (a) User gave 2+ filters and you are ready to search, OR (b) User gave 1 filter — set is_finished: true in the SAME turn with search_summary (do not ask a separate "add anything else?" message), OR (c) Quick match: user asked for surfers and you extracted at least destination_country, OR (d) User asked for surfers with only criteria (e.g. country_from, age range) and no destination — then set is_finished: true with queryFilters and no destination_country for general matching. "search_summary": "Short casual summary of the surfer or trip we’re about to look for, shown to the user before they decide whether to search or edit filters. REQUIRED when is_finished is true. First, write a one-line friendly description based ONLY on the criteria (destination_country, area, queryFilters), for example: \"Sweet — an Israeli surfer who’s surfed Hawaii (US) and rides a shortboard just like you.\" or \"Got it — an advanced Israeli shortboarder around your age.\" Do NOT say \"searching for\" or imply that you already started searching. Then add a newline (\"\\n\") and a short question asking if they want to search now or tweak filters first (e.g. \"Are you ready for me to search now, or do you want to tweak any filters first?\"). Tone: friendly, first person, no markdown.",- DESTINATION EXTRACTION: When user mentions ANY location, extract destination_country immediately. Correct typos ("filipins" → "Philippines"). If they mention area too, extract both. NEVER set destination_country to null if a location was mentioned.
- return_message = conversational text only. All structured data goes in "data". No JSON or markdown in return_message.
- When there is no destination (general match): in return_message and search_summary, describe only the filters (e.g. \"Got you, bro — searching for an advanced Israeli shortboarder.\"). Do NOT mention \"no destination\", \"no specific destination\", or \"going global\".
- When you have already produced a search_summary that ends with a question like \"Are you ready for me to search now, or do you want to tweak any filters first?\" the VERY NEXT user reply should be interpreted as a decision:\n  - If they clearly want to SEARCH now (e.g. \"yes\", \"search\", \"send them\", \"looks good\"), set data.next_action = \"search\" and do not change the filters.\n  - If they clearly want to EDIT or CHANGE filters first (e.g. \"change the board\", \"make them older\", \"add Indo too\", \"I want to tweak the filters\"), set data.next_action = \"edit\" and describe in return_message how you'll help them edit; do NOT run matching yet.\n  - If their intent is ambiguous (e.g. \"maybe\", \"not sure\"), set data.next_action = \"clarify\" and respond with a short clarification question.\n  - On this VERY NEXT reply you are making a decision only: do NOT set data.search_summary again on this turn; only set data.next_action (and any other updated data fields) plus a short conversational return_message.
- Example (1 filter): {"return_message": "Got you — Costa Rica. Want to add anything else or search now?", "is_finished": true, "data": {"destination_country": "Costa Rica", "area": null, "search_summary": "Got you — Costa Rica. Want to add anything else or search now?", ...}}
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

function buildCurrentDataSystemMessage(currentData: {
  destination_country: string | null;
  area: string | null;
  queryFilters: Record<string, unknown> | null;
}): string {
  return `Current data for this turn (authoritative): ${JSON.stringify(currentData)}.\n\nCRITICAL: Do not change or add any filter, destination, area, or other criterion that is not explicitly mentioned in the user's current message below. Only update or add what the user asked for in this message. Leave everything else unchanged from the current data.`;
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
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.2,
      max_completion_tokens: 600, 
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
 * US states as stored in the database (destination_country values).
 * Must match OnboardingStep4Screen.tsx options so matching works correctly.
 */
const US_STATES = [
  'United States - Alabama', 'United States - Alaska', 'United States - Arizona', 'United States - Arkansas',
  'United States - California', 'United States - Colorado', 'United States - Connecticut', 'United States - Delaware',
  'United States - Florida', 'United States - Georgia', 'United States - Hawaii', 'United States - Idaho',
  'United States - Illinois', 'United States - Indiana', 'United States - Iowa', 'United States - Kansas',
  'United States - Kentucky', 'United States - Louisiana', 'United States - Maine', 'United States - Maryland',
  'United States - Massachusetts', 'United States - Michigan', 'United States - Minnesota', 'United States - Mississippi',
  'United States - Missouri', 'United States - Montana', 'United States - Nebraska', 'United States - Nevada',
  'United States - New Hampshire', 'United States - New Jersey', 'United States - New Mexico', 'United States - New York',
  'United States - North Carolina', 'United States - North Dakota', 'United States - Ohio', 'United States - Oklahoma',
  'United States - Oregon', 'United States - Pennsylvania', 'United States - Rhode Island', 'United States - South Carolina',
  'United States - South Dakota', 'United States - Tennessee', 'United States - Texas', 'United States - Utah',
  'United States - Vermont', 'United States - Virginia', 'United States - Washington', 'United States - West Virginia',
  'United States - Wisconsin', 'United States - Wyoming',
];

/**
 * Normalize destination_country/area when LLM returned "United States" + area that is a state name.
 * Converts to destination_country: "United States - StateName", area: null so matching uses state-level DB values.
 */
function normalizeUSDestination(data: { destination_country?: string | null; area?: string | null }): void {
  if (!data || typeof data !== 'object') return
  const country = data.destination_country != null ? String(data.destination_country).trim() : ''
  const area = data.area != null ? String(data.area).trim() : ''
  if (!area) return
  const countryLower = country.toLowerCase()
  if (countryLower !== 'united states' && countryLower !== 'usa' && countryLower !== 'us') return
  const areaLower = area.toLowerCase()
  const matched = US_STATES.find((s) => {
    const suffix = s.replace(/^United States - /i, '')
    return suffix.toLowerCase() === areaLower
  })
  if (matched) {
    data.destination_country = matched
    data.area = null
  }
}

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

  // Normalize single age or age_range into age_min/age_max (filtering only uses age_min/age_max)
  if (typeof normalized.age === 'number' && (normalized.age_min === undefined || normalized.age_max === undefined)) {
    normalized.age_min = normalized.age;
    normalized.age_max = normalized.age;
    delete normalized.age;
    console.log(`✅ Normalized queryFilters: single age → age_min/age_max: ${normalized.age_min}`);
  }
  if (Array.isArray(normalized.age_range) && normalized.age_range.length > 0) {
    const nums = normalized.age_range.filter((x: unknown) => typeof x === 'number') as number[];
    if (nums.length === 2) {
      normalized.age_min = Math.min(nums[0], nums[1]);
      normalized.age_max = Math.max(nums[0], nums[1]);
    } else if (nums.length === 1) {
      normalized.age_min = nums[0];
      normalized.age_max = nums[0];
    }
    if (nums.length >= 1) {
      delete normalized.age_range;
      console.log(`✅ Normalized queryFilters: age_range → age_min=${normalized.age_min}, age_max=${normalized.age_max}`);
    }
  }

  return normalized;
}

/**
 * Ensure response data always exposes filters as queryFilters (client and find-matches expect this).
 * If the LLM or merge put filters under query_filters, normalize once so the client receives queryFilters.
 */
function ensureResponseDataQueryFilters(data: any): any {
  if (!data || typeof data !== 'object') return data
  const q = data.queryFilters ?? data.query_filters ?? null
  return { ...data, queryFilters: q }
}

/**
 * Second-layer check: ensure every filter described in the text is correctly represented in the JSON.
 * Calls a small GPT request to derive corrected queryFilters (and destination/area if relevant) from the text and current data.
 * Returns null on any error or invalid output (caller keeps current filters).
 */
async function reconcileQueryFiltersFromText(
  textMessage: string,
  searchSummary: string | null | undefined,
  currentData: { queryFilters?: any; destination_country?: string; area?: string },
  userAge?: number,
): Promise<{ queryFilters?: any; destination_country?: string; area?: string } | null> {
  try {
    const text = [textMessage?.trim(), searchSummary?.trim()].filter(Boolean).join('\n')
    if (!text || text.length < 10) return null
    if (!OPENAI_API_KEY) return null

    const currentJson = JSON.stringify({
      queryFilters: currentData.queryFilters ?? null,
      destination_country: currentData.destination_country ?? null,
      area: currentData.area ?? null,
    })
    const userAgeLine = userAge != null ? `\nCurrent user age (use for "around my age"): ${userAge}. For "around my age" set age_min: ${Math.max(0, userAge - 5)}, age_max: ${userAge + 5}.` : ''

    const systemPrompt = `You are a filter checker. You will receive the exact text the user will see, and the current JSON for queryFilters and destination. Your job is to output a single JSON object that correctly represents filter criteria mentioned in the text.

Rules:
- queryFilters: object with optional keys: country_from (array of official country names), age_min (number), age_max (number), surfboard_type (array: shortboard, mid_length, longboard, soft_top), surf_level_category (string or array: beginner, intermediate, advanced, pro).
- Use official country names (e.g. "United States" not "USA", "Israel" not "Israeli" for country_from).
- For age: "under 20" or "13-19" → age_min: 13, age_max: 19; "over 30" → age_min: 30; single age (e.g. "25") → age_min: X, age_max: X (same number); "around my age" with user age given → age_min: age-5, age_max: age+5.
- If the text describes a destination, include destination_country and optionally area.
- Only include in queryFilters keys that are already present in the Current JSON. Do not add new keys. Only fix or fill values for existing keys so the JSON matches the text. If the text mentions a criterion that has no key in Current JSON, omit it from your output.
- Output ONLY a valid JSON object with keys queryFilters (object), and optionally destination_country (string) and area (string). No markdown, no explanation.`
    const userPrompt = `Text the user will see:\n${text}\n\nCurrent JSON:\n${currentJson}${userAgeLine}\n\nOutput the complete corrected JSON object (queryFilters and destination_country/area if applicable). Return only valid JSON.`

    const currentDataForTurn = {
      destination_country: currentData.destination_country ?? null,
      area: currentData.area ?? null,
      queryFilters: currentData.queryFilters != null && typeof currentData.queryFilters === 'object' ? currentData.queryFilters as Record<string, unknown> : null,
    }
    const currentDataSystemMessage = buildCurrentDataSystemMessage(currentDataForTurn)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: currentDataSystemMessage },
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
    })
    if (!response.ok) {
      console.warn('[reconcileQueryFiltersFromText] OpenAI request failed:', response.status)
      return null
    }
    const data = await response.json()
    let raw = data.choices?.[0]?.message?.content?.trim() || ''
    if (!raw) return null
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlock) raw = codeBlock[1].trim()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const hasQueryFilters = parsed.queryFilters && typeof parsed.queryFilters === 'object'
    const hasDestination = parsed.destination_country && String(parsed.destination_country).trim()
    if (!hasQueryFilters && !hasDestination) return null

    const result: { queryFilters?: any; destination_country?: string; area?: string } = {}
    if (hasQueryFilters) {
      result.queryFilters = await normalizeQueryFilters(parsed.queryFilters)
    }
    if (hasDestination) {
      result.destination_country = String(parsed.destination_country).trim()
      result.area = parsed.area != null ? String(parsed.area).trim() : undefined
      const forNorm = { destination_country: result.destination_country, area: result.area || null }
      normalizeUSDestination(forNorm)
      result.destination_country = forNorm.destination_country ?? result.destination_country
      result.area = forNorm.area ?? result.area
    }
    return result
  } catch (e) {
    console.warn('[reconcileQueryFiltersFromText] Error:', e)
    return null
  }
}

/**
 * Call GPT for a short acknowledgment after the user removes a filter in the UI.
 * Returns plain text (one or two sentences) or null on error.
 */
async function getFilterRemovalAcknowledgment(requestData: any, removedFilterLabel?: string): Promise<string | null> {
  try {
    if (!OPENAI_API_KEY) return null
    const json = JSON.stringify({
      queryFilters: requestData?.queryFilters ?? null,
      destination_country: requestData?.destination_country ?? null,
      area: requestData?.area ?? null,
    })
    const removed = removedFilterLabel?.trim() || 'a filter'
    const systemPrompt = 'You are Swelly, a friendly surfer buddy. The user just removed a filter in the app. Reply with one or two short sentences: acknowledge what was removed, list their current filters in one line, then ask if they want to search or tweak. First person, casual, no markdown. Max 2 sentences. Do not add or change any filter; only acknowledge the removal and list the current filters.'
    const userPrompt = `The user removed: ${removed}. Current requestData: ${json}. Reply with a short acknowledgment and current filters.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.3,
        max_tokens: 150,
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    let raw = data.choices?.[0]?.message?.content?.trim() || ''
    if (!raw) return null
    return raw.replace(/^["']|["']$/g, '').trim()
  } catch (e) {
    console.warn('[getFilterRemovalAcknowledgment] Error:', e)
    return null
  }
}

/** Sentinel: when extracted has this for an array key, clear that filter (e.g. "any board"). */
const QUERY_FILTER_CLEAR = '__clear__'

/**
 * Merge existing queryFilters with newly extracted ones (additive: union arrays, scalars use extracted or keep existing).
 * Used when user taps "Add Filter" and sends a follow-up message.
 */
function mergeQueryFiltersAdding(existing: any, extracted: any): any {
  if (!existing || typeof existing !== 'object') {
    return extracted && typeof extracted === 'object' ? { ...extracted } : {}
  }
  const merged = { ...existing }
  if (!extracted || typeof extracted !== 'object') {
    return merged
  }
  const arrayKeys = ['country_from', 'surfboard_type', 'surf_level_category'] as const
  for (const key of arrayKeys) {
    const ext = extracted[key]
    if (ext === null || ext === QUERY_FILTER_CLEAR || (Array.isArray(ext) && ext.length === 0)) {
      delete merged[key]
      continue
    }
    const existingArr = Array.isArray(merged[key]) ? merged[key] : (merged[key] != null ? [merged[key]] : [])
    const extractedArr = Array.isArray(ext) ? ext : (ext != null ? [ext] : [])
    const combined = [...existingArr, ...extractedArr]
    const unique = Array.from(new Set(combined.map((x: any) => String(x).trim()).filter(Boolean)))
    if (unique.length > 0) {
      merged[key] = unique
    } else {
      delete merged[key]
    }
  }
  if (typeof extracted.age_min === 'number') merged.age_min = extracted.age_min
  else if (extracted.age_min === null || extracted.age_min === QUERY_FILTER_CLEAR) delete merged.age_min
  if (typeof extracted.age_max === 'number') merged.age_max = extracted.age_max
  else if (extracted.age_max === null || extracted.age_max === QUERY_FILTER_CLEAR) delete merged.age_max
  return merged
}

/**
 * Merge existing queryFilters with extracted ones using per-category intent (add / replace / clear).
 * Used when user is editing filters and extractor returned filterEditIntent.
 */
function mergeQueryFiltersEditing(
  existing: any,
  extracted: any,
  intent: Record<string, 'add' | 'replace' | 'clear'>
): any {
  if (!existing || typeof existing !== 'object') {
    return extracted && typeof extracted === 'object' ? { ...extracted } : {}
  }
  const merged = { ...existing }
  if (!intent || typeof intent !== 'object') {
    return mergeQueryFiltersAdding(existing, extracted)
  }
  const arrayKeys = ['country_from', 'surfboard_type', 'surf_level_category'] as const
  for (const key of arrayKeys) {
    const intentVal = intent[key]
    if (intentVal === 'clear') {
      delete merged[key]
      continue
    }
    const ext = extracted[key]
    if (ext === null || ext === QUERY_FILTER_CLEAR || (Array.isArray(ext) && ext.length === 0)) {
      delete merged[key]
      continue
    }
    if (intentVal === 'replace') {
      const extractedArr = Array.isArray(ext) ? ext : (ext != null ? [ext] : [])
      const unique = Array.from(new Set(extractedArr.map((x: any) => String(x).trim()).filter(Boolean)))
      if (unique.length > 0) merged[key] = unique
      else delete merged[key]
      continue
    }
    // add (default)
    const existingArr = Array.isArray(merged[key]) ? merged[key] : (merged[key] != null ? [merged[key]] : [])
    const extractedArr = Array.isArray(ext) ? ext : (ext != null ? [ext] : [])
    const combined = [...existingArr, ...extractedArr]
    const unique = Array.from(new Set(combined.map((x: any) => String(x).trim()).filter(Boolean)))
    if (unique.length > 0) merged[key] = unique
    else delete merged[key]
  }
  // age: treat as replace when intent is replace or clear; otherwise add/overwrite
  const ageIntent = intent.age_min ?? intent.age_max
  if (ageIntent === 'clear') {
    delete merged.age_min
    delete merged.age_max
  } else {
    if (typeof extracted.age_min === 'number') merged.age_min = extracted.age_min
    else if (extracted.age_min === null || extracted.age_min === QUERY_FILTER_CLEAR) delete merged.age_min
    if (typeof extracted.age_max === 'number') merged.age_max = extracted.age_max
    else if (extracted.age_max === null || extracted.age_max === QUERY_FILTER_CLEAR) delete merged.age_max
  }
  return merged
}

/**
 * Merge destination strings (e.g. existing "Sri Lanka" + model "Indonesia" -> "Sri Lanka, Indonesia").
 * Used in add-filter mode so adding another "surfed in X" updates destination_country correctly.
 */
function mergeDestinations(existing: string | null | undefined, ...sources: (string | null | undefined)[]): string | null {
  const parts: string[] = []
  const add = (s: string | null | undefined) => {
    if (s == null || String(s).trim() === '') return
    for (const p of String(s).split(',').map((x: string) => x.trim()).filter(Boolean)) {
      parts.push(p)
    }
  }
  add(existing)
  for (const src of sources) add(src)
  const seen = new Set<string>()
  const unique: string[] = []
  for (const p of parts) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(p)
  }
  return unique.length > 0 ? unique.join(', ') : null
}

/**
 * Use LLM to convert user's natural language request into Supabase query filters.
 * When existingQueryFilters is provided (edit mode), the LLM must also return filterEditIntent and intentUnclear.
 */
async function extractQueryFilters(
  userMessage: string,
  destinationCountry: string,
  conversationHistory: Message[],
  existingQueryFilters?: any,
  userProfile?: { age?: number } | null
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
  filterEditIntent?: Record<string, 'add' | 'replace' | 'clear'>; // Only when existingQueryFilters provided
  intentUnclear?: string[]; // Only when existingQueryFilters provided and intent is ambiguous
}> {
  const isEditingMode = existingQueryFilters != null && typeof existingQueryFilters === 'object'
  const userAgeLine = userProfile?.age != null
    ? `Current user's age from profile: ${userProfile.age}. When the user says "around my age" or "similar age", set age_min: ${Math.max(0, userProfile.age - 5)}, age_max: ${userProfile.age + 5} (or a sensible range).\n`
    : ''

  const editingModePrompt = isEditingMode
    ? `
EDITING MODE – You are editing existing search filters. Current filters: ${JSON.stringify(existingQueryFilters)}

Interpret the user's message per filter category:
- ADD (keep existing + add): "also X", "add X", "and X" → output new value(s), set filterEditIntent for that key to "add".
- REPLACE (only this): "only X", "just X", "change to X", "X only", "I meant X" → output new value(s), set filterEditIntent to "replace".
- CLEAR (remove category): "any X", "no X preference", "don't care", "all X", "remove X" → output [] or omit key, set filterEditIntent to "clear".

If the user names a value for a category that already has values and does NOT use clear add/replace/clear wording, set that category in "intentUnclear" and do not assume add or replace.

When the user adds another "surfed in X" / "add destination X" (e.g. "add someone who surfed Indonesia"), return that country in destination_days_min.destination (use a sensible min_days if inferrable, else 1) so the backend can merge it with the existing destination.

Your response MUST include:
- "filterEditIntent": object with one key per category you touched (e.g. surfboard_type, surf_level_category, country_from): value "add" | "replace" | "clear".
- "intentUnclear": array of category keys (e.g. ["surfboard_type"]) when intent is ambiguous; otherwise [].

Examples:
- Current surfboard_type: ["longboard"]. User: "Also shortboard" → add → surfboard_type ["longboard","shortboard"], filterEditIntent.surfboard_type "add".
- Current surfboard_type: ["longboard"]. User: "Only shortboard" → replace → surfboard_type ["shortboard"], filterEditIntent.surfboard_type "replace".
- Current surfboard_type: ["longboard"]. User: "Any board" → clear → omit surfboard_type or [], filterEditIntent.surfboard_type "clear".
- Current surfboard_type: ["longboard"]. User: "Shortboard" (no also/only) → intentUnclear: ["surfboard_type"].

`
    : ''

  const schemaPrompt = `${editingModePrompt}You are a database query expert. Analyze the user's request and determine which Supabase filters to apply. Only extract criteria explicitly mentioned in the current user message; do not infer or add criteria from elsewhere.

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
  ⚠️ US DESTINATION: When user wants to go to a US state, use destination_country: "United States - StateName" (e.g. "United States - California", "United States - Hawaii"). Set area only if they mention a specific place within that state (e.g. "San Diego, California" → destination_country: "United States - California", area: "San Diego").
  ⚠️ Examples:
    - User says "I want to go to California" → destination_country: "United States - California", area: null, country_from: NOT SET (user didn't say they want surfers FROM United States)
    - User says "San Diego, California" → destination_country: "United States - California", area: "San Diego", country_from: NOT SET
    - User says "I want surfers from the USA" → country_from: ["United States"] (normalized from "USA" to "United States")
    - User says "I want to go to Costa Rica and connect with surfers from Israel" → destination_country: "Costa Rica", country_from: ["Israel"]
- age_min (number), age_max (number): Use BOTH for any age filter. For a single specific age X (e.g. "25 years old", "someone who is 25") set age_min: X, age_max: X. For ranges use age_min and age_max (e.g. 18-30 → age_min: 18, age_max: 30).
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
${userAgeLine}- If user says "similar age" and you know their age (e.g., 25), infer ±5 years → age_min: 20, age_max: 30
- If user says a specific age (e.g. "25", "someone who is 25", "25 years old") → age_min: 25, age_max: 25
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
  "explanation": "Brief explanation of what filters were extracted and what couldn't be mapped"${isEditingMode ? `,
  "filterEditIntent": { "surfboard_type": "add" },
  "intentUnclear": []` : ''}
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
   - destination_country = WHERE THE USER WANTS TO GO. For US states use "United States - StateName" (e.g. "California" → destination_country: "United States - California", area: null)
   - country_from = WHERE THE SURFER IS FROM (origin country) - ONLY set if user explicitly requests it
   - If user says "I want to go to California" → destination_country: "United States - California", area: null, country_from: NOT SET
   - If user says "I want surfers from the USA" → country_from: ["United States"]
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
   - Specific age: "25 years old" or "someone who is 25" or "age 25" → age_min: 25, age_max: 25
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
    // Use gpt-4o-mini for filter extraction (faster, sufficient for structured JSON) to reduce latency
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set')
    }
    const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
    })
    if (!extractRes.ok) {
      const errText = await extractRes.text()
      throw new Error(`OpenAI API error: ${extractRes.status} - ${errText}`)
    }
    const extractData = await extractRes.json()
    llmResponse = extractData.choices?.[0]?.message?.content || ''
    
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
    
    if (isEditingMode) {
      if (!extracted.filterEditIntent || typeof extracted.filterEditIntent !== 'object') extracted.filterEditIntent = {}
      if (!Array.isArray(extracted.intentUnclear)) extracted.intentUnclear = []
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
      explanation: 'Failed to extract filters from user message',
      ...(isEditingMode ? { filterEditIntent: {}, intentUnclear: [] } : {})
    }
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
  // Order is intentional (chronological append order). Do not reorder; GET and PATCH callers rely on array index.

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
  // Debug: actionRow.requestData per message (for filter-removal debugging)
  console.log('[getChatHistory] Total messages:', messages.length)
  messages.forEach((msg: any, idx: number) => {
    const ar = msg.metadata?.actionRow?.requestData
    if (ar != null) {
      const qf = ar?.queryFilters
      const qfKeys = qf && typeof qf === 'object' ? Object.keys(qf).join(',') : 'n/a'
      console.log('[getChatHistory] msg', idx, 'role=', msg.role, 'actionRow.requestData: queryFilters keys=[' + qfKeys + '] destination_country=', ar?.destination_country, 'area=', ar?.area)
    }
  })
  
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
        'Access-Control-Allow-Methods': 'POST, GET, PATCH, OPTIONS',
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
        { role: 'system', content: 'This is the FIRST message in a NEW conversation. If the user\'s message clearly asks for surfers or matches and includes criteria (e.g. "Israeli", "shortboard", "advanced") and/or a destination (e.g. "El Salvador"), treat it as their real request: extract destination if mentioned, extract criteria if mentioned, and only ask for what is missing (e.g. "Which destination do you want to connect with surfers who\'ve been there? (e.g. El Salvador, Costa Rica)"). If their message is vague or just a greeting, respond with ONLY this exact sentence and nothing else: "Yo! Let\'s get you connected! So what are we looking for today?" Do not add any other sentence or question after it.' },
        { role: 'user', content: body.message }
      ]

      // Add JSON format reminder
      const jsonFormatReminder = `CRITICAL: You MUST return a valid JSON object. Your response must start with { and end with }. Do NOT return plain text.`
      messages.splice(messages.length - 1, 0, { role: 'system', content: jsonFormatReminder })

      // Attach current data and "do not change/add" rule (new chat: empty state)
      const currentDataForGPT = { destination_country: null as string | null, area: null as string | null, queryFilters: null as Record<string, unknown> | null }
      messages.splice(messages.length - 1, 0, { role: 'system', content: buildCurrentDataSystemMessage(currentDataForGPT) })

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
            queryFilters: parsed.queryFilters ?? parsed.query_filters ?? null,
          }
        }
        if (tripPlanningData && typeof tripPlanningData === 'object') {
          normalizeUSDestination(tripPlanningData)
        }
        
        // Second-layer check: reconcile text vs JSON filters (new_chat)
        const newChatHasFilters = tripPlanningData && (() => {
          const q = tripPlanningData.queryFilters
          const hasQF = q && typeof q === 'object' && Object.keys(q).length > 0
          const hasDest = tripPlanningData.destination_country && String(tripPlanningData.destination_country).trim()
          return hasQF || !!hasDest
        })()
        const newChatHasText = (returnMessage?.trim() || tripPlanningData?.search_summary?.trim()) || ''
        if (parsed.is_finished && newChatHasFilters && newChatHasText) {
          try {
            console.log('[reconcileQueryFiltersFromText] Running text-vs-JSON reconciliation (new_chat)')
            const reconciled = await reconcileQueryFiltersFromText(
              returnMessage || '',
              tripPlanningData?.search_summary,
              tripPlanningData,
              userProfile?.age,
            )
            if (reconciled) {
              if (reconciled.queryFilters != null) {
                const allowedKeys = new Set(Object.keys(tripPlanningData.queryFilters || {}))
                const filtered: Record<string, any> = {}
                for (const key of Object.keys(reconciled.queryFilters)) {
                  if (allowedKeys.has(key)) filtered[key] = reconciled.queryFilters[key]
                }
                const isEmpty = Object.keys(filtered).length === 0
                if (!isEmpty) {
                  tripPlanningData.queryFilters = filtered
                  console.log('[reconcileQueryFiltersFromText] Updated queryFilters from text (new_chat); keys:', Object.keys(filtered))
                }
              }
              if (reconciled.destination_country != null) {
                tripPlanningData.destination_country = reconciled.destination_country
                if (reconciled.area !== undefined) tripPlanningData.area = reconciled.area
                console.log('[reconcileQueryFiltersFromText] Updated destination_country/area from text (new_chat)')
              }
            }
          } catch (e) {
            console.warn('[reconcileQueryFiltersFromText] Reconciliation failed (new_chat), keeping current filters:', e)
          }
        }
        
        parsedResponse = {
          chat_id: chatId,
          return_message: FIXED_FIRST_MESSAGE,
          is_finished: parsed.is_finished || false,
          data: ensureResponseDataQueryFilters(tripPlanningData) ?? null
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

      // --- UI Messages: create initial bot message ---
      const uiMessages: UIMessage[] = []
      appendUIMessage(uiMessages, {
        type: 'bot_text',
        text: parsedResponse.return_message,
        timestamp: makeTimestamp(),
        is_user: false,
        backend_message_index: messages.length - 1,
      })
      await saveUIMessages(chatId, uiMessages, supabaseAdmin)

      const responsePayload = { ...parsedResponse, message_index: messages.length - 1 }
      return new Response(
        JSON.stringify(responsePayload),
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

      // Get chat history and user profile in parallel (saves one round-trip)
      const [historyMessages, profileResult] = await Promise.all([
        getChatHistory(chatId, supabaseAdmin),
        (async () => {
          try {
            const { data, error } = await supabaseAdmin
              .from('surfers')
              .select('country_from, surf_level, age, surfboard_type, travel_experience')
              .eq('user_id', user.id)
              .single()
            return { data, error }
          } catch (e) {
            return { data: null, error: e }
          }
        })(),
      ])
      let messages = historyMessages

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

      // User profile for destination discovery flow (already fetched above)
      let userProfile: any = null
      if (!profileResult.error && profileResult.data) {
        userProfile = profileResult.data
        console.log('✅ Fetched user profile for destination discovery:', userProfile)
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

      // Self-healing: ensure synthetic messages exist if a match action was taken but the PATCH
      // hasn't completed yet (race condition between updateMatchActionSelection and user typing)
      for (let i = messages.length - 1; i >= 0; i--) {
        const actionRow = messages[i].metadata?.actionRow
        if (actionRow?.selectedAction && messages[i].metadata?.matchedUsers) {
          const hasSyntheticAfter = messages.slice(i + 1).some(
            m => m.metadata?.isRestartAfterNewChat || m.metadata?.isAddFilterPrompt
          )
          if (!hasSyntheticAfter) {
            if (actionRow.selectedAction === 'new_chat') {
              messages.splice(i + 1, 0, {
                role: 'assistant',
                content: TRIP_PLANNING_FIRST_QUESTION_TEXT,
                metadata: { isRestartAfterNewChat: true }
              })
              console.log('[continueConversation] Self-heal: inserted missing restart message after index', i)
            } else if (actionRow.selectedAction === 'add_filter') {
              messages.splice(i + 1, 0, {
                role: 'assistant',
                content: "Great! We can add some filters to your search. What would you like to add? For example: board type, surf level, destinations they've surfed, age, or country of origin.",
                metadata: { isAddFilterPrompt: true, existingFiltersData: actionRow.requestData ?? null }
              })
              console.log('[continueConversation] Self-heal: inserted missing add-filter message after index', i)
            }
          }
          break // only check the most recent match action
        }
      }

      // Add new user message
      messages.push({ role: 'user', content: body.message })
      
      // When adding filters, inject context so LLM interprets "also X" / "any X" correctly
      if (body.adding_filters && body.existing_query_filters && typeof body.existing_query_filters === 'object') {
        const filterSummary = JSON.stringify(body.existing_query_filters)
        let addFilterContent = `The user is adding to existing search filters. Current filters: ${filterSummary}. Interpret their message as additional or broadening criteria (e.g. "also longboard" = add longboard; "any board" or "all boards" = remove board filter).`
        if (body.existing_destination_country != null && String(body.existing_destination_country).trim() !== '') {
          addFilterContent += ` Current destination: ${body.existing_destination_country}. If the user adds another destination (e.g. "add Indonesia", "surfed Indo too"), include ALL destinations in data.destination_country as a comma-separated string (e.g. "Sri Lanka, Indonesia").`
        }
        messages.splice(messages.length - 1, 0, {
          role: 'system',
          content: addFilterContent
        })
      }
      
      // Check if user mentioned a destination - if so, remind AI to use A, not STEP 2B
      const currentUserMessageLower = body.message.toLowerCase()
      const step2aDestinationKeywords = [
        'costa rica', 'sri lanka', 'indonesia', 'philippines', 'philippins', 'filipins',
        'portugal', 'spain', 'france', 'morocco', 'brazil', 'australia', 'mexico',
        'nicaragua', 'panama', 'el salvador', 'peru', 'chile', 'ecuador',
        'bali', 'siargao', 'tamarindo', 'pavones', 'ericeira', 'taghazout',
        'maldives', 'fiji', 'maldives', 'seychelles'
      ]
      
      const hasStep2aDestinationMention = step2aDestinationKeywords.some(keyword => currentUserMessageLower.includes(keyword))
      
      // if (hasStep2aDestinationMention) {
      //   // Check if we're still in STEP 1 or early in conversation
      //   const assistantMessages = messages.filter(m => m.role === 'assistant')
      //   const isEarlyConversation = assistantMessages.length <= 2
        
      //   if (isEarlyConversation) {
      //     const step2Reminder = `CRITICAL: The user just mentioned a destination (${body.message}). Extract the destination_country immediately, ask about area if needed, then go to STEP 3 (Clarify Purpose).`
      //     messages.splice(messages.length - 1, 0, { role: 'system', content: step2Reminder })
      //   }
      // }
      
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
      let filterResult: { supabaseFilters: any; unmappableCriteria?: string[]; explanation?: string; filterEditIntent?: Record<string, 'add' | 'replace' | 'clear'>; intentUnclear?: string[] } | null = null

      // --- PRE-COMPUTATION: everything that does NOT depend on filter extraction ---

      // Get destination from conversation history (needed by both extractQueryFilters and main LLM)
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
      const existingForExtractor = body.adding_filters && body.existing_query_filters && typeof body.existing_query_filters === 'object' ? body.existing_query_filters : undefined

      // Compute accumulated filters from previous messages (does NOT depend on extraction)
      let accumulatedFilters: any = null
      let accumulatedFromMessage: 'metadata' | 'content' | null = null
      try {
        const startIdx = Math.max(0, messages.length - 2)
        console.log('[accumulatedFilters] Scanning messages from index', startIdx, 'down to 0 (total messages:', messages.length, ')')
        for (let i = messages.length - 2; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            const msg = messages[i] as any
            const meta = msg.metadata
            const actionRow = meta?.actionRow
            const requestData = actionRow?.requestData
            const fromMetadata = requestData?.queryFilters
            console.log('[accumulatedFilters] msg i=' + i + ' hasMetadata=' + !!meta + ' hasActionRow=' + !!actionRow + ' hasRequestData=' + !!requestData + ' queryFilters=' + (fromMetadata === undefined ? 'undefined' : typeof fromMetadata))
            if (fromMetadata !== undefined && fromMetadata !== null) console.log('[accumulatedFilters] msg i=' + i + ' queryFilters value:', JSON.stringify(fromMetadata))
            // Prefer metadata: use requestData.queryFilters if present (object = filters; null = user cleared them)
            if (requestData != null && typeof requestData === 'object' && 'queryFilters' in requestData) {
              accumulatedFilters = typeof fromMetadata === 'object' && fromMetadata !== null ? fromMetadata : null
              accumulatedFromMessage = 'metadata'
              console.log('[accumulatedFilters] Using filters from metadata (msg i=' + i + '):', accumulatedFilters == null ? 'null' : JSON.stringify(accumulatedFilters, null, 2))
              break
            }
            try {
              const prevParsed = JSON.parse(msg.content)
              // Content: accept explicit queryFilters including null (ack after filter removal)
              if (prevParsed.data && 'queryFilters' in prevParsed.data) {
                accumulatedFilters = prevParsed.data.queryFilters ?? null
                accumulatedFromMessage = 'content'
                console.log('[accumulatedFilters] Using filters from content (msg i=' + i + '):', accumulatedFilters == null ? 'null' : JSON.stringify(accumulatedFilters, null, 2))
                break
              }
            } catch (e) {
              // Not JSON, continue
            }
          }
        }
        console.log('[accumulatedFilters] After loop: accumulatedFilters=' + (accumulatedFilters ? JSON.stringify(accumulatedFilters) : 'null') + ' source=' + accumulatedFromMessage)
      } catch (error) {
        console.error('[accumulatedFilters] Error:', error)
      }

      // Detect "remove all filters" / "clear all" etc. so we don't re-apply accumulated filters
      const userMessageNorm = (body.message || '').trim().toLowerCase()
      const removeAllPhrases = ['remove all filters', 'clear all', 'clear all filters', 'wipe', 'wipe the slate', 'reset', 'reset filters', 'start fresh', 'remove everything', 'clear everything', 'wipe the slate clean']
      const userRequestedRemoveAll = removeAllPhrases.some(phrase => userMessageNorm.includes(phrase))

      // Compute continueDestination/continueArea from last assistant message (does NOT depend on extraction)
      let continueDestination: string | null = null
      let continueArea: string | null = null
      for (let i = messages.length - 2; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          try {
            const prevParsed = JSON.parse(messages[i].content)
            if (prevParsed.data) {
              if ('destination_country' in prevParsed.data) continueDestination = prevParsed.data.destination_country
              if ('area' in prevParsed.data) continueArea = prevParsed.data.area
            }
            break
          } catch (_e) { /* not JSON */ }
        }
      }

      // Filter out synthetic display-only messages (restart markers, add-filter prompts) — they would confuse GPT
      const isSyntheticMessage = (m: any) => m.metadata?.isRestartAfterNewChat || m.metadata?.isAddFilterPrompt
      const messagesWithoutSynthetic = messages.filter(m => !isSyntheticMessage(m))

      // Snapshot messages before injecting system messages — extractQueryFilters
      // uses .slice(-5) and must not see the injected helper instructions.
      const messagesForExtractor = [...messagesWithoutSynthetic]

      // --- Inject system messages for the main LLM (none depend on extraction) ---

      // Check if user message contains a destination mention and remind LLM to extract it
      const userMessageLower = body.message.toLowerCase()
      const destinationKeywords = ['philippines', 'philippins', 'filipins', 'filipines', 'siargao', 'el salvador', 'costa rica', 'sri lanka', 'indonesia', 'portugal', 'spain', 'france', 'brazil', 'australia', 'nicaragua', 'panama', 'mexico', 'peru', 'chile', 'bali', 'tamarindo', 'pavones', 'el tunco']
      const hasDestinationMention = destinationKeywords.some(keyword => userMessageLower.includes(keyword))

      if (hasDestinationMention) {
        const destinationReminder = `CRITICAL REMINDER: The user just mentioned a destination location. You MUST extract destination_country in your response's "data" field. If they mentioned both area and country (e.g., "Siargao, filipins"), extract BOTH: destination_country: "Philippines", area: "Siargao". Correct typos automatically - "filipins" means "Philippines". NEVER set destination_country to null if a location was mentioned!`
        messages.splice(messages.length - 1, 0, { role: 'system', content: destinationReminder })
        console.log('📍 Added destination extraction reminder for LLM')
      }

      // Add a final reminder to return JSON format
      const jsonFormatReminder = `CRITICAL: You MUST return a valid JSON object. Your response must start with { and end with }. Do NOT return plain text. The structure must be: {"return_message": "...", "is_finished": false, "data": {...}}. If you return plain text, the system will fail!`
      messages.splice(messages.length - 1, 0, { role: 'system', content: jsonFormatReminder })

      // Static unmappable criteria guidance (replaces the dynamic injection that depended on extraction results)
      messages.splice(messages.length - 1, 0, { role: 'system', content: 'If the user mentions any criteria that cannot be mapped to database fields (physical appearance, personality traits, etc.), silently proceed with the criteria you CAN handle (country, age, surf level, board type, destination experience). Do not explain filtering limitations.' })

      // Build current data with accumulated filters (not yet-extracted ones — those get merged in post-processing)
      const currentDataForGPTContinue = {
        destination_country: continueDestination,
        area: continueArea,
        queryFilters: accumulatedFilters && typeof accumulatedFilters === 'object' ? accumulatedFilters as Record<string, unknown> : null
      }
      messages.splice(messages.length - 1, 0, { role: 'system', content: buildCurrentDataSystemMessage(currentDataForGPTContinue) })
      console.log('📋 Injected current data + do-not-change/add rule into main GPT')

      // --- PARALLEL LLM CALLS: extractQueryFilters + main callOpenAI ---
      // Filter synthetic display-only messages from the messages array used for OpenAI
      const messagesForOpenAI = messages.filter(m => !isSyntheticMessage(m))
      const [filterExtractionSettled, mainLLMResult] = await Promise.all([
        // Call 1: Extract structured filters from user message
        (async () => {
          try {
            const result = await extractQueryFilters(body.message, destinationCountry, messagesForExtractor, existingForExtractor, userProfile)
            return { success: true as const, result }
          } catch (error) {
            console.error('❌ Error extracting query filters:', error)
            return { success: false as const, result: null }
          }
        })(),
        // Call 2: Main conversational LLM
        callOpenAI(messagesForOpenAI),
      ])

      // --- POST-PROCESS filter extraction results ---
      if (filterExtractionSettled.success && filterExtractionSettled.result) {
        filterResult = filterExtractionSettled.result
        extractedQueryFilters = filterResult.supabaseFilters
        unmappableCriteria = filterResult.unmappableCriteria || []
        console.log('✅ Extracted query filters:', JSON.stringify(extractedQueryFilters, null, 2))
        console.log('✅ Filter extraction explanation:', filterResult.explanation)
        if (unmappableCriteria.length > 0) {
          console.log('⚠️ Unmappable criteria found:', unmappableCriteria)
        }
      }

      if (userRequestedRemoveAll) {
        extractedQueryFilters = null
        console.log('📦 User requested remove all filters – extractedQueryFilters set to null, will not re-apply accumulated')
      }

      // Merge current filters with accumulated filters (current takes precedence)
      console.log('[accumulatedFilters] Before merge: extractedQueryFilters=' + (extractedQueryFilters ? JSON.stringify(extractedQueryFilters) : 'null') + ' accumulatedFilters=' + (accumulatedFilters ? JSON.stringify(accumulatedFilters) : 'null'))
      if (accumulatedFilters && extractedQueryFilters) {
        extractedQueryFilters = {
          ...accumulatedFilters,
          ...extractedQueryFilters, // Current filters override accumulated ones
        }
        console.log('🔄 Merged filters (accumulated + current):', JSON.stringify(extractedQueryFilters, null, 2))
      } else if (accumulatedFilters && !extractedQueryFilters && !userRequestedRemoveAll) {
        extractedQueryFilters = accumulatedFilters
        console.log('📦 Using accumulated filters only:', JSON.stringify(extractedQueryFilters, null, 2))
      } else if (accumulatedFilters === null && accumulatedFromMessage != null) {
        extractedQueryFilters = null
        console.log('📦 Cleared filters (user removed filters in previous message)')
      }

      // When editing filters, if intent is ambiguous do not merge; return a clarification question
      // (discards the main LLM result — acceptable since this is a rare path)
      const intentUnclearList = filterResult?.intentUnclear
      if (body.adding_filters && body.existing_query_filters && Array.isArray(intentUnclearList) && intentUnclearList.length > 0) {
        const key = intentUnclearList[0]
        const existing = body.existing_query_filters[key]
        const extracted = extractedQueryFilters?.[key]
        const currentVal = Array.isArray(existing) ? existing.join(', ') : (existing ?? '')
        const newVal = Array.isArray(extracted) ? extracted.join(', ') : (extracted ?? '')
        const categoryLabel = key === 'surfboard_type' ? 'board type' : key === 'surf_level_category' ? 'surf level' : key === 'country_from' ? 'origin country' : key
        const clarificationText = `Do you want to **add** ${newVal} to your current ${categoryLabel} (${currentVal}) or **replace** with only ${newVal}?`
        const clarificationPayload = { return_message: clarificationText, is_finished: false, data: null }
        messages.push({ role: 'assistant', content: JSON.stringify(clarificationPayload) })
        await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)
        // --- UI Messages: user message + clarification ---
        const uiMsgsClarify = await getUIMessages(chatId, supabaseAdmin)
        appendUIMessage(uiMsgsClarify, { type: 'user_text', text: body.message, timestamp: makeTimestamp(), is_user: true })
        appendUIMessage(uiMsgsClarify, { type: 'bot_text', text: clarificationText, timestamp: makeTimestamp(), is_user: false, backend_message_index: messages.length - 1 })
        await saveUIMessages(chatId, uiMsgsClarify, supabaseAdmin)
        console.log('🔀 Returning clarification (intentUnclear):', clarificationText)
        return new Response(JSON.stringify(clarificationPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        })
      }

      // --- Use the main LLM result ---
      let assistantMessage = mainLLMResult
      
      // If response looks like plain text, try to extract embedded JSON before retrying (avoids extra LLM call)
      const looksPlainText = !assistantMessage.trim().startsWith('{') && !assistantMessage.includes('```json')
      if (looksPlainText) {
        const jsonBlock = assistantMessage.match(/\{[\s\S]*"is_finished"[\s\S]*\}/)
        if (jsonBlock) {
          try {
            const cleaned = jsonBlock[0].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
            JSON.parse(cleaned)
            assistantMessage = jsonBlock[0]
          } catch (_) {
            // Fall through to retry
          }
        }
      }
      const stillNeedsRetry = looksPlainText && !assistantMessage.trim().startsWith('{')
      if (stillNeedsRetry) {
        console.log('⚠️ LLM returned plain text instead of JSON - retrying with JSON enforcement...')
        console.log('Plain text response:', assistantMessage.substring(0, 200))
        const strongJsonEnforcement = `ERROR: You returned plain text instead of JSON. This is a CRITICAL ERROR. You MUST return a JSON object. Your response MUST be valid JSON starting with { and ending with }. Example: {"return_message": "Your text here", "is_finished": false, "data": {"destination_country": "Philippines", "area": "Siargao", "budget": null, "destination_known": true, "purpose": {"purpose_type": "connect_traveler", "specific_topics": []}, "user_context": {}}}. Return ONLY the JSON object, nothing else.`
        messages.push({ role: 'system', content: strongJsonEnforcement })
        assistantMessage = await callOpenAI(messages.filter(m => !isSyntheticMessage(m)))
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
            queryFilters: parsed.queryFilters ?? parsed.query_filters ?? null,
            filtersFromNonNegotiableStep: false,
          }
        }
        
        // Optional: when user said remove all and parsed has null/empty queryFilters, ensure destination/area are cleared
        if (userRequestedRemoveAll && tripPlanningData) {
          const qf = parsed.data?.queryFilters ?? parsed.queryFilters
          if (qf == null || (typeof qf === 'object' && Object.keys(qf).length === 0)) {
            tripPlanningData.destination_country = null
            tripPlanningData.area = null
            console.log('📦 Cleared destination_country and area (remove-all intent, parsed queryFilters empty)')
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
                
                // Area extraction removed — let the AI handle it via the prompt instructions
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
        if (body.adding_filters && body.existing_query_filters !== undefined) {
          // Add-filter mode: merge existing (from client) with current message's extracted only (not accumulated)
          const existingQF = body.existing_query_filters && typeof body.existing_query_filters === 'object' ? body.existing_query_filters : {}
          const currentExtracted = filterResult?.supabaseFilters ?? extractedQueryFilters ?? {}
          const intent = filterResult?.filterEditIntent && typeof filterResult.filterEditIntent === 'object' ? filterResult.filterEditIntent : {}
          const hasIntent = Object.keys(intent).length > 0
          const merged = hasIntent
            ? mergeQueryFiltersEditing(existingQF, currentExtracted, intent)
            : mergeQueryFiltersAdding(existingQF, currentExtracted)
          const normalizedQueryFilters = await normalizeQueryFilters(merged)
          // Merge destinations so "add Indonesia" when existing is "Sri Lanka" yields "Sri Lanka, Indonesia"
          const mergedDestination = mergeDestinations(
            body.existing_destination_country ?? null,
            tripPlanningData?.destination_country ?? null,
            parsed?.data?.destination_country ?? null,
            filterResult?.supabaseFilters?.destination_days_min?.destination ?? null
          )
          if (!tripPlanningData) {
            tripPlanningData = {
              destination_country: mergedDestination ?? body.existing_destination_country ?? null,
              area: body.existing_area ?? null,
              budget: null,
              destination_known: true,
              purpose: { purpose_type: 'connect_traveler', specific_topics: [] },
              non_negotiable_criteria: {},
              user_context: {},
              queryFilters: normalizedQueryFilters,
              filtersFromNonNegotiableStep: false,
            }
          } else {
            tripPlanningData.queryFilters = normalizedQueryFilters
            // Trust client's explicit destination/area (they may be null = deleted)
            if ('existing_destination_country' in body) tripPlanningData.destination_country = mergedDestination ?? body.existing_destination_country ?? null
            else tripPlanningData.destination_country = mergedDestination ?? tripPlanningData.destination_country
            if ('existing_area' in body) tripPlanningData.area = body.existing_area ?? null
          }
          console.log('✅ Merged filters (add-filter mode):', JSON.stringify(normalizedQueryFilters, null, 2))
        } else if (extractedQueryFilters && Object.keys(extractedQueryFilters).length > 0) {
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
            
            // Last assistant wins: when we have accumulatedFilters (from prior assistant message), use it as base and only add extractor keys not in it; do not overlay main GPT
            if (accumulatedFilters && Object.keys(accumulatedFilters).length > 0) {
              tripPlanningData.queryFilters = { ...accumulatedFilters };
              for (const key of Object.keys(normalizedQueryFilters)) {
                if (!(key in tripPlanningData.queryFilters)) {
                  tripPlanningData.queryFilters[key] = normalizedQueryFilters[key];
                }
              }
              console.log('✅ Last assistant wins: query filters from accumulated + extractor-only keys')
            } else {
              // Merge filters: main GPT wins, extractor fills gaps (extractor base, then overlay GPT)
              if (tripPlanningData.queryFilters) {
                tripPlanningData.queryFilters = {
                  ...normalizedQueryFilters,
                  ...(tripPlanningData.queryFilters || {}),
                }
              } else {
                tripPlanningData.queryFilters = normalizedQueryFilters
              }
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
        } else if (accumulatedFilters && Object.keys(accumulatedFilters).length > 0 && tripPlanningData) {
          // User sent e.g. "search" with no new extraction; last assistant wins
          tripPlanningData.queryFilters = { ...accumulatedFilters };
          console.log('✅ Last assistant wins (no new extraction): query filters from accumulated only')
        }
        
        // FALLBACK: Build queryFilters from non_negotiable_criteria if queryFilters is null/empty
        // Skip when we have accumulatedFilters (user had already reduced filters) or user explicitly cleared (ack message had queryFilters: null)
        if (tripPlanningData && (!tripPlanningData.queryFilters || Object.keys(tripPlanningData.queryFilters).length === 0) && (!accumulatedFilters || Object.keys(accumulatedFilters).length === 0) && !(accumulatedFromMessage != null && accumulatedFilters === null)) {
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
        
        // Track when we modify tripPlanningData so we persist the normalized response (next request will use correct accumulated filters)
        let responseNormalized = false
        
        // Add-filter flow: after merging filters, ensure we return "ready to search or tweak?" shape so the client shows Review filters and can run search on "send"
        if (body.adding_filters && tripPlanningData) {
          shouldBeFinished = true
          if (!tripPlanningData.search_summary || String(tripPlanningData.search_summary).trim() === '') {
            tripPlanningData.search_summary = (parsed?.data?.search_summary && String(parsed.data.search_summary).trim()) || returnMessage || 'Ready to search with your current filters.'
          }
          // Do not send next_action on this turn: the client must set pendingSearch and await the user's *next* message (search vs edit)
          tripPlanningData.next_action = null
          responseNormalized = true
          console.log('✅ Add-filter merge: forcing is_finished and search_summary for client')
        }
        
        // Decision reply: when user said "send"/"go"/"search" in reply to "search now or tweak?", ensure next_action is "search" so the client runs matches
        const userMsgTrim = (body.message || '').trim().toLowerCase()
        const hasSearchIntent = /\b(send|search|go|yes|yep|yeah|sure|do it|perfect|looks good|sounds good|go ahead|let'?s\s*(go|search|do)|ready|find)\b/i.test(userMsgTrim)
        const hasEditIntent = /\b(change|edit|modify|tweak|update|remove|add|different|instead|wait|hold on|actually)\b/i.test(userMsgTrim)
        const userWantsSearchReply = hasSearchIntent && !hasEditIntent
        const prevAssistantIdx = messages.length - 3 // [..., prevAssistant, userMessage, newAssistant]
        const prevAssistantContent = messages[prevAssistantIdx]?.role === 'assistant' ? messages[prevAssistantIdx].content : ''
        const prevWasSearchOrTweak = typeof prevAssistantContent === 'string' && (
          (prevAssistantContent.includes('search now') && (prevAssistantContent.includes('tweak') || prevAssistantContent.includes('edit'))) ||
          prevAssistantContent.includes('search_summary')
        )
        if (userWantsSearchReply && prevWasSearchOrTweak && tripPlanningData && (tripPlanningData.next_action == null || tripPlanningData.next_action === undefined)) {
          tripPlanningData.next_action = 'search'
          responseNormalized = true
          console.log('✅ Decision reply: user said "send"/"go" etc. — forcing next_action to "search"')
        }
        
        // Second-layer check: reconcile text vs JSON filters when we have filter-describing text and queryFilters/destination
        const hasFiltersToValidate = tripPlanningData && (() => {
          const q = tripPlanningData.queryFilters
          const hasQF = q && typeof q === 'object' && Object.keys(q).length > 0
          const hasDest = tripPlanningData.destination_country && String(tripPlanningData.destination_country).trim()
          return hasQF || !!hasDest
        })()
        const hasTextToValidate = (returnMessage?.trim() || tripPlanningData?.search_summary?.trim()) || ''
        if (shouldBeFinished && hasFiltersToValidate && hasTextToValidate) {
          try {
            console.log('[reconcileQueryFiltersFromText] Running text-vs-JSON reconciliation (continue)')
            const reconciled = await reconcileQueryFiltersFromText(
              returnMessage || '',
              tripPlanningData?.search_summary,
              tripPlanningData,
              userProfile?.age,
            )
            if (reconciled) {
              if (reconciled.queryFilters != null) {
                const allowedKeys = new Set(Object.keys(tripPlanningData.queryFilters || {}))
                const filtered: Record<string, any> = {}
                for (const key of Object.keys(reconciled.queryFilters)) {
                  if (allowedKeys.has(key)) filtered[key] = reconciled.queryFilters[key]
                }
                const isEmpty = Object.keys(filtered).length === 0
                if (!isEmpty) {
                  tripPlanningData.queryFilters = filtered
                  console.log('[reconcileQueryFiltersFromText] Updated queryFilters from text; keys:', Object.keys(filtered))
                }
              }
              if (reconciled.destination_country != null) {
                tripPlanningData.destination_country = reconciled.destination_country
                if (reconciled.area !== undefined) tripPlanningData.area = reconciled.area
                console.log('[reconcileQueryFiltersFromText] Updated destination_country/area from text')
              }
            } else {
              console.log('[reconcileQueryFiltersFromText] No update (validator returned null)')
            }
          } catch (e) {
            console.warn('[reconcileQueryFiltersFromText] Reconciliation failed, keeping current filters:', e)
          }
        }
        
        parsedResponse = {
          return_message: returnMessage,
          is_finished: shouldBeFinished,
          data: ensureResponseDataQueryFilters(tripPlanningData) ?? null
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
        
        // Persist normalized response so the next request sees correct accumulated filters (e.g. after "change to longboard" then "nothing else")
        // IMPORTANT: Only overwrite the last message (the assistant we just appended). Never mutate earlier assistant messages so history restore shows correct text per message.
        if (responseNormalized && messages.length > 0) {
          messages[messages.length - 1].content = JSON.stringify(parsedResponse)
          await saveChatHistory(chatId, messages, user.id, body.conversation_id || null, supabaseAdmin)
          console.log('✅ Re-saved assistant message with normalized response (queryFilters/next_action)')
        }
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
            data: extractedData.destination_country ? ensureResponseDataQueryFilters(extractedData) : null
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

      // --- UI Messages: append user message + bot response ---
      try {
        const uiMsgsContinue = await getUIMessages(chatId, supabaseAdmin)
        appendUIMessage(uiMsgsContinue, { type: 'user_text', text: body.message, timestamp: makeTimestamp(), is_user: true })
        const hasSearchSummaryContinue = parsedResponse.data?.search_summary != null && String(parsedResponse.data.search_summary).trim() !== ''
        appendUIMessage(uiMsgsContinue, {
          type: hasSearchSummaryContinue ? 'search_summary' : 'bot_text',
          text: hasSearchSummaryContinue ? parsedResponse.data.search_summary : parsedResponse.return_message,
          timestamp: makeTimestamp(),
          is_user: false,
          is_search_summary: hasSearchSummaryContinue || undefined,
          backend_message_index: messages.length - 1,
        })
        await saveUIMessages(chatId, uiMsgsContinue, supabaseAdmin)
      } catch (uiErr) {
        console.error('[continue] Error saving ui_messages:', uiErr)
      }

      const responsePayload = { ...parsedResponse, message_index: messages.length - 1 }
      return new Response(
        JSON.stringify(responsePayload),
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
      const body: { matchedUsers: MatchedUser[]; destinationCountry: string; requestData?: any; totalCount?: number } = await req.json()

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
        // Also skip synthetic messages (restart markers, add-filter prompts)
        let targetAssistantIndex = -1
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            // Skip synthetic display-only messages
            if (messages[i].metadata?.isRestartAfterNewChat || messages[i].metadata?.isAddFilterPrompt) {
              console.log('[attach-matches] Skipping synthetic message at index', i)
              continue
            }
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
            if (messages[i].role === 'assistant' && !messages[i].metadata?.matchedUsers && !messages[i].metadata?.isRestartAfterNewChat && !messages[i].metadata?.isAddFilterPrompt) {
              targetAssistantIndex = i
              console.log('[attach-matches] Using fallback - last assistant message without metadata at index:', i)
              break
            }
          }
        }

        // Last resort: all assistant messages already have matchedUsers (e.g. "More" action).
        // Append a new placeholder assistant message to hold this match batch.
        // Also mark the previous match message with selectedAction: 'more' (handles the race
        // with updateMatchActionSelection — both ops write to the same messages array).
        if (targetAssistantIndex === -1) {
          // Mark the most recent match message as 'more' so its action buttons are disabled on restore
          for (let j = messages.length - 1; j >= 0; j--) {
            if (messages[j].metadata?.matchedUsers && messages[j].metadata?.actionRow) {
              if (!messages[j].metadata!.actionRow!.selectedAction) {
                messages[j].metadata!.actionRow!.selectedAction = 'more'
                console.log('[attach-matches] Marked previous match message at index', j, 'with selectedAction: more')
              }
              break
            }
          }
          const matchCount = body.matchedUsers?.length ?? 0
          const placeholderContent = JSON.stringify({
            return_message: `Found ${matchCount} more match${matchCount !== 1 ? 'es' : ''} for you!`,
            is_finished: true,
            data: { destination_country: body.destinationCountry || null }
          })
          messages.push({ role: 'assistant', content: placeholderContent, metadata: {} })
          targetAssistantIndex = messages.length - 1
          console.log('[attach-matches] All assistant messages have metadata - appended placeholder at index:', targetAssistantIndex)
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
          actionRow: { requestData: body.requestData ?? null, selectedAction: null },
          totalCount: body.totalCount ?? body.matchedUsers?.length ?? 0
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

        // --- UI Messages: append match_results or no_matches ---
        try {
          const uiMsgsMatch = await getUIMessages(chatId, supabaseAdmin)
          const matchCount = body.matchedUsers.length
          const matchType = matchCount > 0 ? 'match_results' : 'no_matches'
          const matchText = matchCount > 0
            ? `Found ${matchCount} awesome match${matchCount > 1 ? 'es' : ''} for you!`
            : 'No surfers match your criteria right now. Try adjusting your destination or filters.'
          appendUIMessage(uiMsgsMatch, {
            type: matchType as 'match_results' | 'no_matches',
            text: matchText,
            timestamp: makeTimestamp(),
            is_user: false,
            matched_users: body.matchedUsers,
            destination_country: body.destinationCountry,
            match_total_count: body.totalCount ?? matchCount,
            action_row: { request_data: body.requestData ?? null, selected_action: null },
            backend_message_index: targetAssistantIndex,
          })
          await saveUIMessages(chatId, uiMsgsMatch, supabaseAdmin)
        } catch (uiErr) {
          console.error('[attach-matches] Error saving ui_messages:', uiErr)
        }

        return new Response(
          JSON.stringify({ success: true, message: 'Matched users attached successfully', messageIndex: targetAssistantIndex }),
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

    // Route: PATCH /swelly-trip-planning/update-match-action/:chat_id
    if (path.includes('/update-match-action/') && req.method === 'PATCH') {
      const chatId = path.split('/update-match-action/')[1]?.split('/')[0] ?? path.split('/update-match-action/')[1]
      const body: { messageIndex: number; selectedAction: 'new_chat' | 'add_filter' | 'more' } = await req.json().catch(() => ({}))

      if (!chatId) {
        return new Response(
          JSON.stringify({ error: 'Missing chat_id' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
      if (typeof body.messageIndex !== 'number' || body.messageIndex < 0) {
        return new Response(
          JSON.stringify({ error: 'Invalid messageIndex' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
      if (!body.selectedAction || !['new_chat', 'add_filter', 'more'].includes(body.selectedAction)) {
        return new Response(
          JSON.stringify({ error: 'Invalid selectedAction' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }

      try {
        const messages = await getChatHistory(chatId, supabaseAdmin)
        if (messages.length === 0) {
          return new Response(JSON.stringify({ error: 'Chat not found' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
        }
        const i = body.messageIndex
        if (i >= messages.length) {
          return new Response(JSON.stringify({ error: 'Message index out of range' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
        }
        const msg = messages[i]
        if (!msg.metadata) msg.metadata = {}
        if (!msg.metadata.actionRow) msg.metadata.actionRow = { requestData: null, selectedAction: null }
        msg.metadata.actionRow.selectedAction = body.selectedAction
        let appendedMessageIndex: number | undefined = undefined
        if (body.selectedAction === 'new_chat') {
          msg.metadata.actionRow.requestData = { queryFilters: null, destination_country: null, area: null }
          console.log('[update-match-action] New Chat: cleared requestData on message', i)
          // Append synthetic restart message so it restores after refresh
          messages.push({
            role: 'assistant',
            content: TRIP_PLANNING_FIRST_QUESTION_TEXT,
            metadata: { isRestartAfterNewChat: true }
          })
          appendedMessageIndex = messages.length - 1
          console.log('[update-match-action] Appended restart message at index', appendedMessageIndex)
        }
        if (body.selectedAction === 'add_filter') {
          const existingFilters = msg.metadata.actionRow?.requestData ?? null
          messages.push({
            role: 'assistant',
            content: "Great! We can add some filters to your search. What would you like to add? For example: board type, surf level, destinations they've surfed, age, or country of origin.",
            metadata: { isAddFilterPrompt: true, existingFiltersData: existingFilters }
          })
          appendedMessageIndex = messages.length - 1
          console.log('[update-match-action] Appended add-filter prompt at index', appendedMessageIndex)
        }
        await saveChatHistory(chatId, messages, user.id, null, supabaseAdmin)

        // --- UI Messages: update action_row on match message + append synthetic message ---
        try {
          const uiMsgsAction = await getUIMessages(chatId, supabaseAdmin)
          // Find the last match_results/no_matches UI message and update its action_row
          for (let ui = uiMsgsAction.length - 1; ui >= 0; ui--) {
            if (uiMsgsAction[ui].type === 'match_results' || uiMsgsAction[ui].type === 'no_matches') {
              uiMsgsAction[ui].action_row = { ...uiMsgsAction[ui].action_row!, selected_action: body.selectedAction }
              break
            }
          }
          if (body.selectedAction === 'new_chat') {
            appendUIMessage(uiMsgsAction, {
              type: 'new_chat_restart',
              text: TRIP_PLANNING_FIRST_QUESTION_TEXT,
              timestamp: makeTimestamp(),
              is_user: false,
              is_restart_after_new_chat: true,
              backend_message_index: appendedMessageIndex,
            })
          }
          if (body.selectedAction === 'add_filter') {
            appendUIMessage(uiMsgsAction, {
              type: 'add_filter_prompt',
              text: "Great! We can add some filters to your search. What would you like to add? For example: board type, surf level, destinations they've surfed, age, or country of origin.",
              timestamp: makeTimestamp(),
              is_user: false,
              backend_message_index: appendedMessageIndex,
            })
          }
          await saveUIMessages(chatId, uiMsgsAction, supabaseAdmin)
        } catch (uiErr) {
          console.error('[update-match-action] Error saving ui_messages:', uiErr)
        }

        return new Response(JSON.stringify({ success: true, appendedMessageIndex }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
      } catch (error) {
        console.error('Error updating match action:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to update match action', details: error instanceof Error ? error.message : String(error) }),
          { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
    }

    // Route: PATCH /swelly-trip-planning-copy/update-match-filters/:chat_id
    if (path.includes('/update-match-filters/') && req.method === 'PATCH') {
      const chatId = path.split('/update-match-filters/')[1]?.split('/')[0] ?? path.split('/update-match-filters/')[1]
      const body: { messageIndex: number; requestData: any } = await req.json().catch(() => ({}))

      if (!chatId) {
        return new Response(
          JSON.stringify({ error: 'Missing chat_id' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
      if (typeof body.messageIndex !== 'number' || body.messageIndex < 0) {
        return new Response(
          JSON.stringify({ error: 'Invalid messageIndex' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
      if (body.requestData === undefined) {
        return new Response(
          JSON.stringify({ error: 'Missing requestData' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }

      try {
        const messages = await getChatHistory(chatId, supabaseAdmin)
        if (messages.length === 0) {
          return new Response(JSON.stringify({ error: 'Chat not found' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
        }
        const i = body.messageIndex
        if (i >= messages.length) {
          return new Response(JSON.stringify({ error: 'Message index out of range' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
        }
        const msg = messages[i]
        if (!msg.metadata) msg.metadata = {}
        if (!msg.metadata.actionRow) msg.metadata.actionRow = { requestData: null, selectedAction: null }
        msg.metadata.actionRow.requestData = body.requestData
        await saveChatHistory(chatId, messages, user.id, null, supabaseAdmin)

        // --- UI Messages: update action_row.request_data on the match UI message ---
        try {
          const uiMsgsFilters = await getUIMessages(chatId, supabaseAdmin)
          for (let ui = uiMsgsFilters.length - 1; ui >= 0; ui--) {
            if (uiMsgsFilters[ui].type === 'match_results' || uiMsgsFilters[ui].type === 'no_matches') {
              if (uiMsgsFilters[ui].action_row) {
                uiMsgsFilters[ui].action_row!.request_data = body.requestData
              }
              break
            }
          }
          await saveUIMessages(chatId, uiMsgsFilters, supabaseAdmin)
        } catch (uiErr) {
          console.error('[update-match-filters] Error saving ui_messages:', uiErr)
        }

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
      } catch (error) {
        console.error('Error updating match filters:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to update match filters', details: error instanceof Error ? error.message : String(error) }),
          { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
    }

    // Route: PATCH /swelly-trip-planning-copy/update-search-summary-block/:chat_id
    const updateSearchSummaryBlockMatch = path.match(/update-search-summary-block\/([a-f0-9-]{36})/i)
    if (updateSearchSummaryBlockMatch && req.method === 'PATCH') {
      const chatId = updateSearchSummaryBlockMatch[1]
      const body: { requestData: any; searchSummary: string; selectedAction: 'search' | 'continue_editing' | null; messageIndex?: number } = await req.json().catch(() => ({} as any))

      if (!chatId) {
        return new Response(
          JSON.stringify({ error: 'Missing chat_id' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
      if (body.requestData === undefined) {
        return new Response(
          JSON.stringify({ error: 'Missing requestData' }),
          { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }

      try {
        const messages = await getChatHistory(chatId, supabaseAdmin)
        if (messages.length === 0) {
          return new Response(JSON.stringify({ error: 'Chat not found' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
        }
        let targetIndex = -1
        if (typeof body.messageIndex === 'number' && body.messageIndex >= 0 && body.messageIndex < messages.length && messages[body.messageIndex].role === 'assistant') {
          targetIndex = body.messageIndex
        }
        if (targetIndex < 0) {
          // Fallback: find the last assistant message (existing clients)
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
              targetIndex = i
              break
            }
          }
        }
        if (targetIndex < 0) {
          return new Response(JSON.stringify({ error: 'No assistant message found' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
        }
        const msg = messages[targetIndex]
        if (!msg.metadata) msg.metadata = {}
        msg.metadata.searchSummaryBlock = {
          requestData: body.requestData,
          searchSummary: body.searchSummary ?? '',
          selectedAction: body.selectedAction ?? null,
        }
        await saveChatHistory(chatId, messages, user.id, null, supabaseAdmin)

        // --- UI Messages: update search_summary_block on the search_summary UI message ---
        try {
          const uiMsgsSS = await getUIMessages(chatId, supabaseAdmin)
          for (let ui = uiMsgsSS.length - 1; ui >= 0; ui--) {
            if (uiMsgsSS[ui].type === 'search_summary' || uiMsgsSS[ui].is_search_summary) {
              uiMsgsSS[ui].search_summary_block = {
                request_data: body.requestData,
                search_summary: body.searchSummary ?? '',
                selected_action: body.selectedAction ?? null,
              }
              break
            }
          }
          await saveUIMessages(chatId, uiMsgsSS, supabaseAdmin)
        } catch (uiErr) {
          console.error('[update-search-summary-block] Error saving ui_messages:', uiErr)
        }

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
      } catch (error) {
        console.error('Error updating search summary block:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to update search summary block', details: error instanceof Error ? error.message : String(error) }),
          { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
    }

    // Route: PATCH /acknowledge-filter-removal/:chat_id
    const ackRemovalMatch = path.match(/acknowledge-filter-removal\/([a-f0-9-]{36})/i)
    if (ackRemovalMatch && req.method === 'PATCH') {
      const chatId = ackRemovalMatch[1]
      const body: { messageIndex?: number; requestData: any; removedFilterLabel?: string; context: 'message' | 'pending_search' } = await req.json().catch(() => ({} as any))
      const qfKeys = body.requestData?.queryFilters && typeof body.requestData.queryFilters === 'object' ? Object.keys(body.requestData.queryFilters).join(',') : 'n/a'
      console.log('[ack-filter-removal] body: chatId=', chatId, 'context=', body.context, 'messageIndex=', body.messageIndex, 'removedLabel=', body.removedFilterLabel, 'requestData.queryFilters keys=[' + qfKeys + '] destination_country=', body.requestData?.destination_country)
      if (!chatId) {
        return new Response(JSON.stringify({ error: 'Missing chat_id' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
      }
      if (body.requestData === undefined) {
        return new Response(JSON.stringify({ error: 'Missing requestData' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
      }
      const context = body.context === 'pending_search' ? 'pending_search' : 'message'
      try {
        let messages = await getChatHistory(chatId, supabaseAdmin)
        if (messages.length === 0) {
          return new Response(JSON.stringify({ error: 'Chat not found' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
        }
        console.log('[ack-filter-removal] loaded messages.length=', messages.length)
        if (context === 'message' && typeof body.messageIndex === 'number' && body.messageIndex >= 0 && body.messageIndex < messages.length) {
          const msg = messages[body.messageIndex] as any
          if (!msg.metadata) msg.metadata = {}
          if (!msg.metadata.actionRow) msg.metadata.actionRow = { requestData: null, selectedAction: null }
          msg.metadata.actionRow.requestData = body.requestData
          console.log('[ack-filter-removal] updated message at index', body.messageIndex, 'with new requestData (queryFilters keys=[' + qfKeys + '])')
        } else if (context === 'message') {
          console.log('[ack-filter-removal] skipped message update: context=message but messageIndex invalid or missing', body.messageIndex, 'messages.length=', messages.length)
        }
        if (context === 'pending_search') {
          let lastIdx = -1
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') { lastIdx = i; break }
          }
          if (lastIdx >= 0) {
            const msg = messages[lastIdx] as any
            if (!msg.metadata) msg.metadata = {}
            if (!msg.metadata.searchSummaryBlock) msg.metadata.searchSummaryBlock = { requestData: null, searchSummary: '', selectedAction: null }
            msg.metadata.searchSummaryBlock.requestData = body.requestData
            console.log('[ack-filter-removal] pending_search: updated searchSummaryBlock at index', lastIdx)
          }
          // Also update the match message's actionRow so "3 More" and restore use the same reduced filters
          let matchIdx = -1
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i] as any
            if (msg.role === 'assistant' && (msg.metadata?.actionRow?.requestData != null || msg.metadata?.matchedUsers)) {
              if (!msg.metadata) msg.metadata = {}
              if (!msg.metadata.actionRow) msg.metadata.actionRow = { requestData: null, selectedAction: null }
              msg.metadata.actionRow.requestData = body.requestData
              matchIdx = i
              break
            }
          }
          console.log('[ack-filter-removal] pending_search: updated match message actionRow at index', matchIdx >= 0 ? matchIdx : 'none')
        }
        const summaryText = await getFilterRemovalAcknowledgment(body.requestData, body.removedFilterLabel)
        const text = summaryText || 'Got it — filters updated. Want to search or tweak?'
        const payload = {
          return_message: text,
          is_finished: true,
          data: {
            queryFilters: body.requestData?.queryFilters ?? null,
            destination_country: body.requestData?.destination_country ?? null,
            area: body.requestData?.area ?? null,
            search_summary: text,
          },
        }
        messages.push({ role: 'assistant', content: JSON.stringify(payload) })
        console.log('[ack-filter-removal] saving history: messages.length=', messages.length, 'new ack message at index', messages.length - 1)
        await saveChatHistory(chatId, messages, user.id, null, supabaseAdmin)
        console.log('[ack-filter-removal] save completed')
        const now = new Date()
        const timestamp = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        const newMessageId = crypto.randomUUID()
        const newMessage = {
          id: newMessageId,
          text: text,
          isUser: false,
          timestamp,
        }

        // --- UI Messages: append filter_removal_ack ---
        try {
          const uiMsgsAck = await getUIMessages(chatId, supabaseAdmin)
          // Also update the match message's action_row.request_data
          for (let ui = uiMsgsAck.length - 1; ui >= 0; ui--) {
            if (uiMsgsAck[ui].type === 'match_results' || uiMsgsAck[ui].type === 'no_matches') {
              if (uiMsgsAck[ui].action_row) {
                uiMsgsAck[ui].action_row!.request_data = body.requestData
              }
              break
            }
          }
          appendUIMessage(uiMsgsAck, {
            type: 'filter_removal_ack',
            text: text,
            timestamp: makeTimestamp(),
            is_user: false,
            is_search_summary: true,
            backend_message_index: messages.length - 1,
          })
          await saveUIMessages(chatId, uiMsgsAck, supabaseAdmin)
        } catch (uiErr) {
          console.error('[ack-filter-removal] Error saving ui_messages:', uiErr)
        }

        return new Response(JSON.stringify({ success: true, newMessage }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
      } catch (err) {
        console.error('acknowledge-filter-removal error:', err)
        return new Response(
          JSON.stringify({ error: 'Failed to acknowledge filter removal', details: err instanceof Error ? err.message : String(err) }),
          { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
    }

    // Route: GET /swelly-trip-planning/latest — return the user's most recent trip-planning chat
    if (path.endsWith('/latest') && req.method === 'GET') {
      try {
        const { data, error } = await supabaseAdmin
          .from('swelly_chat_history')
          .select('chat_id, updated_at')
          .eq('user_id', user.id)
          .eq('conversation_type', 'trip-planning')
          .order('updated_at', { ascending: false })
          .limit(1)
          .single()

        if (error || !data) {
          return new Response(
            JSON.stringify({ error: 'No trip planning chat found' }),
            { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
          )
        }

        return new Response(
          JSON.stringify({ chat_id: data.chat_id, updated_at: data.updated_at }),
          { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      } catch (err) {
        console.error('latest chat error:', err)
        return new Response(
          JSON.stringify({ error: 'Failed to fetch latest chat', details: err instanceof Error ? err.message : String(err) }),
          { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      }
    }

    // Route: GET /swelly-trip-planning/ui-messages/:chat_id — return ordered UI messages for restore
    const uiMessagesRouteMatch = path.match(/ui-messages\/([a-f0-9-]{36})/i)
    if (uiMessagesRouteMatch && req.method === 'GET') {
      const chatId = uiMessagesRouteMatch[1]
      try {
        const uiMessages = await getUIMessages(chatId, supabaseAdmin)
        return new Response(
          JSON.stringify({ chat_id: chatId, ui_messages: uiMessages }),
          { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        )
      } catch (err) {
        console.error('[ui-messages] Error:', err)
        return new Response(
          JSON.stringify({ error: 'Failed to fetch UI messages', details: err instanceof Error ? err.message : String(err) }),
          { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
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
        const body: { chatId: string; tripPlanningData: any; excludePrevious?: boolean } = await req.json()

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
        const rawQueryFilters = raw.queryFilters ?? raw.query_filters ?? null
        console.log('[find-matches] Raw queryFilters (before normalize):', rawQueryFilters != null ? JSON.stringify(rawQueryFilters) : 'null')
        let queryFilters = rawQueryFilters
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
        normalizeUSDestination(tripPlanningData)

        const hasDestination = tripPlanningData.destination_country && String(tripPlanningData.destination_country).trim() !== ''
        const hasQueryFilters = (() => {
          const q = tripPlanningData.queryFilters
          if (!q || typeof q !== 'object') return false
          if (q.country_from && Array.isArray(q.country_from) && q.country_from.length > 0) return true
          if (q.surfboard_type && Array.isArray(q.surfboard_type) && q.surfboard_type.length > 0) return true
          if (q.surf_level_category != null) return true
          if (typeof q.age_min === 'number') return true
          if (typeof q.age_max === 'number') return true
          return false
        })()
        if (!hasDestination && !hasQueryFilters) {
          console.error('[find-matches] Neither destination_country nor queryFilters present. Keys received:', Object.keys(raw))
          return new Response(
            JSON.stringify({ error: 'Either destination_country or at least one query filter (e.g. country_from, age_min/age_max, surfboard_type, surf_level_category) is required for matching.' }),
            { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
          )
        }

        console.log('[find-matches] Normalized request:', {
          destination_country: tripPlanningData.destination_country,
          area: tripPlanningData.area,
          queryFilters: tripPlanningData.queryFilters ? Object.keys(tripPlanningData.queryFilters) : null,
        })
        if (tripPlanningData.queryFilters && typeof tripPlanningData.queryFilters === 'object') {
          console.log('[find-matches] tripPlanningData.queryFilters:', JSON.stringify(tripPlanningData.queryFilters))
          const slc = tripPlanningData.queryFilters.surf_level_category
          console.log('[find-matches] surf_level_category present:', slc != null, 'value:', slc != null ? JSON.stringify(slc) : 'n/a')
        } else {
          console.log('[find-matches] surf_level_category: not present (no queryFilters or empty)')
        }
        const pathDesc = hasDestination
          ? `destination (destination_country=${tripPlanningData.destination_country})`
          : 'general (no destination, using queryFilters)'
        console.log('[find-matches] Path:', pathDesc)

        // Run server-side matching (same behaviour as main flow, matching on server)
        const excludePrevious = body.excludePrevious === true
        console.log('[find-matches] Starting server-side matching for chat:', body.chatId, 'excludePrevious:', excludePrevious)
        const { results: matches, totalCount } = await findMatchingUsersV3Server(
          tripPlanningData,
          user.id,
          body.chatId,
          supabaseAdmin,
          excludePrevious
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

        console.log('[find-matches] Successfully found and saved', matches.length, 'matches (totalCount=', totalCount, '). Path:', pathDesc, '| Filters:', tripPlanningData.queryFilters ? Object.keys(tripPlanningData.queryFilters).join(', ') : 'none')

        return new Response(
          JSON.stringify({
            matches,
            totalCount,
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
