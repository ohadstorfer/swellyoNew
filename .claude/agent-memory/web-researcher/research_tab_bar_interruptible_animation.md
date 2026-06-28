---
name: tab-bar-interruptible-animation
description: Rapid-tap-proof tab bar animation — two-concern split, Reanimated useAnimatedStyle pattern, iOS native equivalents, withSpring retargeting, interruptible animations
metadata:
  type: reference
---

## Topic
Making a tab bar indicator animation instant and unbreakable under rapid repeated tapping (mash 20 times fast).

## The Two-Concern Split (core pattern)
Separate the visual indicator position from the navigation state entirely:
- **Concern 1 (instant):** A SharedValue drives the indicator's translateX. Updated synchronously on tap. Runs on UI thread.
- **Concern 2 (slower):** `navigation.navigate()` dispatches the actual screen swap through React Navigation's JS pipeline.
The user sees the indicator snap immediately; the screen transition catches up.

## The Critical Reanimated Pattern
**BAD** — breaks interruption after first tap:
```js
onPress={() => { indicatorPos.value = withSpring(newTarget) }}
```
(Documented Reanimated issue #2733: placing withSpring/withTiming in an event handler makes the animation non-interruptible after the first interruption.)

**GOOD** — always interruptible:
```js
const style = useAnimatedStyle(() => ({
  transform: [{ translateX: withSpring(tabPositions[activeTabIndex.value]) }]
}));
// In event handler:
onPress={() => { activeTabIndex.value = newIndex; navigation.navigate(tab); }}
```
When `activeTabIndex.value` changes, Reanimated detects the derived spring target changed and IMMEDIATELY retargets from current position — this is the "reactive" pattern and it handles N rapid taps.

## Reanimated Mid-Animation Behavior (confirmed)
- When a SharedValue is updated mid-animation, the new animation starts FROM the current animated position (not from 0 or from last target)
- For `withSpring` placed in `useAnimatedStyle`: velocity DOES carry over into the new spring (per Reanimated 2.x docs)
- For `withTiming`: no velocity carryover (easing-based, not physics)
- Conclusion: `withSpring` inside `useAnimatedStyle` is the correct tool for rapid-tap indicators — velocity transfers, retargeting is smooth, no snapping

## iOS Native Equivalent
- `UIViewPropertyAnimator` with `isInterruptible = true`: can be paused at any point, fractionComplete queried, new animation started from current visual position
- Core Animation additive animations: new animation layers ADD to the current one rather than replacing it — this naturally absorbs interruptions without velocity discontinuity
- Older API: `UIViewAnimationOption.beginFromCurrentState` in `UIView.animate` — simpler but less control
- Facebook POP framework (precursor, now archived): first to popularize "query running animation velocity, seed the next animation with it" — this philosophy is now in UIKit and Reanimated's spring engine

## Native Platform Tab Bar Option
`react-native-bottom-tabs` (Oskar Kwaśniewski, Expo ecosystem) uses actual `UITabBarController` on iOS and `BottomNavigationView` on Android. Animation runs on native thread entirely — inherently instant, no JS thread involvement. This is closest to what Instagram uses.
Trade-off: cannot render custom React components as icons.

## Sources
- Reanimated docs (animations): https://docs.swmansion.com/react-native-reanimated/docs/2.x/fundamentals/animations/
- Reanimated issue #2733 (event handler vs useAnimatedStyle interruption): https://github.com/software-mansion/react-native-reanimated/issues/2733
- objc.io interactive animations (velocity preservation, spring + friction forces): https://www.objc.io/issues/12-animations/interactive-animations/
- WWDC 2016 session 216 UIViewPropertyAnimator: https://developer.apple.com/videos/play/wwdc2016/216/
- WWDC 2014 session 236 interruptible interactions: https://wwdcnotes.com/documentation/wwdcnotes/wwdc14-236-building-interruptible-and-responsive-interactions/
- Facebook POP blog post: https://engineering.fb.com/ios/introducing-pop-the-animation-engine-behind-paper
- react-native-bottom-tabs blog: https://reactnavigation.org/blog/2025/01/29/using-react-navigation-with-native-bottom-tabs/
- SwiftKick UIViewPropertyAnimator guide: https://medium.com/swiftkickmobile/building-better-ios-app-animations-swift-uiviewpropertyanimator-ca05728b1fa4
