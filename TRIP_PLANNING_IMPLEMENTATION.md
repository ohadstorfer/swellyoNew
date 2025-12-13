# Trip Planning Feature Implementation Plan

## Overview
This document outlines the implementation of the trip planning feature where users can chat with Swelly to plan a new trip, and Swelly will match them with the top 3 users who have been to the desired destination and have similar preferences.

## Architecture

### Phase 1: Data Collection
When a user chats with Swelly to plan a trip, Swelly collects:
- `destination_country`: e.g., "Sri Lanka"
- `area`: e.g., "South", "Weligama", "Arugam"
- `budget`: 1-3 (1: low, 2: medium, 3: high)

### Phase 2: Matching Algorithm
1. Generate array of areas using LLM based on user's input area
2. Query users whose `destinations_array` contains the requested country (exclude current user)
3. Score each user based on:
   - Days spent in destination (initial score)
   - Matching areas (+30 points per match)
   - Budget similarity: `30 - (abs(requested_budget - user_budget) * 15)`, max 30
   - Surf level similarity: same formula
   - Travel experience similarity: same formula
   - Same surfboard type: +30 points
   - Same group type (travel_buddies): +30 points
   - Matching lifestyle keywords: +5 points per match
   - Matching wave keywords: +5 points per match
4. Sort by points and return top 3 users

## Files to Create/Modify

### 1. New Files

#### `src/services/matching/matchingService.ts`
- Service to handle user matching algorithm
- Functions:
  - `generateAreaArray(country: string, area: string): Promise<string[]>`
  - `findMatchingUsers(request: TripPlanningRequest): Promise<MatchedUser[]>`

#### `supabase/functions/swelly-trip-planning/index.ts`
- New edge function for trip planning conversations
- Different prompt from onboarding chat
- Collects: destination_country, area, budget
- When finished, triggers matching algorithm

#### `src/types/tripPlanning.ts`
- TypeScript interfaces for trip planning:
  - `TripPlanningRequest`
  - `TripPlanningResponse`
  - `MatchedUser`
  - `TripPlanningData`

### 2. Modified Files

#### `src/screens/ChatScreen.tsx`
- Add `conversationType` prop: 'onboarding' | 'trip-planning'
- Conditionally use different Swelly service methods based on type
- Handle trip planning completion differently (show matched users)

#### `src/services/swelly/swellyService.ts`
- Add `startTripPlanningConversation()` method
- Add `continueTripPlanningConversation()` method

#### `src/components/AppContent.tsx`
- Update `handleSwellyPress` to pass `conversationType: 'trip-planning'` to ChatScreen

#### `supabase/functions/swelly-chat/index.ts`
- Keep existing onboarding chat logic
- Optionally add route parameter to distinguish conversation types

### 3. Database Changes

#### New Table: `trip_planning_conversations` (Optional)
If we want to store trip planning conversations separately:
```sql
CREATE TABLE trip_planning_conversations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  destination_country text,
  area text,
  budget integer CHECK (budget >= 1 AND budget <= 3),
  matched_users jsonb, -- Array of matched user IDs
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### Alternative: Use existing `swelly_chat_history` table
- Add `conversation_type` column: 'onboarding' | 'trip-planning'
- Store trip planning data in `data` JSONB column

## Implementation Steps

1. **Create trip planning types** (`src/types/tripPlanning.ts`)
2. **Create matching service** (`src/services/matching/matchingService.ts`)
3. **Create trip planning Swelly edge function** (`supabase/functions/swelly-trip-planning/index.ts`)
4. **Update SwellyService** to support trip planning
5. **Update ChatScreen** to support both conversation types
6. **Update AppContent** navigation
7. **Create UI for displaying matched users** (new component or screen)

## Matching Algorithm Details

### Budget Mapping
- `travel_type: 'budget'` → budget level 1
- `travel_type: 'mid'` → budget level 2
- `travel_type: 'high'` → budget level 3

### Surf Level Mapping
- Already numeric (1-5), use directly

### Travel Experience Mapping
- `'new_nomad'` → 1
- `'rising_voyager'` → 2
- `'wave_hunter'` → 3
- `'chicken_joe'` → 4
- (Add mapping if needed)

### Group Type Mapping
- `travel_buddies: 'solo'` → 1
- `travel_buddies: '2'` → 2
- `travel_buddies: 'crew'` → 3

## LLM Integration for Area Generation

Use OpenAI to generate area array:
```typescript
const prompt = `Given the country "${country}" and area "${area}", generate a list of related surf areas/regions/towns in that country. Return as a JSON array of strings. Example: ["South", "Weligama", "Hirekatiya", "Ahangama"]`;
```

## Response Format

When trip planning conversation finishes:
```json
{
  "return_message": "Great! I found some awesome matches for you...",
  "is_finished": true,
  "data": {
    "destination_country": "Sri Lanka",
    "area": "South",
    "budget": 1,
    "matched_users": [
      {
        "user_id": "uuid",
        "name": "John Doe",
        "profile_image_url": "...",
        "match_score": 150,
        "matched_areas": ["South", "Weligama"],
        "common_interests": ["remote-work", "party"]
      },
      ...
    ]
  }
}
```


