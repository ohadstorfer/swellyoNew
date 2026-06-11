# R2 — AppContent.tsx Deep Map

**File:** `src/components/AppContent.tsx`
**Lines:** ~2335
**Role:** The entire routing brain of the app. No react-navigation above it (it IS the router). Everything is boolean `useState` + a priority cascade in the render.

---

## A. useState / useRef that participate in routing

| Name | Type | What it shows / tracks |
|---|---|---|
| `isCheckingAuth` | `boolean` | Gates WelcomeScreen spinner while OAuth/session resolves |
| `showAgeBlockOverlay` | `boolean` | Full-screen underage block (renders early-return before everything else) |
| `showVideoUploadStep` | `boolean` | Sub-state inside step 2 onboarding — shows `OnboardingVideoUploadScreen` instead of `OnboardingStep2Screen` |
| `hasValidatedSession` | `boolean` | Guards home screen; set true after Supabase `getSession()` confirms token |
| `isSupabaseConfigured` | `boolean \| null` | Allows bypassing session validation if Supabase env missing |
| `pendingNotificationConversationId` | `string \| null` | Push tap → open this DM after main app renders |
| `pendingTripDetailId` | `string \| null` | Push/deep-link → open this trip in TripsScreen |
| `pendingTripFocus` | `TripDetailFocus \| null` | Which section of the trip detail to scroll-to on open |
| `pendingInviteGroupId` | `string \| null` | Surftrip tokenless invite link (native only) |
| `pendingInviteToken` | `string \| null` | Surftrip token invite link (native only) |
| `pendingTripInviteId` | `string \| null` | Group-trip invite link (native only) |
| `showProfile` | `boolean` | ProfileScreen overlay |
| `showProfileEditor` | `boolean` | ProfileEditPanel bottom-sheet |
| `showTripPlanningChat` | `boolean` | Swelly chat overlay (legacy/production variant) |
| `showTripPlanningChatCopy` | `boolean` | Swelly chat overlay (Copy variant — current primary) |
| `tripPlanningChatEverShown` | `boolean` | Lazy-mount gate — once true, TripPlanningChatScreen stays mounted forever |
| `tripPlanningChatCopyEverShown` | `boolean` | Same gate for Copy variant |
| `showSwellyShaper` | `boolean` | SwellyShaperScreen overlay |
| `showSettings` | `boolean` | SettingsScreen overlay |
| `showTrips` | `boolean` | TripsScreen overlay |
| `tripsInnerOverlayOpen` | `boolean` | True while TripsScreen shows its own inner full-screen (detail/edit wizard) — hides bottom nav |
| `activeSurftripDetailId` | `string \| null` | SurftripDetailScreen overlay; wins over showTrips in priority |
| `viewingUserId` | `string \| null` | null = own profile; non-null = another user's profile |
| `selectedConversation` | `object \| null` | DirectMessageScreen / DirectGroupChat overlay |
| `showConversationLoading` | `boolean` | ConversationLoadingScreen overlay (match animation) |
| `pendingConversation` | `object \| null` | Holds DM params while loading screen plays |
| `showWelcomeToLineupOverlay` | `boolean` | WelcomeToLineupOverlay modal |
| `welcomeOverlayHiddenByProfile` | `boolean` | Hides overlay while profile slides over it (re-appears on back) |
| `onboardingMatchResult` | `OnboardingMatchResult \| null` | Data for WelcomeToLineupOverlay |
| `joinDecisionQueue` | `UnseenJoinDecision[]` | Queue of host approve/decline decisions — front item shown as overlay |
| `tripPlanningChatId` | `string \| null` | Persisted chat ID across TripPlanningChat open/close |
| `tripPlanningMatchedUsers` | `any[]` | Persisted match results |
| `tripPlanningDestination` | `string` | Persisted destination string |
| `activeCopyService` | `'copy' \| 'copy-copy'` | Which Swelly service the Copy screen uses |
| `currentUserAvatar` | `string \| null` | For ConversationLoadingScreen and SettingsScreen |
| `currentUserName` | `string` | Same |

