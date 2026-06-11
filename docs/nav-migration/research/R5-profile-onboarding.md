# R5 — Profile, Onboarding & Swelly Chats: Navigation Inventory

**Date:** 2026-06-11  
**Scope:** ProfileScreen, SettingsScreen, SwellyShaperScreen, TripPlanningChatScreen + Copy, OnboardingContext + OnboardingScaffold, WelcomeToLineupOverlay, JoinDecisionOverlay, AgeBlockOverlay, demo/MVP gating, useAuthGuard, logout teardown.

---

## 1. Counts

| Category | Count |
|---|---|
| Full-screen overlays (in main-app boolean router) | 7 (Settings, SwellyShaper, Profile, TripPlanningChat, TripPlanningChatCopy, SurftripDetail, TripsScreen) |
| Onboarding steps (step keys rendered in OnboardingScaffold) | 8 (`welcome`, `step1`–`step7`, `videoUpload`) |
| True RN `<Modal>` components | 4 (JoinDecisionOverlay, ProfileEditPanel, various modals inside ProfileScreen itself) |
| Persistent keep-alive layers | 2 (TripPlanningChatScreen, TripPlanningChatScreenCopy — both toggled via `display:'none'`) |
| Overlay-on-overlay screens (rendered inside Settings) | 3 (DeleteAccount, PrivacyPreferences, AnalyticsDashboard — each replaces SettingsScreen content with `return <X />`) |
| Experimental / "Copy" variants | 2 (TripPlanningChatScreenCopy lives in both `screens/TripPlanningChatScreenCopy.tsx` and is ALSO the live path for all production Swelly presses — see §4) |

---

## 2. Screen-by-Screen Inventory

### 2.1 OnboardingScaffold + Steps (steps 0–7)

**File:** `src/components/onboarding/OnboardingScaffold.tsx`  
**Step content files:** `src/screens/OnboardingStep{1..4}Screen.tsx`, `OnboardingStep4DestinationsScreen.tsx`, `OnboardingStep5BudgetScreen.tsx`, `OnboardingStep6LifestyleScreen.tsx`, `OnboardingVideoUploadScreen.tsx`, `OnboardingWelcomeScreen.tsx`

**What triggers it:** AppContent returns `<OnboardingScaffold>` when `currentStep >= 0 && currentStep <= 7`. The context starts at `STEP_WELCOME` (-1); calling `setCurrentStep(0)` via `handleGetStarted` enters the scaffold boundary.

**Step key map:**
- step = -1 (STEP_WELCOME) → `WelcomeScreen` (returned separately, NOT inside scaffold)
- step = 0 → `OnboardingWelcomeScreen` (key: `'welcome'`)
- step = 1 → `OnboardingStep1Screen` (key: `'step1'`)
- step = 2 + `showVideoUploadStep=false` → `OnboardingStep2Screen` (key: `'step2'`)
- step = 2 + `showVideoUploadStep=true` → `OnboardingVideoUploadScreen` (key: `'videoUpload'`)
- step = 3 → `OnboardingStep3Screen` (key: `'step3'`)
- step = 4 → `OnboardingStep4DestinationsScreen` (key: `'step4'`)
- step = 5 → `OnboardingStep5BudgetScreen` (key: `'step5'`)
- step = 6 → `OnboardingStep6LifestyleScreen` (key: `'step6'`)
- step = 7 → `OnboardingStep4Screen` (key: `'step7'` — note the file is named Step4Screen despite being step 7)

**Back/close:** Each step calls `handleStepNBack` in AppContent → `setCurrentStep(N-1)`. Step 0 back calls `handleWelcomeBack` which calls `performLogout` + `setCurrentStep(STEP_WELCOME)`.

**Special non-linear jumps:**
- SoftTop board (boardType=3) → Step1 jumps directly to step 3 (skips step 2 surf-level video picker)
- SoftTop back from step 3 → goes to step 1 (not step 2)
- Step 2 back → `showVideoUploadStep(true)` instead of decrementing step (re-shows video upload)

**State lives where:** `currentStep` + `formData` in `OnboardingContext`. Per-step `isSavingStepN` flags in AppContent. `showVideoUploadStep` is AppContent local state.

