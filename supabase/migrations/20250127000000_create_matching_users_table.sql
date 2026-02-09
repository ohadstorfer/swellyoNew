-- Create matching_users table for storing server-side match results
CREATE TABLE IF NOT EXISTS matching_users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id text NOT NULL,
  requesting_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matched_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_country text,
  area text,
  match_score numeric(10, 2) NOT NULL,
  priority_score numeric(10, 2),
  general_score numeric(10, 2),
  matched_areas text[],
  matched_towns text[],
  common_lifestyle_keywords text[],
  common_wave_keywords text[],
  days_in_destination integer,
  match_quality jsonb, -- Store MatchQuality object
  filters_applied jsonb, -- Store queryFilters used for this match
  created_at timestamptz DEFAULT now(),
  
  -- Ensure one match record per user per chat (prevent duplicates)
  UNIQUE(chat_id, matched_user_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_matching_users_chat_id ON matching_users(chat_id);
CREATE INDEX IF NOT EXISTS idx_matching_users_requesting_user ON matching_users(requesting_user_id);
CREATE INDEX IF NOT EXISTS idx_matching_users_score ON matching_users(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_matching_users_created_at ON matching_users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matching_users_destination ON matching_users(destination_country);

-- Add comment to table
COMMENT ON TABLE matching_users IS 'Stores server-side match results for trip planning conversations';