**Refs used for routing guards:**
- `isNavigatingRef`: prevents double-tap on step 1 back
- `isLoggingOutRef`: prevents double-tap on logout
- `sessionValidationRef`: prevents double session validation
- `inviteResolverRef` / `tripInviteResolverRef`: prevent invite resolution running twice
- `joinDecisionsFetchedForUserRef`: per-user dedup for join-decision fetch

---

## B. Origin-tracking back flags

These booleans encode WHERE the profile was opened from, so `handleProfileBack` knows where to return:

| Flag | Set by | Cleared by | Effect on back |
|---|---|---|---|
| `profileFromSwellyShaper` | `handleSwellyShaperBack` | `handleProfileBack` | Returns to SwellyShaperScreen |
| `profileFromTripPlanningChat` | `handleViewUserProfile(fromTripPlanningChat=true)` | `handleProfileBack` | Returns to `showTripPlanningChat=true` |
| `profileFromTripDetail` | `handleViewUserProfileFromTrip` | `handleProfileBack` | Returns to `showTrips=true` (pendingTripDetailId restores detail) |
| `profileFromOnboardingChat` | `handleSkipDemo`, `handleStep7Next`, `handleSwellyShaperViewProfile` | `handleProfileBack` | Shows special post-onboarding profile header |
| `profileFromWelcomeOverlay` | `WelcomeToLineupOverlay.onViewProfile` | `handleProfileBack` (delayed 350ms) | Returns to overlay; hides profile after modal fade |

There is NO generic "back stack" — each path is a manually coded if-branch inside `handleProfileBack`.

---

## C. Handler → state mutations (all screen transitions)

```
handleGetStarted            → setCurrentStep(0)
handleDemoChat              → setUser, setIsDemoUser(true), setCurrentStep(0)
handleSkipDemo              → setProfileFromOnboardingChat(true), setShowProfile(true), markOnboardingComplete()
handleWelcomeBack           → setCurrentStep(STEP_WELCOME), setUser(null), setIsDemoUser(false), performLogout
handleStep1Next             → setCurrentStep(2 or 3)  [SoftTop skips step 2]
handleStep2Next             → setShowVideoUploadStep(true)
handleVideoUploadNext/Skip  → setShowVideoUploadStep(false), setCurrentStep(3)
handleVideoUploadBack       → setShowVideoUploadStep(false)  [stays at step 2]
handleStep3Next             → setCurrentStep(4)
handleStep4Next             → setCurrentStep(5)
handleStep5Next             → setCurrentStep(6)
handleStep6Next             → setCurrentStep(7)
handleStep7Next             → setProfileFromOnboardingChat(true), setShowProfile(true), markOnboardingComplete()
handleProfileBack           → (branching) see origin flags above
handleSaveAndGoToConversations → handleProfileBack(), then optionally setShowWelcomeToLineupOverlay(true)
handleSwellyShaperBack      → setProfileFromSwellyShaper(true), setShowSwellyShaper(false), setShowProfile(true)
handleSwellyShaperViewProfile → setProfileFromOnboardingChat(true), setShowSwellyShaper(false), setShowProfile(true)
handleSwellyPress           → setActiveCopyService('copy'), setShowTripPlanningChatCopy(true)
handleSwellyPressCopy       → setActiveCopyService('copy-copy'), setShowTripPlanningChatCopy(true)
handleTripPlanningChatBack  → setShowTripPlanningChat(false)
handleProfilePress          → setShowProfile(true), setViewingUserId(null)
handleViewUserProfile       → setViewingUserId, setShowProfile(true), setSelectedConversation(null)
handleViewUserProfileFromTrip → setPendingTripDetailId(fromTripId), setProfileFromTripDetail(true), setShowTrips(false), handleViewUserProfile
handleOpenGroupChat         → setShowTrips(false), setPendingTripDetailId(null), setSelectedConversation({isDirect:false,tripId})
handleOpenTripDetailFromChat → setSelectedConversation(null), setPendingTripFocus, setPendingTripDetailId, setShowTrips(true)
handleOpenSurftripDetail    → setSelectedConversation(null), setActiveSurftripDetailId
handleOpenSurftripChat      → setActiveSurftripDetailId(null), setSelectedConversation({isDirect:false,surftripId})
handleStartConversation     → if existing conv: setSelectedConversation; else: setPendingConversation, setShowConversationLoading(true)
handleConversationLoadingComplete → setSelectedConversation, setShowConversationLoading(false), setPendingConversation(null)
handleBackFromChat          → setSelectedConversation(null); if fromTripPlanning: setShowTripPlanningChat/Copy(true)
handleJoinDecisionPrimary   → advanceJoinDecisionQueue, setPendingTripDetailId + setShowTrips (if approved)
BottomNav.onLineupPress     → setShowTrips(false), setShowProfile(false), setViewingUserId(null), setPendingTripDetailId(null)
BottomNav.onTripsPress      → setShowProfile(false), setViewingUserId(null), setShowTrips(true)
BottomNav.onProfilePress    → if showTrips: setProfileFromTripDetail(true), setPendingTripDetailId(null), setShowTrips(false); setShowProfile(true)
handleAgeBlockOK            → signOut, resetOnboarding, setUser(null), setCurrentStep(STEP_WELCOME)
```