**Must stay mounted:** No. Scaffold unmounts when `shouldShowConversations` becomes true. Steps are stateless — everything is lifted into `formData` in context.

**Platform branches:** `OnboardingScaffold` renders a `maxWidth: 800` centered layout on desktop web (`useIsDesktopWeb`). No `.web.tsx` variants for onboarding screens.

**Transition to main app:** After step 7 completes:
1. `setProfileFromOnboardingChat(true)` and `setShowProfile(true)` — both before `markOnboardingComplete()` to prevent the `isComplete && !showProfile → home` branch.
2. `markOnboardingComplete()` flips `isComplete=true` in context.
3. AppContent now hits `shouldShowConversations=true` but profile overlay is already the front layer.

---

### 2.2 WelcomeScreen (step -1)

**File:** `src/screens/WelcomeScreen.tsx`  
**Trigger:** AppContent default return when not in steps 0–7 and `shouldShowConversations=false`. Also returned while `isRestoringSession=true` (shows a branded loading experience, no buttons).  
**Back:** None — this is the root.  
**Platform:** `isAuthResolving` guards against flickering to login buttons before session restore completes. Web has `?code=` OAuth return detection (`isCheckingAuth` state).  
**Demo/Dev gates:** `handleDemoChat` and `handleSkipDemo` are passed in. `showDemoByDefault = isDevMode || isLocalMode`. Production users never see demo buttons unless they long-press the logo.

---

### 2.3 ProfileScreen

**File:** `src/screens/ProfileScreen.tsx`  
**Trigger (AppContent line ~1840):** `showProfile=true` in the `activeOverlay` priority chain. Sits below `SurftripDetail`, `TripsScreen`, `Settings`, `SwellyShaper` but above `ConversationLoading`, `DM`.  
**Props that change behavior:**
- `userId` = undefined → own profile; `userId` = string → other user's profile
- `fromOnboardingChat=true` → hides all header buttons; shows floating "Got it!" button at bottom; swipe-to-dismiss disabled
- `noTransition=true` → skips slide-in/slide-out (used when opened from WelcomeToLineupOverlay which has its own fade modal)
- `suppressConnectAnalytics=true` → Connect button skips PostHog event (used from overlay)

**Back/close:** Calls `onBack` = `handleProfileBack` in AppContent. The handler branches by which flag was set when profile opened:
- `profileFromWelcomeOverlay` → 350ms delay, set `welcomeOverlayHiddenByProfile=false` first (overlay fades back in), then `setShowProfile(false)` after delay
- `profileFromTripPlanningChat` → returns to chat
- `profileFromTripDetail` → clears profile, sets `showTrips=true` (pending trip detail restores via `pendingTripDetailId`)
- Default → goes to home/conversations

**Own-profile entry points and their flags:**
| Entry point | Flag set |
|---|---|
| `TripsBottomNav` profile tab (from Lineup) | none |
| `TripsBottomNav` profile tab (from Trips) | `profileFromTripDetail=true`, `pendingTripDetailId=null` |
| `handleProfilePress` from conversations header | none |
| Post-onboarding (step 7 complete) | `profileFromOnboardingChat=true` |
| SwellyShaperScreen "view profile" | `profileFromOnboardingChat=true` (reuses same special header) |

**Gestures/animations ProfileScreen owns:**
- Reanimated swipe-to-dismiss (swipe right) using `Gesture.Pan` + `GestureDetector`. Disabled on web, Android, `fromOnboardingChat`, and several internal sheet/modal states.
- Bottom sheet for destinations: `Animated.spring` slide-up / `Animated.timing` fade-in overlay
- Cover image shimmer: recursive `Animated.timing` pattern on native driver
- Upload spinner: `Animated.timing` pulse

**Internal modals ProfileScreen renders itself:**
- `ReportUserScreen` — replaces full content via `showReportOverlay` boolean (not a RN `<Modal>`)
- `BlockUserOverlay` — RN `<Modal>` transparent
- `AvatarCropModal` — RN `<Modal>`
- `GalleryPermissionOverlay` — component (wraps RN Modal)
- `HomeBreakViewSheet` — component

