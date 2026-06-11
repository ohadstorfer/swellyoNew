# R3 — Trips Area Navigation Inventory

_Research date: 2026-06-11. Branch: eyal._

---

## 1. File Inventory

### Screens (`src/screens/trips/`)

| File | Status | Role |
|------|--------|------|
| `TripsScreen.tsx` | **LIVE** | Shell screen: 3-tab pager (My / Explore / Create) + trip-detail overlay + edit-wizard overlay + create Modal |
| `TripDetailScreen.tsx` | **LIVE** | Full trip detail: Overview + Plan tabs, all sheets as local state |
| `CreateTripWizard.tsx` | **LIVE** | Pure router — delegates 100% to `CreateTripFlowA` |
| `CreateTripFlowA.tsx` | **LIVE** | The actual 5-step wizard: audience → basics → vibez → budget → preview (Flow B adds aboutYou) |
| `TripPublishedScreen.tsx` | **LIVE** | Success/share screen shown at end of `CreateTripFlowA` |

No `.web.tsx` platform-split variants exist for any of these files. Platform branches are inline `Platform.OS === 'web'` checks only.

### Components (`src/components/trips/`)

**Core layout / view:**
- `TripDetailView.tsx` — read-only VM renderer used by **wizard preview step only** (not live TripDetailScreen)
- `TripDetailViewRedesigned.tsx` — **live** in TripDetailScreen; visual reskin of TripDetailView
- `TripsBottomNav.tsx` — floating bottom nav bar + `useTripsBottomNavControl` hook
- `CreateTripWizardChrome.tsx` — wizard header chrome (close X, step count, progress)
- `TripTabToggle.tsx` — Overview / Plan tab toggle rendered inside TripDetailScreen
- `WizardBottomSheet.tsx` — generic shell for all wizard input sheets (drag-dismiss + PanResponder)
- `TripBottomSheet.tsx` — generic shell for all trip-action sheets (KAV + backdrop)
- `TripPreviewCard.tsx` — compact trip card used in wizard preview

**Sheets (`src/components/trips/sheets/`):**

| File | Opens from |
|------|-----------|
| `WhenSheetContent.tsx` | WizardBottomSheet wrapper in CreateTripFlowA (basics step) and TripEditSheets |
| `CalendarRangePicker.tsx` | Embedded inside WhenSheetContent |
| `LevelsSheetContent.tsx` | Wizard audience step |
| `WaveSizeSheetContent.tsx` | Wizard audience step |
| `WaveSheetContent.tsx` | Wizard basics step |
| `StyleSheetContent.tsx` | Wizard audience step |
| `AgeSheetContent.tsx` | Wizard audience step |
| `VibeSheetContent.tsx` | Wizard vibez step |
| `StayTypeSheetContent.tsx` | Wizard vibez step + TripEditSheets |
| `SpecificStaySheetContent.tsx` | Wizard vibez step + TripEditSheets |
| `HowItWorksSheetContent.tsx` | TripDetailView (read-only info popup) |
| `IncludesSheets.tsx` | Multiple wizard Flow-C budget-step sheets |
| `SheetOptionCard.tsx` | Helper used by several above |

**Trip-action sheets:**

| File | Opens from |
|------|-----------|
| `joinRequest/RequestToJoinSheet.tsx` | TripDetailScreen (non-member CTA) |
| `joinRequest/JoinDecisionOverlay.tsx` | **AppContent** (queued global overlay) |
| `commitment/CommitmentSheet.tsx` | TripDetailScreen Plan tab |
| `commitment/CommitmentReviewBar.tsx` | TripDetailScreen Plan tab |
| `commitment/CommitmentConfirmModal.tsx` | TripDetailScreen |
| `gear/GearItemSheet.tsx` | TripDetailScreen Plan tab |
| `gear/RequestGearSheet.tsx` | TripDetailScreen Plan tab |
| `gear/ManageGearSheet.tsx` | TripDetailScreen Plan tab (host) |
| `gear/GearRequestsSheet.tsx` | TripDetailScreen Plan tab (host) |
| `gear/PersonalGearSheet.tsx` | TripDetailScreen Plan tab |
| `gear/AddPersonalGearSheet.tsx` | TripDetailScreen Plan tab |
| `gear/EditSuggestedGearSheet.tsx` | TripDetailScreen Plan tab (host) |
| `updates/AdminUpdateSheet.tsx` | TripDetailScreen Plan tab (host) |
| `TripEditSheets.tsx` | TripDetailScreen (host inline edits: EditTextSheet, EditCoverSheet, EditDatesSheet, EditAccommodationSheet) |

