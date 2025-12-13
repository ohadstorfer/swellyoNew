# Trip Planning Flow Update - Summary

## Overview
Updated the Swelly trip planning conversation flow and matching algorithm to support a more sophisticated, step-by-step process with dynamic filtering and weighting.

## Key Changes

### 1. Updated Conversation Flow (`supabase/functions/swelly-trip-planning/index.ts`)

**New Flow:**
1. **Entry Point**: "You know where you're headed, or wanna work it out with me?"
   - If "Ya" → Get destination → Clarify purpose → Non-negotiable criteria → Provide options
   - If "Na" → Ask follow-up questions → Suggest destinations → Get approval → Continue

2. **Purpose Clarification**: "Are you looking for specific advice, general help and guidance, or just connecting with a like-minded traveler?"

3. **Non-Negotiable Criteria**: "Are there any non-negotiable parameters for the travelers you wanna get advice from?"

4. **Destination Suggestions**: When user doesn't know, Swelly suggests 2-3 destinations based on their profile and preferences, then gets explicit approval.

**New Data Structure:**
```typescript
{
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
  };
  user_context?: {
    mentioned_preferences?: string[];
    mentioned_deal_breakers?: string[];
  };
}
```

### 2. Enhanced Matching Algorithm (`src/services/matching/matchingService.ts`)

**New Filtering & Weighting System:**

#### Phase 1: Must-Have Filters
- Filters out users who don't match explicit user requests
- Checks: country_from, surfboard_type, age_range, surf_level_min/max, must_have_keywords
- **Applied FIRST** - anyone who doesn't pass is excluded

#### Phase 2: Dynamic Weighting
- Weights adjust based on purpose:
  - **connect_traveler**: Higher weight on lifestyle, wave preferences, surf level, board type
  - **specific_advice**: Higher weight on destination experience, surf level (expertise)
  - **general_guidance**: Balanced, but destination experience matters more
- Weights adjust based on user context preferences (e.g., "loves yoga" → lifestyle weight increases)

#### Phase 3: AI/Context Filters
- Applies multipliers based on context:
  - **Same country + visa question** → 1.5x multiplier
  - **Wave/surf spot questions** → 1.3x multiplier for equal/higher surf level
  - **Accommodation questions** → 1.2x multiplier (prioritizes longer stays)

#### Phase 4: General Scoring
- Uses adjusted weights for:
  - Destination days (weighted)
  - Area matches
  - Budget similarity
  - Surf level similarity
  - Travel experience similarity
  - Board type match
  - Group type match
  - Lifestyle keywords (weighted)
  - Wave keywords (weighted)

### 3. Updated Types (`src/types/tripPlanning.ts`)

- Extended `TripPlanningRequest` to include all new fields
- Extended `TripPlanningData` to match new structure
- All fields are optional except `destination_country` and `destination_known`

### 4. Updated ChatScreen (`src/screens/ChatScreen.tsx`)

- Trip planning initialization now includes user profile context
- Passes complete request object to matching service
- Handles new data structure from Swelly

## Example Scenarios

### Scenario 1: User Knows Destination
1. Swelly: "You know where you're headed, or wanna work it out with me?"
2. User: "Ya"
3. Swelly: "Where are you thinking?"
4. User: "Sri Lanka"
5. Swelly: "Which area?"
6. User: "South"
7. Swelly: "What are you looking for - specific advice, general guidance, or connecting with travelers?"
8. User: "I want to ask about visa requirements"
9. Swelly: "Any non-negotiables? Like only from Israel, similar age?"
10. User: "Yes, only from Israel"
11. Swelly: "Copy! Here are your matches..." (finds Israeli users who've been to Sri Lanka)

### Scenario 2: User Doesn't Know Destination
1. Swelly: "You know where you're headed, or wanna work it out with me?"
2. User: "Na"
3. Swelly: (Uses user's profile context) "Cool! What's your budget range?"
4. User: "Mid-range, around 7000 ILS"
5. Swelly: "What kind of waves are you after?"
6. User: "Barrels, fast waves"
7. Swelly: "Based on your vibe (pro surfer, shortboard, loves nature, authenticity), here are 3 spots that might work: [suggests destinations]"
8. User: "Sri Lanka sounds good"
9. Swelly: "Which area in Sri Lanka?"
10. User: "South"
11. Swelly: Continues with purpose and criteria questions...

## Matching Examples

### Example 1: Visa Question from Israeli
- **Must-have filter**: country_from = "Israel" → Only Israeli users pass
- **Context filter**: Same country + visa topic → 1.5x multiplier
- **Result**: Israeli users who've been to destination ranked highest

### Example 2: Wave Advice Request
- **Purpose**: specific_advice with topic "best waves"
- **Dynamic weights**: surf_level_weight = 50, board_type_weight = 40
- **Context filter**: Wave questions → 1.3x for equal/higher level
- **Result**: Higher-level surfers with same board type ranked highest

### Example 3: Connect with Like-Minded Traveler
- **Purpose**: connect_traveler
- **Dynamic weights**: lifestyle_weight = 10, wave_weight = 8, surf_level_weight = 40
- **Result**: Users with matching lifestyle, wave preferences, and similar surf level ranked highest

## Testing Checklist

- [ ] Test "Ya" flow (user knows destination)
- [ ] Test "Na" flow (user doesn't know destination)
- [ ] Test destination suggestions based on profile
- [ ] Test must-have filters (country, board type, age, etc.)
- [ ] Test purpose-based weighting
- [ ] Test context filters (visa question, wave questions, etc.)
- [ ] Test matching with non-negotiable criteria
- [ ] Verify top 3 matches are returned correctly

## Notes

- The matching algorithm now supports much more nuanced matching
- Must-have filters ensure users get exactly what they ask for
- Dynamic weighting ensures the right attributes are prioritized based on context
- Context filters boost relevant matches (e.g., same country for visa questions)
- All changes are backward compatible (optional fields)


