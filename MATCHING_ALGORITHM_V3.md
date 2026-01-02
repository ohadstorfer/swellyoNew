# Matching Algorithm V3 - Implementation Guide

## Overview

V3 implements a sophisticated 4-layer matching system with destination hierarchy normalization, following the guidelines provided. This document explains the architecture, usage, and integration.

## Key Features

### 1. 4-Layer Matching System

The algorithm processes users through 4 distinct layers:

- **Layer 1: Explicit Hard Requirements** - Things the user literally asked for (non-negotiable criteria)
  - Country from filter
  - Surfboard type filter
  - Age range filter
  - Surf level min/max filters
  - Must-have keywords
  - **Users failing this layer are filtered out immediately**

- **Layer 2: Inferred Required Constraints** - Conclusions the LLM makes
  - Beginner shouldn't answer advanced questions
  - Advanced users might not remember beginner spots well
  - **Users failing this layer are filtered out**

- **Layer 3: Priorities** - Weighted boosts (1-50, exceptions = 100)
  - Origin country priority: 30 points
  - Board type priority: 40 points (or 100 if equipment intent)
  - Surf level priority: 35 points (or 100 if advanced surf spots)
  - Age range priority: 25 points
  - Lifestyle keywords: up to 50 points
  - Wave keywords: up to 50 points
  - Travel experience: 20 points
  - Group type: 15 points
  - **Exceptions (100 points)**: Almost always surface if matched

- **Layer 4: General Scoring** - Budget proximity, lifestyle, days in area, keywords, etc.
  - Days in destination: 1 point per day (max 50)
  - Area match: 25-40 points (intent-based)
  - Town match: 10-30 points (intent-based)
  - Budget similarity: 0-30 points
  - Surf level similarity: 0-30 points
  - Travel experience similarity: 0-30 points
  - Same surfboard type: +20 points (except equipment intent)
  - Same group type: +15 points
  - Lifestyle keywords: +5 per match (max 25)
  - Wave keywords: +5 per match (max 25)

### 2. Destination Hierarchy

Strict separation of:
- **Country** - Always required
- **Area** - Normalized to fixed options only:
  - `north`, `south`, `east`, `west`
  - `south-west`, `south-east`, `north-west`, `north-east`
- **Town** - Additional layer, not always relevant (intent-based)

**Area is the core unit.** Town only matters in certain intents.

### 3. Intent-Driven Rules

Different intents imply different matching logic:

#### Surf Spots
- Country + Area required
- Town only if explicitly needed
- Skill level required
- Area match: 40 points, Town match: 30 points

#### Hikes
- Area required
- Extra weight for like-minded travelers
- Area match: 40 points, Town match: 10 points

#### Stays / Providers
- Area required
- Town if requested
- Budget + lifestyle matter
- Area match: 40 points, Town match: 30 points

#### Equipment
- Area required
- Priority on experience
- **Surf style should NOT be inferred as required** (shortboarders can recommend longboard shops)
- Area match: 25 points, Town match: 10 points
- Board type match: 0 points (not used for scoring)

#### Towns Within Area
- Area required
- Priority on time spent in area + like-minded travelers
- Area match: 25 points, Town match: 10 points

#### General
- Balanced scoring
- Area match: 25 points, Town match: 10 points

### 4. Priority Scoring System

Priorities use weighted boosts:
- **1-10**: Nice to have
- **10-30**: Very helpful
- **30-50**: Major advantage
- **100**: Exception (if matched + passed filters, should almost always surface)

Examples:
- User asks for best surf spot in El Salvador + is advanced → advanced surfers get heavy priority (100 points)
- User prioritizes longboarders for equipment → longboarders get 100 points
- User prioritizes surfers from Israel → +30 points

### 5. Consistency Across System

Both onboarding and matching requests use the same area taxonomy:
- Onboarding: "I've been to Weligama" → saved as `country: "Sri Lanka"`, `area: "south-west"`, `towns: ["Weligama"]`
- Matching: "I want a rec on a stay in Kabalana area" → matches on `country` and `area`, not necessarily `town`

This ensures we're not over-optimizing around towns.

## File Structure

```
src/services/matching/
├── matchingService.ts          # Original V1/V2 algorithms
├── matchingServiceV3.ts        # New V3 algorithm (this implementation)
└── destinationNormalizer.ts    # Helper to normalize destinations during onboarding
```

## Usage

### In ChatScreen (Trip Planning)

The V3 algorithm is automatically used when `EXPO_PUBLIC_USE_V3_MATCHING=true` is set:

