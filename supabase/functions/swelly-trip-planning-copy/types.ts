/**
 * Types for server-side matching system
 */

// Match result from matching algorithm (before saving to database)
export interface MatchResult {
  user_id: string;
  name: string;
  profile_image_url?: string | null;
  match_score: number;
  priority_score?: number;
  general_score?: number;
  matched_areas?: string[];
  matched_towns?: string[];
  common_lifestyle_keywords?: string[];
  common_wave_keywords?: string[];
  surfboard_type?: string;
  surf_level?: number;
  travel_experience?: string;
  country_from?: string;
  age?: number;
  days_in_destination?: number;
  destinations_array?: Array<{ country: string; area: string[]; time_in_days: number; time_in_text?: string }>;
  match_quality?: any; // MatchQuality object
}

// Database record in matching_users table
export interface MatchRecord {
  id: string;
  chat_id: string;
  requesting_user_id: string;
  matched_user_id: string;
  destination_country?: string | null;
  area?: string | null;
  match_score: number;
  priority_score?: number | null;
  general_score?: number | null;
  matched_areas?: string[] | null;
  matched_towns?: string[] | null;
  common_lifestyle_keywords?: string[] | null;
  common_wave_keywords?: string[] | null;
  days_in_destination?: number | null;
  match_quality?: any | null;
  filters_applied?: any | null;
  created_at: string;
}

// Request payload for matching endpoint (Copy flow: destination + optional area only)
export interface MatchingRequest {
  chatId: string;
  tripPlanningData: {
    destination_country: string;
    area?: string | null;
    budget?: 1 | 2 | 3 | null;
    destination_known?: boolean;
    purpose?: {
      purpose_type: 'specific_advice' | 'general_guidance' | 'connect_traveler' | 'combination';
      specific_topics?: string[];
    };
    user_context?: {
      mentioned_preferences?: string[];
      mentioned_deal_breakers?: string[];
    } | null;
  };
}

// Response from matching endpoint
export interface MatchingResponse {
  matches: MatchResult[];
  totalCount: number;
  chatId: string;
}

// Surfer data structure (from database)
export interface SurferData {
  user_id: string;
  name: string;
  age?: number | null;
  pronoun?: string | null;
  country_from?: string | null;
  surfboard_type?: string | null;
  surf_level?: number | null;
  surf_level_category?: string | null;
  travel_experience?: number | string | null;
  bio?: string | null;
  profile_image_url?: string | null;
  destinations_array?: Array<{ country: string; area: string[]; time_in_days: number; time_in_text?: string }> | null;
  travel_type?: 'budget' | 'mid' | 'high' | null;
  travel_buddies?: 'solo' | '2' | 'crew' | null;
  lifestyle_keywords?: string[] | null;
  wave_type_keywords?: string[] | null;
}






