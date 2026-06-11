---
name: nav-opensource-apps
description: How Bluesky and Expensify structure RN navigation in production — tab stacks, custom tab bars, push vs navigate, keep-alive, modals, chat screen lifecycle
metadata:
  type: reference
---

## Source files read directly

**Bluesky** (`bluesky-social/social-app`):
- `src/Navigation.tsx` — root navigator definition
- `src/view/shell/bottom-bar/BottomBar.tsx` — custom tab bar component
- `src/view/shell/index.tsx` — shell/composer architecture
- `src/components/Link.tsx` — useLink hook (push vs navigate)
- `src/screens/Messages/Conversation.tsx` — chat screen lifecycle
- `src/state/messages/index.tsx` — MessagesProvider composition
- `src/state/messages/convo/index.tsx` — per-convo state machine

**Expensify** (`Expensify/App`):
- `src/libs/Navigation/AppNavigator/Navigators/TabNavigator.native.tsx` — full tab navigator source
- `src/libs/Navigation/AppNavigator/Navigators/TabNavigatorBar.tsx` — custom tab bar
- `src/libs/Navigation/AppNavigator/Navigators/ReportsSplitNavigator.tsx` — chat split navigator
- `src/libs/Navigation/AppNavigator/AuthScreens.tsx` — root stack + modal navigators
- `src/libs/Navigation/AppNavigator/FreezeWrapper/index.native.tsx` — native freeze (no-op, relies on freezeOnBlur)
- `src/libs/Navigation/AppNavigator/FreezeWrapper/index.tsx` — web uses react-freeze's Freeze component

---

## Q1: Root structure — per-tab stacks or single shared stack?

### Bluesky
**Per-tab stacks, with a shared `commonScreens()` function injected into each.**

Tree (native mobile):
```
NavigationContainer
  Shell (wraps with providers + Composer overlay)
    TabsNavigator (Tab.Navigator from @react-navigation/bottom-tabs)
      HomeTab.Navigator (createNativeStackNavigatorWithAuth)
        HomeTab.Screen name="Home"
        {commonScreens(HomeTab)}   ← ~70 shared screens registered here
      SearchTab.Navigator
        SearchTab.Screen name="Search"
        {commonScreens(SearchTab)}
      MessagesTab.Navigator
        MessagesTab.Screen name="Messages"
        {commonScreens(MessagesTab)}
      NotificationsTab.Navigator
        ...
      MyProfileTab.Navigator
        MyProfileTab.Screen name="MyProfile" initialParams={{name:'me'}}
        {commonScreens(MyProfileTab)}
```

On web: a single `FlatNavigator` (no tabs, all screens in one stack).

`commonScreens()` is a JSX-returning function (~70 screens: Profile, Settings, Moderation, Post, etc.) that is called inside EVERY tab navigator, so Profile can be pushed from any tab without cross-tab navigation.

### Expensify
**Per-tab split navigators, inside a root stack that also owns persistent modals.**

Tree:
```
NavigationContainer
  RootStack.Navigator  (createRootStackNavigator)
    persistentScreens=[TAB_NAVIGATOR, RIGHT_MODAL_NAVIGATOR]
    TAB_NAVIGATOR  (createBottomTabNavigator)
      Tab.Screen name=SCREENS.HOME → HomePage
      Tab.Screen name=REPORTS_SPLIT_NAVIGATOR → ReportsSplitNavigator
        Split.Navigator
          Split.Screen name=INBOX → BaseSidebarScreen (persistent)
          Split.Screen name=ReportScreen (central, stacks multiple reports)
      Tab.Screen name=SEARCH_FULLSCREEN_NAVIGATOR
      Tab.Screen name=SETTINGS_SPLIT_NAVIGATOR
      Tab.Screen name=WORKSPACE_NAVIGATOR
    RIGHT_MODAL_NAVIGATOR (persistent) → slides in from right, 50+ screens
    SHARE_MODAL_NAVIGATOR
    ONBOARDING_MODAL_NAVIGATOR
    TEST_TOOLS_MODAL_NAVIGATOR
    + other modal navigators
```

