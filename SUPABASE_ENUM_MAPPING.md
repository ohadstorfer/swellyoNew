# Supabase Enum Mapping Guide

This document explains how to map the app's data to Supabase enum types.

## Required Enum Values

You need to provide the actual enum values for:
1. `surfboard_type` enum
2. `travel_experience` enum

## Current Mappings (Temporary - Needs Your Input)

### Surfboard Type Mapping

The app uses numeric board types (0-4). These need to be mapped to your `surfboard_type` enum.

**Current temporary mapping in code:**
```typescript
const boardTypeMap: { [key: number]: string } = {
  0: 'shortboard',
  1: 'longboard',
  2: 'funboard',
  3: 'fish',
  4: 'gun',
};
```

**Please provide:**
- What are the actual enum values in your `surfboard_type` enum?
- What board types are used in your app (check `BoardCarousel.tsx`)?

### Travel Experience Mapping

The app uses numeric travel experience levels (0-3). These need to be mapped to your `travel_experience` enum.

**Current temporary mapping in code:**
```typescript
const travelExpMap: { [key: number]: string } = {
  0: 'new_nomad',
  1: 'rising_voyager',
  2: 'wave_hunter',
  3: 'chicken_joe',
};
```

**Please provide:**
- What are the actual enum values in your `travel_experience` enum?
- The app uses these names: "New Nomad", "Rising Voyager", "Wave Hunter", "Chicken Joe"

## How to Find Your Enum Values

1. Go to Supabase Dashboard
2. Navigate to Database → Types
3. Find `surfboard_type` and `travel_experience` enums
4. List all the values

Or run this SQL query:

```sql
SELECT 
  t.typname AS enum_name,
  e.enumlabel AS enum_value
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname IN ('surfboard_type', 'travel_experience')
ORDER BY t.typname, e.enumsortorder;
```

## Next Steps

Once you provide the enum values, I'll update `src/utils/supabaseDatabaseService.ts` with the correct mappings.

