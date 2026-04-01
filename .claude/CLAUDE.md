# Swellyo

Cross-platform social app for surfers. React Native + Expo (web, iOS, Android) with Supabase backend and Supabase Edge Functions.

**Web is live and used by real users.** Mobile is being prepared for App Store / Google Play.

## Tech Stack

- **Frontend:** React Native 0.81, Expo 54, React 19, React Navigation
- **Backend:** Supabase (Auth, Database, Storage, Realtime, Edge Functions)
- **AI:** OpenAI GPT via Supabase Edge Functions (NOT the Python backend)
- **Analytics:** PostHog
- **Auth:** Google OAuth (Supabase Auth)
- **Web deploy:** Netlify (via GitHub Actions)
- **API deploy:** Supabase Edge Functions (copy-paste from repo to Supabase dashboard)

## Commands

- `npm start` — Expo dev server
- `npm run web` — web dev server
- `npm run ios` / `npm run android` — native dev
- `npm run build:netlify` — production web build

## Architecture

### Entry point
`App.tsx` → `AppContent.tsx` (in `src/components/`). AppContent is the main router — it decides what screen to show based on auth state, onboarding step, and MVP mode.

### Onboarding flow
Steps go from `-1` (welcome) → `0` (post-auth welcome) → `1-4` (profile setup) → `5` (Swelly chat) → `6+` (main app). Managed by `OnboardingContext.tsx`.

### Key directories
- `src/screens/` — app screens
- `src/components/` — reusable UI + AppContent
- `src/services/` — business logic (auth, messaging, matching, swelly, media)
- `src/context/` — OnboardingContext, MessagingProvider
- `src/hooks/` — custom hooks (useAuthGuard, useChatKeyboardScroll)
- `supabase/functions/` — Edge Functions (AI chat, trip planning, matching)

## Edge Function Deployment

Edge Functions are deployed by **copy-pasting** code from the repo into the Supabase dashboard. The repo files are reference copies.

### Live vs experimental files
- **Files WITHOUT "copy" in the name = PRODUCTION (live)**
- **Files WITH "-copy" or "-copy-copy" = EXPERIMENTAL (testing next versions)**
- When an experiment works, its code gets merged into the main (non-copy) file, and the copy is deleted

This applies to Edge Functions AND to files in `src/` (e.g., `TripPlanningChatScreenCopy.tsx`, `swellyServiceCopy.ts`, `DestinationInputCardCopy.tsx`).

## Core Feature: Matching

The matching system connects surfers based on filters. It works in two phases:

### Phase 1 — Filter extraction (Edge Function: `swelly-trip-planning`)
User chats with "Swelly" AI about what surfers they want. When Swelly has enough info, it calls `extractQueryFilters()` (OpenAI) to convert the conversation into Supabase query filters. Returns `is_finished: true` with the filters to the client.

### Phase 2 — Database query (Client: `TripPlanningChatScreen.tsx` → `matchingService.ts`)
The screen calls `findMatchingUsers()` which builds a Supabase query using the extracted filters as **hard filters**:
- `.in('country_from', [...])` — origin country
- `.gte('age', min)` / `.lte('age', max)` — age range
- `.in('surfboard_type', [...])` — board type (shortboard, longboard, mid_length, soft_top)
- `.in('surf_level_category', [...])` — surf level (beginner, intermediate, advanced, pro)
- Destination country — filtered in-memory from `destinations_array` (JSONB)

**It's a hard-filter search: match ALL criteria or don't appear.** There is scoring code in the file but it does not affect results — it's leftover from an earlier approach.

### Filters NOT active
- Area matching (disabled)
- Budget similarity (disabled)
- All point-based scoring/ranking (runs but doesn't meaningfully affect output)

### V3 matching (`matchingServiceV3.ts`)
Experimental alternative behind `EXPO_PUBLIC_USE_V3_MATCHING=true` flag. Not active. Adds 4-layer scoring, compass-direction area normalization, and intent-based matching. May be revisited later.

## Dead Code — Do Not Use

These files exist but are NOT used by the running app:
- `backend/` — Python FastAPI server on Render. Fully replaced by Supabase Edge Functions. Do not touch.
- `src/services/chat/chatService.ts` — old chat service pointing to Render. Dead.
- `src/utils/chatService.ts` — duplicate of above. Dead.
- `src/config/api.ts` — Render API config. Dead.

## Messaging

- **User-to-user DMs** go through Supabase Realtime (no API calls)
- **Swelly AI chats** go through Supabase Edge Functions → OpenAI
- One Supabase channel per conversation, reused (not duplicated)
- Typing indicators ride on the same channel
- `MessagingProvider.tsx` manages all conversation state and subscriptions

## Auth

- Google OAuth via Supabase Auth
- Web: Google Identity Services + PKCE flow (`?code=` URL params)
- Mobile: `expo-auth-session` with `swellyo://` redirect scheme
- Session restoration on boot with retry logic (3 attempts, exponential backoff)
- Logout is choreographed: 10+ handlers clear caches, subscriptions, uploads. Order matters.

## Environment Variables

Required (no `.env.example` exists — infer from code):
```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_GOOGLE_CLIENT_ID
EXPO_PUBLIC_GOOGLE_CLIENT_SECRET
EXPO_PUBLIC_POSTHOG_API_KEY
EXPO_PUBLIC_POSTHOG_HOST
EXPO_PUBLIC_MVP_MODE          # "true" = onboarding-only mode
```

## Team & Workflow

- Two developers: Eyal (branch: `eyal`) and one other
- Eyal pushes through the `eyal` branch
- Coding conventions: TBD — not yet aligned

## Common Gotchas

- `destinations_array` is JSONB — can't be filtered in SQL, must filter in-memory after query
- MVP mode (`EXPO_PUBLIC_MVP_MODE=true`) blocks access to main app after onboarding — shows thank-you screen instead
- Demo mode (`isDemoUser=true`) is different from MVP mode — uses `swelly-chat-demo` Edge Function, gives full app access
- Form data saves to AsyncStorage on every keystroke (crash recovery) but only saves to Supabase on "Next" click. DB always wins on conflict.
- OpenAI calls in matching (`extractQueryFilters`, `normalizeArea`) silently return empty if API key is missing — matching still works but with reduced accuracy
