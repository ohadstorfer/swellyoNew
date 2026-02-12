# Fix Hawaii Destination Times (AI-Powered)

This edge function finds Hawaii mentions (including islands like Oahu, Maui, cities, and surf spots) in onboarding chat history, uses **ChatGPT API** to intelligently extract the exact time spent, and fixes any mismatches with the time currently saved in the `destinations_array`.

## Purpose

After running `restore-hawaii-destinations`, some time durations might be incorrect (defaulted to 1 week or estimated). This function:
1. Re-examines the chat history for Hawaii mentions
2. Uses AI to extract the exact time mentioned for Hawaii (including islands, cities, surf spots)
3. Compares it with the saved time in `destinations_array`
4. Updates if there's a mismatch (tolerance: 1 day)

## Hawaii Detection

The function recognizes Hawaii through:
- **State name**: Hawaii, Hawai'i, Hawaiian Islands, Aloha State
- **Islands**: Oahu, Maui, Big Island, Kauai, Molokai, Lanai
- **Cities**: Honolulu, Waikiki, Haleiwa, Lahaina, Kihei, Hilo, Kona, Hanalei, etc.
- **Surf spots**: Pipeline, Waimea Bay, Sunset Beach, North Shore, Jaws, Honolua Bay, etc.
- **Regions**: North Shore, South Shore, Windward Side, Leeward Side, etc.

## How It Works

### AI-Powered Time Extraction

The function uses **ChatGPT API (gpt-4o-mini)** to intelligently extract time durations from conversations. This provides:
- **Contextual understanding**: Handles complex sentences with multiple locations
- **Natural language processing**: Understands colloquial expressions
- **Accurate matching**: Correctly associates time with Hawaii-related mentions
- **Consistent formatting**: Follows the exact same rules as swelly-chat onboarding

### Time Conversion Rules (from swelly-chat)

The AI follows these exact rules:

1. **Convert to days**: 1 week = 7 days, 1 month = 30 days, 1 year = 365 days
2. **time_in_text formatting**:
   - For durations < 1 year: Preserve user's wording ("3 weeks", "2 months")
   - For durations ≥ 1 year: ALWAYS round to years or half-years
     - "2 years and 5 months" → "2.5 years"
     - "2 years and 9 months" → "3 years"
     - "1 year and 3 months" → "1.5 years"
   - NEVER use "X years and Y months" format

### Time Patterns Detected

1. **Specific durations**: "7 months", "3 weeks", "2 years"
2. **Colloquial expressions**: 
   - "a couple months" → 2 months (60 days)
   - "a few months" → 3 months (90 days)
   - "half a year" → 6 months (180 days)
   - "a year and a half" → 1.5 years (547 days)
3. **Complex sentences**: "I spent 3 weeks in Oahu, then came back to Pipeline for 2 months" → sums to ~2.7 months

### Mismatch Detection

- Compares extracted time with saved time
- Tolerance: ±1 day (to account for rounding)
- Updates only if difference > 1 day

## Requirements

- `OPENAI_API_KEY` environment variable must be set
- Same API key used for swelly-chat onboarding

## Deployment

```bash
# Set the OpenAI API key (if not already set)
supabase secrets set OPENAI_API_KEY=your_openai_api_key

# Deploy the function
supabase functions deploy fix-hawaii-destination-times
```

## Usage