**Other components:**
- `RangeSlider.tsx` — wave-size range input in wizard; uses PanResponder (web) or RNGH gestures (native)
- `WizardInfoOverlay.tsx` — one-time audience-step intro overlay (rendered inside the wizard)
- `AudienceCard.tsx` — locked/unlocked card in wizard audience step
- All others (`ParticipantCard`, `PendingRequestCard`, `TripParticipantsBreakdown`, `BudgetTierCards`, etc.) — pure display, no navigation logic

**Experimental (Copy) variants:**
- None found in the trips screen/component directories. The trips feature has no `-copy` shadows.

### Hooks (`src/hooks/trips/`)

| File | Mount assumption |
|------|-----------------|
| `useTripRealtime.ts` | Mounted while TripDetailScreen is mounted; subscribes to private Broadcast topic `trip:{tripId}`; unsubscribes on unmount. Tied to `tripId`. |
| `useTripsListRealtime.ts` | Mounted for the lifetime of TripsScreen; subscribes to `trips-list` Broadcast topic. Does NOT depend on userId — one shared topic. |
| `useTripDetail.ts` | 5 react-query hooks (core, updates, gear, requests, gearRequests); uses `placeholderData` seeded from the explore list cache |
| `useTripQueries.ts` | `useExploreTrips` + `useMyTrips`; stale-while-revalidate; survive across tab switches |

---

## 2. Navigation Topology (Current State)

### AppContent boolean router (src/components/AppContent.tsx)

```
shouldShowConversations=true
  → activeOverlay priority order:
    1. activeSurftripDetailId     → SurftripDetailScreen
    2. showTrips                  → TripsScreen
    3. showSettings               → SettingsScreen
    4. showSwellyShaper           → SwellyShaperScreen
    5. showProfile                → ProfileScreen
    6. showConversationLoading    → ConversationLoadingScreen
    7. selectedConversation       → DirectMessageScreen / DirectGroupChat
    (none) → ConversationsStack (home)
```

`TripsBottomNav` (the floating bar) is rendered **once** at AppContent level, above all overlays. It persists across the entire app; its `active` prop and `control` (shared value) are passed down.

### TripsScreen internal layers (src/screens/trips/TripsScreen.tsx)

```
<SafeAreaView>
  <TripsHeader + TripsHeaderTabs>
  <body>
    <Reanimated.View (pagerRow — translates horizontally)>
      <TabPane index=0>  { visited.my   && <MyTripsView> }
      <TabPane index=1>  { visited.explore && <ExploreTripsView> }
      <TabPane index=2>  { visited.create && <chooser ScrollView + HOSTING_STYLE_OPTIONS> }
    </Reanimated.View>

  // OVERLAY 1 — trip detail (absoluteFillObject, zIndex 20)
  {selectedTripId && (
    <Reanimated.View entering=SlideInRight exiting=SlideOutRight>
      <TripDetailScreen>
    </Reanimated.View>
  )}

  // OVERLAY 2 — edit-trip wizard (absoluteFillObject, zIndex > 20 via stack order)
  {editingTrip && (
    <View style=screenOverlay>
      <SafeAreaView>
        <CreateTripWizard initialTrip=editingTrip>
      </SafeAreaView>
    </View>
  )}

  // MODAL — new trip wizard (fullScreen, animationType=slide)
  <Modal visible=createModalVisible presentationStyle="fullScreen">
    <CreateTripWizard hostingStyle=pendingStyle>
  </Modal>
</SafeAreaView>
```

### TripDetailScreen internal layers

