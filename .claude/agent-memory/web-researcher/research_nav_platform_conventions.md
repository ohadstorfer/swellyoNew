---
name: nav-platform-conventions
description: iOS + Android official navigation conventions — tab stack preservation, back behavior, deep-link back stacks, modal vs push rules, scroll position, plus how Instagram/WhatsApp implement them
metadata:
  type: reference
---

## Topic
Official platform navigation conventions for tab-based consumer apps: Apple HIG, Android/Material guidelines, Android developer docs on tasks + back stack, and real-world behavior of Instagram/WhatsApp.

Researched for Swellyo's 3-root navigation model (Chat List / Trips / Profile).

---

## 1. Tab Switching — Does each tab preserve its navigation stack?

### iOS (UITabBarController)
**YES — per-tab stack preservation is the official UIKit behavior and Apple HIG explicitly calls it out.**

Each tab hosts its own `UINavigationController`. When you switch tabs, the departing tab's entire view controller stack is suspended in place. Returning to that tab restores you exactly where you were. This is the `UITabBarController` default — no opt-in needed.

Apple HIG (ios-navigation): "Different tabs remember their state. If you travel to a certain destination in one tab, switch to another tab, then switch back to the first tab, you'll be where you left off in that tab."

### Android (Bottom Navigation + Multiple Back Stacks)
**YES — multiple back stacks are the documented Android pattern since Navigation 2.4.0 (2022).**

The official approach uses `popUpToSaveState="true"` and `restoreState="true"` in navigation actions, or equivalently `saveState = true` + `restoreState = true` in the Kotlin DSL. `NavigationUI.setupWithNavController()` does this automatically.

Android docs (multi-back-stacks): "When a user switches between bottom navigation tabs, each section remembers its own navigation stack, including any deep navigation the user performed within that section."

**iOS vs Android difference:** Both preserve per-tab state by convention, but the iOS mechanism is UIKit-native and automatic; Android requires Navigation component 2.4+ with explicit save/restore options. React Navigation's bottom tab navigator replicates this on both platforms via `detachInactiveScreens`.

---

## 2. Re-tapping the Current Tab — What should happen?

### Official React Navigation convention (applies to both iOS + Android)
Tapping the already-focused tab performs TWO actions depending on context:
- If the tab contains a **scroll view**: scroll to top (via `useScrollToTop` hook)
- If the tab contains a **stack navigator**: `popToTop` — pops all screens back to the root of that tab's stack

This is baked into React Navigation's `tabPress` event default. Prevent it with `event.preventDefault()`.

### Real-world app behavior (iOS)
Instagram, YouTube, LinkedIn, Reddit all implement **single tap = scroll to top** on the current tab. Twitter/X also does this. This is effectively the de-facto iOS standard even though Apple doesn't document a single specific gesture — it's what users expect.

**Pop-to-root** (clearing deep stack in current tab) also happens when re-tapping, before scroll-to-top. Both are usually needed together.

---

## 3. Android Hardware Back — What's the convention when deep in a tab's stack?

### Material / Android documented convention
**Pop the CURRENT TAB'S stack first. Only exit to start destination when the current stack is empty.**

Android principles: "Navigating between tabs should NOT create history for the system back button. Going deeper into hierarchies stemming from bottom nav destinations CAN create history for the back button."

This means:
- Tab switching itself: no back history created
- Navigating deeper within a tab: each pushed screen IS a back stack entry
- Back while deep in Tab B: pops Tab B's stack screens one by one
- Back when Tab B is at root: exits app (or goes to start destination), NOT back to Tab A

### What Instagram/WhatsApp actually do
**Both follow the documented convention.** They do NOT jump back to the previous tab on hardware back. Back pops the in-tab stack, and at root it exits.

This is important: there is NO "chronological tab history" behavior in production consumer apps. The `backBehavior="history"` option in React Navigation (which tracks which tabs were visited in what order) is NOT what Instagram/WhatsApp use.

### Android Predictive Back (Android 13+, mandatory behavior change)
As of Android 15, predictive back gesture animations are no longer behind a developer option — they are standard. Apps must implement `OnBackPressedDispatcher` or AndroidX Navigation component to get the correct predictive back animations. React Navigation's `native-stack` integrates with this automatically.

---

## 4. Notification Deep Links — Back Stack Convention

