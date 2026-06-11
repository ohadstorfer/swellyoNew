---
name: nav-canonical-architecture
description: Canonical react-navigation v7 production architecture: bottom tabs + native stacks, custom animated tab bar, sheets, deep linking, tab press behaviors, and memory config for Expo SDK 54 / RN 0.81
metadata:
  type: reference
---

## Topic
Full production architecture for react-navigation v7 on Expo SDK 54 / RN 0.81 (New Architecture, React 19). Covers tree structure, custom tab bar, sheets/modals, deep linking from push notifications, tab press behaviors, and memory config. Supersedes partial coverage in [[navigation-stack-architecture]].

---

## 1. Recommended Tree — 3-Tab App, Full-Screen Cards Cover Tab Bar

### The two canonical patterns

**Pattern A — Tabs nested inside root stack (CORRECT for Swellyo)**
```
NavigationContainer
  RootStack (createNativeStackNavigator)
    ├── HomeTabs (createBottomTabNavigator)   ← initial screen
    │     ├── ExploreTab
    │     │     └── ExploreStack (native-stack)
    │     │           ├── ExploreHome
    │     │           └── TripListDetail         ← stays inside tab, bar visible
    │     ├── TripsTab
    │     │     └── TripsStack (native-stack)
    │     │           ├── TripsHome
    │     │           └── (internal state only)  ← 3-pane segmented pager = screen state, not routes
    │     └── ProfileTab
    │           └── ProfileStack (native-stack)
    │                 └── MyProfile
    ├── TripDetail              ← pushed at ROOT, covers tab bar completely
    ├── UserProfile             ← pushed at ROOT, covers tab bar completely
    ├── NotificationPanel       ← presentation: 'transparentModal'
    └── FilterSheet             ← presentation: 'formSheet'
```

Official docs confirmation (reactnavigation.org/docs/nesting-navigators):
> "Tab navigator nested inside the initial screen of stack navigator — New screens cover the tab bar when you push them."
> "Stack navigators nested inside each screen of tab navigator — The tab bar is always visible."

**Pattern B — Stacks inside each tab (always-visible tab bar)**
Use when you NEVER want full-screen cards to hide the tab bar (social feed apps like Twitter). Not correct for Swellyo since TripDetail and UserProfile must be full-screen.

### Why Pattern A for Swellyo
- TripDetail pushed at root covers the tab bar naturally (no hacks, no `tabBarStyle: {display:'none'}`)
- Each tab retains its own stack state — back inside a tab pops within that tab's stack
- Push notifications navigate to TripDetail at root level, back button returns to wherever the user was inside tabs
- The prior `AppContent.tsx` boolean-overlay approach maps naturally to `push('TripDetail', { tripId })` at root

### Screen-internal pager (3-pane segmented view in Trips)
This is the right call. A swipeable 3-pane pager (e.g. react-native-pager-view, or a custom swipeable view) managed as component state inside TripsHome is canonical. Only navigable destinations need to be routes. Internal view-switching within a screen does not. React Navigation docs: use `Group` or internal state for code organization, not extra navigator nesting.

---

## 2. Custom Animated Tab Bar

### tabBar prop API
```tsx
<Tab.Navigator
  tabBar={(props) => <MyAnimatedTabBar {...props} />}
>
```
`props` contains: `state`, `descriptors`, `navigation`, `position` (animated value for tab indicator).

**Critical constraint**: `useNavigation()` cannot be called inside the tabBar function. Use the passed `navigation` prop.

### Pill animation (sliding between tabs)
The `position` prop from the navigator is a standard Animated.Value (not Reanimated SharedValue) that represents the current tab index as a float, interpolating during transitions. Use it directly:
```tsx
const translateX = position.interpolate({
  inputRange: tabs.map((_, i) => i),
  outputRange: tabs.map((_, i) => i * TAB_WIDTH),
});
```
For Reanimated: wrap in `useAnimatedProps` or convert via `useAnimatedValue` — but the native `position` prop is sufficient for most pill animations without converting to Reanimated.

### Hide-on-scroll: piping scroll events to the tab bar

