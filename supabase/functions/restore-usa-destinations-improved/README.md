# Restore USA Destinations - Improved

This edge function recovers USA surf destinations from onboarding chat history and adds them to users' `destinations_array` in the `surfers` table.

## Features

### Enhanced Location Detection
- **All 50 US states** recognized
- **100+ surf cities** mapped to their states (San Diego, Santa Cruz, Miami, etc.)
- **50+ famous surf spots** mapped to their states (Pipeline, Mavericks, Trestles, etc.)
- **Regional nicknames** recognized (OBX, SoCal, NorCal, North Shore, etc.)

### Multi-Layered Extraction
The function uses a 5-layer approach to extract US locations:

1. **Explicit state mentions** - Direct state names (California, Hawaii, Florida, etc.)
2. **Surf spot inference** - Famous spots → state (Pipeline → Hawaii)
3. **City inference** - Surf cities → state (San Diego → California)
4. **Regional nickname inference** - Nicknames → state (OBX → North Carolina)
5. **Generic USA fallback** - USA mentioned but no specific location → "United States"

### Intelligent Features
- **Automatic state inference** from cities and surf spots
- **Area population** - Adds cities/spots to the `area` array
- **Improved time estimation** - Parses various time formats
- **Duplicate prevention** - Won't add if location already exists
- **Smart fallback** - Won't add generic "United States" if specific state exists

## Deployment

```bash
# Deploy the function
supabase functions deploy restore-usa-destinations-improved
```

## Usage

### Invoke via HTTP

```bash
curl -X POST \
  https://your-project.supabase.co/functions/v1/restore-usa-destinations-improved \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Invoke via Supabase Dashboard

1. Go to Edge Functions in your Supabase dashboard
2. Find `restore-usa-destinations-improved`
3. Click "Invoke" button
4. Review the results

## Response Format

```json
{
  "success": true,
  "message": "USA destination recovery completed",
  "results": {
    "total_checked": 150,
    "usa_mentions_found": 45,
    "specific_states_found": 38,
    "generic_usa_added": 7,
    "users_updated": 42,
    "errors": [],
    "details": [
      {
        "user_id": "uuid-here",
        "status": "updated",
        "location": "California",
        "areas": ["San Diego", "South County"],
        "time_in_days": 210,
        "time_in_text": "7 months"
      },
      {
        "user_id": "uuid-here",
        "status": "updated",
        "location": "Hawaii",
        "areas": ["Pipeline"],
        "time_in_days": 30,
        "time_in_text": "1 month"
      }
    ]
  }
}
```

## Result Statuses

- **`updated`** - Destination successfully added
- **`already_exists`** - Location already in destinations_array
- **`has_specific_state`** - Generic USA skipped because specific state exists
- **`usa_mentioned_no_extraction`** - USA mentioned but extraction failed

## Examples

### Example 1: Specific State Mentioned
**Conversation:** "I surfed California for 3 months"
**Result:** 
```json
{
  "country": "California",
  "area": [],
  "time_in_days": 90,
  "time_in_text": "3 months"
}
```

### Example 2: City Mentioned
**Conversation:** "I lived in San Diego for 7 months"
**Result:**
```json
{
  "country": "California",
  "area": ["San Diego"],
  "time_in_days": 210,
  "time_in_text": "7 months"
}
```

### Example 3: Surf Spot Mentioned
**Conversation:** "I surfed Pipeline for a month"
**Result:**
```json
{
  "country": "Hawaii",
  "area": ["Pipeline"],
  "time_in_days": 30,
  "time_in_text": "1 month"
}
```

### Example 4: Regional Nickname
**Conversation:** "I spent 2 weeks in OBX"
**Result:**
```json
{
  "country": "North Carolina",
  "area": ["OBX"],
  "time_in_days": 14,
  "time_in_text": "2 weeks"
}
```

### Example 5: Generic USA
**Conversation:** "I surfed in the USA for a few months"
**Result:**
```json
{
  "country": "United States",
  "area": [],
  "time_in_days": 90,
  "time_in_text": "3 months"
}
```

## Duplicate Prevention

The function prevents duplicates by:
1. Checking if the exact location already exists (case-insensitive)
2. Skipping generic "United States" if any specific US state exists
3. Logging all skipped entries in the results

## Error Handling

- Database errors are logged and included in the `errors` array
- Individual user errors don't stop the entire process
- Detailed error messages include user_id for troubleshooting

## Location Mappings

### States Covered
All 50 US states plus Puerto Rico and Virgin Islands

### Major Surf Cities (100+)
California: San Diego, Santa Cruz, Huntington Beach, Malibu, etc.
Hawaii: Honolulu, Haleiwa, Lahaina, Hanalei, etc.
Florida: Miami, Cocoa Beach, New Smyrna Beach, etc.
And many more...

### Famous Surf Spots (50+)
Pipeline, Mavericks, Trestles, Rincon, Sebastian Inlet, etc.

### Regional Nicknames
OBX, SoCal, NorCal, North Shore, South County, etc.

## Notes

- The function only processes onboarding conversations (where `conversation_type` is 'onboarding' or null)
- Time estimation defaults to 1 week if no duration is mentioned
- All location matching is case-insensitive
- The function is idempotent - safe to run multiple times





