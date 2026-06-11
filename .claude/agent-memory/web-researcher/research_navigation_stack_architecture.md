---
name: navigation-stack-architecture
description: Deep screen stacking (10+), back history, scroll restoration, modal-in-stack, and incremental migration from boolean-overlay AppContent to react-navigation native-stack
metadata:
  type: reference
---

## Topic
React Navigation native-stack deep stacking, back history, scroll state, transparent-modal overlays, and migration from Swellyo's hand-rolled boolean-flag overlay router in AppContent.tsx.

## Canonical Architecture

### The native mechanism (why it's smooth)

`@react-navigation/native-stack` delegates entirely to platform navigation primitives:
- iOS: `UINavigationController` — each screen is a `UIViewController`
- Android: `FragmentManager` with `Fragment` transactions

This means 60fps transitions run on the **native main UI thread**, never touching the JS thread. Frame drops in JS (slow render, Hermes GC) cannot jank the swipe-back gesture or the push animation.

`react-native-screens` v4 (current for SDK 54 / RN 0.81) is the adapter layer. It wraps screens in native containers (`ScreenStackHostWrapper` on iOS, `ScreenFragment` on Android).

**Key mechanism — detachInactiveScreens:**
When a screen is not at the top of the stack, its native view is *detached from the view hierarchy* (but not destroyed in JS). The component tree stays mounted in React's virtual DOM. Only the topmost 1-2 screens have live native views. This is why 10+ deep is not a memory problem in practice — you are paying JS memory for mounted components but not GPU/native-view memory for invisible screens.

**freezeOnBlur / enableFreeze:**
`enableFreeze(true)` from `react-native-screens` wraps inactive screen subtrees in `React.Suspense`-based "freeze" (via the `react-freeze` package). Frozen subtrees do not re-render even when parent state changes. Call `enableFreeze(true)` once at app startup, before any navigation renders.