**Must stay mounted:** No. Profile unmounts freely. Video player (`SurfSkillCard`) has its own `videoPlayer` + `replaceAsync` lifecycle but is fully self-contained.

**Platform branches:**
- `ScrollView`: `RNGHScrollView` (iOS/web), falls back to `RNScrollView` on Android (RNGH composition blocks native scroll on Android)
- `MaybeGestureDetector`: no-op on Android (GestureDetector intercepts touch on Android even when `enabled(false)`)
- `isSwipeDisabled`: always true on web and Android

**JoinRequestActionBar:** Rendered inside ProfileScreen when `getIncomingJoinRequest()` returns a result — only for other-user profiles that have a pending join request to the current user's trip. Approve/decline buttons show inline. Not a separate screen.

---

### 2.4 ProfileEditPanel

**File:** `src/components/ProfileEditPanel/ProfileEditPanel.tsx`  
**Trigger:** `showProfileEditor=true` in AppContent → `<ProfileEditPanel visible={showProfileEditor} />` rendered after `activeOverlay` in the main return tree (not inside `activeOverlay`). It wraps content in a RN `<Modal animationType="none" transparent>`.  
**Close:** `onClose={() => setShowProfileEditor(false)}`  
**Note for migration:** This is a `<Modal>` on top of everything — it is NOT in the `activeOverlay` priority chain. It exists outside the overlay stack and renders above it. The `onEdit` callback from ProfileScreen sets `showProfileEditor=true` in AppContent.  
**Internal sub-screens:** ProfileEditPanel renders `ProfileEditSurfStyleScreen`, `ProfileEditTravelExperienceScreen`, `ProfileEditSurfSkillScreen`, `ProfileEditSurfVideoScreen`, `ProfileEditDestinationScreen`, `ProfileEditLifestyleScreen` as inline content swaps (no RN Modal, no Navigator inside).

---

### 2.5 SettingsScreen

**File:** `src/screens/SettingsScreen.tsx`  
**Trigger (current):** `showSettings=true` in AppContent `activeOverlay` chain. Entry: `onSettingsPress` prop wired into `ConversationsScreen` (header hamburger menu item, NOT from profile). The plan moves settings access to a gear icon on own profile — **this means the entry point changes but the screen itself doesn't need to**.  
**Back/close:** `onBack={() => setShowSettings(false)}`  
**Internal sub-screens (render swap pattern, NOT nested Modals or Navigator):**
- `showDeleteAccount` → `return <DeleteAccountScreen .../>`
- `showPrivacyPreferences` → `return <PrivacyPreferencesScreen .../>`
- `showAnalytics` (admin only) → `return <AnalyticsDashboardScreen .../>`
- `showReportBug` → `<ReportBugOverlay>` (overlay component, not full screen swap)  
**Slide-in animation:** `Animated.spring(slideAnim, { toValue: 0 })` on mount — translateY from 600. **This is the only animation SettingsScreen owns.**  
**Must stay mounted:** No.

---

### 2.6 SwellyShaperScreen

**File:** `src/screens/SwellyShaperScreen.tsx`  
**Trigger:** `showSwellyShaper=true` in AppContent `activeOverlay` chain. Currently no UI entry point wired to open it from anywhere visible to the user — it's only reachable via internal callbacks (`handleSwellyShaperViewProfile` is set from `ConversationsStack` props but no current screen calls `setShowSwellyShaper(true)` from a user action in the main flow).  
**Back:** `handleSwellyShaperBack` → `setProfileFromSwellyShaper(true)`, `setShowSwellyShaper(false)`, `setShowProfile(true)` — returns to Profile.  
**"View Profile":** `handleSwellyShaperViewProfile` → `setProfileFromOnboardingChat(true)`, `setShowSwellyShaper(false)`, `setShowProfile(true)` — Profile opens with the post-onboarding header variant.  
**Conversation state:** Persists chat in AsyncStorage via `SWELLY_SHAPER_CHAT_ID_KEY`. `clearSwellyShaperChatId()` is exported for logout.  
**Must stay mounted:** No. Chat history reloaded from AsyncStorage on next mount.