Key insight: modals are sibling navigators to the tab navigator inside the root stack, marked `persistentScreens`. They are NOT pushed onto the tab stack.

---

## Q2: Custom tab bar — how built, how smooth?

### Bluesky
- `tabBar` prop on `Tab.Navigator` → passes props to `<BottomBar>` component
- BottomBar is at `src/view/shell/bottom-bar/BottomBar.tsx`
- Uses **Reanimated**: `import Animated from 'react-native-reanimated'`; wraps in `<Animated.View>` with `footerMinimalShellTransform` for hide-on-scroll behavior
- Active state tracked via `useNavigationTabState()` hook returning booleans (`isAtHome`, `isAtSearch`, etc.) — NOT from the tabBar props `state`
- Same-tab press: `StackActions.popToTop()` — pops the whole tab stack to root
- No tab-switch transition animations; smoothness comes from native stack transitions inside each tab
- Positioned floating above content with `paddingBottom: clamp(safeAreaInsets.bottom, 15, 60)` and `onLayout` to measure height

### Expensify
- `tabBar={renderTabBar}` prop → `<TabNavigatorBar state={state} />`
- Active tab resolved from: `ROUTE_TO_NAVIGATION_TAB[activeRoute?.name]`
- Animation: `animation: 'none' as const` on all tab screens (no tab-switch slide animation at all)
- Tab bar hide/show: opacity + pointerEvents toggle, shown only on narrow layout at root screens. Show is delayed with `requestAnimationFrame` to sync with navigation back animation — prevents the flash
- In wide layout (tablet/desktop): negative `marginTop` to overlay tab bar on content

---

## Q3: Same-screen-multiple-times (profile → post → profile chains)

### Bluesky
**Uses `push()` by default everywhere.** The `useLink` hook defaults to `action = 'push'`, dispatching `StackActions.push(screen, params)`. No `getId` prop is set on Profile screens. This means navigating to the same user twice adds a second copy to the stack — intentional for chains like profile → follower → their profile.

Navigation import: `action?: 'push' | 'replace' | 'navigate'` — the consumer chooses.

### Expensify
Uses standard React Navigation `navigate()`. Reports are stacked inside ReportsSplitNavigator's central stack, and comments in the source say "there can be multiple report screens in the stack with different report IDs."

---

## Q4: Scroll preservation and keep-alive

### Bluesky
- `screenOptions={{ lazy: true }}` on `Tab.Navigator` — tabs load on first visit only
- No `freezeOnBlur` set on Bluesky's tab navigator
- No explicit `react-freeze` usage found in Navigation.tsx
- Relies on native-stack's default behavior (screens kept mounted as long as they're in the stack)

### Expensify
- `freezeOnBlur: true` — set explicitly in `TAB_SCREEN_OPTIONS_BASE`. This is the native-screens mechanism (not react-freeze) that suspends rendering of inactive tabs.
- `lazy: true` — tabs load on demand
- `animation: 'none'` — no cross-tab slide animation
- Web only: `FreezeWrapper` uses `react-freeze`'s `<Freeze freeze={frozen}>` component (the native version is a no-op passthrough since `freezeOnBlur` handles it natively)
- Tab state preservation: custom `tabRouterOverride` with `getInitialState` that restores from `getPreservedNavigatorState()` — used because the slicing optimization can unmount/remount the TAB_NAVIGATOR

---

## Q5: Modals/sheets in back history

### Bluesky
- **Composer is NOT in the navigation stack.** It is rendered as a state-driven overlay inside `ShellInner` alongside `TabsNavigator`. Visibility controlled by `useComposerControls()` context. Completely separate from navigation.
- Bottom sheets use a portal/outlet pattern: `<BottomSheetOutlet />` rendered at shell level, individual dialogs manage their own visibility via hooks
- No `transparentModal` or `presentation: 'modal'` found in the codebase