---

## D. Render priority chain (first match wins)

```
1.  showAgeBlockOverlay           → full-screen age gate (returns early, no nav)
2.  isRestoringSession            → WelcomeScreen(isCheckingAuth=true)
3.  shouldShowConversations       → MAIN APP TREE (see overlay cascade below)
4.  currentStep >= 0 && <= 7     → OnboardingScaffold (with step content switcher)
5.  fallthrough                  → WelcomeScreen (with isAuthResolving spinner logic)
```

**Inside shouldShowConversations — activeOverlay priority cascade:**
```
1.  activeSurftripDetailId        → SurftripDetailScreen
2.  showTrips                     → TripsScreen
3.  showSettings                  → SettingsScreen
4.  showSwellyShaper              → SwellyShaperScreen
5.  showProfile                   → ProfileScreen
6.  showConversationLoading && pendingConversation → ConversationLoadingScreen
7.  selectedConversation          → DirectMessageScreen OR DirectGroupChat
8.  (none)                        → null (ConversationsStack is visible baseline)
```

**Persistent layers rendered unconditionally (below activeOverlay):**
- `ConversationsStack` — always mounted, never unmounts after first render
- `TripPlanningChatScreen` (regular) — mounted once on first open, hidden with `display:'none'`
- `TripPlanningChatScreenCopy` — same pattern
- `TripsBottomNav` — shown when `showBottomNav=true`
- `WelcomeToLineupOverlay` — always rendered; visibility via `visible` prop
- `ProfileEditPanel` — always rendered; visibility via `visible` prop
- `JoinDecisionOverlay` — always rendered; visibility via `!!activeJoinDecision`

**Layer z-order (bottom → top):**
```
ConversationsStack (base)
TripPlanningChatScreen (display:none when hidden)
TripPlanningChatScreenCopy (display:none when hidden)
activeOverlay (absoluteFill View)
TripsBottomNav (conditional)
WelcomeToLineupOverlay (RN Modal, always rendered)
ProfileEditPanel (bottom sheet, always rendered)
JoinDecisionOverlay (always rendered)
```

Note: `pointerEvents` on TripPlanningChat layers is manually set to `'none'` when another overlay is on top — it is NOT a true navigation stack, just manual z-ordering.

---

## E. Props threaded into child screens (navigation-ish)

### ConversationsStack
```
isListFrontmost, onConversationPress, onSwellyPress, onSwellyPressCopy,
onProfilePress, onSettingsPress, onTripsPress, onOpenTripDetail,
onOpenSurftripDetail, onViewUserProfile, onSwellyShaperViewProfile,
pendingNotificationConversationId, onPendingNotificationHandled
```

### TripsScreen
```
onBack, initialTripId (pendingTripDetailId), initialTripFocus (pendingTripFocus),
onOpenGroupChat, onViewUserProfile (→ handleViewUserProfileFromTrip),
navControl (bottomNavControl), onInnerOverlayChange (setTripsInnerOverlayOpen)
```

### ProfileScreen
```
onBack, userId (viewingUserId), onMessage (handleStartConversation),
fromOnboardingChat, onSaveAndGoToConversations, noTransition,
suppressConnectAnalytics, onEdit
```

### TripPlanningChatScreen / Copy
```
onChatComplete, onViewUserProfile, onStartConversation,
persistedChatId, persistedMatchedUsers, persistedDestination,
onChatStateChange, service (Copy only), onboardingMatches (Copy only), visible (Copy only)
```