---

### 2.7 TripPlanningChatScreen ("non-copy" — DEAD for production users)

**File:** `src/screens/TripPlanningChatScreen.tsx`  
**Live status:** EFFECTIVELY NOT USED for regular user Swelly presses. `handleSwellyPress` sets `setShowTripPlanningChatCopy(true)` — it always opens the Copy variant. `showTripPlanningChat` is never set to true in any current user-facing handler. The persistent layer for this screen is mounted via `tripPlanningChatEverShown` but `showTripPlanningChat` never becomes true in normal flow.  
**Exception:** `handleTripPlanningChatBack` and `handleViewUserProfile` have branches checking `showTripPlanningChat` for back-nav — so the flag is checked but never set.  
**Keep-alive mechanics:** If somehow shown, it would use the same `display:'none'` / `pointerEvents='none'` pattern. The layer is in AppContent lines 1931–1950.  
**Conversation state (if ever activated):** `tripPlanningChatId`, `tripPlanningMatchedUsers`, `tripPlanningDestination` in AppContent — passed as `persistedChatId`, `persistedMatchedUsers`, `persistedDestination` props. `onChatStateChange` callback updates AppContent state.

---

### 2.8 TripPlanningChatScreenCopy (THE LIVE Swelly chat)

**File:** `src/screens/TripPlanningChatScreenCopy.tsx`  
**Live status:** THIS IS THE PRODUCTION Swelly chat. `handleSwellyPress` → `setActiveCopyService('copy')` + `setShowTripPlanningChatCopy(true)`.  
**Keep-alive mechanics (AppContent lines 1953–1979):**
- Lazy-mounted on first open (`tripPlanningChatCopyEverShown` flag).
- Stays mounted thereafter; toggled via `display:'none'` on the wrapper View.
- `pointerEvents` set to `'none'` when not frontmost.
- No transparent background on the wrapper (unlike the regular variant which has `backgroundColor: '#F5F5F5'`).

**Props:**
- `visible` prop: drives entry animation (swipe translate X + opacity). Component never unmounts; `visible` false→true replays the slide-in animation.
- `onboardingMatches`: populated when coming from WelcomeToLineupOverlay "More Matches" button; shows the already-found matches before starting a new search.
- `service`: `swellyServiceCopy` (default) or `swellyServiceCopyCopy` (dev card).
- `persistedChatId` / `persistedMatchedUsers` / `persistedDestination`: conversation state survival across nav.

**Own animations/gestures:**
- `swipeTranslateX` (Reanimated shared value): right-swipe to dismiss. Velocity/distance thresholds. Uses `Gesture.Pan` + `GestureDetector`. Same pattern as ProfileScreen.
- `chipPanResponders`: PanResponder per active filter chip — drag chips to a trash zone to remove them.
- `SWIPE_DISMISS_DISTANCE` / `SWIPE_DISMISS_VELOCITY` constants control the dismiss threshold.

**Back:** Swipe right or tap X. `onChatComplete` → `setShowTripPlanningChatCopy(false)` + `setShowTripPlanningChat(false)` + `setPendingOnboardingMatches(null)`.

**Conversation state lives in:** AppContent (`tripPlanningChatId`, etc.) — lifted out so it survives the `display:'none'` lifecycle.

**Platform branch:** `USE_MATCH_SURFERS_RPC = Platform.OS === 'web'` — web uses the in-DB `match_surfers` RPC; iOS/Android uses the old edge function path (`swelly-trip-planning-copy`).

---

### 2.9 WelcomeToLineupOverlay

