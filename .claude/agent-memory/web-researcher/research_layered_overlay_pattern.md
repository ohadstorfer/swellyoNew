---
name: Layered Overlay Pattern — Profile over Chat (absoluteFill siblings)
description: How to layer Profile screen over a mounted Chat screen so it slides in from the right while chat stays alive underneath; absoluteFill sibling structure, Android stacking rules, React Navigation transparentModal trade-offs
type: reference
---

## Recommended pattern for this project

Stay with AppContent's custom approach. The bug is NOT in absoluteFill itself — it is in render order and conditional rendering.

### Root cause of the symptom (Profile slides in over home, not chat)

AppContent line 1398:
```tsx
{activeOverlay && <View style={StyleSheet.absoluteFill}>{activeOverlay}</View>}
```
When `showProfile` is true, `activeOverlay` is the fragment `<>{chatView (pointerEvents=none)}<>{profileView}</>`. Both are wrapped in their own absoluteFill INSIDE activeOverlay — correct. But when `showProfile` is false (transition beginning/ending), the chat View is not in `activeOverlay`, so the absoluteFill slot is empty. The slide-out animation reveals home because chat's absoluteFill wrapper was conditionally removed.

### The fix: render order + never tear down the chat layer during transitions

The chat layer INSIDE activeOverlay must remain mounted for the full duration of both enter AND exit animations of ProfileScreen — not just while showProfile=true.

### absoluteFill sibling stacking rules

1. **Later sibling = on top.** In React Native (both iOS and Android) the element rendered later in the JSX tree appears on top. No zIndex needed if render order is correct.
2. **All absoluteFill siblings need an opaque (or explicitly colored) background** unless you want transparency. An absoluteFill with `backgroundColor: undefined` is transparent.
3. **Android elevation is NOT needed** for sibling absoluteFill stacking — render order is sufficient on RN 0.81+.
4. **pointerEvents="none"** on the background layer is required to pass touch to the foreground layer.
5. **Do NOT mix `flex: 1` on a child inside an `absoluteFill` wrapper** — `flex: 1` inside `position: absolute` with top/left/right/bottom=0 already gives full dimensions; the flex is redundant but harmless. SafeAreaView inside may add unexpected insets if it treats itself as a root container.

### React Navigation transparentModal — why NOT to switch

- `transparentModal` keeps the previous screen alive and visible. BUT on Android there is a confirmed bug (react-navigation/react-navigation #12016) where `detachPreviousScreen` is NOT set to false for `presentation: 'modal'`, only for `transparentModal`. Even transparentModal has a known issue (#10298) where the previous screen is not visible DURING the entry animation on Android.
- Switching to React Navigation would require wrapping DirectMessageScreen + TripPlanningChatScreen in a navigator, undoing the entire AppContent layering architecture. Not worth it.

### react-native-screens stackPresentation="modal"

- This library's native modal handles "previous screen stays mounted" at the OS level (UIKit modal on iOS, Fragment on Android). Works well.
- But: only useful if you're already in a react-native-screens stack. Adding it just for this overlay means adding a native navigator context. Not worth the complexity in AppContent.

### display: 'none' vs conditional render

- Use `display: 'none'` style (not unmount) to hide the chat layer when it should not be interactive. This keeps its WebSocket subscriptions, scroll position, and all state alive.
- Pattern: `style={[StyleSheet.absoluteFill, !showChatBehindProfile && { display: 'none' }]}`

### Correct JSX structure for AppContent

```tsx
// Root container
<View style={styles.fill}>
  {/* Layer 0: ConversationsStack — always mounted, always fill */}
  <View style={[styles.fill, activeOverlay ? { display: 'none' } : undefined]}>
    <ConversationsStack ... />
  </View>

  {/* Layer 1: Chat — mounted when chat exists, hidden (not unmounted) when profile is on top */}
  {showTripPlanningChat && (
    <View style={[StyleSheet.absoluteFill, { display: profileIsActive ? 'none' : 'flex' }]}
          pointerEvents={profileIsActive ? 'none' : 'auto'}>
      <TripPlanningChatScreen ... />
    </View>
  )}

  {/* Layer 2: Profile — slides in over Layer 1 */}
  {showProfile && (
    <View style={StyleSheet.absoluteFill}>
      <ProfileScreen ... />
    </View>
  )}
</View>
```

The key: Layer 1 (chat) and Layer 2 (profile) are siblings at the same level, both absoluteFill. Profile renders AFTER chat in the tree so it is on top. Chat uses `display: 'none'` while profile is NOT active, and switches to visible during the slide transition.

## Sources

- React Navigation Stack docs (transparentModal, detachPreviousScreen): https://reactnavigation.org/docs/stack-navigator/
- react-navigation bug #12016 (detachPreviousScreen not false for modal on Android): https://github.com/react-navigation/react-navigation/issues/12016
- Android render order > zIndex: https://dev.to/ksi9302/react-native-android-zindex-elevation-issue-with-absolute-position-5315
- Reanimated z-index Android layout animation bug: https://github.com/software-mansion/react-native-reanimated/issues/5715