### Android (documented)
**Synthesized back stack.** When a notification opens a deep screen (e.g., chat thread), Android's `NavDeepLinkBuilder` / `TaskStackBuilder` should build a synthetic back stack that mirrors what organic navigation would produce.

Android docs (deep-link): "When a user opens your app via an explicit deep link, the task back stack is cleared and replaced with the deep link destination. The start destination from each `<navigation>` element in the hierarchy is also added to the stack. This means when the user presses Back from a deep link destination, they navigate back up the navigation stack just as though they entered your app from its entry point."

**Concrete example for Swellyo:** Notification opens TripDetail → synthetic back stack should be: [Home/TripsTab root] → [TripDetail]. Back from TripDetail goes to TripsTab root, not to whatever the user was doing before.

### iOS (documented/HIG)
iOS does not have a "synthesized back stack" concept at the OS level. Instead, the convention is to **navigate the app to the correct state** — push the deep destination onto whichever tab's stack logically owns it. Back then works within that tab's stack.

WhatsApp iOS behavior (confirmed): Tap notification → opens chat screen. Back → returns to chat list (the root of the Chats tab). This is navigation push onto the Chats tab, not a new synthetic stack.

### iOS vs Android DIFFERENCE — critical
- **Android**: documented pattern = synthesized stack = Back goes to intermediate screens even if user never visited them
- **iOS**: no synthesized stack concept; navigate to the right tab + push the screen; Back works within that tab's normal stack

For React Native apps, the practical result is the same but the implementation differs. On Android, `navigation.navigate()` to the deep screen from a notification handler naturally creates the right stack if the navigator is set up with proper nesting. On iOS, just `navigation.navigate()` from the notification handler and let the tab + stack routing handle it.

---

## 5. In-App Notification / Activity Feed Panel — Is it a tab or a screen?

### Industry pattern (Instagram)
Instagram's activity feed ("heart" tab / notifications tab) **is a full tab** in the bottom navigation — it has its own navigation stack. Tapping a post/comment from the activity feed **pushes the post as a new screen** onto the activity feed tab's stack. Back from that post returns to the activity feed list.

This means:
- Activity feed = root of its own tab stack
- Post opened from feed = pushed screen (in back history)
- Back = returns to feed, not to the previous tab

### Applies to Swellyo
If there is a notification/activity panel in the app, it should be either:
1. A full tab in the bottom bar with its own stack (Instagram pattern), or
2. A `transparentModal` screen in the root stack (no tab, accessed via gesture/button, back dismisses it)

A notification panel that is a boolean-overlay floating above everything is the wrong pattern — it breaks hardware back and has no natural "back to feed" history.

---

## 6. Modal vs Push — When to Use Each

### Apple HIG rules
**Use PUSH (hierarchical navigation) when:**
- The new screen is a direct child or continuation of the current context (e.g., list → detail)
- Users will navigate between views frequently / toggle back-and-forth
- The screen is part of the app's information hierarchy
- Users need to reference the previous screen to complete the current one

**Use MODAL (sheet/card presentation) when:**
- The task is self-contained and the user must complete or cancel before returning
- The new context is a departure from the current flow (authentication, settings, compose)
- User input/data entry that requires completion or explicit cancellation
- The content does not belong in the navigation hierarchy

Apple HIG (modality): "Modality creates focus by separating people from the information hierarchy. Use it sparingly, and only to gather critical information or present a task that must be completed before continuing."

**Key Apple rule:** Never use a modal when the user will need to reference the background content to complete the task in the modal.

### Material Design rules (aligned with Apple HIG on this)
Same principle: modals (bottom sheets, dialogs) for "focused temporary tasks." Pushed screens for hierarchy navigation. Material 3 also adds: standard bottom sheets can be non-modal (persistent); modal bottom sheets block the rest of the UI.

### Practical decision rule for Swellyo
| Screen type | Pattern |
|---|---|
| Trip detail (from trip list) | Push (hierarchical) |
| User profile (from anywhere) | Push (hierarchical, push() not navigate()) |
| Create trip wizard | Modal / full-screen sheet |
| Compose message | Modal / full-screen sheet |
| Settings / Edit profile | Modal or Push (either acceptable) |
| Confirmation dialog | Modal (alert style) |
| Filter panel / sort overlay | Modal bottom sheet |
| Notification panel | Push onto its tab, or transparentModal |