### DirectMessageScreen / DirectGroupChat
```
conversationId, otherUserId, otherUserName, otherUserAvatar, isDirect,
fromTripPlanning, tripId, surftripId, onBack, onViewProfile,
onOpenTripDetail, onOpenSurftripDetail, onConversationCreated
```

### SettingsScreen
```
onBack, userName, userAvatar, userEmail
```

### SwellyShaperScreen
```
onBack, onViewProfile
```

### SurftripDetailScreen (from AppContent, not ConversationsStack)
```
groupId, currentUserId, onBack, onOpenChat
```

---

## F. Auth/onboarding effects that force screen changes

### Session restoration (cold start)
- `isRestoringSession` (from `useOnboarding`) → shows `WelcomeScreen(isCheckingAuth=true)` until false.
- After restoration: `shouldShowConversations` computed from `isComplete && user !== null && hasValidatedSession`.

### Session validation
- `useEffect([user, isDemoUser, isRestoringSession, isSupabaseConfigured])` → calls `supabase.auth.getSession()`. If invalid → calls `performLogout` (sets `user=null, currentStep=STEP_WELCOME`).

### Step correction
- `useEffect` on `[user, isDemoUser, isComplete, currentStep]` → if signed-in user somehow stuck at `STEP_WELCOME (-1)` → `setCurrentStep(STEP_ONBOARDING_WELCOME)`.

### Logout choreography (handleWelcomeBack)
1. `setCurrentStep(STEP_WELCOME)` + `setUser(null)` + `setIsDemoUser(false)` — synchronous (UI flips immediately)
2. `performLogout()` — async (clears caches, Supabase signOut)
3. `resetOnboarding()` — async (clears AsyncStorage)

### MVP mode
- `isMVPMode = process.env.EXPO_PUBLIC_MVP_MODE === 'true'` — read as a constant; no special screen in AppContent itself. The MVP mode flag is passed into the Swelly chat edge function selection, not a routing branch in this file. **The AppContent does NOT have an MVP mode early-return; MVP blocks are in the screens themselves.**

### Demo mode
- `handleDemoChat` → creates demo user, `setIsDemoUser(true)`, `setCurrentStep(0)` → enters onboarding.
- `handleSkipDemo` → creates demo user, skips all steps, goes directly to profile then home.

### Age gate
- On mount: checks `ageGateService.checkBlocked()` → `setShowAgeBlockOverlay(true)` if blocked.
- Handling `handleAgeBlockOK` → signs out, `resetOnboarding()`, `setUser(null)`, `setCurrentStep(STEP_WELCOME)`.

### Push notifications (foreground)
- `pushNotificationService.setupNotificationHandlers(...)` → callback sets `setPendingTripDetailId` + `setShowTrips(true)` OR `setPendingNotificationConversationId`.
- These are processed in the render when `shouldShowConversations` is true.

---

## G. Bottom Nav control wiring

### `useTripsBottomNavControl` (from `TripsBottomNav.tsx`)
Returns `{ progress: SharedValue<number>, onVerticalScroll, collapse, expand }`. Progress drives all Reanimated animations. Key insight: it is a shared value, not React state — animated off the UI thread.

### `showBottomNav` conditions
```js
showBottomNav =
  isListFrontmost ||  // Lineup home (no overlays open)
  (showTrips && !activeSurftripDetailId && !tripsInnerOverlayOpen) ||  // Trips tab (not inside inner overlay)
  (showProfile && !viewingUserId && !activeSurftripDetailId && !showTrips &&
   !showSettings && !showSwellyShaper && !profileFromOnboardingChat &&
   !showProfileEditor && !showWelcomeToLineupOverlay)  // own profile only
```

`bottomNavActive: NavKey` is derived: `showTrips → 'trips'`, `showProfile → 'profile'`, else `'lineup'`.

### `navControl` threaded to TripsScreen
TripsScreen calls `navControl.onVerticalScroll(key, e)` to collapse/expand the bar on scroll. The bar is rendered in AppContent, not in TripsScreen.

---

## H. Push notification / deep-link plumbing