```
<SafeAreaView>
  <Header (back / chat icon / NotificationCenter)>
  <KeyboardAvoidingView>
    <ScrollView ref=scrollRef>
      <TripDetailViewRedesigned vm=... afterHeroSlot=<TripTabToggle> bodyHidden=showPlan />
      {showPlan && (
        CommitPill / AdminUpdatesCard / GroupGearCard / YourGearCard
        PendingRequests / DeclinedRequests / Members / GroupBreakdown / DangerRows
      )}
    </ScrollView>
  </KeyboardAvoidingView>

  // Floating sticky CTA (FadeInUp)
  {showJoinCta && <CtaButton>}
  {showChatCta && <Trip Chat button>}

  // All sheets (Modal or WizardBottomSheet/TripBottomSheet wrapping content):
  GearItemSheet / RequestGearSheet / ManageGearSheet / GearRequestsSheet
  CommitmentSheet / RequestToJoinSheet
  AdminUpdateSheet
  PersonalGearSheet / AddPersonalGearSheet / EditSuggestedGearSheet
  EditCoverSheet / EditTextSheet / EditDatesSheet / EditAccommodationSheet
```

### CreateTripFlowA internal layers

```
<CreateTripWizardChrome (chrome: close X, step label, progress)>
  <ScrollView (wizard step body)>
    <step content (varies by step key)>
  </ScrollView>

  // WizardBottomSheet instances (one per input that opens a sheet):
  WhenSheet / LevelsSheet / WaveSizeSheet / WaveShapeSlider
  StyleSheet / AgeSheet / VibeSheet / StayTypeSheet / SpecificStaySheet
  HowItWorksSheet / IncludesSheets (Flow C) / WaveSheet
  HomeBreakSearchSheet (destination picker — uses InlineMapView / WebView)

  // WizardInfoOverlay — one-time audience intro (Modal transparent)
  // TripPublishedScreen — replaces the wizard body on successful publish
```

---

## 3. Trigger / Open / Close Mechanics

### TripsScreen

**Opens when:** `showTrips=true` set in AppContent by:
- BottomNav "Trips" press
- Push notification with `tripId` (sets `pendingTripDetailId` + `pendingTripFocus` first)
- Group-trip invite deep-link (`?grouptrip=<tripId>`)
- `handleJoinDecisionPrimary` (after host decision overlay)
- `handleOpenTripDetailFromChat` (header tap in group chat)

**Closes when:** `onBack` calls `setShowTrips(false)` + clears `pendingTripDetailId` / `pendingTripFocus`.

**Kept-mounted:** NO. TripsScreen unmounts when `showTrips` flips to false. React-query cache provides instant re-entry; realtime subscriptions (`useTripsListRealtime`, `useTripRealtime`) subscribe/unsubscribe on mount/unmount.

### Tab pager inside TripsScreen

- **All three tabs start lazy-mounted** on first visit (`visited` record). Once visited, panes stay translated off-screen (not unmounted) so scroll position and react-query state survive switching.
- Initial active tab is `'explore'` hardcoded (`useState<TripsTab>('explore')`).
- Tab animation: `react-native-reanimated` `withTiming` translating a `pagerRow` + per-pane opacity cross-fade via `useAnimatedStyle`.
- **Explore tab** starts as `visited.explore = true`; My Trips + Create start as `false`.

### Trip Detail overlay (inside TripsScreen)

**Opens when:** `selectedTripId` state set by `setSelectedTripId(tripId)` from:
- `TripCard` / `ExploreTripCard` press (`onOpenTrip`)
- Push notification → `openTripFromNotification(tripId, focus)`
- `initialTripId` prop on mount (notification deep-link from AppContent)

**Closes when:** `onBack` sets `selectedTripId=null` and `selectedTripFocus=null`.

**Animation:** Reanimated `SlideInRight` (280ms cubic ease-out) enter / `SlideOutRight` (220ms cubic ease-in) exit on the wrapping `Reanimated.View`. Reduced-motion respects `useReducedMotion()`.

**Kept-mounted:** The **pager tabs stay mounted underneath** during the overlay. `useTripRealtime` subscribes on TripDetailScreen mount and unsubscribes on unmount (correct).

**`initialFocus` / deep-link scroll:** When `initialFocus` is set (notification tap), TripDetailScreen switches to the Plan tab and scrolls by polling `sectionYs` (section Y positions registered via `onLayout`). Up to 30 rAF attempts, then silently gives up.

### Edit-trip overlay (inside TripsScreen)

**Opens when:** `editingTrip` state set by `onEditTrip` callback from TripDetailScreen (host presses "Edit").

**Closes when:** `setEditingTrip(null)` — either `onCancel` or `handleSavedEdit`. No Reanimated enter/exit animation (plain `View style=screenOverlay`).

