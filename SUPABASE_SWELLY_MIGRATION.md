# Migrating Swelly Chatbot to Supabase Edge Functions

This guide will help you migrate your Swelly chatbot functionality from the FastAPI backend to Supabase Edge Functions.

## Overview

**Current Setup:**
- FastAPI backend (`backend/main.py`) running on Render
- OpenAI API integration for ChatGPT
- In-memory chat storage

**New Setup:**
- Supabase Edge Functions (Deno/TypeScript)
- OpenAI API integration (same)
- Chat history stored in Supabase database (optional but recommended)

## Step 1: Set Up Supabase Edge Functions

### 1.1 Install Supabase CLI

```bash
npm install -g supabase
```

Or using Homebrew (Mac):
```bash
brew install supabase/tap/supabase
```

### 1.2 Initialize Supabase in Your Project

```bash
supabase init
```

This creates a `supabase` folder if it doesn't exist.

### 1.3 Create the Swelly Edge Function

```bash
supabase functions new swelly-chat
```

This creates: `supabase/functions/swelly-chat/index.ts`

## Step 2: Create the Edge Function Code

Replace the contents of `supabase/functions/swelly-chat/index.ts` with:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface ChatRequest {
  message: string
  chat_id?: string
  conversation_id?: string // Supabase conversation ID (optional)
}

interface ChatResponse {
  chat_id?: string
  return_message: string
  is_finished: boolean
  data?: any
}

const META_PROMPT = `
Your goal is to collect: destinations, travel_style, surf_pref, and extras. Only set is_finished: true when you have all four pieces of information.

A smart, laid-back surfer who's the ultimate go-to buddy for all things surfing and beach lifestyle. He's a cool local friend, full of knowledge about surfing destinations, techniques, and ocean safety, with insights about waves, travel tips, and coastal culture. His tone is relaxed, friendly, and cheerful, with just the right touch of warm, uplifting energy. A sharper edge of surf-related sarcasm keeps the vibe lively and fun, like quipping about rookies wiping out or "perfect" conditions for no-shows. He's smart, resourceful, and genuinely supportive, with responses no longer than 120 words. When offering options, he keeps it short with 2-3 clear choices. Responses avoid overusing words like "chill," staying vibrant and fresh, and occasionally use casual text-style abbreviations like "ngl" or "imo". Uses the words dude, bro, shredder, gnarly, stoke.

Response should be in JSON.

Example conversation:
Given context - 23 years old, Israeli, 8-10 surf trips, Charging surfer

{
    "return_message": "Which 2-3 surf zones you'd say you really know inside-out? Like towns or areas you've actually lived/surfed enough to call your stomping grounds abroad?",
    "is_finished": false,
    "data": null
}

User said:
I'd say, San Diego, south county, Sri lanka in kabalana ahangama midigama and towns around, Maldives at thulusdhoo and himmafushi

{
    "return_message": "Solid list bro, that's some tasty variety 🌊🔥
Now gimme a bit more juice on each: how much time you've actually clocked in San Diego, Sri Lanka, and Maldives? Like number of trips, how long you stayed, and how recent? Also—any local ties (friends, fam, surf crew) or just surf'n'go?",
    "is_finished": false,
    "data": null
}

User said:
SD - 3 weeks once, then 7 months. known a lot of locals. was this year. sri lanka - twice for a month each- winter 2023 and 2024, knows a bunch of locals. maldives 1 month

{
    "return_message": "Nice résumé, dude 👌 That's deep roots, esp. with SD locals.
Next thing—what's your usual surf/travel style? Like:
You more on a budget or mid/high spender?",
    "is_finished": false,
    "data": null
}

User said:
budget, solo or another friend, usually remote work as well, like to party, local culture, nature, etc

{
    "return_message": "Got it bro 🤙 budget shredder, mixing work, waves, and some late nights with culture + nature stoke.
Now wave-wise—what's your sweet spot? Talking size, reef vs sand, crowds, comfort with barrels vs mellower peelers. What kinda setups really fire you up?",
    "is_finished": false,
    "data": null
}

User said:
barrels and hard fast big waves. rather no crowd, but can surf crowds. reef and sand both work

{
    "return_message": "Hell yeah, charger vibes 🏄‍♂️💥 hunting barrels, power, and less crowd if possible, but not afraid of a packed lineup. Last piece, bro—outside the surf: any general trip must-do's or lifestyle things? (Like sustainability, local food, art, diving, community stuff, yoga, fishing, etc). What makes a trip feel complete for you?",
    "is_finished": false,
    "data": null
}

User said:
support sustainabilty, not too much on it. doing valley ball and climbing. love exploring cool spots and nature. do mobility and stretches.

{
   "return_message": "Epic, that paints the full picture 🤟 so we've got:",
   "is_finished": true,
   "data": {
        "destinations":  "San Diego (7mo + crew), Sri Lanka (Ahangama/Kabalana/Midigama twice), Maldives (Thulusdhoo/Himmafushi 1mo)",
         "travel_style": "budget, solo/1 friend, remote-work + surf, mix of party/culture/nature",
          "surf_pref": "barrels, big/fast waves, low crowd if possible, comfy on reef/sand",
          "extras":  "care for sustainability, volleyball, climbing, exploring/nature missions, mobility work"
    }
}

IMPORTANT NOTICE ! - I sent the json only in the end, but you should always return the message in this json format, and while is_finished is false data is null
`

