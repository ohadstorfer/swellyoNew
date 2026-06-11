# Findings — Navigation Migration (Phase R synthesis)

Synthesized 2026-06-11 from 7 agent reports in `docs/nav-migration/research/` (R1–R7).
Read the per-area report before implementing in that area — this file is the executive map.

## Scale of the real inventory
- 33 screen files, ~45 files using `<Modal>`, ~28 sheet/modal surfaces in trips alone
- 19 screen-like things rendered from AppContent; 5 origin-tracking back flags; 5 pending deep-link vars
- 13 onboarding/auth screens stay OUTSIDE the deck (confirmed correct)

## Corrections to prior assumptions (critic-verified)
1. **TripPlanningChatScreenCopy is PRODUCTION** — the "Copy" is the live Swelly screen; non-copy is dead.
2. **SwellyShaperScreen is UNREACHABLE** — `setShowSwellyShaper(true)` never called anywhere. Dead code.
3. **THREE DM render paths, not one**: (a) ConversationsStack inner push (native), (b) AppContent
   `selectedConversation` overlay (push/trip/profile origins), (c) ConversationsScreen local state (web).
   Migration unifies all three into one DM card.
4. **WelcomeToLineupOverlay is NOT a Modal** — absolute View + Animated.Value (R2 was wrong, critic fixed).
5. **Settings opens from the Lineup header menu today** (not profile) — Eyal's gear-icon move is a pure
   entry-point change; screen is self-contained.

## Architecture refinements forced by the code (plan updates)
1. **Most sheets stay as plain Modals.** Only the notifications panel (+ anything needing back-history)
   becomes a transparentModal route. The ~26 in-screen pickers/sheets in TripDetail + wizard stay
   component-local — converting them would be pointless churn. (R3)
2. **Swelly chats stay as persistent display:'none' layers through Phases 0–3**; Phase 4 lifts their
   conversation state to a provider and converts them to normal cards. They hold live Supabase
   subscriptions + PanResponder + keyboard animation — cannot be naively pushed/popped. (R5/R6)
3. **Keyboard risk is real and must be spiked first**: `useReanimatedKeyboardAnimation` breaks inside
   react-native-screens animated transforms on iOS — that's WHY ConversationsStack runs
   `enableNativeScreens={false}`. Phase 3 must START with a device spike: DM screen inside a
   native-stack card, keyboard open/close, before committing to migrating chat screens. Fallback:
   chat cards ride a JS/blank sub-stack. (R4/R6 — CRITICAL)
4. **Sub-screen render-swaps become routes**: Settings (DeleteAccount/Privacy/Analytics),
   ConversationsScreen (ReportUser/SwellyoTeamWelcome), ProfileScreen internals all use
   `return <X/>` swaps with no back-stack. They become cards or stay internal — decide per case in specs.
5. **`detachInactiveScreens={false}` where subscriptions live** (tabs navigator esp. Trips realtime). (R3)
6. **No navigationRef exists** — must be created in Phase 1; push-notification cold-start routing
   depends on it (Phase 2). (R6)
7. **ProfileEditPanel stays a root-level Modal** (its animationType="none" + custom spring would fight
   transparentModal animation). JoinDecision + WelcomeToLineup overlays also stay as-is initially. (R1/R5)
8. **react-native-screen-transitions can be deleted** after ConversationsStack migrates — zero other
   consumers. (R4)

## Load-bearing subtleties (do NOT break)
- `pendingTripDetailId` deliberately survives Trip→Profile→back (restores trip). Becomes route params.
- `setCurrentConversationId` two-phase set (before push + on mount) suppresses unread counts. Preserve.
- Typing indicator: `setIsTyping(false)` synchronously before bubble mount — animation anchor. Preserve.
- 350ms WelcomeOverlay↔Profile choreography → becomes transition-end callback.
- `fromOnboardingChat` disables Profile swipe-dismiss (protects `findAndConnectMatches()`) →
  `gestureEnabled:false` on that route variant.
- Onboarding step-7 ordering: profile flags set BEFORE `markOnboardingComplete()` — timing load-bearing.
- `scrollEventThrottle={1}` on Explore deck is intentional (120Hz) — don't touch.
- `WIZARD_STATE_VERSION=6` — bump if wizard state shape changes (else old drafts silently dropped).
- Group-chat exit currently closes TripsScreen entirely — navigator fixes this for free (R3 fact 8).
- MVP-mode routing lives inside screens, NOT AppContent.
- Custom right-swipe dismiss on TripPlanningChat + ProfileScreen will fight navigator swipe-back —
  remove gestures or `gestureEnabled:false`.
- `MaybeKeyboardProvider` module-level require throws if native module missing in a build variant.
- iOS `InputAccessoryView` in WhenSheetContent — verify responder chain after migration.

## Dead code discovered (cleanup candidates, Phase 5)
- SwellyShaperScreen (unreachable), TripPlanningChatScreen non-copy, ChatScreen.tsx + its
  DestinationCardsCarousel copies, LoadingScreen.tsx (unreachable; has AI-consent Modal — see decisions),
  `currentStep=8` leftover in getInitialStep().

## Open decisions for Eyal
1. SwellyShaperScreen — delete or keep as latent feature? (it's unreachable today)
2. TripPlanningChatScreenCopy — merge back into the main filename during migration? (recommended: yes,
   rename Copy→main, delete dead one — per repo convention "when an experiment works, merge + delete")
3. ConversationsScreen hamburger menu — keep as Modal, or redesign as part of the Lineup restructure
   you mentioned? (can defer)
4. LoadingScreen's AI-consent Modal is in dead code — was consent ever a store-compliance requirement?
   If unsure, we keep the file until verified.
5. Web URLs: navigator on web could give real URLs (/trips/123) but auth code manipulates
   window.history today. Recommend: keep web URL-less for now (as today), revisit later. Confirm.

## Web research already locked (see .claude/agent-memory/web-researcher/research_nav_*.md)
push() not navigate() · no big-bang switch (#9436) · enableFreeze NOT global (#2972) ·
freezeOnBlur off on tabs (#2971) · MainActivity.kt patch pre-native-build · predictive-back off ·
custom tabBar emits tabPress manually, never popToTop in listener (#9424) ·
transparentModal+deeplink bug (#12389: dismiss modals before navigating) · stay on v7.
