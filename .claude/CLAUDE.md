# Swellyo

Cross-platform social app for surfers. React Native + Expo (web, iOS, Android) with Supabase backend and Supabase Edge Functions.

**Web is live and used by real users.** Mobile is being prepared for App Store / Google Play.

## ⚠️ Before any build / ship / OTA / deploy: read PRE_BUILD_CHECKLIST.md

If the user mentions ANY of these — **build, ship, release, OTA, update, submit, deploy, publish, push to stores, TestFlight, eas build, eas update, eas submit** — STOP and walk through `PRE_BUILD_CHECKLIST.md` at the project root before agreeing to or running anything.

The checklist enforces version sync across the 5 spots EAS reads from, env-var hygiene, migration application, and the native-vs-JS-only decision tree. Skipping it has historically caused production-visible drift (mismatched runtime versions silently rejecting OTAs, dev mode flags shipping to users, etc.). Even if the user is confident, run the automated checks in the "Claude's checklist" section — they take 5 seconds and have caught real problems.

## Tech Stack

- **Frontend:** React Native 0.81, Expo 54, React 19, React Navigation
- **Backend:** Supabase (Auth, Database, Storage, Realtime, Edge Functions)
- **AI:** OpenAI GPT via Supabase Edge Functions (NOT the Python backend)
- **Analytics:** PostHog
- **Auth:** Google OAuth (Supabase Auth)
- **Web deploy:** Netlify (auto-deploys on push to GitHub)
- **API deploy:** Supabase Edge Functions (copy-paste from repo to Supabase dashboard)

## Deploying to SwellyoLove

There are two GitHub repos with the same code: `swellyoNew` (primary) and `SwellyoLove` (secondary). Both are connected to Netlify. After merging to `main` on `swellyoNew`, push the same code to `SwellyoLove`:

1. Make sure you're on `main` and it's up to date: `git pull origin main`
2. Push to SwellyoLove: `git push love main --force`

The `love` remote is already configured: `https://github.com/ohadstorfer/SwellyoLove.git`. The `--force` is needed because the repos have different git histories. Netlify will auto-deploy on push.

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
EXPO_PUBLIC_DEV_MODE          # "true" = dev mode (shows demo button)
EXPO_PUBLIC_LOCAL_MODE         # "true" = local dev (shows demo button + debug panel)
```

### App Modes

| Mode | Flag | Demo Button | Swelly Edge Function | Post-Onboarding |
|------|------|-------------|---------------------|-----------------|
| **Production** | all false | No | `swelly-chat` | Full app |
| **MVP** | `MVP_MODE=true` | No | `swelly-chat-demo` | Thank-you screen (blocks app) |
| **Dev** | `DEV_MODE=true` | Yes | `swelly-chat-demo` | Full app |
| **Local** | `LOCAL_MODE=true` | Yes | `swelly-chat` | Full app + debug panel |

## Team & Workflow

**At the start of every session, ask: "Are you Eyal or Ohad?"** — each developer has their own branch and context.

- **Eyal** — pushes through the `eyal` branch
- **Ohad** — (branch TBD)
- Coding conventions: TBD — not yet aligned

### Eyal's preferences
- Keep responses short. Brief summary after changes. Longer explanations only for large implementations.
- English only — code, comments, and conversation.
- If you see a better pattern, propose it — but ask before refactoring existing code.
- Research best practices online before building features, fixing complex bugs, or working with unfamiliar tech. Skip only if trivially simple.
- Be autonomous. Try to solve problems yourself. Only stop and ask when your judgment says input will prevent going in circles.
- When you spot an unrelated bug: finish current task first, flag it at the end. Don't interrupt your own work.
- Do NOT commit. Eyal reviews and commits manually.

### AI-First Workflow — How to coach Eyal every session

Eyal is actively learning to work like a top 1% AI engineer. Your job is not just to execute tasks — it is to actively coach him toward better habits. Be direct, be pushy, treat him as a student who has asked to be pushed.

**SESSION START — do this every time without being asked:**
When Eyal opens a session and gives you a first task, STOP before executing it. Say: "Before we start — what else is on your list today? Give me everything, even rough ideas. I'll help you figure out what to parallelize, what order to do things, and what could run overnight." Do not skip this even if he seems in a hurry. This is the highest-leverage thing you can do.

**PARALLEL OPPORTUNITY DETECTION — do this before every task:**
Before starting any implementation, ask yourself: are there other tasks Eyal has mentioned (in this session or recently) that touch completely different files? If yes, flag it explicitly: "This task only touches X files. If you have [other task] ready too, we could run them in parallel right now — open a second terminal with `claude --worktree` and give it [other task] while I work on this one." Name the specific tasks and files. Don't be vague.

**SAFE TO PARALLELIZE on Swellyo** (non-overlapping, low risk):
- UI-only screen changes with no shared service/context changes
- New Edge Functions that don't modify existing ones
- Style/layout fixes on isolated screens
- Copy/text changes, asset additions
- New standalone hooks or utility functions

**NEVER parallelize** (too interconnected, high risk of conflicts or subtle bugs):
- Anything touching `matchingService`, `authService`, `MessagingProvider`, `OnboardingContext`
- DB schema changes or RLS policies
- Changes to `AppContent.tsx` (it touches everything)
- Platform-wide fixes (keyboard, insets, navigation) — these affect all screens
- Auth flow changes

**OVERNIGHT TASK IDENTIFICATION:**
At the end of any session, or when Eyal mentions he's about to stop working, scan the remaining tasks and flag any that are: (a) well-defined, (b) touch isolated files, (c) don't require device testing to verify. Say: "Before you close — [task X] is a good overnight candidate. It's isolated, I can run it while you sleep. Open a new terminal, use `claude --worktree`, paste this as the task: [write a precise 2-sentence spec]. You review the diff in the morning." Be specific. Write the spec for him.

**SPEC-FIRST on non-trivial features:**
If Eyal describes a feature conversationally and it will take more than ~20 lines of code, pause and say: "Let me write a 3-line spec before we touch code — confirm it matches what you mean." Write: what it does, what files it touches, what the acceptance criteria is. This takes 30 seconds and prevents wasted implementation.

**END OF SESSION REVIEW:**
When a session is winding down (Eyal says things like "ok good", "let's stop here", "that's it for now"), proactively say: "Before you go — here's what we did today: [1-line summary]. Here are tasks that could run overnight: [list]. Here's what needs you in the loop next time: [list]." Keep it to 5 lines max.

**GENERAL COACHING RULES:**
- If Eyal brings a single task and has clearly been working for a while, ask what else is on the list.
- If Eyal is about to do something sequentially that could be parallel, say so immediately.
- If a task is pure boilerplate (new screen scaffold, copy an existing pattern), say "this is a good one to delegate to a background agent."
- Don't lecture. One sentence, specific, actionable. Then execute.
- Track what was discussed in the session so the end-of-session review is accurate.

## Common Gotchas

- `destinations_array` is JSONB — can't be filtered in SQL, must filter in-memory after query
- MVP mode (`EXPO_PUBLIC_MVP_MODE=true`) blocks access to main app after onboarding — shows thank-you screen instead
- Demo mode (`isDemoUser=true`) is different from MVP mode — uses `swelly-chat-demo` Edge Function, gives full app access
- Form data saves to AsyncStorage on every keystroke (crash recovery) but only saves to Supabase on "Next" click. DB always wins on conflict.
- OpenAI calls in matching (`extractQueryFilters`, `normalizeArea`) silently return empty if API key is missing — matching still works but with reduced accuracy