**Both overlays** report `onInnerOverlayChange` to AppContent, which sets `tripsInnerOverlayOpen` → hides the floating bottom nav.

### Create-trip wizard (Modal)

**Opens when:** User taps a hosting-style card on the Create tab → `onPickStyle` → optional draft-resume Alert → `setPendingStyle(key)` → `createModalVisible = true`.

**Closes when:**
- `onCreated` (success): invalidates queries, closes modal, switches to My tab.
- `onCancel` or `closeCreateModal()`: plain close.
- Hardware back / swipe: `handleRequestCloseModal` — if `wizardStarted=true`, shows Alert; otherwise closes.

**Presentation:** RN `<Modal animationType="slide" presentationStyle="fullScreen">`. NOT a Reanimated animation.

**Draft autosave:** `useTripWizardDraft` hook in CreateTripFlowA; persists to AsyncStorage on every field change. Version key `WIZARD_STATE_VERSION = 6`. Draft is keyed by `hostingStyle` so a draft from Flow A won't be offered when the user picks Flow B.

**TripPublishedScreen:** After successful publish, `CreateTripFlowA` renders `<TripPublishedScreen>` inline (replaces the wizard body inside the same Modal). It is NOT a separate navigation push.

### Sheets inside TripDetailScreen

All 12+ sheets are `visible` boolean-driven local state inside TripDetailScreen, using either:
- `TripBottomSheet` wrapper (RN `Modal transparent + KAV`)
- `WizardBottomSheet` wrapper (RN `Modal transparent + PanResponder drag-dismiss + KAV`)

None of these appear in navigation history. They are all imperative `setState` open/close.

### Sheets inside CreateTripFlowA

All wizard input sheets use `WizardBottomSheet`. The wizard renders them all in a single component tree, controlled by multiple boolean state variables (`whenOpen`, `levelsOpen`, etc.). The `TripPublishedScreen` is rendered as a React conditional (not a navigation action).

### Group chat → AppContent lift

From TripDetailScreen, `handleOpenGroupChat` calls the lifted `onOpenGroupChat` prop, which in AppContent:
1. Sets `showTrips=false`
2. Clears `pendingTripDetailId`
3. Sets `selectedConversation` (isDirect=false, tripId attached)

This **unmounts TripsScreen**. There is no back-to-trip-detail capability from the group chat; the user lands on ConversationsStack home.

### Participant → Profile flow

From TripDetailScreen, `onViewUserProfile(userId)` prop is wired in AppContent as `handleViewUserProfileFromTrip`:
1. Saves `fromTripId` → `pendingTripDetailId`
2. Sets `profileFromTripDetail = true`
3. Sets `showTrips = false`
4. Opens profile (`setShowProfile(true)`)

On profile back (`handleProfileBack` with `profileFromTripDetail=true`):
1. Closes profile
2. Sets `showTrips = true`
3. `pendingTripDetailId` is still set → TripsScreen remounts with `initialTripId`, restoring the detail overlay.

This round-trip **unmounts and remounts TripsScreen** and TripDetailScreen. Scroll position is lost; react-query cache makes data re-entry fast but the ScrollView position is at top.

### Notification deep-link end-to-end

```
Push tap (pushNotificationService.setupNotificationHandlers)
  → payload.tripId exists
  → setShowTrips(true)
  → setPendingTripDetailId(tripId)
  → setPendingTripFocus(tripFocusForNotification(type, {stage, decision}))

AppContent renders TripsScreen with:
  initialTripId=pendingTripDetailId
  initialTripFocus=pendingTripFocus

TripsScreen:
  selectedTripId = initialTripId (set in useState initializer + useEffect watcher)
  selectedTripFocus = initialTripFocus

TripDetailScreen:
  initialFocus prop → switches to Plan tab → polls sectionYs → scrolls
```

Cold-start (app killed): `pendingTripDetailId` is held in React state only; it is NOT persisted to AsyncStorage. If the app process is killed before the state is consumed, the deep-link is lost. (Group-trip invite links use a separate AsyncStorage-persisted `pendingGroupTripInvite` key to survive kills.)

### JoinDecisionOverlay (AppContent global)

Not inside TripsScreen. Lives at AppContent level. Queue of `UnseenJoinDecision` rows, one shown at a time. Tapping primary CTA for 'approved' opens trips by setting `pendingTripFocus='commit'` + `setPendingTripDetailId` + `setShowTrips(true)`.