### Expensify
- Modals ARE in the navigation stack — as sibling navigators to the TAB_NAVIGATOR inside RootStack, marked `persistentScreens`
- `RIGHT_MODAL_NAVIGATOR` contains 50+ settings/form screens; slides in from the right
- Overlay style for `TEST_TOOLS_MODAL_NAVIGATOR`: `contentStyle: StyleUtils.getBackgroundColorWithOpacityStyle(...)` (semi-transparent background)
- No `transparentModal` found; custom slide-in presentation instead

---

## Q6: Chat screen lifecycle and realtime state

### Bluesky
- **Realtime state lifted to providers, NOT in the screen.**
- `MessagesProvider` at `src/state/messages/index.tsx` = 4 nested providers: `CurrentConvoIdProvider`, `MessageDraftsProvider`, `MessagesEventBusProvider`, `ListConvosProvider`
- Per-conversation: `ConvoProvider` wraps each chat screen, creates a `Convo` class instance (state machine)
- On screen focus: `convo.resume()` called; on blur: `convo.background()` called — instance survives, transitions state
- Screen uses `useSyncExternalStore(convo.subscribe, convo.getSnapshot)` — data flows from the persistent class instance
- Current convo ID tracked globally: `setCurrentConvoId(convoId)` on focus, `setCurrentConvoId(undefined)` on blur (via `useFocusEffect` cleanup)
- No BackHandler found anywhere in chat stack

### Expensify
- Reports/chat uses `persistentScreens={[SCREENS.INBOX]}` — sidebar is always mounted
- `FreezeWrapper` wraps screens but is a no-op on native (freezeOnBlur handles it)
- Comment in source: "There can be multiple report screens in the stack with different report IDs" — they stack, not replace
- Actual websocket/Onyx state management is outside the navigator (Onyx = their global state library)

---

## Q7: Android hardware back

### Bluesky
- No `BackHandler` usage found anywhere in navigation files
- Lets react-navigation own it entirely

### Expensify
- No custom `BackHandler` found in navigation files
- Special handling for TAB_ROOT_SCREENS_WITHOUT_GESTURE: a `Set` of screen names where swipe-back gesture is disabled via `parentNavigation.setOptions({gestureEnabled: false})` — prevents swiping from root tab screens which would pop the entire TAB_NAVIGATOR
- `backBehavior="fullHistory"` on Tab.Navigator — Android back button traverses full tab history before exiting

---

## Applies to Swellyo

**Per-tab-stack decision:** Both Bluesky and Expensify use per-tab stacks. The `commonScreens()` pattern (Bluesky) is the cleanest for our case: register Profile + TripDetail + any shared screen in every tab stack so they can be pushed without cross-tab navigation.

**Custom tab bar:** Pass custom component via `tabBar` prop. Track active state from navigation state (not from tab bar props). Use `useNavigationTabState()` pattern (Bluesky) or map route names to tabs (Expensify). Our existing animated tab bar can be wired this way with no structural change.

**Chat keep-alive:** Our `MessagingProvider` already matches the Bluesky pattern — state lifted above navigation. The Supabase Realtime channel subscriptions should survive screen unmounts because they live in `MessagingProvider`, not in the chat screen. Verify `useFocusEffect` is used for screen-level active/background transitions rather than `useEffect`.

**push() for profile chains:** Use `push()` (via StackActions) for Profile screens so profile → post → profile chains work. Do not use navigate() which would pop back to an existing Profile instance.

**freezeOnBlur:** Set `freezeOnBlur: true` on tab screens (Expensify's approach) to prevent inactive tabs from re-rendering. Bluesky doesn't bother with it, but for Swellyo's Lineup tab (which has heavy realtime subscriptions), it's worth having.

**Modals/composer:** Keep composer-style overlays outside the navigator as state-driven overlays (Bluesky pattern). Only put navigable flows (settings, profile edit, trip details) in the stack.

**backBehavior:** Use `backBehavior="initialRoute"` (Bluesky) or `"fullHistory"` (Expensify). For Swellyo, `"initialRoute"` is simpler — Android back always goes home, not through tab history.