### Push notification tap flow (native only)
```
pushNotificationService.setupNotificationHandlers (AppContent useEffect) →
  payload.tripId:
    setSelectedConversation(null)
    setPendingTripFocus(tripFocusForNotification(type, {stage, decision}))
    setPendingTripDetailId(tripId)
    setShowTrips(true)
  payload.conversationId:
    setPendingNotificationConversationId(conversationId)
      → ConversationsStack receives this as prop, handles opening the DM
      → after handled: setPendingNotificationConversationId(null)
```

### Surftrip invite deep-link (native cold-start)
```
Linking.getInitialURL() / Linking.addEventListener('url') → parseInviteFromUrl →
  setPendingInviteGroupId OR setPendingInviteToken OR setPendingTripInviteId

After user signs in + isComplete:
  pendingInviteToken: acceptSurftripInvite(token) → setSelectedConversation (group chat) OR setActiveSurftripDetailId
  pendingInviteGroupId (tokenless): setActiveSurftripDetailId(groupId)
  pendingTripInviteId: setShowTrips(true) + setPendingTripDetailId (group-trip detail)

Persistence: AsyncStorage 'pendingSurftripInvite' and 'pendingGroupTripInvite'
  — survives kill/restart during signup flow.
  Web is excluded from all of this (Platform.OS === 'web' returns early).
```

### pendingTripDetailId flow once showTrips=true
- Passed to `TripsScreen` as `initialTripId` prop.
- TripsScreen uses it to open the trip detail on mount.
- When TripsScreen's onBack fires: `setPendingTripDetailId(null)` clears it so re-opening Trips doesn't re-navigate.
- When `profileFromTripDetail` back path fires: `pendingTripDetailId` is NOT cleared, so returning to Trips restores the detail.

---

## I. ConversationsStack architecture note

`ConversationsStack` (`src/navigation/ConversationsStack.tsx`) uses `react-native-screen-transitions/blank-stack` — a custom navigator, NOT the standard `@react-navigation/stack`. It is `independent` (its own navigation tree, not connected to any parent Navigator). On web it renders `ConversationsScreen` directly with no inner stack.

DMs opened from ConversationsScreen navigate via `navigation.navigate('DirectMessage', params)` inside ConversationsStack. DMs opened from AppContent level (push notification, trip planning back, etc.) go through `setSelectedConversation` which renders at AppContent overlay level, NOT inside ConversationsStack. These are two separate code paths for what looks like the same screen.

---

## J. Copy / experimental file inventory

| File | Live? | Notes |
|---|---|---|
| `src/screens/TripPlanningChatScreen.tsx` | LIVE but hidden | Legacy variant; `showTripPlanningChat` never set true in normal flows (only `handleTripPlanningChatBack` clears it). All Swelly opens go to Copy variant. |
| `src/screens/TripPlanningChatScreenCopy.tsx` | LIVE / primary | Opened by `handleSwellyPress`, `handleSwellyPressCopy`, and WelcomeOverlay "more matches". This is the active Swelly chat. |
| `src/services/swelly/swellyServiceCopy.ts` | Used | Imported as `swellyServiceCopy` in AppContent |
| `swellyServiceCopyCopy` | Used (dev card) | Used when `activeCopyService === 'copy-copy'` |

---

## K. Screens requiring stay-mounted / state preservation

| Screen | Why keep mounted | Mechanism |
|---|---|---|
| `ConversationsStack` | Scroll position, messaging subscriptions, conversation list state | Always in tree, never unmounts |
| `TripPlanningChatScreen` (both) | Chat messages, scroll, websocket, prevents re-animation on profile return | `tripPlanningChatEverShown` gate + `display:'none'` toggle |
| `TripsBottomNav` | Pill animation must be continuous across tab switches | Single instance, persistent above overlay stack |

All other screens (Profile, Settings, DM, etc.) are unmounted when their overlay slot is cleared.

---

## L. Platform branches

| Behavior | Condition |
|---|---|
| Invite link parsing (Linking API) | `Platform.OS !== 'web'` — web excluded from ALL invite link logic |
| Push notification setup | `Platform.OS !== 'web'` |
| ConversationsStack inner navigator | `Platform.OS !== 'web'` — web gets flat `ConversationsScreen` only |
| OAuth PKCE code detection | `Platform.OS === 'web'` only (checks `window.location.search`) |
| No `.web.tsx` variant | AppContent has no web-specific file — same component, platform branches inline |