**The correct cross-boundary pattern: React Context with Reanimated SharedValue**

The Reanimated maintainers confirmed (GitHub Discussion #4529) that React Context is the officially supported way to share SharedValues globally. Module-level singletons using `makeMutable` are internal API without public guarantees.

Pattern:
```tsx
// TabBarScrollContext.tsx
const scrollY = useSharedValue(0);
const TabBarScrollContext = createContext({ scrollY });

// Provider wraps everything in App.tsx or NavigationContainer
<TabBarScrollContext.Provider value={{ scrollY }}>
  <NavigationContainer>...</NavigationContainer>
</TabBarScrollContext.Provider>

// Screen (inside a tab)
const { scrollY } = useContext(TabBarScrollContext);
const scrollHandler = useAnimatedScrollHandler({ onScroll: (e) => {
  scrollY.value = e.contentOffset.y;
}});
<Animated.FlatList onScroll={scrollHandler} ... />

// Custom tab bar
const { scrollY } = useContext(TabBarScrollContext);
const tabBarStyle = useAnimatedStyle(() => ({
  transform: [{ translateY: withTiming(scrollY.value > 50 ? 100 : 0) }]
}));
```

The key insight: SharedValues created in React Context are worklet-accessible from any screen without JS thread round-trips. The tab bar reads the value directly on the UI thread.

### Jank pitfalls
- Do NOT use `Animated.event` (legacy animated) for scroll + hide — it runs on JS thread
- The `position` prop the navigator passes IS native-driver compatible (it is driven by native scroll/gesture)
- On Android, do NOT animate `display: none` — use `transform: translateY` + `pointerEvents: 'none'` when hidden
- BlurView inside the tab bar adds significant GPU cost; skip it or use a static blur snapshot

---

## 3. Memory & Performance Config (2026 Recommended)

### Current project versions
- react-native-screens: ~4.16.0 (project package.json)
- react-native-reanimated: ^3.15.1

### The right config
```tsx
// App.tsx — before any navigator renders
import { enableFreeze } from 'react-native-screens';
enableFreeze(true);  // safe for native-stack screens
```

**WARNING: freezeOnBlur bug in tabs (Issue #2971)**
- Affects react-native-screens 4.11.1 (reported June 2025)
- Symptom: >3 tabs → JS FPS drops 60→20-40fps + memory leak on each tab switch
- Fixed in PR #2963, but exact version number not published in the issue
- Project is on ~4.16.0 — check changelog to confirm fix is included
- Workaround if not fixed: do NOT set `freezeOnBlur: true` on the BottomTabNavigator; only rely on `enableFreeze(true)` at app level which applies to native-stack screens

### Recommended tab navigator config
```tsx
<Tab.Navigator
  screenOptions={{
    lazy: true,           // default true — screens render only on first focus
    freezeOnBlur: false,  // leave false until #2971 fix confirmed in your version
    detachInactiveScreens: true,  // default true — removes inactive native views
  }}
>
```

### Native stack memory
`detachInactiveScreens: true` (default) — fine for 10+ screens. The JS component tree stays mounted (preserving scroll state), only native views are released for off-screen screens. No documented stack-depth limit in production use.

---

## 4. Transparent Sheets/Panels as Routes

### transparentModal — reliability
```tsx
<RootStack.Screen
  name="NotificationPanel"
  component={NotificationPanel}
  options={{ presentation: 'transparentModal', headerShown: false }}
/>
```
- iOS: uses `UIModalPresentationOverCurrentContext` — reliable, previous screen stays rendered
- Android: known bug in react-navigation v7 (Issue #12713) — app freezes after 1-30 rapid open/close cycles on Android specifically when used with material-top-tabs. With native-stack + bottom-tabs the bug is less reproducible but documented.
- Android back button: automatically handled — hardware back dismisses the modal
- Avoid: do NOT deep-link into a tab screen while a transparentModal is open — this triggers a bug (Issue #12389) where the entire TabNavigator duplicates as a FormSheet. No fix yet.

### formSheet — reliability
```tsx
<RootStack.Screen
  name="FilterSheet"
  options={{
    presentation: 'formSheet',
    sheetAllowedDetents: [0.5, 1.0],
    sheetInitialDetentIndex: 0,
    sheetGrabberVisible: true,
    headerShown: false,
  }}
/>
```
- iOS: uses `UIModalPresentationFormSheet` — solid
- Android: uses `BottomSheetBehavior` — solid
- **Known bug (RN-Screens #2522)**: content inside a nested StackNavigator gets zero width/height on iOS. Fix: wrap root content in `<View style={{flex:1}}>` and avoid putting a stack navigator directly at the root of a formSheet screen. PR #3454 closed — check if your version of react-native-screens includes it.
- iOS gesture dismissal: enabled by default (swipe down)
- Android back: hardware back button dismisses; `gestureEnabled` defaults to false on Android

### Animating sheets with Reanimated
You cannot intercept the native sheet animation directly. For custom behavior use `@gorhom/bottom-sheet` (separate library) instead of native formSheet. For simple detent-based sheets, native formSheet is sufficient and runs at native fps.

---

## 5. Deep Linking from Push Notifications into Nested Structure

### The navigationRef + isReady pattern
```tsx
// navigation/navigationRef.ts
import { createNavigationContainerRef } from '@react-navigation/native';
export const navigationRef = createNavigationContainerRef();

// App.tsx
<NavigationContainer ref={navigationRef}>
```

```tsx
// Push notification handler (outside React tree)
import { navigationRef } from './navigation/navigationRef';

function handleNotificationPress(tripId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('TripDetail', { tripId });
  } else {
    // Queue it; fire in onReady callback
    pendingNavigation = () => navigationRef.navigate('TripDetail', { tripId });
  }
}
```

### Queuing before ready (NavigationContainer onReady)
```tsx
let pendingNavigation: (() => void) | null = null;

<NavigationContainer
  ref={navigationRef}
  onReady={() => {
    if (pendingNavigation) {
      pendingNavigation();
      pendingNavigation = null;
    }
  }}
>
```

### Building correct back stack for tab→stack navigation
When you `navigate('TripDetail', { tripId })` from a notification, the back button returns to wherever the tab stack was — this is correct behavior when TripDetail is at root level. No special `initialRouteName` manipulation needed.

For deep links that should land inside a tab+stack (e.g. notification → Explore tab → specific screen):
```tsx
navigationRef.navigate('HomeTabs', {
  screen: 'ExploreTab',
  params: { screen: 'ExploreDetail', params: { id: '...' } }
});
```
This activates the Explore tab AND pushes the detail screen inside it.

### v7-specific deep link bug
React Navigation v7 uses `NAVIGATE` action for deep links, which opens a new screen even if it already exists in stack history (changed from v6). Workaround: use `navigationRef.dispatch(CommonActions.navigate(...))` with explicit reset if needed.

**Bug to avoid**: Do NOT trigger a deep link while a transparentModal is open — causes TabNavigator duplication (Issue #12389, open, no fix).

---

## 6. Tab Press Behaviors

### popToTop — automatic
When the user taps the already-active tab, the default behavior calls `popToTop()` on the nested stack navigator automatically. You do NOT need to implement this manually if using a standard tab navigator.

### scrollToTop — useScrollToTop hook
```tsx
// Inside any screen component
import { useScrollToTop } from '@react-navigation/native';

const listRef = useRef<FlatList>(null);
useScrollToTop(listRef);

<FlatList ref={listRef} ... />
```
Works automatically when the tab is re-pressed. No custom event listener needed.

**Limitation**: When a top-tab navigator is nested inside a bottom-tab navigator, `useScrollToTop` only responds to the currently active inner tab press, not the outer bottom tab press. Known issue #8586.

### Custom tab bar must emit tabPress manually
```tsx
function onTabPress(route: Route, isFocused: boolean) {
  const event = navigation.emit({
    type: 'tabPress',
    target: route.key,
    canPreventDefault: true,
  });
  if (!isFocused && !event.defaultPrevented) {
    navigation.navigate(route.name);
  }
  // If isFocused && !event.defaultPrevented → default behavior (popToTop) fires automatically
}
```
Also emit `tabLongPress` on long press — required for correct behavior.

### popToTop bug in custom tab bars
Issue #9424: `navigation.popToTop()` called inside a tabPress listener executes on the *previous* tab's stack, not the focused one. Use the default emission pattern above and let react-navigation handle popToTop internally rather than calling it explicitly.

---

## 7. State Persistence — Production Verdict

**Do not use in production for Swellyo.** The official docs say "use with caution" and recommend enabling only in `__DEV__`. Key risks:
- If any screen crashes, the user relaunches into the same crashed screen — permanent trap
- Requires error boundary + state-clearing on crash to be safe
- New app versions may have incompatible navigation state schemas
- Async restore requires loading screen flash

Production apps (Facebook, Instagram, Twitter) do NOT restore navigation state across cold starts — they always launch to home tab. This is the correct UX for Swellyo too.

---

## Known Bugs Summary (v7 + react-native-screens 4.x, June 2026)

| Bug | Issue | Status | Workaround |
|-----|-------|--------|------------|
| freezeOnBlur tabs memory/fps | RNS #2971 | Fixed in PR #2963 | Don't set freezeOnBlur:true on tabs if not fixed in your version |
| formSheet zero-size with nested stack | RNS #2522 | Fixed in PR #3454 | Wrap content in View flex:1, no navigator at root of formSheet |
| transparentModal Android freeze | RN #12713 | Open | Avoid rapid open/close on Android; use on specific non-repeated flows |
| deep-link while transparentModal open | RN #12389 | Open | Close modal before processing notification deep links |
| scroll-to-top nested tabs | RN #8586 | Open | Accept limitation or implement custom tabPress listener |
| v7 deep link NAVIGATE action | RN #12407 | Open | Use CommonActions.dispatch explicitly for dedup behavior |

---

## Applies to Swellyo Stack

- Project already has `@react-navigation/native-stack` v7.14.11 and `react-native-screens` 4.16.0 — correct versions
- Project has `react-native-reanimated` 3.15.1 — fully compatible with SharedValue context pattern
- React 19.1.0 is installed — DO NOT upgrade to react-navigation v8 yet (requires RN 0.83 / Expo SDK 55 for full React 19 Activity API support)
- The AppContent.tsx boolean-overlay migration aligns exactly with Pattern A — root stack wraps tabs, cards push at root

---

## Sources
- https://reactnavigation.org/docs/nesting-navigators/
- https://reactnavigation.org/docs/bottom-tab-navigator/
- https://reactnavigation.org/docs/native-stack-navigator/
- https://reactnavigation.org/docs/navigation-container/
- https://reactnavigation.org/docs/use-scroll-to-top/
- https://reactnavigation.org/docs/state-persistence/
- https://reactnavigation.org/docs/hiding-tabbar-in-screens/
- https://reactnavigation.org/blog/2025/01/29/using-react-navigation-with-native-bottom-tabs/
- https://github.com/software-mansion/react-native-screens/issues/2971 (freezeOnBlur tabs bug)
- https://github.com/software-mansion/react-native-screens/issues/2522 (formSheet zero-size bug)
- https://github.com/react-navigation/react-navigation/issues/12713 (transparentModal Android freeze)
- https://github.com/react-navigation/react-navigation/issues/12389 (deep-link duplicates TabNavigator)
- https://github.com/react-navigation/react-navigation/issues/9424 (popToTop wrong tab in custom bar)
- https://github.com/react-navigation/react-navigation/issues/8586 (useScrollToTop nested tabs)
- https://github.com/react-navigation/react-navigation/issues/12407 (v7 NAVIGATE action deep links)
- https://github.com/software-mansion/react-native-reanimated/discussions/4529 (SharedValue in Context = official pattern)
- https://www.callstack.com/blog/deep-links-with-authentication-in-react-navigation (v7 deep link auth)
- https://github.com/react-navigation/react-navigation/discussions/13088 (scroll-aware tab bar discussion)
- https://medium.com/att-israel/how-to-add-scroll-aware-bottom-navigation-in-react-native-7734c9c6206d (scroll-hide pattern)
