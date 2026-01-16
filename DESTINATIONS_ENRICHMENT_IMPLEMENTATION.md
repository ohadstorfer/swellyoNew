# Destinations Enrichment Implementation

## Overview
Improved the onboarding process to save destinations in the new format with automatic area enrichment using GPT API.

## Features Implemented

### 1. New Destinations Format Support
- Handles the new `{country, area[]}` format
- Maintains backward compatibility with legacy `destination_name` format
- Automatically converts legacy format to new format

### 2. Country-Only Destinations
- If user mentions only a country (no area/town), saves with empty `area` array: `{country: "Australia", area: []}`

### 3. Area Enrichment
- When user mentions an area/town, that area is saved as the **first** item in the `area` array
- GPT API is called to research and find:
  - Common nicknames for the area
  - Alternative names surfers might use
  - Nearby small towns in the same surf region
  - Other ways surfers might refer to this location
- Related names are added to the `area` array after the original area

### 4. Multiple Areas Handling
- If user mentions multiple areas (e.g., "Gold Coast, Byron Bay, Noosa"), all are preserved
- Only the **first** area is enriched with related names
- Additional user-mentioned areas are appended after the enriched names
- Duplicates are removed while preserving order

## Implementation Details

### New Functions

#### `enrichAreaWithRelatedNames(country: string, area: string): Promise<string[]>`
- Calls GPT API to find related area names
- Returns array with original area first, followed by related names
- Handles errors gracefully (returns original area if API fails)

#### `processDestinationsArray(destinations: any[]): Promise<any[]>`
- Processes all destinations from GPT response
- Handles both new and legacy formats
- Enriches areas for destinations that have them
- Returns destinations in new format: `{country, area[], time_in_days, time_in_text}`

### Integration Points

1. **swelly-chat function** (`supabase/functions/swelly-chat/index.ts`)
   - Processes destinations when conversation finishes
   - Enriches areas before saving to database
   - Works in both `/new_chat` and `/continue/:chat_id` routes

## Example Flow

### Input from User:
```
"I spent 3 months in Costa Rica, mostly in Tamarindo"
```

### GPT Response (before enrichment):
```json
{
  "country": "Costa Rica",
  "area": ["Tamarindo"],
  "time_in_days": 90,
  "time_in_text": "3 months"
}
```

### After Enrichment:
```json
{
  "country": "Costa Rica",
  "area": ["Tamarindo", "Tama", "Playa Tamarindo", "Langosta", "Playa Grande", "Avellanas"],
  "time_in_days": 90,
  "time_in_text": "3 months"
}
```

### Country-Only Example:
```
"I was in Australia for 6 months"
```

### Result:
```json
{
  "country": "Australia",
  "area": [],
  "time_in_days": 180,
  "time_in_text": "6 months"
}
```

### Multiple Areas Example:
```
"I spent time in Gold Coast, Byron Bay, and Noosa"
```

### Result:
```json
{
  "country": "Australia",
  "area": ["Gold Coast", "GC", "Surfers Paradise", "Burleigh Heads", "Coolangatta", "Tweed Heads", "Byron Bay", "Noosa"],
  "time_in_days": 84,
  "time_in_text": "12 weeks"
}
```

## Benefits

1. **Better Matching**: Users can be matched even if they use different names for the same area
2. **Comprehensive Coverage**: Includes nicknames and nearby towns that surfers commonly use
3. **User-Friendly**: Original area name is always first, preserving user intent
4. **Flexible**: Handles country-only, single area, and multiple areas

## Error Handling

- If GPT API fails, returns original area only (graceful degradation)
- If OpenAI API key is not configured, returns original area only
- Invalid destinations are skipped with warning logs
- All errors are logged but don't break the onboarding flow

## Files Modified

- `supabase/functions/swelly-chat/index.ts`
  - Added `enrichAreaWithRelatedNames()` function
  - Added `processDestinationsArray()` function
  - Updated response processing to enrich destinations before saving

## Testing Recommendations

1. Test with country-only destinations
2. Test with single area destinations
3. Test with multiple areas
4. Test with legacy format (backward compatibility)
5. Test error handling (API failures, missing keys)

