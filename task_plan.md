# Task Plan — Navigation Migration (boolean router → react-navigation v7 card stack)

## Objective
Replace the hand-rolled boolean router in `AppContent.tsx` (~15 show-flags, 6 origin-tracking
back flags) with the canonical react-navigation v7 architecture: **3 roots (Lineup / Trips /
Profile) under the floating bottom nav + one card deck above them**. Cards cover the nav.
Sheets are transparent cards in back history. Back always pops one card.

Approved by Eyal 2026-06-11 (see `navigation-migration-plan.html` — the user-facing plan).
DB/Edge Functions: NO changes. Client-side only.

## Operating mode
Eyal's directive: run like a CEO — multi-agent research/implementation/testing, but I stay
personally aware of every implementation detail. Flawless > fast. Stop only for decisions
that are his to make. He tests on iPhone dev client (web bundle pass is necessary, not sufficient).

## Phases

### Phase R: Full codebase research (multi-agent)
- Status: COMPLETE (2026-06-11, 7 agents, reports in docs/nav-migration/research/ R1–R7)
- [x] R1–R6 area maps + R7 completeness critic (found 10 gaps, 4 contradictions in mapper reports)
- [x] Synthesized into findings.md
- KEY CORRECTIONS: TripPlanningChatScreenCopy IS production; SwellyShaperScreen unreachable;
  THREE DM render paths; most in-screen sheets STAY as Modals (only notifications panel becomes a route)
- CRITICAL NEW RISK: keyboard lib breaks inside react-native-screens transforms on iOS →
  Phase 3 must open with a device spike before migrating chat screens

### Phase P: Per-phase implementation specs
- Status: pending
- [ ] Write docs/nav-migration/phase-0.md … phase-5.md (exact files, exact changes, test matrix each)
- [ ] Present complete picture + open decisions to Eyal → GO/NO-GO per phase

### Phase 0: Prep (no visible change)
- Status: pending
- [ ] Branch `nav-migration` off main
- [ ] MainActivity.kt fragment-restore patch; predictive-back off in app config
- [ ] "No new showX flags" comment in AppContent; sync note for Ohad
- [ ] Verify app builds + runs identically

### Phase 1: Skeleton — roots + bottom nav into navigator
- Status: pending

### Phase 2: Trips deck (trip overview, edit, notifications sheet, deep links)
- Status: pending

### Phase 3: People & chat cards (profile, DM, Settings) + delete origin flags
- Status: pending

### Phase 4: Modals & Swelly (create wizard, sheets, AI chat provider lift)
- Status: pending

### Phase 5: Cleanup & hardening (delete boolean router, Android sweep, Maestro back-path tests)
- Status: pending

## Key architecture decisions (locked with Eyal)
| Decision | Detail |
|---|---|
| One deck, not per-root decks | Nav bar lives only on roots → can't switch roots mid-deck → per-root decks pointless |
| Cards cover bottom nav | WhatsApp-style; matches what we built this week |
| Sheets in back history | Notifications panel, filters, when-picker = transparentModal routes; Android back closes |
| Settings access | NEW: gear icon on own profile header (moves from wherever it is today) |
| Trips inner toggle | my/explore/create = component state, NOT routes |
| push() always, navigate() never for cards | Same-screen-multiple-times chains |
| Stay on react-navigation v7 | v8 needs SDK 55 |
| Realtime stays in MessagingProvider | Already above navigation — correct. Add AppState reconnect fix (separate, bonus) |
| Onboarding + age-block | OUTSIDE the deck (own pre-app world / hard gate) |

## Research references (web research already done, saved in agent memories)
- .claude/agent-memory/web-researcher/research_nav_opensource_apps.md (Bluesky/Expensify patterns)
- research_nav_platform_conventions.md (iOS/Android conventions)
- research_nav_canonical_architecture.md (v7 tree, custom tabBar, config, bug list)
- research_nav_keepalive_realtime.md (keep-alive verdicts, freeze bugs, Supabase reconnect)
- research_nav_migration_warstories.md (playbook, landmines)
- research_navigation_stack_architecture.md (original 5-phase sketch)

## Known landmines (carry into every phase)
1. NEVER big-bang switch (state corruption #9436) — root-first incremental only
2. push() not navigate(); navigate() silently no-ops into nested navigators in v7
3. Double NavigationContainer = crash; App.tsx already has one (independent=true) — ConversationsStack uses it
4. iOS swipe-back vs explore-deck horizontal swipe — gesture coordination needed
5. MainActivity.kt patch BEFORE next native build; sheets need physical-Android testing
6. enableFreeze: NOT globally (bug #2972 with realtime screens)
7. freezeOnBlur=false on tab navigator (bug #2971)
8. Custom tabBar must emit tabPress events manually; never call popToTop in listener (#9424)
9. transparentModal + deep link duplicate-TabNavigator bug (#12389) — dismiss modals before nav

## Decisions Log
| Decision | Rationale | Date |
|----------|-----------|------|
| Plan approved by Eyal | navigation-migration-plan.html reviewed | 2026-06-11 |
| No DB changes confirmed | Client-side only migration | 2026-06-11 |
| SwellyShaperScreen: keep untouched | Unreachable dead code, fate decided later | 2026-06-11 |
| TripPlanningChatScreenCopy: merge→main filename in Phase 4 | Repo convention: experiment works → merge + delete | 2026-06-11 |
| Web: IGNORED ENTIRELY | Eyal: "we don't use web at all" — web bundle must still build, but no web testing/URL work | 2026-06-11 |
| ConversationsScreen hamburger menu | Deferred to Lineup restructure (separate project) | 2026-06-11 |
| LoadingScreen consent modal | Keep file until consent requirement verified — Phase 5 note | 2026-06-11 |

## Errors Encountered
| Error | Attempted Fix | Result |
|-------|--------------|--------|
