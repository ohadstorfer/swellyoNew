# Destinations Array Redesign

## Overview
The `destinations_array` column in the `surfers` table has been redesigned to use a more structured format with separate `country` and `area` fields instead of a single `destination_name` string.

## New Structure

### Before (Legacy Format)
```json
[
  {
    "destination_name": "Australia, Gold Coast",
    "time_in_days": 84,
    "time_in_text": "12 weeks"
  }
]
```

### After (New Format)
```json
[
  {
    "country": "Australia",
    "area": ["Gold Coast", "Byron Bay", "Noosa"],
    "time_in_days": 84,
    "time_in_text": "12 weeks"
  }
]
```

## Key Changes

1. **`country`** (string): The country name (e.g., "Australia", "Costa Rica")
2. **`area`** (string[]): An array of area/town names (e.g., ["Gold Coast", "Byron Bay", "Noosa"])
   - Can contain multiple values (3+ towns/areas)
   - Empty array `[]` if no specific areas are mentioned

## Migration

### Database Migration
Run the migration script to convert existing data:
```sql
-- Located at: supabase/migrations/migrate_destinations_array_structure.sql
```

This migration:
- Converts existing `destination_name` strings to `country` and `area` fields
- Parses comma-separated values: first part = country, remaining parts = areas
- Maintains backward compatibility during transition

### Code Updates

All code has been updated to support both formats (new and legacy) for backward compatibility:

1. **TypeScript Interfaces** (`src/services/database/supabaseDatabaseService.ts`)
   - Updated `SupabaseSurfer` interface
   - Updated `saveSurfer` method signature

2. **Matching Services** (`src/services/matching/`)
   - Updated `matchingService.ts` and `matchingServiceV3.ts`
   - Helper functions now support both formats
   - Country matching works with new structure

3. **Swelly Functions** (`supabase/functions/`)
   - Updated `swelly-shaper/index.ts` to create destinations in new format
   - Updated prompts and examples
   - Handles merging areas when updating existing trips

4. **UI Components** (`src/screens/ProfileScreen.tsx`)
   - Updated to display destinations using new structure
   - Falls back to legacy format if needed

## Usage Examples

### Creating a New Destination
```typescript
{
  country: "Australia",
  area: ["Gold Coast", "Byron Bay", "Noosa"],
  time_in_days: 84,
  time_in_text: "12 weeks"
}
```

### Single Area
```typescript
{
  country: "Costa Rica",
  area: ["Tamarindo"],
  time_in_days: 180,
  time_in_text: "6 months"
}
```

### No Specific Areas
```typescript
{
  country: "El Salvador",
  area: [],
  time_in_days: 21,
  time_in_text: "3 weeks"
}
```

## Backward Compatibility

The codebase maintains backward compatibility:
- Functions check for both `country`/`area` (new) and `destination_name` (legacy)
- Migration script converts existing data
- New data is always created in the new format

## Next Steps

1. Run the database migration: `supabase/migrations/migrate_destinations_array_structure.sql`
2. Test the migration with existing data
3. Verify that new destinations are created in the correct format
4. Monitor for any issues during the transition period

## Files Modified

- `supabase/migrations/migrate_destinations_array_structure.sql` (NEW)
- `src/services/database/supabaseDatabaseService.ts`
- `src/services/matching/matchingService.ts`
- `src/services/matching/matchingServiceV3.ts`
- `src/types/tripPlanning.ts`
- `src/screens/ProfileScreen.tsx`
- `supabase/functions/swelly-shaper/index.ts`
- `supabase/functions/swelly-chat/index.ts` (documentation)
- `supabase/functions/swelly-trip-planning/index.ts` (documentation)

