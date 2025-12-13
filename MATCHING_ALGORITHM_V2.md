# Matching Algorithm V2 - Draft Flow

## Overview
This document outlines the V2 matching algorithm with prioritized filtering. The algorithm uses a point-based scoring system where users are matched based on their compatibility with the requesting user's trip planning criteria.

---

## Phase 1: Data Gathering

During the trip planning conversation with Swelly, the following data must be collected:

### Required Fields

1. **`destination_country`** (required, string)
   - Example: `"Sri Lanka"`
   - The country where the user wants to travel

2. **`area`** (required, string)
   - Example: `"South"` or `"Weligama"` or `"Arugam"`
   - The specific area/region within the destination country

3. **`budget`** (required, number: 1-3)
   - `1`: Low budget
   - `2`: Medium budget
   - `3`: High budget

### Optional Fields

4. **`prioritize_filters`** (optional, object/map)
   - A map of field names to filter values based on user prompts
   - Example: `{"origin_country": "Israel", "board_type": "shortboard"}`
   - Extracted from phrases like "prioritize longboarders" or "I prefer surfers from Israel"
   - **Key fields that can be prioritized:**
     - `origin_country` / `country_from`: Country of origin
     - `board_type` / `surfboard_type`: Type of surfboard
     - `surf_level`: Surfing skill level
     - `age_range`: Age range
     - `lifestyle_keywords`: Specific lifestyle interests
     - `wave_type_keywords`: Specific wave preferences
     - `travel_experience`: Travel experience level
     - `group_type` / `travel_buddies`: Travel companion preference

---

## Phase 2: Matching Algorithm

### Step 1: Generate Area Array Using LLM

**Input:**
- `destination_country`: "Sri Lanka"
- `area`: "South"

**Process:**
- Use LLM to generate an array of related areas/regions
- The LLM should understand geographic context and return similar/related areas

**Output:**
- `generatedAreas`: `["South", "Weligama", "Hirekatiya", "Ahangama", "Midigama", "Kabalana"]`

**Implementation Note:**
- This can reuse the existing `generateAreaArray()` function or enhance it
- The LLM should consider:
  - Geographic proximity
  - Common surf destinations in the region
  - Alternative spellings/variations

---

### Step 2: Initialize User Points Map

**Process:**
- Create a map/dictionary: `user_points`
- Key: `user_id` or `email` (unique identifier)
- Value: `points` (number, initialized to 0)

**Data Structure:**
```typescript
const user_points: Map<string, number> = new Map();
```

---

### Step 3: Query Users with Matching Destinations

**Query:**
- Query all users from the `surfers` table where:
  - Their `destinations_array` contains the requested `destination_country`
  - Exclude the user making the request (`user_id != requestingUserId`)

**SQL/Query Logic:**
```sql
SELECT * FROM surfers 
WHERE user_id != :requestingUserId
AND destinations_array @> '[{"destination_name": "..."}]'::jsonb
-- Where destination_name contains the requested country
```

**Implementation:**
- Filter `destinations_array` JSONB field to find entries where `destination_name` contains the `destination_country`
- Use the existing `destinationContainsCountry()` function (enhanced in V2)

---

### Step 4: Initialize Points with Days Spent

**For each user returned from Step 3:**

1. Find the destination entry in their `destinations_array` that matches the requested `destination_country`
2. Extract `time_in_days` from that entry
3. Initialize the user's points in `user_points` map with this value

**Example:**
```typescript
// User has: destinations_array = [
//   {destination_name: "Sri Lanka, Weligama", time_in_days: 45},
//   {destination_name: "Indonesia, Bali", time_in_days: 30}
// ]
// Requested: destination_country = "Sri Lanka"
// Initialize: user_points.set(user_id, 45) // 45 days spent in Sri Lanka
```

**Edge Cases:**
- If user has multiple entries for the same country, sum the `time_in_days`
- If no matching destination found, initialize with 0 points (user will still be considered if they pass other filters)

---

### Step 5: Add Points for Area Matches

**For each user:**

1. Check if any of the `generatedAreas` from Step 1 appear in their matching destination entry
2. If yes, add **30 points** to their score in `user_points`

**Example:**
```typescript
// Generated areas: ["South", "Weligama", "Ahangama"]
// User destination: "Sri Lanka, Weligama"
// Match found: "Weligama" → Add 30 points
```

**Implementation:**
- Check if any area from `generatedAreas` is contained in the `destination_name` of the matching destination entry
- Use case-insensitive matching
- Multiple area matches still only add 30 points (not cumulative)

---

### Step 6: Add Points for Budget Compatibility

