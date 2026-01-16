# Swelly Trip Planning Refactor

## Overview
Refactored the swelly-trip-planning function to focus on connecting surfers rather than planning trips. Removed the destination discovery flow and simplified the conversation.

## Key Changes

### 1. Updated Initial Greeting
**Before:**
```
"Hey man, let's plan your next trip together. You know where you're headed, or wanna work it out with me?"
```

**After:**
```
"Hey 🤙 I can connect you with surfers like you, or match you with someone who's surfed a destination you're curious about. Tell me what you're looking for"
```

### 2. Removed STEP 2B (Destination Discovery Flow)
- Removed the 6-question destination discovery flow
- Removed all references to time/season, wave type, travel distance, water temperature, crowd tolerance, and remoteness questions
- Simplified flow: User mentions destination → Extract → Proceed to STEP 3

### 3. Simplified Conversation Flow
**New Flow:**
1. **STEP 1**: Initial greeting (always ask the new question)
2. **STEP 2**: Extract destination (if mentioned) or handle general matching
3. **STEP 3**: Clarify purpose
4. **STEP 4**: Non-negotiable criteria
5. **STEP 5**: Provide options (finish conversation)
6. **STEP 6**: Quick match (if user directly asks for surfers)

### 4. Updated Priority Scoring System
**New Structure:**
```json
"prioritize_filters": {
  "origin_country": { "value": "Israel", "priority": 20 },
  "board_type": { "value": "shortboard", "priority": 15 },
  "surf_level": { "value": 4, "priority": 30 },
  // ... etc
}
```

**Priority Scores:**
- **1-10**: Nice to have (e.g., "I'd like someone around my age" → priority: 8)
- **10-30**: Very helpful (e.g., "prioritize surfers from Israel" → priority: 20)
- **30-50**: Major advantage (e.g., "prioritize advanced surfers" for advanced spot → priority: 40)
- **100**: Exception (e.g., "really need someone who's been there for months" → priority: 100)

### 5. Destination-Based Matching Logic
When user requests surfers who surfed/stayed/traveled in a specific place:

1. **Search for users who surfed in that country**
   - Check `destinations_array` for matching `country` field

2. **If user requested a specific area/town:**
   - Search within the `area` array within `destinations_array` to find the requested area
   - **Surfers who have the requested area in their `area` array appear FIRST** (higher priority)
   - Then, surfers who only been in that country (without the specific area) appear after

**Example:**
- User requests: "Costa Rica, Tamarindo"
- Priority 1: Surfers with `destinations_array` containing `{country: "Costa Rica", area: ["Tamarindo", ...]}`
- Priority 2: Surfers with `destinations_array` containing `{country: "Costa Rica", area: []}`

### 6. Intent-Driven Rules
Different request types have different matching requirements:

- **Surf spots**: Country + Area required, Town only if explicitly needed, Skill level required
- **Hikes**: Area required, Extra weight for like-minded travelers
- **Stays / providers**: Area required, Town if requested, Budget + lifestyle matter
- **Equipment**: Area required, Priority on experience, Surf style should NOT be inferred as required (shortboarders can recommend longboard shops)
- **Choosing towns within an area**: Area required, Priority on time spent in area + like-minded travelers

## Implementation Notes

### Matching Service Updates Needed
The actual matching logic needs to be implemented in the matching service (`src/services/matching/`). The swelly-trip-planning function now:
- Collects the request data
- Extracts destination, area, and criteria
- Returns structured data for matching

### Database Query Logic
For destination-based matching, the matching service should:
1. Query surfers where `destinations_array` contains the requested country
2. If area is specified:
   - First: Filter where `area` array contains the requested area
   - Then: Include surfers with matching country but empty or different areas
3. Apply priority scoring based on `prioritize_filters`
4. Sort by: area match first, then priority scores, then other criteria

## Files Modified

- `supabase/functions/swelly-trip-planning/index.ts`
  - Updated `TRIP_PLANNING_PROMPT` with new greeting
  - Removed STEP 2B (destination discovery flow)
  - Simplified STEP 2 to handle both destination-based and general matching
  - Updated `prioritize_filters` structure with priority scoring
  - Added intent-driven matching rules
  - Added destination-based matching logic documentation

## Next Steps

1. **Update Matching Service**: Implement the destination-based matching logic with area priority
2. **Implement Priority Scoring**: Update matching algorithm to use priority scores (1-10, 10-30, 30-50, 100)
3. **Test Intent-Driven Rules**: Verify different request types (surf spots, hikes, stays, equipment, choosing towns) work correctly
4. **Update Frontend**: Ensure frontend handles the new data structure for `prioritize_filters`

## Example Request Flow

**User:** "I want to connect with surfers who've been to Costa Rica, specifically Tamarindo"

**System Response:**
1. Extracts: `destination_country: "Costa Rica"`, `area: "Tamarindo"`
2. Queries surfers with:
   - Priority 1: `destinations_array` containing `{country: "Costa Rica", area: ["Tamarindo", ...]}`
   - Priority 2: `destinations_array` containing `{country: "Costa Rica", area: []}`
3. Applies any additional criteria (age, surf level, etc.)
4. Returns sorted results with area matches first