---

## 7. State Preservation — Scroll Position

### iOS (documented UIKit behavior)
Scroll position is preserved automatically for screens that stay mounted in a `UINavigationController` stack. UIKit's `UIScrollView` has a `scrollsToTop` property. Assigning a `restorationIdentifier` to scroll views enables the system to restore their state across app launches.

Within a navigation session (not killed/relaunched): **scroll position is preserved for free** on any screen that stays mounted in the stack. Navigating forward and back does NOT reset scroll.

### Android (documented)
Similar: Fragment back stack retains view state including scroll position as long as the Fragment is in the back stack (not destroyed). With multiple back stack support, tab-level scroll state is preserved on tab switch.

### React Navigation
`native-stack` keeps screens mounted in the React component tree even when not at the top of the stack. Scroll position is preserved naturally — the component is never unmounted on back-navigation.

The exception: `unmountOnBlur: true` on a tab (or bottom tab with `detachInactiveScreens` behavior destroying the component) WILL reset scroll.

### useScrollToTop hook
React Navigation's `useScrollToTop` is for the "tap current tab to scroll to top" pattern. It is NOT needed for back-navigation scroll preservation (that's automatic). Use it only on FlatList/ScrollView components inside tab root screens.

---

## iOS vs Android DIFFERENCES SUMMARY

| Convention | iOS | Android |
|---|---|---|
| Per-tab stack preservation | Built-in (UITabBarController) | Requires Navigation 2.4+ with save/restore options |
| Re-tap current tab | Single tap = pop to root + scroll to top (de-facto standard, not HIG-documented) | Same behavior via React Navigation default tabPress |
| Hardware back when deep in tab | N/A (no hardware back on iOS; edge swipe = pop 1 screen) | Pop current tab's stack; at root = exit app; does NOT jump to previous tab |
| Back from deep screen at tab root | iOS swipe-back = pop; no hardware back | Hardware back = exit app from tab root (NOT switch to prev tab) |
| Notification deep link back stack | Navigate to owning tab + push screen; back works within that tab | Synthesized back stack via NavDeepLinkBuilder; back traverses synthetic hierarchy |
| Modal presentation | Bottom-up sheet animation; swipe-down to dismiss | Bottom sheet or dialog; back button dismisses |
| Predictive back | iOS swipe-back has always been "predictive" (peeks behind screen) | Android 13+ predictive back gesture; mandatory visuals as of Android 15 |

---

## React Navigation Concrete Settings for Swellyo

For a 3-root (Chat / Trips / Profile) setup:

```typescript
// backBehavior for bottom tabs
// "firstRoute" = pressing back from any non-first tab goes to first tab's ROOT
// "none" = hardware back has no tab-level effect (each tab's stack handles it)
// CORRECT for "pop stack then exit" is: none + each tab's stack handles back
<Tab.Navigator backBehavior="none">
```

With `backBehavior="none"`, the tab navigator itself doesn't intercept back. Each tab's nested stack pops its own screens. When the stack is empty, Android exits the app. This matches Instagram/WhatsApp behavior.

`backBehavior="firstRoute"` (React Navigation default) jumps back to the first tab — this is NOT what production apps do and violates Android Material guidelines that say "tab switching should not create history for the back button."

```typescript
// Tab press re-select: built-in scroll-to-top + popToTop
// No extra code needed. Ensure FlatList/ScrollView refs use useScrollToTop hook.
import { useScrollToTop } from '@react-navigation/native';
const ref = useRef(null);
useScrollToTop(ref);
<FlatList ref={ref} ... />
```

---

## Sources
- https://developer.apple.com/design/human-interface-guidelines/tab-bars
- https://developer.apple.com/design/human-interface-guidelines/modality
- https://developer.android.com/guide/navigation/backstack/multi-back-stacks
- https://developer.android.com/guide/navigation/principles
- https://developer.android.com/guide/navigation/design/deep-link
- https://m3.material.io/components/navigation-bar/guidelines
- https://reactnavigation.org/docs/bottom-tab-navigator/
- https://reactnavigation.org/docs/use-scroll-to-top/
- https://frankrausch.com/ios-navigation/
- https://developer.android.com/design/ui/mobile/guides/patterns/predictive-back
- https://medium.com/androiddevelopers/navigation-multiple-back-stacks-6c67ba41952f