**For each user:**

1. Get the user's `travel_type` field
2. Map it to numeric budget:
   - `"budget"` → `1`
   - `"mid"` → `2`
   - `"high"` → `3`
3. Calculate points: `30 - (abs(requested_budget - user_budget) * 15)`
4. Ensure minimum of 0 points (no negative scores)
5. Maximum of 30 points

**Formula:**
```typescript
const budgetPoints = Math.max(0, Math.min(30, 30 - (Math.abs(requestedBudget - userBudget) * 15)));
```

**Examples:**
- Requested: `2` (medium), User: `2` (medium) → `30 - (0 * 15) = 30 points` ✅
- Requested: `2` (medium), User: `1` (low) → `30 - (1 * 15) = 15 points`
- Requested: `2` (medium), User: `3` (high) → `30 - (1 * 15) = 15 points`
- Requested: `1` (low), User: `3` (high) → `30 - (2 * 15) = 0 points`

**Add the calculated points to `user_points`**

---

### Step 7: Add Points for Surf Level Compatibility

**For each user:**

1. Get the requesting user's `surf_level` and the candidate user's `surf_level`
2. Use the same formula as budget: `30 - (abs(requested_surf_level - user_surf_level) * 15)`
3. Ensure minimum of 0, maximum of 30

**Formula:**
```typescript
const surfLevelPoints = Math.max(0, Math.min(30, 30 - (Math.abs(requestedSurfLevel - userSurfLevel) * 15)));
```

**Add the calculated points to `user_points`**

---

### Step 8: Add Points for Travel Experience Compatibility

**For each user:**

1. Map travel experience strings to numbers:
   - `"new_nomad"` → `1`
   - `"rising_voyager"` → `2`
   - `"wave_hunter"` → `3`
   - `"chicken_joe"` → `4`
2. Get requesting user's `travel_experience` and candidate user's `travel_experience`
3. Use the same formula: `30 - (abs(requested_experience - user_experience) * 15)`
4. Ensure minimum of 0, maximum of 30

**Formula:**
```typescript
const travelExpPoints = Math.max(0, Math.min(30, 30 - (Math.abs(requestedTravelExp - userTravelExp) * 15)));
```

**Add the calculated points to `user_points`**

---

### Step 9: Add Points for Surfboard Type Match

**For each user:**

1. Compare `surfboard_type` between requesting user and candidate user
2. If they match exactly, add **30 points** to `user_points`

**Example:**
```typescript
// Requesting user: surfboard_type = "shortboard"
// Candidate user: surfboard_type = "shortboard"
// Match → Add 30 points
```

**Add 30 points to `user_points` if match**

---

### Step 10: Add Points for Group Type Match

**For each user:**

1. Compare `travel_buddies` between requesting user and candidate user
2. Map to numeric values:
   - `"solo"` → `1`
   - `"2"` → `2`
   - `"crew"` → `3`
3. If they match exactly, add **30 points** to `user_points`

**Add 30 points to `user_points` if match**

---

### Step 11: Add Points for Lifestyle Keywords

**For each user:**

1. Get requesting user's `lifestyle_keywords` array
2. Get candidate user's `lifestyle_keywords` array
3. Find common keywords (intersection)
4. For each matching keyword, add **5 points** to `user_points`

**Example:**
```typescript
// Requesting user: ["remote-work", "party", "yoga"]
// Candidate user: ["remote-work", "yoga", "diving"]
// Common: ["remote-work", "yoga"]
// Points: 2 matches × 5 = 10 points
```

**Add 5 points per matching keyword**

---

### Step 12: Add Points for Wave Type Keywords

**For each user:**

1. Get requesting user's `wave_type_keywords` array
2. Get candidate user's `wave_type_keywords` array
3. Find common keywords (intersection)
4. For each matching keyword, add **5 points** to `user_points`

**Add 5 points per matching keyword**

---

### Step 13: Add Points for Prioritized Filters

**For each user:**

1. Iterate through each key-value pair in `prioritize_filters`
2. For each filter:
   - Check if the candidate user matches the filter value
   - If match, add **50 points** to `user_points`

**Example:**
```typescript
// prioritize_filters = {
//   "origin_country": "Israel",
//   "board_type": "shortboard"
// }
// Candidate user: country_from = "Israel", surfboard_type = "shortboard"
// Matches: 2 filters × 50 = 100 points
```

**Supported Filter Fields:**
- `origin_country` / `country_from`: Exact match or contains
- `board_type` / `surfboard_type`: Exact match
- `surf_level`: Exact match or within range
- `age_range`: Check if user's age is within range
- `lifestyle_keywords`: Check if any keyword matches
- `wave_type_keywords`: Check if any keyword matches
- `travel_experience`: Exact match
- `group_type` / `travel_buddies`: Exact match