async function getChatHistory(chatId: string, supabase: any): Promise<any[]> {
  try {
    // Try to get chat history from database
    const { data, error } = await supabase
      .from('swelly_chat_history')
      .select('messages')
      .eq('chat_id', chatId)
      .single()

    if (error || !data) {
      return []
    }

    return data.messages || []
  } catch (error) {
    console.error('Error fetching chat history:', error)
    return []
  }
}

async function saveChatHistory(chatId: string, messages: any[], supabase: any): Promise<void> {
  try {
    const { error } = await supabase
      .from('swelly_chat_history')
      .upsert({
        chat_id: chatId,
        messages: messages,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'chat_id'
      })

    if (error) {
      console.error('Error saving chat history:', error)
    }
  } catch (error) {
    console.error('Error saving chat history:', error)
  }
}

async function callOpenAI(messages: any[]): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    const url = new URL(req.url)
    const path = url.pathname

    // Route: POST /swelly-chat/new_chat
    if (path.endsWith('/new_chat') && req.method === 'POST') {
      const body: ChatRequest = await req.json()
      
      // Generate chat ID
      const chatId = crypto.randomUUID()
      
      // Initialize chat history
      const messages = [
        { role: 'system', content: META_PROMPT },
        { role: 'user', content: body.message }
      ]

      // Call OpenAI
      const assistantMessage = await callOpenAI(messages)
      messages.push({ role: 'assistant', content: assistantMessage })

      // Save to database
      await saveChatHistory(chatId, messages, supabase)

      // Parse JSON response
      let parsedResponse: ChatResponse
      try {
        const parsed = JSON.parse(assistantMessage)
        parsedResponse = {
          chat_id: chatId,
          return_message: parsed.return_message || assistantMessage,
          is_finished: parsed.is_finished || false,
          data: parsed.data || null
        }
      } catch {
        parsedResponse = {
          chat_id: chatId,
          return_message: assistantMessage,
          is_finished: false,
          data: null
        }
      }

      return new Response(
        JSON.stringify(parsedResponse),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Route: POST /swelly-chat/continue/:chat_id
    if (path.includes('/continue/') && req.method === 'POST') {
      const chatId = path.split('/continue/')[1]
      const body: ChatRequest = await req.json()

      if (!chatId) {
        return new Response(
          JSON.stringify({ error: 'Missing chat_id' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Get existing chat history
      let messages = await getChatHistory(chatId, supabase)
      
      if (messages.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Chat not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Add new user message
      messages.push({ role: 'user', content: body.message })

      // Call OpenAI
      const assistantMessage = await callOpenAI(messages)
      messages.push({ role: 'assistant', content: assistantMessage })

      // Save to database
      await saveChatHistory(chatId, messages, supabase)

      // Parse JSON response
      let parsedResponse: ChatResponse
      try {
        const parsed = JSON.parse(assistantMessage)
        parsedResponse = {
          return_message: parsed.return_message || assistantMessage,
          is_finished: parsed.is_finished || false,
          data: parsed.data || null
        }
      } catch {
        parsedResponse = {
          return_message: assistantMessage,
          is_finished: false,
          data: null
        }
      }

      return new Response(
        JSON.stringify(parsedResponse),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Route: GET /swelly-chat/:chat_id
    if (path.match(/\/[^/]+$/) && req.method === 'GET') {
      const chatId = path.split('/').pop()

      if (!chatId) {
        return new Response(
          JSON.stringify({ error: 'Missing chat_id' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const messages = await getChatHistory(chatId, supabase)

      if (messages.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Chat not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ chat_id: chatId, messages }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Health check
    if (path.endsWith('/health') || path === '/swelly-chat') {
      return new Response(
        JSON.stringify({ status: 'healthy', message: 'Swelly API is running' }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  }
})
```

## Step 3: Create Database Table for Chat History (Optional but Recommended)

Run this SQL in your Supabase SQL Editor:

```sql
-- Create table for storing Swelly chat history
CREATE TABLE IF NOT EXISTS public.swelly_chat_history (
  chat_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.swelly_chat_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own chat history
CREATE POLICY "Users can view own chat history"
ON public.swelly_chat_history
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Policy: Users can insert their own chat history
CREATE POLICY "Users can insert own chat history"
ON public.swelly_chat_history
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own chat history
CREATE POLICY "Users can update own chat history"
ON public.swelly_chat_history
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_swelly_chat_history_user_id ON public.swelly_chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_swelly_chat_history_conversation_id ON public.swelly_chat_history(conversation_id);
```

## Step 4: Set Environment Variables in Supabase

1. Go to your Supabase Dashboard
2. Navigate to **Project Settings** → **Edge Functions**
3. Click **Add new secret**
4. Add the following secrets:
   - `OPENAI_API_KEY` - Your OpenAI API key

The `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available in Edge Functions.

## Step 5: Deploy the Edge Function

```bash
# Login to Supabase (if not already)
supabase login

# Link your project
supabase link --project-ref your-project-ref

# Deploy the function
supabase functions deploy swelly-chat
```

## Step 6: Update Frontend to Use Supabase Edge Function

Update `src/services/swelly/swellyService.ts`:

```typescript
import { supabase, isSupabaseConfigured } from '../../config/supabase';

// ... existing interfaces ...

class SwellyService {
  private getFunctionUrl(endpoint: string): string {
    if (!isSupabaseConfigured()) {
      throw new Error('Supabase is not configured');
    }
    
    const { data: { project } } = supabase;
    // Get project URL from Supabase client
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    return `${supabaseUrl}/functions/v1/swelly-chat${endpoint}`;
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('Not authenticated');
    }

    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
    };
  }

  async startNewConversation(request: SwellyChatRequest): Promise<SwellyChatResponse> {
    try {
      const url = this.getFunctionUrl('/new_chat');
      const headers = await this.getAuthHeaders();

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[SwellyService] Error starting new conversation:', error);
      throw error;
    }
  }

  async continueConversation(chatId: string, request: SwellyContinueChatRequest): Promise<SwellyContinueChatResponse> {
    try {
      const url = this.getFunctionUrl(`/continue/${chatId}`);
      const headers = await this.getAuthHeaders();

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[SwellyService] Error continuing conversation:', error);
      throw error;
    }
  }

  async getChatHistory(chatId: string): Promise<any> {
    try {
      const url = this.getFunctionUrl(`/${chatId}`);
      const headers = await this.getAuthHeaders();

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[SwellyService] Error getting chat history:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<any> {
    try {
      const url = this.getFunctionUrl('/health');
      const headers = await this.getAuthHeaders();

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[SwellyService] Error checking API health:', error);
      throw error;
    }
  }

  // ... rest of the methods remain the same ...
}

export const swellyService = new SwellyService();
```

## Step 7: Test the Migration

1. **Test locally (optional):**
   ```bash
   supabase functions serve swelly-chat
   ```

2. **Test the deployed function:**
   - Use your app to start a new Swelly conversation
   - Check Supabase Dashboard → Edge Functions → Logs for any errors

## Step 8: Clean Up (After Migration is Complete)

1. You can keep the old backend running as a backup
2. Once confirmed working, you can:
   - Remove the old backend deployment
   - Update `src/config/api.ts` to remove old API references (if desired)

## Troubleshooting

### Common Issues:

1. **"Missing authorization header"**
   - Ensure the frontend is passing the auth token correctly
   - Check that `supabase.auth.getSession()` returns a valid session

2. **"OpenAI API error"**
   - Verify `OPENAI_API_KEY` is set in Supabase Edge Functions secrets
   - Check your OpenAI API key is valid and has credits

3. **"Chat not found"**
   - Ensure the database table `swelly_chat_history` exists
   - Check RLS policies allow the user to access their chat history

4. **CORS errors**
   - Edge Functions should handle CORS automatically, but check the response headers

## Benefits of This Migration

1. **No separate backend server** - Everything runs on Supabase
2. **Automatic scaling** - Supabase handles scaling
3. **Better security** - Uses Supabase auth and RLS
4. **Persistent storage** - Chat history stored in database
5. **Cost effective** - No need to maintain a separate server

## Next Steps

1. Consider integrating Swelly conversations with your existing `conversations` table
2. Add analytics/logging for chat interactions
3. Implement rate limiting if needed
4. Add error monitoring (e.g., Sentry)


