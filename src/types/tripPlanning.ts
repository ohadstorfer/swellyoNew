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
  } | null; // AI-extracted Supabase query filters
  filtersFromNonNegotiableStep?: boolean; // true if filters were mentioned during STEP 4 (non-negotiable criteria)
  prioritize_filters?: {
    origin_country?: string;
    board_type?: string;
    surf_level?: number;
    age_range?: [number, number];
    travel_experience?: string;
    group_type?: string;
  } | null; // V2: Prioritized filters from user prompts (e.g., "prioritize longboarders")
}

export interface MatchQuality {
  exactMatch: boolean;
  matchCount: number; // Number of criteria that matched (must be > 1 for partial matches)
  matchedCriteria: {
    destination_country: boolean;
    area?: boolean | null; // null if area not requested
    country_from?: boolean | null; // null if not requested or surfer data missing
    age?: boolean | null; // null if not requested or surfer data missing
    surfboard_type?: boolean | null; // null if not requested or surfer data missing
    surf_level?: boolean | null; // null if not requested or surfer data missing
    travel_experience?: boolean | null; // null if not requested or surfer data missing
  };
  differences: {
    area?: { requested: string; found: string | null }; // null if no area match
    age?: { requested: [number, number] | number; found: number | null }; // null if surfer age missing
    surfboard_type?: { requested: string[]; found: string | null }; // null if surfer board type missing
    surf_level?: { requested: [number, number] | number; found: number | null }; // null if surfer level missing
    country_from?: { requested: string[]; found: string | null }; // null if surfer country missing
  };
  missingData: {
    age?: boolean; // true if surfer has no age data
    country_from?: boolean; // true if surfer has no country_from data
    surfboard_type?: boolean; // true if surfer has no board type
    surf_level?: boolean; // true if surfer has no surf level
    travel_experience?: boolean; // true if surfer has no travel experience
  };
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
  destinations_array?: Array<{ country: string; area: string[]; time_in_days: number; time_in_text?: string }>; // For reference
  matchQuality?: MatchQuality; // Add this field
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