**Add 50 points per matching prioritized filter**

---

### Step 14: Sort and Return Top 3 Users

**Process:**

1. Convert `user_points` map to an array of `[user_id, points]` pairs
2. Sort by points in descending order (highest points first)
3. Take the top 3 users
4. For each user, fetch their full profile data
5. Return formatted `MatchedUser` objects with:
   - User profile information
   - `match_score`: The calculated points
   - `matched_areas`: Array of areas that matched (from Step 5)
   - `common_lifestyle_keywords`: Common keywords (from Step 11)
   - `common_wave_keywords`: Common keywords (from Step 12)
   - `days_in_destination`: Days spent in destination (from Step 4)

**Return Type:**
```typescript
MatchedUser[] // Array of top 3 matched users
```

---

## Point System Summary

| Criteria | Points | Notes |
|----------|--------|-------|
| Base (days in destination) | `time_in_days` | Initial score |
| Area match | +30 | If any generated area matches |
| Budget compatibility | 0-30 | Formula: `30 - (abs(requested - user) * 15)` |
| Surf level compatibility | 0-30 | Formula: `30 - (abs(requested - user) * 15)` |
| Travel experience compatibility | 0-30 | Formula: `30 - (abs(requested - user) * 15)` |
| Surfboard type match | +30 | Exact match only |
| Group type match | +30 | Exact match only |
| Lifestyle keyword match | +5 | Per matching keyword |
| Wave keyword match | +5 | Per matching keyword |
| Prioritized filter match | +50 | Per matching filter (highest priority) |

**Maximum Theoretical Score:**
- Base: Unlimited (depends on days)
- All matches: 30 + 30 + 30 + 30 + 30 + 30 + (keywords × 5) + (prioritized × 50)
- Typical range: 50-300+ points

---

## Implementation Considerations

### Type Definitions Needed

```typescript
interface TripPlanningRequestV2 {
  destination_country: string; // Required
  area: string; // Required
  budget: 1 | 2 | 3; // Required
  prioritize_filters?: {
    origin_country?: string;
    board_type?: string;
    surf_level?: number;
    age_range?: [number, number];
    lifestyle_keywords?: string[];
    wave_type_keywords?: string[];
    travel_experience?: string;
    group_type?: string;
  };
}
```

### Integration Points

1. **LLM Integration:**
   - Enhance `generateAreaArray()` function or create new one
   - Add `extractPrioritizeFilters()` function to parse user prompts

2. **Database Query:**
   - Optimize JSONB query for `destinations_array` filtering
   - Consider indexing on `destinations_array` for performance

3. **Scoring Logic:**
   - Create new `calculateV2Score()` function
   - Replace or supplement existing `findMatchingUsers()` function

4. **Data Extraction:**
   - Update Supabase Edge Function to extract `prioritize_filters` from conversation
   - Add validation for required fields (`destination_country`, `area`, `budget`)

---

## Example Flow

### Input:
```json
{
  "destination_country": "Sri Lanka",
  "area": "South",
  "budget": 2,
  "prioritize_filters": {
    "origin_country": "Israel",
    "board_type": "shortboard"
  }
}
```

### Process:
1. Generate areas: `["South", "Weligama", "Ahangama", ...]`
2. Query users with "Sri Lanka" in destinations
3. For each user:
   - Base: 45 days (example)
   - Area match: +30 (Weligama matches)
   - Budget: +30 (both medium)
   - Surf level: +15 (1 level difference)
   - Travel exp: +30 (same level)
   - Board type: +30 (both shortboard)
   - Group type: +0 (different)
   - Lifestyle keywords: +10 (2 matches)
   - Wave keywords: +5 (1 match)
   - Prioritized: +100 (2 matches: origin + board)
   - **Total: 295 points**

### Output:
Top 3 users sorted by points, with full profile data and match details.

---

## Migration Strategy

1. **Phase 1:** Implement V2 alongside V1 (feature flag)
2. **Phase 2:** Test V2 with sample data
3. **Phase 3:** Gradually migrate users to V2
4. **Phase 4:** Deprecate V1 after validation

---

## Notes

- The algorithm prioritizes users who have spent more time in the destination (base score)
- Prioritized filters have the highest weight (50 points) to ensure user preferences are respected
- Area matching helps find users familiar with the specific region
- Compatibility scoring (budget, surf level, travel exp) rewards similar preferences
- Keyword matching allows for flexible lifestyle/wave preference alignment