**WARNING (June 2025, RN screens #2971):** The `freezeOnBlur` interaction with **bottom tab navigators** has a confirmed memory leak + JS FPS regression (60→20-40fps) when >3 tabs are active. This bug is specific to tabs; it does NOT appear to affect native-stack screens. The issue was fixed in a PR (#2963) but verify it is in the version your SDK 54 install pins.

### How deep is "fine"?

Yes, 10+ screens is fine. The native UINavigationController has no documented stack-depth limit that any shipping app has hit. Meta's internal apps push dozens of screens deep in some flows. The memory cost is proportional to the JS component trees of each mounted screen, not native views.

---

## Same Screen Multiple Times (Profile → Trip → Profile → Trip)

**Use `navigation.push('ScreenName', params)` — not `navigation.navigate()`.**

`navigate()` is "go to this destination" — if a screen with that name exists, it jumps to it. `push()` is "add another copy" — it always pushes a new instance regardless of whether the name already exists in the stack.

```typescript
navigation.push('Profile', { userId: 'abc123' })
navigation.push('TripDetail', { tripId: 'xyz' })
navigation.push('Profile', { userId: 'def456' }) // works fine — separate instance
```

**getId caveat:** The `getId` prop on `<Screen>` is meant to prevent duplicate IDs in a stack. **It does NOT work correctly with `@react-navigation/native-stack`** — this is a documented known issue in v6 and v7. Avoid `getId` entirely on native-stack. Use `push` to allow multiples, and never rely on ID-based deduplication in native-stack.

React Navigation 8.0 (requires React 19 + RN 0.83 / Expo SDK 55) fixes `getId` behavior, but that is not this project's current stack.

---

## Modal/Panel Layers Participating in Back History

Three patterns, ranked by correctness:

### Pattern A — transparentModal presentation (recommended for notification panels)
Define the notification panel as a real screen in the root stack with `presentation: 'transparentModal'`. The previous screen stays rendered behind it (transparent background). Hardware back and iOS swipe-back dismiss it. It is a first-class entry in the navigation stack.

```typescript
<Stack.Screen
  name="NotificationPanel"
  component={NotificationPanelScreen}
  options={{ presentation: 'transparentModal', headerShown: false }}
/>
```

The previous screen stays because `detachPreviousScreen` is automatically set to `false` for transparent modals.

**Android caveat:** There is a reported issue where `transparentModal` screens on Android do not honor `statusBarTranslucent` correctly. Test on Android.

### Pattern B — nested stack with header containing the panel trigger
If the panel is a filter or sort overlay (not a full screen), keep it as a local state toggle *within* a screen, not a route. This is correct — not every layer needs to be a route.

### Pattern C — manual BackHandler (current Swellyo approach)
Hand-rolled back management. Works but does not integrate with iOS swipe-back gesture, and "what was under me" is ad-hoc per overlay. This is the problem being solved.

---

## Scroll Position Preservation

**The native-stack preserves scroll position automatically for screens that stay mounted.** Because inactive screens remain in React's component tree (just detached from the native view), their scroll state is never lost — React doesn't re-render or reset them.

**The edge case that breaks this:**
If a screen is *unmounted* (e.g., via `unmountOnBlur: true` on a tab, or manually), scroll resets. Native-stack screens in a stack do NOT unmount on navigation — they stay mounted until explicitly popped.

**Known scroll-to-top bug (iOS, June 2026, react-navigation #12843):**
On iPad iOS 26.1 there is a confirmed bug where `ScrollView`/`FlatList` inside a stack navigator with `headerShown: false` auto-scrolls to top when navigating back. This is a regression. Workaround: show the native header (even with custom back button) or file it against the React Navigation repo.

**Manual scroll preservation (if needed):**
React Navigation exports `useScrollToTop` hook. Pair it with a ref to your `FlatList`/`ScrollView`. This is for the "tap tab bar to scroll to top" pattern, not for back-navigation restoration.

For back-navigation, just keep the screen mounted (default behavior) and scroll is free.

---

## Migration: Boolean-Overlay AppContent → react-navigation

### Current Swellyo state (AppContent.tsx)
- `showProfile`, `showTrips`, `showSettings`, `showSwellyShaper`, etc. = boolean flags
- Active overlay rendered as `<View style={StyleSheet.absoluteFill}>{activeOverlay}</View>` on top of base content
- ConversationsStack is already a real react-navigation navigator (already nested)
- Back is handled per-overlay via custom callbacks
- Deep-link to trip from notification uses `setPendingTripDetailId` state

### Migration strategy: "root navigator, absorb overlays one by one"

**Do not try to migrate everything at once.** AppContent.tsx is the most interconnected file in the project (CLAUDE.md explicitly forbids parallelizing anything that touches it).

**Phase 1 — Introduce a NavigationContainer at root (1-2 days)**

Wrap AppContent's main-app render output in a `NavigationContainer` + root `createNativeStackNavigator`. The initial screen is the current "home" (the TripPlanningChat / lineup view). All other overlays still use boolean flags for now. Nothing user-facing changes except hardware back on Android now correctly pops the native stack if it has screens.

```typescript
// App.tsx or AppContent render
<NavigationContainer>
  <RootStack.Navigator screenOptions={{ headerShown: false }}>
    <RootStack.Screen name="Home" component={HomeScreen} />
    {/* overlays migrate in one by one below */}
  </RootStack.Navigator>
</NavigationContainer>
```

The ConversationsStack (already react-navigation) can be nested inside this as a screen, preserving all existing behavior.

**Phase 2 — Migrate TripDetail (highest priority, 1 day)**

This is the most broken overlay (notification deep-link to trip lands in wrong place). Replace `activeSurftripDetailId` + `showTrips` boolean logic with a proper `push('TripDetail', { tripId })` call. This immediately fixes the notification back-navigation problem.

**Phase 3 — Migrate ProfileScreen (1 day)**

Replace `showProfile` + `viewingUserId` with `push('Profile', { userId })`. This enables Profile → Trip → Profile chains.

**Phase 4 — Migrate NotificationPanel as transparentModal (half day)**

If a notification panel overlay exists, make it a `transparentModal` screen. This gives it back-button integration for free.

**Phase 5 — Remaining overlays (Settings, SwellyShaper, etc.) (1-2 days)**

Smaller, lower-risk.

### Pitfalls specific to this migration

1. **AppContent.tsx has no navigation prop today.** Phase 1 requires threading `navigation` from the root navigator down into AppContent, or using `useNavigation()` hook after wrapping in NavigationContainer. The hook is simpler.

2. **ConversationsStack is already nested.** It will slot into the new root navigator as a screen. It currently gets its own NavigationContainer — this needs to be removed (two NavigationContainers cannot be nested; only one per app).

3. **Pending notification state (`pendingTripDetailId`) is used to open TripDetail post-auth.** After migration, replace this with a `navigation.push('TripDetail', ...)` call inside the notification handler. The current async-state-set pattern can race with navigation initialization.

4. **absoluteFill overlays rendered on top of the NavigationContainer** will float above the native stack visually but won't be in the back history. `JoinDecisionOverlay` and `WelcomeToLineupOverlay` are fine to leave as absolute overlays — they are ephemeral toasts, not navigation destinations.

5. **Gesture conflicts.** Once screens are in a native-stack, the iOS swipe-back gesture is active. If any screen has a horizontal swipe gesture (e.g., RNGH PanGestureHandler), it may conflict. Set `gestureEnabled: false` in `screenOptions` for screens with competing horizontal gestures, or use the `failOffsetX` approach from the swipe-back research doc.

6. **Web.** `@react-navigation/native-stack` renders as a plain JS stack on web (react-native-screens has no native web layer). It works but transitions are JS-only on web. This is acceptable since web is not the primary native experience here.

---

## Expo SDK 54 / RN 0.81 Specifics

- **react-native-screens v4** is the correct version for this stack. v4.25.0+ requires New Architecture. SDK 54 ships with New Architecture enabled by default, so this aligns.
- **@react-navigation/native-stack v7** is required for react-native-screens v4. If the project has v6 of native-stack, upgrade.
- **React Navigation 8.0** (March 2026 progress report) requires React 19 + RN 0.83 / Expo SDK 55. **Do not upgrade to v8 on SDK 54** — React 19 is required and SDK 54 ships with React 18/19 compatibility but the navigator's `inactiveBehavior: 'pause'` using `React.Activity` requires React 19+. Stay on v7 until SDK 55.
- `enableFreeze(true)` call in `App.tsx` before any navigation renders. This is a one-liner with high upside.
- The `freezeOnBlur` bug is tab-specific. Native stack screens are not affected.

---

## Sources
- https://reactnavigation.org/docs/native-stack-navigator/
- https://reactnavigation.org/blog/2026/03/10/react-navigation-8.0-march-progress/
- https://github.com/software-mansion/react-native-screens
- https://github.com/software-mansion/react-native-screens/issues/2971 (freezeOnBlur tab memory leak)
- https://github.com/react-navigation/react-navigation/issues/12843 (scroll-to-top regression iOS 26.1)
- https://reactnavigation.org/docs/nesting-navigators/
- https://reactnavigation.org/docs/upgrading-from-6.x/
- https://reactnavigation.org/docs/screen/ (getId caveat for native-stack)