---

## 4. TripsBottomNav Deep-Dive

**Location:** Rendered once in AppContent (`src/components/AppContent.tsx`), not inside TripsScreen.

**Visibility logic:**
```
showBottomNav = (
  isListFrontmost   (Lineup home)
  || (showTrips && !activeSurftripDetailId && !tripsInnerOverlayOpen)
  || (showProfile && !viewingUserId && !showTrips && !showSettings && !showSwellyShaper
      && !profileFromOnboardingChat && !showProfileEditor && !showWelcomeToLineupOverlay)
)
```

**Active pill logic:** `active: NavKey` = `showTrips ? 'trips' : showProfile ? 'profile' : 'lineup'`.

**Control API (`TripsBottomNavControl`):**
- `progress: SharedValue<number>` — 0 = resting, 1 = collapsed
- `onVerticalScroll(key, event)` — fed by each scrollable tab list (My, Explore, Create); per-`key` last-offset tracking so tab switches don't produce phantom delta
- `collapse()` — discrete collapse (e.g. deck swipe)
- `expand()` — discrete restore (tap on bar)

**Scroll piping:**
- My Trips FlatList → `handleMyNavScroll` → `navControl.onVerticalScroll('my', e)`
- Explore ScrollView → `handleExploreNavScroll` → `navControl.onVerticalScroll('explore', e)`
- Create ScrollView → `handleCreateNavScroll` → `navControl.onVerticalScroll('create', e)`
- Explore deck horizontal swipe → `onUserScroll` → `navControl.collapse()` (not a scroll event — discrete)

**`navControl` is passed to TripsScreen as `navControl` prop** and falls back to a local `useTripsBottomNavControl()` instance if the prop is absent (the hook in TripsScreen is always called but only used as fallback).

**Animations:** Reanimated worklet; uses `withTiming` (450ms cubic ease-out) for collapse/expand; individual pill morphing uses `withTiming` (350ms exp ease-out). Frost backdrop uses layered `BlurView` bands (8 bands, intensity 1–6 at graduated top offsets) + `LinearGradient` + `scaleY` collapse keyed off the same `progress` shared value.

---

## 5. Explore Deck Gesture Details

- **Gesture library:** RN Core `Animated.FlatList` + `snapToInterval` + `decelerationRate="fast"` + `disableIntervalMomentum`. No RNGH swipe gesture.
- **Scroll tracking:** `scrollEventThrottle={1}` (every frame) — feeds an `Animated.Value` (not `SharedValue`) for scale/opacity/rotation/translateY interpolation on each card.
- **Web override:** `overflowX: 'auto'` applied inline when `Platform.OS === 'web'`.
- **No looping.** First and last cards are hard bounds.
- **Per-card transforms:** scale (0.85 → 1), opacity (0.6 → 1), rotation (±5°), translateY (drop alignment).
- **Reset on data change:** `useEffect` on `trips` dep resets `scrollX.setValue(0)` and scrolls FlatList to 0.

---

## 6. TripDetailView vs TripDetailViewRedesigned

| | TripDetailView | TripDetailViewRedesigned |
|---|---|---|
| Live? | NO — wizard preview only | YES — TripDetailScreen |
| Imports VM from | itself (exports `TripDetailVM`) | imports `TripDetailVM` from `TripDetailView` |
| Scroll | Has its own `<ScrollView>` | Does NOT own a ScrollView — renders into TripDetailScreen's ScrollView |
| Uses CachedImage | No | Yes (expo-image for hero, avatars, stay photo) |
| Participant row | Yes | Yes, with `onParticipantPress` / `onLeaderPress` |
| Host edit pills | No | Yes — `onEditCover`, `onEditDescription`, `onEditDates`, `onEditAccommodation`, `onEditAboutHost` |
| `afterHeroSlot` | No | Yes — used to inject `TripTabToggle` |
| `bodyHidden` | No | Yes — hides overview body when Plan tab is active |

**Critical:** The data contract `TripDetailVM` lives in `TripDetailView.tsx` and is imported by `TripDetailViewRedesigned.tsx`. If `TripDetailView` is moved or deleted, both break.

---

## 7. Keep-Mounted Requirements

