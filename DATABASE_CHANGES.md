# Database Changes for Trip Planning Feature

## Required Database Changes

### 1. Update `swelly_chat_history` Table

Add a `conversation_type` column to distinguish between onboarding and trip planning conversations:

```sql
-- Add conversation_type column to swelly_chat_history table
ALTER TABLE swelly_chat_history 
ADD COLUMN IF NOT EXISTS conversation_type TEXT DEFAULT 'onboarding' 
CHECK (conversation_type IN ('onboarding', 'trip-planning'));

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_swelly_chat_history_conversation_type 
ON swelly_chat_history(conversation_type);
```

### 2. Optional: Create `trip_planning_conversations` Table (Alternative Approach)

If you prefer to store trip planning conversations separately:

```sql
CREATE TABLE IF NOT EXISTS trip_planning_conversations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  chat_id text NOT NULL UNIQUE,
  destination_country text,
  area text,
  budget integer CHECK (budget >= 1 AND budget <= 3),
  matched_users jsonb, -- Array of matched user data
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for user queries
CREATE INDEX IF NOT EXISTS idx_trip_planning_user_id 
ON trip_planning_conversations(user_id);

-- Create index for chat_id lookups
CREATE INDEX IF NOT EXISTS idx_trip_planning_chat_id 
ON trip_planning_conversations(chat_id);
```

**Note:** The current implementation uses the first approach (adding `conversation_type` to `swelly_chat_history`), which is simpler and reuses existing infrastructure.

## No Changes Needed to `surfers` Table

The existing `surfers` table already contains all the necessary fields for matching:
- `destinations_array` (jsonb) - Contains past destinations with time_in_days
- `travel_type` (text) - Budget level ('budget', 'mid', 'high')
- `surf_level` (integer) - Surf skill level (1-5)
- `travel_experience` (enum) - Travel experience level
- `surfboard_type` (enum) - Board type
- `travel_buddies` (text) - Group type ('solo', '2', 'crew')
- `lifestyle_keywords` (text[]) - Lifestyle interests
- `wave_type_keywords` (text[]) - Wave preferences

## Summary

**Required Changes:**
1. Add `conversation_type` column to `swelly_chat_history` table

**Optional Changes:**
1. Create separate `trip_planning_conversations` table (if preferred)

**No Changes Needed:**
- `surfers` table (already has all required fields)
- `users` table (no changes needed)


