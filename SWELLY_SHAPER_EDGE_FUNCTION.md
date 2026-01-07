# Swelly Shaper Edge Function Implementation

This document describes the conversion of Swelly Shaper from local processing to a Supabase Edge Function, similar to the trip planning conversation system.

## Overview

The Swelly Shaper feature has been converted to use a Supabase Edge Function that leverages OpenAI for natural language understanding and profile editing. This provides a more scalable and maintainable solution.

## Architecture

### Components

1. **Edge Function** (`supabase/functions/swelly-shaper/index.ts`)
   - Handles all conversation logic
   - Uses OpenAI GPT-4o for natural language understanding
   - Stores chat history in `swelly_chat_history` table
   - Automatically updates user profiles when fields are identified

2. **Service Layer** (`src/services/swelly/swellyShaperService.ts`)
   - Provides interface to call the edge function
   - Manages chat ID for conversation continuity
   - Converts edge function responses to app-friendly format

3. **UI Component** (`src/screens/SwellyShaperScreen.tsx`)
   - Chat interface for profile editing
   - Initializes conversation on mount
   - Handles message sending and receiving

## Key Features

- **Natural Language Processing**: Users can update their profile using conversational language
- **Multiple Field Updates**: Can handle multiple profile changes in a single message
- **Chat History**: Conversations are stored and can be resumed
- **Automatic Profile Updates**: Profile fields are updated automatically when identified
- **Context Awareness**: Edge function has access to current profile for better assistance

## Supported Profile Fields

The system can update the following fields:
- `name` - User's name or nickname
- `age` - User's age
- `pronoun` - Preferred pronouns
- `country_from` - Country of origin
- `surfboard_type` - Board type (shortboard, midlength, longboard, soft_top)
- `surf_level` - Surf skill level (1-5)
- `travel_experience` - Travel experience level
- `bio` - Biography/description
- `destinations_array` - Array of past trips
- `travel_type` - Travel budget (budget, mid, high)
- `travel_buddies` - Travel companions (solo, 2, crew)
- `lifestyle_keywords` - Array of lifestyle interests
- `wave_type_keywords` - Array of wave preferences

## Deployment Steps

### 1. Deploy the Edge Function

```bash
# Navigate to your project root
cd /path/to/swellyo

# Deploy the swelly-shaper function
supabase functions deploy swelly-shaper
```

### 2. Verify Environment Variables

Ensure the following environment variables are set in Supabase:
- `OPENAI_API_KEY` - Your OpenAI API key
- `SUPABASE_URL` - Automatically available
- `SUPABASE_SERVICE_ROLE_KEY` - Automatically available

To set the OpenAI API key:
1. Go to Supabase Dashboard → Project Settings → Edge Functions
2. Add secret: `OPENAI_API_KEY` with your OpenAI API key value

### 3. Test the Function

```bash
# Test locally (optional)
supabase functions serve swelly-shaper

# Check logs
supabase functions logs swelly-shaper
```

### 4. Verify Database Table

Ensure the `swelly_chat_history` table exists (should already exist from trip planning implementation):
- `chat_id` (text, primary key)
- `user_id` (uuid, foreign key to auth.users)
- `conversation_id` (uuid, nullable)
- `messages` (jsonb)
- `updated_at` (timestamp)

## API Endpoints

The edge function provides the following endpoints:

- `POST /swelly-shaper/new_chat` - Start a new profile editing conversation
- `POST /swelly-shaper/continue/:chat_id` - Continue an existing conversation
- `GET /swelly-shaper/:chat_id` - Get chat history
- `GET /swelly-shaper/health` - Health check

## Request/Response Format

### Start New Chat
```typescript
POST /swelly-shaper/new_chat
{
  "message": "Let's shape that profile!",
  "conversation_id": "optional-uuid"
}

Response:
{
  "chat_id": "uuid",
  "return_message": "Hey there! What would you like to change?",
  "is_finished": false,
  "data": null
}
```

### Continue Chat
```typescript
POST /swelly-shaper/continue/:chat_id
{
  "message": "change my board to shortboard"
}

Response:
{
  "return_message": "Got it! I've updated your surfboard type to shortboard. ✅",
  "is_finished": true,
  "data": {
    "field": "surfboard_type",
    "value": "shortboard"
  }
}
```

## How It Works

1. **User sends message** → UI calls `swellyShaperService.processMessage()`
2. **Service checks for chat ID** → If exists, continues conversation; otherwise starts new
3. **Service calls edge function** → Sends message to `/swelly-shaper/new_chat` or `/continue/:chat_id`
4. **Edge function processes** → 
   - Gets user's current profile for context
   - Calls OpenAI with conversation history
   - Parses JSON response
   - If `is_finished: true` and has data, updates profile in database
   - Saves conversation to `swelly_chat_history`
5. **Response returned** → Service converts to app format
6. **UI displays response** → Shows message to user

## Example Conversations

### Single Field Update
```
User: "change my board to shortboard"
Swelly: "Got it! I've updated your surfboard type to shortboard. ✅"
→ Profile updated: surfboard_type = "shortboard"
```

### Multiple Field Updates
```
User: "I'm 25 years old and my level is 4"
Swelly: "Perfect! I've updated your age to 25 and surf level to 4. ✅"
→ Profile updated: age = 25, surf_level = 4
```

### Adding Trip
```
User: "add trip to Costa Rica for 3 months"
Swelly: "Awesome! I've added a trip to Costa Rica for 3 months to your profile. ✅"
→ Profile updated: destinations_array += [{"destination_name": "Costa Rica", "time_in_days": 90}]
```

## Differences from Previous Implementation

### Before (Local Processing)
- All logic in `swellyShaperService.ts`
- Keyword matching and regex parsing
- Direct database updates from service
- No conversation history
- Limited natural language understanding

### After (Edge Function)
- Logic in Supabase Edge Function
- OpenAI GPT-4o for natural language understanding
- Conversation history stored in database
- Better context awareness
- More flexible and maintainable

## Troubleshooting

### Function Not Deploying
- Check Supabase CLI is installed and logged in
- Verify project is linked: `supabase link --project-ref YOUR_PROJECT_REF`
- Check function name matches directory name

### OpenAI Errors
- Verify `OPENAI_API_KEY` is set in Supabase secrets
- Check API key is valid and has credits
- Review edge function logs for specific errors

### Profile Not Updating
- Check edge function logs for update errors
- Verify user has permission to update their profile
- Check database RLS policies allow updates

### Chat History Not Saving
- Verify `swelly_chat_history` table exists
- Check RLS policies allow user to insert/update their own records
- Review edge function logs for database errors

## Next Steps

1. Deploy the edge function to Supabase
2. Test the integration in the app
3. Monitor edge function logs for any issues
4. Gather user feedback and iterate on prompts if needed