| Component | Must stay mounted? | Reason |
|-----------|-------------------|--------|
| TripsScreen | NO | react-query cache handles re-entry; `useTripsListRealtime` unsubscribes cleanly |
| Tab panes (My/Explore/Create) | YES — once visited | Scroll position preservation; react-query state |
| TripDetailScreen | NO | useTripRealtime unsubscribes; cache re-entry |
| CreateTripFlowA | YES (inside Modal) | Draft autosave is AsyncStorage; wizard form state would be lost on unmount |
| TripsBottomNav | YES | Persistent pill animation must not reset when switching app sections |

---

## 8. Platform-Specific Branches

All platform branches are inline `Platform.OS === 'web'` in a single file — no `.web.tsx` variants exist in the trips area.

Key web-specific behaviors:
- `TripsScreen` → `TripDeck` (Animated.FlatList) gets CSS `overflowX: 'auto'` scroll on web
- `TripsScreen` → `onPickStyle` draft-resume uses `window.confirm()` instead of `Alert.alert()` on web
- `WizardBottomSheet` — drag handle / PanResponder is the same code on both platforms; `GestureHandlerRootView` wraps the sheet
- `TripDetailScreen` / `CreateTripFlowA` — font families use `'Font, fallback'` string on web
- `WhenSheetContent` / `CalendarRangePicker` — `InputAccessoryView` (iOS-only done button above number-pad keyboard) is rendered conditionally only on iOS
- `RangeSlider` — uses PanResponder on web (fallback), RNGH `Gesture` + `GestureDetector` on native; loaded via dynamic `require` with try/catch

---

## 9. Realtime Subscription Mount Assumptions

**`useTripsListRealtime`** (TripsScreen level):
- Subscribes to `TRIPS_LIST_TOPIC = 'trips-list'` private channel on mount.
- 300ms debounce on invalidation to coalesce burst events.
- Clean unsubscribe on unmount.
- **Assumption:** This hook MUST be called while TripsScreen is mounted. Under react-navigation, if TripsScreen moves to a background tab stack it would stay mounted — that's fine. If it gets unmounted (e.g., via conditional rendering), the subscription drops.

**`useTripRealtime`** (TripDetailScreen level):
- Per-trip channel `trip:{tripId}`. Subscribes on mount, unsubscribes on unmount.
- Dependency is `tripId`. If the same TripDetailScreen is reused across different trips (e.g., in a stack), changing `tripId` prop will re-subscribe correctly.

---

## 10. Sheets Implementation Pattern

Every sheet (wizard and detail) is one of:

1. **WizardBottomSheet** — custom RN `Modal` (transparent, animationType="none") + PanResponder drag-dismiss + spring-up `Animated.timing` on open + `GestureHandlerRootView` wrapper. Used in CreateTripFlowA for all wizard inputs and in TripEditSheets for host edits.

2. **TripBottomSheet** — RN `Modal` transparent + `KeyboardAvoidingView` + backdrop `Pressable` dismiss. Used for trip-action sheets in TripDetailScreen.

3. **Plain RN Modal** — `JoinDecisionOverlay`, `CommitmentConfirmModal`, some legacy patterns. Transparent + fade + SafeAreaView.

None of these are react-navigation `Modal` stacks or `transparentModal` routes. All are local `visible` boolean state within their parent.

---

## 11. Full Component Count

- **Screen-level surfaces:** 5 (TripsScreen, TripDetailScreen, CreateTripFlowA, CreateTripWizard router, TripPublishedScreen)
- **Trip-action sheets (TripDetailScreen):** 12 distinct sheet components
- **Wizard input sheets (CreateTripFlowA):** ~14 sheet instances (WizardBottomSheet wrapping sheet content modules)
- **Global overlays from AppContent trips area:** 1 (JoinDecisionOverlay)
- **Total distinct sheet components:** ~27

---

## 12. Migration Landmines

### L1 — TripsBottomNav lives at AppContent, not inside TripsScreen

The floating bar is owned by AppContent. Its `control` (`SharedValue<number>`) is created there and passed to TripsScreen as a prop. TripsScreen tabs pipe their scroll events back into it. Under react-navigation, the bar will need to remain outside the Trips stack and receive scroll events through some shared mechanism (context or navigation event). Moving it inside the stack would break the cross-tab pill animation.

### L2 — TripDetailScreen is an OVERLAY, not a stack push