---

## M. Counts

- **Total screens rendered from AppContent:** 16
  - WelcomeScreen, OnboardingWelcomeScreen, OnboardingStep1–4Screen, OnboardingStep4DestinationsScreen, OnboardingStep5BudgetScreen, OnboardingStep6LifestyleScreen, OnboardingVideoUploadScreen, OnboardingStep4Screen (step7 slot), TripPlanningChatScreen, TripPlanningChatScreenCopy, TripsScreen, SurftripDetailScreen, ProfileScreen, DirectMessageScreen, DirectGroupChat, SettingsScreen, SwellyShaperScreen, ConversationLoadingScreen, ConversationsStack (host)
- **Overlay-level modals (always rendered, visibility prop):** 3 — WelcomeToLineupOverlay, ProfileEditPanel, JoinDecisionOverlay
- **Origin-tracking back flags:** 5 — profileFromSwellyShaper, profileFromTripPlanningChat, profileFromTripDetail, profileFromOnboardingChat, profileFromWelcomeOverlay
- **Deep-link pending-state variables:** 5 — pendingTripDetailId, pendingTripFocus, pendingNotificationConversationId, pendingInviteGroupId/Token, pendingTripInviteId

---

## N. Migration landmines

1. **Two separate DM code paths**: DMs from ConversationsScreen are pushed inside `ConversationsStack` (react-navigation). DMs from push notifications / trip-planning back / profile are rendered as AppContent-level `selectedConversation` overlay. These are the same `DirectMessageScreen` component rendered in two totally different contexts. Migration must unify or carefully preserve both.

2. **TripPlanningChat persistent mount**: Both chat screens must NEVER unmount after first open. The `display:'none'` trick works in RN because components stay in the React tree with `display:none`. In react-navigation, a screen that is "goBack()"d IS unmounted unless `detachInactiveScreens={false}`. This must be explicitly handled.

3. **TripsBottomNav is rendered in AppContent, not in tabs**: The nav bar is a sibling of TripsScreen, not a child. Its `navControl` SharedValue is created in AppContent and passed down as a prop. Migration must preserve single-instance rendering above all tab content.

4. **profileFromTripDetail back path uses pendingTripDetailId as restore signal**: When navigating from Trip → Profile → back to Trip, `pendingTripDetailId` is left set intentionally so TripsScreen reopens to the correct trip. This is a stateful side-effect that would break if the trip detail route param is cleared on navigation.goBack().

5. **handleProfileBack is a 5-branch manual stack**: There is no navigation history. The back destination is determined by which combination of `profileFrom*` flags is currently true. This must be replicated exactly or the profile's "back" will break in 5 different contexts.

6. **WelcomeOverlay → Profile back has a 350ms setTimeout delay**: `handleProfileBack` for `profileFromWelcomeOverlay` sets `setShowProfile(false)` after a 350ms delay to let the modal fade complete. Immediate unmount causes a white flash through the semi-transparent backdrop.

7. **shouldShowConversations is not just auth check**: It gates on `!sessionValidationRef.current` (a ref, not state). The ref is an async in-flight guard. There is a brief window where `user !== null` but `shouldShowConversations` is false while the Supabase session is being validated — the WelcomeScreen with spinner is shown. Migration must replicate this guard.

8. **ConversationsStack is `independent`**: It is a standalone navigation tree not connected to any parent Navigator. When migrating to react-navigation v7 tabs, this nested navigator will need to be declared as a child of the Lineup tab screen — but its `independent` flag means it currently ignores any parent navigation state. This architectural isolation must be preserved.

9. **activeSurftripDetailId beats showTrips in the cascade**: Opening a surftrip detail from ConversationsStack sets `activeSurftripDetailId` and clears `showTrips=false`. But opening a group-trip detail goes through `showTrips=true` + `pendingTripDetailId`. These are different overlay slots for visually similar screens — they must remain distinct routes or be explicitly merged.

10. **MVP mode has no AppContent routing branch**: The MVP mode early-return is inside individual screens, not a routing gate here. A migration engineer looking only at AppContent will not find it.