**File:** `src/components/WelcomeToLineupOverlay.tsx`  
**Trigger:** Rendered in AppContent main tree (NOT in `activeOverlay`). `visible` prop = `showWelcomeToLineupOverlay && !welcomeOverlayHiddenByProfile && onboardingMatchResult != null && matchCount > 0`.  
**Appearance:** After step 7 completes → `findAndConnectMatches()` fires → if `match_count > 0`, `setShowWelcomeToLineupOverlay(true)`.  
**Important:** Component stays **permanently mounted** — it uses Animated fade-in/out on `visible` toggle (NOT RN `<Modal>`). Images prefetched on `matches` change. Carousel scroll position preserved across hide/show cycles.  
**The 350ms delay hack:**
- User taps "View Profile" on a match → `setProfileFromWelcomeOverlay(true)` + `setWelcomeOverlayHiddenByProfile(true)` → overlay fades out, profile slides in.
- User taps back from profile → `handleProfileBack` → `setWelcomeOverlayHiddenByProfile(false)` (overlay starts fading back in), then `setTimeout(() => setShowProfile(false), 350)` — keeps profile mounted for 350ms while overlay fades in, preventing backdrop flash.
- **Migration gotcha:** This 350ms choreography depends on both components being in the same render tree simultaneously. With a navigator, the same effect would require keeping both routes mounted during transition.

**Actions:**
- "Close" → `markWelcomeLineupDismissed()` + `setShowWelcomeToLineupOverlay(false)`
- "Connect" → dismiss overlay + show `ConversationLoadingScreen` (creates DM in background)
- "View Profile" → hide overlay behind profile (profile slide-in covers it)
- "More Matches" → dismiss overlay + `setPendingOnboardingMatches(...)` + open `TripPlanningChatCopy`

**Slide-in animation:** Swelly character slides up from off-screen, plays once per install (persisted in AsyncStorage `swelly_lineup_slide_played`), never plays again.

---

### 2.10 JoinDecisionOverlay

**File:** `src/components/trips/joinRequest/JoinDecisionOverlay.tsx`  
**Trigger:** Rendered in AppContent main tree. Uses RN `<Modal visible={!!activeJoinDecision} transparent animationType="fade">`. `activeJoinDecision = joinDecisionQueue[0] ?? null`.  
**Queue management:** Fetched once on user login (`listUnseenJoinDecisions`). Also populated live via Supabase Broadcast channel (`userTripsTopic`). Closing/actioning pops the front item, showing the next if any.  
**Note for migration:** This is a `<Modal>` — it renders above everything. In React Navigation it would be a `transparentModal` route at the root navigator level, or kept as a literal Modal.

---

### 2.11 AgeBlockOverlay

**File:** Inline in AppContent (no separate file).  
**Trigger:** `showAgeBlockOverlay=true`, set on mount by `ageGateService.checkBlocked()`. Returns a full-screen View (not RN Modal, not a screen) before the main routing logic. Clears on OK (calls logout + `resetOnboarding`).  
**Secret unblock:** 3-second long-press on text calls `ageGateService.clearBlock()` for testers.  
**Migration note:** This is a hard gate rendered BEFORE all navigation — must remain as a root-level guard outside any navigator.

---

### 2.12 MVPThankYouScreen

**File:** `src/screens/MVPThankYouScreen.tsx`  
**Where rendered:** ConversationsScreen (not AppContent). When `isMVPMode=true`, the screen shows the thank-you content after onboarding is complete. The `shouldShowConversations` branch still fires; ConversationsScreen internally gates based on `EXPO_PUBLIC_MVP_MODE`.  
**Back:** `onBackToHomepage` prop — wired from ConversationsScreen.  
**Note for migration:** Lives inside ConversationsScreen's render — it's a slot replacement, not a separate navigator route. Migration should make it a route only if ConversationsScreen splits into a navigator.

---

## 3. OnboardingContext (State Machine)

**File:** `src/context/OnboardingContext.tsx`

| State | Meaning |
|---|---|
| `currentStep = -1` (STEP_WELCOME) | WelcomeScreen |
| `currentStep = 0` | OnboardingWelcomeScreen (post-auth explanation) |
| `currentStep = 1–7` | OnboardingScaffold with step content |
| `isComplete = true` | Main app (shouldShowConversations gate) |
| `isRestoringSession = true` | WelcomeScreen with spinner |
| `isDemoUser = true` | Bypasses DB session validation |

**Session restoration:** `supabase.auth.getUser()` with 3 retries + exponential backoff. On success sets `user` in context. On failure, sets `isRestoringSession=false` (falls through to WelcomeScreen).

