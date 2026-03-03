/**
 * Types for server-side matching system (copy-copy / geo matching)
 */

export interface MatchResult {
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

export interface MatchRecord {
  id: string
  chat_id: string
  requesting_user_id: string
  matched_user_id: string
  destination_country?: string | null
  area?: string | null
  match_score: number
  priority_score?: number | null
  general_score?: number | null
  matched_areas?: string[] | null
  matched_towns?: string[] | null
  common_lifestyle_keywords?: string[] | null
  common_wave_keywords?: string[] | null
  days_in_destination?: number | null
  match_quality?: any | null
  filters_applied?: any | null
  created_at: string
}

export interface MatchingRequest {
  tripPlanningData: { queryFilters?: any; destination_country?: string; area?: string | null }
}