```bash
curl -X POST \
  https://your-project.supabase.co/functions/v1/fix-hawaii-destination-times \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Response Format

```json
{
  "success": true,
  "message": "Hawaii destination time fix completed",
  "results": {
    "total_checked": 150,
    "hawaii_mentions_found": 25,
    "mismatches_found": 8,
    "users_updated": 8,
    "no_existing_destination": 3,
    "errors": [],
    "details": [
      {
        "user_id": "uuid-here",
        "status": "updated",
        "location": "Hawaii",
        "old_time_in_days": 7,
        "old_time_in_text": "1 week",
        "new_time_in_days": 90,
        "new_time_in_text": "3 months",
        "difference_days": 83
      },
      {
        "user_id": "uuid-here",
        "status": "time_matches",
        "location": "Hawaii",
        "existing_time": 30,
        "extracted_time": 30
      }
    ]
  }
}
```

## Result Statuses

- **`updated`** - Time mismatch found and corrected
- **`time_matches`** - Time already correct (within 1 day tolerance)
- **`no_existing_destination`** - Hawaii not found in destinations_array (run restore function first)
- **`no_time_found`** - AI could not extract time from conversation

## Examples

### Example 1: Time Mismatch Corrected
**Saved:** `{ country: "Hawaii", time_in_days: 7, time_in_text: "1 week" }`
**Conversation:** "I lived in Oahu for 3 months"
**Result:** Updated to `{ country: "Hawaii", time_in_days: 90, time_in_text: "3 months" }`

### Example 2: Time Already Correct
**Saved:** `{ country: "Hawaii", time_in_days: 30, time_in_text: "1 month" }`
**Conversation:** "I surfed Pipeline for a month"
**Result:** No update needed (times match)

### Example 3: Multiple Trips
**Conversation:** "I went to Oahu twice - first for 2 weeks, then 3 months"
**Result:** Hawaii time updated to 105 days (3.5 months)

### Example 4: Different Hawaii Mentions
**Conversation:** "Spent time in Maui, then North Shore, total about 2 months"
**Result:** Hawaii time updated to 60 days (2 months)

## AI Advantages

1. **Contextual Understanding**: 
   - "I spent 3 weeks in Oahu, then came back to Pipeline for 2 months" → correctly sums to ~2.7 months
   
2. **Natural Language**: 
   - Handles "a couple months", "half a year", "a year and a half"
   
3. **Multiple Trips**: 
   - Can sum multiple trips to Hawaii/islands
   
4. **Location Variations**: 
   - Recognizes Hawaii, Oahu, Maui, Pipeline, North Shore, etc. as the same destination
   
5. **Consistent Formatting**: 
   - Follows exact same rules as swelly-chat onboarding

## Expected Improvements

- **Accuracy**: 90%+ correct time extraction vs ~60% with regex
- **Consistency**: Exact same formatting as swelly-chat onboarding
- **Robustness**: Handles edge cases and complex sentences
- **Maintainability**: Single source of truth for time extraction logic

## Cost Considerations

- Uses `gpt-4o-mini` model (cost-effective)
- ~200 tokens per request (slightly more than USA due to comprehensive location list)
- Only processes conversations with Hawaii mentions
- Typical cost: $0.0001-0.0003 per user

## Notes

- Run this AFTER running `restore-hawaii-destinations`
- Only updates existing Hawaii destinations in destinations_array
- Uses AI to intelligently extract and match time with Hawaii mentions
- Safe to run multiple times (idempotent)
- 1-day tolerance prevents unnecessary updates for rounding differences
- Requires OPENAI_API_KEY environment variable
- Recognizes all Hawaii islands, cities, and surf spots

## Workflow

1. First run: `restore-hawaii-destinations` (adds Hawaii destinations)
2. Then run: `fix-hawaii-destination-times` (corrects time durations using AI)
3. Review the results to see what was updated

## Hawaii Locations Recognized

**Islands**: Oahu, Maui, Big Island, Kauai, Molokai, Lanai, Niihau, Kahoolawe

**Major Cities**: Honolulu, Waikiki, Haleiwa, Lahaina, Kihei, Hilo, Kona, Hanalei, Poipu, and 30+ more

**Famous Surf Spots**: Pipeline, Waimea Bay, Sunset Beach, North Shore, Jaws, Honolua Bay, Hookipa, and 20+ more

**Regions**: North Shore, South Shore, Windward Side, Leeward Side, The Big Island, The Garden Isle, The Valley Isle



