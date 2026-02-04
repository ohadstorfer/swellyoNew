# Fix midlength Enum Mismatch

## Problem

The database enum for mid-length board type is `mid_length` (with underscore), but the code is using `midlength` (without underscore) in some places, causing database errors:

```
Error querying surfers: invalid input value for enum surfboard_type: "midlength"
```

## Root Cause Analysis

The correct enum value is `mid_length` (as defined in `src/utils/surfLevelMapping.ts` and the database schema), but there are inconsistencies:

1. **TripPlanningChatScreen.tsx line 398**: Uses `'midlength'` for display purposes (this is OK for display, but not for database queries)
2. **matchingService.ts**: Has mappings that convert `'mid_length'` to `'midlength'` for display (lines 1606, 1736, 1802, 1853) - these are OK for display
3. **The actual issue**: Somewhere the board type is being sent to the database query as `'midlength'` instead of `'mid_length'`

## Investigation Needed

The error occurs when querying surfers, which happens in `matchingService.ts`. The query is built using `request.queryFilters.surfboard_type` or `request.non_negotiable_criteria.surfboard_type`. 

**Hypothesis**: The board type might be coming from the backend (Supabase function) as `'midlength'` instead of `'mid_length'`, OR there's a conversion happening incorrectly in the frontend before the query.

## Solution

1. **Verify the source**: Check where `surfboard_type` values are being set in the request data
2. **Add conversion layer**: Ensure all board type values are converted to the correct enum format (`mid_length`) before being used in database queries
3. **Fix any incorrect mappings**: Replace any `'midlength'` values with `'mid_length'` where they're used for database operations (not just display)

## Implementation Steps

### Step 1: Add Board Type Enum Normalization

Create a utility function to normalize board type enum values before database queries:

**File**: `src/services/matching/matchingService.ts`

Add a helper function at the top of the file:
```typescript
/**
 * Normalize board type enum to database format
 * Converts any variations (midlength, mid-length, etc.) to correct enum (mid_length)
 */
function normalizeBoardTypeEnum(boardType: string): string {
  const normalized = boardType.toLowerCase().trim();
  if (normalized === 'midlength' || normalized === 'mid-length' || normalized === 'mid length') {
    return 'mid_length';
  }
  return normalized; // shortboard, longboard, soft_top are already correct
}
```

### Step 2: Normalize Board Types Before Database Queries

In `matchingService.ts`, normalize board types before using them in queries:

**Location**: Around line 890-900 where `queryFilters.surfboard_type` is used:
```typescript
if (request.queryFilters.surfboard_type) {
  const surfboardTypes = Array.isArray(request.queryFilters.surfboard_type) 
    ? request.queryFilters.surfboard_type 
    : [request.queryFilters.surfboard_type];
  if (surfboardTypes.length > 0) {
    // Normalize board types to correct enum format
    const normalizedTypes = surfboardTypes.map(normalizeBoardTypeEnum);
    query = query.in('surfboard_type', normalizedTypes);
    console.log(`  - Filtering by surfboard_type: ${normalizedTypes.join(', ')}`);
  }
}
```

**Location**: Around line 920-925 where `non_negotiable_criteria.surfboard_type` is used:
```typescript
if (request.non_negotiable_criteria?.surfboard_type && request.non_negotiable_criteria.surfboard_type.length > 0) {
  const normalizedTypes = request.non_negotiable_criteria.surfboard_type.map(normalizeBoardTypeEnum);
  query = query.in('surfboard_type', normalizedTypes);
  console.log(`  - Also filtering by surfboard_type: ${normalizedTypes.join(', ')}`);
}
```

### Step 3: Verify Backend Response

Check if the Supabase function (`swelly-trip-planning`) is correctly returning `'mid_length'` in the response. The function already has logic to convert `'midlength'` to `'mid_length'` (line 2341-2345), so this should be OK, but verify the response data.

### Step 4: Update Display Mappings (Optional)

The display mappings in `matchingService.ts` (lines 1606, 1736, 1802, 1853) that convert `'mid_length'` to `'midlength'` for user-facing messages are fine - these are only for display, not database queries.

## Files to Modify

1. `src/services/matching/matchingService.ts` - Add normalization function and apply it before database queries
2. (Optional) `src/services/matching/matchingServiceV3.ts` - Apply same fix if it has similar code

## Testing

After implementing:
- [ ] Test trip planning search with mid-length board type
- [ ] Verify no database enum errors occur
- [ ] Verify matches are returned correctly
- [ ] Check console logs to confirm normalized enum values are used

## Alternative Approach (If Normalization Doesn't Work)

If the issue persists, trace the data flow:
1. Check what the Supabase function returns in `response.data.queryFilters.surfboard_type`
2. Add logging to see the exact value being sent to the database query
3. Fix at the source (wherever `'midlength'` is being set instead of `'mid_length'`)