```typescript
import { findMatchingUsersV3 } from '../services/matching/matchingServiceV3';

const useV3Matching = process.env.EXPO_PUBLIC_USE_V3_MATCHING === 'true';
const matchedUsers = useV3Matching
  ? await findMatchingUsersV3(requestData, currentUser.id)
  : await findMatchingUsers(requestData, currentUser.id);
```

### Normalizing Destinations During Onboarding

When saving destinations during onboarding, normalize them to ensure consistency:

```typescript
import { normalizeOnboardingDestinations } from '../services/matching/destinationNormalizer';

// When saving destinations from Swelly conversation
const normalizedDestinations = await normalizeOnboardingDestinations(
  response.data.destinations_array
);

await supabaseDatabaseService.saveSurfer({
  destinationsArray: normalizedDestinations,
  // ... other fields
});
```

## API Reference

### `findMatchingUsersV3(request, requestingUserId)`

Main matching function.

**Parameters:**
- `request: TripPlanningRequest` - Trip planning request with destination, filters, priorities, etc.
- `requestingUserId: string` - ID of the user requesting matches

**Returns:**
- `Promise<MatchedUser[]>` - Array of top 3 matched users

**Example:**
```typescript
const request: TripPlanningRequest = {
  destination_country: 'Sri Lanka',
  area: 'Kabalana',
  budget: 2,
  destination_known: true,
  purpose: {
    purpose_type: 'specific_advice',
    specific_topics: ['best waves', 'accommodation'],
  },
  prioritize_filters: {
    origin_country: 'Israel',
    board_type: 'shortboard',
  },
};

const matchedUsers = await findMatchingUsersV3(request, currentUser.id);
```

### `normalizeOnboardingDestination(destinationInput)`

Normalizes a single destination string from onboarding.

**Parameters:**
- `destinationInput: string` - Raw destination input (e.g., "Weligama, Sri Lanka")

**Returns:**
- `Promise<{ destination_name: string; country: string; area?: AreaOption | AreaOption[]; towns?: string[] }>`

**Example:**
```typescript
const normalized = await normalizeOnboardingDestination('Weligama, Sri Lanka');
// Returns:
// {
//   destination_name: "Sri Lanka, South-West, Weligama",
//   country: "Sri Lanka",
//   area: "south-west",
//   towns: ["Weligama"]
// }
```

### `normalizeOnboardingDestinations(destinations)`

Normalizes an array of destinations from onboarding.

**Parameters:**
- `destinations: Array<{ destination_name: string; time_in_days: number }>` - Array of destinations

**Returns:**
- `Promise<Array<{ destination_name: string; time_in_days: number }>>` - Normalized destinations

## Integration Steps

### 1. Enable V3 Matching

Set environment variable:
```bash
EXPO_PUBLIC_USE_V3_MATCHING=true
```

Or update `ChatScreen.tsx` to always use V3:
```typescript
const matchedUsers = await findMatchingUsersV3(requestData, currentUser.id);
```

### 2. Normalize Onboarding Destinations

Update the onboarding flow to normalize destinations when saving:

```typescript
// In ChatScreen.tsx or onboarding service
import { normalizeOnboardingDestinations } from '../services/matching/destinationNormalizer';

// After receiving Swelly conversation results
if (response.data.destinations_array) {
  const normalizedDestinations = await normalizeOnboardingDestinations(
    response.data.destinations_array
  );
  
  await supabaseDatabaseService.saveSurfer({
    destinationsArray: normalizedDestinations,
    // ... other fields
  });
}
```

### 3. Test the Algorithm

Test with various scenarios:
- Different intents (surf spots, stays, equipment, etc.)
- Different area inputs (towns, regions, general areas)
- Priority filters
- Non-negotiable criteria
- Edge cases (no area, no town, etc.)

## Benefits Over V2

1. **More Accurate Matching**: 4-layer system ensures only relevant users pass through
2. **Consistent Destination Structure**: Normalized areas prevent matching issues
3. **Intent-Aware**: Different intents use different matching logic
4. **Priority System**: Weighted boosts allow fine-tuned control
5. **Better Filtering**: Hard requirements vs. priorities are clearly separated
6. **Scalable**: Easy to add new intents or adjust scoring

## Future Enhancements

- Add more intent types (e.g., "local_guides", "surf_schools")
- Implement caching for area normalization
- Add analytics to track matching performance
- Allow custom priority weights per intent
- Support for multi-country matching