Today `selectedTripId` renders TripDetailScreen as `absoluteFillObject` over the tab pager. The pager stays mounted underneath (scroll position preserved). If this becomes a `navigation.push('TripDetail')`, the pager tabs will be unmounted by the stack — losing scroll positions. Must use a navigation pattern that keeps the Trips tabs alive underneath (e.g., a card screen with `detachPreviousScreen: false`, or keeping the overlay approach).

### L3 — Edit-wizard overlay is above TripDetailScreen, not a separate stack

`editingTrip` renders CreateTripWizard as a second `absoluteFillObject` above the detail overlay. The detail screen stays mounted underneath. This 3-layer stack (pager → detail → edit) must be preserved.

### L4 — Create-trip wizard uses RN `<Modal presentationStyle="fullScreen">`

The existing Modal is a native full-screen sheet with `animationType="slide"`. On iOS this is a native card presentation. A react-navigation `stack.Screen` with `presentation: 'modal'` or `presentation: 'fullScreenModal'` would be a valid replacement, but the `wizardStarted` / `onStartedChange` lifecycle hook (controls the hardware-back confirm dialog) would need to be reproduced via navigation events.

### L5 — Participant → Profile back path remounts TripsScreen

The current participant tap flow: `showTrips=false` → `showProfile=true`, then on profile back `showTrips=true` with `pendingTripDetailId` still set. TripsScreen remounts and reconstructs the detail overlay from `initialTripId`. **Scroll position is lost.** Under react-navigation this becomes a proper stack and the back gesture would naturally return to TripDetailScreen without remounting — a net improvement, but the `pendingTripDetailId` / `profileFromTripDetail` state machine in AppContent must be replaced with stack navigation.

### L6 — Group chat exit from trip CLOSES TripsScreen

`handleOpenGroupChat` in AppContent sets `showTrips=false` unconditionally. Under react-navigation this would be `navigation.navigate('GroupChat', {...})` from inside a Trips stack screen, which should naturally replace or push without destroying the stack. The current behavior (full unmount) is an artifact of the boolean router.

### L7 — Notification deep-link `pendingTripDetailId` is NOT persisted

Push tap state lives only in React state — cold start kills it. The `pendingGroupTripInvite` AsyncStorage key handles invite links (separate path), but notification deep-links would silently fail if the app process is killed between notification tap and state consumption. Under react-navigation, `linking` config can handle initial URL parsing more robustly.

### L8 — `useTripsListRealtime` must stay mounted while Trips tab is visible

If TripsScreen moves to a background tab in a stack, the realtime subscription would depend on whether the tab is mounted. With `detachInactiveScreens: false` on the tab navigator, tabs stay mounted. With default settings (`detachInactiveScreens: true` on Android), the subscription drops when Trips is backgrounded.

### L9 — WizardBottomSheet uses PanResponder + `GestureHandlerRootView` together

The wizard sheets use PanResponder for drag-dismiss. This coexists with `GestureHandlerRootView` because the PanResponder is installed on the drag-handle, not the content area. However, under react-navigation's gesture system, there may be conflicts between the sheet's PanResponder and the navigator's back gesture recognizer (especially on iOS where the edge swipe and the sheet drag are both downward/rightward). Needs testing.

### L10 — `TripDetailVM` type is exported from `TripDetailView.tsx` (the non-live file)

Both `TripDetailViewRedesigned` (live) and `CreateTripFlowA` (wizard preview) import `TripDetailVM` from `TripDetailView.tsx`. If the file is ever moved or renamed, both break. The type should be extracted to a shared types file before migration.

### L11 — WhenSheetContent embeds `InputAccessoryView` (iOS only)

`WhenSheetContent` renders `<InputAccessoryView nativeID="whenDurationDone">` on iOS for the numeric keyboard done button. This is a native iOS mechanism that attaches directly to the keyboard, not to the current screen's view hierarchy. It will work inside a Modal, but may have unexpected behavior if the sheet is presented inside a react-navigation screen vs a Modal depending on how the keyboard accessory attaches to the responder chain.

### L12 — Explore deck `scrollEventThrottle={1}` is intentional (120Hz ProMotion)

The comment in code explicitly justifies `scrollEventThrottle={1}` over `16` because ProMotion (120Hz) screens would otherwise halve the transform update rate during the snap deceleration tail. Do not "optimize" this to 16 during migration.
