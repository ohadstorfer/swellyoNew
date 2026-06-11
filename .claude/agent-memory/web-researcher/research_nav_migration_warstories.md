---
name: nav-migration-warstories
description: Real-world lessons, failure modes, red flags, playbook, and testing strategies for migrating a boolean/conditional-render router to react-navigation — including v7 breaking changes, SDK 54 timing, and Swellyo-specific risks
metadata:
  type: reference
---

## Topic
War stories and best practices for migrating a React Native app from hand-rolled conditional rendering / boolean-flag routing to react-navigation. Covers strategy, breakages, scope traps, testing, team coordination, version timing, and red flags.

---

## 1. Incremental vs Atomic: What Actually Worked

**The consensus from real migrations is incremental-root-first, never full-tree-behind-a-flag.**

The only documented "atomic flag" approach (build new tree behind feature flag, switch all at once) caused two-source-of-truth corruption: if the flag could flip mid-session, conditional rendering between two different navigator trees corrupted react-navigation's internal state.

The root cause (GitHub issue #9436): when you unmount nested navigators inside a switching parent, the unmount handler calls `setState(undefined)`, which triggers a state type mismatch, and the system silently reverts to a stale `initializedStateRef`. The result is the wrong screen loads on next open.

**Working pattern: root navigator first, absorb screens one by one:**
1. Wrap the main-app render in a single `NavigationContainer` + root `createNativeStackNavigator`. Keep ALL existing boolean-flag overlays in place. Nothing user-facing changes.
2. Migrate highest-value screen first (the one with the most broken back behavior).
3. Each subsequent screen: replace `showFoo = true` with `navigation.push('Foo', params)`.
4. Ephemeral overlays (toasts, loading states) stay as absoluteFill — they do not need to be routes.

**Why not behind a feature flag:**
React Navigation's state machine assumes it is the only router. Switching between a NavigationContainer-wrapped tree and a boolean-flag tree mid-session = state corruption. The `independent` prop (removed in v7) was the only escape hatch, and it prevented cross-tree navigation entirely.

---

## 2. Classic Breakages (in rough order of how often they bite)

### A. Double NavigationContainer crash (immediate, hard error)
Nesting a `NavigationContainer` inside another one throws a hard runtime error. The `independent` prop workaround was removed in react-navigation v7 (replaced with `NavigationIndependentTree`). 

Swellyo-specific: if ConversationsStack already has its own `NavigationContainer`, it MUST be removed before the root container is added. This is the first thing to verify.

### B. `navigate()` stops going to nested screens (v7 breaking change, silent regression)
In react-navigation v7, `navigate('ScreenName')` no longer bubbles into child navigators. It only navigates within the current navigator's scope. If you had code like `navigation.navigate('TripDetail')` and TripDetail was in a nested stack, it silently does nothing in v7.

Fix: use `navigation.navigate('ParentStack', { screen: 'TripDetail', params: { tripId } })`.  
Temporary bridge: `navigationInChildEnabled` prop on `NavigationContainer` (removed in v8 — not a long-term solution).

### C. iOS swipe-back gesture vs horizontal scroll conflict
Once screens are in a native-stack, the iOS swipe-back gesture activates. Any screen with a horizontal `ScrollView`, `FlatList`, or RNGH `PanGestureHandler` will conflict. GitHub #8946 (open since 2020): no official workaround documented that fully resolves it.

Working approaches (from prior research): `failOffsetX: [-20, 20]` on PanGestureHandler + `simultaneousWithExternalGesture(Gesture.Native())`. For screens where swipe-back must be suppressed: `gestureEnabled: false` in screen options.

### D. Android hardware back regressions
Three distinct failure modes:
- Hardware back fires before navigation state initializes → crash (#6039)
- First press does nothing, second press works (#9364)  
- Android 13+ hardware back broken entirely on physical devices (#11227)
- Going back causes screen to flash back-and-forth freezing the app (#10096)

All require explicit `BackHandler` setup with `useFocusEffect`. React Navigation v7 does not fully handle Android back out of the box for every edge case.

### E. Deep-link / push-notification routing race condition
Cold start: notification arrives, NavigationContainer hasn't mounted yet, the deep-link target is lost. The app lands on default screen.

Auth-flow compounding: if the user is unauthenticated, the navigator is conditionally not rendered. The `isReady()` check returns false indefinitely until auth resolves.

v7 solution: `UNSTABLE_routeNamesChangeBehavior: 'lastUnhandled'` — remembers unhandled navigation actions that arrived before auth state resolved, then replays them post-login. This is the right pattern going forward.

For the Swellyo `pendingTripDetailId` pattern: this is the "manual navigation after login" workaround — it races with navigation initialization. Should be replaced with the v7 `lastUnhandled` behavior after migration.

### F. `navigate()` vs `push()` when navigating to same screen multiple times
`navigate('Profile', { userId })` jumps to an existing Profile route if one is in the stack, rather than pushing a new one. This breaks Profile → Trip → Profile chains.

Rule: always use `push('Profile', { userId })` for user-tappable profile/detail navigation to allow multiple instances.

iOS crash (New Architecture): calling `navigation.navigate()` twice in rapid succession triggers a push-same-VC crash on iOS with New Architecture enabled (#11560). Use `push()` — it does not have this race.

### G. Keyboard handling breaks inside native-stack screens
`KeyboardAvoidingView` requires a correct `keyboardVerticalOffset` inside stack navigators because the header height shifts the coordinate system. When navigating between screens with different header heights, the offset from the first screen carries to the next.

For Swellyo (which uses react-native-keyboard-controller already): RNKC is immune to this — it attaches to the window not the layout frame. This is already handled correctly.

### H. Modal state loss / flash (React 19 + react-navigation v7)
Known bug (#12647): when a stack action unmounts a screen while a react-native-modal is visible, the modal briefly flashes on the new screen before disappearing. Specific to React 19 + @react-navigation/stack 7.x.

Note: this affects `@react-navigation/stack` (JS-based), NOT `@react-navigation/native-stack`. Use native-stack (default for SDK 54) and this bug does not apply.

### I. Navigation state mutations throw in development (silent prod breakage)
v7 freezes navigation state objects in development mode. Any code that was mutating state objects directly will throw in dev but silently fail in prod on older versions. This is a good thing — it surfaces hidden bugs during migration.

### J. Liquid glass header buttons (react-native-screens 4.16+, iOS)
After upgrading to react-native-screens 4.16.0+, iOS headers automatically wrap `headerLeft`/`headerRight` items in "liquid glass" styling with no opt-out. Status: issue #3226 is closed/unresolved as of June 2026. If using custom header elements, verify on iOS.

### K. Android "Screen fragments should never be restored" crash (react-native-screens 4.11+)
Affects RN 0.80.1+ / react-native-screens 4.11.1+ when Android recreates the activity (rotation, process death, app restored from background). FragmentManager tries to restore ScreenFragment instances, conflicts with React Native's lifecycle.

Workaround: in `MainActivity.kt`, override `onCreate` and pass `null` as savedInstanceState:
```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
  supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
  super.onCreate(null)
}
```
Issue #3317 is open with no official fix. Must apply this before first native build with react-navigation on RN 0.81 / SDK 54.

### L. Android predictive back gesture broken (SDK 54 + Expo Router)
On Android with predictive back gesture enabled, back navigation via gesture exits the app to home screen instead of popping the stack. Root labeled "Upstream: react-native-screens." Workaround: set `"android.predictiveBackGestureEnabled": false` in app config. Affects Expo Router more severely than bare react-navigation, but the upstream cause is the same.

### M. formSheet/transparentModal Android bugs (v7 native-stack)
- `formSheet` presentation: header does not show on Android (shows on iOS). Set `contentStyle: { flex: 1 }` or you get zero-height content.
- `transparentModal`: deep link to TabNavigator screen while a transparentModal is open creates a duplicate TabNavigator as a formSheet above it (v7-only regression, #12389).
- `transparentModal` on Android: app gets stuck after opening the modal 1-30 times in rapid succession.
- These only affect `@react-navigation/native-stack`. Swellyo uses native-stack — test all modal presentations on Android before shipping.

---

## 3. Migration Scope: How Long Does It Actually Take

No large-scale public post-mortem with exact timelines exists for boolean-to-react-navigation migrations (as opposed to react-navigation v5→v6→v7 upgrades).

From available signals:
- The "one more special back path" tail is the universal scope trap. Every migration that tried to enumerate "screens that need a custom back behavior" added 30-50% to estimates. The pattern: auth screens, onboarding steps, admin overlays, and modal sheets all have bespoke back behavior that wasn't documented.
- Teams that tried to audit all back paths upfront and migrate atomically took 2-4x longer than teams that did incremental-root-first.
- The `navigationInChildEnabled` flag is specifically documented as a "migrate gradually" bridge — the react-navigation team anticipated this being a multi-week project for larger apps.

Rule of thumb from the community: if you have >15 screens and >3 modal/overlay layers, budget 2-3 sprints minimum and treat each phase as independently shippable.

---

## 4. Testing Strategy for Back-Path Correctness

Official react-navigation guidance: **test the result, not the action.** Use React Native Testing Library against real navigators (not mocked ones). Assert that the expected component is visible after navigation, not that `navigate()` was called.

**Navigation state snapshot tests are explicitly NOT recommended** — the team considers navigation state an internal implementation detail subject to change.

**What works in practice (cross-referenced sources):**

A. **RNTL behavioral tests** — render the full navigator with `createTestNavigator`, simulate user taps on back button (`getByLabelText('ScreenName, back')`), assert title/content changes. This covers the most common back-path regressions.

B. **Maestro E2E flows** — define a YAML flow per critical path: DM → Profile → Trip → Back → Back → DM. Each assertion checks screen title or a unique testID. Maestro's `pressBack` command covers both iOS swipe-back simulation and Android hardware back. This is the best coverage for cross-navigator back paths.

C. **Manual matrix for iOS swipe-back specifically** — automated Maestro cannot fully replicate the iOS edge-swipe gesture on a simulator. Physical device or TestFlight build review for any screen with horizontal swipes is required.

**What does NOT work:**
- Navigation state snapshots (changes too often across library versions)
- Mocking `navigation.navigate` — mocks diverge from real behavior; this is how teams get "all tests pass, prod broken" after migration

---

## 5. Team Coordination (2-person team, ongoing features)

From the New Architecture migration without feature-freeze pattern (Shopify / Build-Break-Learn methodology):

**Core constraint: AppContent.tsx is the most dangerous concurrent-edit file.** CLAUDE.md already flags this — do not parallelize anything touching it.

**Branch strategy that works:**
- Create `nav-migration` branch off `main` (not off `eyal`).
- Each phase (Phase 1 through 5) ships as its own PR to `main`.
- Feature work continues on `eyal`/`ohad` branches, rebased onto `main` after each nav-migration phase merges.
- Never long-live the migration branch — the longer it diverges, the worse the merge conflict on AppContent.

**What to freeze:**
- Do NOT freeze feature work during migration.
- DO freeze any new hand-rolled boolean overlays. Once the migration starts, no new `showFoo` flags — new UI must use `navigation.push()`.
- DO freeze changes to the navigation prop flow (threading `navigation` object) until Phase 1 is complete and tested.

**Signaling for teammates:**
- Add a comment at the top of AppContent.tsx: `// MIGRATION IN PROGRESS — do not add new showX flags. Use navigation.push() instead.`
- Each phase branch should be small enough to review in <30 minutes.

---

## 6. Red Flags: When NOT to Migrate (or Delay)

Signals the migration is worth it (Swellyo has ALL of these):
- 6+ `showX` boolean flags in AppContent, growing with every feature
- "Where did I come from" state (e.g., `activeSurftripDetailId`, `pendingTripDetailId`)
- Notification deep-links that land in wrong place
- iOS swipe-back does nothing (users have to tap a custom back button)
- Profile → Trip → Profile chain impossible to implement cleanly

Signals to delay or not migrate:
- App is < 8-10 screens total with no deep-linking — boolean routing is fine
- Team is mid-way through another large refactor touching AppContent (don't overlap)
- React Native New Architecture migration is in progress simultaneously — two large concurrent refactors on the same app runtime are dangerous
- iOS store submission deadline in <3 weeks — a nav migration can produce subtle regressions visible only on device that eat testing time

---

## 7. SDK 54 / RN 0.81 / react-navigation v7 Timing

**Summary: the stack is stable enough to start Phase 1 now. Phase 5 before any react-navigation v8 upgrade.**

Key facts:
- `@react-navigation/native-stack` v7 requires `react-native-screens` v4 (mandatory). SDK 54 ships screens v4 correctly.
- `react-native-screens` v4.25+ requires New Architecture. SDK 54 enables New Architecture by default — this aligns.
- React Navigation v8 requires React 19 + RN 0.83 / Expo SDK 55. Do not upgrade to v8 on SDK 54. Stay on v7 until SDK 55 ships. v8 also drops `navigationInChildEnabled` entirely — any `navigate('NestedScreen')` call sites must be fixed before the v8 upgrade.
- v8 is in alpha as of June 2026; its "native bottom tabs as default" change means existing `BottomTabNavigator` code needs the `implementation="custom"` prop to preserve JS-based tabs. Plan this before upgrading.
- Known active bug: `react-native-screens` 4.16+ forces liquid glass header buttons on iOS (iOS 26 only, issue #3226, closed/unresolved June 2026). Test headers after upgrade.
- Known active instability: safe area ignoring with New Architecture on RN 0.77 (closed as not-planned by react-navigation). Verify safe area context version ≥ 5.2.0.
- `navigate()` nested-navigator breaking change in v7 is the most common surprise during migration — use `navigationInChildEnabled` temporarily while migrating call sites.

**Specific to Swellyo's stack:**
- ConversationsStack likely has its own `NavigationContainer` — this must be removed in Phase 1 before the root container is added (not after).
- The `pendingTripDetailId` pattern (AsyncStorage-based deep-link recovery) should be replaced with `UNSTABLE_routeNamesChangeBehavior: 'lastUnhandled'` on the root NavigationContainer in Phase 2.
- `enableFreeze(true)` from react-native-screens should be called in `App.tsx` once Phase 1 is complete (not before — it requires screens to be inside a NavigationContainer).

---

## Sources
- https://github.com/react-navigation/react-navigation/issues/9436 (conditional rendering state corruption — the core argument against atomic flag switch)
- https://reactnavigation.org/docs/upgrading-from-6.x/ (full v7 breaking changes list)
- https://github.com/react-navigation/react-navigation/issues/8946 (iOS swipe-back vs ScrollView, open since 2020)
- https://github.com/react-navigation/react-navigation/issues/11560 (navigate() crash on New Architecture iOS)
- https://github.com/software-mansion/react-native-screens/issues/3317 (Android "fragments should never be restored" crash, RN 0.80+)
- https://github.com/software-mansion/react-native-screens/issues/2578 (multiple rapid transitions crash with getId prop)
- https://github.com/react-navigation/react-navigation/issues/12389 (transparentModal + deep link duplicate TabNavigator bug, v7)
- https://github.com/react-navigation/react-navigation/issues/12438 (formSheet header missing on Android)
- https://github.com/expo/expo/issues/39092 (predictive back gesture broken SDK 54 / react-native-screens upstream)
- https://medium.com/opendoor-labs/how-we-improved-app-performance-and-code-quality-by-upgrading-react-navigation-25ccd8363432 (Opendoor incremental migration, 85% gains from root-first, v1/v5 coexistence pattern)
- https://medium.com/@shanavascruise/migrating-from-react-native-navigation-to-react-navigation-native-a-complete-guide-599662679aaa (NavigationWrapper incremental pattern, function-in-params breakage)
- https://reactnavigation.org/docs/testing/ (test the result not the action, RNTL over mocks)
- https://github.com/react-navigation/react-navigation/discussions/10506 (v7 plans, nested nav pain, community sentiment)
- https://reactnavigation.org/blog/2025/12/19/react-navigation-8.0-alpha/ (v8 alpha: RN 0.83 / SDK 55 required, native tabs default, deep link lastUnhandled backported to v7)
