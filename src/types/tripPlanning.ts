/**
 * Trip Planning Types
 * 
 * Types for the trip planning feature where users chat with Swelly
 * to plan trips and get matched with other users.
 */

export interface TripPlanningRequest {
  destination_country: string;
  area?: string | null;
  budget?: 1 | 2 | 3 | null; // 1: low, 2: medium, 3: high
  destination_known: boolean; // whether user knew destination from start
  purpose: {
    purpose_type: 'specific_advice' | 'general_guidance' | 'connect_traveler' | 'combination';
    specific_topics?: string[]; // e.g., ["visa", "best waves", "accommodation"]
  };
  non_negotiable_criteria?: {
    country_from?: string[]; // e.g., ["Israel"]
    surfboard_type?: string[]; // e.g., ["shortboard"]
    age_range?: [number, number]; // e.g., [20, 30]
    surf_level_min?: number;
    surf_level_max?: number;
    must_have_keywords?: string[]; // e.g., ["yoga", "remote-work"]
    other?: string;
  } | null;
  user_context?: {
    mentioned_preferences?: string[];
    mentioned_deal_breakers?: string[];
  } | null;
  queryFilters?: {
    country_from?: string[];
    age_min?: number;
    age_max?: number;
    surfboard_type?: string[];
    surf_level_min?: number;
    surf_level_max?: number;
    destination_days_min?: { destination: string; min_days: number };
    lifestyle_keywords?: string[];
    wave_type_keywords?: string[];
  } | null; // AI-extracted Supabase query filters
  filtersFromNonNegotiableStep?: boolean; // true if filters were mentioned during STEP 4 (non-negotiable criteria)
  prioritize_filters?: {
    origin_country?: string;
    board_type?: string;
    surf_level?: number;
    age_range?: [number, number];
    lifestyle_keywords?: string[];
    wave_type_keywords?: string[];
    travel_experience?: string;
    group_type?: string;
  } | null; // V2: Prioritized filters from user prompts (e.g., "prioritize longboarders")
}

export interface MatchedUser {
  user_id: string;
  email?: string;
  name: string;
  profile_image_url?: string | null;
  match_score: number;
  matched_areas?: string[];
  common_lifestyle_keywords?: string[];
  common_wave_keywords?: string[];
  surfboard_type?: string;
  surf_level?: number;
  travel_experience?: string;
  country_from?: string;
  age?: number;
  days_in_destination?: number; // Days spent in the destination country
  destinations_array?: Array<{ destination_name: string; time_in_days: number; time_in_text?: string }>; // For reference
}

export interface TripPlanningData {
  destination_country: string;
  area?: string | null;
  budget?: 1 | 2 | 3 | null;
  destination_known: boolean;
  purpose: {
    purpose_type: 'specific_advice' | 'general_guidance' | 'connect_traveler' | 'combination';
    specific_topics?: string[];
  };
  non_negotiable_criteria?: {
    country_from?: string[];
    surfboard_type?: string[];
    age_range?: [number, number];
    surf_level_min?: number;
    surf_level_max?: number;
    must_have_keywords?: string[];
    other?: string;
  } | null;
  user_context?: {
    mentioned_preferences?: string[];
    mentioned_deal_breakers?: string[];
  } | null;
  matched_users: MatchedUser[];
}

export interface TripPlanningResponse {
  chat_id?: string;
  return_message: string;
  is_finished: boolean;
  data?: TripPlanningData | null;
}

/**
 * Budget level mapping from travel_type to numeric budget
 */
export const BUDGET_MAP: Record<string, 1 | 2 | 3> = {
  'budget': 1,
  'mid': 2,
  'high': 3,
};

/**
 * Travel experience mapping to numeric levels
 */
export const TRAVEL_EXPERIENCE_MAP: Record<string, number> = {
  'new_nomad': 1,
  'rising_voyager': 2,
  'wave_hunter': 3,
  'chicken_joe': 4,
};

/**
 * Group type mapping from travel_buddies to numeric
 */
export const GROUP_TYPE_MAP: Record<string, 1 | 2 | 3> = {
  'solo': 1,
  '2': 2,
  'crew': 3,
};