**`completionCheckedForUserId`:** Guards against a fresh sign-in flashing OnboardingWelcomeScreen before DB check resolves. AppContent waits for `completionCheckedForUserId === user.id` before making routing decisions.

**Recovery effect in AppContent (line ~362):** If a signed-in user has `currentStep === STEP_WELCOME` and `!isComplete`, auto-advances to `STEP_ONBOARDING_WELCOME` after session restore + DB check complete.

**AsyncStorage key:** `@swellyo_onboarding` — saved on every step/formData change; DB is source of truth on conflict.

---

## 4. useAuthGuard

**File:** `src/hooks/useAuthGuard.ts`  
**Called from:** AppContent once, on mount.  
**Does NOT redirect — just monitors.** Listens to `supabase.auth.onAuthStateChange`. On `SIGNED_OUT` or session loss, calls `performLogout()` which calls `resetOnboarding()` + `setUser(null)` + `setCurrentStep(STEP_WELCOME)`. Debounced 500ms to prevent rapid-fire calls.

**Logout teardown sequence (via `performLogout` in `src/utils/logout.ts`):**
- Clears AsyncStorage (`@swellyo_onboarding`, `@swellyo_survey_dismissed`, messaging caches, etc.)
- Calls `supabase.auth.signOut()`
- Resets context via callbacks passed in
- `setUser(null)` → `shouldShowConversations=false` → AppContent falls through to WelcomeScreen
- All mounted overlays (Profile, Settings, etc.) unmount automatically since their `show*` flags all live in AppContent state which resets

**Web-specific:** Also checks localStorage storage events for multi-tab sync, and window `focus` events to re-verify session.

**Migration note:** After navigation migration, `performLogout` should also call `navigation.reset()` to blow away the entire nav stack. Currently no navigator to reset.

---

## 5. Overlay Render Priority (Current)

The `activeOverlay` chain in AppContent (lines ~1797–1897), first-match wins:

```
1. activeSurftripDetailId      → SurftripDetailScreen
2. showTrips                   → TripsScreen
3. showSettings                → SettingsScreen
4. showSwellyShaper            → SwellyShaperScreen
5. showProfile                 → ProfileScreen
6. showConversationLoading     → ConversationLoadingScreen
7. selectedConversation        → DirectMessageScreen / DirectGroupChat
```

Below `activeOverlay`, still in the same render tree (not in priority chain):
- `TripPlanningChatScreen` persistent layer (`display:'none'` toggle)
- `TripPlanningChatScreenCopy` persistent layer (`display:'none'` toggle)
- `TripsBottomNav` (always rendered when `showBottomNav=true`)
- `WelcomeToLineupOverlay` (always rendered, Animated fade)
- `ProfileEditPanel` (RN `<Modal>` — always rendered, visibility via `visible` prop)
- `JoinDecisionOverlay` (RN `<Modal>` — always rendered)

---

## 6. Key Migration Facts

1. **TripPlanningChatScreenCopy IS the production Swelly chat.** `handleSwellyPress` always opens `showTripPlanningChatCopy`. The "non-copy" `TripPlanningChatScreen` is dead for production presses. Both are imported and both get the persistent layer treatment; only Copy is ever shown.

2. **Both Swelly chat variants must stay permanently mounted after first open.** They own a Supabase realtime subscription, active keyboard animations, and the filter-chip PanResponder map. Unmounting them on nav would replay the enter animation and refetch chat history. In React Navigation these must be `detachInactiveScreens={false}` or kept as absolute-fill sibling views outside the navigator, not as navigator screens.

3. **ProfileScreen has 6 distinct opening contexts** tracked by boolean flags (`profileFromOnboardingChat`, `profileFromSwellyShaper`, `profileFromTripPlanningChat`, `profileFromTripDetail`, `profileFromWelcomeOverlay`, default). Each changes what the back button does. Migration must encode these as route params or navigation state.

4. **The 350ms delay in WelcomeToLineupOverlay → Profile → back** is a deliberately timed hack: overlay fades in while profile is still mounted. A navigator transition would need both routes active simultaneously during the back transition — normal `goBack()` animations accomplish this automatically, but the 350ms setTimeout would need to be replaced with an onTransitionEnd callback.

5. **SettingsScreen currently opens from the Lineup header menu, NOT from Profile.** The plan is to move it to a gear icon on own profile. This is purely an entry-point change; the screen itself is self-contained. Settings' 3 internal screens (DeleteAccount, PrivacyPreferences, AnalyticsDashboard) use a `return <X />` pattern — they would need to become routes in the new Settings sub-navigator.

6. **ProfileEditPanel is a `<Modal>` sitting above all navigation.** It renders outside the `activeOverlay` chain in AppContent and above all screens. It should stay as a root-level Modal OR become a `transparentModal` route at the root navigator. It must NOT be a child of the profile route — it needs to persist independently of profile's mount state (editing can be triggered while profile is in a particular state).

7. **OnboardingScaffold stays completely outside the main navigator.** Steps 0–7 are a flat linear flow with no back-stack history needed. The scaffold's shared header+footer pattern means the step content area slides independently; implementing this in React Navigation would require a custom navigator or `react-native-screen-transitions`. Simplest: keep returning `<OnboardingScaffold>` from the root app shell before the main navigator renders.

8. **`TripPlanningChatScreen.USE_MATCH_SURFERS_RPC = Platform.OS === 'web'`** — web uses a Postgres RPC, iOS/Android uses the Edge Function. This is a runtime branch inside the screen, not a file split. Migration does not affect this.

9. **`currentStep = 8` is a dead step.** OnboardingContext's `getInitialStep` can return 8 for `?swelly_chat` URL path on web — this was the old Swelly onboarding chat route. No screen renders for step 8; it would fall off the scaffold's `resolveStepKey` and into `shouldShowConversations` check. Harmless but confusing.

10. **AgeBlockOverlay must remain a root-level gate before any navigator.** It's not a navigation concern — it's a device-level block that returns a plain View and bypasses all routing.

---

## 7. Landmines

- **`showProfile` and `viewingUserId` are separate.** Setting `showProfile=true` without clearing `viewingUserId` opens a stale other-user profile. Migration must bind these as a single route param object, not two independent state vars.

- **`profileFromOnboardingChat=true` and `fromOnboardingChat=true` prop disable swipe-to-dismiss.** If the new navigator enables a swipe-back gesture by default, the post-onboarding profile will break (user can swipe back before tapping "Got it!", bypassing `handleSaveAndGoToConversations` which fires `findAndConnectMatches()`). Must disable gesture on this route.

- **`TripPlanningChatCopy` `visible` prop triggers animation, not mount.** The navigator equivalent would need `onFocus` / `onBlur` events passed into the screen to trigger the Reanimated enter animation. The screen was explicitly redesigned to decouple animation from mount.

- **`pendingTripDetailId` + `pendingTripFocus` survive across Profile open/close.** When going Profile → back → Trips, the trip detail auto-restores via these pending values. In a navigator these would be route params that must be preserved when navigating. Using `setParams` or route state rather than component state is the right migration path.

- **WelcomeToLineupOverlay fires `markWelcomeLineupDismissed()` from TutorialContext.** If the overlay is converted to a modal route, the tutorial context update must still fire on close.

- **`handleSwellyPress` opens Copy, `handleSwellyPressCopy` also opens Copy** (dev card). Both routes converge on `showTripPlanningChatCopy=true`. There is no path that sets `showTripPlanningChat=true` in the current codebase via a user action.

- **`handleSkipDemo` sets `setProfileFromOnboardingChat(true)` and `setShowProfile(true)` in the same call chain as `markOnboardingComplete()`.** Order matters: profile must be the active overlay before `isComplete` flips, otherwise the default `isComplete && user → conversations` render fires first. Migration must preserve this ordering guarantee.

- **`ProfileEditPanel` uses `<Modal animationType="none">` with `mounted` prop (not `visible`).** It renders its content immediately when `visible=true` but uses an internal `mounted` boolean to gate the actual Modal; this avoids a flash on first open. The Animated entrance is owned internally. Migration should keep it as a Modal rather than a navigator route.
